// #1054 giro 2 — nel riquadro incorporato (di un altro sito) le voci che copiano o incollano funzionano come nella pagina.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';

async function sito(openTab, testServer) {
  const dentro = testServer.html(`<!doctype html><body style="margin:0;font:18px sans-serif">
    <a id="l2" href="https://example.com/dentro" style="position:absolute;left:20px;top:20px">nel riquadro</a>
    <p id="t2" style="position:absolute;left:20px;top:60px;margin:0">parole nel riquadro</p>
    <input id="c2" style="position:absolute;left:20px;top:100px;width:200px"></body>`).replace('127.0.0.1', 'localhost');
  const page = await testServer.openReady(openTab, `<!doctype html><body style="margin:0">
    <iframe id="r" src="${dentro}" style="position:absolute;left:40px;top:100px;width:400px;height:200px;border:0"></iframe></body>`);
  await expect.poll(() => page.frames().length).toBe(2);
  const fr = page.frames().find((f) => f !== page.mainFrame());
  await fr.waitForLoadState('domcontentloaded');
  await expect(fr.locator('#c2')).toBeVisible();
  await new Promise((r) => { setTimeout(r, 800); });
  return { page, fr };
}

const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());

for (const acceso of [true, false]) {
  test.describe(acceso ? 'strato acceso' : 'strato spento', () => {
    test.use({ stratoDelMenu: acceso });

    test(`r1 nel riquadro di un altro sito «Copia URL», «Copia» e «Incolla» funzionano (${acceso ? 'acceso' : 'spento'})`, async ({ app, openTab, testServer }) => {
      test.setTimeout(90_000);
      if (acceso) {
        await paginaDelloStrato(app);
        await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
      }
      const { page, fr } = await sito(openTab, testServer);
      const menu = menuDi(acceso ? page : fr);
      await app.evaluate(({ clipboard }) => clipboard.writeText('vecchio'));

      // Copia URL di un collegamento nel riquadro.
      await page.mouse.click(70, 130, { button: 'right' });
      await expect(menu.voce('Copia URL')).toBeVisible();
      await menu.voce('Copia URL').click();
      await expect.soft(await (async () => { for (let i = 0; i < 20; i++) { await new Promise((r) => { setTimeout(r, 100); }); } return appunti(app); })(), 'Copia URL nel riquadro').toBe('https://example.com/dentro');

      // Copia di una selezione nel riquadro.
      await fr.evaluate(() => {
        const r = document.createRange();
        r.selectNodeContents(document.getElementById('t2'));
        getSelection().removeAllRanges();
        getSelection().addRange(r);
      });
      await page.mouse.click(90, 172, { button: 'right' });
      await expect(menu.voce('Copia')).toBeVisible();
      await menu.voce('Copia').first().click();
      await expect.soft(await (async () => { for (let i = 0; i < 20; i++) { await new Promise((r) => { setTimeout(r, 100); }); } return appunti(app); })(), 'Copia nel riquadro').toBe('parole nel riquadro');

      // Incolla nel campo del riquadro.
      await app.evaluate(({ clipboard }) => clipboard.writeText('incollato qui'));
      await fr.locator('#c2').click();
      await page.mouse.click(120, 212, { button: 'right' });
      const incolla = menu.locator('.sn-menu-paste-main');
      await expect(incolla).toBeVisible();
      await incolla.click();
      await expect.poll(() => fr.locator('#c2').inputValue(), { message: 'Incolla nel riquadro' }).toBe('incollato qui');
    });
  });
}
