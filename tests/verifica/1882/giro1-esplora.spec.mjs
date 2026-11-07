// Verifica #1882 giro 1: Cerca dalle altre pagine di Filo nominate (Editor, home) e i moduli su richiesta da altre strade.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { statoDi } from '../../helpers/riquadri.mjs';
import { premiNellaBarra } from '../../helpers/barra.mjs';
import { EDITOR } from '../../helpers/strumentiEditor.mjs';

const oggi = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = globalThis.SN_CONTATORI.giornoDi(Date.now());
  const ore = Object.entries(s.ore || {}).filter(([k]) => k.startsWith(`${g}T`)).map(([, v]) => v);
  const az = {};
  for (const o of ore) for (const [k, v] of Object.entries(o.azioni || {})) {
    const a = az[k] || (az[k] = { n: 0, fine: {} });
    a.n += v.n || 0;
    for (const [f, c] of Object.entries(v.fine || {})) a.fine[f] = (a.fine[f] || 0) + c;
  }
  return az;
});

async function motoreLento(app, testServer, openTab) {
  const sito = await testServer.openReady(openTab, '<!doctype html><body><p>sessione dei siti</p></body>');
  await app.evaluate(async ({ webContents }, url) => {
    const ses = webContents.getAllWebContents().find((w) => w.getURL() === url).session;
    ses.protocol.handle('https', async (req) => {
      if (!/(^|\.)google\.com$/.test(new URL(req.url).hostname)) return new Response('', { status: 404 });
      await new Promise((r) => setTimeout(r, 3000));
      return new Response('<!doctype html><title>risultati</title><p>risultati</p>', { headers: { 'content-type': 'text/html' } });
    });
  }, sito.url());
}
const caricata = (app, re) => app.evaluate(({ webContents }, src) => webContents.getAllWebContents()
  .some((w) => new RegExp(src).test(w.getURL()) && !w.isLoading()), re);

async function cercaDa(app, page, testo) {
  await testo.evaluate((p) => { const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await testo.click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible({ timeout: 8_000 });
  await menu.voce(/^Cerca/).first().click();
  await expect.poll(() => caricata(app, 'google\\.com/search'), { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => (await oggi(app))['search-web']?.n || 0, { timeout: 8_000 }).toBe(1);
  return (await oggi(app))['search-web'].fine;
}

test('Cerca dall’Editor misura fino alla pagina dei risultati', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await motoreLento(app, testServer, openTab);
  const page = await openTab(EDITOR);
  await page.waitForSelector('#doc');
  await page.locator('#doc').click();
  await page.keyboard.type('parola da cercare nel documento');
  const testo = page.locator('#doc').locator('p, div').first();
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1' || true);
  const fine = await cercaDa(app, page, (await testo.count()) ? testo : page.locator('#doc'));
  expect(Object.keys(fine)).toEqual(['s5']);
});

test('Cerca dalla home misura fino alla pagina dei risultati', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await motoreLento(app, testServer, openTab);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 10_000 });
  await page.evaluate(() => {
    const p = Object.assign(document.createElement('p'), { id: 'p-prova', textContent: 'una risposta della chat' });
    p.style.cssText = 'position:fixed;top:200px;left:200px;font-size:22px;z-index:99999;background:#fff';
    document.body.appendChild(p);
  });
  const fine = await cercaDa(app, page, page.locator('#p-prova'));
  expect(Object.keys(fine)).toEqual(['s5']);
});

test('il QR della pagina dalla barra si apre su un sito appena aperto', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><body style="padding:40px"><p>QR</p></body>');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await premiNellaBarra(app, 'qrCode');
  await expect(page.locator('.sn-qr-overlay')).toBeVisible({ timeout: 8000 });
});

test('Filo spento e riacceso sul sito: la segnalazione si apre lo stesso', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><body style="padding:40px"><p id="p" style="font-size:22px">Una frase.</p></body>');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const da = { url: 'filo://options/options.html' };
  const host = new URL(page.url()).hostname;
  await app.evaluate(async (_e, a) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { blocklist: [a.host] } }, { url: a.da }), { host, da: da.url });
  await page.waitForTimeout(800);
  await app.evaluate(async (_e, a) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { blocklist: [] } }, { url: a.da }), { da: da.url });
  await page.waitForTimeout(800);
  await page.locator('#p').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible({ timeout: 8_000 });
  await menu.voce('Invia feedback').first().click();
  await expect.poll(async () => (await statoDi(app, page, '.sn-fb-text'))?.visibile ?? false, { timeout: 8_000 }).toBe(true);
});

test('la segnalazione chiesta dal tasto destro dentro un riquadro si apre', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html('<!doctype html><body style="padding:20px"><p id="q" style="font-size:22px">Dentro il riquadro.</p></body>');
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:20px"><iframe id="f" src="${dentro}" width="500" height="300"></iframe></body>`);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const fr = page.frameLocator('#f');
  await fr.locator('#q').click({ button: 'right' });
  const frame = page.frames().find((f) => f.url() === dentro);
  const menu = menuDi(frame || page);
  await expect(menu.principale).toBeVisible({ timeout: 8_000 });
  await menu.voce('Invia feedback').first().click();
  await expect.poll(async () => (await statoDi(app, page, '.sn-fb-text'))?.visibile ?? false, { timeout: 8_000 }).toBe(true);
});
