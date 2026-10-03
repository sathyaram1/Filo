// #589.12 — una pagina salvata per dopo (indirizzo, titolo, miniatura) non arriva a un altro sito, nemmeno dal codice
// di Filo nella sua scheda; la home e le impostazioni la vedono intera. Regola e sentinella sui canali:
// tests/unit/pagineSalvateVersoSiti.test.mjs.

import { test, expect } from './fixtures/electron.mjs';

const MONDO_CONTENT_SCRIPT = 999;
const TITOLO_A = 'Conto della banca 589';

function dalSito(app, host) {
  return (msg) => app.evaluate(async ({ BrowserWindow }, { h, m, mondo }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => String(t.url || '').includes(h));
    if (!tab) return { nonTrovata: true };
    const code = `chrome.runtime.sendMessage(${JSON.stringify(m)})`;
    return tab.view.webContents.executeJavaScriptInIsolatedWorld(mondo, [{ code }]);
  }, { h: host, m: msg, mondo: MONDO_CONTENT_SCRIPT });
}

test('la pagina salvata di un sito non arriva a un altro sito; la home la mostra con la miniatura', async ({ app, openTab, testServer }) => {
  const a = await testServer.openReady(
    openTab,
    `<!doctype html><html><head><title>${TITOLO_A}</title></head>
     <body style="margin:0;height:100vh;background:#2a6"><h1 style="color:#fff">Saldo</h1></body></html>`,
  );
  const urlA = a.url();
  await a.click('body', { button: 'right', position: { x: 400, y: 300 } });
  await a.locator('.sn-menu [data-sn-icon-id="saveForLater"]').click();
  await expect(a.locator('.sn-save-confirm')).toBeVisible();

  const home = await openTab('filo://home/home.html');
  await expect.poll(async () => home.evaluate(async () => {
    const r = await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.GET_SAVED_PAGES });
    return String(r?.pages?.[0]?.thumbnail || '').slice(0, 11);
  }), { timeout: 10_000 }).toBe('data:image/');
  // Il messaggio della home, calcolato qui, elenca la pagina A: lo stato di Filo ne terrebbe una copia (#589.12 giro 1).
  expect(await home.evaluate(async () => JSON.stringify(
    await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.FILO_GENERATE_DASHBOARD, force: true })))).toContain(TITOLO_A);

  const b = await testServer.openReady(openTab, '<!doctype html><html><body><p>sito B</p></body></html>', { pubblico: true });
  void b;
  const daB = dalSito(app, 'sito-pubblico.test');
  const M = await app.evaluate(() => globalThis.SN_MSG.MSG);
  const risposte = {
    elenco: await daB({ type: M.GET_SAVED_PAGES }),
    categorie: await daB({ type: M.GET_CATEGORIES }),
    stato: await daB({ type: M.FILO_GET_STATE }),
    togli: await daB({ type: M.REMOVE_SAVED_PAGE, id: 'inesistente' }),
    consuma: await daB({ type: M.CONSUME_SAVED_PAGE, id: 'inesistente' }),
    home: await daB({ type: M.FILO_GENERATE_DASHBOARD, force: true }),
    risalva: await daB({ type: M.SAVE_LINK, url: urlA, title: '' }),
  };
  expect(risposte.elenco).toMatchObject({ ok: false, error: 'forbidden' });
  expect(risposte.categorie).toMatchObject({ ok: false, error: 'forbidden' });
  expect(risposte.stato).toMatchObject({ ok: false, error: 'forbidden' });
  expect(risposte.togli).toMatchObject({ ok: false, error: 'forbidden' });
  expect(risposte.consuma).toMatchObject({ ok: false, error: 'forbidden' });
  expect(risposte.home).toMatchObject({ ok: false, error: 'forbidden' });
  expect(risposte.risalva.ok).toBe(true);
  expect(Object.keys(risposte.risalva.entry).sort()).toEqual(['category', 'id']);
  const tutto = JSON.stringify(risposte);
  expect(tutto).not.toContain('data:image');
  expect(tutto).not.toContain(TITOLO_A);
  expect(tutto).not.toContain(urlA);

  // La home, che l'elenco lo mostra, vede ancora la pagina A con titolo e miniatura.
  await home.reload();
  const card = home.locator('.sn-card', { hasText: TITOLO_A });
  await expect(card).toBeVisible();
  await expect(card.locator('.sn-card-thumb')).toHaveCSS('background-image', /^url\("data:image\//);
  await home.screenshot({ path: 'tests/.shots/pagine-salvate-verso-siti-home.png' });

  // Le impostazioni leggono elenco e categorie.
  const opzioni = await openTab('filo://options/options.html');
  const daOpzioni = await opzioni.evaluate(async () => {
    const MSG = window.SN_MSG.MSG;
    const [p, c] = await Promise.all([
      chrome.runtime.sendMessage({ type: MSG.GET_SAVED_PAGES }),
      chrome.runtime.sendMessage({ type: MSG.GET_CATEGORIES }),
    ]);
    return { ok: p.ok && c.ok, titoli: p.pages.map((x) => x.title) };
  });
  expect(daOpzioni.ok).toBe(true);
  expect(daOpzioni.titoli).toContain(TITOLO_A);
});
