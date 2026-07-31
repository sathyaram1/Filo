import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// PROBER: nella pagina Cronologia AI il menu "filtra per tipo" si popola con i
// tipi di azione realmente presenti. Rimuovere una singola voce riallinea il
// menu (buildFilterOptions). Ma "Svuota cronologia" azzera la lista SENZA
// riallineare il menu: dopo lo svuotamento il filtro elenca ancora tipi che
// non esistono più. Asimmetria fra due cammini equivalenti.

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

test('svuotare la cronologia deve azzerare anche il menu filtro per tipo', async () => {
  const now = Date.now();
  const aiHistory = ['translate', 'explain', 'edit_text'].map((action, i) => ({
    id: `h-${i}`,
    timestamp: new Date(now - i * 1000).toISOString(),
    action,
    provider: 'gemini',
    model: 'gemini-2.0-flash',
    input: { selection: `testo ${i}` },
    output: `out ${i}`,
    origin: 'https://example.com',
    costEur: 0.0001,
  }));

  const userData = mkdtempSync(join(tmpdir(), 'filo-histclear-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ aiHistory }), 'utf8');

  const app = await electron.launch({
    args: ['.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });

  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate(() => window.filoShell.tabs.open('filo://history/history.html'));
    const page = await findTabPage(app, 'history');
    expect(page, 'la pagina cronologia deve aprirsi').toBeTruthy();
    await page.waitForLoadState('domcontentloaded');

    // Pre-condizione: il filtro ha un'opzione per ogni tipo presente + "Tutte".
    await expect(page.locator('.sn-history-item')).toHaveCount(3);
    let optCount = await page.locator('#filter option').count();
    expect(optCount).toBe(4); // Tutte + 3 tipi

    // Svuota la cronologia (conferma nel modale, shadow closed → hook _test).
    await page.locator('#clear').click();
    await expect.poll(async () => page.evaluate(() => !!window.SN_CONFIRM_UI._test.state())).toBe(true);
    await page.evaluate(() => window.SN_CONFIRM_UI._test.click('ok'));

    // La lista è vuota.
    await expect(page.locator('.sn-history-item')).toHaveCount(0);
    await expect(page.locator('#empty')).toBeVisible();

    // ASSERT (fallisce PRIMA del fix): il menu filtro deve tornare alla sola
    // opzione "Tutte" — non deve più elencare tipi che non esistono più.
    optCount = await page.locator('#filter option').count();
    await page.screenshot({ path: 'tests/.shots/audit-history-clear-filter.png' });
    const optionTexts = await page.locator('#filter option').allInnerTexts();
    expect(
      optCount,
      `dopo lo svuotamento il filtro elenca ancora tipi inesistenti: ${optionTexts.join(', ')}`
    ).toBe(1);
  } finally {
    await app.close();
  }
});
