// Esplorazione del giro 2 (da cancellare): bloccata, la pagina resta spinta su schede nuove, cambi di scheda e ridimensionamenti.
import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';

const attiva = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return { b: t.view.getBounds(), larga: w.getContentSize()[0], n: w._filoTabs.tabs.length };
});

test('esplora lucchetto', async ({ app, openTab, testServer, shell }) => {
  await testServer.openReady(openTab, '<!doctype html><body style="margin:0;background:#fff"><h1>Uno</h1></body>');
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#testa .lucchetto').click();
  await expect.poll(async () => (await attiva(app)).b.x).toBe(56);
  await barra.screenshot({ path: 'tests/.shots/1722-g2-barra-chiaro.png' }).catch(() => {});

  await testServer.openReady(openTab, '<!doctype html><body><h1>Due</h1></body>');
  await expect.poll(async () => (await attiva(app)).b.x, { timeout: 4000 }).toBe(56);
  console.log('NUOVA', JSON.stringify(await attiva(app)));

  // Home dalla scheda nuova (Ctrl+T)
  await shell.evaluate(() => document.querySelector('#new-tab, [aria-label="Nuova scheda"], .new-tab')?.click());
  await new Promise((r) => setTimeout(r, 1500));
  console.log('HOME', JSON.stringify(await attiva(app)));
  expect((await attiva(app)).b.x).toBe(56);

  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito); w.setSize(900, 700); });
  await new Promise((r) => setTimeout(r, 800));
  const r = await attiva(app);
  console.log('RIDIM', JSON.stringify(r));
  expect(r.b.x).toBe(56);
  expect(r.b.width).toBe(r.larga - 56);

  await app.evaluate(async () => { const s = await globalThis.SN_STORAGE.getSettings(); await globalThis.SN_STORAGE.saveSettings?.({ ...s, theme: 'dark' }); });
  await new Promise((r) => setTimeout(r, 800));
  await barra.screenshot({ path: 'tests/.shots/1722-g2-barra-scuro.png' }).catch(() => {});
  const shotWin = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const img = await w.webContents.capturePage();
    return img.toPNG().toString('base64');
  });
  (await import('node:fs')).writeFileSync('tests/.shots/1722-g2-finestra.png', Buffer.from(shotWin, 'base64'));
});
