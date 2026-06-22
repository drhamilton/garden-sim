import { describe, expect, it } from 'vitest';
import { eraseTile } from './ground-editor';
import { buildScene } from './scene';
import { computeLitGrid } from './shadow';
import type { Garden } from './types';
import { LEVEL_HEIGHT_M, TILE_SIZE_M } from './types';

const DEG = Math.PI / 180;

function gardenWithBuilding(): Garden {
  return {
    width: 3,
    depth: 1,
    groundLevels: [0, 0, 0],
    objects: [
      {
        kind: 'building',
        footprint: { x: 2, y: 0, width: 1, depth: 1 },
        baseLevel: 0,
        heightM: 3,
      },
    ],
    northRotation: 0,
    latitude: 0,
    longitude: 0,
  };
}

describe('buildScene — neutral scene description', () => {
  it('emits one tile per grid cell carrying position, elevation, and lit state', () => {
    const garden = gardenWithBuilding();
    const sun = { azimuth: 90 * DEG, elevation: 20 * DEG };
    const scene = buildScene(garden, computeLitGrid(garden, sun), sun);

    expect(scene.width).toBe(3);
    expect(scene.depth).toBe(1);
    expect(scene.tiles).toHaveLength(3);

    // Sun in the east → the two western tiles are shadowed, building covered.
    expect(scene.tiles.map((t) => t.lit)).toEqual([false, false, false]);
    expect(scene.tiles.map((t) => ({ x: t.x, y: t.y }))).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
  });

  it('translates objects into footprints with metric base + height', () => {
    const garden = gardenWithBuilding();
    const sun = { azimuth: 180 * DEG, elevation: 45 * DEG };
    const scene = buildScene(garden, computeLitGrid(garden, sun), sun);

    expect(scene.objects).toEqual([
      {
        kind: 'building',
        footprint: { x: 2, y: 0, width: 1, depth: 1 },
        baseElevationM: 0,
        heightM: 3,
      },
    ]);
  });

  it('reflects ground levels as metric tile elevations', () => {
    const garden: Garden = {
      width: 2,
      depth: 1,
      groundLevels: [0, 1],
      objects: [],
      northRotation: 0,
      latitude: 0,
      longitude: 0,
    };
    const sun = { azimuth: 180 * DEG, elevation: 60 * DEG };
    const scene = buildScene(garden, computeLitGrid(garden, sun), sun);

    expect(scene.tiles[0]?.elevationM).toBe(0);
    expect(scene.tiles[1]?.elevationM).toBeCloseTo(LEVEL_HEIGHT_M);
  });

  it('carries camera orientation and tile size for the renderer', () => {
    const garden = gardenWithBuilding();
    garden.northRotation = 30 * DEG;
    const sun = { azimuth: 120 * DEG, elevation: 35 * DEG };
    const scene = buildScene(garden, computeLitGrid(garden, sun), sun);

    expect(scene.camera).toEqual({
      kind: 'orthographic',
      northRotation: 30 * DEG,
    });
    expect(scene.tileSizeM).toBeCloseTo(TILE_SIZE_M);
    expect(scene.sun).toEqual(sun);
  });

  it('marks every tile active by default, and erased tiles inactive', () => {
    const garden = eraseTile(gardenWithBuilding(), 1, 0);
    const sun = { azimuth: 90 * DEG, elevation: 20 * DEG };
    const scene = buildScene(garden, computeLitGrid(garden, sun), sun);

    expect(scene.tiles.map((t) => t.active)).toEqual([true, false, true]);
  });

  it('produces a JSON-serializable description (no engine types leak in)', () => {
    const garden = gardenWithBuilding();
    const sun = { azimuth: 90 * DEG, elevation: 20 * DEG };
    const scene = buildScene(garden, computeLitGrid(garden, sun), sun);

    expect(() => JSON.stringify(scene)).not.toThrow();
    const roundTripped = JSON.parse(JSON.stringify(scene));
    expect(roundTripped.tiles).toHaveLength(3);
  });
});
