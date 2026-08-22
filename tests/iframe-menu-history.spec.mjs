// #445 — la cronologia degli appunti dentro un menu che sta disegnando un altro
// frame.
//
// È il punto del ponte dove un errore sarebbe silenzioso e dannoso: le voci
// tornano indietro per POSIZIONE, e se le due liste (quella del riquadro e
// quella della pagina) si sfasassero si incollerebbe l'appunto sbagliato — su
// una password copiata è il peggio possibile. Questi spec incollano davvero,
// dopo aver rimosso una voce, e guardano cosa finisce nel campo.

import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const INNER = `<!doctype html><html><body style="margin:0;padding:6px;font:14px sans-serif">
  <textarea id="campo" rows="2" cols="40"></textarea>
</body></html>`;

async function findTabPage(app, hostname, timeout = 10000) {
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

test('cronologia appunti dal menu disegnato dalla pagina: rimuovo una voce e incollo quella giusta', async ({ testServer }) => {
  const history = [
    { type: 'text', text: 'appunto-uno', ts: Date.now() - 3000 },
    { type: 'text', text: 'appunto-due', ts: Date.now() - 2000 },
    { type: 'text', text: 'appunto-tre', ts: Date.now() - 1000 },
  ];
  const userData = mkdtempSync(join(tmpdir(), 'filo-iframe-clip-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: history }), 'utf8');

  const innerUrl = testServer.html(INNER);
  const url = testServer.html(`<!doctype html><html><body style="margin:0;padding:24px">
    <iframe id="embed" src="${innerUrl}" width="480" height="110" style="border:1px solid #333"></iframe>
    <div style="height:400px"></div></body></html>`);
  const host = new URL(url).hostname;

  const app = await electron.launch({
    args: ['.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });

  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    const page = await findTabPage(app, host);
    expect(page, 'la pagina di test deve aprirsi').toBeTruthy();
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

    const frame = page.frameLocator('#embed');
    await frame.locator('#campo').click();
    await frame.locator('#campo').click({ button: 'right' });

    // Il menu è nella pagina: il riquadro è troppo basso per contenerlo.
    const menu = page.locator('.sn-menu');
    await expect(menu).toBeVisible({ timeout: 8000 });
    await page.locator('.sn-menu-paste-arrow').click();
    const sub = page.locator('.sn-menu-history-sub');
    await expect(sub).toBeVisible();
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(3);

    // Tolgo la prima voce: da qui in poi le posizioni sono cambiate.
    await sub.locator('.sn-menu-history-item', { hasText: 'appunto-tre' })
      .locator('.sn-menu-history-remove').click();
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(2);

    // E incollo quella che ora è la prima: deve arrivare nel campo del riquadro
    // esattamente la voce che ho cliccato.
    await sub.locator('.sn-menu-history-item', { hasText: 'appunto-due' })
      .locator('.sn-menu-history-paste').click();

    await expect.poll(async () => frame.locator('#campo').inputValue(), { timeout: 6000 })
      .toBe('appunto-due');
  } finally {
    try { await app.close(); } catch (_) {}
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
