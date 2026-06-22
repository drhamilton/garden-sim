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
  eraseTile,
  paintTile,
  sampleWindow,
  windowBounds,
} from './core';
import { SunCalcSolarPosition, ThreeOrthographicRenderer } from './adapters';

// --- Fixed scene inputs ------------------------------------------------------

const FIXED_LOCATION = { latitude: 51.4791, longitude: 0 }; // Greenwich

// Coordinate system: +x = east, +y = north, (0,0) = SW corner. Grid is 12×12,
// each tile ≈ 0.3 m. All objects cast shadows northward (sun from S at noon).

function baseGarden(objects: Garden['objects']): Garden {
  return {
    width: 12,
    depth: 12,
    groundLevels: new Array(12 * 12).fill(0),
    objects,
    northRotation: 0,
    latitude: FIXED_LOCATION.latitude,
    longitude: FIXED_LOCATION.longitude,
  };
}

const SCENES: Array<{ name: string; description: string; garden: Garden }> = [
  {
    name: 'Open garden',
    description: 'No obstacles — shows pure seasonal daylight variation.',
    garden: baseGarden([]),
  },
  {
    // 2.5 m fence along the entire south edge.
    // Greenwich noon elevation: winter ~15° → shadow 30 tiles (whole garden);
    // summer ~62° → shadow 4 tiles. Dramatic N-S seasonal contrast.
    name: 'South fence',
    description:
      '2.5 m fence across the south edge — long winter shadow, short summer shadow.',
    garden: baseGarden([
      {
        kind: 'fence',
        footprint: { x: 0, y: 0, width: 12, depth: 1 },
        baseLevel: 0,
        heightM: 2.5,
      },
    ]),
  },
  {
    // Tall building in the SW corner (5×5 tiles, 6 m).
    // Spring morning: sun rises low in SE → long diagonal shadow sweeps most
    // of the garden. Summer: sun rises NE and climbs steeply → shadow short
    // and confined to the NE. Good "spring vs summer" heatmap comparison.
    name: 'SW corner block',
    description:
      '6 m building in SW corner — large spring shadow, retreats in summer.',
    garden: baseGarden([
      {
        kind: 'building',
        footprint: { x: 0, y: 0, width: 5, depth: 5 },
        baseLevel: 0,
        heightM: 6,
      },
    ]),
  },
  {
    name: 'Building + tree',
    description: 'Mixed scene: building in the back, tree in the middle.',
    garden: baseGarden([
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
    ]),
  },
];

let activeScene = 0;
let garden: Garden = SCENES[activeScene]!.garden;

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

function renderHeatmap(startDate: Date, endDate: Date): void {
  const { samples, dayCount } = sampleWindow(
    startDate,
    endDate,
    sunAtDateTime,
    DEFAULT_SAMPLE_INTERVAL_DAYS,
  );
  const grid = aggregateSunHours(garden, samples, dayCount);
  const noonSun = sunAtDateTime(startDate, 12);
  renderer.render(buildHeatmapScene(garden, grid, noonSun));
}

// --- Minimal vanilla controls ------------------------------------------------

const controls = document.createElement('div');
controls.style.cssText =
  'font-family: system-ui, sans-serif; color: #000; margin-top: 8px;';

// Row 0: scene selector
const row0 = document.createElement('div');
row0.style.cssText =
  'display: flex; align-items: center; gap: 8px; margin-bottom: 6px;';

const sceneLabel = document.createElement('span');
sceneLabel.textContent = 'Scene:';

const sceneBtns = SCENES.map(({ name, description }, i) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = name;
  btn.title = description;
  btn.style.cursor = 'pointer';
  btn.addEventListener('click', () => {
    activeScene = i;
    garden = SCENES[i]!.garden;
    update();
  });
  return btn;
});

// Ground tool row: paint/erase the garden's footprint
const groundToolRow = document.createElement('div');
groundToolRow.style.cssText =
  'display: flex; align-items: center; gap: 8px; margin-bottom: 6px;';

const groundToolLabel = document.createElement('span');
groundToolLabel.textContent = 'Ground:';

type GroundTool = 'paint' | 'erase';
let groundTool: GroundTool = 'paint';

const GROUND_TOOLS: Array<{ tool: GroundTool; label: string }> = [
  { tool: 'paint', label: 'Paint' },
  { tool: 'erase', label: 'Erase' },
];

const groundToolBtns: Array<{ tool: GroundTool; btn: HTMLButtonElement }> =
  GROUND_TOOLS.map(({ tool, label }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.style.cursor = 'pointer';
    btn.addEventListener('click', () => {
      groundTool = tool;
      highlightActiveGroundTool();
    });
    return { tool, btn };
  });

function highlightActiveGroundTool(): void {
  for (const { tool, btn } of groundToolBtns) {
    btn.style.fontWeight = tool === groundTool ? 'bold' : '';
  }
}

// Row 1: time-of-day scrub
const row1 = document.createElement('div');
row1.style.cssText =
  'display: flex; align-items: center; gap: 8px; margin-bottom: 6px;';

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
row2.style.cssText =
  'display: flex; align-items: center; gap: 8px; margin-bottom: 6px;';

const datePickerLabel = document.createElement('label');
datePickerLabel.textContent = 'Date:';
datePickerLabel.htmlFor = 'garden-date';

const datePicker = document.createElement('input');
datePicker.type = 'date';
datePicker.id = 'garden-date';
datePicker.value = currentDate;
datePicker.style.cursor = 'pointer';

// Row 3: window preset selector (heatmap mode only)
const row3 = document.createElement('div');
row3.style.cssText =
  'display: flex; align-items: center; gap: 8px; margin-bottom: 6px;';

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
row4.style.cssText =
  'display: flex; align-items: center; gap: 8px; margin-bottom: 6px;';
row4.hidden = true;

const customStartLabel = document.createElement('label');
customStartLabel.textContent = 'From:';
customStartLabel.htmlFor = 'garden-custom-start';

const customStartPicker = document.createElement('input');
customStartPicker.type = 'date';
customStartPicker.id = 'garden-custom-start';
customStartPicker.value = currentDate;
customStartPicker.style.cursor = 'pointer';

const customEndLabel = document.createElement('label');
customEndLabel.textContent = 'To:';
customEndLabel.htmlFor = 'garden-custom-end';

const customEndPicker = document.createElement('input');
customEndPicker.type = 'date';
customEndPicker.id = 'garden-custom-end';
customEndPicker.value = addDays(new Date(`${currentDate}T00:00:00Z`), 30)
  .toISOString()
  .slice(0, 10);
customEndPicker.style.cursor = 'pointer';

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
  return start.getTime() === end.getTime()
    ? fmt(start)
    : `${fmt(start)} – ${fmt(end)}`;
}

function highlightActivePreset(): void {
  for (const btn of presetBtns) {
    btn.style.fontWeight = btn.dataset['preset'] === activePreset ? 'bold' : '';
  }
}

function highlightActiveScene(): void {
  for (const [i, btn] of sceneBtns.entries()) {
    btn.style.fontWeight = i === activeScene ? 'bold' : '';
  }
}

function update(): void {
  highlightActiveScene();
  if (mode === 'heatmap') {
    const refDate = new Date(`${currentDate}T00:00:00Z`);
    const customStart = new Date(`${customStartPicker.value}T00:00:00Z`);
    const customEnd = new Date(`${customEndPicker.value}T00:00:00Z`);
    const { start, end } = windowBounds(
      activePreset,
      refDate,
      customStart,
      customEnd,
    );
    renderHeatmap(start, end);
    heatmapButton.textContent = 'Scrub the day';
    row3.hidden = false;
    highlightActivePreset();
    const totalDays =
      Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    const rangeStr = formatDateRange(start, end);
    const spanStr = totalDays === 1 ? '1 day' : `${totalDays} days`;
    readout.textContent = `Avg sun-hours/day over ${rangeStr} (${spanStr}).`;
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

// --- Ground editing: drag-paint tiles in/out of the footprint ---------------

let isPaintingGround = false;

function applyGroundToolAt(clientX: number, clientY: number): void {
  const tile = renderer.pickTile(clientX, clientY);
  if (!tile) return;
  const edit = groundTool === 'paint' ? paintTile : eraseTile;
  const next = edit(garden, tile.x, tile.y);
  if (next !== garden) {
    garden = next;
    SCENES[activeScene]!.garden = garden;
    update();
  }
}

canvas.style.touchAction = 'none';
canvas.style.cursor = 'crosshair';

canvas.addEventListener('pointerdown', (e) => {
  isPaintingGround = true;
  applyGroundToolAt(e.clientX, e.clientY);
});
canvas.addEventListener('pointermove', (e) => {
  if (isPaintingGround) applyGroundToolAt(e.clientX, e.clientY);
});
window.addEventListener('pointerup', () => {
  isPaintingGround = false;
});

// --- Assemble DOM ------------------------------------------------------------

row0.append(sceneLabel, ...sceneBtns);
groundToolRow.append(groundToolLabel, ...groundToolBtns.map(({ btn }) => btn));
row1.append(slider, timeLabel, heatmapButton);
row2.append(datePickerLabel, datePicker);
row3.append(windowLabel, ...presetBtns);
row4.append(
  customStartLabel,
  customStartPicker,
  customEndLabel,
  customEndPicker,
);

controls.append(row0, groundToolRow, row1, row2, row3, row4, readout);
canvas.insertAdjacentElement('afterend', controls);

highlightActiveGroundTool();
update();
