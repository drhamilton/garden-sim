// Deciduous seasonality.
//
// A deciduous tree's canopy is dense in its leaf-on season and sparse once the
// leaves drop, so its light transmittance is date-dependent. This module is the
// one place that resolves that: given a date, it selects each object's effective
// transmittance and hands back a garden the (date-agnostic) shadow pass can run
// on unchanged. The sun-hours aggregation calls `gardenForDate` per sampled day,
// so a bed under a bare tree in early spring reads as sunnier than in midsummer.
//
// Pure — no DOM, no renderer, no I/O.

import type { DeciduousRange, Garden, GardenObject } from './types';

/** A year-agnostic ordinal for an `MM-DD` string: month * 100 + day. */
function monthDayOrdinal(monthDay: string): number {
  const [month, day] = monthDay.split('-');
  return Number(month) * 100 + Number(day);
}

/** The UTC month/day of a date as the same ordinal as `monthDayOrdinal`. */
function dateOrdinal(date: Date): number {
  return (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

/**
 * Whether `date` falls in the leaf-on season — `[leafOn, leafOff)`, inclusive of
 * the leaf-on day and exclusive of the leaf-off day. When `leafOff` precedes
 * `leafOn` the season wraps the year-end (southern hemisphere).
 */
export function isLeafOn(range: DeciduousRange, date: Date): boolean {
  const leafOnOrdinal = monthDayOrdinal(range.leafOn);
  const leafOffOrdinal = monthDayOrdinal(range.leafOff);
  const dayOrdinal = dateOrdinal(date);
  // Within the year (leaf-on before leaf-off) it's a plain interval; when the
  // season wraps the year-end, leaf-on is everything outside [leafOff, leafOn).
  return leafOnOrdinal <= leafOffOrdinal
    ? dayOrdinal >= leafOnOrdinal && dayOrdinal < leafOffOrdinal
    : dayOrdinal >= leafOnOrdinal || dayOrdinal < leafOffOrdinal;
}

/**
 * The light transmittance an object presents on `date`. An evergreen object (no
 * deciduous range) uses its constant `transmittance` regardless of date; a
 * deciduous tree uses its leaf-on `transmittance` during the leaf-on season and
 * the range's `leafOffTransmittance` once bare.
 */
export function effectiveTransmittance(
  obj: GardenObject,
  date: Date,
): number | undefined {
  const { deciduousRange } = obj;
  if (!deciduousRange) return obj.transmittance;
  return isLeafOn(deciduousRange, date)
    ? obj.transmittance
    : deciduousRange.leafOffTransmittance;
}

/**
 * The garden as it stands on `date`: every deciduous object's `transmittance`
 * resolved to its effective seasonal value, leaving the date-agnostic shadow
 * pass nothing seasonal to reason about. Returns the input garden unchanged when
 * no object's transmittance differs on this date — evergreens always, and
 * deciduous trees while in their leaf-on season — so callers can compare by
 * reference to skip a needless heightfield rebuild.
 */
export function gardenForDate(garden: Garden, date: Date): Garden {
  let changed = false;
  const objects = garden.objects.map((obj) => {
    const transmittance = effectiveTransmittance(obj, date);
    if (transmittance === obj.transmittance) return obj;
    changed = true;
    return { ...obj, transmittance };
  });
  return changed ? { ...garden, objects } : garden;
}
