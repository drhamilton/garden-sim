// App shell entry point.
//
// Wires every architectural seam over a hardcoded garden:
//   garden model → solar-position port → shadow pass → scene description
//   → Three.js renderer port, driven by a time-of-day slider + date picker.
//
// Location and true-north rotation are fixed; date and aggregation window are
// user-controlled. State is in-memory only.

import type {
  Garden,
  GardenObjectKind,
  GardenObjectPatch,
  SunAtDateTime,
  SunPosition,
  WindowPreset,
} from './core';
import {
  DEFAULT_SAMPLE_INTERVAL_DAYS,
  addDays,
  aggregateSunHours,
  buildHeatmapScene,
  buildScene,
  computeSunFractionGrid,
  eraseTile,
  gardenForDate,
  objectAt,
  paintTile,
  placeObject,
  removeObjectAt,
  sampleWindow,
  updateObjectAt,
  windowBounds,
} from './core';
import { SunCalcSolarPosition, ThreeOrthographicRenderer } from './adapters';

// --- Fixed scene inputs ------------------------------------------------------

const DEFAULT_LOCATION = { latitude: 51.4791, longitude: 0 }; // Greenwich

// Coordinate system: +x = east, +y = north, (0,0) = SW corner. Grid is 12×12,
// each tile ≈ 0.3 m. All objects cast shadows northward (sun from S at noon).

function baseGarden(objects: Garden['objects']): Garden {
  return {
    width: 12,
    depth: 12,
    groundLevels: new Array(12 * 12).fill(0),
    objects,
    northRotation: 0,
    latitude: DEFAULT_LOCATION.latitude,
    longitude: DEFAULT_LOCATION.longitude,
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
        transmittance: 0.4,
        canopyBaseM: 2,
        deciduousRange: {
          leafOn: '04-15',
          leafOff: '10-31',
          leafOffTransmittance: 0.85,
        },
      },
    ]),
  },
  {
    // A single deciduous tree on an open grid — the only shade source, so its
    // shadow makes the seasonal change vivid: dappled-dark in the leaf-on
    // season, near-clear once the leaves drop. Modelled as a uniform
    // transmissive canopy (no opaque trunk) so the whole shadow dapples by the
    // seasonal transmittance rather than a season-independent trunk core.
    name: 'Deciduous tree',
    description:
      'One deciduous tree on open ground — dense canopy in leaf-on season, sparse once bare.',
    garden: baseGarden([
      {
        kind: 'tree',
        footprint: { x: 5, y: 5, width: 3, depth: 3 },
        baseLevel: 0,
        heightM: 5,
        transmittance: 0.3,
        deciduousRange: {
          leafOn: '04-15',
          leafOff: '10-31',
          leafOffTransmittance: 0.9,
        },
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

/** The active garden's real-world location, fed to every solar query. */
function gardenLocation(): { latitude: number; longitude: number } {
  return { latitude: garden.latitude, longitude: garden.longitude };
}

/** Sun position for a given date string and fractional hour (UTC). */
function sunAtHourOnDate(dateStr: string, hour: number): SunPosition {
  const minutes = Math.round(hour * 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  const date = new Date(`${dateStr}T${hh}:${mm}:00Z`);
  return solar.getSunPosition({ ...gardenLocation(), date });
}

/** Minutes between samples of the day-arc the renderer draws across the sky. */
const ARC_SAMPLE_MINUTES = 10;

/**
 * The sun's path across a whole day, sampled every {@link ARC_SAMPLE_MINUTES}
 * for the renderer's sky-dome arc. Memoised by date + location so scrubbing the
 * time-of-day slider (which keeps both fixed) reuses the same array rather than
 * resampling SunCalc on every frame — and so the renderer can key off a stable
 * arc and rebuild its geometry only when the day actually changes.
 */
let arcCache: { key: string; arc: SunPosition[] } | null = null;
function sunArcForDate(dateStr: string): SunPosition[] {
  const { latitude, longitude } = gardenLocation();
  const key = `${dateStr}:${latitude}:${longitude}`;
  if (arcCache?.key === key) return arcCache.arc;
  // Step by integer sample index (not a float-accumulating hour) so the final
  // sample lands exactly on hour 24 rather than drifting past it.
  const steps = (24 * 60) / ARC_SAMPLE_MINUTES;
  const arc: SunPosition[] = [];
  for (let i = 0; i <= steps; i++) {
    arc.push(sunAtHourOnDate(dateStr, (i * ARC_SAMPLE_MINUTES) / 60));
  }
  arcCache = { key, arc };
  return arc;
}

/** SunAtDateTime adapter for sampleWindow: uses a Date object + fractional hour. */
const sunAtDateTime: SunAtDateTime = (date, hour) => {
  const minutes = Math.round(hour * 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  const isoDate = date.toISOString().slice(0, 10);
  const instant = new Date(`${isoDate}T${hh}:${mm}:00Z`);
  return solar.getSunPosition({ ...gardenLocation(), date: instant });
};

function renderAtHour(hour: number): void {
  const sun = sunAtHourOnDate(currentDate, hour);
  // Resolve deciduous trees' seasonal transmittance for the scrubbed date so the
  // instantaneous view matches the season the heatmap would aggregate over.
  const seasonal = gardenForDate(garden, new Date(`${currentDate}T00:00:00Z`));
  renderer.render(
    buildScene(
      seasonal,
      computeSunFractionGrid(seasonal, sun),
      sun,
      sunArcForDate(currentDate),
    ),
  );
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

/**
 * Shows/hides an element by toggling inline `display`. These rows set their
 * own `display` via `style.cssText` (for flex layout), which as an inline
 * style always beats the `[hidden]` UA rule — so toggling `.hidden` alone is
 * a no-op once `cssText` has set `display`. Set visibility through `display`
 * directly instead.
 */
function setRowHidden(
  el: HTMLElement,
  hiddenFlag: boolean,
  display = 'flex',
): void {
  el.style.display = hiddenFlag ? 'none' : display;
}

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
    deselectObject();
    refreshLocationInputs();
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

// Editor mode: ground footprint editing, or placing/editing objects.
const editorRow = document.createElement('div');
editorRow.style.cssText =
  'display: flex; align-items: center; gap: 8px; margin-bottom: 6px;';

const editorLabel = document.createElement('span');
editorLabel.textContent = 'Editor:';

type EditorMode = 'ground' | 'object';
let editorMode: EditorMode = 'ground';

const EDITOR_MODES: Array<{ mode: EditorMode; label: string }> = [
  { mode: 'ground', label: 'Ground' },
  { mode: 'object', label: 'Objects' },
];

const editorModeBtns = EDITOR_MODES.map(({ mode, label }) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.style.cursor = 'pointer';
  btn.addEventListener('click', () => {
    editorMode = mode;
    refreshEditorVisibility();
  });
  return { mode, btn };
});

function highlightActiveEditorMode(): void {
  for (const { mode, btn } of editorModeBtns) {
    btn.style.fontWeight = mode === editorMode ? 'bold' : '';
  }
}

function refreshEditorVisibility(): void {
  highlightActiveEditorMode();
  setRowHidden(groundToolRow, editorMode !== 'ground');
  setRowHidden(objectToolRow, editorMode !== 'object');
  if (editorMode !== 'object') deselectObject();
}

// Object tool row: pick a kind to place, or switch to selecting an existing object.
const objectToolRow = document.createElement('div');
objectToolRow.style.cssText =
  'display: flex; align-items: center; gap: 8px; margin-bottom: 6px;';
setRowHidden(objectToolRow, true);

const objectToolLabel = document.createElement('span');
objectToolLabel.textContent = 'Object:';

type ObjectTool = 'select' | GardenObjectKind;
let objectTool: ObjectTool = 'select';

const OBJECT_TOOLS: Array<{ tool: ObjectTool; label: string }> = [
  { tool: 'select', label: 'Select' },
  { tool: 'building', label: 'Building' },
  { tool: 'fence', label: 'Fence' },
  { tool: 'tree', label: 'Tree' },
];

const objectToolBtns = OBJECT_TOOLS.map(({ tool, label }) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.style.cursor = 'pointer';
  btn.addEventListener('click', () => {
    objectTool = tool;
    highlightActiveObjectTool();
  });
  return { tool, btn };
});

function highlightActiveObjectTool(): void {
  for (const { tool, btn } of objectToolBtns) {
    btn.style.fontWeight = tool === objectTool ? 'bold' : '';
  }
}

// Properties panel: edits the selected object's height, base level,
// transmittance, and (for trees) its canopy base and deciduous leaf-on/leaf-off
// range.
const propertiesPanel = document.createElement('div');
propertiesPanel.style.cssText =
  'display: flex; flex-direction: column; gap: 4px; margin-bottom: 6px; padding: 8px; border: 1px solid #444; max-width: 320px;';
setRowHidden(propertiesPanel, true);

let selectedObjectIndex: number | null = null;

const propKindLabel = document.createElement('strong');

const heightRow = document.createElement('label');
heightRow.style.cssText = 'display: flex; align-items: center; gap: 6px;';
heightRow.append('Height (m):');
const heightInput = document.createElement('input');
heightInput.type = 'number';
heightInput.min = '0.1';
heightInput.step = '0.1';
heightRow.append(heightInput);

const baseLevelRow = document.createElement('label');
baseLevelRow.style.cssText = 'display: flex; align-items: center; gap: 6px;';
baseLevelRow.append('Base level:');
const baseLevelInput = document.createElement('input');
baseLevelInput.type = 'number';
baseLevelInput.step = '1';
baseLevelRow.append(baseLevelInput);

const transmittanceRow = document.createElement('label');
transmittanceRow.style.cssText =
  'display: flex; align-items: center; gap: 6px;';
transmittanceRow.append('Transmittance:');
const transmittanceInput = document.createElement('input');
transmittanceInput.type = 'range';
transmittanceInput.min = '0';
transmittanceInput.max = '1';
transmittanceInput.step = '0.05';
const transmittanceReadout = document.createElement('span');
transmittanceRow.append(transmittanceInput, transmittanceReadout);

// Trees only: the trunk top / canopy base — light below it is blocked solidly,
// above it dapples through the canopy at the transmittance.
const canopyBaseRow = document.createElement('label');
canopyBaseRow.style.cssText = 'display: flex; align-items: center; gap: 6px;';
canopyBaseRow.append('Canopy base (m):');
const canopyBaseInput = document.createElement('input');
canopyBaseInput.type = 'number';
canopyBaseInput.min = '0';
canopyBaseInput.step = '0.1';
canopyBaseRow.append(canopyBaseInput);
setRowHidden(canopyBaseRow, true);

const deciduousRow = document.createElement('div');
deciduousRow.style.cssText =
  'display: flex; flex-wrap: wrap; align-items: center; gap: 6px;';
setRowHidden(deciduousRow, true);

const leafOnLabel = document.createElement('label');
leafOnLabel.append('Leaf-on:');
const leafOnInput = document.createElement('input');
leafOnInput.type = 'date';

const leafOffLabel = document.createElement('label');
leafOffLabel.append('Leaf-off:');
const leafOffInput = document.createElement('input');
leafOffInput.type = 'date';

// The bare-season canopy: how much light the tree lets through once leaves drop.
const leafOffTransmittanceLabel = document.createElement('label');
leafOffTransmittanceLabel.style.cssText =
  'display: flex; align-items: center; gap: 6px;';
leafOffTransmittanceLabel.append('Bare transmittance:');
const leafOffTransmittanceInput = document.createElement('input');
leafOffTransmittanceInput.type = 'range';
leafOffTransmittanceInput.min = '0';
leafOffTransmittanceInput.max = '1';
leafOffTransmittanceInput.step = '0.05';
const leafOffTransmittanceReadout = document.createElement('span');
leafOffTransmittanceLabel.append(
  leafOffTransmittanceInput,
  leafOffTransmittanceReadout,
);

deciduousRow.append(
  leafOnLabel,
  leafOnInput,
  leafOffLabel,
  leafOffInput,
  leafOffTransmittanceLabel,
);

const deleteObjectButton = document.createElement('button');
deleteObjectButton.type = 'button';
deleteObjectButton.textContent = 'Delete object';
deleteObjectButton.style.cursor = 'pointer';

propertiesPanel.append(
  propKindLabel,
  heightRow,
  baseLevelRow,
  transmittanceRow,
  canopyBaseRow,
  deciduousRow,
  deleteObjectButton,
);

// Deciduous dates only need a month/day; a fixed dummy year drives the
// <input type="date"> widget while the model stores just "MM-DD".
const DUMMY_YEAR = '2000';
function toDateInputValue(monthDay: string): string {
  return `${DUMMY_YEAR}-${monthDay}`;
}
function fromDateInputValue(value: string): string {
  return value.slice(5);
}

function deselectObject(): void {
  selectedObjectIndex = null;
  setRowHidden(propertiesPanel, true);
}

function selectObjectAt(x: number, y: number): void {
  const index = objectAt(garden, x, y);
  if (index === null) {
    deselectObject();
    return;
  }
  selectedObjectIndex = index;
  refreshPropertiesPanel();
}

function refreshPropertiesPanel(): void {
  const obj =
    selectedObjectIndex === null
      ? undefined
      : garden.objects[selectedObjectIndex];
  if (!obj) {
    deselectObject();
    return;
  }
  setRowHidden(propertiesPanel, false);
  propKindLabel.textContent = `${obj.kind} @ (${obj.footprint.x}, ${obj.footprint.y})`;
  heightInput.value = String(obj.heightM);
  baseLevelInput.value = String(obj.baseLevel);
  const transmittance = obj.transmittance ?? 0;
  transmittanceInput.value = String(transmittance);
  transmittanceReadout.textContent = transmittance.toFixed(2);
  setRowHidden(canopyBaseRow, obj.kind !== 'tree');
  setRowHidden(deciduousRow, obj.kind !== 'tree');
  if (obj.kind === 'tree') {
    canopyBaseInput.value = String(obj.canopyBaseM ?? 0);
    leafOnInput.value = toDateInputValue(obj.deciduousRange?.leafOn ?? '04-15');
    leafOffInput.value = toDateInputValue(
      obj.deciduousRange?.leafOff ?? '10-31',
    );
    const bare = obj.deciduousRange?.leafOffTransmittance ?? 0.85;
    leafOffTransmittanceInput.value = String(bare);
    leafOffTransmittanceReadout.textContent = bare.toFixed(2);
  }
}

function applyObjectPatch(patch: GardenObjectPatch): void {
  if (selectedObjectIndex === null) return;
  garden = updateObjectAt(garden, selectedObjectIndex, patch);
  SCENES[activeScene]!.garden = garden;
  update();
}

heightInput.addEventListener('change', () => {
  const value = Number(heightInput.value);
  if (Number.isFinite(value) && value > 0) applyObjectPatch({ heightM: value });
});

baseLevelInput.addEventListener('change', () => {
  const value = Math.round(Number(baseLevelInput.value));
  if (Number.isFinite(value)) applyObjectPatch({ baseLevel: value });
});

transmittanceInput.addEventListener('input', () => {
  const value = Number(transmittanceInput.value);
  transmittanceReadout.textContent = value.toFixed(2);
  applyObjectPatch({ transmittance: value });
});

canopyBaseInput.addEventListener('change', () => {
  const value = Number(canopyBaseInput.value);
  if (Number.isFinite(value) && value >= 0)
    applyObjectPatch({ canopyBaseM: value });
});

function applyDeciduousRange(): void {
  if (selectedObjectIndex === null) return;
  const obj = garden.objects[selectedObjectIndex];
  if (!obj || obj.kind !== 'tree') return;
  applyObjectPatch({
    deciduousRange: {
      leafOn: fromDateInputValue(leafOnInput.value),
      leafOff: fromDateInputValue(leafOffInput.value),
      leafOffTransmittance: Number(leafOffTransmittanceInput.value),
    },
  });
}

leafOnInput.addEventListener('change', applyDeciduousRange);
leafOffInput.addEventListener('change', applyDeciduousRange);
leafOffTransmittanceInput.addEventListener('input', () => {
  leafOffTransmittanceReadout.textContent = Number(
    leafOffTransmittanceInput.value,
  ).toFixed(2);
  applyDeciduousRange();
});

deleteObjectButton.addEventListener('click', () => {
  if (selectedObjectIndex === null) return;
  garden = removeObjectAt(garden, selectedObjectIndex);
  SCENES[activeScene]!.garden = garden;
  deselectObject();
  update();
});

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

// Location & orientation row: editable latitude/longitude and a true-north
// rotation dial. All three are stored on the active garden and feed the solar
// queries; changing any of them re-lights the live view (and any heatmap).
const DEG_PER_RAD = 180 / Math.PI;
const RAD_PER_DEG = Math.PI / 180;

const locationRow = document.createElement('div');
locationRow.style.cssText =
  'display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;';

const latLabel = document.createElement('label');
latLabel.append('Lat:');
const latInput = document.createElement('input');
latInput.type = 'number';
latInput.min = '-90';
latInput.max = '90';
latInput.step = '0.1';
latInput.style.width = '6em';
latLabel.append(latInput);

const lonLabel = document.createElement('label');
lonLabel.append('Lon:');
const lonInput = document.createElement('input');
lonInput.type = 'number';
lonInput.min = '-180';
lonInput.max = '180';
lonInput.step = '0.1';
lonInput.style.width = '6em';
lonLabel.append(lonInput);

const northLabel = document.createElement('label');
northLabel.append('North (°):');
const northInput = document.createElement('input');
northInput.type = 'range';
northInput.min = '0';
northInput.max = '359';
northInput.step = '1';
const northReadout = document.createElement('span');
northLabel.append(northInput, northReadout);

/** Pushes a partial change to the active garden's location/orientation. */
function patchGarden(
  fields: Partial<Pick<Garden, 'latitude' | 'longitude' | 'northRotation'>>,
): void {
  garden = { ...garden, ...fields };
  SCENES[activeScene]!.garden = garden;
  update();
}

/** Loads the location/orientation controls from the active garden. */
function refreshLocationInputs(): void {
  latInput.value = String(garden.latitude);
  lonInput.value = String(garden.longitude);
  const northDeg = Math.round(garden.northRotation * DEG_PER_RAD);
  northInput.value = String(((northDeg % 360) + 360) % 360);
  northReadout.textContent = `${northInput.value}°`;
}

latInput.addEventListener('change', () => {
  const value = Number(latInput.value);
  if (Number.isFinite(value) && value >= -90 && value <= 90)
    patchGarden({ latitude: value });
});

lonInput.addEventListener('change', () => {
  const value = Number(lonInput.value);
  if (Number.isFinite(value) && value >= -180 && value <= 180)
    patchGarden({ longitude: value });
});

northInput.addEventListener('input', () => {
  const deg = Number(northInput.value);
  northReadout.textContent = `${deg}°`;
  patchGarden({ northRotation: deg * RAD_PER_DEG });
});

locationRow.append(latLabel, lonLabel, northLabel);

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
    setRowHidden(row4, preset !== 'custom');
    update();
  });
  return btn;
});

// Row 4: custom date range (hidden unless 'custom' preset)
const row4 = document.createElement('div');
row4.style.cssText =
  'display: flex; align-items: center; gap: 8px; margin-bottom: 6px;';
setRowHidden(row4, true);

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
    setRowHidden(row3, false);
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
  setRowHidden(row3, true);
  setRowHidden(row4, true);
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
// --- Object editing: drag a footprint rectangle, or click to select --------

let isPaintingGround = false;
let dragStartTile: { x: number; y: number } | null = null;
let lastHoverTile: { x: number; y: number } | null = null;

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

/** The axis-aligned footprint spanning a drag from `start` to `end`, inclusive. */
function footprintFromDrag(
  start: { x: number; y: number },
  end: { x: number; y: number },
): { x: number; y: number; width: number; depth: number } {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x) + 1,
    depth: Math.abs(end.y - start.y) + 1,
  };
}

function handlePointerDown(clientX: number, clientY: number): void {
  if (editorMode === 'ground') {
    isPaintingGround = true;
    applyGroundToolAt(clientX, clientY);
    return;
  }
  const tile = renderer.pickTile(clientX, clientY);
  if (!tile) return;
  if (objectTool === 'select') {
    selectObjectAt(tile.x, tile.y);
    return;
  }
  dragStartTile = tile;
  lastHoverTile = tile;
}

function handlePointerMove(clientX: number, clientY: number): void {
  if (editorMode === 'ground') {
    if (isPaintingGround) applyGroundToolAt(clientX, clientY);
    return;
  }
  if (!dragStartTile) return;
  const tile = renderer.pickTile(clientX, clientY);
  if (tile) lastHoverTile = tile;
}

function handlePointerUp(): void {
  isPaintingGround = false;
  if (editorMode === 'object' && dragStartTile && objectTool !== 'select') {
    const footprint = footprintFromDrag(
      dragStartTile,
      lastHoverTile ?? dragStartTile,
    );
    garden = placeObject(garden, objectTool, footprint);
    SCENES[activeScene]!.garden = garden;
    update();
  }
  dragStartTile = null;
}

canvas.style.touchAction = 'none';
canvas.style.cursor = 'crosshair';

canvas.addEventListener('pointerdown', (e) =>
  handlePointerDown(e.clientX, e.clientY),
);
canvas.addEventListener('pointermove', (e) =>
  handlePointerMove(e.clientX, e.clientY),
);
window.addEventListener('pointerup', handlePointerUp);

// --- Assemble DOM ------------------------------------------------------------

row0.append(sceneLabel, ...sceneBtns);
editorRow.append(editorLabel, ...editorModeBtns.map(({ btn }) => btn));
groundToolRow.append(groundToolLabel, ...groundToolBtns.map(({ btn }) => btn));
objectToolRow.append(objectToolLabel, ...objectToolBtns.map(({ btn }) => btn));
row1.append(slider, timeLabel, heatmapButton);
row2.append(datePickerLabel, datePicker);
row3.append(windowLabel, ...presetBtns);
row4.append(
  customStartLabel,
  customStartPicker,
  customEndLabel,
  customEndPicker,
);

controls.append(
  row0,
  editorRow,
  groundToolRow,
  objectToolRow,
  propertiesPanel,
  row1,
  row2,
  locationRow,
  row3,
  row4,
  readout,
);
canvas.insertAdjacentElement('afterend', controls);

highlightActiveGroundTool();
highlightActiveObjectTool();
refreshEditorVisibility();
refreshLocationInputs();
update();
