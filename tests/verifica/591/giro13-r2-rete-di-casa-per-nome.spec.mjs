// Verifica #591, giro 13 — la rete di casa si riconosce solo dagli indirizzi numerici e da alcuni suffissi.
// Un dispositivo raggiunto per nome senza punto (homeassistant, router) o con un suffisso che su internet non esiste
// (speedport.ip) passa ancora dall'elenco dei siti di truffa, dalle domande sull'età, dal modello e dalla finestra nascosta.
// Niente Electron: rilevatore e classificatore sono logica pura, i servizi di rete sono finti.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
const SB = require_(join(REPO, 'src/main/services/safebrowse/index.js'));
const GEO = require_(join(REPO, 'src/main/services/geoBlockClassifier.js'));

const DISPOSITIVI = [
  'http://homeassistant:8123/auth/authorize',
  'http://router/cgi-bin/luci/;stok=0a1b2c3d/admin',
  'http://speedport.ip/html/login/index.html',
];

function pulisci() {
  for (const c of Object.values(SB._caches || {})) {
    if (c && c.m && typeof c.m.clear === 'function') c.m.clear();
  }
}

async function usciti(url) {
  pulisci();
  const fuori = [];
  SB.setProviders({
    gsb: async (u) => { fuori.push(`elenco truffe: ${u}`); return null; },
    rdap: async (r) => { fuori.push(`età di ${r}`); return null; },
    ct: async (r) => { fuori.push(`certificati di ${r}`); return null; },
    llm: async (m) => { fuori.push(`modello: ${m.host}`); return null; },
    sandbox: async (u) => { fuori.push(`finestra nascosta: ${u}`); return null; },
  });
  await new Promise((ok) => { SB.analyze(url, { hasPassword: true }, ok); setTimeout(ok, 150); });
  return fuori;
}

test('un dispositivo di casa raggiunto per nome non esce verso i controlli di rete', async () => {
  const partiti = {};
  for (const url of DISPOSITIVI) {
    const f = await usciti(url);
    if (f.length) partiti[url] = f;
  }
  expect(partiti, 'indirizzo, codice di sessione e nome del dispositivo restano in casa').toEqual({});
});

test('la pagina di divieto di un dispositivo di casa raggiunto per nome non va al modello', async () => {
  const mandati = [];
  for (const url of DISPOSITIVI) {
    const host = new URL(url).hostname;
    await GEO.classify(
      { title: '403 Forbidden', text: 'Accesso negato. Amministratore: mario.rossi@example.com', statusCode: 403, host, url },
      { complete: async () => { mandati.push(host); return 'geo_block'; }, cache: GEO.createCache() },
    );
  }
  expect(mandati, 'titolo e testo della pagina del dispositivo restano in casa').toEqual([]);
});

test('caso di riscontro: un indirizzo pubblico in chiaro i controlli li riceve', async () => {
  expect((await usciti('http://accesso-giro13.esempio-pubblico.com/login')).length).toBeGreaterThan(0);
});
