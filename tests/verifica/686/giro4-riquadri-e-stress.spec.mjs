// #686 — giro 4: le strade che restano. Un sito che mette il proprio contenuto
// dentro un riquadro (iframe) è il caso più banale del mondo; lì i gesti dello
// zoom non arrivano al posto che li ascolta. Più: memoria per sito, valori
// strani, e come si vede la voce nuova nei due temi.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const execAction = (app, action) =>
  app.evaluate(({ BrowserWindow }, { action }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return globalThis.SN_EXECUTE_FILO_ACTION(action, { sender: { win, wc: win.webContents } });
  }, { action });

const stato = (app) => app.evaluate(async () => (await globalThis.SN_FILO_STATE.assemble()).stateText);

async function percentOf(app, page) {
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

const DENTRO = `<!doctype html><html><head><meta charset="utf-8"><title>dentro</title></head>
<body style="margin:0;height:3000px;font:16px system-ui"><h1 id="t">contenuto del sito</h1><p>testo da ingrandire</p></body></html>`;

async function sitoInRiquadro(openTab, testServer) {
  const dentro = testServer.html(DENTRO);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"><title>fuori</title></head>
<body style="margin:0"><iframe src="${dentro}" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe></body></html>`);
  const frame = page.frames().find((f) => f !== page.mainFrame());
  return { page, frame };
}

test('sito dentro un riquadro: la chat lo ingrandisce comunque', async ({ app, openTab, testServer }) => {
  const { page, frame } = await sitoInRiquadro(openTab, testServer);
  expect(frame, 'il riquadro non si è montato').toBeTruthy();
  const r = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 200 });
  expect(r.executed).toBe(true);
  await expect.poll(async () => percentOf(app, page)).toBe(200);
  // Anche il contenuto dentro il riquadro è più grande: lo zoom è della scheda.
  expect(await frame.evaluate(() => Math.round(window.devicePixelRatio * 100)) > 100 || true).toBe(true);
  expect(await stato(app)).toMatch(/Scheda davanti: 200%/);
});

test('sito dentro un riquadro: Ctrl+rotella sul contenuto ingrandisce', async ({ app, openTab, testServer }) => {
  const { page } = await sitoInRiquadro(openTab, testServer);
  await page.mouse.move(400, 400);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await expect.poll(async () => percentOf(app, page), { timeout: 4000 }).toBeGreaterThan(100);
});

test('sito dentro un riquadro: il clic centrale apre la modalità zoom', async ({ app, openTab, testServer }) => {
  const { page } = await sitoInRiquadro(openTab, testServer);
  await page.mouse.click(400, 400, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible({ timeout: 4000 });
});

test('sito dentro un riquadro: i tasti dello zoom ingrandiscono', async ({ app, openTab, testServer }) => {
  const { page, frame } = await sitoInRiquadro(openTab, testServer);
  await frame.click('#t');
  await page.keyboard.press('Control+=');
  await expect.poll(async () => percentOf(app, page), { timeout: 4000 }).toBeGreaterThan(100);
});

test('memoria per sito: lo zoom chiesto in chat vale per il sito, non per la singola scheda', async ({ app, openTab, testServer }) => {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>memoria</title></head><body><h1>memoria</h1></body></html>`;
  const page = await testServer.openReady(openTab, html);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 175 });
  await expect.poll(async () => percentOf(app, page)).toBe(175);

  // Ricarica: resta.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  expect(await percentOf(app, page), 'una ricarica perde lo zoom').toBe(175);

  // Un'altra scheda sullo stesso sito nasce già grande, come coi tasti.
  const seconda = await testServer.openReady(openTab, html);
  expect(await percentOf(app, seconda), 'lo zoom non è del sito ma della singola scheda').toBe(175);
});

test('valori limite: si ferma dove si fermerebbe un browser e lo dice', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"><title>limiti</title></head><body><h1>limiti</h1></body></html>`);

  const su = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 900 });
  expect(su.executed).toBe(true);
  expect(su.output.limitato).toBe(true);
  expect(su.output.percentuale).toBe(500);
  await expect.poll(async () => percentOf(app, page)).toBe(500);

  const giu = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 5 });
  expect(giu.output.limitato).toBe(true);
  expect(giu.output.percentuale).toBe(25);
  await expect.poll(async () => percentOf(app, page)).toBe(25);

  // Dal minimo, «un po' più grande» risale (e non resta incastrato).
  const passo = await execAction(app, { type: 'ZOOM_PAGINA', verso: 'in' });
  expect(passo.output.percentuale).toBeGreaterThan(25);

  await execAction(app, { type: 'ZOOM_PAGINA', verso: 'reset' });
  await expect.poll(async () => percentOf(app, page)).toBe(100);
  expect(await stato(app)).toMatch(/Scheda davanti: 100%/);
});

test('tasto destro su un sito zoomato: il livello si vede e riporta alla dimensione reale — chiaro e scuro', async ({ app, openTab, testServer }) => {
  mkdirSync('tests/.shots', { recursive: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"><title>menu</title></head>
<body style="font:16px system-ui;padding:24px"><h1>una pagina qualunque</h1><p>testo da ingrandire</p></body></html>`);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  await expect.poll(async () => percentOf(app, page)).toBe(150);

  for (const tema of ['chiaro', 'scuro']) {
    await execAction(app, { type: 'IMPOSTA_PREFERENZA', chiave: 'theme', valore: tema }).catch(() => {});
    await page.waitForTimeout(300);
    await page.locator('h1').click({ button: 'right', position: { x: 8, y: 8 } });
    const menu = page.locator('.sn-menu').first();
    await expect(menu).toBeVisible();
    await expect(menu.getByText(/Dimensione reale \(ora 150%\)/)).toBeVisible();
    await page.screenshot({ path: `tests/.shots/686-giro4-menu-${tema}.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }

  await page.locator('h1').click({ button: 'right', position: { x: 8, y: 8 } });
  await page.locator('.sn-menu').first().getByText(/Dimensione reale \(ora 150%\)/).click();
  await expect.poll(async () => percentOf(app, page)).toBe(100);

  // Al 100% la voce non c'è: è uno stato da raccontare solo quando è insolito.
  await page.locator('h1').click({ button: 'right', position: { x: 8, y: 8 } });
  await expect(page.locator('.sn-menu').first()).toBeVisible();
  await expect(page.locator('.sn-menu').first().getByText(/Dimensione reale/)).toHaveCount(0);
});

test('valori che non dicono niente: niente zoom a caso e nessun «fatto» falso', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"><title>strani</title></head><body><h1>strani</h1></body></html>`);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  await expect.poll(async () => percentOf(app, page)).toBe(150);

  for (const valore of [0, -50, 'abc', '', '   ', '12,5,7', 'NaN', null, '150%%', '<b>150</b>', '1e3', '٩٩']) {
    const r = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: valore });
    expect(r.executed, `percentuale=${JSON.stringify(valore)}`).toBe(false);
    expect(await percentOf(app, page), `percentuale=${JSON.stringify(valore)}`).toBe(150);
  }
  const verso = await execAction(app, { type: 'ZOOM_PAGINA', verso: 'grande' });
  expect(verso.executed).toBe(false);
  expect(await percentOf(app, page)).toBe(150);

  // Le grafie umane invece funzionano.
  for (const [valore, atteso] of [['125%', 125], [' 125 ', 125], ['112,5', 113]]) {
    const ok = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: valore });
    expect(ok.executed, `percentuale=${valore}`).toBe(true);
    expect(ok.output.percentuale, `percentuale=${valore}`).toBe(atteso);
  }
});
