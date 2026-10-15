// Verifica #1124 giro 3: esplorazione (Google vero, autofocus, cambio scheda, popup, tema scuro, SPA, shadow DOM).
import { writeFileSync, mkdirSync } from 'node:fs';
import { test, expect, aspettaFinestra } from '../../fixtures/electron.mjs';

const EMAIL = 'chi-usa-filo@example.com';

async function accountFinto(app, email = EMAIL) {
  await app.evaluate((_e, email) => {
    const M = process.getBuiltinModule('module');
    const ga = M._cache[Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x))].exports;
    ga.isSignedIn = () => !!email;
    ga.getProfile = () => (email ? { email, name: 'Chi', picture: '' } : null);
  }, email);
}

async function impostazioni(app, p) {
  await app.evaluate(async (_e, p) => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /services[\\/]handlers\.js$/.test(x));
    await M._cache[k].exports.applySettingsUpdate(p);
  }, p);
}

const mostrata = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  return !!w._filoTabs.propostaEmail.mostrata;
});

async function foto(app, nome) {
  const buf = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return (await w.capturePage()).toPNG().toString('base64');
  });
  mkdirSync('tests/.shots', { recursive: true });
  writeFileSync(`tests/.shots/${nome}.png`, Buffer.from(buf, 'base64'));
}

// Un clic vero (passa dalla coda d'ingresso della scheda), al centro di un elemento della pagina davanti.
async function clicVero(app, page, sel) {
  const r = await page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
  await app.evaluate(({ BrowserWindow }, r) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const tm = w._filoTabs;
    const wc = tm.tabs.find((x) => x.id === tm.activeId).view.webContents;
    wc.focus();
    wc.sendInputEvent({ type: 'mouseDown', x: Math.round(r.x), y: Math.round(r.y), button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: Math.round(r.x), y: Math.round(r.y), button: 'left', clickCount: 1 });
  }, r);
}

const vista = (app) => aspettaFinestra(app, (w) => w.url() === 'filo://shell/proposta-email.html', 'vista');

test('autofocus come Google: la proposta c\'è appena aperta o al primo clic nel campo', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, '<!doctype html><body style="padding:40px"><input type="email" id="e" autofocus style="width:300px;height:30px"></body>');
  await page.waitForTimeout(1500);
  console.log('autofocus, subito:', await mostrata(app));
  await clicVero(app, page, '#e');
  await expect.poll(() => mostrata(app), { timeout: 5000 }).toBe(true);
});

test('Google vero: il campo identificativo riceve la proposta e la scelta lo riempie', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await accountFinto(app);
  const page = await openTab('https://accounts.google.com/signin/v2/identifier?hl=it');
  await page.waitForSelector('#identifierId', { timeout: 30_000 });
  await page.waitForTimeout(1500);
  console.log('google, subito:', await mostrata(app));
  await clicVero(app, page, '#identifierId');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  await foto(app, 'giro3-google');
  const v = await vista(app);
  await page.waitForTimeout(600);
  await v.click('#voce');
  await expect.poll(() => page.inputValue('#identifierId')).toBe(EMAIL);
  await page.waitForTimeout(500);
  await foto(app, 'giro3-google-dopo');
});

test('cambio scheda: la proposta non resta sopra l\'altra scheda, e torna al ritorno', async ({ app, openTab, testServer, shell }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, '<!doctype html><body style="padding:40px"><input type="email" id="e" style="width:300px;height:30px"></body>');
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  const primo = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.activeId);
  await openTab(testServer.html('<!doctype html><body>altra</body>').replace('127.0.0.1', 'localhost'));
  await expect.poll(() => mostrata(app), { timeout: 4000 }).toBe(false);
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), primo);
  await page.waitForTimeout(1200);
  console.log('ritorno sulla scheda col campo a fuoco:', await mostrata(app), await page.evaluate(() => document.activeElement && document.activeElement.id));
});

test('popup di accesso aperto da window.open: la proposta compare anche lì', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const login = testServer.html('<!doctype html><body style="padding:30px"><input type="email" id="e" style="width:260px;height:30px"></body>').replace('127.0.0.1', 'localhost');
  const page = await testServer.openReady(openTab, `<!doctype html><body><button id="b" onclick="window.open('${login}','login','width=500,height=500')">Accedi</button></body>`);
  await page.click('#b');
  const pop = await aspettaFinestra(app, (w) => { try { return w.url() === login; } catch (_) { return false; } }, 'popup');
  await pop.waitForLoadState('domcontentloaded');
  await pop.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 }).catch(() => {});
  await pop.click('#e');
  const esito = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ tabs: !!w._filoTabs, url: w.webContents.getURL(), figli: w.contentView.children.length })));
  await page.waitForTimeout(1500);
  console.log('finestre:', JSON.stringify(await esito()));
  const vis = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w._filoTabs).map((w) => w.contentView.children.map((v) => ({ url: v.webContents.getURL(), vis: v.getVisible ? v.getVisible() : null, b: v.getBounds() }))));
  console.log('popup viste:', JSON.stringify(vis));
});

test('tema scuro e email lunga: foto', async ({ app, openTab, testServer }) => {
  const lunga = 'nome.cognome.molto.lungo.davvero.tantissimo@dominio-aziendale-esempio.example.com';
  await accountFinto(app, lunga);
  await impostazioni(app, { theme: 'dark' });
  const page = await testServer.openReady(openTab, '<!doctype html><body style="padding:40px;background:#222"><input type="email" id="e" style="width:200px;height:30px"><p style="color:#ddd">testo sotto il campo</p></body>');
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  await page.waitForTimeout(400);
  await foto(app, 'giro3-scuro-lunga');
  await impostazioni(app, { theme: 'light' });
  await page.waitForTimeout(600);
  await foto(app, 'giro3-chiaro-lunga');
});

test('passo di una SPA: il campo sostituito o la pagina che cambia portano via la proposta', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, '<!doctype html><body style="padding:40px"><div id="c"><input type="email" id="e" style="width:300px;height:30px"></div></body>');
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  await page.evaluate(() => { document.getElementById('c').innerHTML = '<input type="password" id="p">'; document.getElementById('p').focus(); });
  await expect.poll(() => mostrata(app), { timeout: 3000 }).toBe(false);
  await page.evaluate(() => { document.getElementById('c').innerHTML = '<input type="email" id="e2" style="width:300px;height:30px">'; });
  await page.click('#e2');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  await page.evaluate(() => { document.getElementById('e2').remove(); });
  await expect.poll(() => mostrata(app), { timeout: 3000 }).toBe(false);
});

test('campo dentro uno shadow root aperto', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:40px"><div id="h"></div><script>
    const s = document.getElementById('h').attachShadow({ mode: 'open' });
    s.innerHTML = '<input type="email" id="e" style="width:300px;height:30px">';
    window.ev = []; s.getElementById('e').addEventListener('input', (e) => window.ev.push(e.isTrusted));
  </script></body>`);
  await page.locator('#h').locator('#e').click();
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  const v = await vista(app);
  await page.waitForTimeout(600);
  await v.click('#voce');
  await expect.poll(() => page.locator('#h').locator('#e').inputValue()).toBe(EMAIL);
});
