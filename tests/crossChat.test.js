const fs = require("fs");

// Mock the DB pool so persist() is a no-op.
jest.mock("../src/db", () => ({ query: jest.fn().mockResolvedValue([{}]) }));
jest.mock("../src/services/comms/websocket", () => ({
  emitChatMessage: jest.fn(),
}));

const {
  addMessage,
  sanitizeMessage,
  loadServerLookup,
  _ring,
} = require("../src/services/comms/chat");

const SERVER = { ip: "10.0.0.1", port: 27015 };

// A high surrogate not followed by a low one (or vice versa):
// invalid UTF-16 that serializes to JSON the game plugins refuse to parse.
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

beforeAll(() => {
  // loadServerLookup reads config/servers.json relative to cwd;
  // stub the read so the test owns the registry instead of depending on production config.
  jest
    .spyOn(fs, "readFileSync")
    .mockReturnValue(
      JSON.stringify([
        { ...SERVER, alias: "TEST #1", game: "csgo", region: "eu" },
      ]),
    );
  loadServerLookup();
  fs.readFileSync.mockRestore();
});

beforeEach(() => {
  _ring.length = 0;
});

describe("cross-chat ingest", () => {
  it("keeps the sender's muted flag on the relayed record", () => {
    const record = addMessage({
      ...SERVER,
      name: "dots",
      message: "hi",
      muted: true,
    });
    expect(record.muted).toBe(true);
  });

  it("defaults muted to false when the plugin omits it", () => {
    const record = addMessage({ ...SERVER, name: "dots", message: "hi" });
    expect(record.muted).toBe(false);
  });

  // The odd-length ASCII prefix is load bearing:
  // it puts the cut-off point on an odd UTF-16 index, so substring() would slice a surrogate pair down the middle.
  it("truncates long names without splitting a surrogate pair", () => {
    const record = addMessage({
      ...SERVER,
      name: "a" + "\u{1F600}".repeat(64),
      message: "hi",
    });
    expect([...record.name]).toHaveLength(64);
    expect(LONE_SURROGATE.test(record.name)).toBe(false);
    expect(JSON.parse(JSON.stringify(record.name))).toBe(record.name);
  });

  it("truncates long messages without splitting a surrogate pair", () => {
    const cleaned = sanitizeMessage("a" + "\u{1F600}".repeat(600));
    expect([...cleaned]).toHaveLength(512);
    expect(LONE_SURROGATE.test(cleaned)).toBe(false);
  });

  it("leaves short strings untouched", () => {
    expect(sanitizeMessage("  hello   world  ")).toBe("hello world");
  });
});
