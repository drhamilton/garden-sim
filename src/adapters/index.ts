// adapters/ — concrete implementations of ports.

export { SunCalcSolarPosition } from './solar/suncalc-solar-position';
export { ThreeOrthographicRenderer } from './render/three-orthographic-renderer';
export {
  WorkerSunHoursPort,
  SupersededError,
  isSupersededError,
} from './worker/worker-sun-hours-port';
export { createPerfHud, perfEnabled } from './perf/perf-hud';
export type { PerfHud, HeatmapStats } from './perf/perf-hud';
export { recordSpan, measureSync } from './perf/user-timing';
