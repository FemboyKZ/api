/**
 * Currency Service
 *
 * Converts arbitrary Ko-fi payment amounts to EUR (tiers are defined in EUR).
 * Rates are fetched from a free exchange-rate API (base = EUR), cached in
 * memory and persisted to the `settings` table, and refreshed at most once per REFRESH_MS.
 * A static fallback table covers the common case when the API is
 * unreachable so webhook processing never hard-fails on FX.
 *
 * Rate convention: rates[CUR] = units of CUR per 1 EUR.
 *   amountEur = amount / rates[CUR]
 */

const axios = require("axios");
const pool = require("../db");
const logger = require("../utils/logger");

const SETTING_KEY = "fx_rates_eur";
const REFRESH_MS = 12 * 60 * 60 * 1000; // 12h
const API_URL =
  process.env.FX_API_URL || "https://open.er-api.com/v6/latest/EUR";

// Units per 1 EUR. Conservative static fallback (16/06/2026),
// only used when no cached/fetched rate is available for a currency.
const FALLBACK_RATES = {
  EUR: 1,
  AED: 4.259058,
  AFN: 73.219968,
  ALL: 95.022138,
  AMD: 427.456212,
  ANG: 2.075892,
  AOA: 1109.104556,
  ARS: 1659.332762,
  AUD: 1.640106,
  AWG: 2.075892,
  AZN: 1.97325,
  BAM: 1.95583,
  BBD: 2.319433,
  BDT: 142.426664,
  BGN: 1.95583,
  BHD: 0.436053,
  BIF: 3468.366238,
  BMD: 1.159716,
  BND: 1.487627,
  BOB: 8.024353,
  BRL: 5.862271,
  BSD: 1.159716,
  BTN: 109.888943,
  BWP: 16.278767,
  BYN: 3.204144,
  BZD: 2.319433,
  CAD: 1.621937,
  CDF: 2679.353383,
  CHF: 0.921054,
  CLF: 0.02641,
  CLP: 1043.896605,
  CNH: 7.83657,
  CNY: 7.847661,
  COP: 4047.025096,
  CRC: 530.352454,
  CUP: 27.833191,
  CVE: 110.265,
  CZK: 24.143054,
  DJF: 206.105942,
  DKK: 7.463439,
  DOP: 68.156112,
  DZD: 154.436135,
  EGP: 58.449226,
  ERN: 17.395745,
  ETB: 185.709623,
  FJD: 2.583836,
  FKP: 0.864061,
  FOK: 7.463437,
  GBP: 0.864061,
  GEL: 3.084334,
  GGP: 0.864061,
  GHS: 12.898272,
  GIP: 0.864061,
  GMD: 86.151885,
  GNF: 10179.213723,
  GTQ: 8.843614,
  GYD: 242.913429,
  HKD: 9.08601,
  HNL: 31.027404,
  HRK: 7.5345,
  HTG: 151.704555,
  HUF: 350.408249,
  IDR: 20537.649484,
  ILS: 3.373858,
  IMP: 0.864061,
  INR: 109.889018,
  IQD: 1522.880342,
  IRR: 1597644.913583,
  ISK: 144.291894,
  JEP: 0.864061,
  JMD: 183.10415,
  JOD: 0.822239,
  JPY: 185.773219,
  KES: 150.303091,
  KGS: 101.550551,
  KHR: 4688.868421,
  KID: 1.640105,
  KMF: 491.96775,
  KRW: 1756.416916,
  KWD: 0.357013,
  KYD: 0.96643,
  KZT: 568.103678,
  LAK: 25515.109925,
  LBP: 103794.609489,
  LKR: 386.764728,
  LRD: 211.552688,
  LSL: 18.77887,
  LYD: 7.399684,
  MAD: 10.739375,
  MDL: 20.188476,
  MGA: 4876.501098,
  MKD: 61.6327,
  MMK: 2437.308097,
  MNT: 4175.555195,
  MOP: 9.358587,
  MRU: 46.484999,
  MUR: 54.674878,
  MVR: 17.940837,
  MWK: 2025.026731,
  MXN: 19.960894,
  MYR: 4.698661,
  MZN: 74.088842,
  NAD: 18.77887,
  NGN: 1568.571505,
  NIO: 42.70089,
  NOK: 11.048532,
  NPR: 175.822309,
  NZD: 1.988644,
  OMR: 0.445907,
  PAB: 1.159716,
  PEN: 3.937202,
  PGK: 5.079242,
  PHP: 70.059147,
  PKR: 322.847399,
  PLN: 4.246426,
  PYG: 7120.278095,
  QAR: 4.221367,
  RON: 5.236481,
  RSD: 117.420553,
  RUB: 84.23002,
  RWF: 1701.874256,
  SAR: 4.348936,
  SBD: 9.302025,
  SCR: 16.683559,
  SDG: 518.710335,
  SEK: 10.892592,
  SGD: 1.487628,
  SHP: 0.864061,
  SLE: 28.485281,
  SLL: 28484.69682,
  SOS: 663.60149,
  SRD: 43.457805,
  SSP: 5472.600626,
  STN: 24.5,
  SYP: 130.314725,
  SZL: 18.77887,
  THB: 37.760092,
  TJS: 10.795724,
  TMT: 4.06349,
  TND: 3.392682,
  TOP: 2.768058,
  TRY: 53.704159,
  TTD: 8.023009,
  TVD: 1.640105,
  TWD: 36.581227,
  TZS: 3022.075316,
  UAH: 52.043918,
  UGX: 4286.620053,
  USD: 1.159718,
  UYU: 46.938339,
  UZS: 13855.542874,
  VES: 687.698118,
  VND: 30276.282567,
  VUV: 137.661794,
  WST: 3.141858,
  XAF: 655.957,
  XCD: 3.131234,
  XCG: 2.075892,
  XDR: 0.848211,
  XOF: 655.957,
  XPF: 119.332,
  YER: 276.843114,
  ZAR: 18.778879,
  ZMW: 20.452975,
  ZWG: 31.0031,
  ZWL: 31.0031,
};

let cache = { rates: { ...FALLBACK_RATES }, fetchedAt: 0 };
let loadedFromDb = false;
let inflight = null;

/** Load last-known rates from the settings table once per process start. */
async function loadFromDb() {
  if (loadedFromDb) return;
  loadedFromDb = true;
  try {
    const [rows] = await pool.query(
      "SELECT setting_value FROM settings WHERE setting_key = ? LIMIT 1",
      [SETTING_KEY],
    );
    if (rows.length) {
      const parsed = JSON.parse(rows[0].setting_value);
      if (parsed.rates && parsed.fetchedAt) cache = parsed;
    }
  } catch (error) {
    logger.warn("Currency: failed to load cached rates", {
      error: error.message,
    });
  }
}

async function persistToDb() {
  try {
    await pool.query(
      `INSERT INTO settings (setting_key, setting_value)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP`,
      [SETTING_KEY, JSON.stringify(cache)],
    );
  } catch (error) {
    logger.warn("Currency: failed to persist rates", { error: error.message });
  }
}

/** Fetch fresh rates from the API. Best-effort, keeps old cache on failure. */
async function refresh() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await axios.get(API_URL, { timeout: 5000 });
      const rates = res.data?.rates;
      if (rates && rates.USD) {
        cache = { rates: { ...rates, EUR: 1 }, fetchedAt: Date.now() };
        await persistToDb();
        logger.debug("Currency: refreshed FX rates");
      } else {
        logger.warn("Currency: unexpected FX API response shape");
      }
    } catch (error) {
      logger.warn("Currency: FX refresh failed, using cached/fallback", {
        error: error.message,
      });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function ensureRates() {
  await loadFromDb();
  if (Date.now() - cache.fetchedAt > REFRESH_MS) {
    await refresh();
  }
}

/**
 * Convert an amount in `currency` to EUR.
 * @param {number|string} amount
 * @param {string} currency ISO code (e.g. "USD")
 * @returns {Promise<number>} amount in EUR, rounded to 2dp
 */
async function convertToEUR(amount, currency) {
  const value = parseFloat(amount) || 0;
  const cur = String(currency || "EUR").toUpperCase();
  if (cur === "EUR" || value === 0) return round2(value);

  await ensureRates();
  const rate = cache.rates[cur] || FALLBACK_RATES[cur];
  if (!rate) {
    logger.warn(`Currency: no rate for ${cur}, treating amount as EUR`, {
      amount: value,
    });
    return round2(value);
  }
  return round2(value / rate);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { convertToEUR, ensureRates };
