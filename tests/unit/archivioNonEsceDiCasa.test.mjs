// Unit test — chiudere una scheda della rete di casa non manda niente fuori
// (#591, nono giro di verifica).
//
// Ogni scheda che si chiude viene archiviata e poi arricchita: titolo e testo
// vanno al modello per il riassunto e l'indice di ricerca. L'archivio è locale
// e prende tutto; è l'arricchimento che esce di casa, e dal pannello del
// router, dal NAS, dalla stampante e dall'applicazione in prova non deve
// uscire niente — la stessa regola del riordino automatico e degli stadi di
// rete del rilevamento siti pericolosi. Senza la correzione il primo caso è
// rosso.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require_ = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// La scheda vive dentro Electron: qui serve solo la sua forma, non i suoi
// servizi. La decisione che si prova è tutta in JavaScript.
const caricaOriginale = Module._load;
Module._load = function (richiesta, ...resto) {
  if (richiesta === 'electron') {
    return {
      WebContentsView: class {}, Menu: {}, MenuItem: class {},
      session: { fromPartition: () => ({}) }, shell: {}, BrowserWindow: class {},
    };
  }
  return caricaOriginale.call(this, richiesta, ...resto);
};
require_(join(ROOT, 'src/main/services/safebrowse/index.js'));
require_(join(ROOT, 'src/shared/tabTriage.js'));
const { TabManager } = require_(join(ROOT, 'src/main/tabs.js'));
Module._load = caricaOriginale;

const CASA = [
  'http://192.168.1.1/admin?session=abc123',
  'http://10.0.0.5/setup',
  'http://172.16.4.2/status',
  'http://127.0.0.1:3000/dashboard',
  'http://localhost:8080/',
  'http://mio-nas.local/documenti',
  'http://stampante.lan/',
];

async function chiudi(urls) {
  const archiviate = [];
  const uscite = [];
  globalThis.SN_ARCHIVED_TABS = { archive: async (e) => { archiviate.push(e.url); return { id: 'a' + archiviate.length }; } };
  globalThis.SN_TAB_ENRICH = (id, carico) => { uscite.push(carico); };
  const tm = Object.create(TabManager.prototype);
  tm.incognito = false;
  tm.tabs = [];
  for (const url of urls) {
    const tab = { id: 1, url, title: 'Pannello di casa', isInternal: false, contentExtract: 'chiave WPA2 segreto123' };
    tm.tabs = [tab];
    tm._archiveClosedTab(tab, 'manual');
  }
  await new Promise((r) => setTimeout(r, 50));
  return { archiviate, uscite };
}

test('dalle schede della rete di casa non esce niente', async () => {
  const { archiviate, uscite } = await chiudi(CASA);
  assert.deepEqual(uscite, [], 'titolo e testo di una pagina di casa non vanno al modello');
  assert.deepEqual(archiviate, CASA, 'l\'archivio è locale e continua a ritrovarle');
});

test('fuori casa la scheda chiusa viene riassunta come prima', async () => {
  const { uscite } = await chiudi(['https://www.esempio.com/articolo']);
  assert.equal(uscite.length, 1);
});
