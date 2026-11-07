// Esplorazione del giro 3 di #1882: Cerca dalle altre pagine di Filo (Editor, home) e un modulo su richiesta (QR).
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { nelMondoDiFilo, statoDi } from '../../helpers/riquadri.mjs';

const oggi = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = globalThis.SN_CONTATORI.giornoDi(Date.now());
  const ore = Object.entries(s.ore || {}).filter(([k]) => k.startsWith(`${g}T`)).map(([, v]) => v);
  const tot = {};
  for (const o of ore) {
    for (const [id, a] of Object.entries(o.azioni || {})) {
      const t = tot[id] || (tot[id] = { n: 0, fine: {} });
      t.n += a.n || 0;
      for (const [f, n] of Object.entries(a.fine || {})) t.fine[f] = (t.fine[f] || 0) + n;
    }
  }
  return tot;
});

async function motoreLento(app, sito) {
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

async function cercaDa(app, page, locator) {
  await locator.evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await locator.click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible({ timeout: 8_000 });
  await menu.voce('Cerca').first().click();
  await expect.poll(() => caricata(app, 'google\\.com/search'), { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => (await oggi(app))['search-web']?.n || 0, { timeout: 8_000 }).toBe(1);
  return (await oggi(app))['search-web'].fine;
}

test('Cerca dall’Editor misura fino alla pagina dei risultati', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const sito = await testServer.openReady(openTab, '<!doctype html><body><p>sito</p></body>');
  await motoreLento(app, sito);
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc', { timeout: 10_000 });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 10_000 });
  await page.locator('#doc').click();
  await page.keyboard.type('Una frase da cercare nel documento');
  const fine = await cercaDa(app, page, page.locator('#doc'));
  expect(Object.keys(fine)).toEqual(['s5']);
});

test('Cerca dalla home misura fino alla pagina dei risultati', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const sito = await testServer.openReady(openTab, '<!doctype html><body><p>sito</p></body>');
  await motoreLento(app, sito);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 10_000 });
  await page.evaluate(() => {
    const p = Object.assign(document.createElement('p'), { id: 'risposta-prova', textContent: 'Una risposta della chat da cercare' });
    p.style.cssText = 'position:fixed;left:200px;top:200px;font-size:22px;z-index:99999;background:#fff';
    document.body.append(p);
  });
  const fine = await cercaDa(app, page, page.locator('#risposta-prova'));
  expect(Object.keys(fine)).toEqual(['s5']);
});

test('Cerca dalla risposta di Filo sopra un sito (strato dei riquadri) apre i risultati e misura fino a pagina caricata', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = { ...orig, streamComplete: async ({ onDelta }) => { onDelta('The cat sleeps.'); return { text: 'The cat sleeps.', usage: {} }; } };
  });
  const p = await testServer.openReady(openTab, '<!doctype html><body style="padding:40px"><p style="font-size:22px">Il <span id="parola">gatto</span> dorme.</p></body>');
  await motoreLento(app, p);
  await p.locator('#parola').dblclick();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('translate-selection', win);
  });
  await expect.poll(async () => (await statoDi(app, p, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('The cat');
  const strato = await paginaDelloStrato(app, p);
  const corpo = strato.locator('.sn-popup-body');
  await corpo.click({ clickCount: 3 });
  await corpo.click({ button: 'right' });
  let superficie = null;
  await expect.poll(async () => {
    for (const w of app.windows()) {
      try { if (await w.locator('.sn-menu:not(.sn-menu-sub)').isVisible()) { superficie = w; return w.url(); } } catch (_) {}
    }
    return null;
  }, { timeout: 8_000 }).not.toBeNull();
  await superficie.locator('.sn-menu-item', { hasText: /^\s*Cerca\s*$/ }).first().click();
  await expect.poll(() => caricata(app, 'google\\.com/search'), { timeout: 15_000, message: 'Cerca dallo strato non apre i risultati' }).toBe(true);
  await expect.poll(async () => (await oggi(app))['search-web']?.n || 0, { timeout: 8_000 }).toBe(1);
  expect(Object.keys((await oggi(app))['search-web'].fine)).toEqual(['s5']);
});

test('il QR della pagina, su richiesta, si apre al primo uso su un sito appena aperto', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><body><p>qr</p></body>');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  expect(await page.evaluate(() => document.documentElement.dataset.filoSuRichiesta || '')).toContain('SN_QR');
  await nelMondoDiFilo(app, page, () => { globalThis.SN_MENU_ICONS.runIconAction('qrCode'); return true; });
  await expect.poll(async () => (await statoDi(app, page, '.sn-qr-card'))?.visibile ?? false, { timeout: 8_000 }).toBe(true);
});
