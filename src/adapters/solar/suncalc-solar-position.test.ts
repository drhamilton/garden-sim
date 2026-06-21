import { describe, expect, it } from 'vitest';
import { SunCalcSolarPosition } from './suncalc-solar-position';

const DEG = 180 / Math.PI;

describe('SunCalcSolarPosition', () => {
  // Known-value check: Greenwich (lat 51.4791, lon 0) on the 2025 summer
  // solstice near solar noon. The sun should be high and roughly due south.
  // Geometric noon elevation = 90 − (latitude − solar declination)
  //   ≈ 90 − (51.48 − 23.44) ≈ 62°, and azimuth ≈ 180° (south).
  it('matches a known solar position at Greenwich, summer-solstice noon', () => {
    const solar = new SunCalcSolarPosition();
    const { azimuth, elevation } = solar.getSunPosition({
      latitude: 51.4791,
      longitude: 0,
      date: new Date('2025-06-21T12:00:00Z'),
    });

    expect(elevation * DEG).toBeGreaterThan(58);
    expect(elevation * DEG).toBeLessThan(64);

    // Compass bearing close to due south (180°) — this also pins the
    // from-north convention: SunCalc's raw from-south value would be ~0°.
    expect(azimuth * DEG).toBeGreaterThan(168);
    expect(azimuth * DEG).toBeLessThan(192);
  });

  it('reports the sun below the horizon at local midnight', () => {
    const solar = new SunCalcSolarPosition();
    const { elevation } = solar.getSunPosition({
      latitude: 51.4791,
      longitude: 0,
      date: new Date('2025-06-21T00:00:00Z'),
    });
    expect(elevation).toBeLessThan(0);
  });
});
