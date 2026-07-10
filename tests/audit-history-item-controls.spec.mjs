// Audit prober: cronologia AI (filo://history/history.html) — controlli per voce.
//
// Sonda due cose, da utente:
//   1. Esiste un modo per eliminare UNA singola voce della cronologia?
//      (invariante UX: se l'app salva N cose, l'utente deve poterle gestire
//      una a una — per gli appunti/clipboard esiste già un feedback analogo).
//   2. La ricerca trova solo ciò che l'utente vede? Cercando una parola-chiave
//      tecnica interna ("selection", che è il nome di un campo del payload,
//      non un testo visibile) NON dovrebbero comparire risultati.
//
// Le voci vengono seminate via MSG.APPEND_HISTORY (lo stesso canale usato dal
// main quando registra una richiesta AI reale), così la pagina mostra dati veri.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = resolve(__dirname, '.shots');

test.beforeAll(() => {
  try { mkdirSync(SHOTS_DIR, { recursive: true }); } catch (_) {}
});

// Semina 3 voci di cronologia realistiche (spiega / traduci / modifica testo).
async function seed(page) {
  await page.waitForFunction(() => window.SN_MSG && window.chrome?.runtime?.sendMessage, null, { timeout: 10_000 });
  await page.evaluate(async () => {
    const { MSG } = window.SN_MSG;
    const entries = [
      {
        action: 'explain', provider: 'openrouter', model: 'test-model',
        input: { selection: 'la fotosintesi clorofilliana' },
        output: 'La fotosintesi è il processo con cui le piante producono energia.',
        origin: 'https://it.wikipedia.org/wiki/Fotosintesi', costEur: 0.0012,
      },
      {
        action: 'translate_selection', provider: 'openrouter', model: 'test-model',
        input: { selection: 'good morning' },
        output: 'buongiorno',
        origin: 'https://example.com/articolo', costEur: 0.0003,
      },
      {
        action: 'edit_selection', provider: 'gemini', model: 'test-model',
        input: { selection: 'testo da riscrivere', userMessage: 'rendi formale' },
        output: 'Testo riscritto in tono formale.',
        origin: 'https://example.com/bozza', costEur: 0.0007,
      },
    ];
    for (const entry of entries) {
      await window.chrome.runtime.sendMessage({ type: MSG.APPEND_HISTORY, entry });
    }
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => document.querySelectorAll('.sn-history-item').length >= 3, null, { timeout: 10_000 });
}

test('cronologia AI: ogni voce ha un controllo per eliminarla singolarmente', async ({ openTab }) => {
  const page = await openTab('filo://history/history.html');
  await seed(page);

  const items = page.locator('.sn-history-item');
  await expect(items).toHaveCount(3);

  await page.screenshot({ path: resolve(SHOTS_DIR, 'audit-history-no-item-delete.png') });

  // Invariante: una voce della cronologia deve essere eliminabile da sola.
  // Cerchiamo QUALSIASI controllo interattivo dentro la voce (bottone, icona
  // cliccabile, link) che permetta di rimuoverla.
  const controls = await items.first().locator('button, [role="button"], a, .sn-card-action').count();
  expect(controls, 'nessun controllo per eliminare la singola voce: esiste solo "Svuota" che cancella TUTTO').toBeGreaterThan(0);
});

test('cronologia AI: la ricerca non deve matchare i nomi interni dei campi', async ({ openTab }) => {
  const page = await openTab('filo://history/history.html');
  await seed(page);

  // "selection" non compare in NESSUN testo visibile delle 3 voci (è il nome
  // del campo tecnico del payload). Un utente che cerca "selection" deve
  // vedere 0 risultati.
  await page.fill('#search', 'selection');
  await page.waitForTimeout(200);
  const visible = await page.locator('.sn-history-item').count();
  await page.screenshot({ path: resolve(SHOTS_DIR, 'audit-history-search-internal-keys.png') });
  expect(visible, 'la ricerca matcha il JSON interno (nomi dei campi), non il testo visibile').toBe(0);
});
