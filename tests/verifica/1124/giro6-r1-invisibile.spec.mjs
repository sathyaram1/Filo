// #1124 giro 6 — la pagina dà il fuoco a un campo che l'utente non vede: la proposta non deve comparire.
import { test, expect, aspettaFinestra } from '../../fixtures/electron.mjs';

const EMAIL = 'chi-usa-filo@example.com';

async function accountFinto(app) {
  await app.evaluate((_e, email) => {
    const M = process.getBuiltinModule('module');
    const ga = M._cache[Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x))].exports;
    ga.isSignedIn = () => true;
    ga.getProfile = () => ({ email, name: 'Chi', picture: '' });
  }, EMAIL);
}

const mostrata = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  return !!w._filoTabs.propostaEmail.mostrata;
});

// Ogni campo sta subito sopra un pulsante «Accetta»: la proposta comparirebbe sopra il pulsante.
const PAGINA = `<!doctype html><body style="margin:0;padding:40px;background:#fff;font:16px sans-serif">
  <button style="position:absolute;left:40px;top:140px;width:240px;height:40px">Accetta</button>
  <input type="email" id="comeFondo" style="position:absolute;left:40px;top:100px;width:240px;height:36px;background:#fff;border:0;outline:0;color:transparent;caret-color:transparent">

  <button style="position:absolute;left:340px;top:140px;width:240px;height:40px">Accetta</button>
  <input type="email" id="sottoBordo" style="position:absolute;left:340px;top:100px;width:240px;height:36px">
  <div style="position:absolute;left:330px;top:90px;width:180px;height:16px;border:20px solid #fff;background:transparent;pointer-events:none"></div>

  <button style="position:absolute;left:640px;top:140px;width:240px;height:40px">Accetta</button>
  <input type="email" id="sottoOmbra" style="position:absolute;left:640px;top:100px;width:240px;height:36px">
  <div style="position:absolute;left:650px;top:110px;width:10px;height:10px;box-shadow:0 0 0 60px #fff;pointer-events:none"></div>

  <style>#pseudo::after{content:'';position:absolute;left:-10px;top:-10px;width:260px;height:56px;background:#fff;pointer-events:none}</style>
  <button style="position:absolute;left:40px;top:340px;width:240px;height:40px">Accetta</button>
  <input type="email" id="sottoPseudo" style="position:absolute;left:40px;top:300px;width:240px;height:36px">
  <div id="pseudo" style="position:absolute;left:40px;top:300px;width:0;height:0;pointer-events:none"></div>
</body>`;

for (const [r, id, come] of [
  ['r1', 'comeFondo', 'dipinto del colore della pagina'],
  ['r1', 'sottoBordo', 'coperto da un bordo spesso che lascia passare i clic'],
  ['r1', 'sottoOmbra', 'coperto da un\'ombra che lascia passare i clic'],
  ['r1', 'sottoPseudo', 'coperto da un riquadro disegnato come ::after che lascia passare i clic'],
]) {
  test(`${r} campo ${come}, a fuoco per mano della pagina: niente proposta`, async ({ app, openTab, testServer }) => {
    await accountFinto(app);
    const page = await testServer.openReady(openTab, PAGINA);
    await page.evaluate((x) => document.getElementById(x).focus({ preventScroll: true }), id);
    await page.waitForTimeout(1500);
    expect(await mostrata(app), `campo ${id}`).toBe(false);
  });
}

test('r1 il clic sulla proposta sotto il campo coperto dal bordo consegna l\'email alla pagina', async ({ app, openTab, testServer }) => {
  await accountFinto(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.evaluate(() => document.getElementById('sottoBordo').focus({ preventScroll: true }));
  await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(false);
  // Se compare, la scelta consegna l'email: la prova resta rossa sull'attesa qui sopra.
  const vista = await aspettaFinestra(app, (w) => w.url() === 'filo://shell/proposta-email.html', 'vista');
  await page.waitForTimeout(700);
  await vista.click('#voce');
  await page.waitForTimeout(500);
  expect(await page.inputValue('#sottoBordo')).toBe('');
});
