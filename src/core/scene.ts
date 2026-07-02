// Neutral scene description.
//
// The core's render-agnostic description of the scene: a serializable list of
// renderable primitives plus camera/orientation. A rendering adapter (first: Three.js)
// translates this into its engine. Because it's plain serializable data, tests
// can assert on it directly — the core→renderer boundary is verifiable without
// any engine.

import type {
  Footprint,
  Garden,
  GardenObject,
  GardenObjectKind,
  SunPosition,
} from './types';
import { LEVEL_HEIGHT_M, TILE_SIZE_M, isTileActive, tileIndex } from './types';
import type { SunFractionGrid } from './shadow';
import type { SunHoursGrid } from './sun-hours';

export interface SceneTile {
  x: number;
  y: number;
  /** Ground surface height in metres. */
  elevationM: number;
  /** Whether this tile is part of the garden's footprint. */
  active: boolean;
  lit: boolean;
  /** Heatmap mode: average sun-hours per day for this tile. */
  sunHours?: number;
  /** Heatmap mode: packed 0xRRGGBB heatmap colour, ramped by sun-hours. */
  colorHex?: number;
  /**
   * Heatmap mode: marks this tile as an extreme of the aggregation — the
   * sunniest or shadiest active tile. Ties are all marked. Omitted when every
   * active tile is equal (highlighting the whole grid would mislead), on
   * erased tiles, and always in the instantaneous scrub view.
   */
  highlight?: 'sunniest' | 'shadiest';
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
  /**
   * The sun's path across the current day: chronologically-ordered sampled
   * positions for the scene's date/location, for the renderer to draw as a
   * sky-dome arc. A function of date/location only (not the scrubbed time), so
   * the renderer can rebuild it lazily. Omitted in heatmap mode.
   */
  sunArc?: SunPosition[];
}

/**
 * Builds the neutral scene description from a garden and a computed sun-fraction
 * grid. The grid must match the garden's dimensions. This is the instantaneous
 * view — each tile carries the fraction of direct sun it receives at a single
 * sun position, ramped shade → sun so dappled (partly shaded) tiles read as an
 * intermediate colour. `lit` stays true for any tile receiving some direct sun.
 *
 * `sunArc`, if given, is the day's sampled sun path (date/location-dependent
 * only) the renderer draws as a sky-dome arc.
 */
export function buildScene(
  garden: Garden,
  fractionGrid: SunFractionGrid,
  sun: SunPosition,
  sunArc?: SunPosition[],
): SceneDescription {
  return sceneFor(
    garden,
    sun,
    (idx) => {
      const fraction = fractionGrid.fraction[idx] ?? 0;
      return { lit: fraction > EPSILON, colorHex: rampColor(fraction) };
    },
    sunArc,
  );
}

/**
 * Builds the sun-hours heatmap scene from an aggregated grid. Each tile carries
 * its average sun-hours and a colour ramped across the grid's range. `sun` is a
 * representative position (e.g. solar noon) used only to light the extruded
 * objects so heights still read.
 */
export function buildHeatmapScene(
  garden: Garden,
  grid: SunHoursGrid,
  sun: SunPosition,
): SceneDescription {
  const minHours = Math.min(...grid.hours);
  const maxHours = Math.max(...grid.hours);
  const range = maxHours - minHours;
  const extremes = activeExtremes(garden, grid);
  return sceneFor(garden, sun, (idx) => {
    const sunHours = grid.hours[idx] ?? 0;
    const fraction = range > EPSILON ? (sunHours - minHours) / range : 1;
    const highlight =
      extremes && isTileActive(garden, idx)
        ? highlightFor(sunHours, extremes)
        : undefined;
    return {
      lit: sunHours > 0,
      sunHours,
      colorHex: rampColor(fraction),
      ...(highlight !== undefined && { highlight }),
    };
  });
}

/**
 * The extreme average sun-hours among the garden's active tiles, or null when
 * they don't span a real range — with every active tile (effectively) equal
 * there is no sunniest or shadiest spot to point at, so highlights are
 * suppressed rather than crowning the whole grid (or one tile as both).
 */
function activeExtremes(
  garden: Garden,
  grid: SunHoursGrid,
): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (let idx = 0; idx < grid.hours.length; idx++) {
    if (!isTileActive(garden, idx)) continue;
    const hours = grid.hours[idx]!;
    if (hours < min) min = hours;
    if (hours > max) max = hours;
  }
  return max - min > EPSILON ? { min, max } : null;
}

/** Which extreme (if either) a tile's sun-hours sit at, within tolerance. */
function highlightFor(
  sunHours: number,
  extremes: { min: number; max: number },
): SceneTile['highlight'] {
  if (sunHours >= extremes.max - EPSILON) return 'sunniest';
  if (sunHours <= extremes.min + EPSILON) return 'shadiest';
  return undefined;
}

const EPSILON = 1e-9;

/** Builds the shared scene envelope, filling each tile via `tileState`. */
function sceneFor(
  garden: Garden,
  sun: SunPosition,
  tileState: (idx: number) => Partial<SceneTile>,
  sunArc?: SunPosition[],
): SceneDescription {
  return {
    width: garden.width,
    depth: garden.depth,
    tileSizeM: TILE_SIZE_M,
    tiles: sceneTiles(garden, tileState),
    objects: garden.objects.map(toSceneObject),
    camera: { kind: 'orthographic', northRotation: garden.northRotation },
    sun,
    ...(sunArc !== undefined && { sunArc }),
  };
}

/** One renderable tile per grid cell, carrying position, elevation, and per-mode state. */
function sceneTiles(
  garden: Garden,
  tileState: (idx: number) => Partial<SceneTile>,
): SceneTile[] {
  const { width, depth, groundLevels } = garden;
  const tiles: SceneTile[] = [];
  for (let y = 0; y < depth; y++) {
    for (let x = 0; x < width; x++) {
      const idx = tileIndex(width, x, y);
      tiles.push({
        x,
        y,
        elevationM: (groundLevels[idx] ?? 0) * LEVEL_HEIGHT_M,
        active: isTileActive(garden, idx),
        lit: false,
        ...tileState(idx),
      });
    }
  }
  return tiles;
}

// Light ramp: shadow blue → sun yellow, matching the renderer palette. Shared
// by the instantaneous view (ramped by a tile's direct-sun fraction) and the
// heatmap (ramped by a tile's sun-hours across the grid's range).
const RAMP_SHADE = 0x39465a;
const RAMP_SUN = 0xf4d35e;

/** Packs a 0..1 light fraction into a 0xRRGGBB colour along the ramp. */
function rampColor(fraction: number): number {
  const t = Math.min(1, Math.max(0, fraction));
  const lerp = (shift: number): number => {
    const a = (RAMP_SHADE >> shift) & 0xff;
    const b = (RAMP_SUN >> shift) & 0xff;
    return Math.round(a + (b - a) * t);
  };
  return (lerp(16) << 16) | (lerp(8) << 8) | lerp(0);
}

/** Translates a garden object into its renderable form (levels → metres). */
function toSceneObject(obj: GardenObject): SceneObject {
  return {
    kind: obj.kind,
    footprint: obj.footprint,
    baseElevationM: obj.baseLevel * LEVEL_HEIGHT_M,
    heightM: obj.heightM,
  };
}
