import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clickConfirm, CONFIRM_HOST } from './helpers/confirm.mjs';
import { argomentiScala } from './fixtures/electron.mjs';

// Feedback #392: nella Cronologia AI il pulsante "Cancella tutto" svuotava la
// lista ma NON aggiornava il menu "filtra per tipo", che continuava a elencare i
// tipi delle voci ormai cancellate — una cronologia vuota offriva filtri per dati
// inesistenti. La rimozione della singola voce invece riallineava il menu: i due
// cammini che portano allo stesso stato (cronologia vuota) divergevano.
//
// ASSERISCE il successo del fix: dopo lo svuotamento il menu filtro torna alla
// sola opzione "Tutte". Pre-fix il ramo del clear non chiamava buildFilterOptions:
// il #filter manteneva 4 opzioni (Tutte + 3) → rosso.

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

test('Cronologia AI: dopo "Cancella tutto" il menu filtro torna alla sola "Tutte"', async () => {
  const now = Date.now();
  // Tre tipi d'azione diversi, tutti con etichetta leggibile reale.
  const aiHistory = [
    { id: 'h-1', timestamp: new Date(now).toISOString(), action: 'translate_selection',
      provider: 'openrouter', model: 'gemini-2.0-flash', input: { selection: 'hello world' },
      output: 'ciao mondo', origin: 'https://example.com', costEur: 0.0001 },
    { id: 'h-2', timestamp: new Date(now - 1000).toISOString(), action: 'explain',
      provider: 'openrouter', model: 'gemini-2.0-flash', input: { selection: 'entropia' },
      output: 'spiegazione', origin: 'https://example.com', costEur: 0.0001 },
    { id: 'h-3', timestamp: new Date(now - 2000).toISOString(), action: 'edit_text',
      provider: 'openrouter', model: 'gemini-2.0-flash', input: { selection: 'testo da rivedere' },
      output: 'testo rivisto', origin: 'https://example.com', costEur: 0.0001 },
  ];

  const userData = mkdtempSync(join(tmpdir(), 'filo-hist-clear-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ aiHistory }), 'utf8');

  const app = await electron.launch({
    args: [...argomentiScala, '.'],
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

    // Stato iniziale: 3 voci e il menu filtro elenca i tre tipi + "Tutte".
    await expect(page.locator('.sn-history-item')).toHaveCount(3);
    await expect(page.locator('#filter option')).toHaveCount(4);

    // Svuota tutto e conferma dal popup stilizzato.
    await page.locator('#clear').click();
    await clickConfirm(page, 'ok', { timeout: 5_000 });

    // La lista si svuota e compare il messaggio di vuoto assoluto.
    await expect(page.locator('.sn-history-item')).toHaveCount(0);
    await expect(page.locator('#empty')).toBeVisible();

    // Il cuore del fix: il menu filtro torna alla SOLA opzione "Tutte", non
    // elenca più i tipi cancellati.
    await expect(page.locator('#filter option')).toHaveCount(1);
    expect(await page.locator('#filter option').first().evaluate((el) => el.value)).toBe('');
  } finally {
    try { await app.close(); } catch (_) {}
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
