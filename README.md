# Garden Sun Simulation

A web app that simulates sunlight on a virtual model of a real garden, so a
gardener can find the sunniest and shadiest spots before planting. You lay out a
garden's tiles, place light-blocking objects (buildings, fences, trees), and the
app shows where the sun falls — both instantaneously (scrub the time of day) and
aggregated into a **sun-hours heatmap** over a season.

It's built as a **pure simulation core** behind ports, with swappable adapters
(a Three.js orthographic renderer, a SunCalc solar-position provider, a Web
Worker for the heavy aggregation). The core has no DOM or engine dependencies and
is headlessly testable. See [`CONTEXT.md`](CONTEXT.md) for the domain language
and [`docs/adr/`](docs/adr/) for the architectural decisions.

## Getting started

```bash
npm install
npm run dev        # start the Vite dev server
```

Then open the printed local URL. Append `?perf` to enable the in-app performance
HUD and the large stress scenes (see [Performance](#performance)).

## Scripts

| Command                        | What it does                                      |
| ------------------------------ | ------------------------------------------------- |
| `npm run dev`                  | Vite dev server                                   |
| `npm run build`                | Type-check + production build                     |
| `npm test`                     | Run the test suite once (Vitest)                  |
| `npm run test:watch`           | Tests in watch mode                               |
| `npm run typecheck`            | `tsc --noEmit`                                    |
| `npm run lint`                 | ESLint + Prettier check                           |
| `npm run format`               | Prettier write                                    |
| `npm run screenshot -- <name>` | Capture isometric-view PNGs for a PR (Playwright) |

## Performance

The app holds 60fps at the design ceiling of a ~100×100 (10,000-tile) garden —
both while scrubbing the time of day and while a season's heatmap computes. Two
bottlenecks had to be cleared to get there: the heavy aggregation was moved off
the main thread into a Web Worker, and the tile grid was switched from one mesh
per tile to a single `InstancedMesh`.

**→ [Read the performance writeup](docs/performance.md)** for the full story —
prior state, diagrams, code, and the bottlenecks faced.

## Documentation

- [`CONTEXT.md`](CONTEXT.md) — domain model and ubiquitous language
- [`docs/performance.md`](docs/performance.md) — performance writeup
- [`docs/adr/`](docs/adr/) — architectural decision records
- [`docs/prd/`](docs/prd/) — product requirements
