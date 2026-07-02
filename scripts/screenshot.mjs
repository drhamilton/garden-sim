// App screenshot harness for PRs.
//
// Boots the real Vite app, drives it in headless Chromium, and writes PNGs of
// the isometric view to docs/screenshots/<name>/. The PR body then embeds those
// committed PNGs by raw URL — see the "Screenshots in PRs" section of
// CLAUDE.md.
//
// Usage:  npm run screenshot -- <name>     (default name: "app")
// One-time setup on a fresh checkout:  npx playwright install chromium
//
// Why capture the canvas via toDataURL rather than page.screenshot(): the
// renderer's WebGL context has no preserveDrawingBuffer, so by the time the
// page compositor runs the drawing buffer is already cleared and a normal
// screenshot comes back blank. The app renders synchronously inside the time
// slider's "input" handler, so dispatching that event and reading
// canvas.toDataURL() in the SAME task captures the frame before it's cleared.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5179; // fixed + strict so the driver knows where to connect
const BASE_URL = `http://localhost:${PORT}/`;

const name = process.argv[2] ?? 'app';
const outDir = resolve(repoRoot, 'docs/screenshots', name);

// --- The capture plan ------------------------------------------------------
// Rotation without rebuild (#33): north rotation now bypasses the renderer's
// rebuild path entirely, so these shots prove the behaviour that path change
// could have broken — the garden still rotates about its centre while the
// fixed true-north marker and the sun arc stay put. `drive` picks the
// building+tree scene so the rotation is unmistakable; the two shots differ
// only in the north slider's angle.

/** Selects a scene with obstacles so the rotation reads clearly. */
async function drive(page) {
  await clickButton(page, 'Building + tree');
  await page.waitForTimeout(200);
}

const SHOTS = [
  { date: '2025-06-21', hour: 10, northDeg: 0, name: 'north-0' },
  { date: '2025-06-21', hour: 10, northDeg: 45, name: 'north-45' },
];

/** Sets the north-rotation slider (degrees) and renders synchronously. */
async function setNorthRotation(page, deg) {
  await page.evaluate((d) => {
    const label = [...document.querySelectorAll('label')].find((l) =>
      l.textContent.startsWith('North'),
    );
    const input = label.querySelector('input[type=range]');
    input.value = String(d);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, deg);
}
// ---------------------------------------------------------------------------

async function main() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const server = startDevServer();
  try {
    await waitForServer(BASE_URL);
    // Software GL (swiftshader): the heatmap scene's per-tile meshes lose a
    // hardware WebGL context in headless Chromium; software rendering is stable
    // and deterministic for captures.
    const browser = await chromium.launch({
      args: [
        '--no-sandbox',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
      ],
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 1100, height: 900 },
      });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.waitForSelector('canvas');
      await drive(page);

      for (const shot of SHOTS) {
        if (shot.northDeg != null) await setNorthRotation(page, shot.northDeg);
        await captureScrubFrame(
          page,
          shot.date,
          shot.hour,
          `${outDir}/${shot.name}.png`,
        );
        console.log(
          `captured ${name}/${shot.name}.png @ ${shot.date} ${shot.hour}:00`,
        );
      }

      if (errors.length) {
        console.error('Page errors during capture:', errors);
        process.exitCode = 1;
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.kill();
  }
}

/**
 * Sets the date, then the time-of-day slider, and writes the rendered scrub
 * frame to `path`. The slider's "input" handler renders synchronously, so we
 * read `toDataURL` in that same task to beat the WebGL buffer clear.
 */
async function captureScrubFrame(page, date, hour, path) {
  await page.evaluate((d) => {
    const picker = document.querySelector('#garden-date');
    picker.value = d;
    picker.dispatchEvent(new Event('change', { bubbles: true }));
  }, date);
  const dataUrl = await page.evaluate((h) => {
    const slider = document.querySelector('input[aria-label="Time of day"]');
    slider.value = String(h);
    slider.dispatchEvent(new Event('input', { bubbles: true })); // sync render
    return document.querySelector('canvas').toDataURL('image/png');
  }, hour);
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  writeFileSync(path, Buffer.from(base64, 'base64'));
}

/** Clicks the first button whose visible text equals `text`. */
async function clickButton(page, text) {
  await page.evaluate((label) => {
    const button = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === label,
    );
    if (!button) throw new Error(`No button labelled "${label}"`);
    button.click();
  }, text);
}

function startDevServer() {
  return spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
}

/** Polls the dev server until it serves, or throws after ~30s. */
async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline)
      throw new Error(`Dev server never came up at ${url}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

await main();
