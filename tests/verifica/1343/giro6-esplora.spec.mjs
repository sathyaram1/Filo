// Esplorazione verifica #1343 giro 6: il menu di una scheda a schermo intero con eventi veri del server X. Si cancella.
import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync } from 'node:child_process';
import { menuAperto } from '../../helpers/barra.mjs';

const XT = '/tmp/claude-0/-home-user-Filo/dfa679fd-76b6-5ef1-9437-3face45b0ee2/scratchpad/xt/xt.py';
const x = (...a) => execFileSync('python3', [XT, ...a.map(String)]);
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const sito = (t) => `<!doctype html><title>${t}</title><body style="height:1400px"><h1>${t}</h1></body>`;

test('esplora menu scheda con eventi X', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, sito('Prima'));
  await testServer.openReady(openTab, sito('Seconda'));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((z) => z._filoTabs && !z._filoIncognito);
    global.__log = [];
    w.webContents.on('input-event', (_e, i) => { if (i.type !== 'mouseMove') global.__log.push('shell:' + i.type); });
    w._filoTabs.setContentFullscreen(true);
  });
  await pausa(800);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((z) => z._filoTabs && !z._filoIncognito);
    w._filoTabs.schedeInAlto.mostra();
  });
  await pausa(500);
  const cb = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((z) => z._filoTabs && !z._filoIncognito).getContentBounds());
  const box = await shell.locator('.tab:has-text("Prima")').first().boundingBox();
  const sx = Math.round(cb.x + box.x + box.width / 2);
  const sy = Math.round(cb.y + box.y + box.height / 2);
  console.log('ESPLORA cb', JSON.stringify(cb), 'tab', sx, sy);
  x('move', sx, sy, 'sleep', 0.2, 'move', sx + 2, sy, 'sleep', 0.3, 'down', 3, 'sleep', 0.08, 'up', 3, 'sleep', 0.6);
  const menu = await menuAperto(app);
  console.log('ESPLORA menu', !!menu);
  const mb = await app.evaluate(({ BrowserWindow }) => {
    const m = BrowserWindow.getAllWindows().find((z) => { try { return z.isVisible() && z.webContents.getURL().startsWith('data:text/html') && !z._filoTabs; } catch (_) { return false; } });
    return m ? m.getBounds() : null;
  });
  console.log('ESPLORA menuBounds', JSON.stringify(mb));
  if (mb) {
    for (let k = 1; k <= 6; k++) x('move', sx + Math.round((mb.x + 30 - sx) * k / 6), sy + Math.round((mb.y + 40 - sy) * k / 6), 'sleep', 0.03);
  }
  await pausa(1500);
  const r = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((z) => z._filoTabs && !z._filoIncognito);
    return { visibili: w._filoTabs.schedeInAlto.visibili, log: global.__log };
  });
  console.log('ESPLORA esito', JSON.stringify(r));
  expect(true).toBe(true);
});
