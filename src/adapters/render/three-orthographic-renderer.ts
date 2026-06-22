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
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import type { RendererPort } from '../../ports';
import type { SceneDescription, SceneTile } from '../../core';

const LIT_COLOR = new Color(0xf4d35e);
const SHADOW_COLOR = new Color(0x39465a);
const OBJECT_COLORS: Record<string, number> = {
  building: 0xb08968,
  fence: 0x9c7a54,
  tree: 0x6a994e,
};

// Heatmap highlights: the sunniest / shadiest tiles glow so they pop out.
const SUNNIEST_GLOW = new Color(0xffe08a);
const SHADIEST_GLOW = new Color(0x3a6ff0);
const NO_GLOW = new Color(0x000000);
const HIGHLIGHT_INTENSITY = 0.9;

const TILE_GAP = 0.04; // fraction of a tile left as a grid seam

export class ThreeOrthographicRenderer implements RendererPort {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: OrthographicCamera;
  private readonly sunLight = new DirectionalLight(0xffffff, 1.6);
  private readonly group = new Group();
  private tileMeshes: Mesh[] = [];
  private structureKey = '';

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(canvas.width, canvas.height, false);
    this.scene.background = new Color(0x10141c);

    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    this.scene.add(this.group);
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

    const tileGeometry = new PlaneGeometry(1 - TILE_GAP, 1 - TILE_GAP);
    for (const tile of scene.tiles) {
      const material = new MeshStandardMaterial({ roughness: 0.95 });
      this.applyTileAppearance(material, tile);
      const mesh = new Mesh(tileGeometry, material);
      mesh.rotation.x = -Math.PI / 2; // lay flat on the XZ plane
      mesh.position.set(
        tile.x + 0.5,
        tile.elevationM / scene.tileSizeM,
        tile.y + 0.5,
      );
      this.group.add(mesh);
      this.tileMeshes.push(mesh);
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
        obj.footprint.x + obj.footprint.width / 2,
        baseTiles + heightTiles / 2,
        obj.footprint.y + obj.footprint.depth / 2,
      );
      this.group.add(mesh);
    }

    // Orient the whole garden to true north and frame the camera.
    this.group.rotation.y = -scene.camera.northRotation;
    this.frameCamera(scene);
  }

  private updateTileColors(scene: SceneDescription): void {
    for (let i = 0; i < this.tileMeshes.length; i++) {
      const mesh = this.tileMeshes[i];
      const tile = scene.tiles[i];
      if (!mesh || !tile) continue;
      this.applyTileAppearance(mesh.material as MeshStandardMaterial, tile);
    }
  }

  /**
   * Paints a tile's surface colour and highlight glow. In heatmap mode the tile
   * carries a precomputed `colorHex`; otherwise it falls back to binary
   * lit/shadow. The sunniest / shadiest tiles get an emissive glow.
   */
  private applyTileAppearance(
    material: MeshStandardMaterial,
    tile: SceneTile,
  ): void {
    if (tile.colorHex != null) material.color.set(tile.colorHex);
    else material.color.copy(tile.lit ? LIT_COLOR : SHADOW_COLOR);

    if (tile.highlight === 'sunniest') material.emissive.copy(SUNNIEST_GLOW);
    else if (tile.highlight === 'shadiest')
      material.emissive.copy(SHADIEST_GLOW);
    else material.emissive.copy(NO_GLOW);
    material.emissiveIntensity = tile.highlight ? HIGHLIGHT_INTENSITY : 0;
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
    const half = span * 0.75;
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
