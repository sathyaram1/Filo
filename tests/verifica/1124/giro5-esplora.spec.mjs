// Esplorazione del giro 5 di #1124: Google vero, popup di accesso, campi invisibili per altre vie, aspetto.
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

const mostrata = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  return !!w._filoTabs.propostaEmail.mostrata;
});

const vistaProposta = (app) => aspettaFinestra(app, (w) => w.url() === 'filo://shell/proposta-email.html', 'la vista della proposta non è nata');

test('esplora: Google vero, il campo identificativo riceve la proposta e la scelta lo riempie', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await accountFinto(app);
  const page = await openTab('https://accounts.google.com/signin/v2/identifier?flowName=GlifWebSignIn');
  const ok = await page.waitForSelector('#identifierId', { timeout: 30_000 }).then(() => true).catch(() => false);
  console.log('GOOGLE url', page.url(), 'campo', ok);
  test.skip(!ok, 'Google non raggiungibile da qui');
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  console.log('GOOGLE attivo', await page.evaluate(() => document.activeElement && document.activeElement.id), 'mostrata senza clic', await mostrata(app));
  await page.screenshot({ path: 'tests/.shots/giro5-google-pagina.png' });
  await page.click('#identifierId');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  const vista = await vistaProposta(app);
  await page.waitForTimeout(700);
  await vista.click('#voce');
  await expect.poll(() => page.inputValue('#identifierId')).toBe(EMAIL);
});

test('esplora: popup di accesso aperto da un sito, il campo email riceve la proposta', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const login = testServer.html('<!doctype html><body style="margin:0;padding:30px"><input type="email" id="e" style="width:260px;height:30px"></body>')
    + '?client_id=a&redirect_uri=b';
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:30px">
    <button id="b" onclick="window.open('${login}', 'acc', 'width=500,height=500')">Accedi</button></body>`);
  await page.click('#b');
  const pop = await aspettaFinestra(app, (w) => { try { return w.url().startsWith(login.split('?')[0]); } catch (_) { return false; } }, 'popup non aperto');
  await pop.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  const tipo = await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith(u));
    return w ? { finestra: true, tabs: !!w._filoTabs } : { finestra: false };
  }, login.split('?')[0]);
  console.log('POPUP', JSON.stringify(tipo));
  await pop.click('#e');
  await pop.waitForTimeout(1500);
  const r = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({
    url: w.webContents.getURL(),
    figli: w.contentView.children.length,
    viste: w.contentView.children.map((v) => { try { return { url: v.webContents.getURL(), b: v.getBounds(), vis: v.getVisible ? v.getVisible() : null }; } catch (_) { return null; } }),
  })));
  console.log('FINESTRE', JSON.stringify(r));
  const vista = await vistaProposta(app);
  await pop.waitForTimeout(700);
  await vista.click('#voce');
  await expect.poll(() => pop.inputValue('#e')).toBe(EMAIL);
});

const INVISIBILI = `<!doctype html><body style="margin:0;padding:40px;height:2000px;background:#fff">
  <button id="ok" style="position:absolute;left:300px;top:300px;width:200px;height:40px">Accetta</button>
  <input type="email" id="incolore" style="position:absolute;left:300px;top:260px;width:200px;height:30px;background:transparent;border:0;outline:0;color:transparent;caret-color:transparent">
  <input type="email" id="velato" style="position:absolute;left:40px;top:500px;width:200px;height:30px">
  <div style="position:absolute;left:30px;top:490px;width:240px;height:60px;background:#fff;pointer-events:none"></div>
  <div style="position:absolute;left:40px;top:700px;width:200px;height:30px;overflow:hidden;clip-path:inset(50%)"><input type="email" id="tagliato" style="width:200px;height:30px"></div>
</body>`;

for (const id of ['incolore', 'velato', 'tagliato']) {
  test(`esplora: campo che l'utente non vede (${id}), a fuoco per mano della pagina`, async ({ app, openTab, testServer }) => {
    await accountFinto(app);
    const page = await testServer.openReady(openTab, INVISIBILI);
    await page.evaluate((x) => document.getElementById(x).focus({ preventScroll: true }), id);
    await page.waitForTimeout(1200);
    const m = await mostrata(app);
    await page.screenshot({ path: `tests/.shots/giro5-invisibile-${id}.png` });
    expect(m, `campo ${id}: la proposta non deve comparire`).toBe(false);
  });
}

test('esplora: aspetto chiaro e scuro, hover', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  for (const theme of ['light', 'dark']) {
    await impostazioni(app, { theme });
    const page = await testServer.openReady(openTab, `<!doctype html><body style="margin:0;padding:40px;background:${theme === 'dark' ? '#222' : '#fff'}">
      <label>Email <input type="email" id="e" style="width:320px;height:32px"></label></body>`);
    await page.click('#e');
    await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
    const vista = await vistaProposta(app);
    await page.waitForTimeout(400);
    await vista.screenshot({ path: `tests/.shots/giro5-proposta-${theme}.png` });
    await vista.hover('#voce');
    await page.waitForTimeout(300);
    await vista.screenshot({ path: `tests/.shots/giro5-proposta-${theme}-hover.png` });
    const finestra = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      const img = await w.webContents.capturePage();
      return img.toPNG().toString('base64');
    });
    const fs = await import('node:fs');
    fs.writeFileSync(`tests/.shots/giro5-shell-${theme}.png`, Buffer.from(finestra, 'base64'));
  }
});
