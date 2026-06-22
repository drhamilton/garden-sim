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

import type { Footprint, Garden, GardenObject } from './types';
import { LEVEL_HEIGHT_M, tileIndex } from './types';

export interface Heightfield {
  width: number;
  depth: number;
  /** Ground surface height in metres per tile, row-major. */
  surfaceM: Float64Array;
  /** Obstacle top height in metres per tile, row-major. */
  obstacleM: Float64Array;
  /**
   * Top height in metres of the obstacle's opaque lower segment per tile,
   * row-major. A ray crossing the tile below this is blocked solidly; between
   * here and `obstacleM` it passes the tile's `transmittanceAt` (the canopy).
   * For an opaque obstacle (bare ground, a building, a fence) this equals
   * `obstacleM` — the whole thing is solid. For a uniform transmissive object
   * it equals the surface — there is no opaque part. For a tree with a trunk it
   * is the trunk top (base + `canopyBaseM`).
   */
  opaqueTopM: Float64Array;
  /**
   * Light transmittance in [0,1] of the obstacle that defines `obstacleM` at
   * each tile, row-major. 0 = opaque (also the value for bare ground, which is
   * opaque). The fractional shadow pass multiplies a ray's light by this when
   * it passes through a tile's obstacle above `opaqueTopM`.
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
  // Bare ground is opaque to its surface; only transmissive objects lift the
  // opaque top below their own top.
  const opaqueTopM = Float64Array.from(surfaceM);
  const transmittanceAt = new Float64Array(width * depth);
  const objectIdAt = new Int32Array(width * depth).fill(-1);
  raiseObstaclesForObjects(
    obstacleM,
    opaqueTopM,
    transmittanceAt,
    objectIdAt,
    garden,
  );

  return {
    width,
    depth,
    surfaceM,
    obstacleM,
    opaqueTopM,
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
 * recording the opaque-segment top, transmittance, and `garden.objects` index
 * of whichever object reaches highest on each tile. Omitted transmittance means
 * opaque (0). Stacked objects on one tile collapse to the tallest — a
 * documented simplification.
 */
function raiseObstaclesForObjects(
  obstacleM: Float64Array,
  opaqueTopM: Float64Array,
  transmittanceAt: Float64Array,
  objectIdAt: Int32Array,
  garden: Garden,
): void {
  garden.objects.forEach((obj, objectId) => {
    const baseM = obj.baseLevel * LEVEL_HEIGHT_M;
    const topM = baseM + obj.heightM;
    const transmittance = obj.transmittance ?? 0;
    const opaqueTop = opaqueSegmentTop(obj, baseM, topM, transmittance);
    forEachTileInFootprint(obj.footprint, garden.width, garden.depth, (idx) => {
      if (topM > obstacleM[idx]!) {
        obstacleM[idx] = topM;
        opaqueTopM[idx] = opaqueTop;
        transmittanceAt[idx] = transmittance;
        objectIdAt[idx] = objectId;
      }
    });
  });
}

/**
 * The height (metres) up to which an object blocks light solidly. An opaque
 * object is solid to its top; a transmissive object with a trunk is solid up
 * through the trunk (`canopyBaseM`, clamped to its top); a transmissive object
 * with no trunk is solid only to its base.
 */
function opaqueSegmentTop(
  obj: Pick<GardenObject, 'canopyBaseM'>,
  baseM: number,
  topM: number,
  transmittance: number,
): number {
  if (transmittance <= 0) return topM;
  if (obj.canopyBaseM == null) return baseM;
  return Math.min(baseM + obj.canopyBaseM, topM);
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
