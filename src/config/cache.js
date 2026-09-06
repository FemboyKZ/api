/**
 * Cache lifetimes, named by how fast the underlying data moves.
 */

const CACHE_TTL = {
  /** Live state that changes between requests: who is online right now. */
  LIVE: 10,

  /** Near-live feeds where a few seconds of staleness is invisible. */
  FRESH: 30,

  /** The default for list and detail reads backed by our own tables. */
  STANDARD: 60,

  /** Aggregates and rollups that are recomputed on a schedule. */
  AGGREGATE: 300,

  /** Rankings and leaderboards, expensive to build and slow to shift. */
  RANKING: 600,

  /** Effectively immutable: a finished record, or a world record snapshot. */
  IMMUTABLE: 3600,
};

module.exports = { CACHE_TTL };
