// Aggregation window presets.
//
// Pure date-range logic: maps a preset name (or custom bounds) to a concrete
// {start, end} Date pair. No DOM, no renderer, no I/O.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type WindowPreset = 'day' | 'month' | 'season' | 'custom';

/**
 * Returns the `{start, end}` date range for a given preset and reference date.
 * For `'custom'`, pass explicit `customStart` / `customEnd`; the pair is
 * normalised so `start <= end` regardless of input order.
 */
export function windowBounds(
  preset: WindowPreset,
  referenceDate: Date,
  customStart?: Date,
  customEnd?: Date,
): { start: Date; end: Date } {
  switch (preset) {
    case 'day':
      return { start: referenceDate, end: referenceDate };
    case 'month':
      return monthBounds(referenceDate);
    case 'season':
      return seasonBounds(referenceDate);
    case 'custom': {
      const a = customStart ?? referenceDate;
      const b = customEnd ?? referenceDate;
      return a <= b ? { start: a, end: b } : { start: b, end: a };
    }
  }
}

function monthBounds(d: Date): { start: Date; end: Date } {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return {
    start: new Date(Date.UTC(y, m, 1)),
    end: new Date(Date.UTC(y, m + 1, 0)),
  };
}

/**
 * Approximate astronomical season containing `d` (UTC).
 * Boundaries are fixed-date approximations; exact equinoxes vary by year.
 */
function seasonBounds(d: Date): { start: Date; end: Date } {
  const y = d.getUTCFullYear();
  const seasons: Array<{ start: Date; end: Date }> = [
    // Winter (prev year Dec 21 – Mar 19)
    {
      start: new Date(Date.UTC(y - 1, 11, 21)),
      end: new Date(Date.UTC(y, 2, 19)),
    },
    // Spring (Mar 20 – Jun 20)
    { start: new Date(Date.UTC(y, 2, 20)), end: new Date(Date.UTC(y, 5, 20)) },
    // Summer (Jun 21 – Sep 22)
    { start: new Date(Date.UTC(y, 5, 21)), end: new Date(Date.UTC(y, 8, 22)) },
    // Autumn (Sep 23 – Dec 20)
    { start: new Date(Date.UTC(y, 8, 23)), end: new Date(Date.UTC(y, 11, 20)) },
    // Winter (Dec 21 – next Mar 19)
    {
      start: new Date(Date.UTC(y, 11, 21)),
      end: new Date(Date.UTC(y + 1, 2, 19)),
    },
  ];
  const t = d.getTime();
  return (
    seasons.find((s) => t >= s.start.getTime() && t <= s.end.getTime()) ??
    seasons[1]!
  );
}

/** 30 days after `date`, as an ISO date string (for default custom-range init). */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}
