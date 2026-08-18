// Unit test del TETTO alla conversazione di un feedback (capNotes).
//
// Sintomo dell'utente: "non riesco più a spostare i feedback", con un errore che
// dava la colpa ai permessi di amministratore. Causa vera: le Firestore rules
// limitano la dimensione di `notes` e validano il documento RISULTANTE — un
// feedback le cui note hanno superato il tetto respinge OGNI scrittura, anche il
// solo cambio di stato. Le note crescono a ogni turno, e il cammino che le
// scrive dalla GitHub Action usa un service account che BYPASSA le regole:
// poteva quindi sforare il tetto e rendere il feedback immobile.
//
// Pre-condizione che senza il fix fallirebbe: prima non esisteva alcun taglio,
// quindi il blob tornava lungo com'era e questi assert sulla lunghezza (e sulla
// conservazione dei turni recenti) diventano rossi se si rimuove capNotes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
require(join(ROOT, 'src', 'shared', 'feedbackThread.js'));

const TH = globalThis.SN_FEEDBACK_THREAD;

// Conversazione finta a turni: ogni turno è un blocco con marcatore.
function conversation(turns, bodyLen) {
  const parts = ['report iniziale della routine: ' + 'a'.repeat(bodyLen)];
  for (let i = 0; i < turns; i++) {
    parts.push(`--- La tua risposta del 0${i}/01/26, 10:00 ---\nrisposta ${i} ` + 'b'.repeat(bodyLen));
  }
  return parts.join('\n\n');
}

test('note sotto il tetto: restituite identiche (nessun taglio inutile)', () => {
  const notes = conversation(3, 100);
  assert.equal(TH.capNotes(notes), notes);
  assert.equal(TH.capNotes(''), '');
  assert.equal(TH.capNotes(null), '');
});

test('note oltre il tetto: rientrano nel limite delle regole', () => {
  const notes = conversation(20, 5000); // ~100k, ben oltre NOTES_MAX
  assert.ok(notes.length > TH.NOTES_MAX, 'il caso di test deve partire oltre il tetto');
  const capped = TH.capNotes(notes);
  assert.ok(capped.length <= TH.NOTES_MAX, `capNotes deve rientrare: ${capped.length}`);
});

test('il taglio parte dai turni PIÙ VECCHI e conserva l’ultimo', () => {
  const notes = conversation(20, 5000);
  const capped = TH.capNotes(notes);
  assert.ok(capped.includes('risposta 19'), 'l’ultimo turno deve restare');
  assert.ok(!capped.includes('report iniziale della routine'), 'il turno più vecchio va tagliato');
  assert.ok(capped.startsWith(TH.TRIM_MARK), 'il taglio deve essere dichiarato in cima');
});

test('un turno unico più lungo del tetto viene troncato, non moltiplicato', () => {
  const notes = 'x'.repeat(TH.NOTES_MAX * 2);
  const capped = TH.capNotes(notes);
  assert.ok(capped.length <= TH.NOTES_MAX);
  assert.ok(capped.startsWith(TH.TRIM_MARK));
});

test('tetto piccolo su misura: il testo tagliato resta una conversazione leggibile', () => {
  const notes = conversation(3, 200);
  const capped = TH.capNotes(notes, 500);
  assert.ok(capped.length <= 500);
  // Deve restare un turno riconoscibile dal parser (non un troncone a metà riga
  // che fa sparire la conversazione dalla dashboard).
  const turns = TH.splitNotes(capped);
  assert.ok(turns.length >= 1);
});

// Il taglio deve stare sul CAMMINO DI SCRITTURA, non solo nella funzione: è
// quello che impedisce al feedback di diventare immobile. Qui si intercetta la
// richiesta che parte verso Firestore e si guarda cosa contiene davvero.
test('il salvataggio dalla dashboard non spedisce mai note oltre il tetto', async () => {
  require(join(ROOT, 'src', 'shared', 'feedback.js'));
  const FB = globalThis.SN_FEEDBACK;

  let sent = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    sent = JSON.parse(opts.body);
    return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
  };
  try {
    await FB.updateStatus('doc-1', { notes: conversation(20, 5000) }, { idToken: 'x' });
  } finally {
    globalThis.fetch = realFetch;
  }

  const notes = sent.fields.notes.stringValue;
  assert.ok(notes.length <= TH.NOTES_MAX, `spedite ${notes.length} char, tetto ${TH.NOTES_MAX}`);
  assert.ok(notes.includes('risposta 19'), 'l’ultimo turno deve arrivare a destinazione');
});

/** Il tetto dichiarato nelle regole Firestore (i due rami devono concordare). */
async function tettoDelleRegole() {
  const { readFileSync } = await import('node:fs');
  const rules = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
  const limits = [...rules.matchAll(/get\('notes', ''\)\.size\(\) <= (\d+)/g)].map((m) => Number(m[1]));
  assert.ok(limits.length >= 2, 'attesi i due rami (admin e routine) che limitano le note');
  for (const l of limits) assert.equal(l, limits[0], 'i due rami delle regole devono avere lo stesso tetto');
  return limits[0];
}

test('il tetto in chiaro lascia spazio all’espansione del cifrato', async () => {
  // IL TAGLIO SI FA IN CHIARO, MA SU FIRESTORE CI VA IL CIFRATO. Da quando il
  // report viaggia cifrato, un tetto uguale a quello delle regole non protegge
  // più niente: il testo passa il taglio e viene respinto dalle regole subito
  // dopo, e il feedback diventa immobile — cioè il guaio che il tetto esiste
  // per impedire. Qui non si stima l'espansione: si cifra davvero il testo più
  // lungo che il taglio può produrre e si guarda quanto occupa.
  require(join(ROOT, 'src', 'shared', 'feedbackPublicKey.js'));
  require(join(ROOT, 'src', 'shared', 'feedbackCrypto.js'));
  const CRYPTO = globalThis.SN_FEEDBACK_CRYPTO;

  const limite = await tettoDelleRegole();
  const alTetto = TH.capNotes(conversation(40, 3000));
  assert.ok(alTetto.length > TH.NOTES_MAX * 0.9, 'il caso di prova deve arrivare vicino al tetto');

  const cifrato = await CRYPTO.encryptForOwner(alTetto);
  assert.ok(cifrato.startsWith('FENC'), 'la prova vale solo se il testo è stato davvero cifrato');
  assert.ok(cifrato.length <= limite,
    `il testo tagliato, una volta cifrato, occupa ${cifrato.length} caratteri e il tetto delle regole è ${limite}: `
    + 'la prossima scrittura verrebbe respinta e il feedback resterebbe immobile');
});

test('il tetto tiene anche se il feedback NON è scritto in italiano', async () => {
  // Il tetto contato in CARATTERI regge finché il testo è quasi tutto ASCII, e
  // cade in silenzio appena qualcuno scrive con accenti fitti, in cirillico o
  // in giapponese: le stesse 40.000 lettere lì sono il doppio o il triplo dei
  // byte, e il cifrato cresce sui BYTE. Il feedback passava il taglio e da quel
  // momento la dashboard non poteva più scriverci nulla.
  require(join(ROOT, 'src', 'shared', 'feedbackPublicKey.js'));
  require(join(ROOT, 'src', 'shared', 'feedbackCrypto.js'));
  const CRYPTO = globalThis.SN_FEEDBACK_CRYPTO;
  const limite = await tettoDelleRegole();

  for (const [lingua, lettera] of [['cirillico', 'я'], ['giapponese', 'あ'], ['accentato', 'è'], ['emoji', '😀']]) {
    const tagliato = TH.capNotes(lettera.repeat(60000));
    const cifrato = await CRYPTO.encryptForOwner(tagliato);
    assert.ok(cifrato.length <= limite,
      `${lingua}: dopo il taglio il cifrato occupa ${cifrato.length}, oltre il tetto delle regole (${limite})`);
    // E il taglio non deve spezzare un carattere a metà.
    assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(tagliato), false,
      `${lingua}: il taglio ha lasciato mezzo carattere in coda`);
  }
});
