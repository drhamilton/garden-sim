# Garden Sun Simulation

A web app that simulates sunlight on a virtual model of a real garden, so a gardener can find the sunniest and shadiest spots before planting. This context covers the simulation core and its rendering/solar adapters.

## Language

### Garden model

**Tile**:
A 1ft × 1ft cell of the garden grid — the square-foot gardening unit and the unit observations attach to. Identified by integer `(x, y)` grid coordinates.
_Avoid_: Cell, square, pixel

**Ground level**:
A discrete, stepped base elevation for a tile column (lawn = 0, raised deck = +1, …). Not continuous terrain.
_Avoid_: Terrain, height (for ground), altitude

**Garden object**:
A light-blocking thing placed on the grid — a building, fence, or tree — with a footprint, a base level, a height in metres, and a light transmittance in [0,1] (0 = opaque, 1 = fully transparent). Transmissive objects (e.g. tree canopies) cast dappled shade.
_Avoid_: Obstacle, entity, prop

**Transmittance**:
The fraction of light a garden object lets through, in [0,1] — 0 = opaque, 1 = fully transparent. A tree canopy at 0.5 passes half the sunlight, so tiles under it accrue fractional (dappled) sun-hours rather than full sun or full shade.
_Avoid_: Opacity, alpha, density

**Footprint**:
The axis-aligned rectangle of tiles a garden object occupies, in tile units.

**North rotation**:
The compass bearing (radians, clockwise from true north) of the grid's +y axis — how far the model is turned away from having +y point at true north.
_Avoid_: Orientation, heading, bearing (for the garden)

### Simulation

**Heightfield**:
The derived per-tile surface and obstacle heights (metres) the shadow pass marches across. The 2.5D extruded-footprint model — not full 3D meshes.

**Sun position**:
Where the sun is in the sky: azimuth (compass bearing clockwise from true north) and elevation (angle above the horizon), both radians.
_Avoid_: Sun angle, solar vector; "altitude" for elevation

**Shadow pass**:
The core computation that, for a given sun position, ray-casts from each tile's surface toward the sun to find how much direct light it receives. Objects honour transmittance, so the result is fractional — not just lit/shadow. Both the instantaneous scrub view and the sun-hours heatmap are built on it.
_Avoid_: Ray trace, occlusion test

**Sun fraction grid**:
The per-tile fraction of direct sunlight in [0,1] the shadow pass produces — 1 = unobstructed, 0 = opaque shadow, intermediate = dappled (the product of the transmittances of every object the ray passes through, each object counted once). Stacked/distinct transmissive blockers combine multiplicatively. The scrub view ramps tile colour by it directly; the sun-hours aggregation integrates it over time.

**Sun-hours heatmap**:
The aggregate result (a later slice): each tile's average sunlight hours per day over a time window. The contract the future plants module consumes.
_Avoid_: Sun map, exposure map

### Architecture

**Core**:
The pure, framework-agnostic simulation domain. No DOM, no renderer, no I/O — headlessly testable.

**Scene description**:
The core's neutral, serializable view-model (tiles with position/elevation/lit state, objects as footprints+heights, camera/orientation). The contract between the core and any rendering adapter; assertable without an engine.
_Avoid_: View model, render data, draw list

**Solar-position port**:
The interface the core uses to learn the sun position for a location, date, and time. Adapter wraps a standard solar algorithm.

**Renderer port**:
The interface a rendering adapter implements to draw a scene description. First adapter: imperative Three.js with an orthographic camera (kept framework-independent — not react-three-fiber).
