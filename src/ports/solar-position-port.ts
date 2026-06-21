// Solar-position port.
//
// The core depends on this interface to learn where the sun is; a concrete
// adapter (wrapping a standard solar algorithm) provides it. Keeping it behind
// a port makes the algorithm swappable and lets tests drive the core with
// deterministic stub positions.

import type { SunPosition } from '../core/types';

export interface SolarQuery {
  latitude: number;
  longitude: number;
  /** The instant to compute the sun's position for. */
  date: Date;
}

export interface SolarPositionPort {
  /**
   * The sun's position for a location and instant, in the core's convention:
   * azimuth as a compass bearing clockwise from true north, elevation above
   * the horizon (negative below it).
   */
  getSunPosition(query: SolarQuery): SunPosition;
}
