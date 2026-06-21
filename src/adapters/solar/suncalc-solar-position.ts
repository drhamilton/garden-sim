// Solar-position adapter backed by SunCalc (v2).
//
// SunCalc v2 reports a north-based clockwise azimuth in degrees
// (0 = N, 90 = E, 180 = S, 270 = W) and a refraction-corrected altitude in
// degrees — the same orientation the core uses, just in degrees. The adapter
// only converts to radians.
//
// (Note: @types/suncalc still describes the v1 API, where the values are in
// radians and azimuth is measured from south. The installed runtime is v2; the
// conversion below matches the runtime, and this port keeps that detail from
// leaking into the core.)

import { getPosition } from 'suncalc';
import type { SolarPositionPort, SolarQuery } from '../../ports';
import type { SunPosition } from '../../core';

const DEG_TO_RAD = Math.PI / 180;

export class SunCalcSolarPosition implements SolarPositionPort {
  getSunPosition({ latitude, longitude, date }: SolarQuery): SunPosition {
    const { azimuth, altitude } = getPosition(date, latitude, longitude);
    return {
      azimuth: azimuth * DEG_TO_RAD,
      elevation: altitude * DEG_TO_RAD,
    };
  }
}
