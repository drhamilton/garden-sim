import { describe, expect, it } from 'vitest';
import {
  objectAt,
  placeObject,
  removeObjectAt,
  updateObjectAt,
} from './object-editor';
import type { Garden } from './types';

function garden(): Garden {
  return {
    width: 4,
    depth: 4,
    groundLevels: new Array(16).fill(0),
    objects: [],
    northRotation: 0,
    latitude: 0,
    longitude: 0,
  };
}

describe('object editor use-cases', () => {
  it('places a building footprint with sensible defaults', () => {
    const g = placeObject(garden(), 'building', {
      x: 1,
      y: 1,
      width: 2,
      depth: 2,
    });
    expect(g.objects).toHaveLength(1);
    expect(g.objects[0]).toMatchObject({
      kind: 'building',
      footprint: { x: 1, y: 1, width: 2, depth: 2 },
      baseLevel: 0,
    });
    expect(g.objects[0]!.heightM).toBeGreaterThan(0);
  });

  it('gives trees a default transmittance, and buildings/fences opaque defaults', () => {
    const g = placeObject(garden(), 'tree', { x: 0, y: 0, width: 1, depth: 1 });
    expect(g.objects[0]!.transmittance).toBeGreaterThan(0);

    const fenced = placeObject(garden(), 'fence', {
      x: 0,
      y: 0,
      width: 1,
      depth: 1,
    });
    expect(fenced.objects[0]!.transmittance ?? 0).toBe(0);
  });

  it('gives a freshly placed tree a default deciduous range, persisted on the model', () => {
    const g = placeObject(garden(), 'tree', { x: 0, y: 0, width: 1, depth: 1 });
    expect(g.objects[0]!.deciduousRange).toBeDefined();

    const building = placeObject(garden(), 'building', {
      x: 0,
      y: 0,
      width: 1,
      depth: 1,
    });
    expect(building.objects[0]!.deciduousRange).toBeUndefined();
  });

  it('does not mutate the input garden', () => {
    const g = garden();
    placeObject(g, 'building', { x: 0, y: 0, width: 1, depth: 1 });
    expect(g.objects).toHaveLength(0);
  });

  it("updates an object's height, base level, transmittance, and deciduous range", () => {
    const placed = placeObject(garden(), 'tree', {
      x: 0,
      y: 0,
      width: 1,
      depth: 1,
    });
    const updated = updateObjectAt(placed, 0, {
      heightM: 6.5,
      baseLevel: 1,
      transmittance: 0.3,
      deciduousRange: { leafOn: '04-15', leafOff: '10-31' },
    });
    expect(updated.objects[0]).toMatchObject({
      heightM: 6.5,
      baseLevel: 1,
      transmittance: 0.3,
      deciduousRange: { leafOn: '04-15', leafOff: '10-31' },
    });
    // Original is untouched.
    expect(placed.objects[0]!.heightM).not.toBe(6.5);
  });

  it('is a no-op when updating an out-of-range index', () => {
    const g = garden();
    expect(updateObjectAt(g, 0, { heightM: 5 })).toBe(g);
    expect(updateObjectAt(g, -1, { heightM: 5 })).toBe(g);
  });

  it('removes an object by index', () => {
    const placed = placeObject(garden(), 'building', {
      x: 0,
      y: 0,
      width: 1,
      depth: 1,
    });
    const removed = removeObjectAt(placed, 0);
    expect(removed.objects).toHaveLength(0);
  });

  it('is a no-op when removing an out-of-range index', () => {
    const g = garden();
    expect(removeObjectAt(g, 0)).toBe(g);
  });

  it('finds the topmost object covering a tile, by footprint containment', () => {
    const g = placeObject(
      placeObject(garden(), 'building', { x: 0, y: 0, width: 2, depth: 2 }),
      'tree',
      { x: 1, y: 1, width: 1, depth: 1 },
    );
    expect(objectAt(g, 1, 1)).toBe(1); // tree, placed later, covers (1,1) too
    expect(objectAt(g, 0, 0)).toBe(0); // only the building covers (0,0)
    expect(objectAt(g, 3, 3)).toBeNull();
  });
});
