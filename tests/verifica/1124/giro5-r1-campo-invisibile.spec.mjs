// Giro 5 di #1124, rilievo 1: un campo che l'utente non vede, a fuoco per mano della pagina, non riceve la proposta.
// Due vie che il controllo di visibilità non riconosce: campo senza colori, campo coperto da un riquadro che lascia passare i clic.
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

const PAGINA = `<!doctype html><body style="margin:0;height:1200px;background:#fff">
  <button style="position:absolute;left:300px;top:300px;width:200px;height:40px">Accetta</button>
  <input type="email" id="incolore" style="position:absolute;left:300px;top:260px;width:200px;height:30px;background:transparent;border:0;outline:0;color:transparent;caret-color:transparent">
  <input type="email" id="velato" style="position:absolute;left:40px;top:500px;width:200px;height:30px">
  <div style="position:absolute;left:30px;top:490px;width:240px;height:60px;background:#fff;pointer-events:none"></div>
  <input type="email" id="vero" style="position:absolute;left:40px;top:40px;width:260px;height:30px">
</body>`;

for (const id of ['incolore', 'velato']) {
  test(`r1 il campo ${id}, che l'utente non vede, a fuoco per mano della pagina non riceve la proposta`, async ({ app, openTab, testServer }) => {
    await accountFinto(app);
    const page = await testServer.openReady(openTab, PAGINA);
    // Il campo visibile a fuoco per mano della pagina la riceve: la prova non è cieca.
    await page.evaluate(() => document.getElementById('vero').focus());
    await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
    await page.evaluate(() => document.activeElement.blur());
    await expect.poll(() => mostrata(app)).toBe(false);

    await page.evaluate((x) => document.getElementById(x).focus({ preventScroll: true }), id);
    await page.waitForTimeout(1200);
    expect(await mostrata(app), `campo ${id}`).toBe(false);
  });
}
