// VERIFICA #496 — giro 16. La torta «quanto è costato ogni lavoro».
//
// Il feedback chiedeva «il numero medio loop prima del pass (0 critiche, 1
// critica, 2 critiche…)». Qui si prova che cosa risponde la scheda quando il
// lavoro NON è ancora passato, e quando la finestra scelta taglia i giri di
// prima. Due strade, una causa sola: i giri si contano dalle esecuzioni del
// verificatore che cadono nella finestra, e nessuno chiede se il via libera
// è davvero arrivato.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const GIORNO = 24 * 60 * 60 * 1000;
const g = (n) => new Date(Date.now() - n * GIORNO).toISOString();

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

const fette = (page) => page.locator('#mgFsPie [data-group]').evaluateAll(
  (els) => Object.fromEntries(els.map((e) => [e.dataset.group, e.dataset.n])));

// ── 1. Un lavoro ancora in mezzo al giro viene contato come già passato ──────
//
// Due segnalazioni in lavorazione: il verificatore è partito una volta su
// ciascuna, ha scritto la critica e il lavoro è tornato indietro. Nessuna delle
// due ha avuto il via libera. La torta deve NON dire che sono passate subito.

test('#496 giro16 — un lavoro ancora in corso non è «Passato subito»', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [
      fb({ seq: 10, status: 'working' }),    // in lavorazione: nessun via libera
      fb({ seq: 11, status: 'revision' }),   // in revisione: nessun via libera
    ],
    workerLog: [
      { role: 'verifier', startedAt: g(1), num: '10' },
      { role: 'verifier', startedAt: g(1), num: '11' },
    ],
  });
  await page.locator('[data-fs-range="30g"]').click();

  // Quello che l'owner deve poter credere: la fetta «Passato subito» conta i
  // lavori che sono passati. Nessuno dei due lo è.
  const f = await fette(page);
  expect(f.g0, 'due lavori ancora aperti finiscono in «Passato subito»').toBeUndefined();

  // E la media delle critiche prima del via libera non deve essere 0.0 quando
  // nessun via libera è ancora arrivato.
  const mid = await page.locator('#mgFsPieMid').innerText();
  expect(mid, 'la media dichiara 0 critiche prima del via libera senza nessun via libera')
    .not.toMatch(/^0[.,]0/);
});

// ── 2. La finestra taglia i giri di prima, in silenzio ──────────────────────
//
// Lo stesso lavoro, finito dopo tre verifiche (due critiche). Guardandolo da
// «Oggi» la scheda dice che è passato subito, da «7 giorni» che è costato una
// critica, da «30 giorni» che ne è costate due. Il numero cambia con la
// finestra e la pagina non avverte da nessuna parte che il conto è parziale.

test('#496 giro16 — una finestra stretta fa dire alla torta un numero di critiche più basso, senza dirlo', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [fb({ seq: 20, status: 'done', createdAt: g(12) })],
    workerLog: [
      { role: 'verifier', startedAt: g(10), num: '20' },
      { role: 'verifier', startedAt: g(5), num: '20' },
      { role: 'verifier', startedAt: g(0), num: '20' },
    ],
  });

  await page.locator('[data-fs-range="30g"]').click();
  expect(await fette(page)).toEqual({ g2: '1' });

  await page.locator('[data-fs-range="oggi"]').click();
  const oggi = await fette(page);
  // Il lavoro è costato due critiche: nessuna finestra deve farlo passare per
  // un lavoro passato al primo colpo senza dire che sta contando solo un pezzo.
  const nota = page.locator('#mgFsNota');
  const avvisa = (await nota.isVisible()) && /giri|critic|verific/i.test(await nota.innerText());
  expect(oggi.g0 === undefined || avvisa,
    '«Oggi» dice «Passato subito» per un lavoro costato due critiche, e nessuna riga avverte che il conto è parziale').toBe(true);
});
