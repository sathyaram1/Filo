import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from './fixtures/electron.mjs';

// Feedback #321: nella Cronologia AI la casella "Cerca" restituiva risultati
// anche per parole che non compaiono da nessuna parte nelle voci mostrate.
// Causa: l'ago della ricerca era costruito con JSON.stringify(it.input), così
// finivano nel testo cercabile i NOMI dei campi interni del payload
// (selection, userMessage, title, url…) e la punteggiatura JSON, non solo i
// valori visibili all'utente. Cercare "selection"/"title"/"url" faceva
// comparire quasi tutto.
//
// Questo spec ASSERISCE IL SUCCESSO del fix:
//  - cercare una CHIAVE interna del payload ("selection", "userMessage",
//    "title") NON deve restituire nulla, perché quelle parole non compaiono
//    nei testi mostrati;
//  - cercare una parola che invece È visibile in una voce restituisce SOLO
//    quella voce.
// Pre-fix: "selection" matchava 3/3 voci → rosso al primo assert.

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

test('history search: ignora le chiavi interne del payload, cerca solo i testi visibili', async () => {
  const now = Date.now();
  // Nessuno dei testi VISIBILI contiene "selection", "userMessage" o "title":
  // quelle sono solo chiavi del payload interno. I valori visibili sono parole
  // neutre e distinte fra loro.
  const aiHistory = [
    { id: 'h-1', timestamp: new Date(now).toISOString(), action: 'explain',
      provider: 'openrouter', model: 'gemini-2.0-flash', input: { selection: 'melanzana viola' },
      output: 'ortaggio estivo', origin: 'https://example.com', costEur: 0.0001 },
    { id: 'h-2', timestamp: new Date(now - 1000).toISOString(), action: 'translate_selection',
      provider: 'openrouter', model: 'gemini-2.0-flash', input: { selection: 'cammello curioso' },
      output: 'animale del deserto', origin: 'https://example.com', costEur: 0.0001 },
    { id: 'h-3', timestamp: new Date(now - 2000).toISOString(), action: 'filo_chat',
      provider: 'openrouter', model: 'gemini-2.0-flash', input: { userMessage: 'trombone lucido' },
      output: 'strumento a fiato', origin: 'https://example.com', costEur: 0.0001 },
  ];

  const userData = mkdtempSync(join(tmpdir(), 'filo-hist-search-'));
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

    // Sanity: tutte e tre le voci sono in lista.
    await expect(page.locator('.sn-history-item')).toHaveCount(3);

    const search = page.locator('#search');

    // Chiavi interne del payload → NESSUN risultato (prima del fix erano 3/3).
    for (const ghost of ['selection', 'userMessage', 'title', 'url']) {
      await search.fill(ghost);
      await expect(
        page.locator('.sn-history-item'),
        `cercare la chiave interna "${ghost}" non deve trovare voci`,
      ).toHaveCount(0);
      await expect(page.locator('#empty')).toBeVisible();
    }

    // Parola visibile solo nella voce 1 → esattamente quella voce.
    await search.fill('melanzana');
    await expect(page.locator('.sn-history-item')).toHaveCount(1);
    await expect(page.locator('#list')).toContainText('melanzana viola');

    // Parola presente nell'OUTPUT visibile della voce 2 → quella voce.
    await search.fill('deserto');
    await expect(page.locator('.sn-history-item')).toHaveCount(1);
    await expect(page.locator('#list')).toContainText('cammello curioso');

    // Il modello è mostrato in lista → deve restare cercabile.
    await search.fill('gemini-2.0-flash');
    await expect(page.locator('.sn-history-item')).toHaveCount(3);

    // Svuotando la ricerca tornano tutte.
    await search.fill('');
    await expect(page.locator('.sn-history-item')).toHaveCount(3);

    const shotsDir = join(APP_ROOT, 'tests', '.shots');
    try { mkdirSync(shotsDir, { recursive: true }); } catch (_) {}
    await search.fill('selection');
    await page.screenshot({ path: join(shotsDir, 'history-search-internal-keys.png') });
  } finally {
    try { await app.close(); } catch (_) {}
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
