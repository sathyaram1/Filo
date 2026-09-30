// Verifica #430 giro 2 — esplorazione: link aperti dietro e poi Filo messo da parte (ridotto a icona) per un po'.
import { test, expect } from '../../fixtures/electron.mjs';
import { pagina, schede, idDi, carta, verde } from './giro2-carta.mjs';

test('link aperto dietro, Filo ridotto a icona per venti secondi: tornando la scheda ha la sua foto', async ({ app, shell, openTab, testServer }) => {
  const dietro = testServer.html(pagina('#10b010', 'Da leggere dopo'));
  const uA = testServer.html(pagina('#1030d0', 'Blu', `<a id="vai" href="${dietro}">vai</a>`));
  const pA = await openTab(uA);
  await pA.click('#vai', { modifiers: ['Control'] });
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); w.minimize(); if (!w.isMinimized()) w.hide(); });
  const stato = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); return { min: w.isMinimized(), vis: w.isVisible() }; });
  console.log('VIA', JSON.stringify(stato));
  const d = await idDi(app, (t) => t.url === dietro);
  await shell.waitForTimeout(20_000);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); if (w.isMinimized()) w.restore(); w.showInactive(); });
  await shell.waitForTimeout(6000);
  const s = await schede(app);
  console.log('TORNATO', JSON.stringify(s.tutte.find((t) => t.id === d)));
  await shell.mouse.move(600, 500);
  await shell.waitForTimeout(900);
  await shell.locator(`.tab[data-id="${d}"]`).hover();
  await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
  const c = await carta(app);
  console.log('CARTA', JSON.stringify(c.colore));
  expect(verde(c.colore)).toBe(true);
});
