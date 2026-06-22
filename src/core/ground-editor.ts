// Ground editor use-cases (inbound port).
//
// The only way to change a garden's tile footprint. Paints and erases are
// pure, immutable edits: each returns a new Garden with one tile's `active`
// flag flipped, leaving its ground level untouched so re-painting an erased
// tile restores it as it was.

import type { Garden } from './types';
import { isTileActive, tileIndex } from './types';

/** Adds the tile at (x, y) to the garden's footprint. Out-of-bounds is a no-op. */
export function paintTile(garden: Garden, x: number, y: number): Garden {
  const idx = inBoundsIndex(garden, x, y);
  if (idx === null || isTileActive(garden, idx)) return garden;
  return { ...garden, active: withActiveAt(garden, idx, true) };
}

/** Removes the tile at (x, y) from the garden's footprint. Out-of-bounds is a no-op. */
export function eraseTile(garden: Garden, x: number, y: number): Garden {
  const idx = inBoundsIndex(garden, x, y);
  if (idx === null || !isTileActive(garden, idx)) return garden;
  return { ...garden, active: withActiveAt(garden, idx, false) };
}

/** Row-major index of (x, y), or null if it falls outside the garden's grid. */
function inBoundsIndex(garden: Garden, x: number, y: number): number | null {
  const { width, depth } = garden;
  if (x < 0 || x >= width || y < 0 || y >= depth) return null;
  return tileIndex(width, x, y);
}

/** Copies the garden's active array with one tile's flag set, without touching the rest. */
function withActiveAt(garden: Garden, idx: number, active: boolean): boolean[] {
  const next = garden.active
    ? garden.active.slice()
    : new Array<boolean>(garden.width * garden.depth).fill(true);
  next[idx] = active;
  return next;
}
