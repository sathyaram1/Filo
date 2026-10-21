// Esplorazione del giro 3 di #1054: le voci del menu, acceso e spento, sugli stessi contesti.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';

const pausa = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function servi(app, pagine) {
  await app.evaluate(({ session, net }, pg) => {
    const risposta = (req) => {
      const u = new URL(req.url);
      const html = pg[u.hostname + u.pathname];
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    };
    try { session.defaultSession.protocol.unhandle('https'); } catch (_) {}
    session.defaultSession.protocol.handle('https', risposta);
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: null, rdap: null, ct: null, sandbox: null, llm: null });
  }, pagine);
}

const PAGINA = `<!doctype html><title>Prova</title><body style="margin:0;font:16px sans-serif">
  <p id="testo" style="position:absolute;left:40px;top:40px">Il fotone è la particella elementare della luce.</p>
  <a id="link" href="https://sito.esempio.it/altro" style="position:absolute;left:40px;top:100px">un collegamento</a>
  <input id="campo" value="ciao" style="position:absolute;left:40px;top:160px;width:200px">
  <img id="img" alt="x" width="60" height="60" style="position:absolute;left:40px;top:220px" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==">
  <p id="vuoto" style="position:absolute;left:400px;top:400px">.</p></body>`;

async function raccogli(app, openTab, strato) {
  await servi(app, { 'pagina.esempio.it/p': PAGINA });
  if (strato) {
    await paginaDelloStrato(app);
    await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
  }
  const page = await openTab('https://pagina.esempio.it/p');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const out = {};
  const menu = () => menuDi(page);
  const leggi = async () => {
    await expect(menu().principale).toBeVisible({ timeout: 5000 });
    await pausa(600);
    return menu().valuta(() => {
      const m = [...document.querySelectorAll('.sn-menu:not(.sn-menu-sub)')].pop();
      const voci = [...m.querySelectorAll('.sn-menu-item, .sn-menu-paste-main, .sn-menu-split-main, .sn-menu-inline')].map((e) => e.textContent.trim().replace(/\s+/g, ' ').slice(0, 40));
      const icone = [...m.querySelectorAll('[data-sn-icon-id]')].map((e) => e.dataset.snIconId);
      return { voci, icone };
    });
  };
  const chiudi = async () => { await page.keyboard.press('Escape'); await pausa(400); };
  const clic = async (sel) => {
    const b = await page.locator(sel).boundingBox();
    await page.mouse.click(b.x + 5, b.y + b.height / 2, { button: 'right' });
  };
  await clic('#vuoto'); out.vuoto = await leggi(); await chiudi();
  await clic('#link'); out.link = await leggi(); await chiudi();
  await page.locator('#campo').click();
  await clic('#campo'); out.campo = await leggi(); await chiudi();
  await clic('#img'); out.img = await leggi(); await chiudi();
  await page.evaluate(() => {
    const t = document.getElementById('testo').firstChild;
    const r = document.createRange(); r.setStart(t, 3); r.setEnd(t, 9);
    getSelection().removeAllRanges(); getSelection().addRange(r);
  });
  const p = await page.evaluate(() => { const b = getSelection().getRangeAt(0).getBoundingClientRect(); return { x: b.left + 5, y: b.top + b.height / 2 }; });
  await page.mouse.click(p.x, p.y, { button: 'right' });
  out.selezione = await leggi(); await chiudi();
  return out;
}

test.describe('spento', () => {
  test('voci spento', async ({ app, openTab }) => {
    test.setTimeout(90_000);
    console.log('SPENTO', JSON.stringify(await raccogli(app, openTab, false)));
  });
});

test.describe('acceso', () => {
  test.use({ stratoDelMenu: true });
  test('voci acceso', async ({ app, openTab }) => {
    test.setTimeout(90_000);
    console.log('ACCESO', JSON.stringify(await raccogli(app, openTab, true)));
  });
});
