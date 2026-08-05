// Spike: cattura visiva composita (shell + WebContentsView) su Linux/xvfb.
//
// Verifica che captureComposite() di tests/agent/driver.mjs produca un PNG non
// vuoto quando Filo gira dentro xvfb (ambiente cloud). Questo spec vale da
// "criterion of done" del feedback #237: se passa, le routine cloud possono
// catturare screenshot fedeli dell'interfaccia (composito shell + tab).
//
// Il criterio di "non vuoto" è basato sulla dimensione del file PNG: un'immagine
// nera/blank comprime a pochi kB, mentre la UI reale di Filo ha elementi grafici
// variegati che portano il file ad almeno qualche decina di kB.

import { _electron as electron, test, expect } from '@playwright/test';
import { mkdtempSync, rmSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Importa captureComposite dal driver degli agent-test.
import {
  launchFilo, closeFilo, captureComposite, navigate, sleep, compositeCaptureTool,
} from './agent/driver.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Soglia minima in byte per considerare uno screenshot "non vuoto".
// Un PNG 1280x1024 tutto nero comprime a ~3-5 kB; la UI Filo supera i 50 kB.
const MIN_PNG_BYTES = 30_000;

// Directory di output (gitignorata — vedi .gitignore: tests/.shots/).
const OUT_DIR = join(__dirname, '.shots');

test.describe('captureComposite — cattura composita su Linux/xvfb', () => {
  let app = null;
  let shell = null;
  let outDir = null;

  test.beforeAll(async () => {
    mkdirSync(OUT_DIR, { recursive: true });
    outDir = OUT_DIR;
    ({ app, shell } = await launchFilo());
    // Attendi che la tab di default (newtab) sia completamente dipinta.
    await sleep(1500);
  });

  test.afterAll(async () => {
    if (app) await closeFilo(app);
  });

  test('screenshot newtab: file esiste e non è vuoto', async () => {
    const outPath = join(outDir, 'spike-newtab.png');
    await captureComposite(app, outPath);

    // 1. Il file deve esistere.
    expect(existsSync(outPath), 'PNG non creato da captureComposite').toBe(true);

    // 2. Il file deve avere dimensione superiore alla soglia "non vuoto".
    const { size } = statSync(outPath);
    console.log(`[capture-composite] spike-newtab.png: ${size} bytes`);
    expect(
      size,
      `PNG troppo piccolo (${size} B < ${MIN_PNG_BYTES} B) — probabile schermata nera o vuota`
    ).toBeGreaterThan(MIN_PNG_BYTES);
  });

  test('screenshot dashboard (filo://dashboard): file esiste e non è vuoto', async () => {
    const outPath = join(outDir, 'spike-dashboard.png');
    await navigate(app, shell, 'filo://dashboard/dashboard.html');
    await sleep(1200); // attendi paint della dashboard
    await captureComposite(app, outPath);

    expect(existsSync(outPath), 'PNG non creato per dashboard').toBe(true);
    const { size } = statSync(outPath);
    console.log(`[capture-composite] spike-dashboard.png: ${size} bytes`);
    expect(
      size,
      `PNG dashboard troppo piccolo (${size} B) — probabile schermata nera o vuota`
    ).toBeGreaterThan(MIN_PNG_BYTES);
  });
});
