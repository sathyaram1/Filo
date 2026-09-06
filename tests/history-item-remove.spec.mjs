import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from './fixtures/electron.mjs';

// Feedback #320: nella Cronologia AI non c'era modo di eliminare UNA sola voce —
// l'unica opzione era "Cancella tutto". Se una voce conteneva qualcosa di privato
// (o un errore) eri costretto a buttare via tutto lo storico, mentre altre liste
// di Filo ("Aperti per dopo", cronologia appunti) hanno il tasto Rimuovi per
// elemento.
//
// Questo spec ASSERISCE IL SUCCESSO della feature:
//  - ogni voce ha un controllo "Rimuovi";
//  - cliccandolo su una voce, quella voce sparisce dalla lista e le altre restano;
//  - la rimozione È PERSISTENTE: ricaricando la pagina (che rilegge la cronologia
//    salvata) la voce rimossa non ricompare, le altre sì.
// Pre-fix la pagina non aveva alcun controllo di rimozione per-voce: rosso al
// primo assert (nessun .sn-history-remove).

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

test('history page: rimuovi una singola voce e la rimozione persiste', async () => {
  const now = Date.now();
  const PRIVATE = 'IBAN-privato-che-voglio-togliere-42';
  const aiHistory = [
    { id: 'h-private', timestamp: new Date(now).toISOString(), action: 'explain_selection',
      provider: 'openrouter', model: 'gemini-2.0-flash', input: { selection: PRIVATE },
      output: 'spiegazione riservata', origin: 'https://example.com', costEur: 0.0001 },
    { id: 'h-keep-1', timestamp: new Date(now - 1000).toISOString(), action: 'translate',
      provider: 'openrouter', model: 'gemini-2.0-flash', input: { selection: 'hello world' },
      output: 'ciao mondo', origin: 'https://example.com', costEur: 0.0001 },
    { id: 'h-keep-2', timestamp: new Date(now - 2000).toISOString(), action: 'translate',
      provider: 'openrouter', model: 'gemini-2.0-flash', input: { selection: 'good morning' },
      output: 'buongiorno', origin: 'https://example.com', costEur: 0.0001 },
  ];

  const userData = mkdtempSync(join(tmpdir(), 'filo-hist-rm-'));
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

    // Tutte e tre le voci ci sono, e OGNI voce ha il suo tasto Rimuovi.
    await expect(page.locator('.sn-history-item')).toHaveCount(3);
    await expect(page.locator('.sn-history-remove')).toHaveCount(3);
    await expect(page.locator('#list')).toContainText(PRIVATE);

    // Individua la voce che contiene il testo privato e clicca il suo Rimuovi.
    const privateItem = page.locator('.sn-history-item', { hasText: PRIVATE });
    await expect(privateItem).toHaveCount(1);
    await privateItem.locator('.sn-history-remove').click();

    // La voce privata sparisce, le altre due restano.
    await expect(page.locator('.sn-history-item')).toHaveCount(2);
    await expect(page.locator('#list')).not.toContainText(PRIVATE);
    await expect(page.locator('#list')).toContainText('ciao mondo');
    await expect(page.locator('#list')).toContainText('buongiorno');

    // Persistenza: ricaricando la pagina (rilegge la cronologia salvata) la voce
    // rimossa NON ricompare — non era solo nascosta dalla vista.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.sn-history-item')).toHaveCount(2);
    await expect(page.locator('#list')).not.toContainText(PRIVATE);
    await expect(page.locator('#list')).toContainText('ciao mondo');
  } finally {
    try { await app.close(); } catch (_) {}
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
