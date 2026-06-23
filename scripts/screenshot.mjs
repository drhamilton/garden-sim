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
// Sun sky-dome day-arc (#27): the sun's daily path is drawn as a faint arc
// across the sky, and the marker rides it at the scrubbed time. We capture the
// open garden on the summer solstice at three times — low morning sun, high
// noon sun, low evening sun — so the arc reads as a fixed path while the marker
// moves along it, and a dawn/dusk sun reads as low *in the sky* (early/late on
// the arc) rather than sitting on the ground beside the model. `drive` selects
// the obstacle-free scene so nothing competes with the arc; each shot sets the
// date and time-of-day and captures the rendered frame.

/** Selects the open-garden scene; the scrub view stays in instantaneous mode. */
async function drive(page) {
  await clickButton(page, 'Open garden');
  await page.waitForTimeout(200);
}

const SHOTS = [
  { date: '2025-06-21', hour: 6, name: 'morning-low-sun' },
  { date: '2025-06-21', hour: 12, name: 'noon-high-sun' },
  { date: '2025-06-21', hour: 18, name: 'evening-low-sun' },
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

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.waitForSelector('canvas');
      await drive(page);

      for (const shot of SHOTS) {
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
