// Spec Playwright per la pagina di gestione (filo://manage/): quanti feedback
// ci sono in ogni scheda, scritto sulla scheda stessa.
//
// Feedback #495 ("puoi mostrare quanti feedback ci sono in ogni sezione?
// es: ricevuti (24) in coda (12)"). Assert di COMPORTAMENTO:
//   - ogni scheda-lista mostra "Etichetta (N)" col numero VERO dei suoi feedback;
//   - il numero è la lunghezza della lista che si apre cliccandola (invariante:
//     il badge non può dire una cosa e la lista un'altra);
//   - archiviare un feedback sposta il conteggio da una scheda all'altra subito,
//     senza ricaricare la pagina;
//   - i filtri della scheda Archiviati (⭐ / bloccati confermati) muovono anche
//     il conteggio.
//
// Senza il fix ogni assert sul testo "(N)" è rosso: le schede portano la sola
// etichetta.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

// 3 Ricevuti, 2 In coda, 1 Risolto (done spedito), 2 Archiviati (di cui uno
// bloccato confermato e uno ⭐). Numeri diversi fra loro: un contatore che
// sbaglia scheda non può passare per caso.
const FBS = [
  { _id: 'i1', seq: 1, subSeq: 0, status: 'unlabeled', name: 'Non filtrato', createdAt: '2026-06-01T10:00:00Z' },
  { _id: 'i2', seq: 2, subSeq: 0, status: 'attack',    name: 'Attacco',      createdAt: '2026-06-02T10:00:00Z' },
  { _id: 'i3', seq: 3, subSeq: 0, status: 'aligned',   name: 'Allineato',    createdAt: '2026-06-03T10:00:00Z' },
  { _id: 'q1', seq: 4, subSeq: 0, status: 'todo',      name: 'In coda 1',    createdAt: '2026-06-04T10:00:00Z' },
  { _id: 'q2', seq: 5, subSeq: 0, status: 'working',   name: 'In coda 2',    createdAt: '2026-06-05T10:00:00Z' },
  { _id: 'r1', seq: 6, subSeq: 0, status: 'done',      name: 'Risolto',      createdAt: '2026-06-06T10:00:00Z', resolvedInVersion: '1.0.0' },
  { _id: 'a1', seq: 7, subSeq: 0, status: 'archived',  name: 'Archiviato',   createdAt: '2026-06-07T10:00:00Z', starred: true },
  { _id: 'a2', seq: 8, subSeq: 0, status: 'attack_confirmed', name: 'Attacco confermato', createdAt: '2026-06-08T10:00:00Z' },
];

function tab(page, name) {
  return page.locator(`.mg-tab[data-tab="${name}"]`);
}

async function seed(page, fbs = FBS) {
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => window.__mgTest.whenReady && window.__mgTest.whenReady());
  await page.evaluate((list) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setReleasedVersion('1.0.0');
    window.__mgTest.setData(list);
    window.__mgTest.setTab('inbox');
  }, fbs);
}

test('ogni scheda-lista dice quanti feedback contiene', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await seed(page);

  await expect(tab(page, 'inbox')).toHaveText('Ricevuti (3)');
  await expect(tab(page, 'queue')).toHaveText('In coda (2)');
  await expect(tab(page, 'resolved')).toHaveText('Risolti (1)');
  await expect(tab(page, 'archived')).toHaveText('Archiviati (2)');

  // Le schede che non sono liste di feedback restano senza numero: non c'è
  // niente da contare.
  await expect(tab(page, 'stats')).toHaveText('Statistiche Red Team');
  await expect(tab(page, 'automation')).toHaveText('Automazioni');
});

test('il numero sulla scheda è esattamente quanti feedback ci trovi dentro', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await seed(page);

  for (const [name, expected] of [['inbox', 3], ['queue', 2], ['resolved', 1], ['archived', 2]]) {
    await tab(page, name).click();
    await expect(tab(page, name)).toHaveText(new RegExp(`\\(${expected}\\)$`));
    await expect(page.locator('.mg-item')).toHaveCount(expected);
  }
});

test('senza feedback le schede dicono (0), non restano mute', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await seed(page, []);

  await expect(tab(page, 'inbox')).toHaveText('Ricevuti (0)');
  await expect(tab(page, 'queue')).toHaveText('In coda (0)');
  await expect(tab(page, 'resolved')).toHaveText('Risolti (0)');
  await expect(tab(page, 'archived')).toHaveText('Archiviati (0)');
});

test('archiviare un feedback sposta subito il conteggio fra le schede', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  // Il pulsante Archivia parla col main: fingi un aggiornamento riuscito, così
  // lo spec resta deterministico e offline.
  await page.evaluate(() => {
    const orig = window.filo.sendMessage.bind(window.filo);
    window.filo.sendMessage = (msg) => (
      msg && msg.type === 'feedback_update' ? Promise.resolve({ ok: true }) : orig(msg)
    );
  });
  await seed(page);

  await tab(page, 'queue').click();
  await page.locator('.mg-item').first().click();
  await expect(page.locator('#mgArchiveBtn')).toBeVisible();
  await page.locator('#mgArchiveBtn').click();

  // Uno in meno in coda, uno in più fra gli archiviati — senza ricaricare.
  await expect(tab(page, 'queue')).toHaveText('In coda (1)');
  await expect(tab(page, 'archived')).toHaveText('Archiviati (3)');
});

test('i filtri della scheda Archiviati muovono anche il suo numero', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await seed(page);

  await tab(page, 'archived').click();
  await expect(tab(page, 'archived')).toHaveText('Archiviati (2)');

  // ⭐ "Solo preferiti": nel campione ce n'è uno solo (di qualunque stato).
  await page.locator('#mgStarFilter').check();
  await expect(tab(page, 'archived')).toHaveText('Archiviati (1)');
  await expect(page.locator('.mg-item')).toHaveCount(1);

  // "Bloccati confermati": l'unico attacco confermato del campione.
  await page.locator('#mgStarFilter').uncheck();
  await page.locator('#mgConfirmedFilter').check();
  await expect(tab(page, 'archived')).toHaveText('Archiviati (1)');
  await expect(page.locator('.mg-item')).toHaveCount(1);

  // Tolti i filtri si torna al totale.
  await page.locator('#mgConfirmedFilter').uncheck();
  await expect(tab(page, 'archived')).toHaveText('Archiviati (2)');
  await expect(page.locator('.mg-item')).toHaveCount(2);
});
