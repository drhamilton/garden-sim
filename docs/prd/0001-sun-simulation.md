# PRD: Garden Sun Simulation (v1)

## Problem Statement

I want to plan where to put plants in my real garden, and the single biggest factor I can't easily reason about is **sunlight**. Throughout the day and across the seasons, the sun moves, and buildings, fences, and trees throw shade that shifts with it. Standing in the garden I can't see how much sun a given spot actually gets over a whole day in June versus the whole growing season, so I can't confidently decide which spots are best for sun-loving plants and which are reliably shady. I need a way to model my garden virtually and *see* where the sun lands over time, so I can find the optimal sunny and shady spots before I commit a plant to the ground.

## Solution

A TypeScript web app that simulates sunlight on a virtual model of my real garden.

I build a top-down/isometric model of the garden on a 1ft tile grid (matching square-foot gardening): I paint ground tiles and raise them into discrete levels (lawn at ground level, a raised deck a level up), and I place objects — buildings, fences, trees — each with a footprint, height, and light transmittance. I set the garden's real-world latitude/longitude and rotate the model so it points to true north.

The app then renders the garden isometrically and computes, using a real astronomical solar model, where the sun lands. I can **scrub through the time of day** and watch shadows move in real time. I can also pick a **time window** — a single day, a season, or a custom range like my whole growing season — and the app produces a **sun-hours heatmap**: each tile colored by the average sunlight hours per day it receives over that window, with the sunniest and shadiest tiles highlighted. Trees cast *dappled* (partial) shade via their transmittance, and deciduous trees can let more light through in their leaf-off season — so the heatmap reflects reality, not worst-case shade.

## User Stories

1. As a gardener, I want to lay out my garden on a 1ft tile grid, so that the model maps directly onto how I already plan with square-foot gardening.
2. As a gardener, I want to paint and erase ground tiles, so that I can define the shape and extent of my garden.
3. As a gardener, I want to raise and lower regions of ground into discrete levels, so that I can represent my raised deck and any other stepped surfaces.
4. As a gardener, I want to place building footprints with a height, so that my house and shed block sunlight realistically.
5. As a gardener, I want to place fences with a height, so that boundary shading is represented.
6. As a gardener, I want to place trees with a canopy footprint and a vertical extent, so that tree shade is modeled where my trees actually are.
7. As a gardener, I want to give each object a light transmittance value, so that porous things like tree canopies cast dappled partial shade rather than solid shade.
8. As a gardener, I want to mark a tree as deciduous with a leaf-on/leaf-off date range, so that its shade correctly lessens during the bare season.
9. As a gardener, I want to set my garden's latitude and longitude, so that the sun is simulated for my actual location.
10. As a gardener, I want to rotate the model to point to true north, so that shadows fall in the correct real-world direction.
11. As a gardener, I want to view my garden isometrically with visible heights and levels, so that I can read the 3D layout at a glance.
12. As a gardener, I want to scrub the time of day with a slider, so that I can watch shadows move across the garden through a day.
13. As a gardener, I want to pick the date/time of year, so that I can see how the sun's seasonal arc changes the shade.
14. As a gardener, I want shadows to update smoothly as I scrub, so that the simulation feels responsive and continuous.
15. As a gardener, I want to choose an aggregation window (a single day, a season, or a custom date range), so that I can analyze sunlight over the period I care about.
16. As a gardener, I want a sun-hours heatmap that colors each tile by its average sunlight hours per day over the window, so that I can compare spots quantitatively.
17. As a gardener, I want the sunniest and shadiest tiles highlighted, so that I can immediately find optimal sunny and shady spots.
18. As a gardener, I want dappled-shade tiles to accrue fractional sun-hours, so that "half shade" shows up as a real intermediate number rather than full sun or full shade.
19. As a gardener, I want deciduous seasonality reflected in the heatmap, so that a bed under a bare tree in early spring reads as sunnier than the same bed in midsummer.
20. As a gardener, I want the simulation to stay fast even for a large garden, so that scrubbing and analysis never feel sluggish.
21. As a gardener, I want sampling resolution (time-of-day step, cross-day sampling) to be adjustable, so that I can trade precision for speed when I want to.
22. As a developer, I want the simulation core to run headlessly with no renderer, so that I can unit-test sunlight behavior directly.
23. As a developer, I want the rendering engine to sit behind a port, so that I can swap Three.js for another engine without touching the model.
24. As a developer, I want the core to emit a neutral scene description, so that any rendering adapter can draw it and I can assert on it in tests.
25. As a developer, I want the solar-position algorithm behind a port, so that it is swappable and verifiable against known values.
26. As a developer, I want heavy aggregation to run off the main thread, so that the UI stays responsive during a season-long heatmap computation.
27. As a developer, I want performance benchmarks for the sun-hours engine from day one, so that regressions surface early.
28. As a gardener, I want my in-progress garden to persist in memory during a session, so that I can keep working without re-entering everything (durable save/load is a later feature).

## Implementation Decisions

**Architecture — hexagonal (ports & adapters).** A pure, framework-agnostic TypeScript **simulation core** holds all domain logic. Everything else is an adapter behind a port. This is the load-bearing decision; it makes the core headlessly testable and makes the renderer, UI framework, solar library, and worker independently swappable.

**Core domain model.**
- The garden is a grid of **1ft × 1ft tiles** (square-foot gardening unit; also the future unit for plant placement).
- **Ground levels are discrete**: each tile column has a stepped base elevation (lawn = 0, deck = +1 step, etc.). No continuous terrain/gradients.
- **Objects** have a footprint (on the grid), a **base elevation**, a **height in meters (free/continuous, not quantized)**, and a **transmittance** value in [0,1] (0 = opaque, 1 = fully transparent).
- **Trees** additionally may carry **deciduous seasonality**: a leaf-on transmittance and a leaf-off transmittance, switched by a leaf-on/leaf-off date range.
- The world is internally a **2.5D extruded-footprint / tile-heightfield** model — not full 3D meshes.

**Solar model.** Real astronomical sun position (azimuth + elevation) computed from **latitude/longitude + date + time** via a standard solar-position algorithm (e.g. SunCalc / NOAA), behind a **solar-position port**. Garden **orientation (true north)** is a settable rotation stored with the garden. Location is a stored lat/long field (no geocoding search in v1).

**Sunlight computation.** For a given sun position, each tile is evaluated by casting a ray toward the sun across the tile heightfield; if blocked by a taller column/object the tile is shaded. **Transmittance makes this fractional**: a tile under 50%-transmittance canopy accrues 0.5 sun-hours for that lit step. Two modes share this core:
- **Instantaneous**: lit/shadow (and fractional) state at the current time.
- **Aggregate**: integrate across a window → **average sun-hours per day** per tile (the heatmap). A cumulative total is at most an internal detail; the reported number is average/day.

**Time & windows.** Intra-day integration steps the sun on a tunable interval (generous default, e.g. ~15 min). Multi-day windows **sample representative days** (e.g. ~weekly) and average, since day-to-day solar change is small. Windows: presets (single day, month, season) plus a **custom date range**; "growing season" is just a user-set custom range (not hardcoded). All sampling parameters are tunable config with sensible defaults — precision is explicitly *not* the priority.

**Rendering — neutral scene description (port).** The core produces a **render-agnostic scene description**: a serializable list of renderable primitives (tiles at positions/elevations, objects as footprints+heights, per-tile heatmap colors) plus camera/orientation params. Rendering adapters translate this into their engine. First adapter: **Three.js with an orthographic camera** (isometric look; native height/occlusion handling), kept **imperative and framework-independent** (deliberately *not* react-three-fiber, to preserve renderer swappability). The 3D engine is for display only — quantitative sun-hours are always computed on the heightfield in the core.

**App shell.** TypeScript web app. The **UI framework is a driving adapter and is deferred** pending a research spike (React vs Svelte/Vue/Solid). Note: the heavy work is on the canvas and in the worker, not the DOM, so framework perf is largely moot here. The tracer-bullet slice uses **minimal vanilla controls** so it isn't blocked on the framework choice.

**Performance.**
- Design ceiling: **~100×100 tiles (10,000)**.
- **Scrubbing: 60fps target** (~16ms/frame) — instantaneous shadow pass kept tight (typed arrays for the grid).
- **Heatmap: <1s for a single day; a few seconds with a progress indicator acceptable for a full season.** Aggregation **offloaded to a Web Worker behind a port**; the core logic stays pure/synchronous and the worker is the off-thread adapter.
- **Day-one benchmarks** for the sun-hours engine against a budget.

**Persistence.** **In-memory only** for v1. No durable save/load; a refresh resetting state is acceptable.

**Tracer-bullet first slice.** On a small grid: place one building and one tree (manual editor) → set lat/long + north + a date → scrub time-of-day and watch shadows move in the isometric view → compute a one-day sun-hours heatmap and highlight sunniest/shadiest tiles. This forces every architectural seam (domain → solar port → sun-hours engine → scene-description port → Three.js adapter → inbound use-cases/time controls) to exist and connect; later work is increments on a working spine.

**Seam to the future plants module.** The **per-tile sun-hours profile (the heatmap) is the contract** the later plants module consumes, and the **tile is the unit observations attach to** (year-over-year per-tile records). Keep this seam clean.

## Testing Decisions

Good tests here assert **external behavior, not implementation details** — given inputs to a public seam, assert outputs; never reach into private structures or step counts.

Seams (highest first), all new (greenfield), proposed at the highest points:

1. **Sun-sim core domain API (primary).** Headless: given a garden model (tiles, levels, objects with heights + transmittance), lat/long, north, and date/time → assert the **sun-hours grid** and **instantaneous lit/shadow** output. The vast majority of behavior is tested here with no renderer, DOM, or worker. Cases to cover: a single blocker's shadow direction/length at a known sun position; seasonal change (summer vs winter elevation); fractional sun-hours under partial transmittance; deciduous leaf-on vs leaf-off difference; multi-day average-per-day aggregation; north-rotation correctness.
2. **Scene-description port.** Assert the neutral view-model (snapshot-style): placing an object / setting a time yields the expected renderable primitives + heatmap colors — verifying the core→renderer boundary **without Three.js**.
3. **Solar-position port.** Verify the adapter against a few **known solar positions** (published azimuth/elevation for a known lat/long/date/time within tolerance); the core consumes it through the port (a stub adapter can drive deterministic core tests).
4. **Performance benchmarks** (distinct test type): sun-hours engine at the ~10k-tile ceiling, full-day heatmap, under a stated time budget — run from day one so regressions surface.

No prior art exists yet (greenfield); these seams establish the patterns. The renderer (Three.js) and UI controls are deliberately thin adapters and are **not** the primary test target — behavior is proven at the core and scene-description seams.

## Out of Scope

- **Reality capture** — importing geo data or a satellite/site photo and translating it (possibly via an LLM) into the map model. Its own later epic; the manual map editor is the v1 foundation.
- **Plants module** — plant recommendation (matching a tile's sun profile to suitable plants) and the observation/journal tracking of what grew well/poorly per tile across seasons and years (yield, etc.), which will need a database. Separate epic, behind the per-tile sun-hours seam.
- **Durable persistence / save-load / sharing** — v1 is in-memory only.
- **Continuous terrain / slopes / gradients** — discrete flat levels only.
- **Full 3D meshes / free-camera navigation** — 2.5D model, fixed isometric/orthographic view.
- **Geocoding place-name search** — location is a manually entered lat/long.
- **High-precision solar/atmospheric modeling** — "good enough, adjustable" is the explicit standard.

## Further Notes

- **Voice-authored requirements**: this PRD was elicited via a voice interview; minor transcription artifacts were resolved in conversation (e.g. an apparent "database" reference for lat/long was a mis-transcription — location is just a stored field).
- **Deferred items still to specify during implementation** (agreed as implementation-time detail, not blockers): the exact **neutral scene-description schema** (which primitives it carries), the **object taxonomy** for v1 (building / fence / tree — and whether raised beds, pergolas, etc. are distinct types or generic blocks), and the **scale-calibration & north-setting UX** specifics.
- **Guiding principle**: precision is not the goal; "good enough now, adjustable later" governs all sampling/fidelity parameters, which are tunable config with generous defaults.
