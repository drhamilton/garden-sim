// core/ — pure, framework-agnostic simulation domain.
//
// Holds all domain logic (garden model, heightfield, shadow pass, scene
// description). No DOM, no renderer, no I/O — headlessly testable.

export type {
  SunPosition,
  Footprint,
  GardenObject,
  GardenObjectKind,
  Garden,
} from './types';
export { TILE_SIZE_M, LEVEL_HEIGHT_M, tileIndex } from './types';

export type { Heightfield } from './heightfield';
export { buildHeightfield } from './heightfield';

export type { LitGrid } from './shadow';
export { computeLitGrid } from './shadow';

export type {
  SceneDescription,
  SceneTile,
  SceneObject,
  SceneCamera,
} from './scene';
export { buildScene } from './scene';
