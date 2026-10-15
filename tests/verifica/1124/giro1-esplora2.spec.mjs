// Esplorazione del verifier, #1124 giro 1 (seconda parte).
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
function mostrataOvunque(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const M = process.getBuiltinModule('module');
    void M;
    return BrowserWindow.getAllWindows().map((w) => ({
      tabs: !!w._filoTabs, url: w.webContents.getURL(),
      mostrata: w._filoTabs ? !!w._filoTabs.propostaEmail.mostrata : null,
      vista: w.contentView.children.length,
    }));
  });
}
const mostrata = (app) => app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.propostaEmail.mostrata);

test('dalla barra dell\'indirizzo al campo già col fuoco della pagina', async ({ app, shell, openTab, testServer }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:40px">
    <input type="email" id="e" autofocus style="width:300px;height:30px"></body>`);
  await expect.poll(() => mostrata(app), { timeout: 5000 }).toBe(true);
  await shell.click('#addr');
  await expect.poll(() => mostrata(app), { timeout: 3000 }).toBe(false);
  await page.click('#e');
  let ok = true;
  try { await expect.poll(() => mostrata(app), { timeout: 3000 }).toBe(true); } catch (_) { ok = false; }
  console.log('DOPO BARRA', ok);
});

test('campo dentro uno shadow root aperto', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:40px">
    <div id="h"></div><script>
    const r=document.getElementById('h').attachShadow({mode:'open'});
    r.innerHTML='<label>Email or username<input id="u" name="username" style="width:300px;height:30px"></label>';
    </script></body>`);
  await page.locator('#h').locator('#u').click();
  let ok = true;
  try { await expect.poll(() => mostrata(app), { timeout: 4000 }).toBe(true); } catch (_) { ok = false; }
  console.log('SHADOW', ok);
});

test('popup di accesso aperto con window.open', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const login = testServer.html(`<!doctype html><title>login</title><body style="padding:30px">
    <input type="email" id="e" style="width:260px;height:30px"></body>`);
  const page = await testServer.openReady(openTab, `<!doctype html><body><button id="b" onclick="window.open('${login}','x','width=500,height=600')">accedi</button></body>`);
  await page.click('#b');
  await page.waitForTimeout(2500);
  const finestre = await mostrataOvunque(app);
  console.log('FINESTRE', JSON.stringify(finestre));
  const pop = app.windows().find((w) => { try { return w.url() === login; } catch (_) { return false; } });
  console.log('POPUP TROVATO', !!pop);
  if (!pop) return;
  await pop.click('#e');
  await page.waitForTimeout(1500);
  const stato = await app.evaluate(({ BrowserWindow, webContents }, u) => {
    const wc = webContents.getAllWebContents().find((x) => x.getURL() === u);
    const w = BrowserWindow.fromWebContents(wc);
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    const inScheda = tm.tabs.some((t) => t.view.webContents === wc);
    return { inScheda, finestra: !!w, tabsMgr: !!(w && w._filoTabs), mostrataScheda: tm.propostaEmail.mostrata,
      viste: w ? w.contentView.children.map((v) => v.webContents && v.webContents.getURL()) : [] };
  }, login);
  console.log('POPUP STATO', JSON.stringify(stato));
});
