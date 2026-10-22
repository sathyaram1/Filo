// Esplorazione verifica #1343 giro 6: il menu di una scheda a schermo intero con eventi veri del server X. Si cancella.
import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync } from 'node:child_process';
import { menuAperto } from '../../helpers/barra.mjs';

const XT = '/tmp/claude-0/-home-user-Filo/dfa679fd-76b6-5ef1-9437-3face45b0ee2/scratchpad/xt/xt.py';
const x = (...a) => execFileSync('python3', [XT, ...a.map(String)]);
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const sito = (t) => `<!doctype html><title>${t}</title><body style="height:1400px"><h1>${t}</h1></body>`;
const stato = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((z) => z._filoTabs && !z._filoIncognito)._filoTabs.schedeInAlto.visibili);

test('esplora menu scheda con eventi X', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, sito('Prima'));
  await testServer.openReady(openTab, sito('Seconda'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((z) => z._filoTabs && !z._filoIncognito)._filoTabs.setContentFullscreen(true));
  await pausa(800);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((z) => z._filoTabs && !z._filoIncognito)._filoTabs.schedeInAlto.mostra());
  await pausa(500);
  const cb = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((z) => z._filoTabs && !z._filoIncognito).getContentBounds());
  const box = await shell.locator('.tab:has-text("Prima")').first().boundingBox();
  const sx = Math.round(cb.x + box.x + box.width / 2);
  const sy = Math.round(cb.y + box.y + box.height / 2);
  x('move', sx, sy, 'sleep', 0.2, 'move', sx + 2, sy, 'sleep', 0.3, 'down', 3, 'sleep', 0.08, 'up', 3, 'sleep', 0.6);
  const menu = await menuAperto(app);
  const mb = await app.evaluate(({ BrowserWindow }) => {
    const m = BrowserWindow.getAllWindows().find((z) => { try { return z.isVisible() && z.webContents.getURL().startsWith('data:text/html') && !z._filoTabs; } catch (_) { return false; } });
    return m ? m.getBounds() : null;
  });
  if (mb) for (let k = 1; k <= 6; k++) x('move', sx + Math.round((mb.x + 30 - sx) * k / 6), sy + Math.round((mb.y + 120 - sy) * k / 6), 'sleep', 0.03);
  await pausa(1500);
  const conMenu = await stato(app);
  // Esc chiude il menu: il puntatore resta dov'era il menu, sopra la pagina, e le schede se ne vanno.
  if (menu) await menu.keyboard.press('Escape');
  await pausa(1500);
  const dopo = await stato(app);
  console.log('ESPLORA', JSON.stringify({ menu: !!menu, mb, conMenu, dopo }));
  expect(true).toBe(true);
});
