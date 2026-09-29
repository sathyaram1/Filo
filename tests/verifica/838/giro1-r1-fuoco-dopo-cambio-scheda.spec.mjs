// Verifica #838 giro 1, rilievo 1: dopo una scheda chiusa o cambiata da tastiera
// nessuna parte di Filo ha il fuoco e le quattro scorciatoie non arrivano più.
// Il tasto va a chi ha davvero il fuoco, come un tasto vero: se nessuno, si perde.
import { test, expect } from '../../fixtures/electron.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

async function prepara(app, openTab, testServer) {
  for (let i = 1; i <= 4; i++) await testServer.openReady(openTab, `<p id="p">pagina numero ${i}</p>`);
  await pausa(400);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.show(); w.focus();
    w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents.focus();
  });
  await pausa(300);
}

// Il tasto va al webContents che ha il fuoco della tastiera, come un tasto vero.
function premi(app, keyCode, modifiers) {
  return app.evaluate(({ webContents }, { keyCode, modifiers }) => {
    const f = webContents.getFocusedWebContents();
    if (!f) return false;
    f.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    f.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    return true;
  }, { keyCode, modifiers });
}

const schede = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.tabs.length);
const aiutoSullaAttiva = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return t.view.webContents.executeJavaScript('!!document.querySelector(".sn-sidebar")');
});

test('Alt+S premuto due volte di fila salva e chiude due schede', async ({ app, openTab, testServer }) => {
  await prepara(app, openTab, testServer);
  const n0 = await schede(app);
  expect(await premi(app, 'S', ['alt'])).toBe(true);
  await expect.poll(() => schede(app), { timeout: 8000 }).toBe(n0 - 1);
  await pausa(500);
  await premi(app, 'S', ['alt']);
  await expect.poll(() => schede(app), { timeout: 8000 }).toBe(n0 - 2);
});

for (const [nome, keyCode, modifiers] of [
  ['Ctrl+W', 'W', ['control']],
  ['il salto di scheda Alt+2', '2', ['alt']],
]) {
  test(`dopo ${nome} da tastiera, Alt+H apre l'Aiuto sulla scheda che resta davanti`, async ({ app, openTab, testServer }) => {
    await prepara(app, openTab, testServer);
    expect(await premi(app, keyCode, modifiers)).toBe(true);
    await pausa(800);
    await premi(app, 'H', ['alt']);
    await expect.poll(() => aiutoSullaAttiva(app), { timeout: 6000 }).toBe(true);
  });
}
