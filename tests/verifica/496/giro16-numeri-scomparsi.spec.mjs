// VERIFICA #496 — giro 16. Quello che i numeri lasciano fuori senza dirlo.
//
// Due prove:
//   · «Tutto» deve voler dire tutto: una segnalazione con la data d'arrivo
//     mancante, illeggibile o spostata in avanti (l'orologio storto di chi ha
//     scritto) esce da ogni finestra, e la scheda non dice quante ne ha
//     lasciate fuori (CLAUDE.md § Limiti: mai un taglio silenzioso);
//   · i numerini delle pasticche del filtro per creatore devono dire quanto
//     contiene ogni mittente, anche quando un filtro è già acceso: servono
//     proprio a scegliere il prossimo da aggiungere.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const GIORNO = 24 * 60 * 60 * 1000;
const g = (n) => new Date(Date.now() - n * GIORNO).toISOString();
const fraGiorni = (n) => new Date(Date.now() + n * GIORNO).toISOString();

function fb(over = {}) {
  return Object.assign({
    _id: 'v496-' + Math.random().toString(36).slice(2),
    seq: 1, subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: g(1),
    status: 'todo',
    text: 'testo', name: 'titolo', images: [],
  }, over);
}

async function apri(page, dati) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate((d) => window.__mgTest.setFsData(d), dati);
  await expect(page.locator('#mgFsBody')).toBeVisible();
}

test('#496 giro16 — «Tutto» non lascia fuori segnalazioni in silenzio', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [
      fb({ seq: 1, createdAt: g(2) }),
      fb({ seq: 2, createdAt: null }),               // data mancante
      fb({ seq: 3, createdAt: 'non una data' }),     // data illeggibile
      fb({ seq: 4, createdAt: fraGiorni(3) }),       // orologio avanti di tre giorni
    ],
    workerLog: [],
  });
  await page.locator('[data-fs-range="tutto"]').click();

  const n = (await page.locator('[data-fs-id="ricevuti"] .mg-tile-n').innerText()).trim();
  const nota = page.locator('#mgFsNota');
  const notaTxt = (await nota.isVisible()) ? (await nota.innerText()) : '';
  // O le conta tutte e quattro, o dice quante ne ha lasciate fuori.
  const dichiara = /fuori|senza data|scartat|non conta|esclus/i.test(notaTxt);
  expect(n === '4' || dichiara,
    `«Tutto» conta ${n} segnalazioni su 4 e non dice niente delle altre (nota: ${JSON.stringify(notaTxt)})`)
    .toBe(true);
});

test('#496 giro16 — con un filtro acceso le pasticche degli altri mittenti non vanno a zero', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [
      fb({ seq: 1, clientId: 'agent:prober' }),
      fb({ seq: 2, clientId: 'agent:prober' }),
      fb({ seq: 3, clientId: 'utente-a' }),
      fb({ seq: 4, clientId: 'utente-b' }),
      fb({ seq: 5, clientId: 'utente-c' }),
    ],
    workerLog: [],
  });
  await page.locator('[data-fs-range="30g"]').click();

  await expect(page.locator('[data-fs-creator="user"] .mg-chip-n')).toHaveText('3');
  await expect(page.locator('[data-fs-creator="prober"] .mg-chip-n')).toHaveText('2');

  // Acceso il filtro sull'esploratore, la pasticca delle persone deve
  // continuare a dire quante ce ne sono: è il numero che serve per decidere se
  // aggiungerla al filtro.
  await page.locator('[data-fs-creator="prober"]').click();
  await expect(page.locator('[data-fs-creator="prober"]')).toHaveClass(/mg-chip--on/);
  await expect(page.locator('[data-fs-creator="user"] .mg-chip-n')).toHaveText('3');
});
