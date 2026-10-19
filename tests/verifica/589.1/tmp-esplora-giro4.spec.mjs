import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';

const RADICE = join(process.cwd(), 'src', 'main', 'services');

function dalPreload(app, quale) {
  return (codice) => app.evaluate(async ({ BrowserWindow }, { src, codice: c }) => {
    // eslint-disable-next-line no-new-func
    const scegli = new Function('u', `return (${src})(u);`);
    const wcs = BrowserWindow.getAllWindows().flatMap((w) => (w._filoTabs?.tabs || []).map((t) => t.view.webContents));
    const wc = wcs.find((x) => { try { return scegli(x.getURL()); } catch (_) { return false; } });
    if (!wc) return { nonTrovata: true };
    try {
      return { risposta: await wc.executeJavaScriptInIsolatedWorld(999, [{ code: c }]) };
    } catch (e) { return { errore: String(e) }; }
  }, { src: quale.toString(), codice });
}
const chiedi = (tipo, extra = {}) => `chrome.runtime.sendMessage(${JSON.stringify({ type: tipo, ...extra })})`;
const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  return { attiva: w._filoTabs.activeId, tutte: w._filoTabs.tabs.map((t) => ({ id: t.id, url: String(t.url || '') })) };
});

test('E1 risposte', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate(async () => {
    await window.filoShell.message({ type: 'update_settings', settings: { blocklist: ['banca-privata.example', 'clinica.example'], menuDelSito: { siti: ['figma.example'] } } });
  });
  const letti = await app.evaluate((_e, dir) => {
    const SL = process.mainModule.require(`${dir}/segretiLetti.js`);
    SL.ricorda('Il tuo codice di verifica è 482913, non darlo a nessuno. IBAN IT60X0542811101000000123456', 'dalla pagina posta.example');
    return SL.tutti ? SL.tutti() : null;
  }, RADICE);
  const router = testServer.html('<title>ROUTER-PANNELLO-5891</title><h1>admin</h1>');
  const img = testServer.asset(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'), 'image/png');
  await testServer.openReady(openTab, '<h1>sito</h1>', { pubblico: true });
  const sito = dalPreload(app, (u) => u.startsWith('http://sito-pubblico.test'));
  const out = {};
  out.spento = await sito(chiedi('filo_spento_imposta', { spento: false }));
  out.menu = await sito(chiedi('menu_del_sito_imposta', { attivo: false }));
  out.campoGiusto = await sito(chiedi('controlla_campo', { testo: '482913' }));
  out.campoIban = await sito(chiedi('controlla_campo', { testo: 'IT60X0542811101000000123456' }));
  out.campoSbagliato = await sito(chiedi('controlla_campo', { testo: '111111' }));
  const port = new URL(router).port;
  out.metaDiretto = await sito(chiedi('fetch_link_meta', { url: router }));
  out.metaV6 = await sito(chiedi('fetch_link_meta', { url: router.replace('127.0.0.1', '[::ffff:7f00:1]') }));
  out.img = await sito(chiedi('image_bytes', { url: img }));
  if (out.img?.risposta?.dataUrl) out.img.risposta.dataUrl = out.img.risposta.dataUrl.slice(0, 40);
  console.log(JSON.stringify({ letti, ...out }), port);
});

test('E2 aperture da sfondo', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>sito</h1>', { pubblico: true });
  await openTab(testServer.html('<h1>quella che guardo</h1>'));
  const prima = await schede(app);
  const sito = dalPreload(app, (u) => u.startsWith('http://sito-pubblico.test'));
  const a = await sito(chiedi('apri_collegamento_filo', { url: 'https://example.org/promo' }));
  await new Promise((r) => setTimeout(r, 800));
  const dopo1 = await schede(app);
  const b = await sito(chiedi('wallet_invite_open', { link: 'filo://invito/ABCD1234' }));
  await new Promise((r) => setTimeout(r, 800));
  const dopo2 = await schede(app);
  console.log(JSON.stringify({ prima: prima.attiva, a, dopo1: dopo1.attiva, b, dopo2 }));
});
