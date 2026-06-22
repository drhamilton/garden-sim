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
import { LEVEL_HEIGHT_M, TILE_SIZE_M, tileIndex } from './types';
import type { LitGrid } from './shadow';
import type { SunHoursGrid } from './sun-hours';

export interface SceneTile {
  x: number;
  y: number;
  /** Ground surface height in metres. */
  elevationM: number;
  lit: boolean;
  /** Heatmap mode: average sun-hours per day for this tile. */
  sunHours?: number;
  /** Heatmap mode: packed 0xRRGGBB heatmap colour, ramped by sun-hours. */
  colorHex?: number;
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
 * The grid must match the garden's dimensions. This is the instantaneous view —
 * each tile carries binary lit/shadow state for a single sun position.
 */
export function buildScene(
  garden: Garden,
  litGrid: LitGrid,
  sun: SunPosition,
): SceneDescription {
  return sceneFor(garden, sun, (idx) => ({ lit: litGrid.lit[idx] === 1 }));
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
  return sceneFor(garden, sun, (idx) => {
    const sunHours = grid.hours[idx] ?? 0;
    const fraction = range > EPSILON ? (sunHours - minHours) / range : 1;
    return {
      lit: sunHours > 0,
      sunHours,
      colorHex: heatmapColor(fraction),
    };
  });
}

const EPSILON = 1e-9;

/** Builds the shared scene envelope, filling each tile via `tileState`. */
function sceneFor(
  garden: Garden,
  sun: SunPosition,
  tileState: (idx: number) => Partial<SceneTile>,
): SceneDescription {
  return {
    width: garden.width,
    depth: garden.depth,
    tileSizeM: TILE_SIZE_M,
    tiles: sceneTiles(garden, tileState),
    objects: garden.objects.map(toSceneObject),
    camera: { kind: 'orthographic', northRotation: garden.northRotation },
    sun,
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
        lit: false,
        ...tileState(idx),
      });
    }
  }
  return tiles;
}

// Heatmap colour ramp: shadow blue → sun yellow, matching the renderer palette.
const HEATMAP_SHADE = 0x39465a;
const HEATMAP_SUN = 0xf4d35e;

/** Packs a 0..1 sun-hours fraction into a 0xRRGGBB colour along the ramp. */
function heatmapColor(fraction: number): number {
  const t = Math.min(1, Math.max(0, fraction));
  const lerp = (shift: number): number => {
    const a = (HEATMAP_SHADE >> shift) & 0xff;
    const b = (HEATMAP_SUN >> shift) & 0xff;
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
