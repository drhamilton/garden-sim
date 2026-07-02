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
// Heatmap extremes (#37): after a sun-hours aggregation the sunniest tiles get
// a white ring and the shadiest a cyan ring. `drive` picks the SW corner block
// scene (a strong sun/shade gradient, so the extremes are unambiguous). Shot 1
// runs a single-day heatmap and captures the rings; shot 2 switches back to
// scrub mode to show the rings belong to the heatmap only.

/** Selects a scene with a hard shade gradient so the extremes read clearly. */
async function drive(page) {
  await clickButton(page, 'SW corner block');
  await page.waitForTimeout(200);
}

const SHOTS = [
  { date: '2025-06-21', mode: 'heatmap', name: 'heatmap-extreme-rings' },
  {
    date: '2025-06-21',
    hour: 10,
    before: (page) => clickButton(page, 'Scrub the day'),
    name: 'scrub-mode-no-rings',
  },
];
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

      // Keep the WebGL drawing buffer around after compositing so frames that
      // land asynchronously (e.g. a heatmap arriving from the worker) can be
      // read with toDataURL outside the task that rendered them.
      await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, attrs) {
          if (type === 'webgl' || type === 'webgl2')
            attrs = { ...attrs, preserveDrawingBuffer: true };
          return original.call(this, type, attrs);
        };
      });

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.waitForSelector('canvas');
      await drive(page);

      for (const shot of SHOTS) {
        if (shot.before) await shot.before(page);
        const path = `${outDir}/${shot.name}.png`;
        if (shot.mode === 'heatmap') {
          await captureHeatmapFrame(page, shot.date, path);
        } else {
          await captureScrubFrame(page, shot.date, shot.hour, path);
        }
        console.log(`captured ${name}/${shot.name}.png @ ${shot.date}`);
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

/**
 * Sets the date, runs a single-day sun-hours heatmap, and writes the rendered
 * frame to `path` once the aggregation lands (the readout switches from the
 * progress counter to the "Avg sun-hours…" summary). Relies on the
 * preserveDrawingBuffer init script above, since the heatmap frame is drawn in
 * a worker-completion task we can't join.
 */
async function captureHeatmapFrame(page, date, path) {
  await page.evaluate((d) => {
    const picker = document.querySelector('#garden-date');
    picker.value = d;
    picker.dispatchEvent(new Event('change', { bubbles: true }));
  }, date);
  await clickButton(page, 'Show sun-hours heatmap');
  await page.waitForFunction(
    () => document.body.textContent.includes('Avg sun-hours/day'),
    undefined,
    { timeout: 30_000 },
  );
  const dataUrl = await page.evaluate(() =>
    document.querySelector('canvas').toDataURL('image/png'),
  );
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
