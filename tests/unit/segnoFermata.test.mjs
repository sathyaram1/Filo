// Il segno dei Ricevuti (#603, D93): la forma del livello che ha fermato la pratica, mai il solo colore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackStatus.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackThread.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'manageReview.js'));
const MR = globalThis.SN_MANAGE_REVIEW;

const forma = (fb, opts) => (MR.segnoFermata(fb, opts) || {}).forma || null;

test('«bloccato dalla sicurezza» e «attacco» hanno lo stesso rosso ma forme diverse', () => {
  const sicurezza = { _id: 'a', seq: 1, status: 'design', statusReason: 'secaudit' };
  const attacco = { _id: 'b', seq: 2, status: 'attack', pipeline: { verdicts: [{ judge: 'x', class: 'attack' }] } };
  assert.equal(MR.classifyBlock(sicurezza).color, MR.classifyBlock(attacco).color);
  assert.equal(forma(sicurezza), 'pentagono');
  assert.equal(forma(attacco), 'cerchio');
  assert.notEqual(MR.segnoFermata(sicurezza).testo, MR.segnoFermata(attacco).testo);
});

test('ogni motivo dei Ricevuti ha un segno, con la forma del suo livello', () => {
  const casi = [
    [{ status: 'design', statusReason: 'l5' }, 'quadrato', 'l5'],
    [{ status: 'design', statusReason: 'clarify' }, 'rombo', 'l3'],
    [{ status: 'design', statusReason: 'decisione' }, 'rombo', 'l3'],
    [{ status: 'design', statusReason: 'loop' }, 'rombo', 'l3'],
    [{ status: 'design', statusReason: 'arenato' }, 'rombo', 'l3'],
    [{ status: 'design', statusReason: 'guasto' }, 'rombo', 'l3'],
    [{ status: 'design', statusReason: 'locale' }, 'rombo', 'l3'],
    [{ status: 'design', statusReason: 'judges' }, 'cerchio', 'l2'],
    [{ status: 'design' }, 'cerchio', 'l2'],
    [{ status: 'attack', pipeline: { action: 'block_attack', l1Category: 'dangerous' } }, 'triangolo', 'l1'],
    [{ status: 'spam', pipeline: { action: 'block_spam' } }, 'triangolo', 'l1'],
    [{ status: 'spam', pipeline: { verdicts: [{ class: 'spam' }] } }, 'cerchio', 'l2'],
    [{ status: 'suspicious_file' }, 'triangolo', 'l1'],
    [{ status: 'unlabeled' }, 'cerchio', 'l2'],
    [{ status: 'aligned', pipeline: { verdicts: [{ class: 'aligned' }] } }, 'cerchio', 'l2'],
  ];
  for (const [fb, f, liv] of casi) {
    const s = MR.segnoFermata(fb);
    assert.ok(s, JSON.stringify(fb));
    assert.equal(s.forma, f, JSON.stringify(fb));
    assert.equal(s.livello, liv, JSON.stringify(fb));
    assert.ok(MR.FORME_SVG[s.forma], s.forma);
    assert.ok(s.testo && !/secaudit|clarify|undefined/.test(s.testo), s.testo);
  }
});

test('una fusione ferma porta il quadrato anche prima che lo stato arrivi al cancello', () => {
  const fb = { _id: 'id-9', seq: 9, status: 'revision_security' };
  assert.equal(forma(fb), null);
  assert.equal(forma(fb, { fusioni: { pending: [{ feedbackId: 'id-9' }] } }), 'quadrato');
});

test('il segno sparisce quando la risposta parte (la pratica torna in coda)', () => {
  const fb = { status: 'design', statusReason: 'clarify' };
  assert.equal(forma(fb), 'rombo');
  for (const status of ['todo', 'working', 'done', 'archived', 'attack_confirmed']) {
    assert.equal(MR.segnoFermata({ ...fb, status }), null, status);
  }
});

test('stato illeggibile o feedback assente: nessun segno inventato', () => {
  assert.equal(MR.segnoFermata(null), null);
  const cifrato = { status: 'FENC1:AAAA', statusPublic: 'open' };
  assert.equal(MR.statusUnreadable(cifrato), true);
  assert.equal(MR.segnoFermata(cifrato), null);
});

// #1060: «Richiede lavoro locale» è un rombo azzurro (lo schermo di 💻), in lista e nella fila del dettaglio.
const LOCALE = {
  _id: 'loc', seq: 831, status: 'design', statusReason: 'locale', clientId: 'local:claude',
  notes: "Report.\n\n--- Aggiornamento dell'agente del 06/10/26, 03:58 ---\nRichiede lavoro locale. Va lanciato lo script sulla tua macchina.",
};

test('richiede lavoro locale: rombo azzurro in lista, gli altri rombi restano verdi', () => {
  const s = MR.segnoFermata(LOCALE);
  assert.equal(s.forma, 'rombo');
  assert.equal(s.classe, 'locale');
  assert.match(s.testo, /lavoro locale/);
  assert.equal(MR.LIVELLO_COLORI.locale, '#26c9fc');
  for (const statusReason of ['clarify', 'decisione', 'loop', 'arenato', 'guasto']) {
    assert.equal(MR.segnoFermata({ status: 'design', statusReason }).classe, 'design', statusReason);
  }
});

// #1241: un guasto rimandato all'owner si leggeva come lavoro locale, o come verdetto dei giudici.
test('fermo per un guasto: segno, frase e motivo dicono guasto, non lavoro locale né giudici', () => {
  const fb = { status: 'design', statusReason: 'guasto', notes: 'Guasto, non lavoro locale: guasto: filo-security. Domanda D-9.' };
  for (const testo of [MR.segnoFermata(fb).testo, MR.judgesNote(fb).text, MR.reasonText('guasto')]) {
    assert.match(testo, /guasto/i, testo);
    assert.doesNotMatch(testo, /giudici|lavoro locale/i, testo);
  }
  assert.equal(MR.chiedeLavoroLocale(fb), false);
});

test('richiede lavoro locale: nel dettaglio il rombo è azzurro e dice perché, anche prima del documento intero', () => {
  const l3 = MR.livelloPer(LOCALE, 'l3');
  assert.equal(l3.forma, 'rombo');
  assert.equal(l3.classe, 'locale');
  assert.equal(l3.colore, MR.LOCALE.color);
  assert.equal(l3.vuoto, false);
  assert.equal(l3.titolo, 'Richiede lavoro locale');
  assert.match(l3.pannello.testo, /lanciato lo script/);
  assert.doesNotMatch(l3.pannello.testo, /^Report/);
  const righe = l3.pannello.righe.map((r) => `${r.etichetta}: ${r.valore}`).join(' | ');
  assert.match(righe, /In breve: Richiede lavoro locale/);
  assert.match(righe, /Quando: 2026-10-06/);

  const daLista = MR.livelloL3(LOCALE, { dettaglioLetto: false });
  assert.equal(daLista.classe, 'locale', 'lo stato basta a dirlo');
  assert.equal(daLista.titolo, 'Richiede lavoro locale');
  assert.match(daLista.pannello.testo, /non è ancora arrivato/);

  // Fuori dai Ricevuti (approvato come lavoro locale, o chiuso) il rombo torna grigio.
  for (const status of ['todo', 'working', 'done']) {
    assert.equal(MR.livelloL3({ ...LOCALE, status }).vuoto, true, status);
  }
  assert.equal(MR.livelloL3({ status: 'FENC:xxxx', statusReason: 'locale' }).classe, null);
});

test('richiede lavoro locale: con una segnalazione salvata le mostra tutte e due, e il cifrato si dice', () => {
  const con = MR.livelloL3({ ...LOCALE, livelli: { l3: { esito: 'segnalato', testo: 'Due strade possibili.' } } });
  assert.match(con.pannello.testo, /lanciato lo script/);
  assert.match(con.pannello.testo, /## Segnalazione\nDue strade possibili/);
  const cifrato = MR.livelloL3({ ...LOCALE, notes: 'FENC:xxxx' });
  assert.equal(cifrato.classe, 'locale');
  assert.equal(cifrato.pannello.illeggibile, true);
  assert.doesNotMatch(cifrato.pannello.testo, /FENC/);
  const senzaNote = MR.livelloL3({ ...LOCALE, notes: '' });
  assert.equal(senzaNote.classe, 'locale');
  assert.match(senzaNote.pannello.righe[0].valore, /lavoro locale/);
});

test('ogni colore dei livelli ha la sua regola CSS, uguale, in gestione e nella pagina dei feedback', () => {
  const pagina = (p) => readFileSync(join(__dirname, '..', '..', 'src', 'pages', p), 'utf8');
  const gestione = pagina('manage/manage.html');
  const feedback = pagina('feedback/feedback.html');
  for (const [classe, colore] of Object.entries(MR.LIVELLO_COLORI)) {
    for (const [html, prefisso] of [[gestione, 'mg-forma'], [feedback, 'fb-segno']]) {
      const m = html.match(new RegExp(`\\.${prefisso}--${classe}\\s*\\{\\s*color:\\s*(#[0-9a-f]{6})`, 'i'));
      assert.ok(m, `.${prefisso}--${classe} manca`);
      assert.equal(m[1].toLowerCase(), colore.toLowerCase(), `.${prefisso}--${classe}`);
    }
  }
});
