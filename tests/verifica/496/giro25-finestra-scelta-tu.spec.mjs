// VERIFICA #496 — giro 25. Scegliendo «Scegli tu» senza aver ancora scritto
// nessuna delle due date i numeri diventano quelli di sempre, e la riga che in
// ogni altro stato dice che finestra stai guardando qui non lo dice: si legge
// come se il periodo scelto fosse già in vigore.
import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

test('#496 giro25 — con «Scegli tu» a campi vuoti la riga dice che stai guardando tutto', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  const feedbacks = [];
  for (let i = 0; i < 12; i++) feedbacks.push(fb({ _id: 'c' + i, seq: 10 + i, createdAt: g(i * 8), name: 't' + i }));
  await apriStatistiche(page, { feedbacks, workerLog: [] }, feedbacks);

  const ricevuti = () => page.locator('[data-fs-id="ricevuti"] .mg-tile-n').innerText();
  await page.locator('[data-fs-range="7g"]').click();
  const sette = await ricevuti();
  await page.locator('[data-fs-range="tutto"]').click();
  const tutto = await ricevuti();
  expect(sette, 'la prova regge solo se le due finestre danno numeri diversi').not.toBe(tutto);

  await page.locator('[data-fs-range="7g"]').click();
  await page.locator('[data-fs-range="custom"]').click();
  // I numeri sono saltati a quelli di sempre senza che nessuno lo dica.
  expect(await ricevuti(), 'i numeri con «Scegli tu» a campi vuoti').toBe(tutto);
  const frase = await page.locator('#mgFsFinestra').innerText();
  expect(frase, 'la riga sotto i due campi deve dire che finestra stai guardando davvero').toMatch(/Guardi/);
});
