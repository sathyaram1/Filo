// Esplorazione del giro 10: aspetto della barra con le icone e della fila a schermo intero, chiaro e scuro; riordino
// fatto a parole e annullato; annullo di un riordino vecchio dopo un altro spostamento.
import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo, apriAltro } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const SITO = `<!doctype html><html><head><title>Sito di prova</title></head><body style="margin:0;padding:40px;font:16px sans-serif;height:1400px"><h1>Sito</h1></body></html>`;
const tema = (app, t) => app.evaluate(async (_e, v) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { theme: v } }, { url: 'filo://preferences/preferences.html' }), t);

for (const t of ['light', 'dark']) {
  test(`aspetto ${t}: barra con Altro aperto e fila a schermo intero`, async ({ app, shell, openTab, testServer }) => {
    await tema(app, t);
    const page = await testServer.openReady(openTab, SITO);
    await pausa(500);
    const barra = await barraPage(app);
    await comandaBarra(app, 'clic');
    await apriAltro(app, true);
    await pannelloFermo(barra);
    await barra.screenshot({ path: `tests/.shots/g10-barra-${t}.png` });
    await comandaBarra(app, 'chiudi');
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      w._filoTabs.setContentFullscreen(true);
    });
    await pausa(800);
    await page.mouse.move(400, 200);
    await page.mouse.move(400, 0, { steps: 4 });
    await expect.poll(async () => app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      const tm = w._filoTabs; const tt = tm.tabs.find((x) => x.id === tm.activeId);
      return tt.view.getBounds().y;
    })).toBeGreaterThan(0);
    await shell.screenshot({ path: `tests/.shots/g10-fila-${t}.png` });
    await page.screenshot({ path: `tests/.shots/g10-pagina-${t}.png` });
  });
}

test('annullo di un riordino vecchio dopo un altro spostamento: torna solo quello', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const prima = await statoBarra(app);
  await app.evaluate(async () => {
    const R = globalThis.SN_REGISTRO_CAMBI;
    await R.con({ via: 'interfaccia', dove: 'barra' }, () => globalThis.SN_LAYOUT_ICONE.posa({ id: 'home', target: 'bar', beforeId: 'back' }));
    await R.attesa();
    await R.con({ via: 'interfaccia', dove: 'barra' }, () => globalThis.SN_LAYOUT_ICONE.posa({ id: 'qrCode', target: 'secondary', beforeId: null }));
    await R.attesa();
  });
  await expect.poll(async () => (await statoBarra(app)).secondary.includes('qrCode')).toBe(true);
  const lista = await app.evaluate(async () => { await globalThis.SN_REGISTRO_CAMBI.attesa(); return (await globalThis.chrome.storage.local.get('filo_cambi')).filo_cambi || []; });
  const icone = lista.filter((e) => e.tipo === 'icone');
  expect(icone.length).toBeGreaterThanOrEqual(2);
  const r = await app.evaluate(async (_e, id) => globalThis.SN_REGISTRO_CAMBI.annulla(id, { via: 'chat' }), icone.at(-2).id);
  expect(r.ok).toBe(true);
  await expect.poll(async () => (await statoBarra(app)).bar.indexOf('home')).toBe(prima.bar.indexOf('home'));
  expect((await statoBarra(app)).secondary).toContain('qrCode');
  expect((await statoBarra(app)).bar).not.toContain('qrCode');
});

test('a schermo intero, schede scoperte: il pulsante Massimizza della fila', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const stato = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const tm = w._filoTabs; const tt = tm.tabs.find((x) => x.id === tm.activeId);
    return { cf: tm.contentFullscreen, fs: w.isFullScreen(), max: w.isMaximized(), y: tt.view.getBounds().y, h: tt.view.getBounds().height, win: w.getContentSize() };
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.setContentFullscreen(true));
  await pausa(1000);
  console.log('dentro', JSON.stringify(await stato()));
  await page.mouse.move(400, 200);
  await page.mouse.move(400, 0, { steps: 4 });
  await expect.poll(async () => (await stato()).y).toBeGreaterThan(0);
  console.log('scoperte', JSON.stringify(await stato()), await shell.locator('#win-max').getAttribute('data-tip'), await shell.locator('#win-max').isVisible());
  await shell.locator('#win-max').click();
  await pausa(1500);
  console.log('dopo max', JSON.stringify(await stato()));
  await shell.mouse.move(600, 20);
  await pausa(1500);
  console.log('dopo attesa', JSON.stringify(await stato()));
});
