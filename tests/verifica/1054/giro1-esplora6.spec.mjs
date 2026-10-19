// Esplorazione del verificatore (#1054 giro 1): finestra incognito, ricerca nella cronologia da tastiera, Esc in fretta.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';
import { apriCronologia, statoCronologia } from '../../helpers/cronologiaAppunti.mjs';

const pausa = (ms) => new Promise((r) => { setTimeout(r, ms); });
test.use({ stratoDelMenu: true });

test('ricerca nella cronologia da tastiera, poi Invio', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await paginaDelloStrato(app);
  await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
  const page = await testServer.openReady(openTab, '<!doctype html><body style="margin:0;height:100vh"><input id="c" value="" style="position:absolute;left:300px;top:100px;width:300px"></body>');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const menu = menuDi(page);
  for (const t of ['alfa uno', 'beta due', 'gamma tre']) {
    await app.evaluate(({ clipboard }, x) => clipboard.writeText(x), t);
    await page.locator('#c').click({ button: 'right' });
    await menu.locator('.sn-menu-paste-main').click();
    await pausa(400);
  }
  await page.locator('#c').fill('');
  await apriCronologia(app, page, '#c');
  await pausa(300);
  const tastiera = (await statoDelloStrato(app)).tastiera;
  await menu.superficie.keyboard.type('beta');
  await pausa(500);
  const filtrate = (await statoCronologia(app, page))?.voci?.map((v) => v.testo);
  const cercaVal = await menu.locator('.sn-menu-history-search-input').inputValue().catch(() => null);
  const campoVal = await page.locator('#c').inputValue();
  await menu.superficie.keyboard.press('Enter');
  await pausa(900);
  console.log('RICERCA', JSON.stringify({ tastiera, filtrate, cercaVal, campoVal, dopoInvio: await page.locator('#c').inputValue(), aperto: (await statoDelloStrato(app)).aperto }));
});

test('Esc subito dopo il tasto destro', async ({ app, openTab, testServer }) => {
  await paginaDelloStrato(app);
  await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
  const page = await testServer.openReady(openTab, '<!doctype html><body style="margin:0;height:100vh"><p>x</p></body>');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const esiti = [];
  for (let i = 0; i < 5; i++) {
    await page.mouse.click(300, 300, { button: 'right' });
    await page.keyboard.press('Escape');
    await pausa(1200);
    const s = await statoDelloStrato(app);
    esiti.push({ aperto: s.aperto, visibile: s.visibile, cs: await page.evaluate(() => 0) });
  }
  console.log('ESC', JSON.stringify(esiti));
  // dopo, un tasto destro normale apre ancora
  await page.mouse.click(300, 300, { button: 'right' });
  await expect(menuDi(page).principale).toBeVisible();
});

test('finestra incognito e seconda finestra', async ({ app, testServer }) => {
  test.setTimeout(90_000);
  await paginaDelloStrato(app);
  const esiti = {};
  for (const tipo of ['incognito', 'normale']) {
    await app.evaluate(async (_e, tipo) => {
      const H = globalThis.__filoHandlers;
      if (tipo === 'incognito') await H.handleMessage({ type: globalThis.SN_MSG.MSG.OPEN_INCOGNITO }, { isShell: true });
      else await H.handleMessage({ type: globalThis.SN_MSG.MSG.OPEN_NEW_WINDOW || 'open_new_window' }, { isShell: true });
    }, tipo);
    await pausa(3000);
  }
  const finestre = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w._filoTabs).map((w) => ({ inc: !!w._filoIncognito, strato: !!w._filoTabs.strato?.vista, pronta: !!w._filoTabs.strato?.pronta })));
  esiti.finestre = finestre;
  const url = testServer.html('<!doctype html><title>inc1054</title><body style="margin:0;height:100vh"><input id="c" style="position:absolute;left:100px;top:100px;width:300px"></body>');
  await app.evaluate(({ clipboard }) => clipboard.writeText('INCOGNITO-1054'));
  await app.evaluate(async ({ BrowserWindow }, url) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs);
    win._filoTabs.openTab(url);
  }, url);
  await pausa(3000);
  const inc = app.windows().find((w) => w.url() === url);
  esiti.trovata = !!inc;
  await inc.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 }).catch(() => {});
  await inc.mouse.click(150, 110, { button: 'right' });
  await pausa(1500);
  const stato = () => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito && x._filoTabs); return w._filoTabs.strato.stato(); });
  esiti.incAperto = await stato();
  const strati = app.windows().filter((w) => w.url().startsWith('filo://menu/'));
  esiti.strati = strati.length;
  for (const s of strati) {
    const n = await s.locator('.sn-menu-paste-main').count();
    if (n) { await s.locator('.sn-menu-paste-main').click(); esiti.cliccato = true; }
  }
  await pausa(1000);
  console.log('PRIMA', JSON.stringify(esiti));
  esiti.valore = await inc.locator('#c').inputValue({ timeout: 3000 }).catch((e) => String(e).slice(0, 100));
  console.log('FINESTRE', JSON.stringify(esiti));
});
