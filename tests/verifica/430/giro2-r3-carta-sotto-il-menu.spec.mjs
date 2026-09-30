// Verifica #430 giro 2, rilievo 3: col menu del tasto destro di una scheda aperto, passare su un'altra scheda
// apre la carta, che finisce sotto il menu.
import { test, expect } from '../../fixtures/electron.mjs';
import { pagina, idDi, carta } from './giro2-carta.mjs';

const menuAperti = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .filter((w) => !w.isDestroyed() && w.isVisible() && /^data:text\/html/.test(w.webContents.getURL())).length);

test('con il menu di una scheda aperto, passare su un\'altra scheda non apre la carta', async ({ app, shell, openTab, testServer }) => {
  const uR = testServer.html(pagina('#d01010', 'Rossa'));
  await openTab(uR);
  const r = await idDi(app, (t) => t.url === uR);
  const uV = testServer.html(pagina('#10b010', 'Verde'));
  await openTab(uV);
  const v = await idDi(app, (t) => t.url === uV);
  const uB = testServer.html(pagina('#1030d0', 'Blu'));
  await openTab(uB);
  await idDi(app, (t) => t.url === uB);
  await shell.mouse.move(600, 500);
  await shell.waitForTimeout(900);
  await shell.locator(`.tab[data-id="${v}"]`).click({ button: 'right' });
  await expect.poll(() => menuAperti(app), { timeout: 3000 }).toBeGreaterThan(0);
  await shell.locator(`.tab[data-id="${r}"]`).hover();
  await shell.waitForTimeout(800);
  expect(await menuAperti(app)).toBeGreaterThan(0);
  expect((await carta(app)).visibile).toBe(false);
});
