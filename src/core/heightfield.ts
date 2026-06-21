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

import type { Garden } from './types';
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
  const { width, depth, groundLevels, objects } = garden;
  const size = width * depth;
  const surfaceM = new Float64Array(size);
  const obstacleM = new Float64Array(size);

  for (let i = 0; i < size; i++) {
    const level = groundLevels[i] ?? 0;
    const h = level * LEVEL_HEIGHT_M;
    surfaceM[i] = h;
    obstacleM[i] = h;
  }

  let maxObstacleM = 0;
  for (let i = 0; i < size; i++) {
    if (obstacleM[i]! > maxObstacleM) maxObstacleM = obstacleM[i]!;
  }

  for (const obj of objects) {
    const top = obj.baseLevel * LEVEL_HEIGHT_M + obj.heightM;
    const { x, y, width: w, depth: d } = obj.footprint;
    for (let oy = y; oy < y + d; oy++) {
      if (oy < 0 || oy >= depth) continue;
      for (let ox = x; ox < x + w; ox++) {
        if (ox < 0 || ox >= width) continue;
        const idx = tileIndex(width, ox, oy);
        if (top > obstacleM[idx]!) obstacleM[idx] = top;
        if (top > maxObstacleM) maxObstacleM = top;
      }
    }
  }

  return { width, depth, surfaceM, obstacleM, maxObstacleM };
}
