// Esplorazione: l'annullo chiesto a parole in chat di un livello abbassato chiede «conferma» come il segno sulla bolla.

import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, clickConfirm, confirmState, fillConfirmInput, scrollConfirmToEnd } from '../../helpers/confirm.mjs';

const privacy = (app) => app.evaluate(async () => globalThis.SN_LIVELLI_PRIVACY.regola(await globalThis.SN_STORAGE.getSettings()));

test('in chat «annulla l\'ultimo cambio» dopo «manda meno roba» chiede «conferma» prima di riallargare', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const home = await openTab('filo://newtab/');
  await home.evaluate(() => window.SN_SIDEBAR.open());
  const esegui = (azione) => home.evaluate((a) => window.__filoSidebarTest.runFiloAction(a), azione);

  await esegui({ type: 'IMPOSTA_PREFERENZA', chiave: 'livello_privacy', valore: 'meno' });
  await expect.poll(async () => (await privacy(app)).livello, { timeout: 4000 }).toBe('delicate');

  const corsa = esegui({ type: 'ANNULLA_CAMBIO' });
  await expect(home.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  expect((await confirmState(home)).hasInput, 'riallargare vuole la parola scritta').toBe(true);
  expect((await privacy(app)).livello).toBe('delicate');
  await fillConfirmInput(home, 'conferma');
  await scrollConfirmToEnd(home);
  await clickConfirm(home, 'danger');
  await corsa;
  await expect.poll(async () => (await privacy(app)).livello, { timeout: 4000 }).toBe('anticipo');
});
