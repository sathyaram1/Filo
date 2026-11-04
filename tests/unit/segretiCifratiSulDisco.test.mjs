// #905.1 — col portachiavi la chiave di Safe Browsing e la password del proxy vanno sul disco cifrate come le chiavi
// API, e tornano in chiaro in memoria alla riapertura; un file vecchio con segreti in chiaro si riscrive cifrato. Senza
// portachiavi l'avviso «in chiaro» parte anche se il solo segreto è uno di questi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const STORAGE = join(__dirname, '..', '..', 'src', 'main', 'shim', 'storage.js');

let cifraturaAccesa = true;
const electronMock = {
  app: { getPath: () => process.env.FILO_USER_DATA, isReady: () => true },
  safeStorage: {
    isEncryptionAvailable: () => cifraturaAccesa,
    // Come un portachiavi vero il blob non contiene il testo: lo si rovescia.
    encryptString: (s) => Buffer.from([...String(s)].reverse().join(''), 'utf8'),
    decryptString: (b) => [...b.toString('utf8')].reverse().join(''),
  },
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return origLoad.call(this, request, parent, isMain);
};

// Ogni avvio è un modulo nuovo, con lo stato vuoto, come una riapertura di Filo.
function avvia(userData) {
  process.env.FILO_USER_DATA = userData;
  delete require.cache[require.resolve(STORAGE)];
  return require(STORAGE);
}

const SAFE = 'AIzaSyD-chiave-safe-browsing-5678';
const PASSWORD = 'passwordsegreta-del-proxy';
const PROXY = `mario:${PASSWORD}@gate.esempio.com:8080`;
const CHIAVE = 'sk-or-v1-chiave-api-di-prova-0123';

function impostazioni() {
  return {
    theme: 'dark',
    apiKeys: { openrouter: CHIAVE },
    proxy: { datacenter: PROXY, residential: 'http://gate2.esempio.com:8000', defaultCountry: 'fr' },
    security: { safeBrowse: { enabled: true, safeBrowsingKey: SAFE } },
  };
}

test('col portachiavi nessun segreto resta leggibile nel file, e alla riapertura tornano tutti', async () => {
  const userData = cartellaTemporanea('filo-segreti-cifrati-');
  try {
    cifraturaAccesa = true;
    const S = avvia(userData);
    await S.set({ settings: impostazioni() });
    await S.whenSettled();
    const testo = readFileSync(join(userData, 'storage.json'), 'utf8');
    for (const s of [SAFE, PASSWORD, 'mario', CHIAVE]) assert.equal(testo.includes(s), false, `${s} è sul disco in chiaro`);
    const suDisco = JSON.parse(testo).settings;
    assert.match(suDisco.segretiEnc, /^safeStorage:v1:/);
    assert.equal(suDisco.proxy.residential, 'http://gate2.esempio.com:8000', 'un proxy senza password resta com\'è');
    assert.equal(suDisco.security.safeBrowse.enabled, true);
    assert.deepEqual((await S.get('settings')).settings, impostazioni(), 'in memoria restano in chiaro');

    const dopo = avvia(userData);
    assert.deepEqual((await dopo.get('settings')).settings, impostazioni());
  } finally {
    togliCartella(userData);
  }
});

test('un file con la chiave di Safe Browsing e il proxy in chiaro si riscrive cifrato appena Filo lo legge', async () => {
  const userData = cartellaTemporanea('filo-segreti-migra-');
  try {
    cifraturaAccesa = true;
    writeFileSync(join(userData, 'storage.json'), JSON.stringify({ settings: impostazioni(), altro: 1 }), 'utf8');
    const S = avvia(userData);
    assert.deepEqual((await S.get('settings')).settings, impostazioni());
    await S.flushNow();
    await S.whenSettled();
    const testo = readFileSync(join(userData, 'storage.json'), 'utf8');
    for (const s of [SAFE, PASSWORD, CHIAVE]) assert.equal(testo.includes(s), false, `${s} è rimasto in chiaro`);
    assert.deepEqual((await avvia(userData).get('settings')).settings, impostazioni());
  } finally {
    togliCartella(userData);
  }
});

test('un valore riscritto in chiaro senza portachiavi vince sul blob vecchio alla riapertura', async () => {
  const userData = cartellaTemporanea('filo-segreti-dopo-');
  try {
    cifraturaAccesa = true;
    const S = avvia(userData);
    await S.set({ settings: impostazioni() });
    await S.whenSettled();
    const file = JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8'));
    file.settings.security.safeBrowse.safeBrowsingKey = 'AIzaSyD-scritta-dopo-in-chiaro';
    writeFileSync(join(userData, 'storage.json'), JSON.stringify(file), 'utf8');
    const s = (await avvia(userData).get('settings')).settings;
    assert.equal(s.security.safeBrowse.safeBrowsingKey, 'AIzaSyD-scritta-dopo-in-chiaro');
    assert.equal(s.proxy.datacenter, PROXY);
  } finally {
    togliCartella(userData);
  }
});

test('senza portachiavi l\'avviso parte anche se l\'unico segreto è la password del proxy o la chiave di Safe Browsing', async () => {
  for (const settings of [{ proxy: { datacenter: PROXY } }, { security: { safeBrowse: { safeBrowsingKey: SAFE } } }]) {
    const userData = cartellaTemporanea('filo-segreti-chiaro-');
    try {
      cifraturaAccesa = false;
      const S = avvia(userData);
      await S.set({ settings });
      await S.whenSettled();
      await new Promise((r) => setImmediate(r));
      const avvisi = S.statoDisco().avvisi.filter((a) => a.chiave === 'chiavi-in-chiaro');
      assert.equal(avvisi.length, 1, JSON.stringify(settings));
      assert.match(avvisi[0].testo, /in chiaro/);
      assert.deepEqual(JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8')).settings, settings, 'senza portachiavi niente si perde');
    } finally {
      cifraturaAccesa = true;
      togliCartella(userData);
    }
  }
});
