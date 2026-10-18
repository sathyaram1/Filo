// r1: un campo che l'utente non vede (trasparente o di un pixel) non fa comparire la proposta, nemmeno col fuoco
// messo dalla pagina: se no la pagina la fa comparire dove l'utente sta per cliccare.
import { test, expect } from '../../fixtures/electron.mjs';
import { accountFinto, mostrata } from './aiuti.mjs';

const PAGINA = `<!doctype html><body style="margin:0;padding:40px">
  <button id="ok" style="position:absolute;left:300px;top:340px;width:200px;height:40px">Accetta</button>
  <input type="email" id="trasparente" style="opacity:0;position:absolute;left:300px;top:300px;width:200px;height:30px">
  <input type="email" id="pixel" style="position:absolute;left:300px;top:300px;width:1px;height:1px;border:0;padding:0">
  <input type="email" id="vero" style="width:260px">
</body>`;

for (const id of ['trasparente', 'pixel']) {
  test(`r1 il campo ${id} messo a fuoco dalla pagina non mostra la proposta`, async ({ app, openTab, testServer }) => {
    await accountFinto(app);
    const page = await testServer.openReady(openTab, PAGINA);
    // Il campo visibile la mostra: la proposta funziona su questa pagina.
    await page.click('#vero');
    await expect.poll(() => mostrata(app), { timeout: 8000 }).toBe(true);
    await page.evaluate(() => document.activeElement.blur());
    await expect.poll(() => mostrata(app)).toBe(false);

    await page.evaluate((x) => document.getElementById(x).focus(), id);
    await page.waitForTimeout(1500);
    expect(await mostrata(app)).toBe(false);
  });
}
