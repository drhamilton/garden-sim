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
4. Reference them from the PR body. **This repo is private**, so GitHub's image
   proxy can't fetch raw URLs — inline `![](…)` embeds won't render. Instead
   _link_ to the committed file's blob view, which works for authenticated
   reviewers:
   `https://github.com/drhamilton/garden-sim/blob/<branch>/docs/screenshots/<name>/<shot>.png`
   (If the repo is ever made public, inline raw-URL embeds will start working:
   `https://raw.githubusercontent.com/drhamilton/garden-sim/<branch>/docs/screenshots/<name>/<shot>.png`.)

Editing the PR body with `gh pr edit` currently fails on this repo (a Projects
classic deprecation warning aborts it); use `gh api -X PATCH
repos/drhamilton/garden-sim/pulls/<n> -F body=@<file>` instead.
