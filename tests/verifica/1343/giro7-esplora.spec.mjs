// Verifica #1343 giro 7: esplorazione (si cancella prima della critica).

import { test, expect } from '../../fixtures/electron.mjs';
import { iconaDellaBarra, barraPage, statoBarra, comandaBarra, pannelloFermo, premi } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const SITO = '<!doctype html><html><head><title>Prima</title></head><body style="height:1400px"><h1>Prima</h1><p>Testo della pagina.</p></body></html>';
const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());
const naviga = (app, u) => app.evaluate(({ BrowserWindow }, url) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  w._filoTabs.navigate(w._filoTabs.activeId, url);
}, u);
const statiPagina = async (app) => {
  const barra = await barraPage(app);
  return barra.evaluate(() => [...document.querySelectorAll('#nav .ico')].map((b) => `${b.dataset.id}:${b.getAttribute('aria-disabled')}:${b.dataset.sugg || ''}`));
};

test('E1 pagine di Filo: stato delle azioni sulla pagina', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  for (const u of ['filo://newtab/', 'filo://history/history.html', 'filo://preferences/preferences.html']) {
    await naviga(app, u);
    await pausa(2500);
    await iconaDellaBarra(app, 'share');
    console.log('STATI', u, JSON.stringify(await statiPagina(app)));
    await app.evaluate(({ clipboard }) => clipboard.writeText('niente'));
    const share = await iconaDellaBarra(app, 'share');
    if ((await share.getAttribute('aria-disabled')) !== 'true') {
      await share.click();
      await pausa(1500);
      console.log('APPUNTI', u, await appunti(app));
    }
    await comandaBarra(app, 'chiudi');
    await pausa(400);
  }
});

test('E2 barra in tema chiaro e scuro, e menu del tasto destro', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.screenshot({ path: 'tests/.shots/g7-barra-chiara.png' });
  await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { theme: 'dark' } }, { url: 'filo://preferences/preferences.html' }));
  await pausa(1200);
  await barra.screenshot({ path: 'tests/.shots/g7-barra-scura.png' });
  await comandaBarra(app, 'chiudi');
  await pausa(500);
  await page.mouse.click(300, 200, { button: 'right' });
  await pausa(1200);
  await page.screenshot({ path: 'tests/.shots/g7-menu-scuro.png' });
});

test('E3 da tastiera: Ctrl+Shift+B, frecce fino a Condividi, Invio', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const url = page.url();
  await app.evaluate(({ clipboard }) => clipboard.writeText('niente'));
  await premi(app, 'pagina', 'B', ['control', 'shift']);
  const barra = await barraPage(app);
  await pausa(800);
  const s = await statoBarra(app);
  console.log('APERTA', JSON.stringify({ aperta: s.aperta, motivo: s.motivo, bar: s.bar }));
  const ids = s.bar;
  const quante = ids.indexOf('share');
  const attivo = await barra.evaluate(() => document.activeElement && (document.activeElement.dataset.id || document.activeElement.id || document.activeElement.className));
  console.log('FUOCO', attivo);
  for (let i = 0; i < quante + 3; i++) {
    const a = await barra.evaluate(() => document.activeElement && document.activeElement.dataset.id);
    if (a === 'share') break;
    await premi(app, 'barra', 'Down');
    await pausa(80);
  }
  console.log('FUOCO2', await barra.evaluate(() => document.activeElement && document.activeElement.dataset.id));
  await premi(app, 'barra', 'Return');
  await pausa(2000);
  console.log('APPUNTI', await appunti(app), 'voluto', url);
});

test('E4 schermo intero: angolo in alto a sinistra', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const page = await testServer.openReady(openTab, SITO.replace('Prima', 'Seconda'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.setContentFullscreen(true));
  await pausa(800);
  await page.mouse.move(300, 200);
  await page.mouse.move(1, 0, { steps: 4 });
  await pausa(1200);
  const s = await statoBarra(app);
  const y = await app.evaluate(({ BrowserWindow }) => { const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs; return tm.tabs.find((t) => t.id === tm.activeId).view.getBounds(); });
  console.log('ANGOLO', JSON.stringify({ barra: s.aperta, bounds: s.bounds, vista: y }));
  await page.screenshot({ path: 'tests/.shots/g7-angolo.png' });
  await shell.screenshot({ path: 'tests/.shots/g7-angolo-shell.png' });
});
