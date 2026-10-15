// Esplorazione del giro 2 di #1124: strade e stress attorno alla proposta dell'email.
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

async function impostazioni(app, parziale) {
  await app.evaluate(async (_e, p) => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /services[\\/]handlers\.js$/.test(x));
    await M._cache[k].exports.applySettingsUpdate(p);
  }, parziale);
}

const mostrata = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  return !!w._filoTabs.propostaEmail.mostrata;
});
const vistaProposta = (app) => aspettaFinestra(app, (w) => w.url() === 'filo://shell/proposta-email.html', 'vista');

const CAMPO = (attr) => `<!doctype html><body style="margin:0;padding:40px"><form onsubmit="window.inviato=true;return false">
  ${attr}<p><input id="altro" name="citta"></p><button id="b">Avanti</button></form></body>`;

test('tipi di campo dei siti veri', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const casi = {
    google: '<input type="email" id="identifierId" name="identifier" autocomplete="username webauthn" aria-label="Indirizzo email o numero di telefono">',
    microsoft: '<input type="email" name="loginfmt" id="i0116" placeholder="Email, phone, or Skype">',
    github: '<input type="text" name="login" id="login_field" autocomplete="username">',
    x: '<input autocomplete="username" name="text" type="text" autocapitalize="sentences">',
    apple: '<label for="account_name_text_field">Email or Phone Number</label><input type="text" id="account_name_text_field" autocomplete="off">',
    ariaLabelledby: '<span id="lb">Email address</span><input type="text" id="campo" aria-labelledby="lb">',
    floatingDiv: '<div class="f"><div class="lbl">Email</div><input type="text" id="campo2" name="f1"></div>',
  };
  const esiti = {};
  for (const [nome, html] of Object.entries(casi)) {
    const page = await testServer.openReady(openTab, CAMPO(html));
    await page.locator('input').first().click();
    let ok = false;
    try { await expect.poll(() => mostrata(app), { timeout: 3000 }).toBe(true); ok = true; } catch (_) {}
    esiti[nome] = ok;
    await page.click('body', { position: { x: 600, y: 400 } });
    await expect.poll(() => mostrata(app)).toBe(false);
  }
  console.log('ESITI', JSON.stringify(esiti));
});

test('cambio scheda, ritorno, barra indirizzi', async ({ app, openTab, testServer, shell }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, CAMPO('<input type="email" id="e">'));
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  const ids = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()));
  console.log('SNAP', JSON.stringify(ids).slice(0, 300));
  const p2 = await testServer.openReady(openTab, '<!doctype html><body>altra</body>');
  await page.waitForTimeout(800);
  console.log('dopo nuova scheda', await mostrata(app));
  // Ritorno con Ctrl+Tab dalla shell
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const tabs = snap.tabs || snap;
  const prima = tabs.find((t) => String(t.url || '').includes(new URL(page.url()).pathname));
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), prima.id);
  await page.waitForTimeout(1200);
  console.log('ritorno', await mostrata(app), await page.evaluate(() => document.activeElement && document.activeElement.id));
  await page.click('#altro');
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  await shell.click('#address, #url, input[type=text]', { timeout: 3000 }).catch((e) => console.log('niente barra', e.message));
  await page.waitForTimeout(800);
  console.log('dopo barra indirizzi', await mostrata(app));
  void p2;
});

test('scroll fuori vista, Invio senza freccia, campo nascosto, focus da script', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, `<!doctype html><body style="margin:0;padding:40px;height:4000px">
    <form onsubmit="window.inviato=true;return false"><input type="email" id="e"><button>Vai</button></form>
    <input type="email" id="nascosto" style="opacity:0;position:absolute;left:300px;top:300px;width:200px;height:30px">
    <input type="email" id="piccolo" style="position:absolute;left:300px;top:500px;width:1px;height:1px;border:0;padding:0">
  </body>`);
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  console.log('invio: inviato', await page.evaluate(() => window.inviato), 'mostrata', await mostrata(app));
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 2000));
  await page.waitForTimeout(800);
  console.log('scroll via', await mostrata(app));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
  console.log('scroll indietro', await mostrata(app));
  await page.evaluate(() => document.getElementById('nascosto').focus());
  await page.waitForTimeout(1000);
  console.log('opacity0 focus da script', await mostrata(app));
  await page.evaluate(() => document.getElementById('piccolo').focus());
  await page.waitForTimeout(1000);
  console.log('1px focus da script', await mostrata(app));
});

test('tema scuro e email lunga', async ({ app, openTab, testServer }) => {
  await accountFinto(app, 'nome.cognome.molto.lungo.davvero.lunghissimo+filtro@sottodominio.azienda-esempio.example.com');
  await impostazioni(app, { theme: 'dark' });
  const page = await testServer.openReady(openTab, CAMPO('<input type="email" id="e" style="width:120px">'));
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  const vista = await vistaProposta(app);
  await page.waitForTimeout(500);
  await vista.screenshot({ path: 'tests/.shots/v1124-scuro.png' });
  const b = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.propostaEmail.vista.getBounds());
  console.log('BOUNDS', JSON.stringify(b));
  const w = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).getContentBounds());
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const img = await win.webContents.capturePage();
    return img.toPNG().toString('base64');
  });
  const fs = await import('node:fs');
  fs.writeFileSync('tests/.shots/v1124-scuro-shell.png', Buffer.from(png, 'base64'));
  console.log('WIN', JSON.stringify(w));
  await impostazioni(app, { propostaEmail: { attiva: false } });
  const opz = await app.evaluate(async () => ((await globalThis.SN_STORAGE.getSettings()) || {}).propostaEmail);
  console.log('OPZ', JSON.stringify(opz));
});

test('popup di accesso aperto con window.open', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const dentro = testServer.html(CAMPO('<input type="email" id="e">'));
  const page = await testServer.openReady(openTab, `<!doctype html><body><button id="a" onclick="window.open('${dentro}','login','width=500,height=600')">Accedi con</button></body>`);
  await page.click('#a');
  await page.waitForTimeout(2500);
  const info = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ tabs: !!w._filoTabs, url: w.webContents.getURL() })));
  console.log('FINESTRE', JSON.stringify(info));
  const pop = app.windows().find((w) => { try { return w.url() === dentro; } catch (_) { return false; } });
  if (!pop) { console.log('nessun popup'); return; }
  await pop.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 }).catch(() => console.log('popup non pronto'));
  await pop.click('#e');
  await pop.waitForTimeout(1500);
  const st = await app.evaluate(({ BrowserWindow }) => {
    const out = [];
    for (const w of BrowserWindow.getAllWindows()) {
      const v = w.contentView.children.find((c) => c.webContents && c.webContents.getURL() === 'filo://shell/proposta-email.html');
      if (v) out.push({ tabs: !!w._filoTabs, bounds: v.getBounds(), visibile: v.getVisible ? v.getVisible() : null });
    }
    return out;
  });
  console.log('POPUP PROPOSTA', JSON.stringify(st));
});
