// #965 — I link di una pagina passano dai controlli locali dei siti pericolosi appena compaiono: un lotto si esamina a
// fette senza nessuna richiesta di rete, e i link da avviso tornano col verdetto pronto per il clic.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SB = require('../../src/main/services/safebrowse/index.js');
const { esaminaLotto, esaminaAFette, LOTTO_MAX } = SB.links;

const fetchVero = globalThis.fetch;
let rete;

beforeEach(() => {
  rete = [];
  for (const c of Object.values(SB._caches)) c.m.clear();
  const conta = (nome) => async (x) => { rete.push(`${nome}:${x}`); return null; };
  SB.setProviders({ gsb: conta('gsb'), gsbPeek: null, rdap: conta('rdap'), ct: conta('ct'), llm: conta('llm'), sandbox: conta('sandbox') });
  globalThis.fetch = async (u) => { rete.push(`fetch:${u}`); throw new Error('nessuna rete nelle prove'); };
});
afterEach(() => { globalThis.fetch = fetchVero; });

const LOTTO = [
  'https://paypa1.com/login',
  'https://paypal-login.com/conto',
  'https://www.example.com/fattura.pdf.exe',
  'https://scarica.example.org/dl?file=Fattura%20marzo.pdf.exe&x=1',
  'https://www.wikipedia.org/wiki/Delete',
  'https://www.amazon.it/dp/B000',
  'https://forum.example.net/thread/42#fondo',
  'mailto:qualcuno@example.com',
  'javascript:void(0)',
  'non è un indirizzo',
  '',
];

test('un lotto: imitazioni e file travestiti tornano col verdetto e la frase, il resto no', async () => {
  const r = await SB.checkLinks(LOTTO);
  assert.equal(r.esaminati, LOTTO.length);
  const per = Object.fromEntries(r.segnalati.map((s) => [s.url, s]));
  assert.deepEqual(Object.keys(per).sort(), [
    'https://paypa1.com/login',
    'https://paypal-login.com/conto',
    'https://scarica.example.org/dl?file=Fattura%20marzo.pdf.exe&x=1',
    'https://www.example.com/fattura.pdf.exe',
  ]);
  assert.equal(per['https://paypa1.com/login'].level, 'pericoloso');
  assert.match(per['https://paypa1.com/login'].message.title, /non è PayPal/);
  assert.equal(per['https://paypa1.com/login'].scope, 'paypa1.com');
  assert.equal(per['https://paypal-login.com/conto'].level, 'sospetto');
  assert.equal(per['https://www.example.com/fattura.pdf.exe'].level, 'sospetto');
  assert.equal(per['https://www.example.com/fattura.pdf.exe'].message.title, 'File travestito');
  assert.match(per['https://www.example.com/fattura.pdf.exe'].message.body, /«fattura\.pdf\.exe»/);
  assert.match(per['https://scarica.example.org/dl?file=Fattura%20marzo.pdf.exe&x=1'].message.body, /«Fattura marzo\.pdf\.exe»/);
});

test('nessuna richiesta di rete: niente lista di Google, registri, modello o finestra isolata', async () => {
  const molti = [];
  for (let i = 0; i < 300; i++) molti.push(`https://sito-${i}.example.com/p/${i}`, `https://paypa1-${i}.com/`, `https://amaz0n.com/${i}`);
  await SB.checkLinks(LOTTO.concat(molti));
  await SB._settled();
  assert.deepEqual(rete, []);
});

test('a fette: il main cede il passo fra una e l\'altra e arriva in fondo', async () => {
  let t = 0;
  let cessioni = 0;
  const urls = Array.from({ length: 50 }, (_, i) => `https://sito-${i}.example.com/`);
  const r = await esaminaAFette(urls, {
    checkSync: SB.checkSync,
    fettaMs: 5,
    ora: () => t++,
    cedi: async () => { cessioni++; },
  });
  assert.equal(r.esaminati, 50);
  assert.ok(r.fette > 5, `fette: ${r.fette}`);
  assert.equal(cessioni, r.fette - 1);
});

test('una fetta scaduta fa comunque un link, e una scheda chiusa ferma l\'esame', async () => {
  const urls = ['https://paypa1.com/', 'https://a.example.com/', 'https://b.example.com/'];
  const uno = esaminaLotto(urls, { checkSync: SB.checkSync, scaduto: () => true });
  assert.equal(uno.fatti, 1);
  assert.equal(uno.segnalati.length, 1);
  let giri = 0;
  const r = await esaminaAFette(urls, { checkSync: SB.checkSync, fettaMs: 0, cedi: async () => {}, vivo: () => giri++ < 2 });
  assert.ok(r.esaminati < urls.length);
});

test('il lotto ha un tetto largo e dichiarato', () => {
  assert.ok(LOTTO_MAX >= 200, `tetto: ${LOTTO_MAX}`);
});

test('il testo cercato non è un file: una ricerca di «fattura.pdf.exe» apre i risultati; un file in un parametro o in un rimando sì', () => {
  const { checkLink } = SB;
  for (const u of [
    'https://forum.example.it/search.php?keywords=documento.pdf.exe',
    'https://cerca.example.com/?q=fattura.pdf.exe',
    'https://example.com/risultati?query=foto.jpg.scr&pagina=2',
  ]) assert.equal(checkLink(u), null, u);
  const per = (u, nome) => { const v = checkLink(u, nome); return v && v.message.body.match(/«([^»]+)»/)[1]; };
  assert.equal(per('https://scarica.example.org/dl?file=Fattura%20marzo.pdf.exe&x=1'), 'Fattura marzo.pdf.exe');
  assert.equal(per('https://example.com/vai?to=https%3A%2F%2Faltro.example.net%2Ff%2Fbolletta.pdf.exe'), 'bolletta.pdf.exe');
  // Il nome con cui arriva il file conta come il suo indirizzo (un link «scarica», un nome dato dal sito).
  assert.equal(per('https://example.com/get/123'), null);
  assert.equal(per('https://example.com/get/123', 'ricevuta.jpg.scr'), 'ricevuta.jpg.scr');
});

test('un file travestito su un sito noto resta travestito: il sito vero non garantisce il file', () => {
  const { checkLink } = SB;
  for (const u of [
    'https://www.dropbox.com/s/abc/fattura.pdf.exe',
    'https://cdn.discordapp.com/attachments/1/2/fattura.pdf.exe',
    'https://onedrive.live.com/download/fattura.pdf.exe',
  ]) {
    const v = checkLink(u);
    assert.equal(v && v.level, 'sospetto', u);
    assert.equal(v.message.title, 'File travestito', u);
    assert.match(v.message.body, /«fattura\.pdf\.exe»/, u);
  }
  assert.equal(checkLink('https://drive.usercontent.google.com/download?id=1', 'ricevuta.jpg.scr').level, 'sospetto');
  // Il resto di un sito noto non cambia.
  assert.equal(checkLink('https://www.dropbox.com/s/abc/fattura.pdf'), null);
  assert.equal(checkLink('https://www.google.com/search?q=fattura.pdf.exe'), null);
});
