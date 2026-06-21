# ADR 0001 — Hexagonal core, neutral scene description, and angle conventions

- Status: Accepted
- Date: 2026-06-21
- Slice: #2 (Sun-sim spine)

## Context

The sun-sim spine (#2) had to design the load-bearing seams the rest of the PRD builds on: the core domain API, the solar boundary, and the core→renderer boundary. The PRD parked the exact scene-description schema and angle conventions as "specify during implementation". This ADR records the decisions made.

## Decision

**Hexagonal (ports & adapters).** A pure `core/` holds all domain logic (garden model, heightfield, shadow pass, scene description) with no DOM, renderer, or I/O. Everything else is an adapter behind a port in `ports/`:

- **Solar-position port** — the core asks for a `SunPosition` given location + date; an adapter wraps the solar algorithm.
- **Renderer port** — an adapter consumes a `SceneDescription` and draws it.

This keeps the core headlessly testable (the primary test seam) and the solar library, renderer, and (future) worker independently swappable.

**Neutral scene description.** The core emits a plain, JSON-serializable `SceneDescription` (tiles with grid position + metric elevation + lit state; objects as footprints + metric base/height; an orthographic camera carrying `northRotation`; the lighting sun). Rendering adapters translate it into their engine. Tests assert on it directly — no engine needed.

**2.5D heightfield, not meshes.** The world is a tile heightfield with per-tile `surface` and `obstacle` heights in metres. The shadow pass ray-marches the obstacle field; lit/shadow is evaluated at each tile's surface. Quantitative results always come from the heightfield in the core; the 3D engine is display-only.

**Angle conventions (the part most prone to silent bugs):**

- **Azimuth** is a compass bearing, clockwise from true north: N = 0, E = π/2, S = π, W = 3π/2 (radians).
- **Elevation** is the angle above the horizon: 0 at horizon, π/2 at zenith, negative below (night → whole garden shadowed).
- **North rotation** is the compass bearing of the grid's +y axis. The shadow pass works in grid-relative bearing `azimuth − northRotation`, so rotating the garden rotates the shadows.
- World mapping in the renderer: grid +x → world +X (east), grid +y → world +Z (north), Y up.

**Units.** Tiles are 1ft (`TILE_SIZE_M = 0.3048`); ground levels step by `LEVEL_HEIGHT_M`; object heights are free/continuous metres.

## Consequences

- The vast majority of behaviour is proven headlessly at the core and scene-description seams; the Three.js renderer and vanilla UI are deliberately thin, untested adapters.
- The installed SunCalc is the genuine registry **v2.0.0** (mourner/suncalc — confirmed by the lockfile `resolved` URL + `integrity` hash), whose API changed from the **v1** that the bundled `@types/suncalc` still describes: v2 returns a north-based clockwise azimuth and a refraction-corrected altitude in **degrees**, where v1 returned radians measured from south. Because the types lag the runtime, TypeScript can't catch a units/convention error at this boundary — so `suncalc-solar-position.test.ts` pins a known position (Greenwich solstice noon ≈ 62° elevation, ≈ 180° azimuth) and fails loudly if a dependency or `@types` change ever flips the convention. The adapter (degrees→radians, no offset) absorbs the mismatch so it never reaches the core.
- The fractional/transmittance and deciduous behaviours (later slices) extend the shadow pass without changing these seams: `lit` becomes fractional, objects gain transmittance.
