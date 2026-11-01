// Esplorazione della verifica #1722 giro 1: aspetto del lucchetto e della barra bloccata, schede e finestre nuove.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo, premi } from '../../helpers/barra.mjs';

const OUT = 'tests/.shots/1722';
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const SITO = `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif;height:1400px;background:#fff">
  <h1>Pagina</h1><p>Testo della pagina che sta accanto alla barra.</p></body></html>`;
const pagina = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return t.view.getBounds();
});

test('aspetto: aperta, bloccata, chiaro e scuro; schede nuove e ridimensionamento', async ({ app, openTab, testServer }) => {
  mkdirSync(OUT, { recursive: true });
  const page = await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.screenshot({ path: `${OUT}/aperta-chiaro.png` });
  await barra.locator('#testa .lucchetto').hover();
  await pausa(700);
  await barra.screenshot({ path: `${OUT}/aperta-hover-lucchetto.png` });
  await barra.locator('#testa .lucchetto').click();
  await expect.poll(async () => (await pagina(app)).x).toBe(56);
  await pausa(500);
  await barra.screenshot({ path: `${OUT}/bloccata-chiaro.png` });
  await page.screenshot({ path: `${OUT}/pagina-accanto.png` });
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  await pausa(800);
  await barra.screenshot({ path: `${OUT}/bloccata-scuro.png` });

  // Scheda nuova e home: restano accanto.
  const p2 = await testServer.openReady(openTab, SITO);
  await pausa(300);
  expect((await pagina(app)).x).toBe(56);
  expect((await statoBarra(app)).aperta).toBe(true);
  await premi(app, 'scheda', 'T', ['control']);
  await pausa(1500);
  console.log('dopo Ctrl+T', JSON.stringify(await pagina(app)), JSON.stringify(await statoBarra(app)));
  // Ridimensionamento.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).setContentSize(700, 600));
  await pausa(800);
  const b = await pagina(app);
  console.log('dopo resize', JSON.stringify(b), JSON.stringify(await statoBarra(app)));
  expect(b.x).toBe(56);
  expect(b.width).toBe(700 - 56);
  void p2;
});

test('finestra nuova con la barra bloccata', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  await barraPage(app);
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ barraLaterale: { bloccata: true } }));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w._filoTabs.barra.impostazioni({ ...w._filoTabs.barra.opzioni, bloccata: true });
  });
  await expect.poll(async () => (await pagina(app)).x).toBe(56);
  await premi(app, 'scheda', 'N', ['control']);
  await pausa(4000);
  const tutte = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((x) => x._filoTabs).map((w) => {
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return { incognito: !!w._filoIncognito, aperta: w._filoTabs.barra.aperta, motivo: w._filoTabs.barra.motivo, x: t ? t.view.getBounds().x : null, spazio: w._filoTabs.barra.spazioPagina };
  }));
  console.log('finestre', JSON.stringify(tutte));
});
