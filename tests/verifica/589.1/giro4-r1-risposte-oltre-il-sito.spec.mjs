// #589.1 giro 4, rilievo 1 — domande che la lista ammette rispondono a un sito con ciò che Filo sa degli altri siti:
// i siti dove l'utente ha spento Filo o tiene il menu del sito, e se un testo è un segreto letto su un'altra pagina
// (e su quale). Isolamento rotto: mondo 999.

import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';

const SERVIZI = join(process.cwd(), 'src', 'main', 'services');
const IBAN = 'IT60X0542811101000000123456';

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

test('r1 un sito non si fa dire dove l\'utente ha spento Filo né dove tiene il menu del sito', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate(async () => {
    await window.filoShell.message({ type: 'update_settings', settings: { blocklist: ['banca-privata.example', 'clinica.example'], menuDelSito: { siti: ['figma.example'] } } });
  });
  await testServer.openReady(openTab, '<h1>sito</h1>', { pubblico: true });
  await openTab(testServer.html('<h1>quella che guardo</h1>'));
  const sito = dalPreload(app, (u) => u.startsWith('http://sito-pubblico.test'));

  const spento = await sito(chiedi('filo_spento_imposta', { spento: false }));
  const menu = await sito(chiedi('menu_del_sito_imposta', { attivo: false }));
  for (const r of [spento, menu]) {
    expect(r.nonTrovata || r.errore, 'il preload del sito non è stato raggiunto').toBeFalsy();
    const testo = JSON.stringify(r.risposta);
    expect(testo, 'la risposta a un sito porta i siti dove l\'utente ha spento Filo').not.toContain('banca-privata.example');
    expect(testo).not.toContain('clinica.example');
    expect(testo, 'la risposta a un sito porta i siti dove l\'utente tiene il menu del sito').not.toContain('figma.example');
  }
});

test('r1 un sito non controlla se un suo testo è un segreto che Filo ha letto su un\'altra pagina', async ({ app, openTab, testServer }) => {
  await app.evaluate((_e, { dir, iban }) => {
    process.mainModule.require(`${dir}/segretiLetti.js`).ricorda(`Coordinate per il bonifico: ${iban}`, 'dalla pagina posta.example');
  }, { dir: SERVIZI, iban: IBAN });
  await testServer.openReady(openTab, '<h1>sito</h1>', { pubblico: true });
  await openTab(testServer.html('<h1>quella che guardo</h1>'));
  const sito = dalPreload(app, (u) => u.startsWith('http://sito-pubblico.test'));

  const giusto = await sito(chiedi('controlla_campo', { testo: IBAN }));
  const sbagliato = await sito(chiedi('controlla_campo', { testo: 'IT02L1234512345123456789012' }));
  expect(giusto.nonTrovata || giusto.errore, 'il preload del sito non è stato raggiunto').toBeFalsy();
  expect(JSON.stringify(giusto.risposta), 'la risposta nomina la pagina dove Filo ha letto il segreto').not.toContain('posta.example');
  expect(giusto.risposta?.blocca, 'il sito distingue il segreto giusto da uno inventato').toBe(sbagliato.risposta?.blocca);
});
