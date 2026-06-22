import { describe, expect, it } from 'vitest';
import { computeSunFractionGrid } from './shadow';
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

/** Treats a tile as "lit" when it receives any direct sun (fraction > 0). */
function litAt(garden: Garden, sun: { azimuth: number; elevation: number }) {
  const grid = computeSunFractionGrid(garden, sun);
  return (x: number, y = 0) =>
    grid.fraction[tileIndex(garden.width, x, y)]! > 0;
}

describe('computeSunFractionGrid — shadow geometry (opaque blockers)', () => {
  it('puts every tile in shadow when the sun is below the horizon', () => {
    const garden = strip(5, [
      {
        kind: 'building',
        footprint: { x: 2, y: 0, width: 1, depth: 1 },
        baseLevel: 0,
        heightM: 3,
      },
    ]);
    const grid = computeSunFractionGrid(garden, {
      azimuth: 90 * DEG,
      elevation: -5 * DEG,
    });
    expect([...grid.fraction]).toEqual([0, 0, 0, 0, 0]);
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
    const grid = computeSunFractionGrid(garden, {
      azimuth: 90 * DEG,
      elevation: 20 * DEG,
    });
    const lit = (y: number) => grid.fraction[tileIndex(1, 0, y)]! > 0;
    // Rays march toward +y; tiles below the blocker (y<2) are shadowed.
    expect(lit(0)).toBe(false);
    expect(lit(1)).toBe(false);
    expect(lit(2)).toBe(false); // covered
    expect(lit(3)).toBe(true);
    expect(lit(4)).toBe(true);
  });
});

/** A transmissive canopy of the given transmittance at column `x` on a strip. */
function canopy(x: number, transmittance: number): GardenObject {
  return {
    kind: 'tree',
    footprint: { x, y: 0, width: 1, depth: 1 },
    baseLevel: 0,
    heightM: 3,
    transmittance,
  };
}

function fractionAt(
  garden: Garden,
  sun: { azimuth: number; elevation: number },
) {
  const grid = computeSunFractionGrid(garden, sun);
  return (x: number, y = 0) => grid.fraction[tileIndex(garden.width, x, y)]!;
}

describe('computeSunFractionGrid — dappled (fractional) shade', () => {
  const highEast = { azimuth: 90 * DEG, elevation: 60 * DEG };
  const lowEast = { azimuth: 90 * DEG, elevation: 10 * DEG };

  it('gives an unobstructed tile the full light fraction', () => {
    const fraction = fractionAt(strip(3), highEast);
    expect(fraction(0)).toBeCloseTo(1);
  });

  it('gives a tile under a 50% canopy half the light of an open tile', () => {
    // Tree at x=1; the tile under it sees light through the canopy only.
    const garden = strip(3, [canopy(1, 0.5)]);
    const fraction = fractionAt(garden, highEast);
    expect(fraction(1)).toBeCloseTo(0.5);
    // x=2 is east of the tree; with the sun in the east its ray marches away
    // from the canopy → unobstructed.
    expect(fraction(2)).toBeCloseTo(1);
  });

  it('combines distinct transmissive blockers multiplicatively', () => {
    // Two separate 50% canopies east of x=0; a low sun's ray crosses both.
    const garden = strip(5, [canopy(2, 0.5), canopy(3, 0.5)]);
    const fraction = fractionAt(garden, lowEast);
    expect(fraction(0)).toBeCloseTo(0.25);
  });

  it('attenuates by a multi-tile canopy once, not once per tile crossed', () => {
    // One 50% tree three tiles wide. A grazing ray from x=0 passes through
    // several of its tiles, but it is a single object → halved, not 0.5³.
    const wideTree: GardenObject = {
      kind: 'tree',
      footprint: { x: 2, y: 0, width: 3, depth: 1 },
      baseLevel: 0,
      heightM: 3,
      transmittance: 0.5,
    };
    const fraction = fractionAt(strip(6, [wideTree]), lowEast);
    expect(fraction(0)).toBeCloseTo(0.5);
  });

  it('gives a fully opaque object hard-edged shadow — no light through it', () => {
    const garden = strip(5, [
      {
        kind: 'building',
        footprint: { x: 2, y: 0, width: 1, depth: 1 },
        baseLevel: 0,
        heightM: 3,
      },
    ]);
    const fraction = fractionAt(garden, lowEast);
    const lit = litAt(garden, lowEast);
    // West of the opaque building: blocked → no light at all.
    expect(fraction(0)).toBe(0);
    expect(lit(0)).toBe(false);
    // East of it: open → full light.
    expect(fraction(4)).toBeCloseTo(1);
    expect(lit(4)).toBe(true);
  });

  it('puts the whole grid in darkness when the sun is below the horizon', () => {
    const garden = strip(3, [canopy(1, 0.5)]);
    const grid = computeSunFractionGrid(garden, {
      azimuth: 90 * DEG,
      elevation: -5 * DEG,
    });
    expect([...grid.fraction]).toEqual([0, 0, 0]);
  });
});
