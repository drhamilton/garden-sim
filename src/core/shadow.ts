// Instantaneous shadow pass.
//
// Given a garden and a sun position, computes per tile the fraction of direct
// sunlight it receives, by casting a ray from the tile surface toward the sun
// across the heightfield. An opaque object (or raised ground) blocks the ray
// entirely; a transmissive object (e.g. a tree canopy) lets a fraction through,
// so partly-shaded tiles read as dappled. Both the instantaneous scrub view and
// the sun-hours heatmap are built on this single pass.

import { buildHeightfield } from './heightfield';
import type { Heightfield } from './heightfield';
import type { Garden, SunPosition } from './types';
import { TILE_SIZE_M, tileIndex } from './types';

export interface SunFractionGrid {
  width: number;
  depth: number;
  /**
   * Fraction of direct sunlight reaching each tile in [0,1], row-major. 1 = the
   * ray reaches the sun unobstructed; 0 = an opaque blocker; intermediate =
   * the product of the transmittances of every object the ray passes through.
   */
  fraction: Float64Array;
}

/** How far along the ray we sample, in tile units, each step. */
const STEP = 0.5;
const EPSILON = 1e-6;

/** The sun's heading across the grid, plus how steeply its ray climbs. */
interface SunRay {
  /** Step in grid x toward the sun, per tile travelled. */
  dx: number;
  /** Step in grid y toward the sun, per tile travelled. */
  dy: number;
  /** Metres the ray rises per metre travelled horizontally. */
  slope: number;
}

/**
 * The sun's heading in grid space. Rotating the garden by `northRotation`
 * subtracts that angle from the sun's compass bearing, so we can work relative
 * to the grid's own axes.
 */
function sunRayFor(garden: Garden, sun: SunPosition): SunRay {
  const gridAzimuth = sun.azimuth - garden.northRotation;
  return {
    dx: Math.sin(gridAzimuth),
    dy: Math.cos(gridAzimuth),
    slope: Math.tan(sun.elevation),
  };
}

/** True when a tile sits under an object — its cell rises above its own ground. */
function isUnderObject(field: Heightfield, idx: number): boolean {
  return field.obstacleM[idx]! > field.surfaceM[idx]! + EPSILON;
}

/**
 * Returns each tile's fraction of direct sunlight in [0,1], honouring object
 * transmittance. A ray that passes through transmissive objects accrues the
 * product of their transmittances; an opaque object (the default) zeroes it.
 */
export function computeSunFractionGrid(
  garden: Garden,
  sun: SunPosition,
): SunFractionGrid {
  const { width, depth } = garden;
  const fraction = new Float64Array(width * depth);
  // Sun below the horizon → no direct light reaches anything (night).
  if (sun.elevation > 0) {
    writeSunFractions(fraction, garden, buildHeightfield(garden), sun);
  }
  return { width, depth, fraction };
}

/**
 * Writes each tile's sun fraction into `out` for a **prebuilt** heightfield —
 * the low-allocation path the sun-hours aggregation runs on its hot loop. The
 * heightfield depends only on the garden, so a whole day's sun positions share
 * one `field` and one `out` buffer instead of rebuilding/reallocating per
 * sample. `out` must be length `width × depth` and is fully overwritten.
 *
 * The caller is responsible for skipping night (sun at or below the horizon),
 * where every tile is dark — `aggregateSunHours` does, and `field` must be the
 * heightfield of `garden` (its `northRotation`/objects drive the ray).
 */
export function writeSunFractions(
  out: Float64Array,
  garden: Garden,
  field: Heightfield,
  sun: SunPosition,
): void {
  const { width, depth } = field;
  const ray = sunRayFor(garden, sun);
  const maxDistance = Math.hypot(width, depth) + 1;
  // Per-object "last tile that attenuated by it" stamps, so a ray attenuates by
  // each object once however many of its tiles it crosses (reused across tiles
  // to avoid re-allocating; each tile stamps with its own unique index).
  const seenByObject = new Int32Array(garden.objects.length).fill(-1);

  for (let cy = 0; cy < depth; cy++) {
    for (let cx = 0; cx < width; cx++) {
      out[tileIndex(width, cx, cy)] = sunFractionForTile(
        field,
        cx,
        cy,
        ray,
        maxDistance,
        seenByObject,
      );
    }
  }
}

/**
 * Walks from a tile toward the sun, multiplying the light fraction by the
 * transmittance of each object the ray passes through — once per object, so a
 * wide canopy attenuates the same whether the ray clips one of its tiles or
 * several. An object directly overhead attenuates first; an opaque object (or
 * bare ground) zeroes the light. Returns when the ray is fully blocked or has
 * cleared every obstacle.
 */
function sunFractionForTile(
  field: Heightfield,
  cx: number,
  cy: number,
  ray: SunRay,
  maxDistance: number,
  seenByObject: Int32Array,
): number {
  const {
    width,
    depth,
    surfaceM,
    obstacleM,
    opaqueTopM,
    transmittanceAt,
    objectIdAt,
  } = field;
  const { maxObstacleM } = field;
  const originIdx = tileIndex(width, cx, cy);
  let fraction = 1;

  // An object sitting over the tile attenuates the light reaching its surface.
  // The tile's own object dapples by its canopy transmittance regardless of sun
  // angle — we don't trunk-block the origin tile, because trunk and canopy share
  // one footprint, so a geometric test would block even an overhead ray through
  // the canopy. (A narrower trunk footprint, deferred, is what would let a low
  // ray here read as trunk-shaded; see CONTEXT.md "Canopy base".)
  if (isUnderObject(field, originIdx)) {
    fraction *= transmittanceAt[originIdx]!;
    if (fraction <= EPSILON) return 0;
    markObjectSeen(seenByObject, objectIdAt[originIdx]!, originIdx);
  }

  const startHeight = surfaceM[originIdx]!;
  const originX = cx + 0.5;
  const originY = cy + 0.5;
  let lastIdx = originIdx;

  for (let distance = STEP; distance <= maxDistance; distance += STEP) {
    const gx = Math.floor(originX + ray.dx * distance);
    const gy = Math.floor(originY + ray.dy * distance);

    // Ray left the garden → nothing more can block it.
    if (gx < 0 || gx >= width || gy < 0 || gy >= depth) return fraction;

    const rayHeight = startHeight + distance * TILE_SIZE_M * ray.slope;
    // Ray has risen above everything that could block it.
    if (rayHeight > maxObstacleM) return fraction;

    const idx = tileIndex(width, gx, gy);
    if (idx === lastIdx) continue; // same cell — don't re-test
    lastIdx = idx;

    if (obstacleM[idx]! <= rayHeight + EPSILON) continue; // ray clears it
    // Below the obstacle's opaque segment (bare ground, a building, or a tree's
    // trunk) the ray is blocked solidly; only above it does the canopy dapple.
    if (rayHeight <= opaqueTopM[idx]! + EPSILON) return 0;
    const objectId = objectIdAt[idx]!;
    // An object already crossed by this ray has spent its attenuation.
    if (objectId < 0) return 0;
    if (markObjectSeen(seenByObject, objectId, originIdx)) {
      fraction *= transmittanceAt[idx]!;
      if (fraction <= EPSILON) return 0; // opaque (or fully attenuated)
    }
  }
  return fraction;
}

/**
 * Records that the ray from tile `serial` has now passed through `objectId`.
 * Returns true the first time for a given serial, false thereafter — so a ray
 * attenuates by a multi-tile object exactly once. Stamping by the origin tile's
 * index lets one `seenByObject` array serve every tile without clearing.
 */
function markObjectSeen(
  seenByObject: Int32Array,
  objectId: number,
  serial: number,
): boolean {
  if (seenByObject[objectId] === serial) return false;
  seenByObject[objectId] = serial;
  return true;
}
