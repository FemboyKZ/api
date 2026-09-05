/**
 * Retry with exponential backoff.
 */

/** Resolves after ms. Replaces the `new Promise(r => setTimeout(r, ms))` idiom. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs fn, retrying while isRetryable says the failure is transient.
 *
 * Delay before attempt n is baseMs * 2^(n-1), plus up to baseMs of jitter when enabled -
 * use that where many callers can collide, such as row-lock retries.
 * The last failure is rethrown once attempts are exhausted.
 *
 * @param {() => Promise<T>} fn                     operation to run
 * @param {object}   [opts]
 * @param {number}   [opts.attempts=3]              total tries, including the first
 * @param {number}   [opts.baseMs=1000]             base backoff delay
 * @param {(e: Error) => boolean} [opts.isRetryable] defaults to retrying anything
 * @param {boolean}  [opts.jitter=false]            spread out colliding retries
 * @param {(info: {attempt: number, delay: number, error: Error}) => void} [opts.onRetry]
 * @returns {Promise<T>}
 * @template T
 */
async function withRetry(
  fn,
  {
    attempts = 3,
    baseMs = 1000,
    isRetryable = () => true,
    jitter = false,
    onRetry,
  } = {},
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= attempts || !isRetryable(error)) throw error;

      let delay = baseMs * Math.pow(2, attempt - 1);
      if (jitter) delay += Math.random() * baseMs;

      if (onRetry) onRetry({ attempt, delay, error });
      await sleep(delay);
    }
  }
}

/** MySQL errors worth retrying: the row was locked, not wrong. */
const LOCK_ERRORS = ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"];

/** True for lock contention, which clears on its own. */
const isLockError = (error) => LOCK_ERRORS.includes(error.code);

module.exports = { sleep, withRetry, isLockError, LOCK_ERRORS };
