/**
 * Ko-fi webhook ingest.
 *
 * Every branch here decides whether real money reaches the right account,
 * so the cases below are grouped by the way each one can silently go wrong:
 * replayed webhooks double-crediting, a payment resolving to nobody or to the wrong player,
 * and a renewal that inserts but fails to credit.
 *
 * WEBHOOK_ENABLED and VERIFICATION_TOKEN are read once at module load,
 * so each test re-requires the service through load() rather than mutating env in place.
 */
jest.mock("../../../src/db", () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

jest.mock("../../../src/utils/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../../../src/services/vip/contacts", () => ({
  findSteamIDByEmail: jest.fn(),
}));

jest.mock("../../../src/services/vip/currency", () => ({
  convertToEUR: jest.fn(),
}));

jest.mock("../../../src/services/vip/entitlements", () => ({
  creditSpend: jest.fn(),
}));

jest.mock("axios", () => ({ post: jest.fn() }));

const TOKEN = "kofi-verification-token";
const BUYER = "76561198000000001";
const INSERT_ID = 42;

const originalEnv = process.env;

let kofi, pool, axios, contacts, currency, entitlements;
let existingTransactions;

/**
 * Re-require the service with the given env, since it captures its config at load.
 * The module and its mocked collaborators land in the outer lets.
 */
function load({ token = TOKEN, enabled, discord } = {}) {
  jest.resetModules();
  process.env = { ...originalEnv, KOFI_VERIFICATION_TOKEN: token };
  if (enabled !== undefined) process.env.KOFI_WEBHOOK_ENABLED = enabled;
  if (discord !== undefined) process.env.KOFI_DISCORD_WEBHOOK = discord;

  kofi = require("../../../src/services/vip/kofi");
  pool = require("../../../src/db");
  axios = require("axios");
  contacts = require("../../../src/services/vip/contacts");
  currency = require("../../../src/services/vip/currency");
  entitlements = require("../../../src/services/vip/entitlements");

  existingTransactions = [];
  pool.query.mockImplementation(async (sql) => {
    if (sql.includes("SELECT id FROM kofi_transactions")) {
      return [existingTransactions];
    }
    if (sql.includes("INSERT INTO kofi_transactions")) {
      return [{ insertId: INSERT_ID }];
    }
    return [[]];
  });
  pool.getConnection.mockImplementation(async () => connection());
  contacts.findSteamIDByEmail.mockResolvedValue(null);
  currency.convertToEUR.mockImplementation(async (amount) => Number(amount));
  entitlements.creditSpend.mockResolvedValue(undefined);
  axios.post.mockResolvedValue({ status: 200 });
}

function connection() {
  return {
    beginTransaction: jest.fn().mockResolvedValue(),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
    query: jest.fn().mockResolvedValue([{ insertId: INSERT_ID }]),
  };
}

/** A valid webhook payload; callers override only the field under test. */
const payload = (over = {}) => ({
  verification_token: TOKEN,
  message_id: "msg-1",
  type: "Donation",
  from_name: "Someone",
  amount: "10.00",
  currency: "EUR",
  ...over,
});

/**
 * The kofi_transactions INSERT keyed by column name,
 * read off the statement's own column list so a reordering of the parameters cannot quietly pass.
 */
function insertedRow(query) {
  const call = query.mock.calls.find(([sql]) =>
    sql.includes("INSERT INTO kofi_transactions"),
  );
  if (!call) return null;
  const columns = call[0]
    .match(/\(([^)]*)\)\s*VALUES/)[1]
    .split(",")
    .map((c) => c.trim());
  return Object.fromEntries(columns.map((c, i) => [c, call[1][i]]));
}

/** The connection handed out for the auto-claim transaction. */
const usedConnection = () => pool.getConnection.mock.results[0].value;

beforeEach(() => {
  jest.clearAllMocks();
  load();
});

afterAll(() => {
  process.env = originalEnv;
});

describe("extractSteamID", () => {
  it.each([
    ["a bare SteamID64", `tip from ${BUYER}`, BUYER],
    ["a profile URL", "steamcommunity.com/profiles/76561198000000001", BUYER],
    ["a SteamID2", "for STEAM_0:1:12345 thanks", "76561197960290419"],
    ["a SteamID3", "for [U:1:24691] thanks", "76561197960290419"],
    ["an id with surrounding prose", `hi!! ${BUYER} <- thats me`, BUYER],
  ])("reads %s out of the message", (_name, message, expected) => {
    expect(kofi.extractSteamID(message)).toBe(expected);
  });

  it.each([
    ["no id at all", "thanks for the server!"],
    ["an empty string", ""],
    ["a number", 12345],
    ["null", null],
    // 12 digits, not 17 - close enough to look like one but not a real account.
    ["a too-short id", "765611980000"],
  ])("returns null for %s", (_name, message) => {
    expect(kofi.extractSteamID(message)).toBeNull();
  });
});

describe("processKofiWebhook", () => {
  // Each of these refuses before touching the database, so a misconfigured or forged call cannot record a payment.
  describe("refuses before recording anything", () => {
    it("503s when the webhook is disabled", async () => {
      load({ enabled: "false" });

      const result = await kofi.processKofiWebhook(payload());

      expect(result.status).toBe(503);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it("401s on a mismatched verification token", async () => {
      const result = await kofi.processKofiWebhook(
        payload({ verification_token: "wrong" }),
      );

      expect(result.status).toBe(401);
      expect(pool.query).not.toHaveBeenCalled();
    });

    // Enabled with no token configured must fail closed, not wave everything through.
    it("401s when no token is configured at all", async () => {
      load({ token: "", enabled: "true" });

      const result = await kofi.processKofiWebhook(
        payload({ verification_token: "" }),
      );

      expect(result.status).toBe(401);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it("400s when message_id is missing", async () => {
      const result = await kofi.processKofiWebhook(
        payload({ message_id: undefined }),
      );

      expect(result.status).toBe(400);
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  // Ko-fi retries on any non-200, so the same message_id can arrive repeatedly.
  describe("replayed webhooks", () => {
    it("acks a message_id it has already recorded without inserting again", async () => {
      existingTransactions = [{ id: 7 }];

      const result = await kofi.processKofiWebhook(payload());

      expect(result).toEqual({
        status: 200,
        body: { success: true, duplicate: true },
      });
      expect(insertedRow(pool.query)).toBeNull();
      expect(entitlements.creditSpend).not.toHaveBeenCalled();
    });

    it("does not credit a replayed subscription renewal", async () => {
      existingTransactions = [{ id: 7 }];

      await kofi.processKofiWebhook(
        payload({ type: "Subscription", message: BUYER }),
      );

      expect(pool.getConnection).not.toHaveBeenCalled();
      expect(entitlements.creditSpend).not.toHaveBeenCalled();
    });
  });

  describe("resolving the buyer", () => {
    it("takes the SteamID from the checkout message", async () => {
      const result = await kofi.processKofiWebhook(
        payload({ message: `for ${BUYER}` }),
      );

      expect(result.body.steamid).toBe(BUYER);
      expect(insertedRow(pool.query)).toMatchObject({
        steamid: BUYER,
        status: "matched",
      });
      expect(contacts.findSteamIDByEmail).not.toHaveBeenCalled();
    });

    it("falls back to a verified linked email when the message has no id", async () => {
      contacts.findSteamIDByEmail.mockResolvedValue({ steamid: BUYER });

      const result = await kofi.processKofiWebhook(
        payload({ message: "thanks!", email: "buyer@example.com" }),
      );

      expect(contacts.findSteamIDByEmail).toHaveBeenCalledWith(
        "buyer@example.com",
      );
      expect(result.body.steamid).toBe(BUYER);
      expect(insertedRow(pool.query)).toMatchObject({ status: "matched" });
    });

    // Crediting the wrong player is worse than crediting nobody:
    // an unmatched payment can still be claimed by hand, a misdirected one cannot be undone.
    it("leaves a payment unmatched when the email maps to several accounts", async () => {
      contacts.findSteamIDByEmail.mockResolvedValue({
        ambiguous: true,
        count: 2,
      });

      const result = await kofi.processKofiWebhook(
        payload({ email: "shared@example.com" }),
      );

      expect(result.body.steamid).toBeNull();
      expect(insertedRow(pool.query)).toMatchObject({
        steamid: null,
        status: "pending",
        claim_status: "unclaimed",
      });
    });

    it("records an unresolvable payment as pending rather than dropping it", async () => {
      const result = await kofi.processKofiWebhook(
        payload({ message: "no id here", email: "stranger@example.com" }),
      );

      expect(result.status).toBe(200);
      expect(insertedRow(pool.query)).toMatchObject({
        steamid: null,
        status: "pending",
      });
    });
  });

  describe("claiming", () => {
    // A one-off tip is claimed by hand later, even when the buyer is known.
    it("leaves a one-off donation unclaimed and uncredited", async () => {
      await kofi.processKofiWebhook(payload({ message: BUYER }));

      expect(insertedRow(pool.query)).toMatchObject({
        claim_status: "unclaimed",
        beneficiary_steamid: null,
        claimed_at: null,
      });
      expect(entitlements.creditSpend).not.toHaveBeenCalled();
    });

    it.each([
      ["type is Subscription", { type: "Subscription" }],
      ["the subscription flag is set", { is_subscription_payment: true }],
    ])("auto-claims to the buyer when %s", async (_name, over) => {
      await kofi.processKofiWebhook(payload({ message: BUYER, ...over }));

      const conn = await usedConnection();
      expect(insertedRow(conn.query)).toMatchObject({
        claim_status: "claimed",
        beneficiary_steamid: BUYER,
      });
      expect(entitlements.creditSpend).toHaveBeenCalledWith(conn, BUYER, 10);
      expect(conn.commit).toHaveBeenCalled();
      expect(conn.release).toHaveBeenCalled();
    });

    // Without a resolved buyer there is nobody to credit, so it waits to be claimed.
    it("does not auto-claim a subscription from an unresolved buyer", async () => {
      await kofi.processKofiWebhook(
        payload({ type: "Subscription", message: "no id" }),
      );

      expect(pool.getConnection).not.toHaveBeenCalled();
      expect(entitlements.creditSpend).not.toHaveBeenCalled();
      expect(insertedRow(pool.query)).toMatchObject({
        claim_status: "unclaimed",
      });
    });

    // The insert and the credit share one transaction:
    // a half-applied renewal would leave a recorded payment that never reached the player's tier.
    it("rolls back and rethrows when crediting fails", async () => {
      entitlements.creditSpend.mockRejectedValue(new Error("credit failed"));

      await expect(
        kofi.processKofiWebhook(
          payload({ type: "Subscription", message: BUYER }),
        ),
      ).rejects.toThrow("credit failed");

      const conn = await usedConnection();
      expect(conn.rollback).toHaveBeenCalled();
      expect(conn.commit).not.toHaveBeenCalled();
      expect(conn.release).toHaveBeenCalled();
    });
  });

  describe("amounts", () => {
    // Tiers are thresholds in EUR, so the converted figure is what gets stored.
    it("stores the converted amount, not the amount Ko-fi sent", async () => {
      currency.convertToEUR.mockResolvedValue(8.37);

      const result = await kofi.processKofiWebhook(
        payload({ amount: "10.00", currency: "USD" }),
      );

      expect(currency.convertToEUR).toHaveBeenCalledWith(10, "USD");
      expect(result.body.amountEur).toBe(8.37);
      expect(insertedRow(pool.query)).toMatchObject({
        amount: 10,
        amount_eur: 8.37,
      });
    });

    it("credits the converted amount on an auto-claimed renewal", async () => {
      currency.convertToEUR.mockResolvedValue(8.37);

      await kofi.processKofiWebhook(
        payload({ type: "Subscription", message: BUYER, currency: "USD" }),
      );

      const conn = await usedConnection();
      expect(entitlements.creditSpend).toHaveBeenCalledWith(conn, BUYER, 8.37);
    });
  });

  describe("Discord notification", () => {
    it("still acks the webhook when the notification fails", async () => {
      load({ discord: "https://discord.test/hook" });
      axios.post.mockRejectedValue(new Error("discord down"));

      const result = await kofi.processKofiWebhook(payload());

      expect(result.status).toBe(200);
      expect(axios.post).toHaveBeenCalled();
    });

    it("sends nothing when no Discord webhook is configured", async () => {
      await kofi.processKofiWebhook(payload());

      expect(axios.post).not.toHaveBeenCalled();
    });
  });
});
