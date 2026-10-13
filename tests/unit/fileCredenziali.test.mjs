// I file delle credenziali (#1087): scritti col modulo atomico, la chiave dei crediti non si riscrive a ogni lettura
// del saldo, e un'identità che non si legge non finisce sotto una nuova (il portafoglio è legato a quella).

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH = join(__dirname, '..', '..', 'src', 'main', 'auth');

// Una «cifratura» reversibile e riconoscibile: basta a provare cosa finisce in quale file.
let cartellaDati = '';
const electronMock = {
  app: { getPath: () => cartellaDati },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`cifrato:${s}`, 'utf8'),
    decryptString: (b) => {
      const s = Buffer.from(b).toString('utf8');
      if (!s.startsWith('cifrato:')) throw new Error('Error while decrypting the ciphertext');
      return s.slice('cifrato:'.length);
    },
  },
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return origLoad.call(this, request, parent, isMain);
};

function fresco(nome) {
  const p = join(AUTH, nome);
  delete require.cache[require.resolve(p)];
  return require(p);
}

const cartelle = [];
const ripristini = [];
function nuovaCartella(file = {}) {
  cartellaDati = cartellaTemporanea('filo-credenziali-');
  cartelle.push(cartellaDati);
  for (const [n, t] of Object.entries(file)) fs.writeFileSync(join(cartellaDati, n), t);
  return cartellaDati;
}
function sostituisci(obj, nome, fn) {
  const vero = obj[nome];
  obj[nome] = fn(vero);
  ripristini.push(() => { obj[nome] = vero; });
}
afterEach(() => {
  while (ripristini.length) ripristini.pop()();
  while (cartelle.length) togliCartella(cartelle.pop());
});
const errore = (code) => Object.assign(new Error(`${code}: simulato`), { code });
// Come writeFileSync quando il disco si riempie: il file (o il descrittore) aperto in scrittura riceve solo l'inizio.
function scritturaInterrotta(dest, dati) {
  const fd = typeof dest === 'number' ? dest : fs.openSync(dest, 'w');
  fs.writeSync(fd, Buffer.from(dati), 0, 4);
  if (fd !== dest) fs.closeSync(fd);
  throw errore('ENOSPC');
}
const cifra = (o) => `cifrato:${JSON.stringify(o)}`;

test('leggere il saldo non riscrive il file della chiave: l\'ultimo stato sta in un file suo', () => {
  const dir = nuovaCartella();
  const W = fresco('wallet-store.js');
  assert.equal(W.save({ key: 'sk-or-1', pseudonym: 'abc' }), true);
  const chiave = fs.readFileSync(join(dir, 'wallet.bin'));
  const quando = fs.statSync(join(dir, 'wallet.bin')).mtimeMs;

  assert.equal(W.saveLastServer({ hasWallet: true, balance: { credits: 10 } }), true);
  assert.equal(W.saveLastServer({ hasWallet: true, balance: { credits: 9 } }), true);
  assert.deepEqual(fs.readFileSync(join(dir, 'wallet.bin')), chiave);
  assert.equal(fs.statSync(join(dir, 'wallet.bin')).mtimeMs, quando);
  assert.ok(!chiave.toString().includes('credits'), 'il saldo non sta più accanto alla chiave');

  const W2 = fresco('wallet-store.js');
  assert.equal(W2.personalKey(), 'sk-or-1');
  assert.deepEqual(W2.lastServer(), { hasWallet: true, balance: { credits: 9 } });
});

test('un wallet.bin delle versioni prima, con lo stato dentro, vale finché non arriva una lettura nuova', () => {
  nuovaCartella({ 'wallet.bin': cifra({ key: 'sk-or-v', pseudonym: 'p', redeemedAt: '2026-09-01', lastServer: { hasWallet: true, balance: { credits: 5 } } }) });
  const W = fresco('wallet-store.js');
  assert.deepEqual(W.lastServer(), { hasWallet: true, balance: { credits: 5 } });
  assert.deepEqual(W.load(), { key: 'sk-or-v', pseudonym: 'p', redeemedAt: '2026-09-01' });
  W.saveLastServer({ hasWallet: true, balance: { credits: 4 } });
  assert.deepEqual(W.lastServer(), { hasWallet: true, balance: { credits: 4 } });
});

test('un disco che non risponde non è «nessuna chiave»: alla domanda dopo la chiave c\'è', () => {
  const dir = nuovaCartella({ 'wallet.bin': cifra({ key: 'sk-or-2', pseudonym: '' }) });
  const W = fresco('wallet-store.js');
  const veroWarn = console.warn; console.warn = () => {};
  ripristini.push(() => { console.warn = veroWarn; });
  sostituisci(fs, 'readFileSync', (vero) => (p, ...a) => { if (String(p) === join(dir, 'wallet.bin')) throw errore('EBUSY'); return vero(p, ...a); });
  assert.equal(W.personalKey(), '');
  ripristini.pop()();
  assert.equal(W.personalKey(), 'sk-or-2');
});

test('mettere da parte il portafoglio porta via anche l\'ultimo stato', () => {
  const dir = nuovaCartella();
  const W = fresco('wallet-store.js');
  W.save({ key: 'sk-or-3' });
  W.saveLastServer({ hasWallet: true });
  W.metteDaParte();
  assert.deepEqual(fs.readdirSync(dir), ['wallet.bin.prev']);
  assert.equal(W.lastServer(), null);
});

test('un\'identità che non si lascia leggere non viene sovrascritta da una nuova', async () => {
  const dir = nuovaCartella({ 'identity.bin': cifra({ refreshToken: 'rt-vecchio', uid: 'u-1' }) });
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ idToken: 'h.e30.s', refreshToken: 'rt-nuovo', expiresIn: '3600', localId: 'u-2' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  ripristini.push(() => server.close());
  process.env.FILO_IDENTITY_ENDPOINT = `http://127.0.0.1:${server.address().port}/signUp`;
  ripristini.push(() => { delete process.env.FILO_IDENTITY_ENDPOINT; });
  const A = fresco('anon-auth.js');
  const veroWarn = console.warn; console.warn = () => {};
  ripristini.push(() => { console.warn = veroWarn; });
  sostituisci(fs, 'readFileSync', (vero) => (p, ...a) => { if (String(p) === join(dir, 'identity.bin')) throw errore('EIO'); return vero(p, ...a); });
  assert.equal(A.restore(), false);
  ripristini.pop()();
  // Senza identità letta ne nasce una per la sessione: va bene, purché il file di quella vera resti.
  assert.equal(await A.getIdToken(), 'h.e30.s');
  assert.equal(fs.readFileSync(join(dir, 'identity.bin'), 'utf8'), cifra({ refreshToken: 'rt-vecchio', uid: 'u-1' }));
});

test('un\'identità che non si decifra si mette da parte invece di sparire', () => {
  const dir = nuovaCartella({ 'identity.bin': 'blob di un altro utente' });
  const A = fresco('anon-auth.js');
  const veroWarn = console.warn; console.warn = () => {};
  ripristini.push(() => { console.warn = veroWarn; });
  assert.equal(A.restore(), false);
  const daParte = fs.readdirSync(dir).filter((n) => n.startsWith('identity.bin.illeggibile-'));
  assert.equal(daParte.length, 1);
  assert.equal(fs.readFileSync(join(dir, daParte[0]), 'utf8'), 'blob di un altro utente');
});

test('la sessione Google si scrive intera o non si scrive', () => {
  const dir = nuovaCartella();
  const T = fresco('token-store.js');
  assert.equal(T.save({ refreshToken: 'rt-1', email: 'a@b.test' }), true);
  sostituisci(fs, 'writeFileSync', () => scritturaInterrotta);
  const veroErr = console.error; console.error = () => {};
  ripristini.push(() => { console.error = veroErr; });
  assert.equal(T.save({ refreshToken: 'rt-2', email: 'a@b.test' }), false);
  ripristini.splice(0).reverse().forEach((r) => r());
  assert.deepEqual(T.load(), { refreshToken: 'rt-1', email: 'a@b.test' });
  assert.deepEqual(fs.readdirSync(dir), ['auth.bin']);
});

test('i temporanei lasciati da un arresto a metà scrittura delle credenziali se ne vanno alla prima lettura', async () => {
  const restano = ['wallet.bin', 'identity.bin', 'auth.bin', `wallet.bin.tmp-${process.pid}-7`];
  const orfani = ['wallet.bin.tmp-999999-1', 'wallet-stato.bin.tmp-999999-2', 'identity.bin.tmp-999999-3', 'auth.bin.tmp-999999-4'];
  const file = {};
  for (const n of [...restano, ...orfani]) file[n] = n.includes('.tmp') ? 'cif' : cifra({ key: 'sk-or-9', refreshToken: 'rt-9', uid: 'u-9' });
  const dir = nuovaCartella(file);
  const W = fresco('wallet-store.js');
  assert.equal(W.personalKey(), 'sk-or-9');
  W.lastServer();
  fresco('anon-auth.js').restore();
  fresco('token-store.js').load();
  const scadenza = Date.now() + 5000;
  while (fs.readdirSync(dir).length > restano.length && Date.now() < scadenza) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(fs.readdirSync(dir).sort(), restano.sort());
});
