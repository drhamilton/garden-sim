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
// Edit this for the change you're screenshotting: pick the scene to show and
// the moments worth capturing. `drive` runs once before the shots; each shot
// sets the time-of-day slider and saves the frame.

/** Selects a named scene from the top button row. */
async function drive(page) {
  await clickButton(page, 'Building + tree');
}

const SHOTS = [
  { hour: 6, name: 'morning' },
  { hour: 12, name: 'noon' },
  { hour: 18, name: 'evening' },
  { hour: 2, name: 'night' },
];
// ---------------------------------------------------------------------------

async function main() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const server = startDevServer();
  try {
    await waitForServer(BASE_URL);
    const browser = await chromium.launch({ args: ['--no-sandbox'] });
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
        await captureCanvasAtHour(
          page,
          shot.hour,
          `${outDir}/${shot.name}.png`,
        );
        console.log(`captured ${name}/${shot.name}.png @ hour ${shot.hour}`);
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

/** Sets the time-of-day slider and writes the rendered canvas to `path`. */
async function captureCanvasAtHour(page, hour, path) {
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
