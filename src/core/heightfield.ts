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
  /**
   * Light transmittance in [0,1] of the obstacle that defines `obstacleM` at
   * each tile, row-major. 0 = opaque (also the value for bare ground, which is
   * opaque). The fractional shadow pass multiplies a ray's light by this when
   * it passes through a tile's obstacle.
   */
  transmittanceAt: Float64Array;
  /**
   * Index into `garden.objects` of the object that defines `obstacleM` at each
   * tile, row-major; -1 for tiles topped by bare ground. Lets the fractional
   * pass attenuate by each object once however many of its tiles a ray crosses.
   */
  objectIdAt: Int32Array;
  /** The tallest obstacle anywhere in the field, in metres. */
  maxObstacleM: number;
}

export function buildHeightfield(garden: Garden): Heightfield {
  const { width, depth } = garden;
  const surfaceM = groundSurface(garden);
  // Objects rise above the ground, so obstacles start level with the surface.
  const obstacleM = Float64Array.from(surfaceM);
  // Bare ground is opaque; only transmissive objects override this.
  const transmittanceAt = new Float64Array(width * depth);
  const objectIdAt = new Int32Array(width * depth).fill(-1);
  raiseObstaclesForObjects(obstacleM, transmittanceAt, objectIdAt, garden);

  return {
    width,
    depth,
    surfaceM,
    obstacleM,
    transmittanceAt,
    objectIdAt,
    maxObstacleM: maxOf(obstacleM),
  };
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

/**
 * Raises the obstacle height under each object's footprint to the object's top,
 * recording the transmittance and `garden.objects` index of whichever object
 * reaches highest on each tile. Omitted transmittance means opaque (0). Stacked
 * objects on one tile collapse to the tallest — a documented simplification.
 */
function raiseObstaclesForObjects(
  obstacleM: Float64Array,
  transmittanceAt: Float64Array,
  objectIdAt: Int32Array,
  garden: Garden,
): void {
  garden.objects.forEach((obj, objectId) => {
    const topM = obj.baseLevel * LEVEL_HEIGHT_M + obj.heightM;
    const transmittance = obj.transmittance ?? 0;
    forEachTileInFootprint(obj.footprint, garden.width, garden.depth, (idx) => {
      if (topM > obstacleM[idx]!) {
        obstacleM[idx] = topM;
        transmittanceAt[idx] = transmittance;
        objectIdAt[idx] = objectId;
      }
    });
  });
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
