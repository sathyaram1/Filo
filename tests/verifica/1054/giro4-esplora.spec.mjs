// #1054 giro 4: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, menuDelloStratoAperto, paginaDelloStrato, statoDelloStrato, statoCronologia } from '../../helpers/menuContestuale.mjs';
import { cronologiaPronta } from '../../helpers/cronologiaAppunti.mjs';

const pausa = (ms) => new Promise((r) => { setTimeout(r, ms); });
const appunti = (app, testo) => app.evaluate(({ clipboard }, t) => clipboard.writeText(t), testo);
const leggiAppunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());

async function apriPagina(openTab, testServer, html) {
  const page = await testServer.openReady(openTab, html);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

async function misura(page, n = 6) {
  const tempi = [];
  for (let i = 0; i < n; i++) {
    const t0 = Date.now();
    await page.mouse.click(150 + i * 10, 150, { button: 'right' });
    await expect(menuDi(page).principale).toBeVisible({ timeout: 5000 });
    tempi.push(Date.now() - t0);
    await page.keyboard.press('Escape');
    await expect(menuDi(page).principale).toHaveCount(0);
    await pausa(150);
  }
  return tempi;
}

test.describe('acceso', () => {
  test.use({ stratoDelMenu: true });

  test('tempi strato', async ({ app, openTab, testServer }) => {
    await paginaDelloStrato(app);
    await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
    const page = await apriPagina(openTab, testServer, '<!doctype html><body style="margin:0;height:100vh"><p>x</p></body>');
    const tempi = await misura(page);
    console.log('TEMPI STRATO', JSON.stringify(tempi));
  });

  test('taglia in un campo', async ({ app, openTab, testServer }) => {
    await paginaDelloStrato(app);
    await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
    const page = await apriPagina(openTab, testServer, '<!doctype html><body style="margin:40px"><input id="c" value="uno due tre" style="width:300px"><div id="r" contenteditable style="margin-top:40px;width:300px;border:1px solid">alfa beta gamma</div></body>');
    await appunti(app, 'vecchio');
    await page.locator('#c').click();
    await page.evaluate(() => { const c = document.getElementById('c'); c.setSelectionRange(4, 7); });
    const b = await page.locator('#c').boundingBox();
    await page.mouse.click(b.x + 50, b.y + b.height / 2, { button: 'right' });
    await expect(menuDi(page).principale).toBeVisible();
    const voci = await menuDi(page).voci.allInnerTexts();
    console.log('VOCI CAMPO', JSON.stringify(voci));
    const t0 = Date.now();
    await menuDi(page).voce('Taglia').first().click();
    await expect.poll(() => leggiAppunti(app)).toBe('due');
    console.log('TAGLIA ms', Date.now() - t0);
    await expect(page.locator('#c')).toHaveValue('uno  tre');
    // nel contenteditable: seleziona beta e copia
    await page.evaluate(() => { const t = document.getElementById('r').firstChild; const r = document.createRange(); r.setStart(t, 5); r.setEnd(t, 9); getSelection().removeAllRanges(); getSelection().addRange(r); document.getElementById('r').focus(); });
    const rb = await page.locator('#r').boundingBox();
    await page.mouse.click(rb.x + 60, rb.y + rb.height / 2, { button: 'right' });
    await expect(menuDi(page).principale).toBeVisible();
    console.log('VOCI RICCO', JSON.stringify(await menuDi(page).voci.allInnerTexts()));
    await menuDi(page).voce('Taglia').first().click();
    await expect.poll(() => leggiAppunti(app)).toBe('beta');
    await expect(page.locator('#r')).toHaveText('alfa  gamma');
  });

  test('seconda finestra', async ({ app, shell, openTab, testServer }) => {
    await paginaDelloStrato(app);
    const url = testServer.html('<!doctype html><body style="margin:40px"><input id="c" style="width:300px"></body>');
    await app.evaluate(async ({ BrowserWindow }, u) => {
      const W = require('electron').BrowserWindow;
      return null;
    }, url).catch(() => null);
    await shell.evaluate(() => window.filoShell.openIncognito());
    let info = null;
    await expect.poll(async () => (info = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito && x._filoTabs);
      return w ? { id: w.id, strato: !!w._filoTabs.strato, pronta: w._filoTabs.strato?.pronta } : null;
    }))?.pronta, { timeout: 15000 }).toBe(true);
    await app.evaluate(({ BrowserWindow }, u) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito && x._filoTabs);
      w._filoTabs.openTab(u, { activate: true });
    }, url);
    let pag = null;
    await expect.poll(() => Boolean(pag = app.windows().find((p) => { try { return p.url() === url; } catch (_) { return false; } })), { timeout: 10000 }).toBe(true);
    await pag.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    await appunti(app, 'incognito-appunto');
    await pag.locator('#c').click({ button: 'right' });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w._filoTabs?.strato?.stato().aperto || false)), { timeout: 5000 }).toContain(true);
    const nelSito = await pag.evaluate(() => document.querySelectorAll('.sn-menu').length);
    console.log('INCOGNITO menu nel sito', nelSito);
    const menu = await menuDelloStratoAperto(app);
    expect(menu).toBeTruthy();
    await menu.locator('.sn-menu-paste-main').click();
    await expect(pag.locator('#c')).toHaveValue('incognito-appunto');
  });

  test('finestrella cronologia', async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await paginaDelloStrato(app);
    await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
    const FINTA = 'https://login.sito-finto.it/login';
    await app.evaluate(({ session, net }, html) => {
      try { session.defaultSession.protocol.unhandle('https'); } catch (_) {}
      session.defaultSession.protocol.handle('https', (req) => {
        const u = new URL(req.url);
        if (u.hostname + u.pathname === 'login.sito-finto.it/login') return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
        return net.fetch(req, { bypassCustomProtocolHandlers: true });
      });
      globalThis.SN_SAFEBROWSE.setProviders({ gsb: null, rdap: null, ct: null, sandbox: null, llm: null });
    }, '<title>Accedi</title><body style="margin:20px"><input id="pw" style="width:200px"><p id="t">Il fotone è la particella della luce.</p></body>');
    // metti in cronologia
    await appunti(app, 'storico-1054');
    const banca = await apriPagina(openTab, testServer, '<!doctype html><input id="c">');
    await banca.locator('#c').click({ button: 'right' });
    await menuDi(banca).locator('.sn-menu-paste-main').click();
    await expect(banca.locator('#c')).toHaveValue('storico-1054');
    await appunti(app, 'attuale');
    const page = await apriPagina(openTab, testServer, `<!doctype html><body style="margin:40px">
      <button id="b" style="width:200px;height:50px" onclick="window.open('${FINTA}', 'acc', 'width=500,height=400')">Accedi con</button></body>`);
    await page.locator('#b').click();
    let pop = null;
    await expect.poll(() => Boolean(pop = app.windows().find((w) => { try { return w.url() === FINTA; } catch (_) { return false; } })), { timeout: 8000 }).toBe(true);
    await pop.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    const t0 = Date.now();
    await pop.locator('#pw').click({ button: 'right' });
    let menu = null;
    await expect.poll(async () => Boolean(menu = await menuDelloStratoAperto(app)), { timeout: 5000 }).toBe(true);
    console.log('FINESTRELLA primo menu ms', Date.now() - t0);
    await menu.locator('.sn-menu-paste-arrow').hover();
    await pausa(800);
    const testi = await menu.superficie.evaluate(() => {
      const out = [];
      const giro = (r) => { for (const el of r.querySelectorAll('*')) { if (el.shadowRoot) { out.push(el.shadowRoot.textContent); giro(el.shadowRoot); } } };
      giro(document);
      return out.join(' | ');
    });
    console.log('FINESTRELLA cronologia', testi.slice(0, 300));
    await pop.screenshot({ path: 'tests/.shots/giro4-finestrella.png' });
    const strato = menu.superficie;
    await strato.screenshot({ path: 'tests/.shots/giro4-finestrella-strato.png' });
  });
});

test.describe('spento', () => {
  test.use({ stratoDelMenu: false });
  test('tempi pagina', async ({ app, openTab, testServer }) => {
    const page = await apriPagina(openTab, testServer, '<!doctype html><body style="margin:0;height:100vh"><p>x</p></body>');
    const tempi = await misura(page);
    console.log('TEMPI PAGINA', JSON.stringify(tempi));
  });
});
