/**
 * Which pool a CS:GO tickrate maps to is a db concern, so it is tested here rather than through a router.
 *
 * kzLocal builds its lazy pools in a fixed order (cs2, csgo128, csgo64),
 * so handing each one a distinct marker lets us see which the selector returns.
 */
const mockOrder = ["cs2", "csgo128", "csgo64"];
let mockCreated = 0;

jest.mock("../src/db/poolFactory", () => ({
  createPool: jest.fn(),
  initPool: jest.fn(),
  createLazyPool: jest.fn(() => {
    const marker = mockOrder[mockCreated++];
    return { get: () => marker, set: jest.fn(), close: jest.fn() };
  }),
}));

const { getKzLocalCSGOPool } = require("../src/db/kzLocal");

describe("getKzLocalCSGOPool", () => {
  it('returns the 64 tick pool only for "64"', () => {
    expect(getKzLocalCSGOPool("64")).toBe("csgo64");
  });

  it("defaults to 128 tick for anything else", () => {
    expect(getKzLocalCSGOPool("128")).toBe("csgo128");
    expect(getKzLocalCSGOPool(undefined)).toBe("csgo128");
    expect(getKzLocalCSGOPool("nonsense")).toBe("csgo128");
    // A number is not what the query parser produces, so it must not match.
    expect(getKzLocalCSGOPool(64)).toBe("csgo128");
  });
});
