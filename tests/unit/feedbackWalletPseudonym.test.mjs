// #652 — il premio per una segnalazione può arrivare solo se il server sa a
// chi darlo. L'unico nome con cui una copia di Filo esiste sul server dei
// crediti è lo pseudonimo del portafoglio (16 cifre esadecimali): al momento
// dell'invio il documento se lo porta dietro.
//
// Senza il fix questo test è rosso: il documento partiva senza quel campo e il
// premio non aveva destinatario.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
// #602 - la cifratura si carica come la carica l'app (loader.js). Da quando
// non esiste piu un ripiego in chiaro, `submit` si rifiuta di partire se non
// puo cifrare: un test senza questi due file proverebbe l'unico caso che non
// deve esistere.
require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackPublicKey.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackCrypto.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedback.js'));
const FB = globalThis.SN_FEEDBACK;

// Registra i corpi delle create. `stati` è la coda di risposte del server.
function installFetch(stati = [200]) {
  const corpi = [];
  let i = 0;
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/counters/')) {
      if (opts && opts.method === 'PATCH') return { ok: true, status: 200, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ fields: { value: { integerValue: '5' } }, updateTime: '2026-09-01T00:00:00Z' }) };
    }
    corpi.push(JSON.parse(opts.body));
    const status = stati[i++] ?? 200;
    if (status === 200) return { ok: true, status, json: async () => ({ name: 'projects/p/databases/(default)/documents/feedback/DOC_' + i }) };
    return { ok: false, status, text: async () => `simulato ${status}` };
  };
  return { corpi, restore() { globalThis.fetch = prev; } };
}

function conPortafoglio(pseudonimo) {
  const prev = globalThis.SN_WALLET_MAIN;
  globalThis.SN_WALLET_MAIN = { pseudonym: () => pseudonimo };
  return () => { if (prev === undefined) delete globalThis.SN_WALLET_MAIN; else globalThis.SN_WALLET_MAIN = prev; };
}

test('chi ha un portafoglio manda anche il suo pseudonimo: è l’indirizzo del premio', async () => {
  const f = installFetch();
  const via = conPortafoglio('abcdef0123456789');
  try {
    await FB.submit({ text: 'non va il pulsante', submissionId: 'a-1' });
    assert.equal(f.corpi.length, 1);
    assert.deepEqual(f.corpi[0].fields.walletPseudonym, { stringValue: 'abcdef0123456789' });
  } finally { via(); f.restore(); }
});

test('senza portafoglio il campo non si scrive affatto: non si manda una stringa vuota', async () => {
  const f = installFetch();
  const via = conPortafoglio('');
  try {
    await FB.submit({ text: 'ciao', submissionId: 'a-2' });
    assert.equal('walletPseudonym' in f.corpi[0].fields, false);
  } finally { via(); f.restore(); }
});

test('uno pseudonimo di forma sbagliata non parte: le regole lo rifiuterebbero e il feedback con lui', async () => {
  for (const storto of ['ABCDEF0123456789', 'abcdef012345678', 'abcdef01234567890', 'non-esadecimale!', null]) {
    const f = installFetch();
    const via = conPortafoglio(storto);
    try {
      await FB.submit({ text: 'ciao', submissionId: 'a-3' });
      assert.equal('walletPseudonym' in f.corpi[0].fields, false, `«${storto}» non doveva partire`);
    } finally { via(); f.restore(); }
  }
});

test('se il server rifiuta i campi nuovi, il feedback parte lo stesso senza pseudonimo', async () => {
  // Le regole si deployano a mano: finché non ci sono, un 403 non deve far
  // perdere la segnalazione. Si riprova a scalare, e in fondo c'è lo schema
  // vecchio.
  const f = installFetch([403, 403, 200]);
  const via = conPortafoglio('abcdef0123456789');
  try {
    const r = await FB.submit({ text: 'ciao', submissionId: 'a-4' });
    assert.equal(f.corpi.length, 3, 'ci devono essere i due tentativi in più');
    assert.equal('walletPseudonym' in f.corpi[2].fields, false);
    assert.ok(r && r.id, 'la segnalazione è comunque arrivata');
  } finally { via(); f.restore(); }
});

test('il primo rifiuto toglie SOLO il campo più recente: numero e titolo restano', async () => {
  // `updatedAt` (#676) è l'ultimo arrivato nelle regole. Buttare giù tutto lo
  // schema al primo rifiuto vorrebbe dire far arrivare ogni segnalazione senza
  // numero né titolo solo perché il deploy delle regole non è ancora girato.
  const f = installFetch([403, 200]);
  const via = conPortafoglio('abcdef0123456789');
  try {
    const r = await FB.submit({ text: 'ciao', submissionId: 'a-5' });
    assert.equal(f.corpi.length, 2);
    assert.ok('updatedAt' in f.corpi[0].fields, 'il primo tentativo firma l\'ora');
    assert.equal('updatedAt' in f.corpi[1].fields, false);
    assert.ok('seq' in f.corpi[1].fields, 'il numero non si perde per un campo nuovo');
    assert.deepEqual(f.corpi[1].fields.walletPseudonym, { stringValue: 'abcdef0123456789' });
    assert.ok(r && r.seq, 'la segnalazione tiene il suo numero');
  } finally { via(); f.restore(); }
});
