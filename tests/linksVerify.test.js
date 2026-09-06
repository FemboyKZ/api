/**
 * Characterization tests for the email verification flow.
 *
 * The notable behaviour is the "already linked" path:
 * it consumes the token and COMMITS rather than rolling back, so the token cannot be retried.
 */
const request = require("supertest");
const express = require("express");
const crypto = require("crypto");

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
const linksRouter = require("../src/api/links");

const app = express();
app.use(express.json());
app.use("/links", linksRouter);

const STEAMID = "76561198000000001";
const OTHER = "76561198000000002";
const TOKEN = "a-verification-token";
const hashed = crypto.createHash("sha256").update(TOKEN).digest("hex");

const hourFromNow = () => new Date(Date.now() + 3600e3).toISOString();
const hourAgo = () => new Date(Date.now() - 3600e3).toISOString();

/**
 * @param verification row from player_email_verifications, or null
 * @param takenBy steamid already holding the email, or null
 * @param currentEmail the player's existing email, or null
 */
function verifyConnection({
  verification,
  takenBy = null,
  currentEmail = null,
}) {
  const conn = {
    beginTransaction: jest.fn().mockResolvedValue(),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
    query: jest.fn(),
  };
  conn.query.mockImplementation(async (sql) => {
    if (sql.includes("FROM player_email_verifications")) {
      return [verification ? [verification] : []];
    }
    if (sql.includes("AND steamid <> ?")) {
      return [takenBy ? [{ steamid: takenBy }] : []];
    }
    if (sql.includes("SELECT email FROM player_meta")) {
      return [currentEmail === null ? [] : [{ email: currentEmail }]];
    }
    if (sql.includes("FROM pending_gifts")) return [[]];
    return [{ affectedRows: 1, insertId: 1 }];
  });
  return conn;
}

const valid = {
  id: 7,
  steamid: STEAMID,
  email: "user@example.com",
  expires_at: hourFromNow(),
  consumed_at: null,
};

/** Rows written to player_contact_history, as [steamid, type, value, action, note]. */
const contactLogs = (conn) =>
  conn.query.mock.calls
    .filter(([sql]) => sql.includes("INSERT INTO player_contact_history"))
    .map(([, params]) => params);

const sqlOf = (conn) => conn.query.mock.calls.map(([sql]) => sql).join(" | ");

beforeEach(() => jest.clearAllMocks());

describe("POST /links/email/verify", () => {
  it("rejects a missing token before opening a connection", async () => {
    await request(app).post("/links/email/verify").send({}).expect(400);
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  it("looks the token up by hash, never in the clear", async () => {
    const conn = verifyConnection({ verification: valid });
    pool.getConnection.mockResolvedValue(conn);

    await request(app)
      .post("/links/email/verify")
      .send({ token: TOKEN })
      .expect(200);

    const lookup = conn.query.mock.calls.find(([sql]) =>
      sql.includes("FROM player_email_verifications"),
    );
    expect(lookup[1]).toEqual([hashed]);
  });

  it("links the email, consumes the token and redeems pending gifts", async () => {
    const conn = verifyConnection({ verification: valid });
    pool.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post("/links/email/verify")
      .send({ token: TOKEN })
      .expect(200);

    expect(res.body).toMatchObject({
      success: true,
      steamid: STEAMID,
      email: "user@example.com",
    });
    expect(sqlOf(conn)).toContain("INSERT INTO player_meta");
    expect(sqlOf(conn)).toContain("SET consumed_at = CURRENT_TIMESTAMP");
    expect(contactLogs(conn)).toContainEqual([
      STEAMID,
      "email",
      "user@example.com",
      "linked",
      null,
    ]);
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });

  it("logs the previous address as replaced when one existed", async () => {
    const conn = verifyConnection({
      verification: valid,
      currentEmail: "old@example.com",
    });
    pool.getConnection.mockResolvedValue(conn);

    await request(app)
      .post("/links/email/verify")
      .send({ token: TOKEN })
      .expect(200);

    expect(contactLogs(conn)).toContainEqual([
      STEAMID,
      "email",
      "old@example.com",
      "replaced",
      null,
    ]);
  });

  it("404s and rolls back on an unknown token", async () => {
    const conn = verifyConnection({ verification: null });
    pool.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post("/links/email/verify")
      .send({ token: TOKEN })
      .expect(404);

    expect(res.body.error).toBe("Invalid token");
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("409s and rolls back on a token already used", async () => {
    const conn = verifyConnection({
      verification: { ...valid, consumed_at: new Date().toISOString() },
    });
    pool.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post("/links/email/verify")
      .send({ token: TOKEN })
      .expect(409);

    expect(res.body.error).toBe("Token already used");
    expect(conn.rollback).toHaveBeenCalled();
  });

  it("410s and rolls back on an expired token", async () => {
    const conn = verifyConnection({
      verification: { ...valid, expires_at: hourAgo() },
    });
    pool.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post("/links/email/verify")
      .send({ token: TOKEN })
      .expect(410);

    expect(res.body.error).toBe("Token expired");
    expect(conn.rollback).toHaveBeenCalled();
  });

  it("burns the token and COMMITS when the email belongs to someone else", async () => {
    const conn = verifyConnection({ verification: valid, takenBy: OTHER });
    pool.getConnection.mockResolvedValue(conn);

    const res = await request(app)
      .post("/links/email/verify")
      .send({ token: TOKEN })
      .expect(409);

    expect(res.body.error).toBe("Email already linked to another account");
    // the refusal is recorded and the token consumed, so it cannot be retried
    expect(contactLogs(conn)).toContainEqual([
      STEAMID,
      "email",
      "user@example.com",
      "blocked",
      `already linked to ${OTHER}`,
    ]);
    expect(sqlOf(conn)).toContain("SET consumed_at = CURRENT_TIMESTAMP");
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.rollback).not.toHaveBeenCalled();
    // and the email is not linked
    expect(sqlOf(conn)).not.toContain("INSERT INTO player_meta");
  });

  it("rolls back, releases and 500s when a write throws", async () => {
    const conn = verifyConnection({ verification: valid });
    conn.query.mockImplementation(async (sql) => {
      if (sql.includes("FROM player_email_verifications")) return [[valid]];
      throw new Error("write failed");
    });
    pool.getConnection.mockResolvedValue(conn);

    await request(app)
      .post("/links/email/verify")
      .send({ token: TOKEN })
      .expect(500);

    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });
});
