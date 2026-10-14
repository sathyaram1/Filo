// Giro 3, rilievo 2: lo stesso gesto (affidare a un agente) dice la stessa cosa da qualunque pulsante parta.
import { test, expect } from '../../fixtures/electron.mjs';
import { installa, apri, sezione, domanda, livello } from './mainFinto.mjs';

const affida = (n) => domanda(n, { consiglio: { opzione: 1, perche: 'Meglio un agente.' } });

test('r2 «Applica il consiglio» che affida a un agente conferma come il pulsante dell’opzione', async ({ app, openTab }) => {
  await installa(app, { feedback: [livello.l2('fb1')], domande: [affida(1), affida(2)] });
  const page = await apri(openTab);
  await sezione(page, 'domande').click();
  await page.locator('.mg-domanda[data-id="D-1"]').click();
  await page.locator('.mg-dq[data-id="D-1"] button[data-scelta="1"]').click();
  const dallOpzione = page.locator('.mg-dq[data-id="D-1"] .mg-dq-msg');
  await expect(dallOpzione).toHaveText(/Mandata/);
  await page.locator('.mg-domanda[data-id="D-2"]').click();
  await page.locator('.mg-dq[data-id="D-2"] [data-fai="consiglio"]').click();
  await expect(page.locator('.mg-dq[data-id="D-2"] .mg-dq-esito')).toHaveText(/Affidata a un agente/);
  await expect(page.locator('.mg-dq[data-id="D-2"] .mg-dq-msg')).toHaveText('Mandata: la prende un agente.');
});
