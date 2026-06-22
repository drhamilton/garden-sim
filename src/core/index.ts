// core/ — pure, framework-agnostic simulation domain.
//
// Holds all domain logic (garden model, heightfield, shadow pass, scene
// description). No DOM, no renderer, no I/O — headlessly testable.

export type {
  SunPosition,
  Footprint,
  GardenObject,
  GardenObjectKind,
  DeciduousRange,
  Garden,
} from './types';
export { TILE_SIZE_M, LEVEL_HEIGHT_M, tileIndex, isTileActive } from './types';

export { paintTile, eraseTile } from './ground-editor';

export type { GardenObjectPatch } from './object-editor';
export {
  placeObject,
  updateObjectAt,
  removeObjectAt,
  objectAt,
} from './object-editor';

export type { Heightfield } from './heightfield';
export { buildHeightfield } from './heightfield';

export type { LitGrid } from './shadow';
export { computeLitGrid } from './shadow';

export type {
  DaySample,
  SunAt,
  SunAtDateTime,
  SunHoursGrid,
} from './sun-hours';
export {
  DEFAULT_SAMPLE_INTERVAL_DAYS,
  DEFAULT_STEP_HOURS,
  aggregateSunHours,
  sampleDay,
  sampleWindow,
} from './sun-hours';

export type { WindowPreset } from './window';
export { addDays, windowBounds } from './window';

export type {
  SceneDescription,
  SceneTile,
  SceneObject,
  SceneCamera,
} from './scene';
export { buildScene, buildHeatmapScene } from './scene';
