// Renderer port.
//
// The core produces a neutral, serializable scene description; a rendering
// adapter consumes it through this port and draws it with whatever engine it
// likes. Keeping the renderer behind a port is the load-bearing decision that
// lets us swap engines (first: imperative Three.js) without touching the core.

import type { SceneDescription } from '../core/scene';

export interface RendererPort {
  /** Draw (or redraw) the garden from a scene description. */
  render(scene: SceneDescription): void;
  /** Release any engine resources. */
  dispose(): void;
}
