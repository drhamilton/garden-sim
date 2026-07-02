import { describe, expect, it } from 'vitest';
import { buildHeatmapScene } from './scene';
import type { SunHoursGrid } from './sun-hours';
import type { Garden, SunPosition } from './types';
import { LEVEL_HEIGHT_M } from './types';

const DEG = Math.PI / 180;
const NOON: SunPosition = { azimuth: 180 * DEG, elevation: 60 * DEG };

/** A 3×1 open strip with a hand-built sun-hours grid: shady, mid, sunny. */
function gridStrip(hours: number[]): { garden: Garden; grid: SunHoursGrid } {
  const garden: Garden = {
    width: hours.length,
    depth: 1,
    groundLevels: new Array(hours.length).fill(0),
    objects: [],
    northRotation: 0,
    latitude: 0,
    longitude: 0,
  };
  const grid: SunHoursGrid = {
    width: hours.length,
    depth: 1,
    hours: Float64Array.from(hours),
  };
  return { garden, grid };
}

describe('buildHeatmapScene — sun-hours heatmap scene description', () => {
  it('carries per-tile sun-hours and a heatmap colour assertable without Three.js', () => {
    const { garden, grid } = gridStrip([0, 4, 8]);
    const scene = buildHeatmapScene(garden, grid, NOON);

    expect(scene.tiles.map((t) => t.sunHours)).toEqual([0, 4, 8]);
    // Every tile gets a packed 0xRRGGBB colour.
    for (const tile of scene.tiles) {
      expect(typeof tile.colorHex).toBe('number');
      expect(tile.colorHex).toBeGreaterThanOrEqual(0);
      expect(tile.colorHex).toBeLessThanOrEqual(0xffffff);
    }
    // The colour ramps with sun-hours: sunnier tiles differ from shadier ones.
    expect(scene.tiles[0]!.colorHex).not.toBe(scene.tiles[2]!.colorHex);
  });

  it('handles a uniform grid without dividing by a zero range', () => {
    const { garden, grid } = gridStrip([3, 3, 3]);
    const scene = buildHeatmapScene(garden, grid, NOON);

    const colours = scene.tiles.map((t) => t.colorHex);
    expect(new Set(colours).size).toBe(1); // all the same colour
    expect(colours.every((c) => Number.isFinite(c))).toBe(true);
  });

  it('still carries grid geometry, elevation, camera, and the lighting sun', () => {
    const garden: Garden = {
      width: 2,
      depth: 1,
      groundLevels: [0, 1],
      objects: [],
      northRotation: 30 * DEG,
      latitude: 0,
      longitude: 0,
    };
    const grid: SunHoursGrid = {
      width: 2,
      depth: 1,
      hours: Float64Array.from([1, 2]),
    };
    const scene = buildHeatmapScene(garden, grid, NOON);

    expect(scene.width).toBe(2);
    expect(scene.tiles[1]!.elevationM).toBeCloseTo(LEVEL_HEIGHT_M);
    expect(scene.camera).toEqual({
      kind: 'orthographic',
      northRotation: 30 * DEG,
    });
    expect(scene.sun).toEqual(NOON);
  });

  it('produces a JSON-serializable description', () => {
    const { garden, grid } = gridStrip([0, 4, 8]);
    const scene = buildHeatmapScene(garden, grid, NOON);
    expect(() => JSON.stringify(scene)).not.toThrow();
  });
});

describe('buildHeatmapScene — sunniest/shadiest highlights', () => {
  it('marks the sunniest and shadiest tiles', () => {
    const { garden, grid } = gridStrip([2, 5, 8]);
    const scene = buildHeatmapScene(garden, grid, NOON);

    expect(scene.tiles.map((t) => t.highlight)).toEqual([
      'shadiest',
      undefined,
      'sunniest',
    ]);
  });

  it('highlights every tied extreme, not an arbitrary one', () => {
    const { garden, grid } = gridStrip([8, 2, 8, 2, 5]);
    const scene = buildHeatmapScene(garden, grid, NOON);

    expect(scene.tiles.map((t) => t.highlight)).toEqual([
      'sunniest',
      'shadiest',
      'sunniest',
      'shadiest',
      undefined,
    ]);
  });

  it('ignores erased tiles when finding the extremes', () => {
    const { garden, grid } = gridStrip([0, 4, 8]);
    // Erase the shadiest and the sunniest tile; the middle one is both extremes
    // of what remains — but with only one distinct value left, highlights are
    // suppressed rather than crowning a single tile both sunniest and shadiest.
    const erased = { ...garden, active: [false, true, false] };
    const scene = buildHeatmapScene(erased, grid, NOON);
    expect(scene.tiles.every((t) => t.highlight === undefined)).toBe(true);

    // With two distinct active values, the erased extreme (idx 0, 0 hours)
    // no longer claims "shadiest" — the shadiest *active* tile does.
    const partly = { ...garden, active: [false, true, true] };
    const partlyScene = buildHeatmapScene(partly, grid, NOON);
    expect(partlyScene.tiles.map((t) => t.highlight)).toEqual([
      undefined,
      'shadiest',
      'sunniest',
    ]);
  });

  it('suppresses highlights when every active tile is equal', () => {
    const { garden, grid } = gridStrip([3, 3, 3]);
    const scene = buildHeatmapScene(garden, grid, NOON);
    expect(scene.tiles.every((t) => t.highlight === undefined)).toBe(true);
  });

  it('never highlights in the instantaneous scrub scene', async () => {
    const { buildScene } = await import('./scene');
    const { garden } = gridStrip([0, 0, 0]);
    const scene = buildScene(
      garden,
      { width: 3, depth: 1, fraction: Float64Array.from([0, 0.5, 1]) },
      NOON,
    );
    expect(scene.tiles.every((t) => t.highlight === undefined)).toBe(true);
  });
});
