// User Timing helpers.
//
// Emit named spans into the standard User Timing buffer so our hot operations
// show up as labelled bars in the DevTools Performance panel (and any User
// Timing reader / Lighthouse) instead of anonymous flamechart noise. Works on
// both the main thread and inside a Worker — `performance` exists in both.
//
// Best-effort dev instrumentation: a failure here must never break the app.

/** Records a span named `name` between two `performance.now()` timestamps. */
export function recordSpan(name: string, startMs: number, endMs: number): void {
  try {
    performance.measure(name, { start: startMs, end: endMs });
  } catch {
    // User Timing is optional; swallow (e.g. if the buffer API is unavailable).
  }
}

/**
 * Times a synchronous operation, emits a User Timing span for it, and returns
 * the operation's result alongside its wall-clock duration in milliseconds.
 */
export function measureSync<T>(
  name: string,
  operation: () => T,
): { result: T; elapsedMs: number } {
  const startMs = performance.now();
  const result = operation();
  const endMs = performance.now();
  recordSpan(name, startMs, endMs);
  return { result, elapsedMs: endMs - startMs };
}
