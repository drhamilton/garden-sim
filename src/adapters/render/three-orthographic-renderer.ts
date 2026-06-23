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
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  Object3D,
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
import type { SceneDescription, SceneTile, SunPosition } from '../../core';
import { sunArcPath, sunMarkerPlacement } from './sun-marker';

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

// Sun-marker placement, as fractions of the garden span. The marker rides a
// sphere of radius span·RADIUS_FRAC about the grid centre, just beyond the
// north marker so it reads as sitting "in the sky".
const SUN_MARKER_RADIUS_FRAC = 0.95; // centre → sun marker
const SUN_MARKER_SIZE_FRAC = 0.28; // billboard edge length

/** Outer world-distance from the grid centre the sun marker can reach. */
function sunMarkerReach(span: number): number {
  return span * (SUN_MARKER_RADIUS_FRAC + SUN_MARKER_SIZE_FRAC / 2);
}

export class ThreeOrthographicRenderer implements RendererPort {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: OrthographicCamera;
  private readonly sunLight = new DirectionalLight(0xffffff, 1.6);
  private readonly group = new Group();
  /** Fixed true-north marker (lives outside `group`, so it never rotates). */
  private readonly northIndicator = new Group();
  /**
   * Billboarded sun marker. Lives in world space (outside `group`), at the sun
   * direction the light shines from, so the garden rotates beneath a sun fixed
   * to true north — see {@link sunMarkerPlacement}.
   */
  private readonly sunMarker = makeSunSprite();
  /**
   * The sun's daily path, drawn as a faint polyline on the same sky dome the
   * marker rides. Lives in world space (outside `group`) so it stays fixed to
   * true north while the garden rotates beneath it — like {@link sunMarker}.
   */
  private readonly sunArcLine = makeSunArcLine();
  /** Key of the arc the line geometry was last built for; rebuilt only on change. */
  private sunArcKey = '';
  /** Span the north marker was last built for; -1 until first built. */
  private northMarkerSpan = -1;
  private readonly raycaster = new Raycaster();
  private readonly scratchColor = new Color();
  private readonly scratchTile = new Object3D();
  /**
   * The whole tile grid as one InstancedMesh — one instance per tile, rather
   * than 10k separate meshes. Per-tile transform is baked once at rebuild; the
   * scrubbed-frame work is just two instanced-buffer uploads (colour + opacity).
   */
  private tileMesh: InstancedMesh | null = null;
  /** Per-instance opacity (active = 1, erased = {@link INACTIVE_OPACITY}). */
  private tileOpacity: InstancedBufferAttribute | null = null;
  /** The grid coordinate each instance stands for, indexed by `instanceId`. */
  private tileCoords: { x: number; y: number }[] = [];
  private structureKey = '';

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(canvas.width, canvas.height, false);
    this.scene.background = new Color(0x10141c);

    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    this.scene.add(this.group);
    this.scene.add(this.northIndicator);
    this.scene.add(this.sunArcLine);
    this.scene.add(this.sunMarker);
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
    this.sunArcLine.geometry.dispose();
    this.sunArcLine.material.dispose();
    this.sunMarker.material.map?.dispose();
    this.sunMarker.material.dispose();
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
    this.tileMesh = null;
    this.tileOpacity = null;
    this.tileCoords = [];

    // Lay every mesh out relative to the grid centre (and sit the whole group
    // back at that centre, below) so north rotation spins the garden in place
    // about its middle rather than swinging it around its corner out of frame.
    const cx = scene.width / 2;
    const cz = scene.depth / 2;

    const count = scene.tiles.length;
    const tileGeometry = new PlaneGeometry(1 - TILE_GAP, 1 - TILE_GAP);
    const tileOpacity = new InstancedBufferAttribute(
      new Float32Array(count),
      1,
    );
    tileGeometry.setAttribute('instanceOpacity', tileOpacity);
    const tileMesh = new InstancedMesh(tileGeometry, makeTileMaterial(), count);
    this.tileMesh = tileMesh;
    this.tileOpacity = tileOpacity;

    this.scratchTile.rotation.x = -Math.PI / 2; // lay flat on the XZ plane
    for (let tileIndex = 0; tileIndex < count; tileIndex++) {
      const tile = scene.tiles[tileIndex]!;
      this.scratchTile.position.set(
        tile.x + 0.5 - cx,
        tile.elevationM / scene.tileSizeM,
        tile.y + 0.5 - cz,
      );
      this.scratchTile.updateMatrix();
      tileMesh.setMatrixAt(tileIndex, this.scratchTile.matrix);
      this.writeTileAppearance(tileIndex, tile);
      this.tileCoords.push({ x: tile.x, y: tile.y });
    }
    tileMesh.instanceMatrix.needsUpdate = true;
    if (tileMesh.instanceColor) tileMesh.instanceColor.needsUpdate = true;
    tileOpacity.needsUpdate = true;
    this.group.add(tileMesh);

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
    const tileMesh = this.tileMesh;
    if (!tileMesh) return;
    for (let tileIndex = 0; tileIndex < this.tileCoords.length; tileIndex++) {
      const tile = scene.tiles[tileIndex];
      if (!tile) continue;
      this.writeTileAppearance(tileIndex, tile);
    }
    if (tileMesh.instanceColor) tileMesh.instanceColor.needsUpdate = true;
    if (this.tileOpacity) this.tileOpacity.needsUpdate = true;
  }

  /**
   * Writes one tile instance's colour (heatmap / lit / shadow / inactive) and
   * opacity. The opacity rides a per-instance attribute the patched tile shader
   * multiplies into the fragment alpha — see {@link makeTileMaterial} — since an
   * InstancedMesh shares one material and so can't vary `material.opacity`.
   */
  private writeTileAppearance(tileIndex: number, tile: SceneTile): void {
    this.tileMesh!.setColorAt(tileIndex, this.baseColorFor(tile));
    this.tileOpacity!.setX(tileIndex, tile.active ? 1 : INACTIVE_OPACITY);
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
    if (!this.tileMesh) return null;
    // Raycasting an InstancedMesh reports which instance was hit as `instanceId`,
    // which indexes the tile grid in the order instances were built.
    const hit = this.raycaster.intersectObject(this.tileMesh, false)[0];
    if (!hit || hit.instanceId == null) return null;
    return this.tileCoords[hit.instanceId] ?? null;
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

    this.updateSunArc(scene);
    this.updateSunMarker(scene);
  }

  /**
   * Positions the visible sun marker at the current sun direction and hides it
   * when the sun is below the horizon. Uses the true elevation (not the clamped
   * value the light uses) so a marker low in the sky reads as low.
   */
  private updateSunMarker(scene: SceneDescription): void {
    const span = Math.max(scene.width, scene.depth);
    const placement = sunMarkerPlacement(
      scene.sun,
      { x: scene.width / 2, z: scene.depth / 2 },
      span * SUN_MARKER_RADIUS_FRAC,
    );
    this.sunMarker.visible = placement.aboveHorizon;
    const { x, y, z } = placement.position;
    this.sunMarker.position.set(x, y, z);
    const size = span * SUN_MARKER_SIZE_FRAC;
    this.sunMarker.scale.set(size, size, size);
  }

  /**
   * (Re)builds the sun's daily arc polyline from the scene's day-arc samples.
   * The arc depends only on date/location (not the scrubbed time), so the
   * geometry is rebuilt solely when those change — every scrub just reuses it.
   * Hidden in heatmap mode (no arc supplied) and when the sun never clears the
   * horizon. The arc rides the same dome the marker does, so the marker always
   * sits on it.
   */
  private updateSunArc(scene: SceneDescription): void {
    const arc = scene.sunArc;
    const span = Math.max(scene.width, scene.depth);
    if (!arc || arc.length === 0) {
      this.sunArcLine.visible = false;
      return;
    }
    const key = sunArcKeyOf(arc, span);
    if (key !== this.sunArcKey) {
      const points = sunArcPath(
        arc,
        { x: scene.width / 2, z: scene.depth / 2 },
        span * SUN_MARKER_RADIUS_FRAC,
      ).map((p) => new Vector3(p.x, p.y, p.z));
      this.sunArcLine.geometry.dispose();
      this.sunArcLine.geometry = new BufferGeometry().setFromPoints(points);
      this.sunArcKey = key;
    }
    // A degenerate path (<2 points) has nothing to draw.
    const drawn = this.sunArcLine.geometry.getAttribute('position');
    this.sunArcLine.visible = (drawn?.count ?? 0) > 1;
  }

  private frameCamera(scene: SceneDescription): void {
    const span = Math.max(scene.width, scene.depth);
    // Wide enough for the garden (and the north marker beyond it) at any
    // rotation; a marker point at world-distance r projects to ≤ r on screen
    // under the orthographic camera, so framing to its reach keeps it visible.
    const half = Math.max(
      span * 0.75,
      northMarkerReach(span),
      sunMarkerReach(span),
    );
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

/**
 * The shared material for the tile InstancedMesh. Tile albedo comes from each
 * instance's colour (multiplied into the white base), but a single InstancedMesh
 * has one material and so can't vary `material.opacity` — needed for the faded
 * erased/inactive tiles. So we patch the standard shader to read a per-instance
 * `instanceAlpha` attribute and multiply it into the fragment alpha, keeping the
 * material `transparent` so that alpha actually blends.
 */
function makeTileMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    roughness: 0.95,
    transparent: true,
  });
  material.onBeforeCompile = patchPerInstanceOpacity;
  return material;
}

/**
 * Patches the standard shader to honour a per-instance `instanceOpacity` float
 * attribute, multiplying it into the final fragment alpha. The vertex stage
 * forwards the attribute to a varying; the fragment stage applies it after
 * `<dithering_fragment>` (the end of the standard fragment program).
 */
function patchPerInstanceOpacity(shader: {
  vertexShader: string;
  fragmentShader: string;
}): void {
  shader.vertexShader =
    `attribute float instanceOpacity;\nvarying float vInstanceOpacity;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      'vInstanceOpacity = instanceOpacity;\n#include <begin_vertex>',
    );
  shader.fragmentShader =
    `varying float vInstanceOpacity;\n${shader.fragmentShader}`.replace(
      '#include <dithering_fragment>',
      'gl_FragColor.a *= vInstanceOpacity;\n#include <dithering_fragment>',
    );
}

/**
 * A camera-facing sun: a soft radial glow around a bright core, drawn with
 * depth-testing off so tall objects never hide it. Position/scale/visibility
 * are set per frame in {@link ThreeOrthographicRenderer.updateSunMarker}.
 */
function makeSunSprite(): Sprite {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const centre = size / 2;
  const gradient = ctx.createRadialGradient(
    centre,
    centre,
    0,
    centre,
    centre,
    centre,
  );
  gradient.addColorStop(0, 'rgba(255, 247, 214, 1)');
  gradient.addColorStop(0.35, 'rgba(255, 211, 94, 1)');
  gradient.addColorStop(0.7, 'rgba(255, 176, 59, 0.55)');
  gradient.addColorStop(1, 'rgba(255, 176, 59, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const material = new SpriteMaterial({
    map: new CanvasTexture(canvas),
    depthTest: false,
    transparent: true,
  });
  const sprite = new Sprite(material);
  sprite.renderOrder = 1001; // above the north marker (1000)
  return sprite;
}

/**
 * A faint warm polyline for the sun's daily arc, drawn with depth-testing off
 * so tall objects never hide it. Geometry is (re)built per arc change in
 * {@link ThreeOrthographicRenderer.updateSunArc}.
 */
function makeSunArcLine(): Line<BufferGeometry, LineBasicMaterial> {
  const material = new LineBasicMaterial({
    color: 0xffd37a,
    transparent: true,
    opacity: 0.45,
    depthTest: false,
  });
  const line = new Line(new BufferGeometry(), material);
  line.renderOrder = 1000; // with the north label, beneath the sun (1001)
  line.visible = false;
  return line;
}

/**
 * A cheap identity for a day-arc + dome size: its sample count and endpoints
 * (sunrise/sunset positions) plus the span that scales the dome. Two different
 * dates give different sunrise/sunset, so this changes exactly when the drawn
 * arc would. North rotation is absent by design — the arc lives in the fixed
 * world frame and the garden rotates beneath it, so rotation never reshapes it.
 */
function sunArcKeyOf(arc: SunPosition[], span: number): string {
  const first = arc[0]!;
  const last = arc[arc.length - 1]!;
  const fmt = (p: SunPosition) =>
    `${p.azimuth.toFixed(4)},${p.elevation.toFixed(4)}`;
  return `${span}:${arc.length}:${fmt(first)}:${fmt(last)}`;
}
