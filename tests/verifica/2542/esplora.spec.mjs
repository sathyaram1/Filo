import { test, expect } from '../../fixtures/electron.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto, aspettaAvvio } from '../../helpers/gestioneMainFinto.mjs';

const riga = (page, id) => page.locator(`#mgDomandeLista .mg-domanda[data-id="${id}"]`);
const dq = (page, id) => page.locator(`#mgDomandaDettaglio .mg-dq[data-id="${id}"]`);
const IERI = Date.now() - 20 * 3600 * 1000;

test('esplora', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [
    domanda(80, { titolo: 'Assorbe', assorbite: ['D-81'] }),
    domanda(81, { stato: 'superata', titolo: 'Assorbita', esito: { azione: null, ok: true, applicataIl: IERI, superata: 'assorbita in D-80', superataDa: 'D-80' } }),
    domanda(83, { stato: 'chiusa', titolo: 'Archiviata', esito: { azione: null, ok: true, applicataIl: IERI, archiviata: true } }),
  ] });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await page.locator('.mg-tab[data-tab="domande-archivio"]').click();
  await riga(page, 'D-81').click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tests/.shots/verifica-2542-esplora-assorbita.png' });
  const colore = await dq(page, 'D-81').locator('.mg-dq-esito .mg-dq-legame').evaluate((e) => getComputedStyle(e).color);
  console.log('COLORE LEGAME', colore);
  await riga(page, 'D-83').click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tests/.shots/verifica-2542-esplora-archiviata.png' });
  await riga(page, 'D-81').click({ button: 'right' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/verifica-2542-esplora-menu.png' });
});
