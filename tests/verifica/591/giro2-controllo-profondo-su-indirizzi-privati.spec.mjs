// Verifica #591 — giro 2. Il controllo profondo parte anche sugli indirizzi
// della rete di casa.
//
// La segnalazione descriveva come caso peggiore che «qualunque indirizzo http
// fuori dai fidati fa partire un giudizio del modello più l'apertura della
// pagina in una finestra nascosta con JavaScript attivo». I freni chiesti
// (tetto, coda, tempo di vita, cache per dominio) ci sono; quello che parte
// non è cambiato. Fra gli indirizzi che lo fanno partire ci sono quelli della
// rete locale: il router, il NAS, un server di prova sulla propria macchina.
// Non possono essere una truffa per definizione — nessuno ci arriva da una
// mail — e ognuno costa un giudizio del modello sulla chiave condivisa più una
// finestra nascosta che carica quella pagina interna con JavaScript attivo.
//
// `localhost` è già escluso: è la prova che l'esclusione è prevista e che qui
// manca solo il resto della lista.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
const SB = require_(join(REPO, 'src/main/services/safebrowse/index.js'));

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

const PRIVATI = [
  'http://127.0.0.1:8080/admin',
  'http://10.0.0.5/setup',
  'http://192.168.1.1/',
  'http://mio-nas.local/',
];

function pulisci() {
  for (const c of Object.values(SB._caches)) {
    for (const u of PRIVATI) {
      const n = SB.normalize(u);
      if (n && n.registrable) { try { c.delete(n.registrable); } catch (_) {} }
    }
  }
  for (const s of Object.values(SB._inFlight)) s.clear();
}

test('gli indirizzi della rete locale non fanno partire il controllo profondo', async () => {
  pulisci();
  const giudizi = [];
  const finestre = [];
  SB.setProviders({
    gsb: null,
    rdap: null,
    ct: null,
    llm: async (meta) => { giudizi.push(meta && meta.host); return null; },
    sandbox: async (url) => { finestre.push(url); return null; },
  });
  for (const url of PRIVATI) SB.analyze(url, {}, () => {});
  await attendi(300);

  expect(giudizi,
    'nessun giudizio del modello per un indirizzo della rete di casa').toEqual([]);
  expect(finestre,
    'nessuna finestra nascosta aperta su una pagina della rete di casa').toEqual([]);
});

test('localhost è già escluso (caso di riscontro)', async () => {
  pulisci();
  const finestre = [];
  SB.setProviders({
    gsb: null,
    rdap: null,
    ct: null,
    llm: async () => null,
    sandbox: async (url) => { finestre.push(url); return null; },
  });
  SB.analyze('http://localhost:3000/', {}, () => {});
  await attendi(200);
  expect(finestre).toEqual([]);
});
