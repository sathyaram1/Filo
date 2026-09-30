// Verifica #430 giro 2 — esplorazione: menu del tasto destro di una scheda aperto, puntatore su un'altra scheda.
import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync } from 'node:child_process';
import { pagina, schede, idDi, carta } from './giro2-carta.mjs';

test('con il menu di una scheda aperto, passare su un\'altra scheda non apre la carta sopra il menu', async ({ app, shell, openTab, testServer }) => {
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
  await shell.waitForTimeout(800);
  const menu = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.isVisible() && /^data:text\/html/.test(w.webContents.getURL())).map((w) => w.getBounds()));
  console.log('MENU', JSON.stringify(menu));
  await shell.locator(`.tab[data-id="${r}"]`).hover();
  await shell.waitForTimeout(800);
  if (process.env.FILO_TEST_VISIBLE === '1') execFileSync('scrot', ['-o', 'tests/.shots/430-g2-menu-e-carta.png']);
  const c = await carta(app);
  const menuDopo = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.isVisible() && /^data:text\/html/.test(w.webContents.getURL())).map((w) => w.getBounds()));
  console.log('CARTA', c.visibile, c.titolo, JSON.stringify(c.bounds), 'MENU DOPO', JSON.stringify(menuDopo));
  expect(menu.length).toBeGreaterThan(0);
  expect(menuDopo.length > 0 && c.visibile).toBe(false);
});
