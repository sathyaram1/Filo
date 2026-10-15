// Esplorazione del giro 4 di #1124: strade dell'utente non coperte dallo spec della funzione.
import { test, expect, aspettaFinestra } from '../../fixtures/electron.mjs';

const EMAIL = 'chi-usa-filo@example.com';

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

function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const p = tm.propostaEmail;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return {
      mostrata: !!p.mostrata,
      bounds: p.vista ? p.vista.getBounds() : null,
      scheda: t ? t.view.getBounds() : null,
      zoom: t ? t.view.webContents.getZoomFactor() : 1,
    };
  });
}
const mostrata = async (app) => (await stato(app)).mostrata;

async function tasto(app, keyCode) {
  await app.evaluate(({ BrowserWindow }, k) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const wc = tm.tabs.find((x) => x.id === tm.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: k });
    wc.sendInputEvent({ type: 'keyUp', keyCode: k });
  }, keyCode);
}

// Un clic come quello del mouse vero: la scheda prende la tastiera, poi giù e su nel punto.
async function clicVero(app, page, sel) {
  const r = await page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
  await app.evaluate(({ BrowserWindow }, r) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const wc = tm.tabs.find((x) => x.id === tm.activeId).view.webContents;
    const z = wc.getZoomFactor();
    wc.focus();
    const x = Math.round(r.x * z); const y = Math.round(r.y * z);
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  }, r);
}

const vistaProposta = (app) => aspettaFinestra(app, (w) => w.url() === 'filo://shell/proposta-email.html', 'la vista della proposta non è nata');

const DUE = `<!doctype html><html><body style="margin:0;padding:40px;font-family:sans-serif">
  <input id="u" name="username" style="width:300px;height:30px"><br><br>
  <input id="e" type="email" style="width:300px;height:30px"><br><br>
  <input id="n" name="citta" style="width:300px;height:30px">
  <div style="height:2000px"></div>
</body></html>`;

test('esc e poi clic sullo stesso campo: la proposta torna', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, DUE);
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  await tasto(app, 'Escape');
  await expect.poll(() => mostrata(app)).toBe(false);
  await clicVero(app, page, '#e');
  await page.waitForTimeout(1200);
  expect(await mostrata(app), 'clic sul campo già a fuoco dopo Esc').toBe(true);
});

test('pagina con autofocus aperta con la tastiera nella barra: il clic sul campo mostra la proposta', async ({ app, openTab, testServer, shell }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, `<!doctype html><body style="margin:0;padding:40px">
    <input id="e" type="email" autocomplete="username webauthn" autofocus style="width:300px;height:30px"></body>`);
  // La tastiera alla barra, come dopo aver scritto l'indirizzo.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).webContents.focus());
  await page.reload();
  await page.waitForTimeout(1500);
  const prima = await mostrata(app);
  await clicVero(app, page, '#e');
  await page.waitForTimeout(1500);
  const dopo = await mostrata(app);
  console.log('autofocus: prima del clic', prima, 'dopo', dopo, 'attivo', await page.evaluate(() => document.activeElement.id));
  expect(dopo).toBe(true);
});

test('tab fra i campi: la proposta passa al campo nuovo e sparisce sul campo che non è di accesso', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, DUE);
  await page.click('#u');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  const y1 = (await stato(app)).bounds.y;
  await tasto(app, 'Tab');
  await expect.poll(async () => { const s = await stato(app); return s.mostrata && s.bounds.y > y1 + 20; }, { timeout: 4000 }).toBe(true);
  await tasto(app, 'Tab');
  await expect.poll(() => mostrata(app), { timeout: 4000 }).toBe(false);
});

test('il campo tolto dalla pagina (passo successivo di un accesso) porta via la proposta', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, DUE);
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  await page.evaluate(() => document.getElementById('e').remove());
  await expect.poll(() => mostrata(app), { timeout: 3000 }).toBe(false);
});

test('campo nascosto dalla pagina mentre ha il fuoco: la proposta va via', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, DUE);
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  await page.evaluate(() => { document.getElementById('e').style.visibility = 'hidden'; });
  await page.waitForTimeout(1500);
  console.log('visibility hidden: mostrata', await mostrata(app), 'attivo', await page.evaluate(() => document.activeElement.id));
});

test('con lo zoom al 150% la proposta sta sotto il campo', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, DUE);
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    tm.tabs.find((x) => x.id === tm.activeId).view.webContents.setZoomFactor(1.5);
  });
  await page.waitForTimeout(500);
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  const s = await stato(app);
  const r = await page.evaluate(() => { const b = document.getElementById('e').getBoundingClientRect(); return { left: b.left, bottom: b.bottom }; });
  expect(Math.abs(s.bounds.x - (s.scheda.x + r.left * s.zoom))).toBeLessThanOrEqual(2);
  expect(Math.abs(s.bounds.y - (s.scheda.y + r.bottom * s.zoom))).toBeLessThanOrEqual(5);
});

test('campo in fondo alla finestra: la proposta sale sopra senza coprirlo', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, `<!doctype html><body style="margin:0">
    <input id="e" type="email" style="position:fixed;bottom:4px;left:40px;width:300px;height:30px"></body>`);
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  const s = await stato(app);
  const r = await page.evaluate(() => { const b = document.getElementById('e').getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; });
  expect(s.bounds.y + s.bounds.height).toBeLessThanOrEqual(Math.ceil(s.scheda.y + r.top * s.zoom) + 1);
});

test('email lunghissima e tema scuro: screenshot', async ({ app, openTab, testServer }) => {
  const lunga = 'nome.cognome.molto.lungo.davvero.lunghissimo+filo-prove@sottodominio.esempio-di-dominio-lungo.example.com';
  await accountFinto(app, lunga);
  await impostazioni(app, { theme: 'dark' });
  const page = await testServer.openReady(openTab, DUE);
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  const vista = await vistaProposta(app);
  await page.waitForTimeout(300);
  await vista.screenshot({ path: 'tests/.shots/1124-g4-lunga-scuro.png' });
  const m = await vista.evaluate(() => {
    const e = document.getElementById('email');
    return { sw: e.scrollWidth, cw: e.clientWidth, w: innerWidth, rw: document.getElementById('riquadro').getBoundingClientRect().width, title: e.title || document.getElementById('voce').title };
  });
  console.log('lunga', JSON.stringify(m), JSON.stringify((await stato(app)).bounds));
  await vista.hover('#voce');
  await page.waitForTimeout(300);
  await vista.screenshot({ path: 'tests/.shots/1124-g4-lunga-scuro-hover.png' });
  await impostazioni(app, { theme: 'light' });
  await page.waitForTimeout(500);
  await vista.screenshot({ path: 'tests/.shots/1124-g4-lunga-chiaro-hover.png' });
  // La scheda con la proposta sopra, come la vede l'utente.
  const img = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    const a = await t.view.webContents.capturePage();
    const b = await tm.propostaEmail.vista.webContents.capturePage();
    return { a: a.toDataURL(), b: b.toDataURL(), sb: t.view.getBounds(), pb: tm.propostaEmail.vista.getBounds() };
  });
  const fs = await import('node:fs');
  fs.writeFileSync('tests/.shots/1124-g4-scheda.png', Buffer.from(img.a.split(',')[1], 'base64'));
  console.log('bounds scheda', JSON.stringify(img.sb), 'proposta', JSON.stringify(img.pb));
});

test('popup di accesso aperto dalla pagina: la proposta compare e riempie', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const login = testServer.html(`<!doctype html><title>login popup</title><body style="margin:0;padding:30px">
    <input id="e" type="email" style="width:260px;height:30px"></body>`);
  const page = await testServer.openReady(openTab, `<!doctype html><body><button id="b" onclick="window.open('${login}','login','width=480,height=560')">Accedi</button></body>`);
  await page.click('#b');
  const pop = await aspettaFinestra(app, (w) => { try { return w.url() === login; } catch (_) { return false; } }, 'popup non nato');
  await pop.waitForLoadState('domcontentloaded');
  const info = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ tabs: !!w._filoTabs, url: w.webContents.getURL(), vis: w.isVisible() })));
  console.log('finestre', JSON.stringify(info));
  await pop.waitForTimeout(800);
  await pop.click('#e');
  const vistaPop = () => app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w._filoTabs) continue;
      const figli = w.contentView.children || [];
      for (const v of figli) { try { if (v.webContents.getURL() === 'filo://shell/proposta-email.html') return { b: v.getBounds() }; } catch (_) {} }
    }
    return null;
  });
  await expect.poll(async () => { const v = await vistaPop(); return !!v && v.b.width > 0; }, { timeout: 8000 }).toBe(true);
  const vista = app.windows().find((w) => w.url() === 'filo://shell/proposta-email.html');
  await pop.waitForTimeout(700);
  const viste = app.windows().filter((w) => w.url() === 'filo://shell/proposta-email.html');
  for (const v of viste) { try { if (await v.locator('#email').isVisible()) { await v.click('#voce'); break; } } catch (_) {} }
  await expect.poll(() => pop.inputValue('#e'), { timeout: 4000 }).toBe(EMAIL);
});

test('focus e blur in fretta fra campi: alla fine la proposta sta col campo giusto, o non c\'è', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, DUE);
  await page.click('#u');
  await page.evaluate(async () => {
    const ids = ['u', 'e', 'n'];
    for (let i = 0; i < 60; i++) { document.getElementById(ids[i % 3]).focus(); await new Promise((r) => setTimeout(r, 5)); }
    document.getElementById('n').focus();
  });
  await page.waitForTimeout(1500);
  expect(await mostrata(app)).toBe(false);
  await page.evaluate(() => document.getElementById('e').focus());
  await expect.poll(() => mostrata(app), { timeout: 4000 }).toBe(true);
  const s = await stato(app);
  const r = await page.evaluate(() => document.getElementById('e').getBoundingClientRect().bottom);
  expect(Math.abs(s.bounds.y - (s.scheda.y + r * s.zoom))).toBeLessThanOrEqual(5);
});

test('navigando a un\'altra pagina col campo a fuoco la proposta va via', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const altra = testServer.html('<!doctype html><body><p>altra</p></body>');
  const page = await testServer.openReady(openTab, DUE);
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  await page.evaluate((u) => { location.href = u; }, altra);
  await expect.poll(() => mostrata(app), { timeout: 4000 }).toBe(false);
});
