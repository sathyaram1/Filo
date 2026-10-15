// Esplorazione del verifier, #1124 giro 1.
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
function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs; const p = tm.propostaEmail;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return { mostrata: !!p.mostrata, bounds: p.vista ? p.vista.getBounds() : null, scheda: t ? t.view.getBounds() : null };
  });
}
const mostrata = async (app) => (await stato(app)).mostrata;
const vistaProposta = (app) => aspettaFinestra(app, (w) => w.url() === 'filo://shell/proposta-email.html', 'vista');

const GOOGLE = `<!doctype html><html><body style="margin:0;padding:40px">
<input type="email" id="identifierId" name="identifier" autocomplete="username" autofocus style="width:320px;height:40px">
<script>
  window.eventi=[];
  // un input "controllato" alla React: il valore vero sta nello stato, rimesso a ogni render
  const e=document.getElementById('identifierId');
  e.addEventListener('input',(ev)=>window.eventi.push(e.value));
</script></body></html>`;

test('autofocus all\'apertura: la proposta compare senza cliccare', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const t0 = Date.now();
  const page = await testServer.openReady(openTab, GOOGLE);
  const focusato = await page.evaluate(() => document.activeElement && document.activeElement.id);
  const hasFocus = await page.evaluate(() => document.hasFocus());
  let comparsa = false;
  try { await expect.poll(() => mostrata(app), { timeout: 4000 }).toBe(true); comparsa = true; } catch (_) {}
  console.log('AUTOFOCUS', { focusato, hasFocus, comparsa, ms: Date.now() - t0 });
});

test('prefisso scritto e poi scelta: il campo contiene la sola email', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, GOOGLE);
  await page.click('#identifierId');
  const t0 = Date.now();
  await expect.poll(() => mostrata(app), { timeout: 8000, intervals: [20] }).toBe(true);
  console.log('PRIMA COMPARSA ms', Date.now() - t0);
  await page.keyboard.type('Chi-');
  await page.waitForTimeout(400);
  expect(await mostrata(app)).toBe(true);
  const vista = await vistaProposta(app);
  await page.waitForTimeout(600);
  await vista.click('#voce');
  await expect.poll(() => page.inputValue('#identifierId')).toBe(EMAIL);
  console.log('EVENTI', await page.evaluate(() => window.eventi));
  // il fuoco torna al campo? Invio va alla pagina
  console.log('ATTIVO DOPO', await page.evaluate(() => document.activeElement && document.activeElement.id));
});

test('campo in fondo alla scheda: la proposta sta dentro la scheda, sopra il campo', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, `<!doctype html><body style="margin:0;height:100vh;position:relative">
    <input type="email" id="e" style="position:absolute;bottom:4px;left:20px;width:300px;height:30px"></body>`);
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  const s = await stato(app);
  console.log('FONDO', s);
  expect(s.bounds.y + s.bounds.height).toBeLessThanOrEqual(s.scheda.y + s.scheda.height);
});

test('cambio scheda e ritorno; scroll; tema scuro', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  await impostazioni(app, { theme: 'dark' });
  const page = await testServer.openReady(openTab, `<!doctype html><body style="margin:0;padding:40px;height:3000px;background:#222">
    <input type="email" id="e" style="width:300px;height:30px"></body>`);
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  const vista = await vistaProposta(app);
  await page.waitForTimeout(300);
  await vista.screenshot({ path: 'tests/.shots/v1124-scuro.png' });
  const b1 = (await stato(app)).bounds;
  await page.evaluate(() => window.scrollBy(0, 20));
  await page.waitForTimeout(500);
  const b2 = (await stato(app)).bounds;
  console.log('SCROLL', b1.y, b2 && b2.y, await mostrata(app));
  const altra = await testServer.openReady(openTab, '<!doctype html><body>altra</body>');
  await page.waitForTimeout(500);
  console.log('ALTRA SCHEDA mostrata', await mostrata(app));
  await app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    const t = tm.tabs.find((x) => x.view.webContents.getURL() === u);
    tm.activate ? tm.activate(t.id) : tm.switchTo(t.id);
  }, page.url()).catch((e) => console.log('ATTIVA ERR', e.message));
  await page.waitForTimeout(1000);
  console.log('RITORNO mostrata', await mostrata(app), await page.evaluate(() => document.activeElement.id));
  void altra;
});
