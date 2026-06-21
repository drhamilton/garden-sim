import { describe, expect, it } from 'vitest';
import { computeLitGrid } from './shadow';
import type { Garden, GardenObject } from './types';
import { tileIndex } from './types';

const DEG = Math.PI / 180;

/** A flat west–east strip of tiles (depth 1) at ground level, no rotation. */
function strip(width: number, objects: GardenObject[] = []): Garden {
  return {
    width,
    depth: 1,
    groundLevels: new Array(width).fill(0),
    objects,
    northRotation: 0,
    latitude: 0,
    longitude: 0,
  };
}

function litAt(garden: Garden, sun: { azimuth: number; elevation: number }) {
  const grid = computeLitGrid(garden, sun);
  return (x: number, y = 0) => grid.lit[tileIndex(garden.width, x, y)] === 1;
}

describe('computeLitGrid — instantaneous shadow pass', () => {
  it('puts every tile in shadow when the sun is below the horizon', () => {
    const garden = strip(5, [
      {
        kind: 'building',
        footprint: { x: 2, y: 0, width: 1, depth: 1 },
        baseLevel: 0,
        heightM: 3,
      },
    ]);
    const grid = computeLitGrid(garden, {
      azimuth: 90 * DEG,
      elevation: -5 * DEG,
    });
    expect([...grid.lit]).toEqual([0, 0, 0, 0, 0]);
  });

  it('casts a blocker shadow away from the sun (sun in the east → shadow to the west)', () => {
    // Building at x=2. Sun due east at a low elevation.
    const garden = strip(5, [
      {
        kind: 'building',
        footprint: { x: 2, y: 0, width: 1, depth: 1 },
        baseLevel: 0,
        heightM: 3,
      },
    ]);
    const lit = litAt(garden, { azimuth: 90 * DEG, elevation: 20 * DEG });

    // West of the building: rays march east into the building → shadowed.
    expect(lit(0)).toBe(false);
    expect(lit(1)).toBe(false);
    // The building tile itself is covered → shadowed.
    expect(lit(2)).toBe(false);
    // East of the building: rays march east, away from it → lit.
    expect(lit(3)).toBe(true);
    expect(lit(4)).toBe(true);
  });

  it('mirrors the shadow direction when the sun moves to the west', () => {
    const garden = strip(5, [
      {
        kind: 'building',
        footprint: { x: 2, y: 0, width: 1, depth: 1 },
        baseLevel: 0,
        heightM: 3,
      },
    ]);
    const lit = litAt(garden, { azimuth: 270 * DEG, elevation: 20 * DEG });

    // Sun in the west → shadow falls to the east.
    expect(lit(0)).toBe(true);
    expect(lit(1)).toBe(true);
    expect(lit(2)).toBe(false); // covered
    expect(lit(3)).toBe(false);
    expect(lit(4)).toBe(false);
  });

  it('shortens shadows as the sun climbs (high sun leaves distant tiles lit)', () => {
    const garden = strip(8, [
      {
        kind: 'building',
        footprint: { x: 7, y: 0, width: 1, depth: 1 },
        baseLevel: 0,
        heightM: 1,
      },
    ]);
    // Low sun in the east: a 1m blocker shades far to the west.
    const low = litAt(garden, { azimuth: 90 * DEG, elevation: 10 * DEG });
    expect(low(0)).toBe(false);
    // High sun: the same blocker barely shades anything to the west.
    const high = litAt(garden, { azimuth: 90 * DEG, elevation: 80 * DEG });
    expect(high(0)).toBe(true);
  });

  it('honours north rotation — rotating the garden rotates the shadow', () => {
    // Sun due east. With the garden rotated 90° clockwise, the sun's
    // grid-relative bearing becomes 0 (grid +y), so the shadow falls along -y.
    const garden: Garden = {
      width: 1,
      depth: 5,
      groundLevels: new Array(5).fill(0),
      objects: [
        {
          kind: 'building',
          footprint: { x: 0, y: 2, width: 1, depth: 1 },
          baseLevel: 0,
          heightM: 3,
        },
      ],
      northRotation: 90 * DEG,
      latitude: 0,
      longitude: 0,
    };
    const grid = computeLitGrid(garden, {
      azimuth: 90 * DEG,
      elevation: 20 * DEG,
    });
    const lit = (y: number) => grid.lit[tileIndex(1, 0, y)] === 1;
    // Rays march toward +y; tiles below the blocker (y<2) are shadowed.
    expect(lit(0)).toBe(false);
    expect(lit(1)).toBe(false);
    expect(lit(2)).toBe(false); // covered
    expect(lit(3)).toBe(true);
    expect(lit(4)).toBe(true);
  });
});
