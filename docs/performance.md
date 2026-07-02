# Performance

How the garden-sim hit its frame budget — the two ceilings we ran into, why each
one happened, and how each was fixed. Both share one lesson: **the slow part was
rarely the work itself; it was the overhead wrapped around the work.**

The design ceiling is the PRD's `~100×100 = 10,000-tile` garden, scrubbed and
heat-mapped at 60fps (≈16.7ms/frame).

---

## TL;DR

| Ceiling           | Symptom                                       | Root cause                                          | Fix                                        | Result                                                 |
| ----------------- | --------------------------------------------- | --------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------ |
| **Compute** (#9)  | UI froze for seconds while a heatmap computed | Aggregation ran on the main thread                  | Move it to a **Web Worker**                | UI stays at 60fps; a season's ~6s compute never blocks |
| **Render** (#31)  | Scrubbing the 100² scene ran ~15–21fps        | One Three.js `Mesh` per tile → 10k draw calls/frame | Render the grid as one **`InstancedMesh`** | 67.8ms → **4.4ms**/frame (~15fps → ~60fps)             |
| _Follow-up_ (#33) | North-rotation drag still rebuilds            | `northRotation` in the structure key                | Drop it from the key                       | _open_                                                 |

---

## First: you can't fix what you can't see

Before touching either bottleneck, Slice 9 added the **measurement tooling** that
turned "feels janky" into numbers:

- **`?perf` HUD** (`src/adapters/perf/perf-hud.ts`) — an in-app overlay showing
  two live numbers: `heatmap:` end-to-end aggregation latency, and `scrub:` a
  rolling main-thread render time per frame against the 16.7ms budget.
- **Stress scenes** — `Perf 48²` (smooth) and `Perf 100²` (the design ceiling),
  added only under `?perf` so they never clutter the normal scene list.
- **User Timing marks** (`src/adapters/perf/user-timing.ts`) — `performance.mark`
  /`measure` so the work shows up on the browser's Performance timeline.
- **A headless regression bench** (`src/core/sun-hours.bench.test.ts`) — asserts
  the compute budget in CI so a regression _fails the suite_ instead of silently
  slowing the app.

Every number in this doc came out of those tools. The `scrub:` line in
particular is what surfaced the _second_ ceiling while we were fixing the first.

---

## Ceiling 1 — the compute, on the wrong thread (#9)

### The problem

The one heavy computation in the app is the **sun-hours heatmap**: for a time
window, sample the sun's position hundreds of times and, for each sample, run the
shadow pass over every tile.

```
season heatmap  =  14 days × 96 intra-day steps  ×  up to 10,000 tiles
                =  ~1,344 sun samples  ×  10k shadow-pass evaluations
                ≈  6 seconds of pure compute   (measured, single-threaded)
```

Six seconds is _fine_ as compute. The problem was **where** it ran. JavaScript is
single-threaded, so running it on the main thread means the browser can't do
anything else — no rendering, no input — until it finishes:

```
Main thread (before):
  │ scrub │ scrub │ scrub │█████████ heatmap (6s, UI frozen) █████████│ scrub │
  └───────────────────────┴──────────────────────────────────────────┴───────►
                           ▲ user clicks "heatmap"          ▲ UI thaws, finally
```

### The fix — offload to a Web Worker

Move the aggregation onto a **second thread** (a Web Worker), behind a port so
the core stays pure and synchronous:

```
Main thread (after):
  │ scrub │ scrub │ scrub │ scrub │ scrub │ scrub │ scrub │ scrub │  ← never blocks
  └───────┴───────┴───────┴───────┴───────┴───────┴───────┴───────►
              ╲ postMessage(request)            ╱ onmessage(result)
Worker thread: └──────── heatmap (6s) ──────────┘  (+ progress ticks)
```

The boundary is a small async port — the pure core (`aggregateSunHours`) doesn't
know it's being run off-thread:

```ts
// src/ports/sun-hours-port.ts
export interface SunHoursPort {
  aggregate(
    request: SunHoursRequest,
    onProgress?: (progress: SunHoursProgress) => void,
  ): Promise<SunHoursGrid>;
  dispose(): void;
}
```

Two details that matter in practice:

- **Progress** — the worker posts `progress` ticks so the UI can show a bar
  while a season computes.
- **Supersede / cancel** — scrubbing the date while a heatmap is mid-flight
  issues a _new_ request. The worker port **terminates** the running worker
  (truly cancelling the blocking loop, not just ignoring its result) and rejects
  the stale promise with a `SupersededError` the caller ignores. This is why
  dragging the date slider stays responsive instead of queueing up a backlog of
  6-second computations.

```ts
// src/adapters/worker/worker-sun-hours-port.ts — a newer request cancels the old
aggregate(request, onProgress) {
  this.#cancelInFlight();          // terminate the worker mid-loop, reject stale promise
  const worker = (this.#worker ??= this.#spawn());
  // …resolve on the worker's 'result' message…
}
```

> The headless `sun-hours.bench` is the authoritative number for this ceiling —
> single day ~0.45s (budget <1.5s), full season ~6s (budget <12s).

---

## Ceiling 2 — too many draw calls (#31)

Fixing ceiling 1 made the HUD usable, and the `scrub:` line immediately exposed a
_separate_, renderer-side ceiling: **scrubbing `Perf 100²` ran at ~15fps
(67.8ms/frame), miles over the 16.7ms budget** — even though the shadow pass was
now cheap.

### The problem — 10,000 draw calls per frame

The Three.js adapter created **one `Mesh` per tile**. At the 10k-tile ceiling,
every scrub frame did this:

```ts
// BEFORE — one Mesh + one Material per tile, recoloured every frame
for (const tile of scene.tiles) {
  // ×10,000
  const material = new MeshStandardMaterial(/* … */);
  const mesh = new Mesh(tileGeometry, material);
  this.group.add(mesh); // 10,000 children
}
// …and per frame:
for (let i = 0; i < this.tileMeshes.length; i++) {
  // ×10,000
  applyTileAppearance(mesh.material, tile); // 10,000 material writes
}
// → renderer.render() then issues ~10,000 draw calls
```

A **draw call** is the CPU telling the GPU "draw this thing." It carries fixed
setup overhead _every time_ — bind geometry, bind material, validate state, cross
the CPU→GPU boundary — roughly the same whether the thing is one tile or a
million. The cost wasn't drawing the tiles; it was **asking** 10,000 times.

```
BEFORE: 10,000 separate "draw this one tile" handoffs per frame
  CPU ─►│tile│ ─► GPU
  CPU ─►│tile│ ─► GPU      each arrow = full bind + validate + boundary cross
  CPU ─►│tile│ ─► GPU      × 10,000, sixty times a second
   …          (the GPU is mostly idle, waiting in line)

AFTER: one "draw these 10,000 tiles" handoff per frame
  CPU ─►│ 1 shape + a list of 10,000 positions/colours/opacities │ ─► GPU
        (one bind, one boundary cross; the GPU stamps the shape 10,000×)
```

### The fix — one `InstancedMesh`

Every tile is the _same shape_ (a 1×1 flat square), so the grid is a textbook case
for **instancing**: upload the geometry once, plus a per-instance list of the
things that differ (transform, colour, opacity).

```ts
// AFTER — one InstancedMesh for the whole grid
const tileMesh = new InstancedMesh(tileGeometry, makeTileMaterial(), count);

for (let tileIndex = 0; tileIndex < count; tileIndex++) {
  this.scratchTile.position.set(/* … */);
  this.scratchTile.updateMatrix();
  tileMesh.setMatrixAt(tileIndex, this.scratchTile.matrix); // transform: once, at rebuild
  this.writeTileAppearance(tileIndex, tile);                // colour + opacity
}
// …and per frame, just refill the buffers — still ONE draw call:
private writeTileAppearance(tileIndex, tile) {
  this.tileMesh.setColorAt(tileIndex, this.baseColorFor(tile));
  this.tileOpacity.setX(tileIndex, tile.active ? 1 : INACTIVE_OPACITY);
}
```

Objects (buildings, fences, trees) stayed as individual meshes — there are only a
handful, and they're _different_ shapes, so instancing buys nothing there.
Instancing pays off precisely when you have **many copies of one shape**, which
is exactly what a tile grid is.

### The one wrinkle — per-instance opacity

Erased/inactive tiles render faded (`opacity = 0.25`). With separate meshes that
was just `material.opacity` per tile — but an `InstancedMesh` shares **one**
material, so it can't vary opacity per instance, and Three.js's built-in
`setColorAt` is RGB-only (no alpha).

The fix: carry opacity in a **per-instance `instanceOpacity` attribute** and patch
the standard shader (`onBeforeCompile`) to multiply it into the fragment alpha:

```ts
// src/adapters/render/three-orthographic-renderer.ts
function patchPerInstanceOpacity(shader) {
  // vertex: forward the per-instance attribute to a varying
  shader.vertexShader = `attribute float instanceOpacity;
varying float vInstanceOpacity;
${shader.vertexShader}`.replace(
    '#include <begin_vertex>',
    'vInstanceOpacity = instanceOpacity;\n#include <begin_vertex>',
  );
  // fragment: multiply it into the final alpha
  shader.fragmentShader = `varying float vInstanceOpacity;
${shader.fragmentShader}`.replace(
    '#include <dithering_fragment>',
    'gl_FragColor.a *= vInstanceOpacity;\n#include <dithering_fragment>',
  );
}
```

### Result

Measured on the same machine via the `?perf` HUD on the `Perf 100²` scene
(software GL, so absolute numbers are conservative vs real hardware — the
_ratio_ is the point):

|                             | scrub avg | peak   | fps                  |
| --------------------------- | --------- | ------ | -------------------- |
| Before (per-tile `Mesh`)    | 67.8ms    | 82.8ms | ~15fps ⚠ over budget |
| **After (`InstancedMesh`)** | **4.4ms** | 6.8ms  | **~60fps** ✅        |

---

## How the renderer decides what to redo

The adapter splits work into two paths, gated by a **structure key** — a cheap
string of everything that changes the _shape_ of the scene (grid size, objects,
rotation). It rebuilds only when that changes; otherwise it just recolours.

```
render(scene):
  key = computeStructureKey(scene)
  if key changed → rebuild(scene)        // recreate the InstancedMesh, bake matrices
  else           → updateTileColors()    // refill colour + opacity buffers only
```

This is what makes scrubbing cheap: time-of-day doesn't change the structure key,
so every scrub frame takes the `updateTileColors` path — two buffer uploads and
one draw call, no allocation.

### Follow-up: rotation skips the rebuild (#33, shipped)

The structure key originally included `northRotation`, so **dragging the
north-rotation slider re-ran `rebuild` every tick** — even though rotation only
changes the group's parent transform, not any per-tile data. [Issue
#33](https://github.com/drhamilton/garden-sim/issues/33) dropped `northRotation`
from the key and applies the group rotation on the per-frame path instead, so
rotation takes the `updateTileColors` path like scrubbing does. On the
`Perf 100²` scene under software GL, a rotation tick fell from 28.7ms median
(over the 16.7ms scrub budget) to 2.4ms.

---

## The throughline

Both ceilings were **overhead, not work**:

- The heatmap wasn't too slow to _compute_ — it was on a thread that couldn't
  afford to block. → move the work, don't speed it up.
- The grid wasn't too slow to _draw_ — it was too slow to _ask_ to be drawn,
  10,000 times a frame. → ask once.

And both were found the same way: by **measuring first**. The HUD, the marks, and
the regression bench are the reason the bottlenecks were obvious instead of
guessed at — and the reason a future regression trips a test instead of shipping.
