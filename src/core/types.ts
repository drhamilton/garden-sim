// Core domain types for the garden sun simulation.
//
// Pure data — no DOM, no renderer, no I/O. These types define the garden
// model (1ft tiles, discrete ground levels, light-blocking objects) and the
// sun's position in the sky. All of it is serializable.

/** Side length of one grid tile in metres (1 ft — the square-foot gardening unit). */
export const TILE_SIZE_M = 0.3048;

/** Height in metres of one discrete ground-level step (e.g. lawn → raised deck). */
export const LEVEL_HEIGHT_M = 0.3;

/**
 * The sun's position in the sky, in radians.
 *
 * Azimuth is a compass bearing measured clockwise from true north:
 * N = 0, E = π/2, S = π, W = 3π/2. Elevation is the angle above the
 * horizon: 0 at the horizon, π/2 at the zenith, negative below the horizon
 * (night).
 */
export interface SunPosition {
  azimuth: number;
  elevation: number;
}

/** An axis-aligned rectangular footprint on the tile grid, in tile units. */
export interface Footprint {
  /** Column of the south-west corner (min x). */
  x: number;
  /** Row of the south-west corner (min y). */
  y: number;
  /** Extent along x, in tiles (≥ 1). */
  width: number;
  /** Extent along y, in tiles (≥ 1). */
  depth: number;
}

/** The kinds of light-blocking object the v1 editor can place. */
export type GardenObjectKind = 'building' | 'fence' | 'tree';

/**
 * A deciduous tree's leaf-on/leaf-off date range, as `MM-DD` strings
 * (inclusive, year-agnostic). Stored on the model but not yet honoured by
 * the engine — the shadow pass treats every object as opaque regardless.
 */
export interface DeciduousRange {
  leafOn: string;
  leafOff: string;
}

/** An object placed on the grid that blocks sunlight. */
export interface GardenObject {
  kind: GardenObjectKind;
  footprint: Footprint;
  /** Discrete ground level the object's base sits on. */
  baseLevel: number;
  /** Height above its base, in metres (free/continuous, not quantized). */
  heightM: number;
  /**
   * Light transmittance in [0,1] — 0 = opaque, 1 = fully transparent.
   * Omitted means opaque. Not yet honoured by the shadow pass (every object
   * is currently treated as opaque regardless of this value).
   */
  transmittance?: number;
  /** Trees only: deciduous leaf-on/leaf-off range. */
  deciduousRange?: DeciduousRange;
}

/**
 * A garden model: a rectangular grid of tiles with discrete ground levels,
 * a set of light-blocking objects, a real-world location, and an orientation.
 *
 * `groundLevels` is row-major: the level of tile (x, y) is at index
 * `y * width + x`.
 *
 * `northRotation` is the compass bearing (radians, clockwise from true north)
 * of the grid's +y axis — i.e. how far the model is rotated away from having
 * +y point at true north.
 */
export interface Garden {
  width: number;
  depth: number;
  groundLevels: readonly number[];
  /**
   * Whether each tile is part of the garden's footprint, row-major. Tiles
   * outside the footprint are excluded from the editor's view. Omitted means
   * every tile in the grid is active (the pre-editor default).
   */
  active?: readonly boolean[];
  objects: readonly GardenObject[];
  northRotation: number;
  latitude: number;
  longitude: number;
}

/** Row-major index of tile (x, y) in a grid of the given width. */
export function tileIndex(width: number, x: number, y: number): number {
  return y * width + x;
}

/** Whether the tile at row-major index `idx` is part of the garden's footprint. */
export function isTileActive(garden: Garden, idx: number): boolean {
  return garden.active?.[idx] ?? true;
}
