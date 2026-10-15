// L'email dell'account proposta sotto i campi di accesso dei siti (#1124): compare entrando nel campo, la scelta
// (clic o freccia giù e Invio) lo riempie con un `input` vero, e prima della scelta la pagina non la trova da nessuna parte.
// Niente campo password nelle pagine: su http l'avviso del sito sospetto coprirebbe la scheda, e la proposta con lei.
import { test, expect, aspettaFinestra } from './fixtures/electron.mjs';
import { menuAperto, vociDelMenu, scegliNelMenu } from './helpers/barra.mjs';

const EMAIL = 'chi-usa-filo@example.com';

const PAGINA = `<!doctype html><html><head><title>Accedi</title></head>
<body style="margin:0;padding:40px;font-family:sans-serif">
  <form onsubmit="return false"><input type="email" id="e" name="email" style="width:320px;height:32px;box-sizing:border-box"></form>
  <p><input type="search" id="cerca" placeholder="Cerca"></p>
  <p><input type="text" id="altro" name="citta"></p>
  <script>
    window.eventi = [];
    window.tasti = [];
    window.vistoNelDom = false;
    const e = document.getElementById('e');
    e.addEventListener('input', (ev) => window.eventi.push({ tipo: 'input', vero: ev.isTrusted, valore: e.value }));
    e.addEventListener('change', () => window.eventi.push({ tipo: 'change', valore: e.value }));
    document.addEventListener('keydown', (ev) => window.tasti.push(ev.key), true);
    // L'ago si compone qui: scritto per intero starebbe nel testo di questo script, e l'outerHTML lo troverebbe sempre.
    const ago = String.fromCharCode(64) + 'example' + '.com';
    new MutationObserver(() => { if (document.documentElement.outerHTML.includes(ago)) window.vistoNelDom = true; })
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

// La proposta vista dal main: a schermo, dove, se sta sopra la scheda e gli avvisi (sopra di lei solo la barra
// laterale e la conferma), e i bordi della scheda davanti.
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
      inCima: !!p.vista && figli.slice(figli.indexOf(p.vista) + 1).every((v) => v === tm.barra.vista || v === tm.conferme.vista),
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
  await page.click('#cerca');
  await page.waitForTimeout(500);
  expect(await mostrata(app), 'una casella di ricerca non chiede l\'email').toBe(false);
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

// Un modulo di accesso servito da un altro indirizzo: il suo frame non sa dove sta il riquadro, glielo dice la pagina.
const RIQUADRO = '<!doctype html><body style="margin:0;padding:20px"><input id="u" type="email" style="width:260px;height:30px"></body>';
const altraOrigine = (url) => url.replace('127.0.0.1', 'localhost');

async function sottoIlCampoDelRiquadro(app, page, misura) {
  const s = await stato(app);
  const r = await page.evaluate(misura);
  return { dx: Math.abs(s.bounds.x - (s.scheda.x + r.left * s.zoom)), dy: Math.abs(s.bounds.y - (s.scheda.y + r.bottom * s.zoom)) };
}

test('in un riquadro di un\'altra origine la proposta sta sotto il campo, segue la pagina e la scelta lo riempie', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const dentro = altraOrigine(testServer.html(RIQUADRO));
  const page = await testServer.openReady(openTab, `<!doctype html><body style="margin:0;padding:30px;height:3000px">
    <iframe id="r" src="${dentro}" style="margin-left:100px;margin-top:60px;width:400px;height:200px;border:5px solid #ccc;padding:3px"></iframe></body>`);
  const riquadro = page.frameLocator('#r');
  await riquadro.locator('#u').click();
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  // Il campo sta a 20px dal bordo interno del riquadro, e il riquadro ha bordo e spaziatura.
  const misura = () => {
    const f = document.getElementById('r').getBoundingClientRect();
    return { left: f.left + 5 + 3 + 20, bottom: f.top + 5 + 3 + 20 + 30 };
  };
  let d = await sottoIlCampoDelRiquadro(app, page, misura);
  expect(d.dx).toBeLessThanOrEqual(1);
  expect(d.dy).toBeLessThanOrEqual(4);

  await page.evaluate(() => window.scrollBy(0, 25));
  await expect.poll(async () => (await sottoIlCampoDelRiquadro(app, page, misura)).dy, { timeout: 3000 }).toBeLessThanOrEqual(4);

  const vista = await vistaProposta(app);
  await expect(vista.locator('#email')).toHaveText(EMAIL);
  expect(await page.evaluate((e) => document.documentElement.outerHTML.includes(e), EMAIL)).toBe(false);
  expect(await riquadro.locator('#u').inputValue()).toBe('');
  await page.waitForTimeout(600);
  await vista.click('#voce');
  await expect.poll(() => riquadro.locator('#u').inputValue()).toBe(EMAIL);
  await expect.poll(() => mostrata(app)).toBe(false);
});

test('in un riquadro di un\'altra origine dentro un altro riquadro di un\'altra origine la proposta sta sotto il campo', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const interno = testServer.html(RIQUADRO);
  const medio = altraOrigine(testServer.html(`<!doctype html><body style="margin:0;padding:10px">
    <iframe id="i" src="${interno}" style="margin-left:40px;width:340px;height:120px;border:2px solid #999"></iframe></body>`));
  const page = await testServer.openReady(openTab, `<!doctype html><body style="margin:0;padding:30px">
    <iframe id="r" src="${medio}" style="margin-left:50px;width:500px;height:220px;border:5px solid #ccc"></iframe></body>`);
  await page.frameLocator('#r').frameLocator('#i').locator('#u').click();
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  const d = await sottoIlCampoDelRiquadro(app, page, () => {
    const f = document.getElementById('r').getBoundingClientRect();
    return { left: f.left + 5 + 10 + 40 + 2 + 20, bottom: f.top + 5 + 10 + 2 + 20 + 30 };
  });
  expect(d.dx).toBeLessThanOrEqual(1);
  expect(d.dy).toBeLessThanOrEqual(4);
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
      // In Privacy ogni sito non fidato ha una sessione effimera sua: non è incognito.
      sessioneDelSito: P.ammessa(mittente({ wc: { session: { isPersistent: () => false } } }), {}),
      paginaDiFilo: P.ammessa(mittente({ url: 'filo://home/home.html', frame: { url: 'filo://home/home.html' } }), {}),
      file: P.ammessa(mittente({ frame: { url: 'file:///tmp/a.html' } }), {}),
    };
  });
  expect(esiti).toEqual({ normale: true, spenta: false, incognito: false, incognitoChiesta: true, sessioneDelSito: true, paginaDiFilo: false, file: false });
});

test('nella finestra in incognito niente proposta, finché l\'utente non la chiede anche lì', async ({ app, shell, testServer }) => {
  await accountFinto(app);
  await shell.evaluate(() => window.filoShell.openIncognito());
  const inIncognito = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    return w && w._filoTabs ? { schede: w._filoTabs.tabs.length, mostrata: !!w._filoTabs.propostaEmail.mostrata } : { schede: 0, mostrata: false };
  });
  await expect.poll(async () => (await inIncognito()).schede, { timeout: 15_000 }).toBe(1);
  const url = testServer.html(PAGINA);
  await app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows().find((x) => x._filoIncognito)._filoTabs.openTab(u), url);
  let page = null;
  await expect.poll(async () => {
    page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } }) || null;
    return page ? page.evaluate(() => document.documentElement.dataset.filoReady === '1').catch(() => false) : false;
  }, { timeout: 10_000 }).toBe(true);

  await page.click('#e');
  await page.waitForTimeout(800);
  expect((await inIncognito()).mostrata).toBe(false);

  await impostazioni(app, { propostaEmail: { incognito: true } });
  await page.click('#altro');
  await page.click('#e');
  await expect.poll(async () => (await inIncognito()).mostrata, { timeout: 8000 }).toBe(true);
});

const leggiOpzioni = (app) => app.evaluate(async () => ((await globalThis.SN_STORAGE.getSettings()) || {}).propostaEmail || null);

test('col tasto destro sulla proposta si inserisce l\'email o la si spegne', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  const vista = await vistaProposta(app);

  await vista.click('#voce', { button: 'right' });
  let menu = await menuAperto(app);
  expect(menu).not.toBeNull();
  expect(await vociDelMenu(menu)).toEqual(['Inserisci l\'email', 'Non propormela più']);
  await scegliNelMenu(menu, 'Inserisci');
  await expect.poll(() => page.inputValue('#e')).toBe(EMAIL);

  await page.fill('#e', '');
  await page.click('#altro');
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  await vista.click('#voce', { button: 'right' });
  menu = await menuAperto(app);
  await scegliNelMenu(menu, 'Non propormela');
  await expect.poll(() => leggiOpzioni(app)).toMatchObject({ attiva: false });
  await expect.poll(() => mostrata(app)).toBe(false);
});

test('in Preferenze, nelle impostazioni avanzate, la proposta si spegne e si riaccende', async ({ app, openTab }) => {
  const pref = await openTab('filo://preferences/preferences.html');
  const attiva = pref.locator('#sec-advanced #sec-proposta-email #propostaEmailAttiva');
  const incognito = pref.locator('#sec-advanced #sec-proposta-email #propostaEmailIncognito');
  await expect(attiva).toBeChecked();
  await expect(incognito).not.toBeChecked();
  await attiva.uncheck();
  await expect.poll(() => leggiOpzioni(app)).toMatchObject({ attiva: false });
  await expect(incognito).toBeDisabled();
  await attiva.check();
  await incognito.check();
  await expect.poll(() => leggiOpzioni(app)).toMatchObject({ attiva: true, incognito: true });
});
