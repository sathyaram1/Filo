// #1042 — La chiave privata dei feedback nella Filo installata: si carica da un file in qualunque forma l'owner
// l'abbia (riga del .env, PEM, stringa sola, uscita di gen-feedback-keys, UTF-16 di PowerShell), solo se apre i
// feedback, e si custodisce cifrata. Senza portachiavi si rifiuta; l'ambiente vince, il .env di sviluppo è l'ultimo.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const MODULO = join(__dirname, '..', '..', 'src', 'main', 'services', 'chiaveFeedback.js');
require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackCrypto.js'));

let cartellaDati = '';
const portachiavi = { acceso: true, backend: 'gnome_libsecret' };
// Reversibile ma non identica: su disco la chiave non deve comparire.
const electronMock = {
  app: { getPath: () => cartellaDati },
  safeStorage: {
    isEncryptionAvailable: () => portachiavi.acceso,
    getSelectedStorageBackend: () => portachiavi.backend,
    encryptString: (s) => Buffer.from(`c:${Buffer.from(String(s)).toString('hex').split('').reverse().join('')}`),
    decryptString: (b) => Buffer.from(Buffer.from(b).toString().slice(2).split('').reverse().join(''), 'hex').toString(),
  },
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return origLoad.call(this, request, parent, isMain);
};

async function coppia() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return {
    pub: Buffer.from(await webcrypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url'),
    priv: Buffer.from(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64'),
  };
}

let chiavi;
let altra;
let M;
const envPrima = process.env.FILO_FEEDBACK_PRIVKEY;
const pubPrima = globalThis.SN_FEEDBACK_PUBKEY;

function fresco() {
  delete require.cache[require.resolve(MODULO)];
  const m = require(MODULO);
  m.fileDiSviluppo = () => join(cartellaDati, 'sviluppo', '.env');
  return m;
}
function scrivi(nome, contenuto) {
  const p = join(cartellaDati, nome);
  fs.writeFileSync(p, contenuto);
  return p;
}
const custodito = () => join(cartellaDati, 'chiave-feedback.bin');

beforeEach(async () => {
  cartellaDati = cartellaTemporanea('filo-chiave-unit-');
  portachiavi.acceso = true;
  portachiavi.backend = 'gnome_libsecret';
  delete process.env.FILO_FEEDBACK_PRIVKEY;
  chiavi = chiavi || await coppia();
  altra = altra || await coppia();
  globalThis.SN_FEEDBACK_PUBKEY = chiavi.pub;
  M = fresco();
});
afterEach(() => {
  togliCartella(cartellaDati);
  if (envPrima === undefined) delete process.env.FILO_FEEDBACK_PRIVKEY; else process.env.FILO_FEEDBACK_PRIVKEY = envPrima;
  globalThis.SN_FEEDBACK_PUBKEY = pubPrima;
});

test('la chiave si carica in ogni forma in cui l\'owner può averla, e su disco non è in chiaro', async () => {
  const p = chiavi.priv;
  const forme = {
    'env con altre righe, CRLF e virgolette': `A=1\r\nexport FILO_FEEDBACK_PRIVKEY="${p}"\r\nB=2\r\n`,
    'PEM': `-----BEGIN PRIVATE KEY-----\n${p.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`,
    'stringa sola': `${p}\n`,
    'uscita di gen-feedback-keys': `=== CHIAVE PUBBLICA (committabile) ===\n${chiavi.pub}\n\n=== CHIAVE PRIVATA (SEGRETA — salvala fuori dal repo) ===\n${p}\n`,
    'UTF-16 di PowerShell': Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(`${p}\r\n`, 'utf16le')]),
  };
  for (const [nome, contenuto] of Object.entries(forme)) {
    M = fresco();
    try { fs.rmSync(custodito()); } catch (_) {}
    const r = await M.caricaDaFile(scrivi('chiave', contenuto));
    assert.deepEqual(r, { ok: true }, nome);
    assert.equal(M.leggi(), p, nome);
    assert.equal(fs.readFileSync(custodito()).includes(Buffer.from(p)), false, `${nome}: la chiave in chiaro su disco`);
    // Riletta da capo (Filo riaperto) è ancora lì.
    assert.equal(fresco().leggi(), p, `${nome}: dopo la riapertura`);
    assert.equal(fresco().stato().fonte, 'custodita', nome);
  }
});

test('un file senza la chiave giusta si rifiuta col motivo, e non scrive niente', async () => {
  let r = await M.caricaDaFile(scrivi('altra.env', `FILO_FEEDBACK_PRIVKEY=${altra.priv}\n`));
  assert.equal(r.ok, false);
  assert.match(r.error, /non apre i feedback/);
  r = await M.caricaDaFile(scrivi('testo.txt', 'niente chiavi qui\n'));
  assert.match(r.error, /non c'è una chiave/);
  r = await M.caricaDaFile(scrivi('grosso.bin', Buffer.alloc(300 * 1024, 65)));
  assert.match(r.error, /pesa 300 KB/);
  r = await M.caricaDaFile(cartellaDati);
  assert.match(r.error, /non è un file/);
  assert.equal(fs.existsSync(custodito()), false);
  assert.equal(M.leggi(), null);
});

test('senza portachiavi si rifiuta, e niente finisce su disco', async () => {
  portachiavi.acceso = false;
  M = fresco();
  const r = await M.caricaDaFile(scrivi('chiave', chiavi.priv));
  assert.equal(r.ok, false);
  assert.match(r.error, /portachiavi/);
  assert.equal(fs.existsSync(custodito()), false);
  assert.equal(M.stato().custodibile, false);
});

test('la cifratura di ripiego di Chromium su Linux vale come nessun portachiavi', async () => {
  portachiavi.backend = 'basic_text';
  M = fresco();
  const r = await M.caricaDaFile(scrivi('chiave', chiavi.priv));
  // Il ripiego esiste solo su Linux: altrove il nome non c'è e il portachiavi del sistema vale.
  assert.equal(r.ok, process.platform !== 'linux');
  assert.equal(M.stato().custodibile, process.platform !== 'linux');
});

test('l\'ambiente vince, poi la chiave custodita, poi il .env di sviluppo; dimenticare torna al successivo', async () => {
  fs.mkdirSync(join(cartellaDati, 'sviluppo'));
  scrivi(join('sviluppo', '.env'), `FILO_FEEDBACK_PRIVKEY=dal-file-di-sviluppo\n`);
  assert.deepEqual([M.leggi(), M.stato().fonte], ['dal-file-di-sviluppo', 'sviluppo']);
  assert.deepEqual(await M.caricaDaFile(scrivi('chiave', chiavi.priv)), { ok: true });
  assert.deepEqual([M.leggi(), M.stato().fonte], [chiavi.priv, 'custodita']);
  process.env.FILO_FEEDBACK_PRIVKEY = 'dall-ambiente';
  assert.deepEqual([M.leggi(), M.stato().fonte, M.stato().custodita], ['dall-ambiente', 'ambiente', true]);
  delete process.env.FILO_FEEDBACK_PRIVKEY;
  assert.deepEqual(M.dimentica(), { ok: true });
  assert.equal(fs.existsSync(custodito()), false);
  assert.deepEqual([M.leggi(), M.stato().fonte, M.stato().custodita], ['dal-file-di-sviluppo', 'sviluppo', false]);
});
