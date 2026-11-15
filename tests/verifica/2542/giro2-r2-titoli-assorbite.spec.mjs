// Verifica #2542 giro 2: r2 dentro la domanda che assorbe, le assorbite si riconoscono senza aprirle una a una.
import { test, expect } from '../../fixtures/electron.mjs';
import { MANAGE } from '../../helpers/gestioneMainFinto.mjs';

const ora = Date.now();
function domanda(numero, over) {
  return Object.assign({
    id: `D-${numero}`, numero, stato: 'aperta', priorita: 'importante', fiducia: 'fidato',
    titolo: `Domanda ${numero}`, creataIl: ora - numero * 1000, modificataIl: ora - numero * 1000,
    opzioni: [], consiglio: null, conversazione: [],
  }, over);
}

test('r2 la domanda che assorbe mostra di cosa parlano le assorbite, non solo il loro numero', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  const lista = [
    domanda(40, { titolo: 'Il bordo dei menu è freddo', assorbite: ['D-41', 'D-42'] }),
    domanda(41, { stato: 'superata', titolo: 'Il bordo delle schede è freddo', esito: { ok: true, superata: 'assorbita in D-40', superataDa: 'D-40', assorbita: true } }),
    domanda(42, { stato: 'superata', titolo: 'Il bordo dei riquadri è freddo', esito: { ok: true, superata: 'assorbita in D-40', superataDa: 'D-40', assorbita: true } }),
  ];
  await page.evaluate((l) => window.__mgTest.setDomande(l, { riferimenti: {} }), lista);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await page.locator('#mgDomandeLista .mg-domanda[data-id="D-40"]').click();
  const sez = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-40"] .mg-dq-assorbite-sez');
  await expect(sez).toBeVisible();
  await expect(sez).toContainText('Il bordo delle schede è freddo');
  await expect(sez).toContainText('Il bordo dei riquadri è freddo');
});
