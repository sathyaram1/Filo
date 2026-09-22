// VERIFICA #496 — giro 18. I lavori che spariscono dalla sezione della torta.
//
// «Quanto è costato ogni lavoro» dovrebbe rendere conto dei lavori che il
// riquadro sopra ha appena contato. La scheda tiene fuori dalla torta ogni
// lavorazione su cui il verificatore non è ancora partito — giusto, il suo
// costo non si sa — ma poi NON la mette nemmeno fra quelle «ancora in mezzo al
// giro», che è esattamente quello che è. Il risultato: la riga che promette di
// dire quanti restano fuori ne dichiara una parte, e il resto sparisce senza
// una parola.
//
// Senza il fix il primo controllo è rosso: tre lavorazioni nella finestra, la
// torta ne racconta una, la riga degli esiti ne dichiara una, e la terza — in
// mano alla correzione proprio adesso — non compare da nessuna parte.

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

// La somma di tutto ciò che la sezione della torta dichiara: le fette più i
// tre esiti sotto. Deve tornare col numero dei lavorati.
async function contiDellaSezione(page) {
  return page.evaluate(() => {
    const num = (el) => Number((el.textContent || '').replace(/[^\d]/g, '')) || 0;
    const fette = Array.from(document.querySelectorAll('#mgFsLegend li .mg-fs-legend-n')).map(num);
    const esiti = {};
    for (const e of document.querySelectorAll('#mgFsEsiti [data-fs-esito]')) {
      esiti[e.dataset.fsEsito] = num(e.querySelector('b'));
    }
    return {
      lavorati: num(document.querySelector('[data-fs-id="lavorati"] .mg-tile-n')),
      fette: fette.reduce((s, n) => s + n, 0),
      aperti: esiti.aperti || 0,
      fermati: esiti.fermati || 0,
    };
  });
}

// Tre lavorazioni nella finestra, tutte e tre vere:
//   #801 finito dopo due verifiche                → una critica
//   #802 preso in mano e in correzione: la verifica non è ancora partita
//   #803 verificato una volta e rimandato indietro → ancora in mezzo al giro
const DATI = {
  feedbacks: [
    fb({ _id: 'g18-a', seq: 801, status: 'done',                createdAt: g(6) }),
    fb({ _id: 'g18-b', seq: 802, status: 'working',             createdAt: g(5) }),
    fb({ _id: 'g18-c', seq: 803, status: 'revision_capability', createdAt: g(4) }),
  ],
  workerLog: [
    { role: 'new-work', startedAt: g(3),   num: '801' },
    { role: 'verifier', startedAt: g(2.9), num: '801' },
    { role: 'fixer',    startedAt: g(2.8), num: '801' },
    { role: 'verifier', startedAt: g(2.7), num: '801' },
    { role: 'new-work', startedAt: g(2),   num: '802' },
    { role: 'fixer',    startedAt: g(1.9), num: '802' },
    { role: 'new-work', startedAt: g(1.5), num: '803' },
    { role: 'verifier', startedAt: g(1.4), num: '803' },
  ],
};

test('#496 giro18 — la sezione della torta rende conto di tutte le lavorazioni contate', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  await apriStatistiche(page, DATI, DATI.feedbacks);
  await page.locator('[data-fs-range="30g"]').click();

  const c = await contiDellaSezione(page);
  expect(c.lavorati).toBe(3);
  // Nessuna lavorazione della finestra può sparire: o sta in una fetta, o sta
  // in uno degli esiti che dicono perché non c'è.
  expect(c.fette + c.aperti).toBe(c.lavorati);
});

test('#496 giro18 — una lavorazione mai verificata è «ancora in mezzo al giro», non niente', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  await apriStatistiche(page, DATI, DATI.feedbacks);
  await page.locator('[data-fs-range="30g"]').click();

  // #802 è in mano alla correzione adesso: è il caso più comune che ci sia.
  const aperti = page.locator('#mgFsEsiti [data-fs-esito="aperti"]');
  await expect(aperti.locator('b')).toHaveText('2');

  // E dev'essere raggiungibile come tutti gli altri numeri della scheda.
  await aperti.click();
  await expect(page.locator('#mgFsDrill')).toBeVisible();
  const righe = await page.locator('#mgFsDrillList li').allInnerTexts();
  expect(righe.join(' ')).toContain('#802');
});
