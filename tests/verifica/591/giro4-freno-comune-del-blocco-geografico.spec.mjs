// Verifica #591 — giro 4. Il freno nuovo del riconoscimento del blocco
// geografico aveva, accanto al conto di chi possiede il sito, un conto COMUNE
// a tutti i siti: sessanta chiamate per un'ora. Una risorsa condivisa che una
// sola pagina ostile poteva consumare tutta.
//
// Da lì in poi, per un'ora, il riconoscimento non partiva più per NESSUN sito,
// compreso quello legittimo che l'utente apre subito dopo e che il paese
// blocca davvero: la proposta di riaprirlo da un altro paese non arrivava, e
// niente lo diceva.
//
// Dopo la correzione il conto comune è una raffica corta e chi rinuncia per
// colpa sua lo dichiara: la scheda riprova finché l'utente è rimasto su quella
// pagina, quindi il sito legittimo il suo riconoscimento lo ottiene. Le pagine
// della raffica, che la scheda ha già lasciato, non tornano in fila.
//
// Logica pura: la chiamata al modello è finta, la scheda è un oggetto finto
// con i metodi veri di Filo installati sopra.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
const GB = require_(join(REPO, 'src/main/services/geoBlockClassifier.js'));
const { installGeoBlock } = require_(join(REPO, 'src/main/tabs/tabGeoBlock.js'));

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

// La pagina bloccata dal paese che l'utente apre dopo la raffica.
const LEGITTIMO = {
  testo: 'Questo contenuto non è disponibile nel tuo paese',
  host: 'esempio-tv-591-g4.it',
  url: 'https://esempio-tv-591-g4.it/diretta',
};

// Il banco: una cache sola per tutti (come in Filo, dove ne esiste una), la
// chiamata al modello finta, e il classificatore esposto dove la scheda lo
// cerca.
function banco() {
  const chiamate = [];
  const cache = GB.createCache();
  const complete = async () => { chiamate.push(1); return 'geo_block'; };
  globalThis.SN_GEO_CLASSIFY = (input) => GB.classify(input, { complete, cache });
  return { chiamate, cache };
}

// Una scheda finta ferma su `url`, con i metodi veri installati sopra.
function schedaSu(url) {
  class FintoTabManager {
    constructor() {
      this.tabs = [{
        id: 1, title: '', _lastStatus: 403,
        view: { webContents: { getURL: () => url, isDestroyed: () => false, send() {} } },
      }];
      this.rilevati = [];
    }
  }
  installGeoBlock(FintoTabManager);
  const tm = new FintoTabManager();
  tm._geoBlockDetected = (tab, u, fonte, dettaglio) => { tm.rilevati.push({ u, fonte, dettaglio }); };
  return tm;
}

// Una pagina ostile che si porta da sola su percorsi e sotto-indirizzi sempre
// nuovi: ognuno è una risposta ambigua, e ognuno vorrebbe un gettone comune.
async function raffica(quanti) {
  for (let i = 1; i <= quanti; i++) {
    await globalThis.SN_GEO_CLASSIFY({
      statusCode: 403,
      text: 'vietato',
      host: `esca-${i}.pages.dev`,
      url: `http://esca-${i}.pages.dev/p${i}`,
    });
  }
}

test('la raffica di una pagina ostile non spegne il riconoscimento per gli altri', async () => {
  const b = banco();
  await raffica(60);
  expect(b.chiamate.length, 'qualche chiamata deve partire').toBeGreaterThan(0);
  expect(b.chiamate.length,
    'la raffica va strozzata mentre avviene, non lasciata correre per sessanta pagine')
    .toBeLessThan(60);

  // Il sito legittimo bloccato nel paese dell'utente, dove l'utente resta.
  const tm = schedaSu(LEGITTIMO.url);
  tm._geoLevel2Check(tm.tabs[0], LEGITTIMO.url, LEGITTIMO.testo);
  await attendi(GB.FRENO_RAFFICA_MS + 1200);

  expect(tm.rilevati.map((r) => r.u),
    'il blocco geografico va riconosciuto: il conto speso da un altro sito non è suo')
    .toEqual([LEGITTIMO.url]);
});

test('caso di riscontro: senza raffica lo stesso sito viene riconosciuto subito', async () => {
  banco();
  const tm = schedaSu(LEGITTIMO.url);
  tm._geoLevel2Check(tm.tabs[0], LEGITTIMO.url, LEGITTIMO.testo);
  await attendi(200);
  expect(tm.rilevati.map((r) => r.u)).toEqual([LEGITTIMO.url]);
});

test('la pagina che la scheda ha lasciato non torna in fila', async () => {
  banco();
  await raffica(60);
  // La scheda è già altrove quando scade il rinvio.
  const tm = schedaSu('https://altro-sito-qualunque.it/');
  tm._geoLevel2Check(tm.tabs[0], LEGITTIMO.url, LEGITTIMO.testo);
  await attendi(GB.FRENO_RAFFICA_MS + 1200);
  expect(tm.rilevati, 'una pagina lasciata non deve rubare il posto a quella dove l\'utente è').toEqual([]);
});
