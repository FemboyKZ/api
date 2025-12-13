const { createPool, initPool, createLazyPool } = require("./poolFactory");
require("dotenv").config();

// ==================== POOL CONFIGURATIONS ====================

const kzLocalCS2Config = {
  host: process.env.KZ_LOCAL_CS2_DB_HOST || "localhost",
  port: process.env.KZ_LOCAL_CS2_DB_PORT || 3306,
  user: process.env.KZ_LOCAL_CS2_DB_USER || "kz_user",
  password: process.env.KZ_LOCAL_CS2_DB_PASSWORD || "kz_password",
  database: process.env.KZ_LOCAL_CS2_DB_NAME || "kz_records",
  connectionLimit: 10,
};

const kzLocalCSGO128Config = {
  host: process.env.KZ_LOCAL_CSGO128_DB_HOST || "localhost",
  port: process.env.KZ_LOCAL_CSGO128_DB_PORT || 3306,
  user: process.env.KZ_LOCAL_CSGO128_DB_USER || "kz_user",
  password: process.env.KZ_LOCAL_CSGO128_DB_PASSWORD || "kz_password",
  database: process.env.KZ_LOCAL_CSGO128_DB_NAME || "kz_records",
  connectionLimit: 10,
};

const kzLocalCSGO64Config = {
  host: process.env.KZ_LOCAL_CSGO64_DB_HOST || "localhost",
  port: process.env.KZ_LOCAL_CSGO64_DB_PORT || 3306,
  user: process.env.KZ_LOCAL_CSGO64_DB_USER || "kz_user",
  password: process.env.KZ_LOCAL_CSGO64_DB_PASSWORD || "kz_password",
  database: process.env.KZ_LOCAL_CSGO64_DB_NAME || "kz_records",
  connectionLimit: 10,
};

// ==================== LAZY POOL MANAGERS ====================

const cs2PoolManager = createLazyPool(() => createPool(kzLocalCS2Config));
const csgo128PoolManager = createLazyPool(() =>
  createPool(kzLocalCSGO128Config),
);
const csgo64PoolManager = createLazyPool(() => createPool(kzLocalCSGO64Config));

// ==================== POOL GETTERS ====================

function getKzLocalCS2Pool() {
  return cs2PoolManager.get();
}

function getKzLocalCSGO128Pool() {
  return csgo128PoolManager.get();
}

function getKzLocalCSGO64Pool() {
  return csgo64PoolManager.get();
}

function getAllKzLocalPools() {
  return {
    cs2: getKzLocalCS2Pool(),
    csgo128: getKzLocalCSGO128Pool(),
    csgo64: getKzLocalCSGO64Pool(),
  };
}

// ==================== INITIALIZATION ====================

async function initKzLocalCS2Database() {
  const pool = await initPool(kzLocalCS2Config, "KZ Local CS2");
  cs2PoolManager.set(pool);
  return pool;
}

async function initKzLocalCSGO128Database() {
  const pool = await initPool(kzLocalCSGO128Config, "KZ Local CSGO128");
  csgo128PoolManager.set(pool);
  return pool;
}

async function initKzLocalCSGO64Database() {
  const pool = await initPool(kzLocalCSGO64Config, "KZ Local CSGO64");
  csgo64PoolManager.set(pool);
  return pool;
}

async function initAllKzLocalDatabases() {
  await initKzLocalCS2Database();
  await initKzLocalCSGO128Database();
  await initKzLocalCSGO64Database();
}

// ==================== CLEANUP ====================

async function closeKzLocalCS2Database() {
  await cs2PoolManager.close("KZ Local CS2");
}

async function closeKzLocalCSGO128Database() {
  await csgo128PoolManager.close("KZ Local CSGO128");
}

async function closeKzLocalCSGO64Database() {
  await csgo64PoolManager.close("KZ Local CSGO64");
}

async function closeAllKzLocalDatabases() {
  await closeKzLocalCS2Database();
  await closeKzLocalCSGO128Database();
  await closeKzLocalCSGO64Database();
}

module.exports = {
  // Pool getters
  getAllKzLocalPools,
  getKzLocalCS2Pool,
  getKzLocalCSGO128Pool,
  getKzLocalCSGO64Pool,
  // Initialization
  initAllKzLocalDatabases,
  initKzLocalCS2Database,
  initKzLocalCSGO128Database,
  initKzLocalCSGO64Database,
  // Cleanup
  closeAllKzLocalDatabases,
  closeKzLocalCS2Database,
  closeKzLocalCSGO128Database,
  closeKzLocalCSGO64Database,
};
