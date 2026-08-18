// I DUE TESTI: il report per l'owner e la frase per chi ha segnalato.
//
// PERCHÉ QUESTO FILE ESISTE
//   Finché il testo era uno solo, non poteva essere protetto: la stessa nota
//   veniva mostrata a chi aveva mandato il feedback, quindi doveva restare
//   leggibile da chiunque — e il report dell'owner, con le scelte della
//   lavorazione, viaggiava in chiaro dentro un database pubblico.
//
//   Separarli funziona solo se REGGONO TRE COSE INSIEME:
//     a) chi consegna riesce davvero a mandare due testi (non uno che ne
//        sovrascrive un altro, e non uno che il canale scarta in silenzio);
//     b) a chi ha segnalato arriva la frase, MAI il report;
//     c) se la frase non c'è e il report è cifrato, non gli si mostra il blob:
//        si tace.
//
//   (a) si prova lanciando gli strumenti VERI contro un server finto e
//   guardando cosa arriva sul filo — un controllo sulle sole funzioni non
//   vedrebbe un campo scartato dalla riga di comando, che è esattamente il modo
//   in cui il report era già sparito una volta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import '../../src/shared/feedbackThread.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const THREAD = globalThis.SN_FEEDBACK_THREAD;

/** Server finto: accetta tutto e tiene da parte i corpi ricevuti. */
function fintoServer() {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = body ? JSON.parse(body) : {}; } catch (_) {}
      ricevuti.push({ url: req.url, body: j });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

function esegui(script, argv, env) {
  return new Promise((r) => {
    execFile(process.execPath, [resolve(REPO, 'scripts', script), ...argv], { env: { ...process.env, ...env } },
      (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, so: String(so || ''), se: String(se || '') }));
  });
}

test('il canale manda DUE testi distinti: il report e la frase', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  try {
    const r = await esegui('routine-channel.mjs', [
      'deliver', 'biglietto-di-prova', 'status',
      '--status', 'revision_capability',
      '--notes', 'Report per l’owner: ho scartato la strada A perché costava una chiamata a pagamento in più.',
      '--frase', 'Ora puoi rimuovere un modello dalle impostazioni.',
      '--branch', 'worker/900',
    ], { FILO_ROUTINE_API: `http://127.0.0.1:${port}` });
    assert.equal(r.code, 0, `la consegna doveva essere accettata (stderr: ${r.se})`);

    const consegna = ricevuti.find((x) => x.url.includes('routineDeliver'));
    assert.ok(consegna, 'la consegna deve arrivare al server');
    const d = consegna.body.data || {};
    assert.match(String(d.notes), /scartato la strada A/, 'il report per l’owner deve arrivare');
    assert.equal(d.userNote, 'Ora puoi rimuovere un modello dalle impostazioni.',
      'la frase per chi ha segnalato deve arrivare col nome che il server legge');
    assert.equal(d.frase, undefined,
      'un campo che il server non conosce verrebbe scartato in silenzio: la frase sarebbe persa');
    assert.notEqual(d.notes, d.userNote, 'sono due testi, non lo stesso testo due volte');
  } finally { srv.close(); }
});

test('la correzione consegna il report E la frase (non solo il report)', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const casa = mkdtempSync(resolve(tmpdir(), 'filo-due-testi-'));
  try {
    // `--record-fixed` passa dallo stato locale del giro: gli si dà una cartella
    // usa-e-getta, così non tocca niente di reale.
    mkdirSync(resolve(casa, 'stato'), { recursive: true });
    writeFileSync(resolve(casa, 'stato', 'fid-900.json'), JSON.stringify({
      id: 'fid-900', branch: 'worker/900', loopCount: 1, verifierVerdict: 'fail',
    }), 'utf8');
    mkdirSync(resolve(casa, '.claude'), { recursive: true });
    writeFileSync(resolve(casa, '.claude', 'routine-ticket.json'),
      JSON.stringify({ ticket: 'biglietto-di-prova' }), 'utf8');

    const r = await esegui('dispatch.mjs', [
      '--record-fixed', 'fid-900',
      'Report per l’owner: la causa era altrove, il pulsante non veniva mai agganciato.',
      '--frase', 'Il pulsante per rimuovere un modello ora funziona.',
    ], {
      FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
      FILO_REPO_ROOT: casa,
      FILO_DISPATCH_STATE_DIR: resolve(casa, 'stato'),
      FILO_SPOOL_DIR: resolve(casa, 'coda'),
      FILO_ROUTINES_ENABLED: '1',
    });

    const consegna = ricevuti.find((x) => x.url.includes('routineDeliver'));
    assert.ok(consegna, `la correzione deve consegnare al server (uscita ${r.code}, stderr: ${r.se})`);
    const d = consegna.body.data || {};
    assert.match(String(d.report), /la causa era altrove/,
      'il report per l’owner non deve essere mangiato dalla riga di comando');
    assert.equal(d.userNote, 'Il pulsante per rimuovere un modello ora funziona.',
      'senza questa, a chi ha segnalato arriva "risolto" e basta');
    assert.equal(String(d.report).includes('--frase'), false,
      'la frase non deve finire dentro il report: sarebbero due testi impastati in uno');
  } finally { srv.close(); rmSync(casa, { recursive: true, force: true }); }
});

test('a chi ha segnalato arriva la frase, mai il report cifrato', () => {
  const letto = THREAD.explanationForReporter({
    userNote: 'Ora puoi incollare un’immagine direttamente nella chat.',
    notes: 'FENC1:blob-illeggibile-che-non-deve-uscire-di-qui',
  });
  assert.equal(letto, 'Ora puoi incollare un’immagine direttamente nella chat.');
  assert.equal(letto.includes('FENC'), false);
});

test('report cifrato e nessuna frase → non si mostra il blob, si tace', () => {
  assert.equal(THREAD.explanationForReporter({ notes: 'FENC1:blob' }), '',
    'un ciphertext mostrato a chi ha segnalato è peggio del silenzio');
});

test('feedback storici: un solo testo in chiaro → si continua a leggerlo', () => {
  // Prima della separazione il report stava tutto in `notes`, in chiaro. Chi
  // torna su un feedback vecchio deve continuare a vedere qualcosa.
  const vecchio = { notes: 'Risolto: il pulsante ora compare nelle impostazioni.' };
  assert.match(THREAD.explanationForReporter(vecchio), /il pulsante ora compare/);
});
