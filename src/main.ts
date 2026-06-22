// App shell entry point.
//
// Wires every architectural seam over a hardcoded garden:
//   garden model → solar-position port → shadow pass → scene description
//   → Three.js renderer port, driven by a time-of-day slider + date picker.
//
// Location and true-north rotation are fixed; date and aggregation window are
// user-controlled. State is in-memory only.

import type { Garden, SunAtDateTime, SunPosition, WindowPreset } from './core';
import {
  DEFAULT_SAMPLE_INTERVAL_DAYS,
  addDays,
  aggregateSunHours,
  buildHeatmapScene,
  buildScene,
  computeLitGrid,
  sampleWindow,
  windowBounds,
} from './core';
import { SunCalcSolarPosition, ThreeOrthographicRenderer } from './adapters';

// --- Fixed scene inputs ------------------------------------------------------

const FIXED_LOCATION = { latitude: 51.4791, longitude: 0 }; // Greenwich

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
if (!canvas) throw new Error('garden-sim: #garden-canvas element not found');

const solar = new SunCalcSolarPosition();
const renderer = new ThreeOrthographicRenderer(canvas);

/** Current date driving both scrub and heatmap modes. */
let currentDate = '2025-06-21';

/** Sun position for a given date string and fractional hour (UTC). */
function sunAtHourOnDate(dateStr: string, hour: number): SunPosition {
  const minutes = Math.round(hour * 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  const date = new Date(`${dateStr}T${hh}:${mm}:00Z`);
  return solar.getSunPosition({ ...FIXED_LOCATION, date });
}

/** SunAtDateTime adapter for sampleWindow: uses a Date object + fractional hour. */
const sunAtDateTime: SunAtDateTime = (date, hour) => {
  const minutes = Math.round(hour * 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  const isoDate = date.toISOString().slice(0, 10);
  const instant = new Date(`${isoDate}T${hh}:${mm}:00Z`);
  return solar.getSunPosition({ ...FIXED_LOCATION, date: instant });
};

function renderAtHour(hour: number): void {
  const sun = sunAtHourOnDate(currentDate, hour);
  renderer.render(buildScene(garden, computeLitGrid(garden, sun), sun));
}

function renderHeatmap(
  startDate: Date,
  endDate: Date,
): { minHours: number; maxHours: number; dayCount: number } {
  const { samples, dayCount } = sampleWindow(
    startDate,
    endDate,
    sunAtDateTime,
    DEFAULT_SAMPLE_INTERVAL_DAYS,
  );
  const grid = aggregateSunHours(garden, samples, dayCount);
  const noonSun = sunAtDateTime(startDate, 12);
  renderer.render(buildHeatmapScene(garden, grid, noonSun));
  return { minHours: grid.minHours, maxHours: grid.maxHours, dayCount };
}

// --- Minimal vanilla controls ------------------------------------------------

const controls = document.createElement('div');
controls.style.cssText =
  'font-family: system-ui, sans-serif; color: #ddd; margin-top: 8px;';

// Row 1: time-of-day scrub
const row1 = document.createElement('div');
row1.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 6px;';

const slider = document.createElement('input');
slider.type = 'range';
slider.min = '0';
slider.max = '24';
slider.step = '0.25';
slider.value = '12';
slider.style.width = `${canvas.width}px`;
slider.setAttribute('aria-label', 'Time of day');

const timeLabel = document.createElement('span');

const heatmapButton = document.createElement('button');
heatmapButton.type = 'button';
heatmapButton.style.cursor = 'pointer';

// Row 2: date picker
const row2 = document.createElement('div');
row2.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 6px;';

const datePickerLabel = document.createElement('label');
datePickerLabel.textContent = 'Date:';
datePickerLabel.htmlFor = 'garden-date';

const datePicker = document.createElement('input');
datePicker.type = 'date';
datePicker.id = 'garden-date';
datePicker.value = currentDate;
datePicker.style.cssText = 'color: #111; cursor: pointer;';

// Row 3: window preset selector (heatmap mode only)
const row3 = document.createElement('div');
row3.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 6px;';

const windowLabel = document.createElement('span');
windowLabel.textContent = 'Window:';

const presets: Array<{ preset: WindowPreset; label: string }> = [
  { preset: 'day', label: 'Day' },
  { preset: 'month', label: 'Month' },
  { preset: 'season', label: 'Season' },
  { preset: 'custom', label: 'Custom' },
];

let activePreset: WindowPreset = 'day';

const presetBtns = presets.map(({ preset, label }) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.dataset['preset'] = preset;
  btn.style.cursor = 'pointer';
  btn.addEventListener('click', () => {
    activePreset = preset;
    row4.hidden = preset !== 'custom';
    update();
  });
  return btn;
});

// Row 4: custom date range (hidden unless 'custom' preset)
const row4 = document.createElement('div');
row4.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 6px;';
row4.hidden = true;

const customStartLabel = document.createElement('label');
customStartLabel.textContent = 'From:';
customStartLabel.htmlFor = 'garden-custom-start';

const customStartPicker = document.createElement('input');
customStartPicker.type = 'date';
customStartPicker.id = 'garden-custom-start';
customStartPicker.value = currentDate;
customStartPicker.style.cssText = 'color: #111; cursor: pointer;';

const customEndLabel = document.createElement('label');
customEndLabel.textContent = 'To:';
customEndLabel.htmlFor = 'garden-custom-end';

const customEndPicker = document.createElement('input');
customEndPicker.type = 'date';
customEndPicker.id = 'garden-custom-end';
customEndPicker.value = addDays(new Date(`${currentDate}T00:00:00Z`), 30)
  .toISOString()
  .slice(0, 10);
customEndPicker.style.cssText = 'color: #111; cursor: pointer;';

// Readout row
const readout = document.createElement('div');
readout.style.cssText = 'font-size: 0.85em; opacity: 0.85;';

// --- State and rendering -----------------------------------------------------

type Mode = 'scrub' | 'heatmap';
let mode: Mode = 'scrub';

function formatHour(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} UTC`;
}

function formatDateRange(start: Date, end: Date): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return start.getTime() === end.getTime() ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}

function highlightActivePreset(): void {
  for (const btn of presetBtns) {
    btn.style.fontWeight = btn.dataset['preset'] === activePreset ? 'bold' : '';
  }
}

function update(): void {
  if (mode === 'heatmap') {
    const refDate = new Date(`${currentDate}T00:00:00Z`);
    const customStart = new Date(`${customStartPicker.value}T00:00:00Z`);
    const customEnd = new Date(`${customEndPicker.value}T00:00:00Z`);
    const { start, end } = windowBounds(activePreset, refDate, customStart, customEnd);
    const { minHours, maxHours, dayCount } = renderHeatmap(start, end);
    heatmapButton.textContent = 'Scrub the day';
    row3.hidden = false;
    highlightActivePreset();
    const rangeStr = formatDateRange(start, end);
    const sampledDays = `${dayCount} sampled day${dayCount !== 1 ? 's' : ''}`;
    readout.textContent =
      `Avg sun-hours/day over ${rangeStr} (${sampledDays}) — ` +
      `sunniest ${maxHours.toFixed(1)}h (gold), shadiest ${minHours.toFixed(1)}h (blue).`;
    return;
  }
  const hour = Number(slider.value);
  timeLabel.textContent = formatHour(hour);
  heatmapButton.textContent = 'Show sun-hours heatmap';
  row3.hidden = true;
  row4.hidden = true;
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

datePicker.addEventListener('change', () => {
  currentDate = datePicker.value;
  update();
});

for (const picker of [customStartPicker, customEndPicker]) {
  picker.addEventListener('change', () => {
    if (mode === 'heatmap') update();
  });
}

// --- Assemble DOM ------------------------------------------------------------

row1.append(slider, timeLabel, heatmapButton);
row2.append(datePickerLabel, datePicker);
row3.append(windowLabel, ...presetBtns);
row4.append(customStartLabel, customStartPicker, customEndLabel, customEndPicker);

controls.append(row1, row2, row3, row4, readout);
canvas.insertAdjacentElement('afterend', controls);

update();
