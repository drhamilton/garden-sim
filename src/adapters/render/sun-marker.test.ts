import { describe, expect, it } from 'vitest';
import type { SunPosition } from '../../core';
import { sunArcPath, sunMarkerPlacement } from './sun-marker';

const CENTRE = { x: 6, z: 6 };
const R = 10;

describe('sunMarkerPlacement', () => {
  it('places a sun due north on the horizon at world +Z from the centre', () => {
    const { position, aboveHorizon } = sunMarkerPlacement(
      { azimuth: 0, elevation: 0 },
      CENTRE,
      R,
    );
    expect(position.x).toBeCloseTo(6);
    expect(position.y).toBeCloseTo(0);
    expect(position.z).toBeCloseTo(16); // centre.z + R
    // Exactly on the horizon is treated as not above it (hidden).
    expect(aboveHorizon).toBe(false);
  });

  it('places a sun due east on the horizon at world +X from the centre', () => {
    const { position } = sunMarkerPlacement(
      { azimuth: Math.PI / 2, elevation: 0.1 },
      CENTRE,
      R,
    );
    expect(position.x).toBeGreaterThan(6); // east of centre
    expect(position.z).toBeCloseTo(6); // no north/south component
  });

  it('places a sun due south to the -Z side of the centre', () => {
    const { position } = sunMarkerPlacement(
      { azimuth: Math.PI, elevation: 0.2 },
      CENTRE,
      R,
    );
    expect(position.x).toBeCloseTo(6);
    expect(position.z).toBeLessThan(6); // south of centre
  });

  it('puts a higher sun higher (greater elevation → greater y)', () => {
    const low = sunMarkerPlacement({ azimuth: 0, elevation: 0.3 }, CENTRE, R);
    const high = sunMarkerPlacement({ azimuth: 0, elevation: 1.0 }, CENTRE, R);
    expect(high.position.y).toBeGreaterThan(low.position.y);
  });

  it('puts a sun at the zenith straight up, regardless of azimuth', () => {
    const { position } = sunMarkerPlacement(
      { azimuth: 1.234, elevation: Math.PI / 2 },
      CENTRE,
      R,
    );
    expect(position.x).toBeCloseTo(6);
    expect(position.z).toBeCloseTo(6);
    expect(position.y).toBeCloseTo(R);
  });

  it('keeps the marker on a sphere of the given radius about the centre', () => {
    const { position } = sunMarkerPlacement(
      { azimuth: 2.1, elevation: 0.7 },
      CENTRE,
      R,
    );
    const dist = Math.hypot(
      position.x - CENTRE.x,
      position.y,
      position.z - CENTRE.z,
    );
    expect(dist).toBeCloseTo(R);
  });

  it('reports the sun as below the horizon when its elevation is negative', () => {
    const { position, aboveHorizon } = sunMarkerPlacement(
      { azimuth: 0, elevation: -0.2 },
      CENTRE,
      R,
    );
    expect(aboveHorizon).toBe(false);
    expect(position.y).toBeLessThan(0);
  });

  it('reports the sun as above the horizon when its elevation is positive', () => {
    expect(
      sunMarkerPlacement({ azimuth: 0, elevation: 0.01 }, CENTRE, R)
        .aboveHorizon,
    ).toBe(true);
  });
});

/** A day-arc that climbs from below the horizon, peaks, and dips back below. */
function sampleArc(elevations: number[], azimuths?: number[]): SunPosition[] {
  return elevations.map((elevation, i) => ({
    elevation,
    azimuth: azimuths?.[i] ?? Math.PI, // due south by default
  }));
}

describe('sunArcPath', () => {
  it('returns no points when the sun never rises (all below horizon)', () => {
    const path = sunArcPath(sampleArc([-0.5, -0.3, -0.1]), CENTRE, R);
    expect(path).toEqual([]);
  });

  it('maps every above-horizon sample onto the dome of the given radius', () => {
    const path = sunArcPath(sampleArc([0.2, 0.6, 0.4]), CENTRE, R);
    expect(path.length).toBe(3);
    for (const p of path) {
      const dist = Math.hypot(p.x - CENTRE.x, p.y, p.z - CENTRE.z);
      expect(dist).toBeCloseTo(R);
      expect(p.y).toBeGreaterThan(0); // above the ground plane
    }
  });

  it('rides the same dome as the marker (a sample lands where its marker would)', () => {
    const sun = { azimuth: 2.1, elevation: 0.7 };
    const [point] = sunArcPath([sun], CENTRE, R);
    const { position } = sunMarkerPlacement(sun, CENTRE, R);
    expect(point?.x).toBeCloseTo(position.x);
    expect(point?.y).toBeCloseTo(position.y);
    expect(point?.z).toBeCloseTo(position.z);
  });

  it('brackets the above-horizon span with points on the horizon circle', () => {
    // Below → above → above → below: the path starts and ends at elevation 0
    // (y = 0) so the arc meets the dome base rather than starting mid-air.
    const path = sunArcPath(sampleArc([-0.1, 0.3, 0.5, -0.1]), CENTRE, R);
    expect(path.length).toBe(4); // 2 interpolated horizon ends + 2 samples
    expect(path[0]?.y).toBeCloseTo(0);
    expect(path[path.length - 1]?.y).toBeCloseTo(0);
    // The interior samples sit above the ground.
    expect(path[1]?.y).toBeGreaterThan(0);
    expect(path[2]?.y).toBeGreaterThan(0);
  });

  it('orders the path as the day runs (ascending then descending y)', () => {
    const path = sunArcPath(sampleArc([0.1, 0.5, 0.9, 0.5, 0.1]), CENTRE, R);
    const ys = path.map((p) => p.y);
    expect(ys[0]).toBeLessThan(ys[2]!); // climbs to the peak
    expect(ys[4]).toBeLessThan(ys[2]!); // descends after it
  });
});
