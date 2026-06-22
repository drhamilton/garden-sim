// App shell entry point.
//
// Wires every architectural seam over a hardcoded garden:
//   garden model → solar-position port → shadow pass → scene description
//   → Three.js renderer port, driven by a time-of-day slider + date picker.
//
// Location and true-north rotation are fixed; date and aggregation window are
// user-controlled. State is in-memory only.

import type { Garden, SunAtDateTime, SunPosition } from './core';
import {
  DEFAULT_SAMPLE_INTERVAL_DAYS,
  aggregateSunHours,
  buildHeatmapScene,
  buildScene,
  computeLitGrid,
  sampleDay,
  sampleWindow,
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
  const lit = computeLitGrid(garden, sun);
  renderer.render(buildScene(garden, lit, sun));
}

function renderHeatmap(
  startDate: Date,
  endDate: Date,
): { minHours: number; maxHours: number; dayCount: number } {
  const oneDayWindow = startDate.getTime() === endDate.getTime();
  let samples, dayCount;

  if (oneDayWindow) {
    const sunAt = (h: number) => sunAtDateTime(startDate, h);
    samples = sampleDay(sunAt);
    dayCount = 1;
  } else {
    ({ samples, dayCount } = sampleWindow(
      startDate,
      endDate,
      sunAtDateTime,
      DEFAULT_SAMPLE_INTERVAL_DAYS,
    ));
  }

  const grid = aggregateSunHours(garden, samples, dayCount);
  const noonSun = sunAtDateTime(startDate, 12);
  renderer.render(buildHeatmapScene(garden, grid, noonSun));
  return { minHours: grid.minHours, maxHours: grid.maxHours, dayCount };
}

// --- Window preset helpers ---------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type WindowPreset = 'day' | 'month' | 'season' | 'custom';

/** Approximate astronomical season containing the given date (UTC). */
function seasonBounds(d: Date): { start: Date; end: Date } {
  const y = d.getUTCFullYear();
  const seasons: Array<{ start: Date; end: Date }> = [
    {
      start: new Date(Date.UTC(y - 1, 11, 21)),
      end: new Date(Date.UTC(y, 2, 19)),
    }, // Winter: Dec 21 – Mar 19
    {
      start: new Date(Date.UTC(y, 2, 20)),
      end: new Date(Date.UTC(y, 5, 20)),
    }, // Spring: Mar 20 – Jun 20
    {
      start: new Date(Date.UTC(y, 5, 21)),
      end: new Date(Date.UTC(y, 8, 22)),
    }, // Summer: Jun 21 – Sep 22
    {
      start: new Date(Date.UTC(y, 8, 23)),
      end: new Date(Date.UTC(y, 11, 20)),
    }, // Autumn: Sep 23 – Dec 20
    {
      start: new Date(Date.UTC(y, 11, 21)),
      end: new Date(Date.UTC(y + 1, 2, 19)),
    }, // Winter next
  ];
  const t = d.getTime();
  for (const s of seasons) {
    if (t >= s.start.getTime() && t <= s.end.getTime()) return s;
  }
  return seasons[1]!; // fallback: spring
}

function windowForPreset(
  preset: WindowPreset,
  dateStr: string,
  customStartStr: string,
  customEndStr: string,
): { start: Date; end: Date } {
  const d = new Date(`${dateStr}T00:00:00Z`);
  switch (preset) {
    case 'day':
      return { start: d, end: d };
    case 'month': {
      const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
      const end = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
      );
      return { start, end };
    }
    case 'season':
      return seasonBounds(d);
    case 'custom': {
      const start = new Date(`${customStartStr}T00:00:00Z`);
      const end = new Date(`${customEndStr}T00:00:00Z`);
      return { start: start <= end ? start : end, end: start <= end ? end : start };
    }
  }
}

function formatDateRange(start: Date, end: Date): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return start.getTime() === end.getTime() ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}

// --- Minimal vanilla controls ------------------------------------------------

const css = (el: HTMLElement, style: string) => (el.style.cssText = style);

const controls = document.createElement('div');
css(controls, 'font-family: system-ui, sans-serif; color: #ddd; margin-top: 8px;');

// Row 1: time-of-day scrub
const row1 = document.createElement('div');
css(row1, 'display: flex; align-items: center; gap: 8px; margin-bottom: 6px;');

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
css(heatmapButton, 'cursor: pointer;');

// Row 2: date picker
const row2 = document.createElement('div');
css(row2, 'display: flex; align-items: center; gap: 8px; margin-bottom: 6px;');

const dateLabel = document.createElement('label');
dateLabel.textContent = 'Date:';
dateLabel.htmlFor = 'garden-date';

const datePicker = document.createElement('input');
datePicker.type = 'date';
datePicker.id = 'garden-date';
datePicker.value = currentDate;
css(datePicker, 'color: #111; cursor: pointer;');

// Row 3: window selector (heatmap mode only)
const row3 = document.createElement('div');
css(row3, 'display: flex; align-items: center; gap: 8px; margin-bottom: 6px;');

const windowLabel = document.createElement('span');
windowLabel.textContent = 'Window:';

const presetButtons: Array<{ preset: WindowPreset; label: string }> = [
  { preset: 'day', label: 'Day' },
  { preset: 'month', label: 'Month' },
  { preset: 'season', label: 'Season' },
  { preset: 'custom', label: 'Custom' },
];

let activePreset: WindowPreset = 'day';

const presetBtns = presetButtons.map(({ preset, label }) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.dataset['preset'] = preset;
  css(btn, 'cursor: pointer;');
  btn.addEventListener('click', () => {
    activePreset = preset;
    row4.hidden = preset !== 'custom';
    update();
  });
  return btn;
});

// Row 4: custom date range (hidden unless 'custom' preset)
const row4 = document.createElement('div');
css(row4, 'display: flex; align-items: center; gap: 8px; margin-bottom: 6px;');
row4.hidden = true;

const customStartLabel = document.createElement('label');
customStartLabel.textContent = 'From:';
customStartLabel.htmlFor = 'garden-custom-start';

const customStartPicker = document.createElement('input');
customStartPicker.type = 'date';
customStartPicker.id = 'garden-custom-start';
customStartPicker.value = currentDate;
css(customStartPicker, 'color: #111; cursor: pointer;');

const customEndLabel = document.createElement('label');
customEndLabel.textContent = 'To:';
customEndLabel.htmlFor = 'garden-custom-end';

const customEndPicker = document.createElement('input');
customEndPicker.type = 'date';
customEndPicker.id = 'garden-custom-end';
customEndPicker.value = new Date(
  new Date(`${currentDate}T00:00:00Z`).getTime() + 30 * MS_PER_DAY,
)
  .toISOString()
  .slice(0, 10);
css(customEndPicker, 'color: #111; cursor: pointer;');

// Readout row
const readout = document.createElement('div');
css(readout, 'font-size: 0.85em; opacity: 0.85;');

// --- State and rendering -----------------------------------------------------

type Mode = 'scrub' | 'heatmap';
let mode: Mode = 'scrub';

function formatHour(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} UTC`;
}

function highlightActivePreset(): void {
  for (const btn of presetBtns) {
    btn.style.fontWeight = btn.dataset['preset'] === activePreset ? 'bold' : '';
  }
}

function update(): void {
  if (mode === 'heatmap') {
    const { start, end } = windowForPreset(
      activePreset,
      currentDate,
      customStartPicker.value,
      customEndPicker.value,
    );
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
row2.append(dateLabel, datePicker);
row3.append(windowLabel, ...presetBtns);
row4.append(customStartLabel, customStartPicker, customEndLabel, customEndPicker);

controls.append(row1, row2, row3, row4, readout);
canvas.insertAdjacentElement('afterend', controls);

update();
