// In-app performance HUD — a dev affordance enabled with `?perf` in the URL.
//
// Surfaces the two numbers that define the sun-sim's performance budget:
//
//   heatmap — end-to-end aggregation latency (worker compute + structuredClone
//             + buffer transfer) at the current grid size. The real-world,
//             in-browser counterpart to the offline `sun-hours.bench` (which is
//             the authoritative number for the 100×100 design ceiling, since the
//             renderer isn't built to draw 10k tiles at 60fps).
//   scrub   — rolling main-thread render time per frame, so you can watch the
//             headroom against the ~16.7ms / 60fps budget while a heatmap
//             computes off-thread in the worker.
//
// Display only: it observes timings the app already produces.

/** The per-frame time budget for 60fps, in milliseconds. */
const FRAME_BUDGET_MS = 1000 / 60;

/** How many recent scrub frames the rolling average/peak is taken over. */
const SCRUB_WINDOW = 30;

/** Whether the perf HUD is enabled (the URL carries `?perf`). */
export function perfEnabled(search: string = window.location.search): boolean {
  return new URLSearchParams(search).has('perf');
}

/** One completed heatmap aggregation, as the HUD reports it. */
export interface HeatmapStats {
  /** End-to-end latency in milliseconds. */
  elapsedMs: number;
  width: number;
  depth: number;
  /** Number of sun-position samples aggregated. */
  samples: number;
}

export interface PerfHud {
  /** The HUD's root element, for the caller to mount in the page. */
  readonly element: HTMLElement;
  /** Report a completed heatmap aggregation. */
  recordHeatmap(stats: HeatmapStats): void;
  /** Report one scrub frame's main-thread render time, in milliseconds. */
  recordScrub(elapsedMs: number): void;
}

/**
 * Creates the perf HUD. Mount `element` anywhere; drive it through the record
 * methods (which the caller already times). A no-op until first fed.
 */
export function createPerfHud(): PerfHud {
  const element = document.createElement('div');
  element.style.cssText =
    'font-family: ui-monospace, SFMono-Regular, Menlo, monospace;' +
    'font-size: 0.78em; line-height: 1.5; margin-top: 8px; padding: 6px 8px;' +
    'border: 1px solid #2c6e49; border-radius: 4px; color: #cde;' +
    'background: #0d1117; max-width: 520px;';

  const title = document.createElement('strong');
  title.textContent = 'perf';
  title.style.cssText = 'color: #6a994e; margin-right: 8px;';

  const heatmapLine = document.createElement('div');
  heatmapLine.textContent = 'heatmap: — (run a heatmap)';
  const scrubLine = document.createElement('div');
  scrubLine.textContent = 'scrub: — (scrub the time slider)';

  element.append(title, heatmapLine, scrubLine);

  const recentScrubMs: number[] = [];

  return {
    element,
    recordHeatmap({ elapsedMs, width, depth, samples }) {
      const tiles = (width * depth).toLocaleString();
      heatmapLine.textContent =
        `heatmap: ${elapsedMs.toFixed(0)}ms · ${width}×${depth} ` +
        `(${tiles} tiles) · ${samples} samples`;
    },
    recordScrub(elapsedMs) {
      recentScrubMs.push(elapsedMs);
      if (recentScrubMs.length > SCRUB_WINDOW) recentScrubMs.shift();
      const avg =
        recentScrubMs.reduce((sum, ms) => sum + ms, 0) / recentScrubMs.length;
      const peak = Math.max(...recentScrubMs);
      const fps = Math.min(60, 1000 / avg);
      const overBudget = peak > FRAME_BUDGET_MS ? ' ⚠ over budget' : '';
      scrubLine.textContent =
        `scrub: ${avg.toFixed(1)}ms avg · ${peak.toFixed(1)}ms peak · ` +
        `~${fps.toFixed(0)}fps (budget ${FRAME_BUDGET_MS.toFixed(1)}ms)${overBudget}`;
    },
  };
}
