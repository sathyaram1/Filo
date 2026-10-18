// #1124 giro 4, rilievo 1: dopo Esc la proposta torna solo uscendo dal campo e rientrandoci.
import { test, expect } from '../../fixtures/electron.mjs';

const EMAIL = 'chi-usa-filo@example.com';
const PAGINA = `<!doctype html><body style="margin:0;padding:40px">
  <input id="e" type="email" style="width:300px;height:30px"></body>`;

async function accountFinto(app) {
  await app.evaluate((_e, email) => {
    const M = process.getBuiltinModule('module');
    const ga = M._cache[Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x))].exports;
    ga.isSignedIn = () => true;
    ga.getProfile = () => ({ email, name: 'Chi Usa Filo', picture: '' });
  }, EMAIL);
}

const mostrata = (app) => app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.propostaEmail.mostrata);

function schedaDavanti(app, fn, arg) {
  return app.evaluate(({ BrowserWindow }, [src, a]) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    const wc = tm.tabs.find((x) => x.id === tm.activeId).view.webContents;
    return new Function('wc', 'a', src)(wc, a);
  }, [fn, arg]);
}

const esc = (app) => schedaDavanti(app, "wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });");

async function apriEChiudiConEsc(app, openTab, testServer) {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  await esc(app);
  await expect.poll(() => mostrata(app)).toBe(false);
  return page;
}

test('r1 dopo Esc un clic sul campo ripropone l\'email', async ({ app, openTab, testServer }) => {
  const page = await apriEChiudiConEsc(app, openTab, testServer);
  const r = await page.evaluate(() => { const b = document.getElementById('e').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await schedaDavanti(app, `const z = wc.getZoomFactor(); const x = Math.round(a.x * z); const y = Math.round(a.y * z);
    wc.focus(); wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });`, r);
  await expect.poll(() => mostrata(app), { timeout: 3000 }).toBe(true);
});

test('r1 dopo Esc scrivere l\'inizio dell\'email la ripropone', async ({ app, openTab, testServer }) => {
  const page = await apriEChiudiConEsc(app, openTab, testServer);
  await page.keyboard.type('chi');
  await expect.poll(() => mostrata(app), { timeout: 3000 }).toBe(true);
});
