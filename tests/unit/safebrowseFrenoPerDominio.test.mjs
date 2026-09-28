// Il controllo profondo anti-phishing (#591): il freno conta le chiamate per dominio, il verdetto resta del sito.
// Sottodomini sempre nuovi non fanno più di qualche controllo all'ora; il verdetto (e il certificato) di un sito non passa
// ai vicini di piattaforma; un controllo fallito non si ripete sullo stesso sito per poco; la rete di casa non esce.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SB = require('../../src/main/services/safebrowse/index.js');

const LOGIN = { linkOrigin: 'email', hasPassword: true };
const ACCESSO = { hasPassword: true };
// Piattaforme che l'elenco interno non separa: il dominio è di migliaia di proprietari.
const PIATTAFORME = ['weebly.com', '000webhostapp.com', 'r2.dev', 'webflow.io', 'trycloudflare.com', 'wixsite.com', 'square.site', 'godaddysites.com'];

beforeEach(() => {
  for (const c of Object.values(SB._caches)) c.m.clear();
  SB.setProviders({ gsb: null, rdap: null, ct: null, llm: null, sandbox: null });
});

const analizza = (url, ctx) => new Promise((ok) => {
  SB.analyze(url, ctx, ok);
  setTimeout(ok, 30);
});

const finestraCheTrova = (aperte) => async (u) => {
  aperte.push(u);
  return u.includes('verifica-conto')
    ? { verdict: 'dangerous', finalUrl: u, redirects: [], download: 'x.exe' }
    : { verdict: 'clean', finalUrl: u, redirects: [] };
};

test('la truffa sbarrata su una piattaforma di hosting non sbarra i siti degli altri utenti, neanche con gli stessi indizi', async () => {
  for (const p of PIATTAFORME) {
    for (const c of Object.values(SB._caches)) c.m.clear();
    const aperte = [];
    SB.setProviders({ llm: async () => null, sandbox: finestraCheTrova(aperte) });
    await analizza(`https://verifica-conto.${p}/login`, ACCESSO);
    assert.equal(SB.checkSync(`https://verifica-conto.${p}/login`, ACCESSO).level, 'pericoloso', p);
    assert.equal(SB.checkSync(`https://forno-di-marco.${p}/`, {}).level, 'safe', p);
    await analizza(`https://forno-di-marco.${p}/account/login`, ACCESSO);
    assert.notEqual(SB.checkSync(`https://forno-di-marco.${p}/account/login`, ACCESSO).level, 'pericoloso', p);
    assert.ok(aperte.includes(`https://forno-di-marco.${p}/account/login`), `${p}: il negozio ha il suo controllo`);
  }
});

test('un sito pulito controllato per primo non toglie il controllo alla truffa sulla stessa piattaforma', async () => {
  for (const p of PIATTAFORME) {
    for (const c of Object.values(SB._caches)) c.m.clear();
    const aperte = [];
    SB.setProviders({ llm: async () => ({ suspicious: false, reason: null }), sandbox: finestraCheTrova(aperte) });
    await analizza(`https://negozio.${p}/account/login`, ACCESSO);
    await analizza(`https://verifica-conto.${p}/login`, ACCESSO);
    assert.ok(aperte.includes(`https://verifica-conto.${p}/login`), p);
    assert.equal(SB.checkSync(`https://verifica-conto.${p}/login`, ACCESSO).level, 'pericoloso', p);
  }
});

test('sottodomini sempre nuovi dello stesso dominio: qualche controllo all\'ora, anche arrivando tutti insieme', async () => {
  let giudizi = 0;
  let finestre = 0;
  SB.setProviders({
    llm: async () => { giudizi++; await new Promise((r) => setTimeout(r, 10)); return { suspicious: false, reason: null }; },
    sandbox: async () => { finestre++; await new Promise((r) => setTimeout(r, 10)); return { verdict: 'clean', redirects: [] }; },
  });
  await Promise.all(Array.from({ length: 15 }, (_, i) => analizza(`http://x${i}.dominio-ostile.com/`, LOGIN)));
  for (let i = 15; i < 30; i++) await analizza(`http://x${i}.dominio-ostile.com/`, LOGIN);
  assert.equal(giudizi, SB.DEEP_BUDGET);
  assert.equal(finestre, SB.DEEP_BUDGET);
  assert.ok(SB.DEEP_BUDGET < 10);
  const vero = Date.now;
  Date.now = () => vero() + 61 * 60 * 1000;
  try { await analizza('http://dopo-un-ora.dominio-ostile.com/', LOGIN); } finally { Date.now = vero; }
  assert.equal(giudizi, SB.DEEP_BUDGET + 1, 'passata l\'ora il dominio ha di nuovo i suoi controlli');
});

test('il secondo sito dello stesso dominio ha il suo controllo e il suo verdetto, anche arrivando col primo in volo', async () => {
  let giudizi = 0;
  let finestre = 0;
  SB.setProviders({
    llm: async () => { giudizi++; await new Promise((r) => setTimeout(r, 10)); return { suspicious: true, reason: 'x' }; },
    sandbox: async (u) => { finestre++; await new Promise((r) => setTimeout(r, 10)); return { verdict: 'dangerous', finalUrl: u, redirects: [], download: 'f.exe' }; },
  });
  const aggiornati = [];
  const primo = analizza('https://accesso.dominio-gemello.com/login', LOGIN);
  const inVolo = new Promise((ok) => {
    SB.analyze('https://verifica.dominio-gemello.com/login', LOGIN, (v) => { aggiornati.push(v.level); ok(); });
    setTimeout(ok, 200);
  });
  await Promise.all([primo, inVolo]);
  assert.deepEqual(aggiornati, ['pericoloso'], 'la pagina dove l\'utente arriva riceve il suo avviso');
  for (const s of ['accesso', 'verifica']) {
    assert.equal(SB.checkSync(`https://${s}.dominio-gemello.com/login`, LOGIN).level, 'pericoloso', s);
  }
  assert.equal(giudizi, 2);
  assert.equal(finestre, 2);
  await analizza('https://verifica.dominio-gemello.com/login', LOGIN);
  assert.equal(giudizi, 2, 'lo stesso sito si ricorda il suo verdetto');
});

test('due analisi dello stesso sito con gli stessi indizi in volo insieme fanno una chiamata', async () => {
  let giudizi = 0;
  SB.setProviders({ llm: async () => { giudizi++; await new Promise((r) => setTimeout(r, 10)); return { suspicious: true, reason: 'x' }; } });
  const aggiornati = [];
  await Promise.all([1, 2].map(() => new Promise((ok) => {
    SB.analyze('https://accesso.dominio-doppio.com/login', LOGIN, (v) => { aggiornati.push(v.level); ok(); });
    setTimeout(ok, 200);
  })));
  assert.equal(giudizi, 1);
  assert.deepEqual(aggiornati, ['sospetto', 'sospetto'], 'tutte e due le analisi ricevono la risposta');
});

test('un giudizio senza verdetto non si ripete sullo stesso sito per poco, e i sottodomini restano nel conto', async () => {
  let chiamate = 0;
  SB.configure({ runLlm: async () => { chiamate++; return 'Non saprei.'; }, enableSandbox: false, enableNetwork: false });
  for (let i = 0; i < 3; i++) await analizza('http://a.dominio-prosa.com/login', LOGIN);
  assert.equal(chiamate, 1, 'lo stesso sito non richiama il modello a ogni analisi');
  for (let i = 0; i < 10; i++) await analizza(`http://b${i}.dominio-prosa.com/login`, LOGIN);
  assert.equal(chiamate, SB.DEEP_BUDGET, 'una risposta illeggibile non fa ripartire il modello a ogni sottodominio');
  const vero = Date.now;
  Date.now = () => vero() + 61 * 60 * 1000;
  try {
    await analizza('http://a.dominio-prosa.com/login', LOGIN);
  } finally { Date.now = vero; }
  assert.equal(chiamate, SB.DEEP_BUDGET + 1, 'passato il freno il giudizio si riprova');
  SB.setProviders({ llm: null });
});

test('il certificato rotto di un sito non mette l\'avviso sui vicini di piattaforma', () => {
  SB.recordCert('rotto.weebly.com', 'expired');
  assert.equal(SB.checkSync('https://rotto.weebly.com/', {}).level, 'sospetto');
  assert.equal(SB.checkSync('https://forno-di-marco.weebly.com/', {}).level, 'safe');
});

test('la rete di casa non fa partire nessuno stadio di rete', async () => {
  const usciti = [];
  SB.setProviders({
    gsb: async (u) => { usciti.push(u); return null; },
    rdap: async (r) => { usciti.push(r); return null; },
    llm: async (m) => { usciti.push(m.host); return null; },
    sandbox: async (u) => { usciti.push(u); return null; },
  });
  globalThis.SN_URL_NAV.noteHostAddress('tplinkwifi.net', '192.168.0.1');
  for (const u of ['http://192.168.1.1/cgi-bin/luci?stok=abc', 'http://10.0.0.5:8080/', 'http://nas.local/', 'http://router.lan/', 'http://169.254.1.1/', 'http://[fd00::1]/',
    'http://homeassistant:8123/auth/authorize', 'http://router/cgi-bin/luci/;stok=abc/admin', 'http://speedport.ip/', 'http://tplinkwifi.net/webpages/login.html']) {
    await analizza(u, { hasPassword: true });
  }
  assert.deepEqual(usciti, []);
  await analizza('http://accesso.esempio-pubblico.com/login', { hasPassword: true });
  assert.ok(usciti.length > 0, 'un indirizzo pubblico in chiaro i suoi controlli li riceve');
  usciti.length = 0;
  globalThis.SN_URL_NAV.noteHostAddress('accesso.negozio.box', '203.0.113.7');
  await analizza('http://accesso.negozio.box/login', { hasPassword: true });
  assert.ok(usciti.length > 0, '.box è un dominio pubblico: un sito che risponde da internet ha i suoi controlli');
});
