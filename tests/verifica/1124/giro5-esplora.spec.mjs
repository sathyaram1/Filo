// Esplorazione del giro 5 di #1124: l'account che cambia con la proposta a schermo, la scelta su un campo velato.
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

const mostrata = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  return !!w._filoTabs.propostaEmail.mostrata;
});

const vistaProposta = (app) => aspettaFinestra(app, (w) => w.url() === 'filo://shell/proposta-email.html', 'la vista della proposta non è nata');

test('esplora: account scollegato con la proposta a schermo, nella stessa scheda', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, '<!doctype html><body style="padding:40px"><input type="email" id="e" style="width:300px"></body>');
  await page.click('#e');
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  await accountFinto(app, '');
  await page.waitForTimeout(1500);
  console.log('SCOLLEGATO mostrata', await mostrata(app));
});

test('esplora: la scelta su un campo velato da un riquadro che lascia passare i clic', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, `<!doctype html><body style="margin:0;height:1200px;background:#fff">
    <input type="email" id="v" style="position:absolute;left:40px;top:100px;width:200px;height:30px">
    <div style="position:absolute;left:30px;top:90px;width:240px;height:60px;background:#fff;pointer-events:none"></div>
    <button id="ok" style="position:absolute;left:40px;top:134px;width:200px;height:44px">Accetta</button>
    <script>window.letto = ''; document.getElementById('v').addEventListener('input', (e) => { window.letto = e.target.value; });</script></body>`);
  await page.evaluate(() => document.getElementById('v').focus());
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
  const vista = await vistaProposta(app);
  await page.waitForTimeout(700);
  await vista.click('#voce');
  await expect.poll(() => page.evaluate(() => window.letto)).toBe(EMAIL);
});
