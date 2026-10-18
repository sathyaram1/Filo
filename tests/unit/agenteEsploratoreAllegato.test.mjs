// L'agente esploratore e il codice di scarico (#582, giro 7).
//
// Da quando le regole del deposito negano la lettura a chiunque, la sola chiave
// di un allegato è il codice di scarico che il deposito rilascia alla creazione
// e che finisce dentro l'indirizzo. Un indirizzo senza quel codice non apre più
// niente, nemmeno a chi riceve le segnalazioni.
//
// Chi manda una segnalazione dall'app è coperto: `SN_FEEDBACK.uploadImage`
// rifiuta se il codice non arriva, e chi ha mandato ritrova il file fra quelli
// non caricati. L'agente esploratore carica sullo stesso deposito, con la
// stessa forma del nome, e costruiva l'indirizzo lo stesso: un allegato
// registrato come riuscito che nessuno avrebbe potuto aprire, scoperto
// settimane dopo davanti a un buco.
//
// Questa guardia sta qui, e non fra le prove del giro, perché deve essere
// rilanciata per sempre dalla suite.

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const { pushIssue, credenziale } = await import('../agent/feedback.mjs');
// Nessuna credenziale vera nei test: il token è finto, e chi lo vuole assente lo dice.
credenziale.ottieni = async () => ({ idToken: 'tok-admin' });
// Il modulo di cifratura lo registra già l'import qui sopra (l'agente lo carica
// come lo carica l'app): qui serve solo per rileggere cosa è finito nel deposito.
const CRYPTO = globalThis.SN_FEEDBACK_CRYPTO;

function screenshotFinto() {
  const dir = cartellaTemporanea('agente-allegato-');
  const p = join(dir, 'schermata.png');
  writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return p;
}

/** Finge il deposito e Firestore. `codice` vuoto = nessun codice di scarico. `create` raccoglie le create. */
function depositoFinto(codice, ricevuti = [], create = []) {
  const originale = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('uploadType=media')) {
      ricevuti.push({ tipo: (opts && opts.headers && opts.headers['Content-Type']) || '', corpo: opts && opts.body });
      return {
        ok: true,
        status: 200,
        json: async () => (codice ? { downloadTokens: codice } : { name: 'feedback/x.png' }),
        text: async () => '',
      };
    }
    create.push({ url: String(url), headers: { ...((opts && opts.headers) || {}) }, body: JSON.parse(opts.body) });
    return {
      ok: true,
      status: 200,
      json: async () => ({ name: 'projects/p/databases/(default)/documents/feedback/DOC' }),
      text: async () => '',
    };
  };
  return () => { globalThis.fetch = originale; };
}

const ISSUE = {
  model: 'prova', severity: 'low', area: 'prova', title: 'prova',
  detail: 'prova', foundAt: 'filo://dashboard',
};

test('senza codice di scarico non si registra nessun allegato', async () => {
  const ripristina = depositoFinto('');
  try {
    const esito = await pushIssue({ ...ISSUE, screenshotPath: screenshotFinto() });
    // Meglio nessun allegato che un allegato morto: la segnalazione parte lo
    // stesso, senza promettere un file che nessuno potrà aprire.
    assert.deepEqual(esito.images, [], `allegato senza codice: ${esito.images.join(', ')}`);
  } finally {
    ripristina();
  }
});

test('col codice di scarico l’allegato si registra e l’indirizzo lo porta', async () => {
  const ripristina = depositoFinto('CODICE-1');
  try {
    const esito = await pushIssue({ ...ISSUE, screenshotPath: screenshotFinto() });
    assert.equal(esito.images.length, 1);
    assert.match(esito.images[0], /[?&]token=CODICE-1\b/, `indirizzo senza codice: ${esito.images[0]}`);
  } finally {
    ripristina();
  }
});

// #602 — lo screenshot dell'agente sale CIFRATO come tutti gli altri allegati.
//
// Questa strada caricava nel deposito senza passare dalla cifratura: schermate
// dello schermo di chi lancia l'esplorazione, in chiaro, dietro un collegamento
// che gira. Il deposito è lo stesso degli allegati dell'app, e un punto che
// carica in chiaro vale tutti gli altri messi insieme.
test('lo screenshot dell’agente sale cifrato, non in chiaro', async () => {
  const ricevuti = [];
  const ripristina = depositoFinto('CODICE-1', ricevuti);
  try {
    const esito = await pushIssue({ ...ISSUE, screenshotPath: screenshotFinto() });
    assert.equal(esito.images.length, 1, 'l’allegato doveva registrarsi');
    assert.equal(ricevuti.length, 1, 'un caricamento solo');
    const byte = new Uint8Array(ricevuti[0].corpo);
    assert.ok(CRYPTO.isEncryptedBytes(byte), 'i byte caricati devono essere un ciphertext');
    // La firma del PNG non deve comparire: sarebbe l'immagine com'era.
    assert.notDeepEqual(
      Array.from(byte.slice(0, 4)),
      [0x89, 0x50, 0x4e, 0x47],
      'nel deposito non deve finire il PNG in chiaro',
    );
    assert.equal(ricevuti[0].tipo, 'application/octet-stream',
      'il contenuto cifrato è opaco: è il tipo che le regole del deposito ammettono');
  } finally {
    ripristina();
  }
});

// Come dall'app (#602): senza cifratura non parte niente, né lo screenshot né la segnalazione in chiaro.
test('senza cifratura non parte niente', async () => {
  const ricevuti = [];
  const create = [];
  const ripristina = depositoFinto('CODICE-1', ricevuti, create);
  const pub = globalThis.SN_FEEDBACK_PUBKEY;
  globalThis.SN_FEEDBACK_PUBKEY = null;
  try {
    await assert.rejects(pushIssue({ ...ISSUE, screenshotPath: screenshotFinto() }), /cifratura non disponibile/);
    assert.equal(ricevuti.length, 0, 'il deposito non doveva ricevere niente');
    assert.equal(create.length, 0, 'nessuna segnalazione in chiaro');
  } finally {
    globalThis.SN_FEEDBACK_PUBKEY = pub;
    ripristina();
  }
});

// #912 — l'esploratore crea solo con la credenziale admin e la prova del mittente: da anonimo sarebbe un utente.
test('senza credenziale admin l’esploratore non crea niente, e non ripiega sull’anonimo', async () => {
  const ricevuti = [];
  const create = [];
  const ripristina = depositoFinto('CODICE-1', ricevuti, create);
  const vera = credenziale.ottieni;
  credenziale.ottieni = async () => ({ idToken: '', motivo: 'nessuna credenziale' });
  try {
    await assert.rejects(pushIssue({ ...ISSUE, screenshotPath: screenshotFinto() }), /token admin/);
    assert.equal(create.length, 0, 'nessuna create');
    assert.equal(ricevuti.length, 0, 'nemmeno lo screenshot sale');
  } finally {
    credenziale.ottieni = vera;
    ripristina();
  }
});

test('con la credenziale la create è autenticata, porta la prova, e il mittente agent: viaggia cifrato', async () => {
  const create = [];
  const ripristina = depositoFinto('CODICE-1', [], create);
  try {
    await pushIssue({ ...ISSUE, model: 'gemma-4' });
    assert.equal(create.length, 1);
    const [c] = create;
    assert.equal(c.headers.Authorization, 'Bearer tok-admin');
    assert.deepEqual(c.body.fields.senderProof, { stringValue: 'admin' });
    for (const campo of ['clientId', 'text', 'url']) {
      assert.ok(CRYPTO.isEncrypted(c.body.fields[campo].stringValue), `${campo} in chiaro`);
    }
  } finally {
    ripristina();
  }
});
