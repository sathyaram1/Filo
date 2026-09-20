// Verifica #530, giro 1 — la frase che spiega il popup.
//
// La promessa: quando Filo chiede stavolta e ieri no, il popup dice perché
// in una riga («in questo compito ho letto una pagina web»). Qui si guarda
// quella riga DOVE la legge l'utente — dentro il dialogo aperto — non nel
// campo che torna al programma.

import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmText, clickConfirm } from '../../helpers/confirm.mjs';

test.setTimeout(60_000);

const NEWTAB = 'filo://dashboard/dashboard.html';

const exec = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

test('il dialogo aperto dice cosa sta per fare E perché lo chiede', async ({ app, openTab }) => {
  const sender = { tab: { id: 9610, url: NEWTAB }, url: NEWTAB };
  await exec(app, { type: 'CERCA_WEB', query: 'qualunque cosa' }, { sender });
  const r = await exec(app, { type: 'SALVA_LEZIONE', testo: 'Scrivi sempre in inglese' }, { sender });
  expect(r.needsConfirm).toBe(2);

  const page = await openTab(NEWTAB);
  await page.evaluate((a) => {
    const host = document.createElement('div');
    host.id = 'test-actions';
    document.body.appendChild(host);
    window.__filoDashActions.renderActions(host, [a]);
  }, { type: 'SALVA_LEZIONE', testo: 'Scrivi sempre in inglese', _confirm: { level: r.needsConfirm, text: r.describe } });

  await page.locator('#test-actions .dash-action-btn').click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
  const testo = await confirmText(page);
  expect(testo, 'il dialogo non dice cosa sta per essere salvato').toContain('Scrivi sempre in inglese');
  expect(testo, 'il dialogo non dice PERCHÉ stavolta chiede').toMatch(/ho letto/i);
  expect(testo, 'il dialogo non nomina la cosa letta').toMatch(/ricerca sul web/i);
  await clickConfirm(page, 'cancel');
});
