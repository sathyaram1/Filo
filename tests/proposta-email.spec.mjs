// L'email dell'account proposta sotto i campi di accesso dei siti (#1124): compare entrando nel campo, la scelta
// (clic o freccia giù e Invio) lo riempie con un `input` vero, e prima della scelta la pagina non la trova da nessuna parte.
import { test, expect, aspettaFinestra } from './fixtures/electron.mjs';

const EMAIL = 'chi-usa-filo@example.com';

const PAGINA = `<!doctype html><html><head><title>Accedi</title></head>
<body style="margin:0;padding:40px;font-family:sans-serif">
  <form onsubmit="return false"><input type="email" id="e" name="email" style="width:320px;height:32px;box-sizing:border-box"></form>
  <p><input type="password" id="pw"></p>
  <p><input type="text" id="altro" name="citta"></p>
  <script>
    window.eventi = [];
    window.tasti = [];
    window.vistoNelDom = false;
    const e = document.getElementById('e');
    e.addEventListener('input', (ev) => window.eventi.push({ tipo: 'input', vero: ev.isTrusted, valore: e.value }));
    e.addEventListener('change', () => window.eventi.push({ tipo: 'change', valore: e.value }));
    document.addEventListener('keydown', (ev) => window.tasti.push(ev.key), true);
    new MutationObserver(() => { if (document.documentElement.outerHTML.includes('@example.com')) window.vistoNelDom = true; })
      .observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  </script>
</body></html>`;

async function accountFinto(app, email = EMAIL) {
  await app.evaluate((_e, email) => {
    const M = process.getBuiltinModule('module');
    const ga = M._cache[Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x))].exports;
    ga.isSignedIn = () => !!email;
    ga.getProfile = () => (email ? { email, name: 'Chi Usa Filo', picture: '' } : null);
  }, email);
}

async function impostazioni(app, parziale) {
  await app.evaluate(async (_e, p) => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /services[\\/]handlers\.js$/.test(x));
    await M._cache[k].exports.applySettingsUpdate(p);
  }, parziale);
}

// La proposta vista dal main: a schermo, dove, se è la vista in cima, e i bordi della scheda davanti.
function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const p = tm.propostaEmail;
    const figli = w.contentView.children;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return {
      mostrata: !!p.mostrata,
      bounds: p.vista ? p.vista.getBounds() : null,
      inCima: !!p.vista && figli[figli.length - 1] === p.vista,
      scheda: t ? t.view.getBounds() : null,
      zoom: t ? t.view.webContents.getZoomFactor() : 1,
    };
  });
}

const mostrata = async (app) => (await stato(app)).mostrata;

// Un tasto come dalla tastiera vera, alla scheda davanti: passa da before-input-event come quelli dell'utente.
async function tasto(app, keyCode) {
  await app.evaluate(({ BrowserWindow }, k) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const wc = tm.tabs.find((x) => x.id === tm.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: k });
    wc.sendInputEvent({ type: 'keyUp', keyCode: k });
  }, keyCode);
}

const vistaProposta = (app) => aspettaFinestra(app, (w) => w.url() === 'filo://shell/proposta-email.html', 'la vista della proposta non è nata');

async function nonLaTrova(page) {
  return page.evaluate((e) => ({
    html: document.documentElement.outerHTML.includes(e),
    testo: document.body.innerText.includes(e),
    find: window.find(e),
    osservata: window.vistoNelDom,
    campo: document.getElementById('e').value,
  }), EMAIL);
}

test('entrando nel campo email compare l\'email dell\'account, e un clic la scrive con un input vero', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);

  const s = await stato(app);
  const r = await page.evaluate(() => { const b = document.getElementById('e').getBoundingClientRect(); return { left: b.left, bottom: b.bottom, width: b.width }; });
  expect(s.inCima).toBe(true);
  expect(Math.abs(s.bounds.x - (s.scheda.x + r.left * s.zoom))).toBeLessThanOrEqual(1);
  expect(s.bounds.y).toBeGreaterThanOrEqual(Math.floor(s.scheda.y + r.bottom * s.zoom));
  expect(s.bounds.y).toBeLessThanOrEqual(Math.ceil(s.scheda.y + r.bottom * s.zoom) + 6);
  expect(s.bounds.width).toBeGreaterThanOrEqual(Math.floor(r.width * s.zoom));

  const vista = await vistaProposta(app);
  await expect(vista.locator('#email')).toHaveText(EMAIL);
  await vista.screenshot({ path: 'tests/.shots/proposta-email-chiaro.png' });
  expect(await nonLaTrova(page)).toEqual({ html: false, testo: false, find: false, osservata: false, campo: '' });

  // Mezzo secondo dopo la comparsa il clic vale (prima no: la pagina può farla comparire sotto il cursore).
  await page.waitForTimeout(600);
  await vista.click('#voce');
  await expect.poll(() => page.inputValue('#e')).toBe(EMAIL);
  const eventi = await page.evaluate(() => window.eventi);
  expect(eventi).toContainEqual({ tipo: 'input', vero: true, valore: EMAIL });
  expect(eventi).toContainEqual({ tipo: 'change', valore: EMAIL });
  await expect.poll(() => mostrata(app)).toBe(false);
});

test('freccia giù e Invio scelgono l\'email; la pagina non riceve quei tasti', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  const vista = await vistaProposta(app);

  await tasto(app, 'Down');
  await expect(vista.locator('#voce')).toHaveClass(/attiva/);
  await tasto(app, 'Return');
  await expect.poll(() => page.inputValue('#e')).toBe(EMAIL);
  const tasti = await page.evaluate(() => window.tasti);
  expect(tasti).not.toContain('ArrowDown');
  expect(tasti).not.toContain('Enter');
  await expect.poll(() => mostrata(app)).toBe(false);
});

test('l\'inizio scritto dall\'utente la tiene, un altro testo o un valore messo dalla pagina la tolgono; Esc la chiude', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);

  await page.keyboard.type('chi-u');
  await page.waitForTimeout(400);
  expect(await mostrata(app)).toBe(true);
  await page.keyboard.type('zz');
  await expect.poll(() => mostrata(app)).toBe(false);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await expect.poll(() => mostrata(app)).toBe(true);

  // Un prefisso scritto dalla pagina non è un indizio dell'utente: niente proposta, se no la pagina interrogherebbe.
  await page.evaluate(() => { document.getElementById('e').value = 'chi'; });
  await expect.poll(() => mostrata(app)).toBe(false);
  await page.evaluate(() => { document.getElementById('e').value = ''; });
  await expect.poll(() => mostrata(app)).toBe(true);

  await tasto(app, 'Escape');
  await expect.poll(() => mostrata(app)).toBe(false);
  expect(await page.evaluate(() => window.tasti)).not.toContain('Escape');
  await page.keyboard.type('c');
  await page.waitForTimeout(400);
  expect(await mostrata(app), 'chiusa con Esc resta chiusa finché non si rientra nel campo').toBe(false);

  await page.click('#altro');
  await page.click('#e');
  await expect.poll(() => mostrata(app)).toBe(true);
  await page.click('#altro');
  await expect.poll(() => mostrata(app)).toBe(false);
  await page.click('#pw');
  await page.waitForTimeout(500);
  expect(await mostrata(app), 'una password non è un campo di accesso da riempire con l\'email').toBe(false);
  expect(await nonLaTrova(page)).toMatchObject({ html: false, find: false, osservata: false });
});

test('con l\'interruttore spento, o senza account, non compare niente; spegnerlo toglie quella a schermo', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  await impostazioni(app, { propostaEmail: { attiva: false } });
  await expect.poll(() => mostrata(app)).toBe(false);

  await page.click('#altro');
  await page.click('#e');
  await page.waitForTimeout(800);
  expect(await mostrata(app)).toBe(false);

  await impostazioni(app, { propostaEmail: { attiva: true } });
  await accountFinto(app, '');
  await page.click('#altro');
  await page.click('#e');
  await page.waitForTimeout(800);
  expect(await mostrata(app)).toBe(false);
  expect(await nonLaTrova(page)).toMatchObject({ html: false, find: false, osservata: false });
});

test('in un riquadro della stessa origine la proposta sta sotto il campo del riquadro', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const dentro = testServer.html('<!doctype html><body style="margin:0;padding:20px"><input id="u" name="username" style="width:260px;height:30px"></body>');
  const page = await testServer.openReady(openTab, `<!doctype html><body style="margin:0;padding:30px">
    <iframe id="r" src="${dentro}" style="margin-left:100px;margin-top:60px;width:400px;height:200px;border:5px solid #ccc"></iframe></body>`);
  const riquadro = page.frameLocator('#r');
  await riquadro.locator('#u').click();
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  const s = await stato(app);
  const r = await page.evaluate(() => {
    const f = document.getElementById('r');
    const fb = f.getBoundingClientRect();
    const u = f.contentDocument.getElementById('u').getBoundingClientRect();
    return { left: fb.left + f.clientLeft + u.left, bottom: fb.top + f.clientTop + u.bottom };
  });
  expect(Math.abs(s.bounds.x - (s.scheda.x + r.left * s.zoom))).toBeLessThanOrEqual(1);
  expect(Math.abs(s.bounds.y - (s.scheda.y + r.bottom * s.zoom))).toBeLessThanOrEqual(4);

  const vista = await vistaProposta(app);
  await page.waitForTimeout(600);
  await vista.click('#voce');
  await expect.poll(() => riquadro.locator('#u').inputValue()).toBe(EMAIL);
});

test('in incognito si propone solo se l\'utente l\'ha chiesto, e mai sulle pagine di Filo', async ({ app }) => {
  const esiti = await app.evaluate(() => {
    const M = process.getBuiltinModule('module');
    const P = M._cache[Object.keys(M._cache).find((x) => /src[\\/]main[\\/]propostaEmail\.js$/.test(x))].exports._test;
    const mittente = (o) => ({ url: 'https://sito.example/', isIncognito: false, frame: { url: 'https://sito.example/login' },
      wc: { session: { isPersistent: () => true } }, ...o });
    return {
      normale: P.ammessa(mittente({}), {}),
      spenta: P.ammessa(mittente({}), { propostaEmail: { attiva: false } }),
      incognito: P.ammessa(mittente({ isIncognito: true }), {}),
      incognitoChiesta: P.ammessa(mittente({ isIncognito: true }), { propostaEmail: { incognito: true } }),
      popupIncognito: P.ammessa(mittente({ wc: { session: { isPersistent: () => false } } }), {}),
      paginaDiFilo: P.ammessa(mittente({ url: 'filo://home/home.html', frame: { url: 'filo://home/home.html' } }), {}),
      file: P.ammessa(mittente({ frame: { url: 'file:///tmp/a.html' } }), {}),
    };
  });
  expect(esiti).toEqual({ normale: true, spenta: false, incognito: false, incognitoChiesta: true, popupIncognito: false, paginaDiFilo: false, file: false });
});
