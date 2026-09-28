// Il controllo profondo anti-phishing (#591): freno e risposta stanno sul dominio con i suoi indizi. Sottodomini nuovi
// con gli stessi indizi non rifanno partire modello e finestra nascosta ma ne ereditano la risposta; il verdetto (e il
// certificato) di un sito non passa ai vicini di piattaforma; un controllo fallito frena per poco; la rete di casa non esce.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SB = require('../../src/main/services/safebrowse/index.js');

const LOGIN = { linkOrigin: 'email', hasPassword: true };
const PIATTAFORME = ['weebly.com', '000webhostapp.com', 'r2.dev', 'webflow.io', 'trycloudflare.com'];

beforeEach(() => {
  for (const c of Object.values(SB._caches)) c.m.clear();
  SB.setProviders({ gsb: null, rdap: null, ct: null, llm: null, sandbox: null });
});

const analizza = (url, ctx) => new Promise((ok) => {
  SB.analyze(url, ctx, ok);
  setTimeout(ok, 30);
});

test('la truffa sbarrata su una piattaforma di hosting non sbarra i siti degli altri utenti', async () => {
  SB.setProviders({ llm: async () => null, sandbox: async (u) => ({ verdict: 'dangerous', finalUrl: u, redirects: [], download: 'x.exe' }) });
  for (const p of PIATTAFORME) {
    await analizza(`https://verifica-conto.${p}/login`, LOGIN);
    assert.equal(SB.checkSync(`https://verifica-conto.${p}/login`, LOGIN).level, 'pericoloso', p);
    assert.equal(SB.checkSync(`https://forno-di-marco.${p}/`, {}).level, 'safe', p);
  }
});

test('un sito pulito controllato per primo non toglie il controllo a una truffa con indizi diversi', async () => {
  const aperte = [];
  SB.setProviders({
    llm: async () => ({ suspicious: false, reason: null }),
    sandbox: async (u) => { aperte.push(u); return u.includes('negozio') ? { verdict: 'clean', redirects: [] } : { verdict: 'dangerous', redirects: [], download: 'f.exe' }; },
  });
  await analizza('https://negozio.weebly.com/account/login', { hasPassword: true });
  await analizza('https://verifica-conto.weebly.com/login', LOGIN);
  assert.ok(aperte.includes('https://verifica-conto.weebly.com/login'));
  assert.equal(SB.checkSync('https://verifica-conto.weebly.com/login', LOGIN).level, 'pericoloso');
});

test('sottodomini sempre nuovi con gli stessi indizi: un giudizio e una finestra, anche mentre il primo è in volo', async () => {
  let giudizi = 0;
  let finestre = 0;
  SB.setProviders({
    llm: async () => { giudizi++; await new Promise((r) => setTimeout(r, 10)); return { suspicious: false, reason: null }; },
    sandbox: async () => { finestre++; await new Promise((r) => setTimeout(r, 10)); return { verdict: 'clean', redirects: [] }; },
  });
  await Promise.all(Array.from({ length: 15 }, (_, i) => analizza(`http://x${i}.dominio-ostile.com/`, LOGIN)));
  for (let i = 15; i < 30; i++) await analizza(`http://x${i}.dominio-ostile.com/`, LOGIN);
  assert.equal(giudizi, 1);
  assert.equal(finestre, 1);
});

test('chi è frenato eredita la risposta di chi ha tirato il freno, anche arrivando mentre quel controllo è in volo', async () => {
  let giudizi = 0;
  let finestre = 0;
  SB.setProviders({
    llm: async () => { giudizi++; await new Promise((r) => setTimeout(r, 10)); return { suspicious: true, reason: 'x' }; },
    sandbox: async (u) => { finestre++; await new Promise((r) => setTimeout(r, 10)); return { verdict: 'dangerous', finalUrl: u, redirects: [], download: 'f.exe' }; },
  });
  const primo = analizza('https://accesso.dominio-gemello.com/login', LOGIN);
  const inVolo = analizza('https://verifica.dominio-gemello.com/login', LOGIN);
  await Promise.all([primo, inVolo]);
  const dopo = SB.analyze('https://sblocco.dominio-gemello.com/login', LOGIN, () => {});
  assert.equal(dopo.level, 'pericoloso', 'il verdetto ereditato vale subito, senza aspettare niente');
  for (const s of ['accesso', 'verifica', 'sblocco']) {
    assert.equal(SB.checkSync(`https://${s}.dominio-gemello.com/login`, LOGIN).level, 'pericoloso', s);
  }
  assert.equal(giudizi, 1);
  assert.equal(finestre, 1);
  await analizza('https://pagamenti.dominio-gemello.com/', { hasPayment: true });
  assert.equal(giudizi, 2, 'con indizi diversi il sito ha il suo controllo, non l\'eredità');
});

test('un giudizio senza verdetto frena i sottodomini per poco, poi si riprova', async () => {
  let chiamate = 0;
  SB.configure({ runLlm: async () => { chiamate++; return 'Non saprei.'; }, enableSandbox: false, enableNetwork: false });
  for (let i = 0; i < 10; i++) await analizza(`http://a${i}.dominio-prosa.com/login`, LOGIN);
  assert.equal(chiamate, 1, 'una risposta illeggibile non deve far ripartire il modello a ogni sottodominio');
  const vero = Date.now;
  Date.now = () => vero() + 6 * 60 * 1000;
  try {
    await analizza('http://b.dominio-prosa.com/login', LOGIN);
  } finally { Date.now = vero; }
  assert.equal(chiamate, 2, 'passato il freno breve il giudizio si riprova');
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
  for (const u of ['http://192.168.1.1/cgi-bin/luci?stok=abc', 'http://10.0.0.5:8080/', 'http://nas.local/', 'http://router.lan/', 'http://169.254.1.1/', 'http://[fd00::1]/']) {
    await analizza(u, { hasPassword: true });
  }
  assert.deepEqual(usciti, []);
  await analizza('http://accesso.esempio-pubblico.com/login', { hasPassword: true });
  assert.ok(usciti.length > 0, 'un indirizzo pubblico in chiaro i suoi controlli li riceve');
});
