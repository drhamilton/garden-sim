import { describe, expect, it } from 'vitest';
import { effectiveTransmittance, gardenForDate, isLeafOn } from './seasonality';
import type { DeciduousRange, Garden, GardenObject } from './types';

const NORTHERN: DeciduousRange = {
  leafOn: '04-15',
  leafOff: '10-31',
  leafOffTransmittance: 0.8,
};

/** A UTC date for a given month/day (year is irrelevant to the comparison). */
function on(month: number, day: number): Date {
  return new Date(Date.UTC(2025, month - 1, day));
}

describe('isLeafOn — year-agnostic season membership', () => {
  it('is true inside the leaf-on season and false in the bare season', () => {
    expect(isLeafOn(NORTHERN, on(7, 1))).toBe(true); // midsummer
    expect(isLeafOn(NORTHERN, on(1, 15))).toBe(false); // deep winter
  });

  it('includes the leaf-on day and excludes the leaf-off day', () => {
    expect(isLeafOn(NORTHERN, on(4, 15))).toBe(true); // first leafy day
    expect(isLeafOn(NORTHERN, on(10, 31))).toBe(false); // first bare day
    expect(isLeafOn(NORTHERN, on(10, 30))).toBe(true); // last leafy day
  });

  it('wraps the year-end when leaf-off precedes leaf-on (southern hemisphere)', () => {
    const southern: DeciduousRange = {
      leafOn: '10-01',
      leafOff: '04-01',
      leafOffTransmittance: 0.8,
    };
    expect(isLeafOn(southern, on(1, 1))).toBe(true); // southern summer
    expect(isLeafOn(southern, on(7, 1))).toBe(false); // southern winter
    expect(isLeafOn(southern, on(10, 1))).toBe(true); // boundary, inclusive
    expect(isLeafOn(southern, on(4, 1))).toBe(false); // boundary, exclusive
  });
});

describe('effectiveTransmittance — date-selected canopy density', () => {
  const tree: GardenObject = {
    kind: 'tree',
    footprint: { x: 0, y: 0, width: 1, depth: 1 },
    baseLevel: 0,
    heightM: 5,
    transmittance: 0.3,
    deciduousRange: NORTHERN,
  };

  it('uses the dense leaf-on transmittance in summer', () => {
    expect(effectiveTransmittance(tree, on(7, 1))).toBe(0.3);
  });

  it('uses the sparse leaf-off transmittance in the bare season', () => {
    expect(effectiveTransmittance(tree, on(1, 1))).toBe(0.8);
  });

  it('uses a single constant transmittance for an evergreen (no range)', () => {
    const evergreen: GardenObject = { ...tree, deciduousRange: undefined };
    expect(effectiveTransmittance(evergreen, on(7, 1))).toBe(0.3);
    expect(effectiveTransmittance(evergreen, on(1, 1))).toBe(0.3);
  });
});

describe('gardenForDate — seasonally-resolved garden', () => {
  const baseGarden: Garden = {
    width: 1,
    depth: 1,
    groundLevels: [0],
    objects: [],
    northRotation: 0,
    latitude: 0,
    longitude: 0,
  };
  const deciduous: GardenObject = {
    kind: 'tree',
    footprint: { x: 0, y: 0, width: 1, depth: 1 },
    baseLevel: 0,
    heightM: 5,
    transmittance: 0.3,
    deciduousRange: NORTHERN,
  };

  it('swaps in the leaf-off transmittance for the bare season', () => {
    const garden = { ...baseGarden, objects: [deciduous] };
    const winter = gardenForDate(garden, on(1, 1));
    expect(winter.objects[0]!.transmittance).toBe(0.8);
  });

  it('leaves leaf-on transmittance untouched in summer', () => {
    const garden = { ...baseGarden, objects: [deciduous] };
    const summer = gardenForDate(garden, on(7, 1));
    expect(summer.objects[0]!.transmittance).toBe(0.3);
  });

  it('returns the same garden reference when nothing is deciduous', () => {
    const evergreen: GardenObject = { ...deciduous, deciduousRange: undefined };
    const garden = { ...baseGarden, objects: [evergreen] };
    expect(gardenForDate(garden, on(1, 1))).toBe(garden);
  });
});
