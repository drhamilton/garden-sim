// Web Worker entry: runs the pure sun-hours aggregation off the main thread.
//
// This is the off-thread adapter behind the sun-hours port. It owns no logic of
// its own — it just drives the core's `aggregateSunHours` and streams results
// back: throttled progress messages while it works, then the finished grid. The
// result's typed-array buffer is transferred (zero-copy) rather than cloned.

import { aggregateSunHours } from '../../core';
import type { SunHoursRequest } from '../../ports/sun-hours-port';

/**
 * The slice of the dedicated worker global we use. We avoid the `webworker` TS
 * lib (it clashes with the project's `DOM` lib) and instead pin just the two
 * members we touch, with a transfer-list-aware `postMessage`.
 */
interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
}
const ctx = self as unknown as WorkerScope;

/** Smallest gap between progress posts, so a long run doesn't flood the channel. */
const PROGRESS_THROTTLE_MS = 60;

ctx.onmessage = (event: MessageEvent<SunHoursRequest>) => {
  const { garden, samples, dayCount } = event.data;

  let lastPost = 0;
  const grid = aggregateSunHours(garden, samples, dayCount, {
    onProgress: (completed, total) => {
      const now = performance.now();
      // Always post the final tick; throttle the rest by wall-clock time.
      if (completed === total || now - lastPost >= PROGRESS_THROTTLE_MS) {
        lastPost = now;
        ctx.postMessage({ type: 'progress', completed, total });
      }
    },
  });

  ctx.postMessage({ type: 'result', grid }, [grid.hours.buffer]);
};
