// Verifica #2070 giro 2: esplorazione (etichetta reincollata, due Gestioni, tasto destro, aspetto chiaro e scuro).
import { test, expect } from '../../fixtures/electron.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto, aspettaAvvio } from '../../helpers/gestioneMainFinto.mjs';

const PAROLA = 'cavallo-blu-7Qx2-ottobre-lampione';
const riga = (page, id) => page.locator(`#mgDomandeLista .mg-domanda[data-id="${id}"]`);
const dq = (page, id) => page.locator(`#mgDomandaDettaglio .mg-dq[data-id="${id}"]`);
const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());

async function sezione(page, nome, pannello) {
  await page.locator(`.mg-sezione[data-sezione="${nome}"]`).click();
  await expect(page.locator(pannello)).toHaveClass(/mg-panel--active/);
}

test('esplora', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [domanda(8, { titolo: 'Colore dei pulsanti' }), domanda(12)] });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  const campo = page.locator('#mgParola');
  await sezione(page, 'routine', '#panel-automation');
  await page.locator('#mgParolaBlock').screenshot({ path: 'tests/.shots/v2070-vuoto.png' });

  // La riga con l'etichetta tipografica, incollata.
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), `Parola d’ordine:   ${PAROLA}`);
  await campo.focus();
  await page.keyboard.press('Control+V');
  await campo.press('Enter');
  await expect(page.locator('#mgParolaStato')).toContainText('salvata');
  await page.locator('#mgParolaBlock').screenshot({ path: 'tests/.shots/v2070-salvata.png' });
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await page.locator('#mgParolaBlock').screenshot({ path: 'tests/.shots/v2070-salvata-scuro.png' });
  await page.locator('#panel-automation').screenshot({ path: 'tests/.shots/v2070-automazioni-scuro.png' });
  await page.evaluate(() => document.documentElement.removeAttribute('data-sn-theme'));
  await page.locator('#panel-automation').screenshot({ path: 'tests/.shots/v2070-automazioni.png' });

  await sezione(page, 'domande', '#panel-domande');
  await riga(page, 'D-12').click();
  await dq(page, 'D-12').locator('button[data-fai="discuti"]').click();
  await expect.poll(() => appunti(app)).toBe(`Parola d'ordine: ${PAROLA}\nDiscutiamo la domanda D-12`);
  await page.locator('#panel-domande').screenshot({ path: 'tests/.shots/v2070-domande.png' });
  await riga(page, 'D-12').click({ button: 'right' });
  await page.locator('.mg-ctxmenu').last().screenshot({ path: 'tests/.shots/v2070-menu.png' });
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await page.locator('.mg-ctxmenu').last().screenshot({ path: 'tests/.shots/v2070-menu-scuro.png' });
  await page.keyboard.press('Escape');
  await page.locator('#panel-domande').screenshot({ path: 'tests/.shots/v2070-domande-scuro.png' });
  await page.evaluate(() => document.documentElement.removeAttribute('data-sn-theme'));

  // Seconda Gestione: la toglie, la prima con la domanda aperta deve tornare alla riga sola.
  const seconda = await openTab(MANAGE);
  await aspettaAvvio(seconda);
  await sezione(seconda, 'routine', '#panel-automation');
  await seconda.locator('#mgParolaTogli').click();
  await seconda.locator('#mgParolaTogli').click();
  await expect(seconda.locator('#mgParolaMsg')).toHaveText('Tolta: «Discutiamone» copia solo la riga.');
  await page.bringToFront();
  await expect(dq(page, 'D-12').locator('button[data-fai="discuti"]')).toHaveAttribute('title', 'Copia «Discutiamo la domanda D-12» da incollare in una sessione locale');
  await sezione(page, 'routine', '#panel-automation');
  await expect(page.locator('#mgParolaStato')).toHaveText('');
  await expect(page.locator('#mgParolaTogli')).toBeHidden();
});
