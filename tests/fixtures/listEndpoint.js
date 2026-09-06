/**
 * Drives a paginated list endpoint against an empty result set.
 *
 * These endpoints answer from two queries: a COUNT, then the page of rows. Both
 * carry the WHERE, only the rows query carries the ORDER BY and LIMIT. Several
 * run a lookup ahead of those - the map or server the records belong to, or a
 * tableExists probe - which shifts the call indexes; pass those rows as
 * `probes` so a filter test can name the query it means instead of an index.
 */
const request = require("supertest");

async function driveList(app, mockPool, path, { probes = [] } = {}) {
  for (const rows of probes) {
    mockPool.query.mockResolvedValueOnce([rows]);
  }
  mockPool.query
    .mockResolvedValueOnce([[{ total: 0 }]])
    .mockResolvedValueOnce([[]]);

  await request(app).get(path).expect(200);

  const calls = mockPool.query.mock.calls;
  return {
    countQuery: calls[probes.length],
    rowsQuery: calls[probes.length + 1],
  };
}

module.exports = { driveList };
