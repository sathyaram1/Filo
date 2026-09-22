// VERIFICA #496 — giro 19. Un'occhiata alla scheda dopo la correzione: i
// riquadri che ora sono pulsanti devono restare disegnati come prima, nei due
// temi. Non asserisce numeri: guarda che niente si sia storto.
import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

test('#496 giro19 — la scheda resta disegnata bene nei due temi', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  const dati = {
    feedbacks: [
      fb({ _id: 'o1', seq: 961, status: 'done', createdAt: g(6), reviewedAt: g(5) }),
      fb({ _id: 'o2', seq: 962, status: 'working', createdAt: g(4) }),
      fb({ _id: 'o3', seq: 963, status: 'design', statusReason: 'loop', createdAt: g(3) }),
      fb({ _id: 'o4', seq: 964, clientId: 'routine:prober', createdAt: g(2) }),
    ],
    workerLog: [
      { role: 'new-work', startedAt: g(5), num: '961' },
      { role: 'verifier', startedAt: g(4.5), num: '961' },
      { role: 'new-work', startedAt: g(4), num: '962' },
      { role: 'new-work', startedAt: g(3), num: '963' },
      { role: 'prober', startedAt: g(2) },
    ],
  };
  await apriStatistiche(page, dati, dati.feedbacks);
  await page.locator('[data-fs-range="30g"]').click();

  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => { document.documentElement.dataset.snTheme = t; }, tema);
    await page.locator('#mgFsTiles').screenshot({ path: `tests/.shots/496-giro19-tiles-${tema}.png` });
    await page.locator('#mgFsRoot').screenshot({ path: `tests/.shots/496-giro19-scheda-${tema}.png` });
  }
  // Le quattro tessere in cima restano su una riga sola e della stessa altezza.
  const altezze = await page.evaluate(() => [...document.querySelectorAll('#mgFsTiles > [data-fs-id]')]
    .map((e) => Math.round(e.getBoundingClientRect().height)));
  expect(new Set(altezze).size, `riquadri di altezze diverse: ${altezze}`).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});
