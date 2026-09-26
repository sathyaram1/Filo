// #686 — giro 4: il numero che Filo dice deve essere quello che l'utente vede,
// anche nell'editor di testo, che ingrandisce il foglio invece della finestra.
// Nei giri 2 e 3 Filo ha già dichiarato due volte un numero falso lì dentro.

import { test, expect } from '../../fixtures/electron.mjs';

const execAction = (app, action) =>
  app.evaluate(({ BrowserWindow }, { action }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return globalThis.SN_EXECUTE_FILO_ACTION(action, { sender: { win, wc: win.webContents } });
  }, { action });

const stato = (app) => app.evaluate(async () => (await globalThis.SN_FILO_STATE.assemble()).stateText);

async function apriEditor(openTab) {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!document.getElementById('doc'), null, { timeout: 8000 });
  await page.waitForTimeout(800);
  return page;
}

test('editor: chat, tasto destro e stato dicono lo stesso numero del foglio', async ({ app, openTab }) => {
  const page = await apriEditor(openTab);

  const r = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  expect(r.executed).toBe(true);
  await expect.poll(async () => page.evaluate(() => document.getElementById('doc').style.zoom)).toBe('1.5');
  expect(await stato(app)).toMatch(/Scheda davanti: 150%/);

  await page.locator('#doc').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  await expect(menu.getByText(/150%/), 'il tasto destro non sa a quanto sta il foglio').toHaveCount(1);
  await page.keyboard.press('Escape');

  // E la via d'uscita a parole riporta il foglio alla dimensione reale.
  const reset = await execAction(app, { type: 'ZOOM_PAGINA', verso: 'reset' });
  expect(reset.executed).toBe(true);
  await expect.poll(async () => page.evaluate(() => document.getElementById('doc').style.zoom)).toBe('');
});
