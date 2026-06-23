// Sun-hours port.
//
// The UI asks for a sun-hours heatmap through this port; an adapter computes it.
// The port is async and reports progress because the aggregation is the app's
// one heavy computation (a season is hundreds of sampled sun positions × up to
// ~10k tiles): the production adapter runs it in a Web Worker so the main thread
// stays responsive (60fps scrubbing) while a heatmap is computed.
//
// The pure core (`aggregateSunHours`) stays synchronous and headlessly testable;
// this port is purely the off-thread boundary around it.

import type { DaySample, SunHoursGrid } from '../core/sun-hours';
import type { Garden } from '../core/types';

/** Everything needed to aggregate a window into a sun-hours heatmap. */
export interface SunHoursRequest {
  garden: Garden;
  /** Pre-sampled, day-tagged sun positions (from `sampleWindow`). */
  samples: DaySample[];
  /** Representative days the samples span; divides the accumulated time. */
  dayCount: number;
}

/** How far an in-flight aggregation has progressed, for a progress indicator. */
export interface SunHoursProgress {
  /** Samples processed so far. */
  completed: number;
  /** Total samples to process. */
  total: number;
}

export interface SunHoursPort {
  /**
   * Aggregates a window into a per-tile sun-hours heatmap, off the main thread.
   * `onProgress` (if given) fires as work proceeds. Issuing a new request
   * supersedes any still in flight: the superseded promise rejects (see
   * {@link isSupersededError}), so callers can ignore stale results.
   */
  aggregate(
    request: SunHoursRequest,
    onProgress?: (progress: SunHoursProgress) => void,
  ): Promise<SunHoursGrid>;
  /** Release the worker (or other) resources. */
  dispose(): void;
}
