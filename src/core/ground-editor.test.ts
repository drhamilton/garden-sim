import { describe, expect, it } from 'vitest';
import { eraseTile, paintTile } from './ground-editor';
import type { Garden } from './types';
import { isTileActive, tileIndex } from './types';

function garden(): Garden {
  return {
    width: 3,
    depth: 2,
    groundLevels: [0, 1, 0, 0, 0, 0],
    objects: [],
    northRotation: 0,
    latitude: 0,
    longitude: 0,
  };
}

describe('ground editor use-cases', () => {
  it('every tile is active by default, before any edits', () => {
    const g = garden();
    for (let i = 0; i < g.width * g.depth; i++) {
      expect(isTileActive(g, i)).toBe(true);
    }
  });

  it('erases a tile out of the footprint', () => {
    const g = eraseTile(garden(), 1, 0);
    expect(isTileActive(g, tileIndex(3, 1, 0))).toBe(false);
    expect(isTileActive(g, tileIndex(3, 0, 0))).toBe(true);
  });

  it('re-painting an erased tile restores it, preserving its ground level', () => {
    const erased = eraseTile(garden(), 1, 0);
    const repainted = paintTile(erased, 1, 0);
    expect(isTileActive(repainted, tileIndex(3, 1, 0))).toBe(true);
    expect(repainted.groundLevels[tileIndex(3, 1, 0)]).toBe(1);
  });

  it('does not mutate the input garden', () => {
    const g = garden();
    eraseTile(g, 0, 0);
    expect(isTileActive(g, tileIndex(3, 0, 0))).toBe(true);
  });

  it('is a no-op for out-of-bounds coordinates', () => {
    const g = garden();
    expect(eraseTile(g, -1, 0)).toBe(g);
    expect(eraseTile(g, 3, 0)).toBe(g);
    expect(paintTile(g, 0, 2)).toBe(g);
  });

  it('is a no-op when the tile is already in the requested state', () => {
    const g = garden();
    expect(paintTile(g, 0, 0)).toBe(g);
  });
});
