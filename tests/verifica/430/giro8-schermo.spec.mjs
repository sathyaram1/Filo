// Verifica #430 giro 8 — esplorazione: la carta vera sullo schermo, sotto la sua scheda.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test, expect } from '../../fixtures/electron.mjs';
import { pagina, schede, idDi, carta, rosso } from './giro2-carta.mjs';
const run = promisify(execFile);

test('carta sullo schermo', async ({ app, shell, openTab, testServer }) => {
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); w.setBounds({ x: 0, y: 0, width: 1100, height: 750 }); w.show(); });
  const u = testServer.html(pagina('#e01010', 'Pagina rossa con un titolo abbastanza lungo'));
  await openTab(u);
  await shell.waitForTimeout(600);
  await openTab(testServer.html(pagina('#f4f0e8', 'Chiara')));
  const a = await idDi(app, (t) => /rossa/.test(t.title));
  await expect.poll(async () => (await schede(app)).tutte.find((t) => t.id === a)?.foto, { timeout: 10_000 }).toBe(true);
  await shell.locator(`.tab[data-id="${a}"]`).hover();
  await expect.poll(async () => rosso((await carta(app)).colore), { timeout: 3000 }).toBe(true);
  await shell.waitForTimeout(300);
  await run('scrot', ['-o', 'tests/.shots/g8-schermo.png']);
  for (const misura of ['piccola', 'grande']) {
    await shell.mouse.move(600, 500);
    await shell.evaluate((m) => window.filoShell.message({ type: 'update_settings', settings: { tabPreview: { enabled: true, size: m } } }), misura);
    await shell.waitForTimeout(800);
    await shell.locator(`.tab[data-id="${a}"]`).hover();
    await expect.poll(async () => rosso((await carta(app)).colore), { timeout: 3000 }).toBe(true);
    await shell.waitForTimeout(300);
    await run('scrot', ['-o', `tests/.shots/g8-schermo-${misura}.png`]);
  }
});
