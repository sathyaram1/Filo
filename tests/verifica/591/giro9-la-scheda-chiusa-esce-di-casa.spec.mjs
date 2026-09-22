// Verifica #591 — giro 9. Chiudere una scheda della rete di casa manda al
// modello il testo di quella pagina.
//
// Il giro 5 ha chiuso questa porta sul riconoscimento del blocco geografico, il
// giro 6 sullo stadio di rete della verifica dei siti pericolosi, il giro 8 sul
// riordino automatico delle schede: quello che Filo fa partire da solo e si
// porta dietro il CONTENUTO della pagina non deve partire sugli indirizzi della
// rete di casa — il pannello del router, il NAS, l'applicazione in prova sulla
// propria macchina.
//
// Resta aperta la strada più battuta di tutte: quando una scheda si chiude,
// Filo la archivia e poi la arricchisce, cioè manda indirizzo, titolo e testo
// al modello per farne un riassunto e un vettore di ricerca. Lì nessuno si
// chiede se quella pagina venga da casa. È la stessa domanda del riordino
// automatico, che al giro 8 l'ha ricevuta, su un cammino che l'utente percorre
// ogni giorno.
//
// Logica pura: Electron è finto, nessuna rete.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));

// La scheda vive dentro Electron: qui serve solo la sua forma, non i suoi
// servizi. Quello che si prova è la decisione, che è tutta in JavaScript.
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
require_(join(REPO, 'src/main/services/safebrowse/index.js'));
require_(join(REPO, 'src/shared/tabTriage.js'));
const { TabManager } = require_(join(REPO, 'src/main/tabs.js'));
Module._load = caricaOriginale;

const T = globalThis.SN_TAB_TRIAGE;

// Gli stessi indirizzi con cui i giri 2, 5, 6 e 8 hanno chiuso la porta altrove.
const CASA = [
  'http://192.168.1.1/admin?session=abc123',
  'http://10.0.0.5/setup',
  'http://127.0.0.1:3000/dashboard',
  'http://localhost:8080/',
  'http://mio-nas.local/documenti',
  'http://stampante.lan/',
];

function chiudiSchede(urls) {
  const mandate = [];
  globalThis.SN_ARCHIVED_TABS = { archive: async () => ({ id: 'a' + mandate.length }) };
  globalThis.SN_TAB_ENRICH = (id, carico) => { mandate.push({ id, ...carico }); };
  const tm = Object.create(TabManager.prototype);
  tm.incognito = false;
  tm.tabs = [];
  for (const url of urls) {
    const tab = {
      id: 1, url, title: 'Pannello di casa', isInternal: false,
      contentExtract: 'SSID casa-mia, chiave WPA2 segreto123, dispositivi collegati',
    };
    tm.tabs = [tab];
    tm._archiveClosedTab(tab, 'manual');
  }
  return mandate;
}

test('chiudere una scheda della rete di casa non deve mandare il testo al modello', async () => {
  const mandate = chiudiSchede(CASA);
  await new Promise((r) => setTimeout(r, 200));
  expect(
    mandate,
    'di ogni scheda chiusa partono titolo e testo verso il modello, per riassunto e ricerca: '
    + `le pagine della rete di casa non devono entrarci (partite ${mandate.length})`,
  ).toHaveLength(0);
});

test('caso di riscontro: fuori casa la scheda chiusa viene riassunta, e l\'esclusione esiste già', async () => {
  const mandate = chiudiSchede(['https://www.esempio.com/articolo']);
  await new Promise((r) => setTimeout(r, 200));
  expect(mandate).toHaveLength(1);
  // La stessa domanda il riordino automatico se la fa dal giro 8.
  for (const url of CASA) expect(T.isTriageableUrl(url), url).toBe(false);
  expect(T.isTriageableUrl('https://www.esempio.com/articolo')).toBe(true);
});
