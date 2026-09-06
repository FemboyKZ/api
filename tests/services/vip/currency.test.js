/**
 * FX conversion for Ko-fi payments.
 *
 * VIP tiers are thresholds in EUR, so this is the last step that decides how much a payment is worth.
 * Two properties matter more than the arithmetic:
 * a payment must never be converted at a rate the service only guessed at, and an FX outage must never fail the webhook -
 * services/vip/kofi.js awaits this inline, so a throw here would 500 a payment that has already left the buyer's account.
 *
 * The module caches rates in `let`s and reads FX_API_URL at load,
 * so each test re-requires it through load() to get a clean cache.
 */
jest.mock("../../../src/db", () => ({ query: jest.fn() }));

jest.mock("../../../src/utils/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("axios", () => ({ get: jest.fn() }));

const API_URL = "https://fx.test/latest/EUR";

// Units per 1 EUR, from the module's static fallback table.
const USD_FALLBACK = 1.159718;
const GBP_FALLBACK = 0.864061;

const originalEnv = process.env;

let currency, pool, axios, logger;
let settingsRow;

/** Re-require the service with an empty rate cache. */
function load() {
  jest.resetModules();
  process.env = { ...originalEnv, FX_API_URL: API_URL };

  currency = require("../../../src/services/vip/currency");
  pool = require("../../../src/db");
  axios = require("axios");
  logger = require("../../../src/utils/logger");

  settingsRow = null;
  pool.query.mockImplementation(async (sql) => {
    if (sql.includes("FROM settings"))
      return [settingsRow ? [settingsRow] : []];
    return [{ affectedRows: 1 }];
  });
  axios.get.mockResolvedValue({ data: { rates: { USD: 2, GBP: 4 } } });
}

/** A settings row holding persisted rates, fresh or stale as asked. */
const persisted = (rates, { stale = false } = {}) => ({
  setting_value: JSON.stringify({
    rates,
    fetchedAt: stale ? 1 : Date.now(),
  }),
});

const persistCall = () =>
  pool.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO settings"));

beforeEach(() => {
  jest.clearAllMocks();
  load();
});

afterAll(() => {
  process.env = originalEnv;
});

describe("convertToEUR", () => {
  // EUR needs no rate at all, so it must not reach for one.
  describe("answers without consulting a rate", () => {
    it.each([
      ["EUR", "10.00", "EUR", 10],
      ["lower-case eur", "10.00", "eur", 10],
      ["a missing currency", "10.00", undefined, 10],
      ["a null currency", "10.00", null, 10],
      ["a zero amount", "0", "USD", 0],
      // parseFloat("abc") is NaN, which the service floors to 0.
      ["an unparseable amount", "abc", "USD", 0],
    ])("returns %s as-is", async (_name, amount, cur, expected) => {
      await expect(currency.convertToEUR(amount, cur)).resolves.toBe(expected);

      expect(axios.get).not.toHaveBeenCalled();
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe("converting", () => {
    it("divides by units-per-EUR rather than multiplying", async () => {
      // USD is worth less than EUR, so the EUR figure must come out smaller.
      const eur = await currency.convertToEUR("10.00", "USD");

      expect(eur).toBe(5);
      expect(eur).toBeLessThan(10);
    });

    it("upper-cases the currency code before looking it up", async () => {
      await expect(currency.convertToEUR("10.00", "usd")).resolves.toBe(5);
    });

    it("accepts the amount as a number as well as a string", async () => {
      await expect(currency.convertToEUR(10, "USD")).resolves.toBe(5);
    });

    it("rounds to cents", async () => {
      axios.get.mockResolvedValue({ data: { rates: { USD: 3 } } });

      // 10 / 3 = 3.333..., and money is stored to 2dp.
      await expect(currency.convertToEUR("10.00", "USD")).resolves.toBe(3.33);
    });

    // Inventing a rate would silently mis-credit; treating it as EUR is the conservative wrong answer, and it gets logged.
    it("treats an unknown currency as EUR and says so", async () => {
      const eur = await currency.convertToEUR("10.00", "XYZ");

      expect(eur).toBe(10);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("no rate for XYZ"),
        expect.anything(),
      );
    });
  });

  describe("where the rate comes from", () => {
    it("uses rates persisted by an earlier run", async () => {
      settingsRow = persisted({ USD: 4 });

      await expect(currency.convertToEUR("10.00", "USD")).resolves.toBe(2.5);
    });

    // Rates are good for 12h; a recent persisted set means no outbound call.
    it("does not call the API while the cached rates are fresh", async () => {
      settingsRow = persisted({ USD: 4 });

      await currency.convertToEUR("10.00", "USD");

      expect(axios.get).not.toHaveBeenCalled();
    });

    it("refreshes once the cached rates have aged out", async () => {
      settingsRow = persisted({ USD: 4 }, { stale: true });

      await expect(currency.convertToEUR("10.00", "USD")).resolves.toBe(5);
      expect(axios.get).toHaveBeenCalledWith(API_URL, expect.anything());
    });

    it("reads the settings table only once per process", async () => {
      await currency.convertToEUR("10.00", "USD");
      await currency.convertToEUR("20.00", "USD");

      const reads = pool.query.mock.calls.filter(([sql]) =>
        sql.includes("FROM settings"),
      );
      expect(reads).toHaveLength(1);
    });

    it("persists freshly fetched rates for the next process", async () => {
      await currency.convertToEUR("10.00", "USD");

      const [, params] = persistCall();
      expect(JSON.parse(params[1]).rates).toMatchObject({ USD: 2, EUR: 1 });
    });

    // The API is quoted against EUR, so EUR is 1 by definition;
    // letting the feed assert otherwise would rescale every conversion at once.
    it("pins EUR to 1 whatever the feed says", async () => {
      axios.get.mockResolvedValue({
        data: { rates: { USD: 2, EUR: 1.23 } },
      });

      await currency.convertToEUR("10.00", "USD");

      expect(JSON.parse(persistCall()[1][1]).rates.EUR).toBe(1);
    });

    it("shares one request between concurrent callers", async () => {
      let deliver;
      axios.get.mockReturnValue(
        new Promise((resolve) => {
          deliver = resolve;
        }),
      );

      const both = Promise.all([
        currency.ensureRates(),
        currency.ensureRates(),
      ]);
      deliver({ data: { rates: { USD: 2 } } });
      await both;

      expect(axios.get).toHaveBeenCalledTimes(1);
    });
  });

  // Every failure below has to leave a usable rate behind,
  // because the caller is mid-webhook and a throw would tell Ko-fi to resend a recorded payment.
  describe("surviving a broken rate source", () => {
    it("falls back to the static table when the API is down", async () => {
      axios.get.mockRejectedValue(new Error("ENOTFOUND"));

      const eur = await currency.convertToEUR("10.00", "USD");

      expect(eur).toBe(round2(10 / USD_FALLBACK));
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("FX refresh failed"),
        expect.anything(),
      );
    });

    // The cache starts seeded from the static table, so the case above never reaches the fallback lookup itself.
    // A feed that answers with a partial rate set does:
    // the currency it omits has to come off the static table rather than passing through at par as though it were EUR.
    it("falls back to the static table for a currency the feed omits", async () => {
      axios.get.mockResolvedValue({ data: { rates: { USD: 2 } } });

      await expect(currency.convertToEUR("10.00", "GBP")).resolves.toBe(
        round2(10 / GBP_FALLBACK),
      );
    });

    it.each([
      ["a response with no rates", { data: {} }],
      ["rates missing the USD anchor", { data: { rates: { GBP: 4 } } }],
      ["an empty body", {}],
    ])("keeps the previous rates given %s", async (_name, response) => {
      axios.get.mockResolvedValue(response);

      await expect(currency.convertToEUR("10.00", "USD")).resolves.toBe(
        round2(10 / USD_FALLBACK),
      );
      expect(persistCall()).toBeUndefined();
    });

    it.each([
      ["unparseable JSON", { setting_value: "{not json" }],
      ["a row with no rates", { setting_value: JSON.stringify({ x: 1 }) }],
      [
        "a row with no fetchedAt",
        { setting_value: JSON.stringify({ rates: { USD: 4 } }) },
      ],
    ])("ignores %s in the settings table", async (_name, row) => {
      settingsRow = row;

      await expect(currency.convertToEUR("10.00", "USD")).resolves.toBe(5);
    });

    it("still converts when the settings table cannot be read", async () => {
      pool.query.mockRejectedValue(new Error("table missing"));

      await expect(currency.convertToEUR("10.00", "USD")).resolves.toBe(5);
    });

    it("still converts when the rates cannot be persisted", async () => {
      pool.query.mockImplementation(async (sql) => {
        if (sql.includes("INSERT INTO settings")) throw new Error("read-only");
        return [[]];
      });

      await expect(currency.convertToEUR("10.00", "USD")).resolves.toBe(5);
    });
  });
});

function round2(n) {
  return Math.round(n * 100) / 100;
}
