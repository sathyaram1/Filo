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
  // Una segnalazione alla consegna ferma il lavoro finché l'owner non sceglie:
  // la scelta si scrive qui, ed è quello che chi riprende riceve.
  ['fermo su una scelta',            { status: 'design', statusReason: 'decisione', notes: 'Report.\n\nSegnalazione per l\'owner (chi risolve):\nA o B?',
                                       livelli: { l3: { esito: 'segnalato', ruolo: 'resolver', testo: 'A o B?' } } }],
  ['fermo su un rilievo col «?»',    { status: 'design', statusReason: 'decisione', notes: '[2i?] Il bordo: caldo o freddo?' }],
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

  test('il nome del rombo verde dice che ci sono domande, e copre tutte le parti del pannello', () => {
    for (const [nome, fb] of ASPETTANO) {
      const r = rombo(fb);
      assert.match(r.titolo, /^Domande/, `${nome}: il nome doveva parlare di domande`);
      assert.equal(r.pannello.titolo, r.titolo, `${nome}: titolo del pannello diverso dal nome`);
      if (fb.livelli && fb.livelli.l3) assert.match(r.titolo, /segnalazione/, `${nome}: la segnalazione manca dal titolo`);
    }
    assert.equal(rombo({ livelli: { l3: { esito: 'segnalato', testo: 'Due strade.' } } }).titolo, 'Segnalazione di Claude');
    assert.equal(rombo({ status: 'todo' }).titolo, 'Segnalazione di Claude');
    assert.equal(MR.livelloL3({ status: 'design', statusReason: 'clarify' }, { dettaglioLetto: false }).titolo, 'Domande di Claude');
  });

  test('una parte cifrata del pannello si dice con la frase, mai col blob', () => {
    const BLOB = 'FENCv1:8f3a2b91c7d4e6a0b5f2';
    const segn = (testo) => ({ l3: { esito: 'segnalato', ruolo: 'resolver', testo } });
    // Segnalazione cifrata, conversazione leggibile: la domanda resta, la segnalazione diventa la frase.
    const a = rombo({ status: 'design', statusReason: 'clarify', notes: domande, livelli: segn(BLOB) }).pannello;
    assert.doesNotMatch(a.testo, /FENC/);
    assert.match(a.testo, /sfondo/);
    assert.ok(a.testo.includes(MR.TESTO_CIFRATO));
    // Fermo su una scelta, segnalazione cifrata: idem.
    const b = rombo({ status: 'design', statusReason: 'decisione', notes: domande, livelli: segn(BLOB) }).pannello;
    assert.doesNotMatch(b.testo, /FENC/);
    assert.ok(b.testo.includes(MR.TESTO_CIFRATO));
    // Conversazione cifrata, segnalazione leggibile: la segnalazione resta, le domande non spariscono.
    const c = rombo({ status: 'design', statusReason: 'clarify', notes: BLOB, livelli: segn('Due strade possibili.') }).pannello;
    assert.doesNotMatch(c.testo, /FENC/);
    assert.match(c.testo, /Due strade possibili/);
    assert.match(c.testo, /Domande in attesa/);
    assert.ok(c.testo.includes(MR.TESTO_CIFRATO));
    // Tutte e due cifrate: una frase sola.
    assert.equal(rombo({ status: 'design', statusReason: 'clarify', notes: BLOB, livelli: segn(BLOB) }).pannello.illeggibile, true);
  });

  test('risposto, il rombo si spegne', () => {
    const prima = { status: 'design', statusReason: 'clarify', notes: domande };
    assert.equal(verde(prima), true);
    const dopo = { status: 'todo', statusReason: null, notes: `${domande}\n--- La tua risposta del 19/09/2026, 10:00 ---\nQuelle dentro.` };
    assert.equal(verde(dopo), false);
  });
});

// #764: la data di un marcatore è scritta giorno/mese; letta da `new Date()` diventava mese/giorno.
describe('la riga «Quando» del rombo verde è l’ultimo turno di Filo, in ogni giorno del mese', () => {
  const FT = globalThis.SN_FEEDBACK_THREAD;
  const quando = (fb) => (rombo(fb).pannello.righe.find((r) => r.etichetta === 'Quando') || {}).valore;
  const inAttesa = (marcatore) => ({
    status: 'design', statusReason: 'clarify',
    notes: ['Quale immagine intendi?', '--- La tua risposta del 01/09/26, 09:00 ---', 'Quelle dentro.',
      `--- Filo ha risposto il ${marcatore} ---`, 'Anche quelle di sfondo?'].join('\n'),
  });

  test('ogni giorno di settembre, anno a due o a quattro cifre, è il giorno giusto', () => {
    for (let g = 1; g <= 30; g++) {
      const gg = String(g).padStart(2, '0');
      for (const anno of ['26', '2026']) {
        const v = quando(inAttesa(`${gg}/09/${anno}, 11:05`));
        const d = new Date(v);
        assert.ok(!Number.isNaN(d.getTime()), `${gg}/09/${anno}: «${v}» non è una data`);
        assert.deepEqual([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()],
          [2026, 9, g, 11, 5], `${gg}/09/${anno}: data sbagliata`);
      }
    }
  });

  test('il 5 settembre resta il 5 settembre, non il 9 maggio', () => {
    const d = new Date(quando(inAttesa('05/09/26, 11:00')));
    assert.equal(d.getMonth() + 1, 9);
    assert.equal(d.getDate(), 5);
  });

  test('l’ISO passa com’è; una data che non esiste o che non si legge non diventa un’altra data', () => {
    assert.equal(FT.istanteDelMarcatore('2026-09-27T09:00:00.000Z'), '2026-09-27T09:00:00.000Z');
    for (const s of ['31/02/26, 10:00', '27/13/26, 10:00', '27/09/26, 25:00', 'ieri sera', '', null, undefined]) {
      assert.equal(FT.istanteDelMarcatore(s), null, `«${s}» doveva restare senza data`);
    }
    // Il pannello lo mostra com'è scritto invece di una riga vuota.
    assert.equal(quando(inAttesa('ieri sera')), 'ieri sera');
  });

  test('senza marcatore la data non si inventa', () => {
    assert.equal(quando({ status: 'design', statusReason: 'clarify', notes: domande }), undefined);
  });
});
