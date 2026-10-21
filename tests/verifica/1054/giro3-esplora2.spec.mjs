// Esplorazione del giro 3 di #1054, seconda parte: altre strade del menu con lo strato acceso.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';

const pausa = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function pronto(app) {
  await paginaDelloStrato(app);
  await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
}

async function apriPagina(openTab, testServer, html, opts) {
  const page = await testServer.openReady(openTab, html, opts);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

const schede = (shell) => shell.evaluate(() => document.querySelectorAll('.tab').length);

test.use({ stratoDelMenu: true });

test('Apri in nuova tab da un collegamento', async ({ app, shell, openTab, testServer }) => {
  await pronto(app);
  const dest = testServer.html('<!doctype html><title>Dest</title>ok');
  const page = await apriPagina(openTab, testServer, `<!doctype html><body style="margin:40px"><a id="l" href="${dest}">vai di qua</a></body>`);
  await page.locator('#l').click({ button: 'right' });
  await expect(menuDi(page).principale).toBeVisible();
  const prima = await schede(shell);
  await menuDi(page).voce('Apri in nuova tab').click();
  await expect.poll(() => schede(shell), { timeout: 8000 }).toBeGreaterThan(prima);
});

test('Taglia in un campo toglie il testo e lo mette negli appunti', async ({ app, openTab, testServer }) => {
  await pronto(app);
  await app.evaluate(({ clipboard }) => clipboard.writeText('vecchio'));
  const page = await apriPagina(openTab, testServer, '<!doctype html><body style="margin:40px"><input id="c" value="ciao mondo" style="width:300px"></body>');
  await page.locator('#c').click();
  await page.evaluate(() => { const c = document.getElementById('c'); c.setSelectionRange(0, 4); });
  const b = await page.locator('#c').boundingBox();
  await page.mouse.click(b.x + 15, b.y + b.height / 2, { button: 'right' });
  await expect(menuDi(page).principale).toBeVisible();
  await menuDi(page).voce('Taglia').click();
  await expect.poll(() => page.locator('#c').inputValue()).toBe(' mondo');
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('ciao');
});

test('Shift+F10 in un campo apre il menu nello strato', async ({ app, openTab, testServer }) => {
  await pronto(app);
  const page = await apriPagina(openTab, testServer, '<!doctype html><body style="margin:40px"><textarea id="c">testo</textarea></body>');
  await page.locator('#c').click();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F10', modifiers: ['shift'] });
    t.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F10', modifiers: ['shift'] });
  });
  await expect.poll(async () => (await statoDelloStrato(app))?.aperto, { timeout: 5000 }).toBe(true);
  await expect(menuDi(page).locator('.sn-menu-paste-main')).toBeVisible();
  console.log('F10', JSON.stringify((await statoDelloStrato(app)).punto), JSON.stringify(await page.locator('#c').boundingBox()));
});

test('pagina ingrandita: il menu si apre sul punto del clic', async ({ app, openTab, testServer }) => {
  await pronto(app);
  const page = await apriPagina(openTab, testServer, '<!doctype html><body style="margin:0"><p id="p" style="position:absolute;left:300px;top:200px">qui</p></body>');
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.setZoomFactor(1.5);
  });
  await pausa(500);
  const b = await page.locator('#p').boundingBox();
  await page.mouse.click(b.x + 5, b.y + 5, { button: 'right' });
  await expect(menuDi(page).principale).toBeVisible();
  const m = await menuDi(page).principale.boundingBox();
  const z = await page.evaluate(() => window.devicePixelRatio);
  console.log('ZOOM', JSON.stringify({ click: [b.x + 5, b.y + 5], menu: m, dpr: z, stato: (await statoDelloStrato(app)).punto }));
  expect(Math.abs(m.x - (b.x + 5) * 1.5)).toBeLessThan(6);
  expect(Math.abs(m.y - (b.y + 5) * 1.5)).toBeLessThan(6);
});

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

test('finestrella aperta dal sito: il menu resta nel documento del sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await pronto(app);
  const FINTA = 'https://login.sito-finto.it/login';
  await servi(app, { 'login.sito-finto.it/login': '<title>Accedi</title><body style="margin:20px"><input id="pw" type="password" style="width:200px"></body>' });
  const page = await apriPagina(openTab, testServer, `<!doctype html><body style="margin:40px">
    <button id="b" style="width:200px;height:50px" onclick="window.open('${FINTA}', 'acc', 'width=500,height=400')">Accedi con</button></body>`);
  await page.locator('#b').click();
  let pop = null;
  await expect.poll(() => Boolean(pop = app.windows().find((w) => { try { return w.url() === FINTA; } catch (_) { return false; } })), { timeout: 8000 }).toBe(true);
  await pop.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const fin = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ tabs: !!w._filoTabs, url: w.webContents.getURL() })));
  console.log('FINESTRE', JSON.stringify(fin));
  await pop.locator('#pw').click({ button: 'right' });
  await pausa(1500);
  const nelSito = await pop.evaluate(() => {
    const trova = (r) => { if (r.querySelector('.sn-menu')) return true; for (const e of r.querySelectorAll('*')) if (e.shadowRoot && trova(e.shadowRoot)) return true; return false; };
    return { trovato: trova(document), testo: document.documentElement.innerText.slice(0, 400) };
  });
  console.log('MENU NEL SITO', JSON.stringify(nelSito), 'STRATO', JSON.stringify(await statoDelloStrato(app)));
  expect(nelSito.trovato, 'il menu è nel documento del sito').toBe(false);
});

test('finestrella del sito: la pagina legge la cronologia o preme Incolla', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await pronto(app);
  // Un Incolla vero altrove mette il segreto nella cronologia.
  await app.evaluate(({ clipboard }) => clipboard.writeText('codice-banca-77'));
  const banca = await apriPagina(openTab, testServer, '<!doctype html><title>Banca</title><input id="c">');
  await banca.locator('#c').click({ button: 'right' });
  await expect(menuDi(banca).principale).toBeVisible();
  await menuDi(banca).locator('.sn-menu-paste-main').click();
  await expect(banca.locator('#c')).toHaveValue('codice-banca-77');
  await app.evaluate(({ clipboard }) => clipboard.writeText('password-attuale'));

  const FINTA = 'https://login.sito-finto.it/login';
  await servi(app, { 'login.sito-finto.it/login': `<title>Accedi</title><body style="margin:20px"><input id="pw" style="width:200px"><script>
    window.__letti = [];
    const guarda = (radice) => new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) {
      window.__letti.push(n.textContent || ''); if (n.shadowRoot) guarda(n.shadowRoot); } })
      .observe(radice, { childList: true, subtree: true, characterData: true });
    guarda(document.documentElement);
    setInterval(() => { window.__letti.push(document.documentElement.innerText);
      for (const b of document.querySelectorAll('.sn-menu-paste-main')) { b.click(); b.dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); b.dispatchEvent(new MouseEvent('mouseup', {bubbles:true})); b.dispatchEvent(new MouseEvent('click', {bubbles:true})); } }, 50);
  </script></body>` });
  const page = await apriPagina(openTab, testServer, `<!doctype html><body style="margin:40px">
    <button id="b" style="width:200px;height:50px" onclick="window.open('${FINTA}', 'acc', 'width=500,height=400')">Accedi con</button></body>`);
  await page.locator('#b').click();
  let pop = null;
  await expect.poll(() => Boolean(pop = app.windows().find((w) => { try { return w.url() === FINTA; } catch (_) { return false; } })), { timeout: 8000 }).toBe(true);
  await pop.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await pop.locator('#pw').click({ button: 'right' });
  await pausa(1000);
  // L'utente passa sulla freccia della cronologia.
  const freccia = pop.locator('.sn-menu-paste-arrow');
  console.log('FRECCIA', await freccia.count());
  if (await freccia.count()) { await freccia.first().hover(); await pausa(1500); }
  const esito = await pop.evaluate(() => ({ campo: document.getElementById('pw').value, letti: window.__letti.join(' | ').slice(-3000) }));
  console.log('ESITO', JSON.stringify({ campo: esito.campo, cronologia: esito.letti.includes('codice-banca-77'), password: esito.letti.includes('password-attuale') }));
  console.log('LETTI', esito.letti.slice(-800));
});
