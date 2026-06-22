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
  return setTileActive(garden, x, y, true);
}

/** Removes the tile at (x, y) from the garden's footprint. Out-of-bounds is a no-op. */
export function eraseTile(garden: Garden, x: number, y: number): Garden {
  return setTileActive(garden, x, y, false);
}

function setTileActive(
  garden: Garden,
  x: number,
  y: number,
  active: boolean,
): Garden {
  const { width, depth } = garden;
  if (x < 0 || x >= width || y < 0 || y >= depth) return garden;

  const idx = tileIndex(width, x, y);
  if (isTileActive(garden, idx) === active) return garden;

  const nextActive = Array.from({ length: width * depth }, (_, i) =>
    i === idx ? active : isTileActive(garden, i),
  );

  return { ...garden, active: nextActive };
}
