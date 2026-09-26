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

async function finestraPercent(app, page) {
  const url = await page.evaluate(() => location.href);
  const f = await app.evaluate(({ webContents }, u) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here === u) return wc.getZoomFactor();
    }
    return null;
  }, url);
  return f == null ? null : Math.round(f * 100);
}

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

test('editor: la modalità rotella ingrandisce la finestra, e da lì non si torna indietro', async ({ app, openTab }) => {
  const page = await apriEditor(openTab);
  expect(await finestraPercent(app, page)).toBe(100);

  // L'utente preme la rotella e zooma con la rotella, come su un sito.
  await page.mouse.move(400, 400);
  await page.mouse.click(400, 400, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(300);
  // Esce dalla modalità con un clic sinistro (il destro la chiude senza menu).
  await page.mouse.click(400, 400);
  await page.waitForTimeout(200);

  // Tutto è più grande: è la FINESTRA che si è ingrandita, non il foglio.
  const grande = await finestraPercent(app, page);
  expect(grande).toBeGreaterThan(100);
  expect(await page.evaluate(() => document.getElementById('doc').style.zoom || '1')).toBe('1');

  // Prima via d'uscita: il tasto della dimensione reale.
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(400);
  expect(await finestraPercent(app, page), 'Ctrl+0 non riporta la pagina alla dimensione reale').toBe(100);
});

test('editor ingrandito dalla rotella: il tasto destro e la chat offrono una via d\'uscita che funziona e un numero vero', async ({ app, openTab }) => {
  const page = await apriEditor(openTab);
  await page.mouse.move(400, 400);
  await page.mouse.click(400, 400, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(300);
  await page.mouse.click(400, 400);
  await page.waitForTimeout(200);
  const grande = await finestraPercent(app, page);
  expect(grande).toBeGreaterThan(100);

  // La chat: quello che Filo risponde deve essere quello che si vede.
  const r = await execAction(app, { type: 'ZOOM_PAGINA', verso: 'reset' });
  await page.waitForTimeout(400);
  expect(await finestraPercent(app, page), '«torna alla dimensione normale» lascia la pagina ingrandita').toBe(100);
  const vero = await finestraPercent(app, page);
  if (r.output && typeof r.output.percentuale === 'number') {
    expect(r.output.percentuale, 'Filo dichiara un numero che non è quello che si vede').toBe(vero);
  }
});

test('editor ingrandito dalla rotella: lo stato che legge Filo dice il numero vero', async ({ app, openTab }) => {
  const page = await apriEditor(openTab);
  await page.mouse.move(400, 400);
  await page.mouse.click(400, 400, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(300);
  await page.mouse.click(400, 400);
  await page.waitForTimeout(200);
  const grande = await finestraPercent(app, page);

  // Il foglio dice 100, la finestra dice `grande`: Filo deve dire `grande`.
  await execAction(app, { type: 'ZOOM_PAGINA', verso: 'reset' });
  await page.waitForTimeout(300);
  const dopo = await finestraPercent(app, page);
  const dice = /Scheda davanti: (\d+)%/.exec(await stato(app))?.[1];
  expect(dice, 'lo stato che Filo legge non corrisponde a quello che l\'utente vede').toBe(String(dopo));
});

test('editor ingrandito dalla rotella: il tasto destro offre una via d\'uscita che funziona', async ({ app, openTab }) => {
  const page = await apriEditor(openTab);
  await page.mouse.move(400, 400);
  await page.mouse.click(400, 400, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(300);
  await page.mouse.click(400, 400);
  await page.waitForTimeout(200);
  const grande = await finestraPercent(app, page);
  expect(grande).toBeGreaterThan(100);

  await page.locator('#doc').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  const voce = menu.getByText(/Dimensione reale \(ora \d+%\)/);
  await expect(voce, 'il tasto destro non racconta che la pagina non è alla dimensione reale').toHaveCount(1);
  expect(await voce.innerText()).toContain(`ora ${grande}%`);
  await voce.click();
  await page.waitForTimeout(400);
  expect(await finestraPercent(app, page), 'la voce «Dimensione reale» non riporta la pagina al 100%').toBe(100);
});
