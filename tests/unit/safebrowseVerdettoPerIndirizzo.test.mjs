// Unit test — il verdetto del controllo profondo è dell'INDIRIZZO, il freno è
// del DOMINIO (#591, secondo giro di verifica).
//
// Il freno che impedisce alla verifica dei siti pericolosi di ripartire a ogni
// sottodominio era stato messo sul dominio registrabile insieme al verdetto.
// Su un sito normale il dominio registrabile è il sito. Sulle piattaforme dove
// ogni utente riceve un suo sotto-indirizzo (pages.dev, github.io, vercel.app,
// i blog ospitati) è la PIATTAFORMA, e da lì il verdetto di un sito valeva per
// tutti gli altri: un sito di truffa sbarrava con la pagina rossa i siti
// innocenti vicini, e il «pulito» di un sito innocente impediva del tutto il
// controllo del sito di truffa vicino.
//
// Senza la correzione i primi tre casi sono rossi.
//
// L'ultima parte difende l'altra correzione dello stesso giro: gli indirizzi
// della rete di casa (router, NAS, stampante, server di prova) non fanno
// partire né il giudizio del modello né la finestra nascosta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require_ = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SB = require_(join(ROOT, 'src/main/services/safebrowse/index.js'));
const engine = require_(join(ROOT, 'src/main/services/safebrowse/engine.js'));

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));
const DA_EMAIL = { linkOrigin: 'email', hasPassword: true };

function pulisci() {
  for (const c of Object.values(SB._caches)) c.clear();
  for (const s of Object.values(SB._inFlight)) s.clear();
}

test('la finestra nascosta di un sito non marchia i siti vicini della stessa piattaforma', async () => {
  pulisci();
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async () => null,
    sandbox: async () => ({ verdict: 'dangerous', finalUrl: 'https://x', redirects: [], download: 'setup.exe' }),
  });
  SB.analyze('https://paypa1-accedi.pages.dev/login', DA_EMAIL, () => {});
  await attendi(30);
  assert.equal(
    SB.checkSync('https://paypa1-accedi.pages.dev/login', DA_EMAIL).level, 'pericoloso',
    'il sito controllato deve restare pericoloso',
  );
  for (const url of [
    'https://portfolio-di-marco.pages.dev/',
    'https://documentazione-progetto.pages.dev/guida',
  ]) {
    assert.notEqual(SB.checkSync(url, {}).level, 'pericoloso', `${url} non deve ereditare il verdetto del vicino`);
  }
});

test('il giudizio del modello su un sito non mette l\'avviso sui siti vicini', async () => {
  pulisci();
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async () => ({ suspicious: true, reason: 'Chiede credenziali su un dominio non ufficiale.', confidence: 'high' }),
    sandbox: async () => null,
  });
  SB.analyze('https://paypa1-accedi.pages.dev/login', DA_EMAIL, () => {});
  await attendi(30);
  assert.equal(SB.checkSync('https://ricette-della-nonna.pages.dev/torte', {}).level, 'safe');
});

test('un vicino già controllato non impedisce il controllo di un sito di truffa', async () => {
  pulisci();
  const finestre = [];
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async () => ({ suspicious: false, reason: null }),
    sandbox: async (url) => { finestre.push(url); return { verdict: 'clean' }; },
  });
  SB.analyze('https://ap0le-store.pages.dev/x', DA_EMAIL, () => {});
  await attendi(30);
  assert.equal(finestre.length, 1);
  SB.analyze('https://banca-intesa-accesso.pages.dev/login', DA_EMAIL, () => {});
  await attendi(30);
  assert.equal(finestre.length, 2, 'ogni sito deve avere il suo controllo, non quello del vicino');
});

test('una spruzzata di sottodomini non moltiplica le chiamate: il conto è del dominio', async () => {
  pulisci();
  let giudizi = 0;
  let finestre = 0;
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async () => { giudizi++; return { suspicious: false, reason: null }; },
    sandbox: async () => { finestre++; return { verdict: 'clean' }; },
  });
  // Uno alla volta, aspettando ogni volta: è il modo in cui una spruzzata
  // arriva davvero, una navigazione dopo l'altra, e l'unico freno che resta è
  // il conto del dominio.
  for (let i = 0; i < 40; i++) {
    SB.analyze(`http://paypa1-accedi-${i}.esempio-spruzzata-591.tk/login`, DA_EMAIL, () => {});
    await attendi(2);
  }
  assert.equal(giudizi, SB.DEEP_MAX_PER_DOMAIN, 'quaranta sottodomini, non quaranta giudizi');
  assert.equal(finestre, SB.DEEP_MAX_PER_DOMAIN, 'quaranta sottodomini, non quaranta finestre');
});

test('gli indirizzi della rete di casa non fanno partire il controllo profondo', async () => {
  pulisci();
  const giudizi = [];
  const finestre = [];
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async (meta) => { giudizi.push(meta && meta.host); return null; },
    sandbox: async (url) => { finestre.push(url); return null; },
  });
  for (const url of [
    'http://127.0.0.1:8080/admin',
    'http://10.0.0.5/setup',
    'http://192.168.1.1/',
    'http://172.20.3.4/stampante',
    'http://169.254.10.1/',
    'http://mio-nas.local/',
    'http://localhost:3000/',
  ]) SB.analyze(url, {}, () => {});
  await attendi(60);
  assert.deepEqual(giudizi, [], 'nessun giudizio del modello per la rete di casa');
  assert.deepEqual(finestre, [], 'nessuna finestra nascosta sulla rete di casa');
});

test('riconoscere un indirizzo della rete di casa: casi limite', () => {
  const privati = ['127.0.0.1', '10.255.255.254', '192.168.0.1', '172.16.0.1', '172.31.255.255',
    '169.254.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', 'nas.local', 'stampante.lan'];
  const pubblici = ['93.184.216.34', '172.32.0.1', '172.15.0.1', '100.63.0.1', '8.8.8.8',
    '2001:db8::1', 'esempio.it', 'localhost.esempio.it', 'pages.dev'];
  for (const h of privati) assert.equal(engine.isHostPrivato(h), true, `${h} è della rete di casa`);
  for (const h of pubblici) assert.equal(engine.isHostPrivato(h), false, `${h} NON è della rete di casa`);
});
