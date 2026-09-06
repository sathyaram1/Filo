import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from './fixtures/electron.mjs';

// Feedback: alla riapertura di Filo devono essere riaperte tutte le tab
// presenti al momento della chiusura.
//
// Test: due avvii reali dell'app che condividono lo stesso userData. Nel primo
// avvio apriamo un tab verso una pagina di test e chiudiamo; nel secondo avvio
// quel tab deve riaprirsi da solo.

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function waitForTabWindow(app, hostname, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const w = app.windows().find((p) => {
      try { return new URL(p.url()).hostname === hostname; } catch (_) { return false; }
    });
    if (w) return w;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

// Usa testServer del fixture (resta su per tutta la durata del test) ma gestiamo
// noi due launch con userData condiviso.
test('reopens previous session tabs after restart', async ({ testServer }) => {
  const url = testServer.html('<title>RestoreTarget</title><body><h1>restore me</h1></body>');
  const host = new URL(url).hostname;
  const userData = mkdtempSync(join(tmpdir(), 'filo-session-'));
  const launch = () => electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });

  let app;
  try {
    // ── Avvio 1: apri un tab verso la pagina di test, poi chiudi ──
    app = await launch();
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    const opened = await waitForTabWindow(app, host);
    expect(opened, 'il tab di test deve aprirsi nel primo avvio').toBeTruthy();
    // lascia scattare il salvataggio sessione (debounce 400ms + flush 100ms)
    await shell.waitForTimeout(1300);
    await app.close();
    app = null;

    // ── Avvio 2: stesso userData → il tab deve riaprirsi da solo ──
    app = await launch();
    const restored = await waitForTabWindow(app, host, 20000);
    expect(restored, 'il tab della sessione precedente deve riaprirsi').toBeTruthy();
  } finally {
    if (app) { try { await app.close(); } catch (_) {} }
    rmSync(userData, { recursive: true, force: true });
  }
});
