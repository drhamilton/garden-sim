// App shell entry point (sun-sim spine).
//
// Wires every architectural seam over a hardcoded garden:
//   garden model → solar-position port → shadow pass → scene description
//   → Three.js renderer port, driven by a vanilla time-of-day slider.
//
// Location, true-north rotation, and the date are fixed inputs in this slice;
// a later slice makes them editable. State is in-memory only.

import type { Garden, SunPosition } from './core';
import { buildScene, computeLitGrid } from './core';
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

function formatHour(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} UTC`;
}

function update(): void {
  const hour = Number(slider.value);
  label.textContent = formatHour(hour);
  renderAtHour(hour);
}

slider.addEventListener('input', update);
controls.append(slider, label);
canvas.insertAdjacentElement('afterend', controls);

update();
