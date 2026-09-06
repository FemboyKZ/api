/**
 * Characterization tests for the VIP custom role/tag routes.
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

const pool = require("../src/db");
const vipRouter = require("../src/api/vip");

const app = express();
app.use(express.json());
app.use("/vip", vipRouter);

const STEAMID = "76561198000000001";

/** A connection whose SELECT returns the given player_meta row (or none). */
function connectionFor(row) {
  const conn = {
    beginTransaction: jest.fn().mockResolvedValue(),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
    query: jest.fn(),
  };
  conn.query
    .mockResolvedValueOnce([row ? [row] : []]) // SELECT ... FOR UPDATE
    .mockResolvedValue([{ affectedRows: 1 }]); // upsert
  return conn;
}

/** The permissions JSON written by the upsert. */
function writtenPermissions(conn) {
  const upsert = conn.query.mock.calls.find(([sql]) =>
    sql.includes("INSERT INTO player_meta"),
  );
  return JSON.parse(upsert[1][1]);
}

beforeEach(() => jest.clearAllMocks());

describe("PUT /vip/:steamid/custom-role", () => {
  it("stores colour and trimmed name once the spend gate is met", async () => {
    const conn = connectionFor({ total_spent_eur: "40", permissions: null });
    pool.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .put(`/vip/${STEAMID}/custom-role`)
      .send({ color: "#ff0000", name: "  Neon  " })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.customRole).toEqual({
      id: null,
      color: "#ff0000",
      name: "Neon",
    });
    expect(writtenPermissions(conn).customRole.name).toBe("Neon");
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });

  it("keeps an existing role id when updating", async () => {
    const conn = connectionFor({
      total_spent_eur: "99",
      permissions: JSON.stringify({
        roles: [],
        customRole: { id: "role-1", color: "#000000", name: "Old" },
        customTag: null,
      }),
    });
    pool.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .put(`/vip/${STEAMID}/custom-role`)
      .send({ color: "#00ff00", name: "New" })
      .expect(200);

    expect(res.body.customRole.id).toBe("role-1");
  });

  it("refuses with 403 and rolls back below the spend threshold", async () => {
    const conn = connectionFor({ total_spent_eur: "39.99", permissions: null });
    pool.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .put(`/vip/${STEAMID}/custom-role`)
      .send({ color: "#ff0000", name: "Neon" })
      .expect(403);

    expect(res.body.error).toBe("Requires €40+ lifetime (have €39.99)");
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });

  it("treats a missing player_meta row as zero spend", async () => {
    const conn = connectionFor(null);
    pool.getConnection.mockResolvedValue(conn);

    await request(app)
      .put(`/vip/${STEAMID}/custom-role`)
      .send({ color: "#ff0000", name: "Neon" })
      .expect(403);

    expect(conn.rollback).toHaveBeenCalled();
  });

  it("rejects a bad SteamID, colour or name before touching the database", async () => {
    await request(app)
      .put("/vip/not-a-steamid/custom-role")
      .send({ color: "#ff0000", name: "Neon" })
      .expect(400);
    await request(app)
      .put(`/vip/${STEAMID}/custom-role`)
      .send({ color: "nope", name: "Neon" })
      .expect(400);
    await request(app)
      .put(`/vip/${STEAMID}/custom-role`)
      .send({ color: "#ff0000", name: "   " })
      .expect(400);
    await request(app)
      .put(`/vip/${STEAMID}/custom-role`)
      .send({ color: "#ff0000", name: "x".repeat(33) })
      .expect(400);

    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  it("releases the connection and 500s when the write throws", async () => {
    const conn = connectionFor({ total_spent_eur: "99", permissions: null });
    conn.query
      .mockReset()
      .mockResolvedValueOnce([[{ total_spent_eur: "99", permissions: null }]])
      .mockRejectedValueOnce(new Error("write failed"));
    pool.getConnection.mockResolvedValue(conn);

    await request(app)
      .put(`/vip/${STEAMID}/custom-role`)
      .send({ color: "#ff0000", name: "Neon" })
      .expect(500);

    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });
});

describe("DELETE /vip/:steamid/custom-role", () => {
  it("clears the role with no spend gate", async () => {
    const conn = connectionFor({
      total_spent_eur: "0",
      permissions: JSON.stringify({
        roles: [],
        customRole: { id: "r", color: "#fff000", name: "Old" },
        customTag: null,
      }),
    });
    pool.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .delete(`/vip/${STEAMID}/custom-role`)
      .expect(200);

    expect(res.body.customRole).toBeNull();
    expect(writtenPermissions(conn).customRole).toBeNull();
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe("PUT /vip/:steamid/custom-tag", () => {
  it("stores a palette colour once the spend gate is met", async () => {
    const conn = connectionFor({ total_spent_eur: "50", permissions: null });
    pool.getConnection.mockResolvedValue(conn);

    const { VALID_TAG_COLORS } = require("../src/config/permissions");
    const res = await request(app)
      .put(`/vip/${STEAMID}/custom-tag`)
      .send({ color: VALID_TAG_COLORS[0], name: "Tag" })
      .expect(200);

    expect(res.body.customTag).toEqual({
      color: VALID_TAG_COLORS[0],
      name: "Tag",
    });
    expect(conn.commit).toHaveBeenCalled();
  });

  it("refuses with 403 below the tag threshold", async () => {
    const conn = connectionFor({ total_spent_eur: "49", permissions: null });
    pool.getConnection.mockResolvedValue(conn);

    const { VALID_TAG_COLORS } = require("../src/config/permissions");
    const res = await request(app)
      .put(`/vip/${STEAMID}/custom-tag`)
      .send({ color: VALID_TAG_COLORS[0], name: "Tag" })
      .expect(403);

    expect(res.body.error).toBe("Requires €50+ lifetime (have €49)");
    expect(conn.rollback).toHaveBeenCalled();
  });

  it("rejects a colour outside the palette", async () => {
    await request(app)
      .put(`/vip/${STEAMID}/custom-tag`)
      .send({ color: "#123456", name: "Tag" })
      .expect(400);

    expect(pool.getConnection).not.toHaveBeenCalled();
  });
});

describe("DELETE /vip/:steamid/custom-tag", () => {
  it("clears the tag with no spend gate", async () => {
    const conn = connectionFor({
      total_spent_eur: "0",
      permissions: JSON.stringify({
        roles: [],
        customRole: null,
        customTag: { color: "red", name: "Old" },
      }),
    });
    pool.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .delete(`/vip/${STEAMID}/custom-tag`)
      .expect(200);

    expect(res.body.customTag).toBeNull();
    expect(writtenPermissions(conn).customTag).toBeNull();
  });
});

describe("POST /vip/gift-token/redeem", () => {
  const GIFT_TO = "76561198000000002";

  /**
   * Connection for the redeem flow. The first SELECT returns the sender's balance;
   * grantBaseVip's own SELECT then returns the recipient's row.
   */
  function redeemConnection({ balance, insertId = 77 }) {
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(),
      commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue(),
      release: jest.fn(),
      query: jest.fn(),
    };
    conn.query.mockImplementation(async (sql) => {
      if (sql.includes("SELECT gift_tokens")) {
        return [balance === null ? [] : [{ gift_tokens: balance }]];
      }
      if (sql.includes("SELECT permissions")) return [[{ permissions: null }]];
      if (sql.includes("INSERT INTO pending_gifts")) return [{ insertId }];
      return [{ affectedRows: 1 }];
    });
    return conn;
  }

  const sqlOf = (conn) => conn.query.mock.calls.map(([sql]) => sql).join(" ");

  it("gifting to a SteamID decrements and grants vip to the recipient", async () => {
    const conn = redeemConnection({ balance: 3 });
    pool.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post("/vip/gift-token/redeem")
      .send({ fromSteamid: STEAMID, targetSteamid: GIFT_TO })
      .expect(200);

    expect(res.body).toMatchObject({
      success: true,
      from: STEAMID,
      grantedTo: GIFT_TO,
      pendingGiftId: null,
      remainingTokens: 2,
    });
    expect(sqlOf(conn)).toContain("gift_tokens = gift_tokens - 1");
    // grantBaseVip ran against the same connection
    expect(sqlOf(conn)).toContain("INSERT IGNORE INTO player_meta");
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });

  it("gifting to an email records a pending gift instead", async () => {
    const conn = redeemConnection({ balance: 1, insertId: 42 });
    pool.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post("/vip/gift-token/redeem")
      .send({ fromSteamid: STEAMID, targetEmail: "Someone@Example.COM" })
      .expect(200);

    expect(res.body.grantedTo).toBeNull();
    expect(res.body.pendingGiftId).toBe(42);
    expect(res.body.remainingTokens).toBe(0);

    const insert = conn.query.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO pending_gifts"),
    );
    // the address is normalised before it is stored
    expect(insert[1]).toEqual(["someone@example.com", STEAMID]);
    expect(sqlOf(conn)).not.toContain("INSERT IGNORE INTO player_meta");
  });

  it("refuses with 400 and rolls back when the balance is zero", async () => {
    const conn = redeemConnection({ balance: 0 });
    pool.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post("/vip/gift-token/redeem")
      .send({ fromSteamid: STEAMID, targetSteamid: GIFT_TO })
      .expect(400);

    expect(res.body.error).toBe("No gift tokens available");
    expect(sqlOf(conn)).not.toContain("gift_tokens = gift_tokens - 1");
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });

  it("treats a missing sender row as no tokens", async () => {
    const conn = redeemConnection({ balance: null });
    pool.getConnection.mockResolvedValue(conn);

    await request(app)
      .post("/vip/gift-token/redeem")
      .send({ fromSteamid: STEAMID, targetSteamid: GIFT_TO })
      .expect(400);

    expect(conn.rollback).toHaveBeenCalled();
  });

  it("rejects bad input before opening a connection", async () => {
    await request(app)
      .post("/vip/gift-token/redeem")
      .send({ fromSteamid: "nope", targetSteamid: GIFT_TO })
      .expect(400);
    await request(app)
      .post("/vip/gift-token/redeem")
      .send({ fromSteamid: STEAMID })
      .expect(400);
    const self = await request(app)
      .post("/vip/gift-token/redeem")
      .send({ fromSteamid: STEAMID, targetSteamid: STEAMID })
      .expect(400);

    expect(self.body.error).toBe("Cannot gift to self");
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  it("rolls back, releases and 500s when a write throws", async () => {
    const conn = redeemConnection({ balance: 2 });
    conn.query.mockImplementation(async (sql) => {
      if (sql.includes("SELECT gift_tokens")) return [[{ gift_tokens: 2 }]];
      throw new Error("write failed");
    });
    pool.getConnection.mockResolvedValue(conn);

    await request(app)
      .post("/vip/gift-token/redeem")
      .send({ fromSteamid: STEAMID, targetSteamid: GIFT_TO })
      .expect(500);

    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });
});
