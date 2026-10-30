// Verifica #1791, giro 1, rilievo 2: con la Gestione aperta in due schede, la bozza scritta in una cancella quella
// scritta nell'altra alla ricarica.
import { test, expect } from '../../fixtures/electron.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto, aspettaAvvio } from '../../helpers/gestioneMainFinto.mjs';

const riga = (page, id) => page.locator(`#mgDomandeLista .mg-domanda[data-id="${id}"]`);
const dq = (page, id) => page.locator(`#mgDomandaDettaglio .mg-dq[data-id="${id}"]`);

async function apriDomande(page) {
  await aspettaAvvio(page);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await expect(page.locator('#panel-domande')).toHaveClass(/mg-panel--active/);
}

test('r2 una bozza scritta in un’altra scheda della Gestione non cancella la mia', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [domanda(90), domanda(91)] });
  const a = await openTab(MANAGE);
  await apriDomande(a);
  const b = await openTab(MANAGE);
  await apriDomande(b);
  await a.bringToFront();
  await riga(a, 'D-90').click();
  await dq(a, 'D-90').locator('.mg-dq-testo').fill('la mia risposta lunga');
  await b.bringToFront();
  await riga(b, 'D-91').click();
  await dq(b, 'D-91').locator('.mg-dq-testo').fill('un’altra');
  await a.bringToFront();
  await a.reload();
  await apriDomande(a);
  await riga(a, 'D-90').click();
  await expect(dq(a, 'D-90').locator('.mg-dq-testo')).toHaveValue('la mia risposta lunga');
});
