// VERIFICA #496 — giro 20. Un'occhiata dopo la correzione: i trattini al posto
// dei numeri che il registro non ha dato, la sezione della torta senza il suo
// quadrato bianco, i due temi. Non asserisce numeri: guarda che niente si sia
// storto.
import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

const DATI = {
  feedbacks: [
    fb({ _id: 'w1', seq: 971, status: 'done', createdAt: g(6), reviewedAt: g(5) }),
    fb({ _id: 'w2', seq: 972, status: 'working', createdAt: g(4) }),
    fb({ _id: 'w3', seq: 973, clientId: 'routine:prober', createdAt: g(2) }),
  ],
  workerLog: [
    { role: 'new-work', startedAt: g(5), num: '971' },
    { role: 'verifier', startedAt: g(4.5), num: '971' },
    { role: 'prober', startedAt: g(2) },
  ],
};

test('#496 giro20 — il registro giù e la torta vuota restano disegnati bene nei due temi', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  await apriStatistiche(page, DATI, DATI.feedbacks);
  await page.locator('[data-fs-range="30g"]').click();

  for (const [nome, dati] of [
    ['registro-giu', { ...DATI, logOk: false }],
    ['torta-vuota', { feedbacks: DATI.feedbacks, workerLog: [] }],
  ]) {
    await page.evaluate((d) => window.__mgTest.setFsData(d), dati);
    for (const tema of ['light', 'dark']) {
      await page.evaluate((t) => { document.documentElement.dataset.snTheme = t; }, tema);
      await page.locator('#mgFsRoot').screenshot({ path: `tests/.shots/496-giro20-${nome}-${tema}.png` });
    }
    // I riquadri restano allineati e della stessa altezza anche coi trattini.
    const altezze = await page.evaluate(() => [...document.querySelectorAll('#mgFsTiles > [data-fs-id]')]
      .map((e) => Math.round(e.getBoundingClientRect().height)));
    expect(new Set(altezze).size, `riquadri di altezze diverse (${nome}): ${altezze}`).toBe(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
      `sbordo orizzontale (${nome})`,
    ).toBe(false);
  }
});
