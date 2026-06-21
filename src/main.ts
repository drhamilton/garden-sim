// App shell entry point (walking skeleton).
//
// Wires nothing yet beyond locating the canvas the renderer adapter will
// eventually draw into. All real logic (scene description, renderer port,
// solar model, sun-hours engine) is deferred to later slices.

const canvas = document.querySelector<HTMLCanvasElement>('#garden-canvas');

if (!canvas) {
  throw new Error('garden-sim: #garden-canvas element not found');
}
