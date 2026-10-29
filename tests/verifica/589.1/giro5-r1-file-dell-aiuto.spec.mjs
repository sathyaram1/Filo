// #589.1 giro 5, rilievo 1 — l'Aiuto su un sito trova i documenti dell'utente, ma i bottoni del file (Apri, Mostra
// nella cartella, trascina) vengono rifiutati: le loro domande non sono nella lista di ciò che un sito può chiedere.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const SERVIZI = join(process.cwd(), 'src', 'main', 'services');

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

test('r1 dall\'Aiuto di un sito il file trovato si mostra nella sua cartella', async ({ app, openTab, testServer }) => {
  const file = join(cartellaTemporanea('aiuto-file-'), 'preventivo.txt');
  writeFileSync(file, 'preventivo del giardino');
  await app.evaluate(({ shell }, { dir, file: f }) => {
    process.mainModule.require(`${dir}/aiutoDocumenti.js`).configura({
      chiediSi: async () => true,
      cerca: async () => ({ risultati: [{ percorso: f, nome: 'preventivo.txt', tipo: 'txt', data: '' }] }),
      doveSta: async () => 'Documenti',
    });
    globalThis.__mostrati = [];
    shell.showItemInFolder = (p) => { globalThis.__mostrati.push(p); };
  }, { dir: SERVIZI, file });
  await testServer.openReady(openTab, '<h1>sito</h1>');
  const sito = dalPreload(app, (u) => u.startsWith('http://127.0.0.1'));

  const cerca = await sito('chrome.runtime.sendMessage({ type: "aiuto_cerca_documenti", cosa: "preventivo giardino" })');
  expect(cerca.nonTrovata || cerca.errore, 'il preload del sito non è stato raggiunto').toBeFalsy();
  const chiave = cerca.risposta?.candidati?.[0]?.chiave;
  expect(chiave, 'la ricerca dell\'Aiuto non ha trovato il file').toBeTruthy();

  const mostra = await sito(`chrome.runtime.sendMessage({ type: "aiuto_mostra_file", chiave: ${JSON.stringify(chiave)} })`);
  expect(mostra.risposta?.code, 'il bottone «Mostra nella cartella» dell\'Aiuto è rifiutato').not.toBe('forbidden');
  expect(mostra.risposta).toMatchObject({ ok: true });
  expect(await app.evaluate(() => globalThis.__mostrati)).toContain(file);

  const apri = await sito(`chrome.runtime.sendMessage({ type: "aiuto_apri_file", chiave: ${JSON.stringify(chiave)} })`);
  expect(apri.risposta?.code, 'il bottone «Apri» dell\'Aiuto è rifiutato').not.toBe('forbidden');
  const prendi = await sito(`chrome.runtime.sendMessage({ type: "aiuto_trascina_file", chiave: ${JSON.stringify(chiave)} })`);
  expect(prendi.risposta?.code, 'il trascinamento del file dall\'Aiuto è rifiutato').not.toBe('forbidden');
});
