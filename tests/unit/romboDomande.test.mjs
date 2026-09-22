// Sentinella: la casella «Rispondi alle domande di Filo» e il rombo verde
// della fila delle forme nascono dalla stessa domanda.
//
// Chiederlo in due punti li aveva già fatti divergere: la casella compariva e
// il rombo restava grigio, e l'owner non vedeva dalla fila che una pratica
// aspettava la sua risposta. Qui l'invariante è un test, non un commento.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const shared = (f) => require(join(__dirname, '..', '..', 'src', 'shared', f));
shared('feedbackStatus.js');
shared('feedbackTransitions.js');
shared('feedbackThread.js');
shared('manageReview.js');

const MR = globalThis.SN_MANAGE_REVIEW;

const rombo = (fb) => MR.livelli(fb).find((l) => l.key === 'l3');
const verde = (fb) => { const r = rombo(fb); return !r.vuoto && r.classe === 'design'; };

const domande = 'Quale immagine intendi: quella di sfondo o quelle dentro la pagina?';

const ASPETTANO = [
  ['forma canonica',                 { status: 'design', statusReason: 'clarify', notes: domande }],
  ['forma legacy',                   { status: 'clarify', notes: domande }],
  ['legacy con un altro motivo',     { status: 'clarify', statusReason: 'judges', notes: domande }],
  ['senza conversazione',            { status: 'design', statusReason: 'clarify', notes: '' }],
  ['conversazione di soli spazi',    { status: 'design', statusReason: 'clarify', notes: '  \n \t ' }],
  ['conversazione cifrata',          { status: 'design', statusReason: 'clarify', notes: 'FENC:xxxx' }],
  ['con anche una segnalazione',     { status: 'design', statusReason: 'clarify', notes: domande,
                                       livelli: { l3: { esito: 'segnalato', testo: 'Due strade possibili.' } } }],
];

const NON_ASPETTANO = [
  ['design per i giudici',  { status: 'design', statusReason: 'judges' }],
  ['design in loop',        { status: 'design', statusReason: 'loop' }],
  ['in coda',               { status: 'todo', notes: domande }],
  ['risolta',               { status: 'done', notes: domande }],
  ['archiviata',            { status: 'archived', notes: domande }],
  ['stato illeggibile',     { status: 'FENC:xxxx', notes: domande }],
];

describe('rombo verde e casella delle risposte vanno insieme', () => {
  test('chi aspetta una risposta ha il rombo verde, e dice cosa c’è da rispondere', () => {
    for (const [nome, fb] of ASPETTANO) {
      assert.equal(MR.aspettaRisposta(fb), true, `${nome}: doveva aspettare una risposta`);
      assert.equal(verde(fb), true, `${nome}: il rombo doveva essere verde`);
      assert.equal(rombo(fb).esito, 'domande', `${nome}: esito sbagliato`);
      assert.ok(String(rombo(fb).pannello.testo || '').trim(), `${nome}: pannello senza testo`);
    }
  });

  test('chi non aspetta niente tiene il rombo grigio', () => {
    for (const [nome, fb] of NON_ASPETTANO) {
      assert.equal(MR.aspettaRisposta(fb), false, `${nome}: non doveva aspettare niente`);
      assert.equal(verde(fb), false, `${nome}: il rombo non doveva essere verde`);
    }
  });

  test('a conversazione avviata il pannello porta l’ultima domanda, non la prima', () => {
    const fb = {
      status: 'design', statusReason: 'clarify',
      notes: [
        'Quale immagine intendi?',
        '--- La tua risposta del 19/09/2026, 10:00 ---',
        'Quelle dentro la pagina.',
        '--- Filo ha risposto il 19/09/2026, 11:00 ---',
        'Anche sulle immagini di sfondo con parallasse?',
      ].join('\n'),
    };
    const testo = rombo(fb).pannello.testo;
    assert.match(testo, /parallasse/);
    assert.doesNotMatch(testo, /Quale immagine intendi/);
  });

  test('con una segnalazione già registrata il pannello mostra prima le domande', () => {
    const fb = {
      status: 'design', statusReason: 'clarify', notes: domande,
      livelli: { l3: { esito: 'segnalato', ruolo: 'resolver', testo: 'Due strade possibili.' } },
    };
    const testo = rombo(fb).pannello.testo;
    assert.match(testo, /sfondo/);
    assert.match(testo, /Due strade possibili/);
    assert.ok(testo.indexOf('sfondo') < testo.indexOf('Due strade possibili'),
      'le domande a cui rispondere adesso vanno prima della segnalazione già registrata');
  });

  test('risposto, il rombo si spegne', () => {
    const prima = { status: 'design', statusReason: 'clarify', notes: domande };
    assert.equal(verde(prima), true);
    const dopo = { status: 'todo', statusReason: null, notes: `${domande}\n--- La tua risposta del 19/09/2026, 10:00 ---\nQuelle dentro.` };
    assert.equal(verde(dopo), false);
  });
});
