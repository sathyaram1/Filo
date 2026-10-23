// Verifica #1343 giro 11: esplorazione (Filo spento sul sito, riquadro in cima a schermo intero, cambi delle icone
// da parte, azioni sulle pagine di Filo).

import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const SITO = '<!doctype html><html><head><title>Prima</title></head><body style="height:1400px"><h1>Prima</h1></body></html>';
const DALLE_PREFERENZE = { tab: { id: 5, url: 'filo://preferences/preferences.html' }, url: 'filo://preferences/preferences.html' };
const imposta = (app, settings) => app.evaluate(async (_e, { s, da }) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: s }, da), { s: settings, da: DALLE_PREFERENZE });
const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());
const registro = (app) => app.evaluate(async () => {
  await globalThis.SN_REGISTRO_CAMBI.attesa();
  const r = await globalThis.chrome.storage.local.get('filo_cambi');
  return r.filo_cambi || [];
});

async function icona(app, id) {
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const ico = barra.locator(`#nav .ico[data-id="${id}"]`);
  if (!(await ico.count())) await barra.locator('#nav [data-altro]').click();
  return ico;
}

test('esplora: Filo spento sul sito, Condividi e QR della barra', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  await imposta(app, { blocklist: [new URL(page.url()).hostname] });
  await pausa(1500);
  await app.evaluate(({ clipboard }) => clipboard.writeText('niente'));
  const share = await icona(app, 'share');
  console.log('SHARE disabled', await share.getAttribute('aria-disabled'), 'sugg', await share.getAttribute('data-sugg'));
  await share.click({ force: true });
  await pausa(2000);
  console.log('SHARE appunti', await appunti(app), 'url', page.url());
  const qr = await icona(app, 'qrCode');
  console.log('QR disabled', await qr.getAttribute('aria-disabled'), 'sugg', await qr.getAttribute('data-sugg'));
  const tr = await icona(app, 'translate');
  console.log('TR disabled', await tr.getAttribute('aria-disabled'), 'sugg', await tr.getAttribute('data-sugg'));
  const sv = await icona(app, 'saveForLater');
  console.log('SV disabled', await sv.getAttribute('aria-disabled'), 'sugg', await sv.getAttribute('data-sugg'));
  await sv.click({ force: true });
  await pausa(2500);
  const salvate = await app.evaluate(async () => ((await globalThis.chrome.storage.local.get('savedPages')).savedPages || []).map((p) => p.url));
  console.log('SV salvate', JSON.stringify(salvate));
});

test('esplora: schermo intero, riquadro di un altro sito in cima, puntatore al bordo', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html('<!doctype html><html><body style="margin:0;background:#cde;height:100vh">Pubblicità</body></html>', { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Testa</title></head><body style="margin:0">
    <iframe src="${dentro}" style="display:block;width:100%;height:250px;border:0"></iframe><div style="height:1200px">Articolo</div></body></html>`);
  await expect.poll(() => page.frames().length).toBeGreaterThan(1);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.setContentFullscreen(true));
  await pausa(800);
  await page.mouse.move(400, 150);
  await page.mouse.move(400, 0, { steps: 5 });
  await pausa(1500);
  const s = await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    return { vis: tm.schedeInAlto.visibili, y: tm.tabs.find((t) => t.id === tm.activeId).view.getBounds().y };
  });
  console.log('IFRAME CIMA', JSON.stringify(s));
});

test('esplora: un\'icona messa in «Altro…» e riportata in vista: cambi del filo', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const iniziale = (await statoBarra(app));
  const prima = (await registro(app)).length;
  const cassetto = await barra.locator('#nav [data-altro]').boundingBox();
  const b = await barra.locator('#nav .ico[data-id="share"]').boundingBox();
  await barra.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await barra.mouse.down();
  await barra.mouse.move(b.x + b.width / 2 + 2, b.y + b.height / 2 - 6, { steps: 3 });
  await barra.mouse.move(b.x + b.width / 2, cassetto.y + cassetto.height - 3, { steps: 8 });
  await barra.mouse.up();
  await pausa(800);
  let reg = await registro(app);
  console.log('REG dopo cassetto', JSON.stringify(reg.slice(prima)));
  console.log('STATO', JSON.stringify((await statoBarra(app)).secondary));
  const ultimo = reg.filter((e) => e.tipo === 'icone').pop();
  if (ultimo) {
    const r = await app.evaluate(async (_e, id) => globalThis.SN_REGISTRO_CAMBI.annulla(id, { via: 'chat' }), ultimo.id);
    console.log('ANNULLA', JSON.stringify(r));
    await pausa(800);
    const dopo = await statoBarra(app);
    console.log('RIMESSO bar uguale', JSON.stringify(dopo.bar) === JSON.stringify(iniziale.bar), 'sec uguale', JSON.stringify(dopo.secondary) === JSON.stringify(iniziale.secondary));
    console.log('DOM', JSON.stringify(await barra.$$eval('#nav .ico[data-id]', (els) => els.map((e) => e.dataset.id))));
  }
});

test('esplora: Condividi e QR sulla home di Filo', async ({ app }) => {
  await app.evaluate(({ clipboard }) => clipboard.writeText('niente'));
  const share = await icona(app, 'share');
  console.log('HOME SHARE disabled', await share.getAttribute('aria-disabled'), 'sugg', await share.getAttribute('data-sugg'));
  await share.click({ force: true });
  await pausa(2000);
  console.log('HOME SHARE appunti', await appunti(app));
  const tr = await icona(app, 'translate');
  console.log('HOME TR disabled', await tr.getAttribute('aria-disabled'), 'sugg', await tr.getAttribute('data-sugg'));
});

test('esplora: Condividi sulla pagina d\'errore e sul PDF', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    tm.navigate(tm.activeId, 'http://127.0.0.1:9/irraggiungibile');
  });
  await pausa(4000);
  await app.evaluate(({ clipboard }) => clipboard.writeText('niente'));
  const share = await icona(app, 'share');
  console.log('ERR SHARE disabled', await share.getAttribute('aria-disabled'));
  await share.click({ force: true });
  await pausa(2000);
  console.log('ERR SHARE appunti', await appunti(app));
});
