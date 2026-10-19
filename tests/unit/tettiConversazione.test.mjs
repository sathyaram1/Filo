// Sentinella dei tetti che riempiono la conversazione di un feedback (#1333, da #558): la critica, il testo di un
// livello e la conversazione intera contano la stessa unità (byte UTF-8) e sono dimensionati insieme, così un
// feedback lavorato per dieci giri conserva il primo turno in qualunque lingua. Il gemello server sta in filo-security.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MAX_CRITIQUE_BYTES, criticaTroppoLunga, byteLen } from '../../scripts/lib/tetto-critica.mjs';
import { MAX_LIVELLO_BYTES } from '../../scripts/lib/livelli.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'feedbackThread.js'));
const TH = globalThis.SN_FEEDBACK_THREAD;

const LINGUE = [['italiano', 'perché è così '], ['cirillico', 'я'], ['giapponese', 'あ'], ['emoji', '😀']];

/** Il testo più lungo che sta in `byte` byte, fatto ripetendo `pezzo` (mai un carattere spezzato). */
function pieno(pezzo, byte, testa = '') {
  let s = testa;
  for (const ch of pezzo.repeat(Math.ceil(byte / byteLen(pezzo)) + 1)) {
    if (byteLen(s + ch) > byte) break;
    s += ch;
  }
  return s;
}

test('il tetto di una critica conta i byte: in cirillico e in giapponese la stessa cifra non vale di più', () => {
  for (const [lingua, pezzo] of LINGUE) {
    const alTetto = pieno(pezzo, MAX_CRITIQUE_BYTES);
    assert.equal(criticaTroppoLunga(alTetto), '', `${lingua}: al tetto esatto passa`);
    const oltre = alTetto + pezzo;
    const no = criticaTroppoLunga(oltre);
    assert.match(no, new RegExp(`${byteLen(oltre)} byte, il massimo è ${MAX_CRITIQUE_BYTES}`), `${lingua}: oltre si rifiuta col numero`);
  }
  // Dodicimila caratteri giapponesi erano 36.000 byte e passavano: adesso no.
  assert.notEqual(criticaTroppoLunga('あ'.repeat(12000)), '');
});

test('oltre il tetto la critica è respinta, non tagliata: niente mezza emoji (il rilievo 2 di #558 resta chiuso)', () => {
  // Il caso del rilievo: il taglio cadeva a metà di un carattere fuori dal piano base.
  const critica = `${'x'.repeat(MAX_CRITIQUE_BYTES - 2)}😀\n[2i] rotto`;
  assert.match(criticaTroppoLunga(critica), /troppo lunga/);
  // Le due strade che registrano una critica usano questa regola, e nessuna la taglia prima.
  for (const file of ['scripts/dispatch.mjs', 'scripts/verify-local.mjs']) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    assert.match(src, /criticaTroppoLunga\(/, `${file}: il controllo della lunghezza è quello in byte`);
    assert.doesNotMatch(src, /MAX_CRITIQUE_CHARS|critique\.trim\(\)\.slice\(/, `${file}: niente tetto in caratteri né taglio della critica`);
  }
});

/** Una lavorazione da dieci giri di bocciatura, coi testi al loro tetto, come la scrivono le routine. */
function dieciGiri(pezzo) {
  let notes = TH.mergeModelReport('', `PRIMO REPORT. ${pieno(pezzo, MAX_CRITIQUE_BYTES)}`);
  for (let g = 1; g <= 10; g++) {
    // La critica col testo che il server aggiunge (esito del giro, feedback derivati): un migliaio di byte.
    const critica = `Verifica: 3 rilievi. ${'Un rilievo è esterno: diventa un feedback a parte. '.repeat(20)}\n${pieno(pezzo, MAX_CRITIQUE_BYTES)}`;
    notes = TH.mergeModelReport(notes, `GIRO ${g}. ${critica}`);
    notes = TH.mergeModelReport(notes, `CORREZIONE ${g}. ${pieno(pezzo, MAX_CRITIQUE_BYTES)}`);
  }
  notes = TH.mergeModelReport(notes, `SEGNALAZIONE. ${pieno(pezzo, MAX_LIVELLO_BYTES)}`);
  notes = TH.appendUserTurn(notes, `Risposta dell'owner. ${pieno(pezzo, 10000)}`);
  return TH.mergeModelReport(notes, `Controllo di sicurezza superato.\n${pieno(pezzo, MAX_LIVELLO_BYTES)}`);
}

test('dieci giri con critiche e report al tetto conservano il primo turno, in ogni lingua e con margine', () => {
  for (const [lingua, pezzo] of LINGUE) {
    const notes = dieciGiri(pezzo);
    const tagliate = TH.capNotes(notes);
    assert.equal(tagliate, notes, `${lingua}: la conversazione (${byteLen(notes)} byte) non deve perdere niente`);
    assert.ok(!tagliate.includes(TH.TRIM_MARK), `${lingua}: nessun turno rimosso`);
    assert.match(tagliate, /^PRIMO REPORT\./, `${lingua}: il primo turno resta leggibile`);
    assert.match(tagliate, /GIRO 10\./);
    // Il margine: alzare un tetto senza l'altro deve far diventare rossa questa riga, non i feedback veri.
    assert.ok(byteLen(notes) <= TH.NOTES_MAX * 0.8,
      `${lingua}: il caso peggiore realistico occupa ${byteLen(notes)} byte su ${TH.NOTES_MAX}: serve margine`);
  }
});

test('il tetto della conversazione resta sotto il limite delle regole e di un documento Firestore', () => {
  const regole = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
  const note = [...regole.matchAll(/get\('notes', ''\)\.size\(\) <= (\d+)/g)].map((m) => Number(m[1]));
  assert.ok(note.length >= 2 && note.every((n) => n === note[0]), 'i due rami delle regole hanno lo stesso tetto delle note');
  // Il cifrato occupa 6 + ceil(4*(94+byte)/3): la prova vera, cifrando, sta in feedbackNotesCap.test.mjs.
  assert.ok(6 + Math.ceil((4 * (94 + TH.NOTES_MAX)) / 3) <= note[0], 'le note al tetto, cifrate, passano le regole');
  const livello = Number((regole.match(/l\.get\('testo', ''\)\.size\(\) <= (\d+)/) || [])[1]);
  assert.ok(6 + Math.ceil((4 * (94 + MAX_LIVELLO_BYTES)) / 3) <= livello, 'il testo di un livello al tetto, cifrato, passa le regole');
  const testo = Number((regole.match(/request\.resource\.data\.text\.size\(\) <= (\d+)/) || [])[1]);
  // Un documento Firestore regge 1 MiB: note, i due livelli, il testo, e 200 KB per tutto il resto (giudizio, allegati).
  const documento = note[0] + 2 * livello + testo + 200 * 1024;
  assert.ok(documento <= 1024 * 1024, `un feedback al tetto peserebbe ${documento} byte, oltre il MiB di Firestore`);
});
