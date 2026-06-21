// Derives a tile heightfield from a garden model.
//
// The world is a 2.5D extruded-footprint / tile-heightfield model (not full
// 3D meshes). For each tile we track two heights in metres:
//
//   surface  — the ground surface the tile presents (from its discrete level)
//   obstacle — the top of anything occupying the tile (max of the surface and
//              any object footprint covering it)
//
// The shadow pass marches rays across the `obstacle` field; lit/shadow state
// is evaluated at each tile's `surface`.

import type { Footprint, Garden } from './types';
import { LEVEL_HEIGHT_M, tileIndex } from './types';

export interface Heightfield {
  width: number;
  depth: number;
  /** Ground surface height in metres per tile, row-major. */
  surfaceM: Float64Array;
  /** Obstacle top height in metres per tile, row-major. */
  obstacleM: Float64Array;
  /** The tallest obstacle anywhere in the field, in metres. */
  maxObstacleM: number;
}

export function buildHeightfield(garden: Garden): Heightfield {
  const { width, depth } = garden;
  const surfaceM = groundSurface(garden);
  // Objects rise above the ground, so obstacles start level with the surface.
  const obstacleM = Float64Array.from(surfaceM);
  raiseObstaclesForObjects(obstacleM, garden);

  return { width, depth, surfaceM, obstacleM, maxObstacleM: maxOf(obstacleM) };
}

/** Ground surface height (metres) for every tile, from its discrete level. */
function groundSurface(garden: Garden): Float64Array {
  const { width, depth, groundLevels } = garden;
  const surfaceM = new Float64Array(width * depth);
  for (let i = 0; i < surfaceM.length; i++) {
    surfaceM[i] = (groundLevels[i] ?? 0) * LEVEL_HEIGHT_M;
  }
  return surfaceM;
}

/** Raises the obstacle height under each object's footprint to the object's top. */
function raiseObstaclesForObjects(
  obstacleM: Float64Array,
  garden: Garden,
): void {
  for (const obj of garden.objects) {
    const topM = obj.baseLevel * LEVEL_HEIGHT_M + obj.heightM;
    forEachTileInFootprint(obj.footprint, garden.width, garden.depth, (idx) => {
      if (topM > obstacleM[idx]!) obstacleM[idx] = topM;
    });
  }
}

/** Invokes `visit` with the row-major index of every in-bounds tile a footprint covers. */
function forEachTileInFootprint(
  footprint: Footprint,
  width: number,
  depth: number,
  visit: (idx: number) => void,
): void {
  const { x, y, width: w, depth: d } = footprint;
  for (let ty = y; ty < y + d; ty++) {
    if (ty < 0 || ty >= depth) continue;
    for (let tx = x; tx < x + w; tx++) {
      if (tx < 0 || tx >= width) continue;
      visit(tileIndex(width, tx, ty));
    }
  }
}

/** The largest value in a (non-negative) height array. */
function maxOf(values: Float64Array): number {
  let max = 0;
  for (const value of values) {
    if (value > max) max = value;
  }
  return max;
}
