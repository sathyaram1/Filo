// Verifica #1343 giro 6, rilievo 1: a schermo intero una finestrella di Filo aperta dalla fila delle schede (il menu
// di una scheda, quello della linguetta) le tiene in vista finché è aperta, come fa la barra laterale col suo menu.
// Il puntatore che entra nel menu fa lasciare la shell: è quello che il sistema dice alla finestra sotto il menu.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuAperto } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const sito = (titolo) => `<!doctype html><html><head><title>${titolo}</title></head>
<body style="margin:0;padding:40px;font:16px sans-serif;height:1400px"><h1>${titolo}</h1></body></html>`;

const schedeInVista = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const tm = w._filoTabs;
  const t = tm.tabs.find((x) => x.id === tm.activeId);
  return t.view.getBounds().y === tm.tabRowHeight;
});
const schermoIntero = (app, on) => app.evaluate(({ BrowserWindow }, v) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  w._filoTabs.setContentFullscreen(v);
}, on);
const shellLasciata = (app, x, y) => app.evaluate(({ BrowserWindow }, p) => {
  const w = BrowserWindow.getAllWindows().find((z) => z._filoTabs && !z._filoIncognito);
  w.webContents.sendInputEvent({ type: 'mouseLeave', x: p.x, y: p.y });
}, { x: Math.round(x), y: Math.round(y) });

async function scopriLeSchede(app, openTab, testServer) {
  await testServer.openReady(openTab, sito('Prima'));
  const page = await testServer.openReady(openTab, sito('Seconda'));
  await schermoIntero(app, true);
  await page.mouse.move(400, 200);
  await page.mouse.move(400, 0, { steps: 4 });
  await expect.poll(() => schedeInVista(app)).toBe(true);
}

for (const [titolo, dove, tasto] of [
  ['r1 col menu di una scheda aperto a schermo intero le schede restano finché il menu è aperto', '.tab:has-text("Prima")', 'right'],
  ['r1 col menu della linguetta della barra aperto a schermo intero le schede restano finché il menu è aperto', '#barra-maniglia', 'right'],
]) {
  test(titolo, async ({ app, shell, openTab, testServer }) => {
    await scopriLeSchede(app, openTab, testServer);
    const bersaglio = shell.locator(dove).first();
    const box = await bersaglio.boundingBox();
    await shell.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await bersaglio.click({ button: tasto });
    const menu = await menuAperto(app);
    expect(menu, 'il menu si apre').not.toBeNull();
    // Il puntatore scende nel menu per scegliere una voce.
    await shellLasciata(app, box.x + box.width / 2, box.y + box.height + 20);
    await menu.mouse.move(20, 20);
    await menu.mouse.move(30, 40, { steps: 3 });
    await pausa(1200);
    expect(await schedeInVista(app), 'col menu aperto le schede non se ne vanno, e il menu resta attaccato alla sua scheda').toBe(true);
  });
}
