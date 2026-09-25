// VERIFICA #496 — giro 25. La riga sotto i filtri conta segnalazioni («N non
// hanno una data d'arrivo leggibile», «di N non si è letto il mittente») e non
// si apre su nessuna: sono le uniche segnalazioni che la scheda nomina e non
// fa vedere, e quelle senza data restano fuori da ogni finestra, «Tutto»
// compreso, quindi non si raggiungono da nessun'altra parte.
import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

async function scheda(openTab) {
  const page = await openTab(URL_GESTIONE);
  const feedbacks = [
    fb({ _id: 'ok1', seq: 1, createdAt: g(2) }),
    fb({ _id: 'no1', seq: 2, createdAt: 'non è una data', name: 'la prima senza data' }),
    fb({ _id: 'no2', seq: 3, createdAt: null, name: 'la seconda senza data' }),
  ];
  await apriStatistiche(page, { feedbacks, workerLog: [] }, feedbacks);
  await page.locator('[data-fs-range="tutto"]').click();
  return page;
}

test('#496 giro25 — il conto delle segnalazioni senza data si apre su quelle segnalazioni', async ({ openTab }) => {
  const page = await scheda(openTab);
  const nota = page.locator('#mgFsNota');
  await expect(nota).toBeVisible();
  expect(await nota.innerText()).toContain('data d\'arrivo leggibile');
  // La regola della scheda: un numero si apre su ciò che ha contato, col clic,
  // da tastiera e col tasto destro.
  const pulsanti = await nota.locator('button, [role="button"], [tabindex]').count();
  expect(pulsanti, 'nella riga sotto i filtri il conto delle segnalazioni deve essere apribile').toBeGreaterThan(0);
});

test('#496 giro25 — il tasto destro sulla riga sotto i filtri offre i conti che contiene', async ({ openTab }) => {
  const page = await scheda(openTab);
  await page.locator('#mgFsNota').click({ button: 'right' });
  const voci = await page.locator('.mg-ctxmenu .sn-select-option').allInnerTexts().catch(() => []);
  expect(voci.join(' | '), 'il menu della riga deve portare alle segnalazioni contate').toMatch(/Mostra/);
});
