// Giro 3, rilievo 1: la risposta scritta a una domanda e non ancora mandata deve sopravvivere a un ricaricamento.
import { test, expect } from '../../fixtures/electron.mjs';
import { installa, apri, sezione, domanda, livello } from './mainFinto.mjs';

test('r1 una bozza di risposta non si perde ricaricando la Gestione', async ({ app, openTab }) => {
  await installa(app, { feedback: [livello.l2('fb1')], domande: [domanda(1), domanda(2), domanda(3)] });
  const page = await apri(openTab);
  await sezione(page, 'domande').click();
  await page.locator('.mg-domanda[data-id="D-3"]').click();
  await page.locator('.mg-dq[data-id="D-3"] .mg-dq-testo').fill('Una risposta lunga, scritta con calma e non ancora mandata.');
  await page.reload();
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await sezione(page, 'domande').click();
  await page.locator('.mg-domanda[data-id="D-3"]').click();
  await expect(page.locator('.mg-dq[data-id="D-3"] .mg-dq-testo')).toHaveValue('Una risposta lunga, scritta con calma e non ancora mandata.');
});
