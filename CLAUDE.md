## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary — label strings equal the five canonical role names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Screenshots in PRs

For any change with a **visible** result in the isometric view, include
screenshots in the PR body. Skip this for pure-core/logic changes (nothing to
show).

1. Edit the capture plan at the top of `scripts/screenshot.mjs` for the change
   (which scene to show, which moments to capture).
2. Run `npm run screenshot -- <name>` (one-time per checkout: `npx playwright
install chromium`). PNGs land in `docs/screenshots/<name>/`.
3. Commit the PNGs on the PR branch.
4. Embed them in the PR body by raw URL — GitHub only renders images from a URL
   it can fetch, and the branch's raw URL resolves as soon as it's pushed:
   `https://raw.githubusercontent.com/drhamilton/garden-sim/<branch>/docs/screenshots/<name>/<shot>.png`
