// Single-day sun-hours aggregation.
//
// Integrates the instantaneous shadow pass across a day's worth of sun
// positions to produce, per tile, the average sun-hours per day — the
// quantitative result the heatmap and (future) plants module consume.
//
// The aggregation is pure: it works from a list of pre-sampled sun positions
// (each weighted by the slice of the day it stands for), so the solar-position
// port stays at the edge and the core remains headlessly testable. Sampling a
// real day from the solar port is the caller's job; `sampleDay` is a small,
// port-agnostic helper for doing it.
//
// This slice integrates binary lit/shadow. Fractional (dappled) contributions
// and cross-day windows arrive in later slices; the seam — weighted samples in,
// per-day rate out — does not change.

import { computeLitGrid } from './shadow';
import type { Garden, SunPosition } from './types';

/** Default intra-day sampling step, in hours (15 minutes). */
export const DEFAULT_STEP_HOURS = 0.25;

/** Default interval between representative days when sampling a multi-day window. */
export const DEFAULT_SAMPLE_INTERVAL_DAYS = 7;

/** Looks up the sun's position a given number of hours into the day. */
export type SunAt = (hoursIntoDay: number) => SunPosition;

/** Looks up the sun's position for a specific date and time-of-day. */
export type SunAtDateTime = (date: Date, hoursIntoDay: number) => SunPosition;

/** One intra-day sample: the sun at an instant and the slice of day it covers. */
export interface DaySample {
  sun: SunPosition;
  /** Hours of the day this sample represents (the intra-day step). */
  weightHours: number;
}

/** Per-tile average sun-hours per day. */
export interface SunHoursGrid {
  width: number;
  depth: number;
  /** Average sun-hours per day, per tile, row-major. */
  hours: Float64Array;
}

/**
 * Samples a day at a fixed step, weighting each sample by the step it covers.
 * Night samples (sun below the horizon) are kept — they simply contribute zero
 * lit time downstream — so the caller needn't reason about sunrise/sunset.
 */
export function sampleDay(
  sunAt: SunAt,
  stepHours = DEFAULT_STEP_HOURS,
): DaySample[] {
  const count = Math.round(24 / stepHours);
  const samples: DaySample[] = [];
  for (let i = 0; i < count; i++) {
    samples.push({ sun: sunAt(i * stepHours), weightHours: stepHours });
  }
  return samples;
}

/**
 * Integrates the shadow pass across the samples into average sun-hours per day.
 * `dayCount` is the number of days the samples span (1 for a single day); the
 * accumulated lit time is divided by it, so the result is always a per-day
 * rate — never a cumulative total.
 */
export function aggregateSunHours(
  garden: Garden,
  samples: DaySample[],
  dayCount = 1,
): SunHoursGrid {
  const { width, depth } = garden;
  const hours = new Float64Array(width * depth);

  for (const { sun, weightHours } of samples) {
    if (sun.elevation <= 0) continue; // night: nothing is lit
    accumulateLitTime(hours, garden, sun, weightHours);
  }

  if (dayCount !== 1) {
    for (let i = 0; i < hours.length; i++) hours[i]! /= dayCount;
  }

  return { width, depth, hours };
}

/** Adds `weightHours` to every tile the shadow pass marks lit for this sun. */
function accumulateLitTime(
  hours: Float64Array,
  garden: Garden,
  sun: SunPosition,
  weightHours: number,
): void {
  const { lit } = computeLitGrid(garden, sun);
  for (let i = 0; i < hours.length; i++) {
    if (lit[i] === 1) hours[i]! += weightHours;
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Samples a multi-day window by picking representative days at `sampleIntervalDays`
 * intervals and calling `sampleDay` for each. Returns the combined samples and a
 * `dayCount` equal to the number of representative days — pass both to
 * `aggregateSunHours` to get average sun-hours per day over the window.
 */
export function sampleWindow(
  startDate: Date,
  endDate: Date,
  sunAt: SunAtDateTime,
  sampleIntervalDays = DEFAULT_SAMPLE_INTERVAL_DAYS,
  intraStepHours = DEFAULT_STEP_HOURS,
): { samples: DaySample[]; dayCount: number } {
  const dates = pickRepresentativeDays(startDate, endDate, sampleIntervalDays);
  const samples: DaySample[] = [];
  for (const date of dates) {
    const sunAtForDay: SunAt = (h) => sunAt(date, h);
    samples.push(...sampleDay(sunAtForDay, intraStepHours));
  }
  return { samples, dayCount: dates.length };
}

/** Selects one date every `intervalDays`, starting from `startDate`, up to `endDate`. */
function pickRepresentativeDays(
  startDate: Date,
  endDate: Date,
  intervalDays: number,
): Date[] {
  const dates: Date[] = [];
  let current = startDate.getTime();
  const end = endDate.getTime();
  const step = intervalDays * MS_PER_DAY;
  while (current <= end) {
    dates.push(new Date(current));
    current += step;
  }
  return dates;
}

