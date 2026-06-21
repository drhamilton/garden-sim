# ADR 0002 — Prioritise readability: small, composable, intelligible functions

- Status: Accepted
- Date: 2026-06-21

## Context

The first cut of the simulation core packed each operation into one long function with terse, one-letter locals (the shadow pass especially). It was correct and fast but hard to read — you had to hold the whole algorithm in your head to follow any part of it.

## Decision

**Readability is a first-class goal.** Prefer breaking work into small, named functions that compose, so a caller reads like prose and each step can be understood in isolation. Concretely:

- **Name the steps.** A function's body should read as a sequence (or composition) of named operations, not a wall of inlined arithmetic. `computeLitGrid`'s core is now one line: `!isUnderObject(...) && !rayIsBlocked(...)`.
- **Name the values.** Avoid one-letter locals for anything non-trivial (`t` → `distance`, `maxT` → `maxDistance`, `tanElevation` → `slope`).
- **Extract reusable shapes.** Cross-cutting iteration belongs in a named helper (e.g. `forEachTileInFootprint`) rather than being re-inlined.
- **Declarative for one-shot transforms.** Use `.map`/`.filter`/`.reduce` for small collections built once (e.g. `garden.objects.map(toSceneObject)`).

## Performance carve-out

This does **not** override the performance budget in ADR-0001 / the PRD (60fps scrubbing, ~10k tiles, typed arrays). In a documented hot path:

- Keep the per-tile/per-frame loop **imperative over typed arrays** — do **not** convert it to `.map`/`.filter` (intermediate-array allocation causes GC pauses), and do **not** add a functional-library dependency (e.g. Ramda) there.
- Achieve readability instead by **extracting named helper functions** the loop calls (the JIT inlines them); the machinery stays fast, the structure stays legible.

Rule of thumb: **declarative for small one-shot transforms; imperative-with-named-helpers for the per-frame numeric grid.**

## Consequences

- Slightly more functions and indirection, paid back in legibility and testability.
- Reviewers should treat "one big function doing several things with terse names" as a finding, and "functional patterns in the typed-array hot path" as a finding too.
