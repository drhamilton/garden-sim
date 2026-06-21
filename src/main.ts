// App shell entry point (sun-sim spine).
//
// Wires every architectural seam over a hardcoded garden:
//   garden model → solar-position port → shadow pass → scene description
//   → Three.js renderer port, driven by a vanilla time-of-day slider.
//
// Location, true-north rotation, and the date are fixed inputs in this slice;
// a later slice makes them editable. State is in-memory only.

import type { Garden, SunPosition } from './core';
import {
  aggregateSunHours,
  buildHeatmapScene,
  buildScene,
  computeLitGrid,
  sampleDay,
} from './core';
import { SunCalcSolarPosition, ThreeOrthographicRenderer } from './adapters';

// --- Fixed scene inputs ------------------------------------------------------

const FIXED_LOCATION = { latitude: 51.4791, longitude: 0 }; // Greenwich
const FIXED_DATE = '2025-06-21'; // summer solstice — long day, high sun

/** A small flat garden with one building and one tree, at ground level. */
const garden: Garden = {
  width: 12,
  depth: 12,
  groundLevels: new Array(12 * 12).fill(0),
  objects: [
    {
      kind: 'building',
      footprint: { x: 7, y: 7, width: 3, depth: 2 },
      baseLevel: 0,
      heightM: 4,
    },
    {
      kind: 'tree',
      footprint: { x: 3, y: 3, width: 2, depth: 2 },
      baseLevel: 0,
      heightM: 5,
    },
  ],
  northRotation: 0,
  latitude: FIXED_LOCATION.latitude,
  longitude: FIXED_LOCATION.longitude,
};

// --- Wiring ------------------------------------------------------------------

const canvas = document.querySelector<HTMLCanvasElement>('#garden-canvas');
if (!canvas) {
  throw new Error('garden-sim: #garden-canvas element not found');
}

const solar = new SunCalcSolarPosition();
const renderer = new ThreeOrthographicRenderer(canvas);

function sunAtHour(hour: number): SunPosition {
  const minutes = Math.round(hour * 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  const date = new Date(`${FIXED_DATE}T${hh}:${mm}:00Z`);
  return solar.getSunPosition({ ...FIXED_LOCATION, date });
}

function renderAtHour(hour: number): void {
  const sun = sunAtHour(hour);
  const lit = computeLitGrid(garden, sun);
  renderer.render(buildScene(garden, lit, sun));
}

/**
 * Integrates the fixed day into a sun-hours heatmap and renders it. Objects are
 * lit by the solar-noon sun so their heights still read. Returns the extremes
 * for the on-screen readout.
 */
function renderHeatmap(): { minHours: number; maxHours: number } {
  const grid = aggregateSunHours(garden, sampleDay(sunAtHour));
  const noonSun = sunAtHour(12);
  renderer.render(buildHeatmapScene(garden, grid, noonSun));
  return { minHours: grid.minHours, maxHours: grid.maxHours };
}

// --- Minimal vanilla controls ------------------------------------------------

const controls = document.createElement('div');
controls.style.cssText =
  'font-family: system-ui, sans-serif; color: #ddd; margin-top: 8px;';

const slider = document.createElement('input');
slider.type = 'range';
slider.min = '0';
slider.max = '24';
slider.step = '0.25';
slider.value = '12';
slider.style.width = `${canvas.width}px`;
slider.setAttribute('aria-label', 'Time of day');

const label = document.createElement('span');
label.style.marginLeft = '12px';

const heatmapButton = document.createElement('button');
heatmapButton.type = 'button';
heatmapButton.style.cssText = 'margin-left: 12px; cursor: pointer;';

const readout = document.createElement('div');
readout.style.cssText = 'margin-top: 6px; font-size: 0.85em; opacity: 0.85;';

type Mode = 'scrub' | 'heatmap';
let mode: Mode = 'scrub';

function formatHour(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} UTC`;
}

/** Renders the current mode and refreshes the controls' labels. */
function update(): void {
  if (mode === 'heatmap') {
    const { minHours, maxHours } = renderHeatmap();
    heatmapButton.textContent = 'Scrub the day';
    readout.textContent =
      `Sun-hours on ${FIXED_DATE} — sunniest ${maxHours.toFixed(1)}h ` +
      `(gold), shadiest ${minHours.toFixed(1)}h (blue).`;
    return;
  }
  const hour = Number(slider.value);
  label.textContent = formatHour(hour);
  heatmapButton.textContent = 'Show sun-hours heatmap';
  readout.textContent = '';
  renderAtHour(hour);
}

slider.addEventListener('input', () => {
  mode = 'scrub';
  update();
});

heatmapButton.addEventListener('click', () => {
  mode = mode === 'heatmap' ? 'scrub' : 'heatmap';
  update();
});

controls.append(slider, label, heatmapButton, readout);
canvas.insertAdjacentElement('afterend', controls);

update();
