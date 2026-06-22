import { describe, expect, it } from 'vitest';
import { sunMarkerPlacement } from './sun-marker';

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
