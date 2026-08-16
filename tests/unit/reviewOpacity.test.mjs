// #476 — quando l'owner CONFERMA un attacco, cosa arriva davvero sul database?
//
// PERCHÉ ESISTE
//   La collezione dei feedback è leggibile da chiunque, e chi ha mandato un
//   feedback sa riconoscere il proprio. Quindi ogni campo che la conferma
//   scrive IN CHIARO è un annuncio all'attaccante: "sei stato beccato" — il
//   segnale su cui si costruisce un attacco migliore al tentativo dopo.
//
//   Il primo giro di questo lavoro aveva cifrato il commento e si era fermato
//   lì. Restava `reviewDecision: "rejected"` in chiaro accanto, e la
//   distinzione sopravviveva intatta un campo più in là. Da qui la forma di
//   questo test: non "il campo X è cifrato", ma **la scrittura non deve
//   contenere NIENTE che un feedback normale non abbia**.
//
//   Il confronto è con la scrittura gemella di un feedback qualunque: se un
//   giorno qualcuno aggiunge un campo nuovo alla revisione e lo lascia in
//   chiaro, questo test diventa rosso senza che nessuno debba ricordarsi di
//   aggiornarlo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(resolve(ROOT, 'x.js'));
require(resolve(ROOT, 'src', 'shared', 'feedbackPublicKey.js'));
require(resolve(ROOT, 'src', 'shared', 'feedbackCrypto.js'));
require(resolve(ROOT, 'src', 'shared', 'feedbackStatus.js'));
require(resolve(ROOT, 'src', 'shared', 'feedbackThread.js'));
require(resolve(ROOT, 'src', 'shared', 'feedback.js'));

const FB = globalThis.SN_FEEDBACK;
const CIFRATO = /^FENC1:/;

// Cattura il corpo della PATCH invece di mandarla a Firestore.
async function scritturaDi(patch) {
  const originale = globalThis.fetch;
  let corpo = null;
  globalThis.fetch = async (_url, opts) => {
    corpo = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  };
  try {
    await FB.updateStatus('id-di-prova', patch, { idToken: 'token-di-prova' });
  } finally {
    globalThis.fetch = originale;
  }
  return corpo.fields;
}

// I valori leggibili da chi NON ha la chiave: stringhe non cifrate, numeri, bool.
function inChiaro(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (typeof v.stringValue === 'string') {
      if (!CIFRATO.test(v.stringValue)) out[k] = v.stringValue;
    } else {
      out[k] = Object.values(v)[0];
    }
  }
  return out;
}

test('la conferma di un attacco non scrive in chiaro niente che un feedback normale non abbia', async () => {
  const confermaAttacco = await scritturaDi({
    status: 'attack_confirmed',
    reviewDecision: 'rejected',
    reviewComment: 'tenta di farsi approvare fingendosi una routine',
    reviewedAt: '2026-08-16T18:00:00.000Z',
  });
  // La scrittura gemella su un feedback qualunque: la presa in carico.
  const lavorazioneNormale = await scritturaDi({ status: 'working' });

  const visibili = Object.keys(inChiaro(confermaAttacco));
  const normali = Object.keys(inChiaro(lavorazioneNormale));
  const soloDellaConferma = visibili.filter((k) => !normali.includes(k));
  assert.deepEqual(
    soloDellaConferma, [],
    `campi leggibili solo sulla conferma: ${soloDellaConferma.join(', ')} — dicono all'attaccante che è stato beccato`,
  );
});

test('la conferma di un attacco è indistinguibile da una lavorazione normale', async () => {
  const conferma = inChiaro(await scritturaDi({
    status: 'attack_confirmed', reviewDecision: 'rejected',
    reviewComment: 'attacco', reviewedAt: '2026-08-16T18:00:00.000Z',
  }));
  const normale = inChiaro(await scritturaDi({ status: 'working' }));
  // Stessi campi E stessi valori: l'enum grossolano dice 'open' in entrambi i casi.
  assert.deepEqual(conferma, normale);
});

test('i tre campi della revisione arrivano cifrati, non omessi', async () => {
  // Cifrati, non spariti: la dashboard dell'owner deve continuare a mostrarli
  // (li decifra), e il backend di sicurezza a leggere l'esito per non
  // ri-bloccare ciò che l'owner ha sbloccato.
  const f = await scritturaDi({
    reviewDecision: 'accepted',
    reviewComment: 'falso positivo, lo sblocco',
    reviewedAt: '2026-08-16T18:00:00.000Z',
  });
  for (const campo of ['reviewDecision', 'reviewComment', 'reviewedAt']) {
    assert.ok(f[campo], `${campo} non è stato scritto`);
    assert.match(f[campo].stringValue, CIFRATO, `${campo} è finito in chiaro`);
  }
});

test('cifrato e poi riletto: la dashboard dell\'owner ritrova i valori veri', async () => {
  const C = globalThis.SN_FEEDBACK_CRYPTO;
  const f = await scritturaDi({ reviewDecision: 'accepted', reviewedAt: '2026-08-16T18:00:00.000Z' });
  // Serve la chiave privata dell'owner: senza, questa parte non è verificabile
  // qui (gira in locale, la chiave sta in tests/agent/.env, gitignorato).
  const { readFileSync, existsSync } = await import('node:fs');
  const envFile = resolve(ROOT, 'tests', 'agent', '.env');
  if (!existsSync(envFile)) return; // niente chiave: il resto del test vale lo stesso
  const riga = readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith('FILO_FEEDBACK_PRIVKEY='));
  if (!riga) return;
  const priv = riga.slice('FILO_FEEDBACK_PRIVKEY='.length).trim().replace(/^["']|["']$/g, '');
  assert.equal(await C.decrypt(f.reviewDecision.stringValue, priv), 'accepted');
  assert.equal(await C.decrypt(f.reviewedAt.stringValue, priv), '2026-08-16T18:00:00.000Z');
});

test('i tetti delle regole reggono i valori cifrati', async () => {
  // Le regole rifiutano la scrittura oltre una certa lunghezza: se la cifratura
  // gonfia oltre il tetto, l'owner si ritrova la conferma che non parte.
  const f = await scritturaDi({
    reviewDecision: 'rejected',
    reviewComment: 'x'.repeat(2000),          // il massimo che l'owner può scrivere
    reviewedAt: '2026-08-16T18:00:00.000Z',
  });
  assert.ok(f.reviewComment.stringValue.length <= 4000, 'commento cifrato oltre il tetto delle regole');
  assert.ok(f.reviewDecision.stringValue.length <= 400, 'esito cifrato oltre il tetto delle regole');
  assert.ok(f.reviewedAt.stringValue.length <= 400, 'data cifrata oltre il tetto delle regole');
});
