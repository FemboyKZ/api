/**
 * Characterization tests for the Ko-fi claim flow.
 *
 * Pins the transactional behaviour - the row staying locked, each refusal rolling back,
 * and which branch credits a player versus records a pending gift - so it survives being moved out of the router.
 */
const request = require("supertest");
const express = require("express");

jest.mock("../src/db", () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

jest.mock("../src/utils/auth", () => ({
  adminAuth: (req, res, next) => next(),
}));

jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../src/services/vip/entitlements", () => ({
  creditSpend: jest.fn().mockResolvedValue(undefined),
}));

const pool = require("../src/db");
const { creditSpend } = require("../src/services/vip/entitlements");
const kofiRouter = require("../src/api/kofi");

const app = express();
app.use(express.json());
app.use("/kofi", kofiRouter);

const ACTOR = "76561198000000001";
const GIFT_TO = "76561198000000002";

/** Connection whose FOR UPDATE select returns the given kofi_transactions row. */
function claimConnection(tx, { insertId = 55 } = {}) {
  const conn = {
    beginTransaction: jest.fn().mockResolvedValue(),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
    query: jest.fn(),
  };
  conn.query.mockImplementation(async (sql) => {
    if (sql.includes("FROM kofi_transactions")) return [tx ? [tx] : []];
    if (sql.includes("INSERT INTO pending_gifts")) return [{ insertId }];
    return [{ affectedRows: 1 }];
  });
  return conn;
}

const unclaimed = {
  id: 9,
  amount_eur: "12.50",
  claim_status: "unclaimed",
  steamid: null,
};

const sqlOf = (conn) => conn.query.mock.calls.map(([sql]) => sql).join(" | ");

beforeEach(() => jest.clearAllMocks());

describe("POST /kofi/transactions/:id/claim", () => {
  it("rejects a decision that is neither self nor gift, before any query", async () => {
    const res = await request(app)
      .post("/kofi/transactions/9/claim")
      .send({ decision: "nonsense", steamid: ACTOR })
      .expect(400);

    expect(res.body.error).toBe("decision must be 'self' or 'gift'");
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  it("self-claim credits the actor and marks the row claimed", async () => {
    const conn = claimConnection(unclaimed);
    pool.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post("/kofi/transactions/9/claim")
      .send({ decision: "self", steamid: ACTOR })
      .expect(200);

    expect(res.body).toEqual({
      success: true,
      id: 9,
      claim_status: "claimed",
      beneficiary: ACTOR,
      pendingGiftId: null,
    });
    expect(creditSpend).toHaveBeenCalledWith(conn, ACTOR, "12.50");
    expect(sqlOf(conn)).toContain("UPDATE kofi_transactions");
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });

  it("gifting to a SteamID credits the recipient and marks it gifted", async () => {
    const conn = claimConnection(unclaimed);
    pool.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post("/kofi/transactions/9/claim")
      .send({ decision: "gift", steamid: ACTOR, targetSteamid: GIFT_TO })
      .expect(200);

    expect(res.body.claim_status).toBe("gifted");
    expect(res.body.beneficiary).toBe(GIFT_TO);
    expect(res.body.pendingGiftId).toBeNull();
    expect(creditSpend).toHaveBeenCalledWith(conn, GIFT_TO, "12.50");
  });

  it("gifting to an email records a pending gift instead of crediting", async () => {
    const conn = claimConnection(unclaimed, { insertId: 31 });
    pool.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post("/kofi/transactions/9/claim")
      .send({
        decision: "gift",
        steamid: ACTOR,
        targetEmail: "Gift@Example.COM",
      })
      .expect(200);

    expect(res.body.claim_status).toBe("gifted");
    expect(res.body.beneficiary).toBeNull();
    expect(res.body.pendingGiftId).toBe(31);
    expect(creditSpend).not.toHaveBeenCalled();

    const insert = conn.query.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO pending_gifts"),
    );
    // normalised address, the amount, the actor as source, the transaction id
    expect(insert[1]).toEqual(["gift@example.com", "12.50", ACTOR, 9]);
  });

  it("falls back to the transaction's own steamid as gift source", async () => {
    const conn = claimConnection({ ...unclaimed, steamid: GIFT_TO });
    pool.getConnection.mockResolvedValue(conn);

    await request(app)
      .post("/kofi/transactions/9/claim")
      .send({ decision: "gift", targetEmail: "a@b.com" })
      .expect(200);

    const insert = conn.query.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO pending_gifts"),
    );
    expect(insert[1][2]).toBe(GIFT_TO);
  });

  it("404s and rolls back when the transaction is missing", async () => {
    const conn = claimConnection(null);
    pool.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post("/kofi/transactions/9/claim")
      .send({ decision: "self", steamid: ACTOR })
      .expect(404);

    expect(res.body.error).toBe("Transaction not found");
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("409s and rolls back when it was already claimed", async () => {
    const conn = claimConnection({ ...unclaimed, claim_status: "claimed" });
    pool.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post("/kofi/transactions/9/claim")
      .send({ decision: "self", steamid: ACTOR })
      .expect(409);

    expect(res.body.error).toBe("Already claimed");
    expect(conn.rollback).toHaveBeenCalled();
  });

  it("400s a self-claim with no valid steamid, after locking the row", async () => {
    const conn = claimConnection(unclaimed);
    pool.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post("/kofi/transactions/9/claim")
      .send({ decision: "self", steamid: "not-a-steamid" })
      .expect(400);

    expect(res.body.error).toBe("Valid steamid required for self-claim");
    expect(conn.rollback).toHaveBeenCalled();
    expect(creditSpend).not.toHaveBeenCalled();
  });

  it("400s a gift with neither a valid target steamid nor email", async () => {
    const conn = claimConnection(unclaimed);
    pool.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post("/kofi/transactions/9/claim")
      .send({ decision: "gift", steamid: ACTOR, targetEmail: "not-an-email" })
      .expect(400);

    expect(res.body.error).toBe("gift requires targetSteamid or targetEmail");
    expect(conn.rollback).toHaveBeenCalled();
  });

  it("rolls back, releases and 500s when a write throws", async () => {
    const conn = claimConnection(unclaimed);
    conn.query.mockImplementation(async (sql) => {
      if (sql.includes("FROM kofi_transactions")) return [[unclaimed]];
      throw new Error("write failed");
    });
    pool.getConnection.mockResolvedValue(conn);

    await request(app)
      .post("/kofi/transactions/9/claim")
      .send({ decision: "self", steamid: ACTOR })
      .expect(500);

    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });
});
