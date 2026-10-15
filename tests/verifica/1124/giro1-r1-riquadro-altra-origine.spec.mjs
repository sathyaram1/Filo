// #1124 giro 1, rilievo 1: un campo email dentro un riquadro di un'altra origine (un modulo di accesso incorporato)
// deve ricevere la proposta come quello della pagina, e la scelta lo riempie.
import { test, expect, aspettaFinestra } from '../../fixtures/electron.mjs';

const EMAIL = 'chi-usa-filo@example.com';

const mostrata = (app) => app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.propostaEmail.mostrata);

test('r1 il campo email in un riquadro di un\'altra origine riceve la proposta, e la scelta lo riempie', async ({ app, openTab, testServer }) => {
  await app.evaluate((_e, email) => {
    const M = process.getBuiltinModule('module');
    const ga = M._cache[Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x))].exports;
    ga.isSignedIn = () => true;
    ga.getProfile = () => ({ email, name: 'Chi', picture: '' });
  }, EMAIL);
  const dentro = testServer.html('<!doctype html><body style="margin:0;padding:20px"><input id="u" type="email" style="width:260px;height:30px"></body>')
    .replace('127.0.0.1', 'localhost');
  const page = await testServer.openReady(openTab, `<!doctype html><body style="margin:0;padding:30px">
    <iframe id="r" src="${dentro}" style="width:400px;height:200px"></iframe></body>`);
  const riquadro = page.frameLocator('#r');
  await riquadro.locator('#u').click();
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  const vista = await aspettaFinestra(app, (w) => w.url() === 'filo://shell/proposta-email.html', 'la vista della proposta non è nata');
  await page.waitForTimeout(600);
  await vista.click('#voce');
  await expect.poll(() => riquadro.locator('#u').inputValue()).toBe(EMAIL);
});
