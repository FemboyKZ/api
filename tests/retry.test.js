const { sleep, withRetry, isLockError } = require("../src/utils/retry");

// Backoff delays are real timers; keep bases tiny so the suite stays fast.
describe("withRetry", () => {
  it("returns the first success without retrying", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    await expect(withRetry(fn, { baseMs: 1 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries until it succeeds", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue("ok");

    await expect(withRetry(fn, { baseMs: 1 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("rethrows the last error once attempts run out", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("always"));
    await expect(withRetry(fn, { attempts: 3, baseMs: 1 })).rejects.toThrow(
      "always",
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry an error isRetryable rejects", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("fatal"));
    await expect(
      withRetry(fn, { baseMs: 1, isRetryable: () => false }),
    ).rejects.toThrow("fatal");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("reports each retry with a growing delay", async () => {
    const seen = [];
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("a"))
      .mockRejectedValueOnce(new Error("b"))
      .mockResolvedValue("ok");

    await withRetry(fn, {
      baseMs: 2,
      onRetry: ({ attempt, delay }) => seen.push({ attempt, delay }),
    });

    expect(seen.map((s) => s.attempt)).toEqual([1, 2]);
    // 2 * 2^0 then 2 * 2^1
    expect(seen.map((s) => s.delay)).toEqual([2, 4]);
  });

  it("jitter only ever adds to the delay", async () => {
    const seen = [];
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValue(1);

    await withRetry(fn, {
      baseMs: 10,
      jitter: true,
      onRetry: ({ delay }) => seen.push(delay),
    });

    expect(seen[0]).toBeGreaterThanOrEqual(10);
    expect(seen[0]).toBeLessThan(20);
  });

  it("passes the attempt number to fn", async () => {
    const seen = [];
    await withRetry(
      async (attempt) => {
        seen.push(attempt);
        if (attempt < 3) throw new Error("again");
        return "ok";
      },
      { baseMs: 1 },
    );
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe("isLockError", () => {
  it("matches lock contention only", () => {
    expect(isLockError({ code: "ER_LOCK_DEADLOCK" })).toBe(true);
    expect(isLockError({ code: "ER_LOCK_WAIT_TIMEOUT" })).toBe(true);
    expect(isLockError({ code: "ER_DUP_ENTRY" })).toBe(false);
    expect(isLockError(new Error("no code"))).toBe(false);
  });
});

describe("sleep", () => {
  it("waits before resolving", async () => {
    const start = Date.now();
    await sleep(15);
    expect(Date.now() - start).toBeGreaterThanOrEqual(10);
  });
});
