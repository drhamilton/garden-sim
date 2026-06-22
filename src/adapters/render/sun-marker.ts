// Sun-marker placement math.
//
// Pure geometry for the visible sun marker in the isometric view: maps a sun
// position (azimuth/elevation) to a world-space point on a sphere around the
// garden centre, and reports whether the sun is above the horizon (so the
// renderer can hide the marker at night). Kept engine-free so the placement —
// the heart of issue #23 — is headlessly testable without WebGL.
//
// The marker lives in the renderer's fixed world frame (true north = world +Z),
// the same frame the directional sun-light uses (see `updateSun`). The garden
// group is rotated by -northRotation beneath that frame, so a fixed-world sun is
// automatically correct relative to the garden's orientation — there is no
// northRotation term here.

import type { SunPosition } from '../../core';

export interface SunMarkerPlacement {
  /** World-space position for the marker. */
  position: { x: number; y: number; z: number };
  /** True when the sun is above the horizon; the renderer hides it otherwise. */
  aboveHorizon: boolean;
}

/**
 * Places the sun marker `radius` world-units from the garden centre along the
 * sun's azimuth/elevation direction. Compass convention: azimuth 0 → world +Z
 * (true north), azimuth +π/2 → world +X (east); elevation 0 → horizon, +π/2 →
 * zenith (world +Y). The sun exactly on the horizon counts as not above it.
 */
export function sunMarkerPlacement(
  sun: SunPosition,
  centre: { x: number; z: number },
  radius: number,
): SunMarkerPlacement {
  const { azimuth, elevation } = sun;
  const cosElevation = Math.cos(elevation);
  return {
    position: {
      x: centre.x + Math.sin(azimuth) * cosElevation * radius,
      y: Math.sin(elevation) * radius,
      z: centre.z + Math.cos(azimuth) * cosElevation * radius,
    },
    aboveHorizon: elevation > 0,
  };
}
