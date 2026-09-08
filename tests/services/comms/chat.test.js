const fs = require("fs");

// Mock the DB pool so persist() is a no-op.
jest.mock("../../../src/db", () => ({
  query: jest.fn().mockResolvedValue([{}]),
}));
jest.mock("../../../src/services/comms/websocket", () => ({
  emitChatMessage: jest.fn(),
}));

const {
  addMessage,
  sanitizeMessage,
  loadServerLookup,
  wait,
  _ring,
} = require("../../../src/services/comms/chat");

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
  it("truncates long names to the byte budget, whole code points only", () => {
    const record = addMessage({
      ...SERVER,
      name: "a" + "\u{1F600}".repeat(64),
      message: "hi",
    });
    expect(Buffer.byteLength(record.name)).toBeLessThanOrEqual(64);
    expect(LONE_SURROGATE.test(record.name)).toBe(false);
    expect(JSON.parse(JSON.stringify(record.name))).toBe(record.name);
  });

  it("truncates long messages to the byte budget, whole code points only", () => {
    const cleaned = sanitizeMessage("a" + "\u{1F600}".repeat(600));
    expect(Buffer.byteLength(cleaned)).toBeLessThanOrEqual(512);
    expect(LONE_SURROGATE.test(cleaned)).toBe(false);
  });

  // Multi-byte text passed the old code-point cap at 4x its byte size,
  // overflowing the fixed byte buffers the plugins print from.
  it("keeps an all-emoji message inside the byte budget", () => {
    const cleaned = sanitizeMessage("\u{1F600}".repeat(512));
    expect(Buffer.byteLength(cleaned)).toBe(512);
    expect([...cleaned]).toHaveLength(128);
  });

  it("still allows a full-length ASCII message", () => {
    expect(sanitizeMessage("a".repeat(600))).toHaveLength(512);
  });

  it("leaves short strings untouched", () => {
    expect(sanitizeMessage("  hello   world  ")).toBe("hello world");
  });
});

describe("cross-chat stream batching", () => {
  it("caps a backlog batch and pages the remainder", async () => {
    const ids = [];
    for (let i = 0; i < 60; i++) {
      ids.push(addMessage({ ...SERVER, name: "dots", message: `m${i}` }).id);
    }

    const first = await wait(ids[0], null, 1000).promise;
    expect(first.messages).toHaveLength(25);
    expect(first.cursor).toBe(first.messages[24].id);

    const second = await wait(first.cursor, null, 1000).promise;
    expect(second.messages).toHaveLength(25);
    expect(second.messages[0].id).toBe(first.cursor + 1);

    const third = await wait(second.cursor, null, 1000).promise;
    expect(third.messages).toHaveLength(9);
    expect(third.cursor).toBe(ids[59]);
  });

  it("reports the ring head when the batch is not truncated", async () => {
    const first = addMessage({ ...SERVER, name: "dots", message: "a" });
    const last = addMessage({ ...SERVER, name: "dots", message: "b" });

    const result = await wait(first.id - 1, null, 1000).promise;
    expect(result.messages).toHaveLength(2);
    expect(result.cursor).toBe(last.id);
  });
});
