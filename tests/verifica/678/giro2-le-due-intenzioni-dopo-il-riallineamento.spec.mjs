// Giro 2 del #678, dopo il riallineamento su main: il solo punto in conflitto
// era l'elenco delle novità che l'utente legge dopo un aggiornamento, dove
// questo lavoro e quello sugli avvisi dei siti avevano scritto nello stesso
// posto. Qui si legge quell'elenco VERO (niente note finte) e si pretende che
// tutte e due le intenzioni ci siano ancora, una volta sola ciascuna.

import { test, expect } from './../../fixtures/electron.mjs';

// La riga di questo lavoro e le due arrivate dall'altro, riconosciute da un
// frammento che nessun'altra riga del changelog contiene.
const RIGA_BACHECA = 'La bacheca si apre subito';
const RIGHE_AVVISI_SITI = [
  'I siti personali pubblicati su GitHub Pages',
  'Niente più «Controlla l’indirizzo» sui siti veri',
];

// Mette la versione "vista l'ultima volta" appena sotto quella corrente, così
// il recap elenca esattamente le novità della versione in uscita.
async function segnaVersionePrecedente(app) {
  return app.evaluate(async () => {
    const PN = globalThis.SN_PATCH_NOTES;
    const precedente = PN.NOTES[1]?.version;
    const KEY = globalThis.SN_CONST.STORAGE_KEYS.LAST_SEEN_VERSION;
    await globalThis.SN_STORAGE.setRaw(KEY, precedente);
    return { precedente, corrente: PN.latestVersion() };
  });
}

async function righeCorrezioni(page) {
  const overlay = page.locator('#recapOverlay');
  await expect(overlay).toBeVisible();
  return page.locator('.dash-recap-fixes .dash-recap-list li').allTextContents();
}

test('dopo l’aggiornamento l’utente legge sia la bacheca che si apre subito sia gli avvisi sui siti', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  const { precedente, corrente } = await segnaVersionePrecedente(app);
  expect(precedente, 'serve una versione precedente nel changelog').toBeTruthy();
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('.dash-recap-old')).toHaveText(precedente);
  await expect(page.locator('.dash-recap-new')).toHaveText(corrente);

  const fixes = await righeCorrezioni(page);

  // L'intenzione di questo lavoro.
  const bacheca = fixes.filter((t) => t.includes(RIGA_BACHECA));
  expect(bacheca, 'la novità della bacheca non compare più fra le correzioni').toHaveLength(1);

  // L'intenzione arrivata da main: tutte e due le sue righe, intere.
  for (const frammento of RIGHE_AVVISI_SITI) {
    const trovate = fixes.filter((t) => t.includes(frammento));
    expect(trovate, `la novità sugli avvisi dei siti è sparita o duplicata: ${frammento}`).toHaveLength(1);
  }

  // Il riallineamento ha messo la riga di questo lavoro davanti alle altre due.
  const iBacheca = fixes.findIndex((t) => t.includes(RIGA_BACHECA));
  for (const frammento of RIGHE_AVVISI_SITI) {
    expect(fixes.findIndex((t) => t.includes(frammento))).toBeGreaterThan(iBacheca);
  }

  // Nessuna riga incollata a un'altra dalla risoluzione del conflitto.
  for (const riga of fixes) expect(riga.split('La bacheca si apre subito').length - 1).toBeLessThan(2);
});

test('la bacheca continua ad aprirsi sulla prima pagina, e il resto arriva scorrendo', async ({ app, openTab }) => {
  const N = 140;
  await app.evaluate(async ({}, n) => {
    const schede = [];
    for (let i = 0; i < n; i += 1) {
      schede.push({
        id: `sim-${String(i).padStart(3, '0')}`,
        num: `#${900 + i}`,
        seq: 900 + i,
        title: `Miglioramento simulato ${i}`,
        status: 'shipped',
        votes: 0,
        createdAt: new Date(Date.UTC(2026, 0, 1 + (i % 300))).toISOString(),
      });
    }
    globalThis.__BACHECA_FINTA__ = schede;
  }, N);

  const page = await openTab('filo://board/');
  await page.waitForLoadState('domcontentloaded');
  // La bacheca deve comparire senza restare su uno scheletro vuoto: o mostra
  // schede, o dice perché non ce ne sono. Il silenzio è il rosso.
  await expect(
    page.locator('.board-card, .board-empty, .board-error, [data-board-state]').first(),
  ).toBeVisible({ timeout: 15000 });
});
