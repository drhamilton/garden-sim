import { describe, expect, it } from 'vitest';
import { DEFAULT_STEP_HOURS, aggregateSunHours, sampleDay } from './sun-hours';
import type { DaySample } from './sun-hours';
import type { Garden, GardenObject, SunPosition } from './types';
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

/**
 * One stylised day: the sun arcs east → overhead → west at a fixed elevation,
 * one sample per hour of daylight, plus a night sample that must contribute
 * nothing. Each daylight sample is one hour wide.
 */
function arcDay(): DaySample[] {
  const elevation = 30 * DEG;
  const daylight: DaySample[] = [
    { azimuth: 90 * DEG, elevation }, // sun in the east
    { azimuth: 135 * DEG, elevation },
    { azimuth: 180 * DEG, elevation }, // due south
    { azimuth: 225 * DEG, elevation },
    { azimuth: 270 * DEG, elevation }, // sun in the west
  ].map((sun) => ({ sun, weightHours: 1 }));
  const night: DaySample = {
    sun: { azimuth: 0, elevation: -10 * DEG },
    weightHours: 1,
  };
  return [...daylight, night];
}

describe('sampleDay — intra-day sampling', () => {
  it('covers the whole day at the default step, weighted by the step', () => {
    const noon: SunPosition = { azimuth: 180 * DEG, elevation: 60 * DEG };
    const samples = sampleDay(() => noon);

    const total = samples.reduce((sum, s) => sum + s.weightHours, 0);
    expect(total).toBeCloseTo(24);
    expect(samples).toHaveLength(Math.round(24 / DEFAULT_STEP_HOURS));
  });

  it('accepts a tunable step', () => {
    const noon: SunPosition = { azimuth: 180 * DEG, elevation: 60 * DEG };
    const hourly = sampleDay(() => noon, 1);
    expect(hourly).toHaveLength(24);
    expect(hourly.every((s) => s.weightHours === 1)).toBe(true);
  });

  it('passes the hour-into-day to the sun lookup', () => {
    const seen: number[] = [];
    sampleDay((hour) => {
      seen.push(hour);
      return { azimuth: 0, elevation: 0 };
    }, 6);
    expect(seen).toEqual([0, 6, 12, 18]);
  });
});

describe('aggregateSunHours — single-day sun-hours per tile', () => {
  it('gives an open tile the full daylight total and a blocked tile markedly less', () => {
    // A tall wall at x=2 on a strip; the sun never climbs high, so it throws
    // a long shadow over the tile right beside it for much of the day.
    const garden = strip(5, [
      {
        kind: 'building',
        footprint: { x: 2, y: 0, width: 1, depth: 1 },
        baseLevel: 0,
        heightM: 5,
      },
    ]);
    const grid = aggregateSunHours(garden, arcDay());
    const hoursAt = (x: number) => grid.hours[tileIndex(garden.width, x, 0)]!;

    // x=0 is the far west open tile: lit whenever the sun is up (5h daylight).
    expect(hoursAt(0)).toBeGreaterThan(0);
    // The building tile itself is covered → little to no direct sun.
    expect(hoursAt(2)).toBeLessThan(hoursAt(4));
    // The night sample contributes nothing: no tile exceeds the 5h of daylight.
    expect(hoursAt(4)).toBeLessThanOrEqual(5);
  });

  it('reports average sun-hours per day, dividing accumulated time by day count', () => {
    const garden = strip(3); // open, no blockers
    const oneDay = aggregateSunHours(garden, arcDay(), 1);
    const sameSamplesTwoDays = aggregateSunHours(garden, arcDay(), 2);

    const open = tileIndex(3, 1, 0);
    // Open tile sees all 5 daylight hours; per-day average halves over 2 days.
    expect(oneDay.hours[open]).toBeCloseTo(5);
    expect(sameSamplesTwoDays.hours[open]).toBeCloseTo(2.5);
  });

  it('ignores samples taken while the sun is below the horizon', () => {
    const garden = strip(3);
    const night: DaySample[] = [
      { sun: { azimuth: 0, elevation: -5 * DEG }, weightHours: 10 },
    ];
    const grid = aggregateSunHours(garden, night);
    expect([...grid.hours]).toEqual([0, 0, 0]);
  });

  it('locates the sunniest and shadiest tiles', () => {
    const garden = strip(5, [
      {
        kind: 'building',
        footprint: { x: 2, y: 0, width: 1, depth: 1 },
        baseLevel: 0,
        heightM: 5,
      },
    ]);
    const grid = aggregateSunHours(garden, arcDay());

    expect(grid.maxHours).toBe(grid.hours[grid.sunniestIndex]);
    expect(grid.minHours).toBe(grid.hours[grid.shadiestIndex]);
    expect(grid.maxHours).toBeGreaterThan(grid.minHours);
    // The covered building tile is the shadiest.
    expect(grid.shadiestIndex).toBe(tileIndex(garden.width, 2, 0));
  });
});
