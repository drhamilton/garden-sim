import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STEP_HOURS,
  aggregateSunHours,
  sampleDay,
  sampleWindow,
} from './sun-hours';
import type { DaySample, SunAtDateTime } from './sun-hours';
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


});

describe('sampleWindow — multi-day window sampling', () => {
  const noon: SunAtDateTime = () => ({ azimuth: 180 * DEG, elevation: 60 * DEG });

  it('picks representative days at the given interval and returns the count', () => {
    // June has 30 days; weekly sampling from June 1 → June 1, 8, 15, 22, 29 = 5 days.
    const { samples, dayCount } = sampleWindow(
      new Date('2025-06-01'),
      new Date('2025-06-30'),
      noon,
      7,
      1, // hourly intra-day step: 24 samples per day
    );
    expect(dayCount).toBe(5);
    expect(samples).toHaveLength(5 * 24);
    expect(samples.every((s) => s.weightHours === 1)).toBe(true);
  });

  it('uses a single representative day for a one-day window', () => {
    const date = new Date('2025-06-21');
    const { samples, dayCount } = sampleWindow(date, date, noon, 7, 1);
    expect(dayCount).toBe(1);
    expect(samples).toHaveLength(24);
  });

  it('passes the representative date and intra-day hour to the sunAt callback', () => {
    const calls: Array<{ date: Date; hour: number }> = [];
    const capture: SunAtDateTime = (date, hour) => {
      calls.push({ date, hour });
      return { azimuth: 0, elevation: 0 };
    };
    sampleWindow(
      new Date('2025-06-01'),
      new Date('2025-06-01'),
      capture,
      7,
      6, // 4 intra-day samples: hours 0, 6, 12, 18
    );
    expect(calls).toHaveLength(4);
    expect(calls.map((c) => c.hour)).toEqual([0, 6, 12, 18]);
    expect(calls[0]!.date.toISOString().startsWith('2025-06-01')).toBe(true);
  });

  it('a summer window yields higher average sun-hours per day than a winter window', () => {
    const garden = strip(3);

    // Synthetic seasons: summer sun up 07:00–17:00 (10h), winter 10:00–14:00 (4h).
    const summerSunAt: SunAtDateTime = (_, hour) => ({
      azimuth: 180 * DEG,
      elevation: hour >= 7 && hour < 17 ? 40 * DEG : -10 * DEG,
    });
    const winterSunAt: SunAtDateTime = (_, hour) => ({
      azimuth: 180 * DEG,
      elevation: hour >= 10 && hour < 14 ? 15 * DEG : -10 * DEG,
    });

    const { samples: sS, dayCount: sDC } = sampleWindow(
      new Date('2025-06-01'),
      new Date('2025-06-30'),
      summerSunAt,
      7,
      1,
    );
    const { samples: wS, dayCount: wDC } = sampleWindow(
      new Date('2025-12-01'),
      new Date('2025-12-31'),
      winterSunAt,
      7,
      1,
    );

    const summerGrid = aggregateSunHours(garden, sS, sDC);
    const winterGrid = aggregateSunHours(garden, wS, wDC);
    const openTile = tileIndex(3, 1, 0);

    expect(summerGrid.hours[openTile]).toBeGreaterThan(winterGrid.hours[openTile]!);
    // Open tile: no blockers → full daylight each sample day.
    expect(summerGrid.hours[openTile]).toBeCloseTo(10);
    expect(winterGrid.hours[openTile]).toBeCloseTo(4);
  });
});
