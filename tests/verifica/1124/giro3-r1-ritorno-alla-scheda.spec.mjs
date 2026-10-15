// Verifica #1124 giro 3, rilievo 1: tornando alla scheda col campo ancora a fuoco, la proposta deve rispecchiare lo
// stato di adesso (account, tema), non quello di quando era comparsa.
import { test, expect, aspettaFinestra } from '../../fixtures/electron.mjs';

const EMAIL = 'chi-usa-filo@example.com';
const PAGINA = '<!doctype html><body style="padding:40px"><input type="email" id="e" style="width:300px;height:30px"></body>';

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

const mostrata = (app) => app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.propostaEmail.mostrata);
const attiva = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.activeId);

async function vaiEtorna(app, openTab, shell, testServer, mentreSeiVia) {
  const primo = await attiva(app);
  await openTab(testServer.html('<!doctype html><body>altra</body>').replace('127.0.0.1', 'localhost'));
  await expect.poll(() => mostrata(app), { timeout: 4000 }).toBe(false);
  await mentreSeiVia();
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), primo);
  await expect.poll(() => attiva(app)).toBe(primo);
}

test('r1 account scollegato in un\'altra scheda: tornando, la proposta non mostra più la sua email', async ({ app, openTab, testServer, shell }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  await vaiEtorna(app, openTab, shell, testServer, () => accountFinto(app, ''));
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('e');
  expect(await mostrata(app), 'senza account collegato non deve comparire niente').toBe(false);
});

test('r1 tema cambiato in un\'altra scheda: tornando, la proposta ha il tema nuovo', async ({ app, openTab, testServer, shell }) => {
  await accountFinto(app);
  await impostazioni(app, { theme: 'light' });
  const page = await testServer.openReady(openTab, PAGINA);
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  const vista = await aspettaFinestra(app, (w) => w.url() === 'filo://shell/proposta-email.html', 'vista');
  const sfondo = () => vista.evaluate(() => getComputedStyle(document.getElementById('riquadro')).backgroundColor);
  const chiaro = await sfondo();
  await vaiEtorna(app, openTab, shell, testServer, () => impostazioni(app, { theme: 'dark' }));
  await expect.poll(() => mostrata(app), { timeout: 4000 }).toBe(true);
  await page.waitForTimeout(800);
  await vista.screenshot({ path: 'tests/.shots/giro3-r1-tema-al-ritorno.png' });
  expect(await sfondo(), 'lo sfondo del riquadro deve seguire il tema scuro').not.toBe(chiaro);
});
