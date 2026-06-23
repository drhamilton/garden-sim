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

type DomePoint = SunMarkerPlacement['position'];

/** A point on the sky dome for a sun position — the marker's placement, sans flag. */
function onDome(
  sun: SunPosition,
  centre: { x: number; z: number },
  radius: number,
): DomePoint {
  return sunMarkerPlacement(sun, centre, radius).position;
}

/**
 * Maps a day's worth of sampled sun positions onto the sky dome and returns the
 * world-space polyline of its above-horizon span — the arc the sun traces
 * across the sky for the current date/location. The marker rides this same dome
 * (see {@link sunMarkerPlacement}), so at any scrubbed time it sits on the path,
 * and a low (dawn/dusk) sun reads as early/late on the arc rather than colliding
 * with the ground.
 *
 * Below-horizon samples are dropped, and where consecutive samples cross the
 * horizon the crossing point (elevation 0, so y = 0) is interpolated in, so the
 * arc starts and ends on the dome's base rather than mid-air at the first
 * sampled sunrise point. `positions` are expected in chronological order.
 */
export function sunArcPath(
  positions: SunPosition[],
  centre: { x: number; z: number },
  radius: number,
): DomePoint[] {
  const path: DomePoint[] = [];
  for (let i = 0; i < positions.length; i++) {
    const cur = positions[i]!;
    const prev = i > 0 ? positions[i - 1] : undefined;
    const curAbove = cur.elevation > 0;
    const prevAbove = prev !== undefined && prev.elevation > 0;
    // A sunrise (below → above) or sunset (above → below) between samples:
    // splice in the exact horizon crossing so the arc meets the dome base.
    if (prev !== undefined && curAbove !== prevAbove) {
      path.push(onDome(horizonCrossing(prev, cur), centre, radius));
    }
    if (curAbove) path.push(onDome(cur, centre, radius));
  }
  return path;
}

/**
 * The sun position where the segment between two straddling samples meets the
 * horizon: elevation pinned to 0, azimuth linearly interpolated by where the
 * elevation hits zero. Samples are close in time, so a plain azimuth lerp is fine.
 */
function horizonCrossing(a: SunPosition, b: SunPosition): SunPosition {
  const t = a.elevation / (a.elevation - b.elevation);
  return {
    elevation: 0,
    azimuth: a.azimuth + (b.azimuth - a.azimuth) * t,
  };
}
