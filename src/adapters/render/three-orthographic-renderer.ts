// Imperative Three.js orthographic renderer adapter.
//
// Consumes the core's neutral SceneDescription and draws the garden
// isometrically with an orthographic camera. Deliberately framework-independent
// (NOT react-three-fiber) so the renderer stays swappable behind RendererPort.
//
// The 3D engine is for display only: lit/shadow state is computed in the core
// and baked into per-tile colours here. A directional light (aimed from the
// sun) shades the extruded object boxes so heights read at a glance.

import {
  AmbientLight,
  ArrowHelper,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { RendererPort } from '../../ports';
import type { SceneDescription, SceneTile } from '../../core';

const LIT_COLOR = new Color(0xf4d35e);
const SHADOW_COLOR = new Color(0x39465a);
const INACTIVE_COLOR = new Color(0x1a1f29);
const INACTIVE_OPACITY = 0.25;
const OBJECT_COLORS: Record<string, number> = {
  building: 0xb08968,
  fence: 0x9c7a54,
  tree: 0x6a994e,
};

const TILE_GAP = 0.04; // fraction of a tile left as a grid seam

// North-marker placement, as fractions of the garden span / world units. The
// arrow base sits beyond the grid's circumscribed circle (half-diagonal ≈
// 0.707·span) so a rotated garden never reaches it; the camera framing widens
// to keep the whole marker on screen.
const NORTH_MARKER_RADIUS_FRAC = 0.74; // centre → arrow base
const NORTH_MARKER_LENGTH_FRAC = 0.16; // arrow length
const NORTH_MARKER_LABEL_GAP = 0.6; // tip → "N" label, world units
const NORTH_MARKER_LABEL_HALF = 0.9; // ~half the label sprite, world units

/** Outer world-distance from the grid centre the north marker occupies. */
function northMarkerReach(span: number): number {
  return (
    span * (NORTH_MARKER_RADIUS_FRAC + NORTH_MARKER_LENGTH_FRAC) +
    NORTH_MARKER_LABEL_GAP +
    NORTH_MARKER_LABEL_HALF
  );
}

export class ThreeOrthographicRenderer implements RendererPort {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: OrthographicCamera;
  private readonly sunLight = new DirectionalLight(0xffffff, 1.6);
  private readonly group = new Group();
  /** Fixed true-north marker (lives outside `group`, so it never rotates). */
  private readonly northIndicator = new Group();
  /** Span the north marker was last built for; -1 until first built. */
  private northMarkerSpan = -1;
  private readonly raycaster = new Raycaster();
  private readonly scratchColor = new Color();
  private tileMeshes: Mesh[] = [];
  /** The grid coordinate each tile mesh stands for, for pointer picking. */
  private readonly tileCoordByMesh = new Map<Mesh, { x: number; y: number }>();
  private structureKey = '';

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(canvas.width, canvas.height, false);
    this.scene.background = new Color(0x10141c);

    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    this.scene.add(this.group);
    this.scene.add(this.northIndicator);
    this.scene.add(new AmbientLight(0xffffff, 0.55));
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
  }

  render(scene: SceneDescription): void {
    const key = this.computeStructureKey(scene);
    if (key !== this.structureKey) {
      this.rebuild(scene);
      this.structureKey = key;
    } else {
      this.updateTileColors(scene);
    }
    this.updateSun(scene);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.disposeGroup();
    this.clearNorthIndicator();
    this.renderer.dispose();
  }

  // ---- internals -----------------------------------------------------------

  private computeStructureKey(scene: SceneDescription): string {
    const objKey = scene.objects
      .map(
        (o) =>
          `${o.kind}:${o.footprint.x},${o.footprint.y},${o.footprint.width},${o.footprint.depth}:${o.baseElevationM}:${o.heightM}`,
      )
      .join('|');
    return `${scene.width}x${scene.depth}:${scene.camera.northRotation}:${objKey}`;
  }

  private rebuild(scene: SceneDescription): void {
    this.disposeGroup();
    this.tileMeshes = [];
    this.tileCoordByMesh.clear();

    // Lay every mesh out relative to the grid centre (and sit the whole group
    // back at that centre, below) so north rotation spins the garden in place
    // about its middle rather than swinging it around its corner out of frame.
    const cx = scene.width / 2;
    const cz = scene.depth / 2;

    const tileGeometry = new PlaneGeometry(1 - TILE_GAP, 1 - TILE_GAP);
    for (const tile of scene.tiles) {
      const material = new MeshStandardMaterial({
        roughness: 0.95,
        transparent: true,
      });
      this.applyTileAppearance(material, tile);
      const mesh = new Mesh(tileGeometry, material);
      mesh.rotation.x = -Math.PI / 2; // lay flat on the XZ plane
      mesh.position.set(
        tile.x + 0.5 - cx,
        tile.elevationM / scene.tileSizeM,
        tile.y + 0.5 - cz,
      );
      this.group.add(mesh);
      this.tileMeshes.push(mesh);
      this.tileCoordByMesh.set(mesh, { x: tile.x, y: tile.y });
    }

    for (const obj of scene.objects) {
      const heightTiles = obj.heightM / scene.tileSizeM;
      const baseTiles = obj.baseElevationM / scene.tileSizeM;
      const geometry = new BoxGeometry(
        obj.footprint.width - TILE_GAP,
        heightTiles,
        obj.footprint.depth - TILE_GAP,
      );
      const material = new MeshStandardMaterial({
        color: OBJECT_COLORS[obj.kind] ?? 0x999999,
        roughness: 0.85,
      });
      const mesh = new Mesh(geometry, material);
      mesh.position.set(
        obj.footprint.x + obj.footprint.width / 2 - cx,
        baseTiles + heightTiles / 2,
        obj.footprint.y + obj.footprint.depth / 2 - cz,
      );
      this.group.add(mesh);
    }

    // Sit the group at the grid centre so its local origin (the rotation pivot)
    // coincides with the garden's middle; net world positions are unchanged at
    // zero rotation. Then orient to true north and frame the camera.
    this.group.position.set(cx, 0, cz);
    this.group.rotation.y = -scene.camera.northRotation;
    this.rebuildNorthIndicator(scene);
    this.frameCamera(scene);
  }

  /**
   * (Re)builds the fixed true-north marker: a needle pointing at world +Z
   * (north in this scene's compass convention) with an "N" label, sitting
   * outside the garden's footprint so the rotating model never collides with
   * it. It stays put while the garden turns, so the model's orientation
   * relative to true north reads at a glance. Drawn with depth-testing off so
   * tall objects never hide it.
   */
  private rebuildNorthIndicator(scene: SceneDescription): void {
    const span = Math.max(scene.width, scene.depth);
    // The marker is fixed to true north and sized only by span, so a
    // rotation-only rebuild can reuse it — skip recreating its canvas texture.
    if (span === this.northMarkerSpan && this.northIndicator.children.length)
      return;
    this.northMarkerSpan = span;
    this.clearNorthIndicator();
    const cx = scene.width / 2;
    const cz = scene.depth / 2;
    const radius = span * NORTH_MARKER_RADIUS_FRAC;
    const length = span * NORTH_MARKER_LENGTH_FRAC;

    const base = new Vector3(cx, 0.5, cz + radius);
    const arrow = new ArrowHelper(
      new Vector3(0, 0, 1),
      base,
      length,
      0xff5566,
      length * 0.4,
      length * 0.26,
    );
    for (const part of [arrow.line, arrow.cone]) {
      const materials = Array.isArray(part.material)
        ? part.material
        : [part.material];
      for (const material of materials) {
        material.depthTest = false;
        material.transparent = true;
      }
      part.renderOrder = 999;
    }
    this.northIndicator.add(arrow);

    const label = this.makeNorthLabel();
    label.position.set(cx, 0.5, cz + radius + length + NORTH_MARKER_LABEL_GAP);
    this.northIndicator.add(label);
  }

  /** A camera-facing "N" sprite for the north marker. */
  private makeNorthLabel(): Sprite {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#10141c';
    ctx.strokeText('N', size / 2, size / 2);
    ctx.fillStyle = '#ff8a99';
    ctx.fillText('N', size / 2, size / 2);

    const material = new SpriteMaterial({
      map: new CanvasTexture(canvas),
      depthTest: false,
      transparent: true,
    });
    const sprite = new Sprite(material);
    sprite.scale.set(1.4, 1.4, 1.4);
    sprite.renderOrder = 1000;
    return sprite;
  }

  private clearNorthIndicator(): void {
    for (const child of [...this.northIndicator.children]) {
      this.northIndicator.remove(child);
      if (child instanceof ArrowHelper) child.dispose();
      else if (child instanceof Sprite) {
        child.material.map?.dispose();
        child.material.dispose();
      }
    }
  }

  private updateTileColors(scene: SceneDescription): void {
    for (let i = 0; i < this.tileMeshes.length; i++) {
      const mesh = this.tileMeshes[i];
      const tile = scene.tiles[i];
      if (!mesh || !tile) continue;
      this.applyTileAppearance(mesh.material as MeshStandardMaterial, tile);
    }
  }

  private applyTileAppearance(
    material: MeshStandardMaterial,
    tile: SceneTile,
  ): void {
    material.color.copy(this.baseColorFor(tile));
    material.opacity = tile.active ? 1 : INACTIVE_OPACITY;
    material.emissiveIntensity = 0;
  }

  /** The tile's colour ignoring opacity: heatmap colour, lit/shadow, or inactive. */
  private baseColorFor(tile: SceneTile): Color {
    if (!tile.active) return INACTIVE_COLOR;
    if (tile.colorHex != null) return this.scratchColor.set(tile.colorHex);
    return tile.lit ? LIT_COLOR : SHADOW_COLOR;
  }

  /** Maps a pointer position in CSS pixels to the grid tile under it. */
  pickTile(clientX: number, clientY: number): { x: number; y: number } | null {
    const canvasRect = this.canvas.getBoundingClientRect();
    // Raycaster.setFromCamera expects the pointer as x/y in [-1, 1] across the
    // canvas (its "normalized device coordinates"), not CSS pixels.
    const pointerAsUnitSquareCoords = new Vector2(
      ((clientX - canvasRect.left) / canvasRect.width) * 2 - 1,
      -((clientY - canvasRect.top) / canvasRect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointerAsUnitSquareCoords, this.camera);
    const hit = this.raycaster.intersectObjects(this.tileMeshes, false)[0];
    if (!hit || !(hit.object instanceof Mesh)) return null;
    return this.tileCoordByMesh.get(hit.object) ?? null;
  }

  private updateSun(scene: SceneDescription): void {
    const { azimuth, elevation } = scene.sun;
    const e = Math.max(elevation, 0.05);
    // Sun direction in world space. Grid +x → world +X (east),
    // grid +y → world +Z (north), Y is up.
    const dir = {
      x: Math.sin(azimuth) * Math.cos(e),
      y: Math.sin(e),
      z: Math.cos(azimuth) * Math.cos(e),
    };
    const distance = Math.max(scene.width, scene.depth) * 2;
    this.sunLight.position.set(
      dir.x * distance,
      dir.y * distance,
      dir.z * distance,
    );
    this.sunLight.target.position.set(0, 0, 0);
    this.sunLight.intensity = elevation > 0 ? 1.6 : 0;
  }

  private frameCamera(scene: SceneDescription): void {
    const span = Math.max(scene.width, scene.depth);
    // Wide enough for the garden (and the north marker beyond it) at any
    // rotation; a marker point at world-distance r projects to ≤ r on screen
    // under the orthographic camera, so framing to its reach keeps it visible.
    const half = Math.max(span * 0.75, northMarkerReach(span));
    const aspect = this.canvas.width / this.canvas.height;
    this.camera.left = -half * aspect;
    this.camera.right = half * aspect;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.updateProjectionMatrix();

    // Isometric vantage above the grid centre, looking down the (1,1,1) axis.
    const cx = scene.width / 2;
    const cz = scene.depth / 2;
    const d = span;
    this.camera.position.set(cx + d, d, cz + d);
    this.camera.lookAt(cx, 0, cz);
  }

  private disposeGroup(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (child instanceof Mesh) {
        child.geometry.dispose();
        const material = child.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material.dispose();
      }
    }
  }
}
