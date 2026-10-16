// #843 — i siti dove Filo è spento: l'elenco si legge e si scrive ridotto ai nomi, chiunque l'abbia scritto, e il menu
// trova le voci che spengono Filo sulla scheda e sul riquadro cliccato. Logica pura, senza Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../src/shared/constants.js');
require('../../src/shared/nomiSito.js');
require('../../src/shared/storage.js');
const S = globalThis.SN_STORAGE;
const FiloSpento = require('../../src/main/services/handlers/filoSpento.js');

function magazzino(iniziale) {
  const dati = { ...iniziale };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (k) => ({ [k]: dati[k] }),
        set: async (o) => { Object.assign(dati, JSON.parse(JSON.stringify(o))); },
      },
    },
  };
  return dati;
}

test('un elenco salvato con indirizzi interi si legge coi nomi dei siti, e così si riscrive', async () => {
  const dati = magazzino({ settings: { blocklist: ['https://www.Docs.Google.com/document/d/x', 'docs.google.com', '127.0.0.1'] } });
  assert.deepEqual((await S.getSettings()).blocklist, ['docs.google.com', '127.0.0.1']);
  const dopo = await S.updateSettings({ blocklist: ['https://esempio.it/x', 'ESEMPIO.it'] });
  assert.deepEqual(dopo.blocklist, ['esempio.it']);
  assert.deepEqual(dati.settings.blocklist, ['esempio.it'], 'su disco va la forma ridotta');
});

test('il sito di una scheda e le voci che lo spengono, sottodomini compresi', () => {
  assert.equal(FiloSpento.sitoDi('https://www.Docs.Google.com/document/d/x'), 'docs.google.com');
  assert.equal(FiloSpento.sitoDi('filo://options/altro.html'), '');
  assert.equal(FiloSpento.sitoDi('http://127.0.0.1:8080/'), '');
  assert.equal(FiloSpento.sitoDi('non è un indirizzo'), '');
  const elenco = ['google.com', 'docs.google.com', 'banca.it', 'notgoogle.com'];
  assert.deepEqual(FiloSpento.vociCheSpengono(elenco, ['https://docs.google.com/d/1']), ['google.com', 'docs.google.com']);
  assert.deepEqual(FiloSpento.vociCheSpengono(elenco, ['https://blog.example/', 'https://www.banca.it/riquadro']), ['banca.it']);
  assert.deepEqual(FiloSpento.vociCheSpengono(elenco, ['https://altro.example/']), []);
  assert.deepEqual(FiloSpento.vociCheSpengono(null, ['https://docs.google.com/']), []);
});
