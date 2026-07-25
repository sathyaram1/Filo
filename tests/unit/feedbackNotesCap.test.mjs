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

test('il tetto del codice combacia con quello dichiarato nelle Firestore rules', async () => {
  const { readFileSync } = await import('node:fs');
  const rules = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
  const limits = [...rules.matchAll(/get\('notes', ''\)\.size\(\) <= (\d+)/g)].map((m) => Number(m[1]));
  assert.ok(limits.length >= 2, 'attesi i due rami (admin e routine) che limitano le note');
  for (const l of limits) {
    assert.equal(l, TH.NOTES_MAX, 'regole e capNotes devono usare lo stesso tetto');
  }
});
