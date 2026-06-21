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
  let sunniestIndex = 0;
  let shadiestIndex = 0;
  hours.forEach((h, i) => {
    if (h > hours[sunniestIndex]!) sunniestIndex = i;
    if (h < hours[shadiestIndex]!) shadiestIndex = i;
  });
  const grid: SunHoursGrid = {
    width: hours.length,
    depth: 1,
    hours: Float64Array.from(hours),
    minHours: hours[shadiestIndex]!,
    maxHours: hours[sunniestIndex]!,
    sunniestIndex,
    shadiestIndex,
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

  it('flags the sunniest and shadiest tiles', () => {
    const { garden, grid } = gridStrip([2, 9, 5]);
    const scene = buildHeatmapScene(garden, grid, NOON);

    expect(scene.tiles.map((t) => t.highlight)).toEqual([
      'shadiest',
      'sunniest',
      undefined,
    ]);
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
      minHours: 1,
      maxHours: 2,
      sunniestIndex: 1,
      shadiestIndex: 0,
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
