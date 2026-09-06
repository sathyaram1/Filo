// Sonda temporanea #256 — tema scuro, miniature, lista piena.
import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEC_URL = 'filo://security/security.html';
try { mkdirSync(join(APP_ROOT, 'tests', '.shots'), { recursive: true }); } catch (_) {}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKklEQVR42mP8z8BQz0AEYBxVSF+FjP9hgFEZUJgYhcQoJKgIrxWjCulrBQCB0Qv3n1p1DwAAAABJRU5ErkJggg==';

async function findTabPage(app, hostname, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const w = app.windows().find((p) => {
      try { return new URL(p.url()).hostname === hostname; } catch (_) { return false; }
    });
    if (w) return w;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

for (const tema of ['light', 'dark']) {
  test(`probe: cronologia appunti, tema ${tema}`, async () => {
    const items = [
      { type: 'image', dataUrl: PNG, description: 'schermata del terminale', ts: 9 },
      { type: 'image', dataUrl: PNG.replace('iVBOR', 'iVBQR'), ts: 8 },
      { type: 'text', text: 'password-Hunter2', ts: 7 },
      { type: 'text', text: '   \n\t  ', ts: 6 },
      { type: 'text', text: '', ts: 5 },
      ...Array.from({ length: 20 }, (_, i) => ({ type: 'text', text: `voce lunga numero ${i} con del testo`, ts: 4 - i })),
    ];
    const userData = mkdtempSync(join(tmpdir(), `v256-t-${tema}-`));
    writeFileSync(join(userData, 'storage.json'), JSON.stringify({
      clipboardHistory: items, settings: { theme: tema },
    }), 'utf8');
    const app = await electron.launch({
      args: ['.'], cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
    });
    try {
      const shell = await app.firstWindow();
      await shell.waitForLoadState('domcontentloaded');
      await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
      const page = await findTabPage(app, 'security');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(25);
      await page.waitForTimeout(400);

      const info = await page.evaluate(() => {
        const g = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const c = getComputedStyle(el);
          return { bg: c.backgroundColor, fg: c.color, border: c.borderColor };
        };
        const lista = document.getElementById('sec-clip-list');
        return {
          tema: document.documentElement.getAttribute('data-sn-theme') || document.documentElement.dataset.snTheme,
          body: getComputedStyle(document.body).backgroundColor,
          rimuovi: g('.sn-clip-remove'),
          svuota: g('#sec-clip-clear'),
          esporta: g('#sec-export-btn'),
          importa: g('#sec-import-btn'),
          ricerca: g('#sec-clip-search'),
          listaScroll: { h: lista.clientHeight, s: lista.scrollHeight },
          miniature: document.querySelectorAll('.sn-clip-thumb').length,
          etichette: [...document.querySelectorAll('.sn-clip-text')].slice(0, 5).map((n) => n.textContent),
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      console.log(`TEMA-${tema}`, JSON.stringify(info, null, 1));
      await page.locator('#sec-clipboard').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `tests/.shots/v256-g4-${tema}.png` });
    } finally {
      try { await app.close(); } catch (_) {}
      rmSync(userData, { recursive: true, force: true });
    }
  });
}
