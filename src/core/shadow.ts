// Instantaneous shadow pass.
//
// Given a garden and a sun position, marks each tile lit or shadowed by
// casting a ray from the tile surface toward the sun across the heightfield.
// If a taller column or object blocks the ray before it clears the tallest
// obstacle, the tile is in shadow.
//
// This slice is binary lit/shadow; fractional (dappled) shade via object
// transmittance arrives in a later slice.

import { buildHeightfield } from './heightfield';
import type { Garden, SunPosition } from './types';
import { TILE_SIZE_M, tileIndex } from './types';

export interface LitGrid {
  width: number;
  depth: number;
  /** 1 = lit, 0 = shadowed, per tile, row-major. */
  lit: Uint8Array;
}

/** Sub-tile marching step, in tile units. */
const STEP = 0.5;
const EPSILON = 1e-6;

export function computeLitGrid(garden: Garden, sun: SunPosition): LitGrid {
  const { width, depth } = garden;
  const lit = new Uint8Array(width * depth);

  // Sun below the horizon → the whole garden is in shadow (night).
  if (sun.elevation <= 0) {
    return { width, depth, lit };
  }

  const field = buildHeightfield(garden);
  const { surfaceM, obstacleM, maxObstacleM } = field;

  // Horizontal direction toward the sun, in grid space. Rotating the garden
  // by `northRotation` subtracts that angle from the sun's apparent bearing.
  const gridAzimuth = sun.azimuth - garden.northRotation;
  const dx = Math.sin(gridAzimuth);
  const dy = Math.cos(gridAzimuth);
  const tanElevation = Math.tan(sun.elevation);

  const maxT = Math.hypot(width, depth) + 1;

  for (let cy = 0; cy < depth; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const idx = tileIndex(width, cx, cy);
      const surface = surfaceM[idx]!;

      // A tile beneath an object (its own cell rises above the surface) gets
      // no direct sun.
      if (obstacleM[idx]! > surface + EPSILON) {
        continue; // lit stays 0
      }

      const originX = cx + 0.5;
      const originY = cy + 0.5;
      let shadowed = false;

      for (let t = STEP; t <= maxT; t += STEP) {
        const sampleX = originX + dx * t;
        const sampleY = originY + dy * t;
        const gx = Math.floor(sampleX);
        const gy = Math.floor(sampleY);

        // Ray left the garden without being blocked → lit.
        if (gx < 0 || gx >= width || gy < 0 || gy >= depth) break;

        const rayHeight = surface + t * TILE_SIZE_M * tanElevation;
        // Ray has cleared the tallest possible obstacle → lit.
        if (rayHeight > maxObstacleM) break;

        const sampleIdx = tileIndex(width, gx, gy);
        if (obstacleM[sampleIdx]! > rayHeight + EPSILON) {
          shadowed = true;
          break;
        }
      }

      lit[idx] = shadowed ? 0 : 1;
    }
  }

  return { width, depth, lit };
}
