// Object editor use-cases (inbound port).
//
// The only way to place, edit, or remove a garden's buildings, fences, and
// trees. Each edit is a pure, immutable operation: it returns a new Garden
// with the objects array replaced, never mutating the input.

import type {
  DeciduousRange,
  Footprint,
  Garden,
  GardenObject,
  GardenObjectKind,
} from './types';

/** Sensible starting height (metres) for a freshly placed object, by kind. */
const DEFAULT_HEIGHT_M: Record<GardenObjectKind, number> = {
  building: 3,
  fence: 1.2,
  tree: 5,
};

/** Sensible starting transmittance for a freshly placed object, by kind. */
const DEFAULT_TRANSMITTANCE: Record<GardenObjectKind, number> = {
  building: 0,
  fence: 0,
  tree: 0.5,
};

/** Sensible starting leaf-on/leaf-off range for a freshly placed tree. */
const DEFAULT_DECIDUOUS_RANGE: DeciduousRange = {
  leafOn: '04-15',
  leafOff: '10-31',
};

/** Places a new object of `kind` with the given footprint and default properties. */
export function placeObject(
  garden: Garden,
  kind: GardenObjectKind,
  footprint: Footprint,
): Garden {
  const object: GardenObject = {
    kind,
    footprint,
    baseLevel: 0,
    heightM: DEFAULT_HEIGHT_M[kind],
    transmittance: DEFAULT_TRANSMITTANCE[kind],
    ...(kind === 'tree' ? { deciduousRange: DEFAULT_DECIDUOUS_RANGE } : {}),
  };
  return { ...garden, objects: [...garden.objects, object] };
}

/** The editable properties of a placed object. */
export type GardenObjectPatch = Partial<
  Pick<
    GardenObject,
    'baseLevel' | 'heightM' | 'transmittance' | 'deciduousRange'
  >
>;

/** The object at `index`, or undefined if it's out of range. */
function objectInRange(
  garden: Garden,
  index: number,
): GardenObject | undefined {
  return index < 0 ? undefined : garden.objects[index];
}

/** Applies `patch` to the object at `index`. Out-of-range is a no-op. */
export function updateObjectAt(
  garden: Garden,
  index: number,
  patch: GardenObjectPatch,
): Garden {
  const existing = objectInRange(garden, index);
  if (!existing) return garden;
  const objects = garden.objects.slice();
  objects[index] = { ...existing, ...patch };
  return { ...garden, objects };
}

/** Removes the object at `index`. Out-of-range is a no-op. */
export function removeObjectAt(garden: Garden, index: number): Garden {
  if (!objectInRange(garden, index)) return garden;
  const objects = garden.objects.slice();
  objects.splice(index, 1);
  return { ...garden, objects };
}

/**
 * The index of the topmost object whose footprint covers tile (x, y), or
 * null if none does. "Topmost" is last-placed-wins, matching paint order.
 */
export function objectAt(garden: Garden, x: number, y: number): number | null {
  for (let i = garden.objects.length - 1; i >= 0; i--) {
    if (footprintContains(garden.objects[i]!.footprint, x, y)) return i;
  }
  return null;
}

function footprintContains(
  footprint: Footprint,
  x: number,
  y: number,
): boolean {
  return (
    x >= footprint.x &&
    x < footprint.x + footprint.width &&
    y >= footprint.y &&
    y < footprint.y + footprint.depth
  );
}
