// #520 — le chiamate a Scryfall passano da una coda SERIALIZZATA (rate limit
// di cortesia): una sola richiesta appesa — server che accetta e poi tace —
// bloccava per sempre anche tutte quelle dopo. Per l'utente è l'app che "si
// blocca": anteprime, ricerche e pareri smettono di rispondere e non c'è
// nessun errore da leggere. Senza la scadenza in apiGet la seconda richiesta
// qui sotto non arriva mai e il test fallisce con "appeso".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', '..', 'src');

process.env.FILO_DATI_TETTO_MS = '80';

// Cache carte su chrome.storage: nei test basta un finto in RAM.
const memoria = {};
globalThis.chrome = globalThis.chrome || {
  storage: {
    local: {
      get: async (k) => ({ [k]: memoria[k] }),
      set: async (o) => { Object.assign(memoria, o); },
    },
  },
};

require(join(SRC, 'shared', 'constants.js'));
require(join(SRC, 'shared', 'scryfallQuery.js'));
require(join(SRC, 'shared', 'netTimeout.js'));
require(join(SRC, 'main', 'services', 'scryfall.js'));
const Scry = globalThis.SN_SCRYFALL;

function erroreAnnullato() {
  const e = new Error('This operation was aborted');
  e.name = 'AbortError';
  return e;
}

async function esitoEntro(p, ms = 3000) {
  return Promise.race([
    p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e })),
    new Promise((r) => setTimeout(() => r('appeso'), ms)),
  ]);
}

test('una richiesta appesa scade e NON blocca la coda delle successive', async () => {
  const CARTA = {
    id: 'bolt-1', name: 'Lightning Bolt', mana_cost: '{R}', cmc: 1,
    type_line: 'Instant', colors: ['R'], color_identity: ['R'],
    image_uris: { normal: 'https://cards.test/bolt.jpg' },
    prices: { eur: '1.10' }, legalities: { commander: 'legal' },
    scryfall_uri: 'https://scryfall.com/card/bolt',
  };
  Scry._setFetch((url, opts) => {
    const signal = opts && opts.signal;
    // La PRIMA chiamata (una ricerca) resta appesa; la seconda risponderebbe
    // subito — se solo le arrivasse il turno.
    if (String(url).includes('/cards/search')) {
      return new Promise((_res, rej) => {
        if (!signal) return;
        signal.addEventListener('abort', () => rej(erroreAnnullato()), { once: true });
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => CARTA });
  });

  const appesa = esitoEntro(Scry.search('o:haste'));
  const dopo = esitoEntro(Scry.named('Lightning Bolt'));

  const r1 = await appesa;
  assert.notEqual(r1, 'appeso', 'la richiesta appesa deve scadere da sola');
  assert.equal(r1.ok, false);
  assert.equal(r1.e.code, 'TIMEOUT');

  const r2 = await dopo;
  assert.notEqual(r2, 'appeso', 'la coda deve ripartire: la richiesta dopo va servita');
  assert.equal(r2.ok, true);
  assert.equal(r2.v.name, 'Lightning Bolt');

  Scry._setFetch(null);
});
