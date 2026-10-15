// Giro 4, rilievo 1: la rilettura delle domande che porta un cambio non deve rifare le righe sotto il cursore.
// Un clic è giù e su: se in mezzo la riga viene sostituita, il browser non manda il clic (patterns/un-elenco-che-si-aggiorna-non-rifa-i-pulsanti.md).
import { test, expect } from '../../fixtures/electron.mjs';
import { installa, sulServer, apri, sezione, domanda, livello } from './mainFinto.mjs';

const letture = (app) => sulServer(app, (F) => F.log.filter((x) => x.t === 'domande_elenco').length);

async function clicACavallo(page, app, selettore, cambio) {
  const box = await page.locator(selettore).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const n = await letture(app);
  await page.mouse.down();
  await sulServer(app, cambio);
  await expect.poll(() => letture(app), { timeout: 20000 }).toBeGreaterThan(n + 1);
  await page.waitForTimeout(300);
  await page.mouse.up();
}

async function apriDomande(app, openTab) {
  await installa(app, { feedback: [livello.l2('fb1')], domande: [domanda(1), domanda(2), domanda(3)] });
  const page = await apri(openTab);
  await page.evaluate(() => window.__mgTest.setLiveTiming({ pollMs: 3000, clockMs: 500, rientroMs: 1000 }));
  await sezione(page, 'domande').click();
  await page.locator('.mg-domanda[data-id="D-2"]').click();
  await expect(page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-2"]')).toBeVisible();
  return page;
}

test('r1 un clic su una riga mentre arriva il cambio di un’altra domanda apre la domanda', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const page = await apriDomande(app, openTab);
  await clicACavallo(page, app, '.mg-domanda[data-id="D-1"]', (F) => {
    const d = F.domande.find((x) => x.id === 'D-3'); d.titolo = 'Domanda 3 cambiata'; d.modificataIl = Date.now();
  });
  await expect(page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-1"]')).toBeVisible();
});

test('r1 la spunta per Applica il consiglio presa mentre arriva un cambio resta', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const page = await apriDomande(app, openTab);
  await clicACavallo(page, app, '.mg-domanda[data-id="D-3"] .mg-dom-sel', (F) => {
    const d = F.domande.find((x) => x.id === 'D-1'); d.titolo = 'Domanda 1 cambiata'; d.modificataIl = Date.now();
  });
  await expect(page.locator('.mg-domanda[data-id="D-3"] .mg-dom-sel')).toBeChecked();
});
