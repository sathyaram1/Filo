// Prova di passaggio del giro 5 di #1124: sulla pagina vera di Google il campo a fuoco per mano della pagina la riceve ancora.
import { test, expect } from '../../fixtures/electron.mjs';

test('Google vero: campo a fuoco per mano della pagina', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(() => {
    const M = process.getBuiltinModule('module');
    const ga = M._cache[Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x))].exports;
    ga.isSignedIn = () => true;
    ga.getProfile = () => ({ email: 'chi-usa-filo@example.com', name: 'x', picture: '' });
  });
  const page = await openTab('https://accounts.google.com/signin/v2/identifier?flowName=GlifWebSignIn');
  await page.waitForSelector('#identifierId', { timeout: 30_000 });
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 15_000 });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); document.getElementById('identifierId').focus(); });
  const mostrata = () => app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.propostaEmail.mostrata);
  await expect.poll(mostrata, { timeout: 8000 }).toBe(true);
});
