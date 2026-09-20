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

const { pushIssue } = await import('../agent/feedback.mjs');
// Il modulo di cifratura lo registra già l'import qui sopra (l'agente lo carica
// come lo carica l'app): qui serve solo per rileggere cosa è finito nel deposito.
const CRYPTO = globalThis.SN_FEEDBACK_CRYPTO;

function screenshotFinto() {
  const dir = cartellaTemporanea('agente-allegato-');
  const p = join(dir, 'schermata.png');
  writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return p;
}

/** Finge il deposito e Firestore. `codice` vuoto = nessun codice di scarico. */
function depositoFinto(codice, ricevuti = []) {
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

test('senza cifratura non parte nessuno screenshot, e la segnalazione va lo stesso', async () => {
  const ricevuti = [];
  const ripristina = depositoFinto('CODICE-1', ricevuti);
  const pub = globalThis.SN_FEEDBACK_PUBKEY;
  globalThis.SN_FEEDBACK_PUBKEY = null;
  try {
    const esito = await pushIssue({ ...ISSUE, screenshotPath: screenshotFinto() });
    assert.deepEqual(esito.images, [], 'niente allegato');
    assert.equal(ricevuti.length, 0, 'il deposito non doveva ricevere niente');
    assert.ok(esito.id, 'la segnalazione parte lo stesso, senza schermata');
  } finally {
    globalThis.SN_FEEDBACK_PUBKEY = pub;
    ripristina();
  }
});
