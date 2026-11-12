// Gli strumenti dell'owner che leggono una lista di feedback cercano la chiave privata sul disco una volta per
// corsa: cercata a ogni feedback, da una cartella di lavoro lanciava un git per feedback (#1175).
// La chiave data nell'ambiente vince sempre, anche dopo una ricerca sul disco andata a vuoto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto as crypto } from 'node:crypto';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { join, sep } from 'node:path';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const cp = require('node:child_process');

async function genTestKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privPkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const pub = Buffer.from(pubRaw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { pub, priv: Buffer.from(privPkcs8).toString('base64') };
}

// Conta le ricerche sul disco vere: gli esami del file .env e i git lanciati, sugli stessi
// moduli che il codice importa (syncBuiltinESMExports porta la sostituzione anche agli import ESM).
function contaRicerche() {
  const conto = { env: 0, git: 0 };
  const origExists = fs.existsSync;
  const origExec = cp.execFileSync;
  const coda = sep + join('tests', 'agent', '.env');
  fs.existsSync = function (p, ...r) {
    if (String(p).endsWith(coda)) conto.env++;
    return origExists.call(this, p, ...r);
  };
  cp.execFileSync = function (cmd, ...r) {
    if (cmd === 'git') conto.git++;
    return origExec.call(this, cmd, ...r);
  };
  syncBuiltinESMExports();
  conto.ripristina = () => {
    fs.existsSync = origExists;
    cp.execFileSync = origExec;
    syncBuiltinESMExports();
  };
  return conto;
}

const k = await genTestKeys();
globalThis.SN_FEEDBACK_PUBKEY = k.pub;
const C = require('../../src/shared/feedbackCrypto.js');
const { decryptFeedbackList, decryptFeedbackFields } = await import('../../scripts/lib/decrypt-feedback-fields.mjs');

async function feedbackCifrati(n) {
  return Promise.all(Array.from({ length: n }, async (_, i) => ({
    _id: `fb${i}`,
    text: await C.encryptForOwner(`testo ${i}`, k.pub),
    status: await C.encryptForOwner('done', k.pub),
  })));
}

test('una lista di feedback cerca la chiave sul disco una volta sola, non una per feedback', async () => {
  const prima = process.env.FILO_FEEDBACK_PRIVKEY;
  delete process.env.FILO_FEEDBACK_PRIVKEY;
  const lista = await feedbackCifrati(20);
  const avvisi = console.warn;
  console.warn = () => {};
  const conto = contaRicerche();
  try {
    const letti = await decryptFeedbackList(lista);
    assert.equal(letti.length, 20);
    // Un secondo giro nella stessa corsa non cerca più.
    await decryptFeedbackFields(lista[0]);
  } finally {
    conto.ripristina();
    console.warn = avvisi;
    if (prima !== undefined) process.env.FILO_FEEDBACK_PRIVKEY = prima;
  }
  assert.ok(conto.git <= 1, `git lanciato ${conto.git} volte per 21 letture: atteso al più una`);
  // Il file della cartella e, da una cartella di lavoro, quello del checkout principale.
  assert.ok(conto.env <= 2, `file .env esaminato ${conto.env} volte per 21 letture: attese al più due`);
});

test('la chiave data nell\'ambiente apre i feedback anche dopo una ricerca sul disco già fatta', async () => {
  const prima = process.env.FILO_FEEDBACK_PRIVKEY;
  const [fb] = await feedbackCifrati(1);
  const avvisi = console.warn;
  console.warn = () => {};
  try {
    delete process.env.FILO_FEEDBACK_PRIVKEY;
    await decryptFeedbackFields(fb);
    process.env.FILO_FEEDBACK_PRIVKEY = k.priv;
    const letto = await decryptFeedbackFields(fb);
    assert.equal(letto.text, 'testo 0');
    assert.equal(letto.status, 'done');
  } finally {
    console.warn = avvisi;
    if (prima === undefined) delete process.env.FILO_FEEDBACK_PRIVKEY; else process.env.FILO_FEEDBACK_PRIVKEY = prima;
  }
});
