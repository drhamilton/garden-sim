// Neutral scene description.
//
// The core's render-agnostic description of the scene: a serializable list of
// renderable primitives plus camera/orientation. A rendering adapter (first: Three.js)
// translates this into its engine. Because it's plain serializable data, tests
// can assert on it directly — the core→renderer boundary is verifiable without
// any engine.

import type { Footprint, Garden, GardenObjectKind, SunPosition } from './types';
import { LEVEL_HEIGHT_M, TILE_SIZE_M, tileIndex } from './types';
import type { LitGrid } from './shadow';

export interface SceneTile {
  x: number;
  y: number;
  /** Ground surface height in metres. */
  elevationM: number;
  lit: boolean;
}

export interface SceneObject {
  kind: GardenObjectKind;
  footprint: Footprint;
  /** Height of the object's base above ground level zero, in metres. */
  baseElevationM: number;
  heightM: number;
}

export interface SceneCamera {
  kind: 'orthographic';
  /** Compass bearing (radians) of the grid's +y axis, clockwise from true north. */
  northRotation: number;
}

export interface SceneDescription {
  width: number;
  depth: number;
  /** Side length of a tile, in metres. */
  tileSizeM: number;
  tiles: SceneTile[];
  objects: SceneObject[];
  camera: SceneCamera;
  /** The sun position this scene was lit by (for the renderer's light/debug). */
  sun: SunPosition;
}

/**
 * Builds the neutral scene description from a garden and a computed lit grid.
 * The grid must match the garden's dimensions.
 */
export function buildScene(
  garden: Garden,
  litGrid: LitGrid,
  sun: SunPosition,
): SceneDescription {
  const { width, depth } = garden;

  const tiles: SceneTile[] = [];
  for (let y = 0; y < depth; y++) {
    for (let x = 0; x < width; x++) {
      const idx = tileIndex(width, x, y);
      const level = garden.groundLevels[idx] ?? 0;
      tiles.push({
        x,
        y,
        elevationM: level * LEVEL_HEIGHT_M,
        lit: litGrid.lit[idx] === 1,
      });
    }
  }

  const objects: SceneObject[] = garden.objects.map((obj) => ({
    kind: obj.kind,
    footprint: obj.footprint,
    baseElevationM: obj.baseLevel * LEVEL_HEIGHT_M,
    heightM: obj.heightM,
  }));

  return {
    width,
    depth,
    tileSizeM: TILE_SIZE_M,
    tiles,
    objects,
    camera: { kind: 'orthographic', northRotation: garden.northRotation },
    sun,
  };
}
