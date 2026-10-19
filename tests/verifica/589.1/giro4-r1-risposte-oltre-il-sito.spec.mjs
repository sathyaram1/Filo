// #589.1 giro 4, rilievo 1 — il caso ancora aperto: il controllo del campo dice a un sito se un suo testo è un
// segreto che Filo ha letto su un'altra pagina, e su quale (decisione chiesta all'owner). Isolamento rotto: mondo 999.

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
