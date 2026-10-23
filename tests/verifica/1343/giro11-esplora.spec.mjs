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
  const prima = (await registro(app)).length;
  const r1 = await app.evaluate(async () => globalThis.SN_LAYOUT_ICONE.posa({ id: 'share', target: 'secondary', beforeId: null, via: 'interfaccia', dove: 'barra' }));
  console.log('POSA', JSON.stringify(r1));
  await pausa(500);
  const reg = await registro(app);
  console.log('REG nuovi', JSON.stringify(reg.slice(prima).map((e) => ({ tipo: e.tipo, via: e.via, label: e.label || e.etichetta, dove: e.dove }))));
  console.log('STATO', JSON.stringify(await statoBarra(app)));
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
