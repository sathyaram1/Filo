// Unit test della vista pubblica dei feedback (#583):
// src/shared/feedbackPublicView.js — chi ha una scheda leggibile da chiunque,
// con quali campi dentro, e cosa va scritto o tolto per tenerla in pari.
//
// È la decisione che sostituisce il filtro lato pagina della bacheca: prima
// "filtrato" voleva dire solo "non disegnato", e il documento intero era già
// arrivato sul computer di chi guardava. Qui si decide PRIMA, dove lo status
// si può leggere davvero, e quello che non passa non viene mai pubblicato.
//
// Senza il fix questo file non esiste: il test è rosso perché il modulo manca.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
require(join(ROOT, 'src', 'shared', 'feedbackPublicView.js'));
const V = globalThis.SN_FEEDBACK_PUBLIC_VIEW;

// Un fix chiuso, uscito in produzione, mai toccato dalla sicurezza.
const PULITO = {
  _id: 'fb-1',
  name: 'Migliorata la cattura schermo',
  text: 'TESTO-GREZZO',
  url: 'https://esempio.invalid/pagina-privata',
  userAgent: 'Mozilla/5.0 (chissà chi)',
  images: ['https://storage.invalid/uno.png'],
  notes: 'FENC1:report-per-owner',
  clientId: 'tester@example.com',
  clientIdHash: 'a'.repeat(32),
  userNote: 'Ora la cattura prende anche la barra.',
  priority: 3,
  status: 'done',
  statusPublic: 'closed',
  resolvedInVersion: '0.2.70',
  createdAt: '2026-06-20T10:00:00Z',
  resolvedAt: '2026-06-22T10:00:00Z',
  seq: 42,
  subSeq: 0,
};

test('la scheda porta i campi pubblici e NIENTE altro', () => {
  const card = V.cardFor(PULITO);
  assert.ok(card, 'un fix chiuso e pulito deve avere una scheda');
  assert.equal(card.name, 'Migliorata la cattura schermo');
  assert.equal(card.seq, 42);
  assert.equal(card.status, 'done');
  assert.equal(card.statusPublic, 'closed');
  assert.equal(card.resolvedInVersion, '0.2.70');
  assert.equal(card.userNote, 'Ora la cattura prende anche la barra.');
  // L'impronta è di QUESTA scheda, non dell'installazione: senza l'id della
  // scheda dentro, due fix della stessa persona porterebbero lo stesso valore e
  // chiunque legge la bacheca potrebbe raggrupparli.
  const CIH = require(join(ROOT, 'src', 'shared', 'feedbackClientIdHash.js'));
  assert.equal(card.clientIdTag, CIH.cardTagSync('fb-1', 'a'.repeat(32)));
  assert.notEqual(card.clientIdTag, 'a'.repeat(32));
  assert.notEqual(
    card.clientIdTag,
    V.cardFor({ ...PULITO, _id: 'fb-2' }).clientIdTag,
    'due schede della stessa installazione non devono portare la stessa impronta',
  );

  // Quello che NON deve uscire: è il cuore del feedback #583.
  for (const vietato of ['text', 'url', 'userAgent', 'images', 'files', 'notes',
    'clientId', 'clientIdHash', 'priority', 'pipeline', 'title', 'reviewComment']) {
    assert.ok(!(vietato in card), `"${vietato}" non deve finire nella scheda pubblica`);
  }
  // Nessun campo fuori dall'elenco, nemmeno uno aggiunto in futuro al doc.
  for (const k of Object.keys(card)) {
    assert.ok(V.CARD_FIELDS.includes(k), `campo "${k}" fuori dall'allowlist`);
  }
});

test('un feedback APERTO non ha scheda: la bacheca mostra solo i fix chiusi', () => {
  for (const status of ['todo', 'working', 'revision_capability', 'design', 'unlabeled']) {
    assert.equal(V.cardFor({ ...PULITO, status }), null, `status "${status}" non va pubblicato`);
  }
});

test('niente scheda per ciò che è passato dalle mani della sicurezza', () => {
  const casi = {
    'attacco confermato': { status: 'attack_confirmed' },
    'spam confermato': { status: 'spam_confirmed' },
    'bloccato dal pipeline': { pipeline: { action: 'block_attack', verdicts: [] } },
    'identità pericolosa': { pipeline: { l1Category: 'dangerous', verdicts: [] } },
    'un giudice grida attacco': { pipeline: { action: 'candidate_change', verdicts: [{ class: 'attack' }] } },
    'un giudice dice spam': { pipeline: { verdicts: [{ class: 'spam' }] } },
    'bocciato dall’audit': { statusReason: 'secaudit', status: 'design' },
    'blocco strutturato': { blockReason: 'loop' },
    'blocco confermato a mano': { reviewDecision: 'rejected' },
  };
  for (const [nome, patch] of Object.entries(casi)) {
    assert.equal(V.cardFor({ ...PULITO, ...patch }), null, `${nome}: non deve avere una scheda pubblica`);
  }
});

test('status illeggibile (cifrato) → niente scheda: in dubbio non si pubblica', () => {
  assert.equal(V.cardFor({ ...PULITO, status: 'FENC1:blob' }), null);
  assert.equal(V.cardFor({ ...PULITO, status: '[cifrato — chiave privata non configurata]' }), null);
  // Anche il pipeline rimasto cifrato: non sappiamo cosa dice.
  assert.equal(V.cardFor({ ...PULITO, pipeline: 'FENC1:blob' }), null);
});

test('un archiviato pulito ha scheda (il popup ricompense la usa), ma la bacheca non lo mostra', () => {
  const card = V.cardFor({ ...PULITO, status: 'archived' });
  assert.ok(card);
  assert.equal(card.status, 'archived');
  assert.equal(card.statusPublic, 'closed');
});

test('il piano di sincronizzazione: scrive i cambiati, non tocca gli uguali, toglie chi non deve esserci', () => {
  const card = V.cardFor(PULITO);
  const invariato = { _id: 'fb-1', ...card };
  const daAggiornare = { _id: 'fb-2', ...card, name: 'titolo vecchio' };
  const daTogliere = { _id: 'fb-3', ...card };

  const feedbacks = [
    PULITO,                                        // già pubblicato uguale
    { ...PULITO, _id: 'fb-2' },                    // titolo cambiato
    { ...PULITO, _id: 'fb-3', status: 'todo' },    // tornato in lavorazione
  ];
  const plan = V.planSync([invariato, daAggiornare, daTogliere], feedbacks);
  assert.deepEqual(plan.upsert.map((u) => u.id), ['fb-2'], 'si riscrive solo ciò che è cambiato');
  assert.deepEqual(plan.remove, ['fb-3'], 'un fix che esce dai chiusi perde la scheda');
});

test('un caricamento PARZIALE non svuota la bacheca; uno completo toglie gli orfani', () => {
  const card = V.cardFor(PULITO);
  const orfana = { _id: 'fb-vecchio', ...card };
  // Il feedback 'fb-vecchio' non è nella pagina caricata (è più vecchio del
  // tetto): la sua scheda NON va toccata.
  assert.deepEqual(V.planSync([orfana], [PULITO]).remove, []);
  // Se invece abbiamo guardato TUTTO, una scheda senza feedback è un orfano
  // (feedback cancellato) e si toglie.
  assert.deepEqual(V.planSync([orfana], [PULITO], { complete: true }).remove, ['fb-vecchio']);
});

test('i voti della scheda si riuniscono al feedback senza cancellare quelli storici', () => {
  const rows = [{ _id: 'fb-1', votes: { vecchio: { vote: 'works' } } }];
  const cards = [{ _id: 'fb-1', votes: { nuovo: { vote: 'broken' } }, reopenRequests: { tizio: { at: 'x' } } }];
  const [out] = V.mergeUserFields(rows, cards);
  assert.deepEqual(Object.keys(out.votes).sort(), ['nuovo', 'vecchio']);
  assert.deepEqual(Object.keys(out.reopenRequests), ['tizio']);
  // Senza schede, i feedback tornano com'erano.
  assert.deepEqual(V.mergeUserFields(rows, []), rows);
});

test('il publisher non scrive mai i campi che scrivono gli utenti', () => {
  for (const f of V.USER_FIELDS) {
    assert.ok(!V.CARD_FIELDS.includes(f),
      `"${f}" lo scrivono gli utenti: se il publisher lo elencasse, una ripubblicazione cancellerebbe i voti di tutti`);
  }
});

// ── Il travaso dei voti e delle riaperture (#583, giro 1 di verifica) ────────
//
// Prima di questa vista i voti della bacheca e il segnale «ancora rotto» si
// scrivevano sul feedback, e la bacheca li leggeva da lì. Adesso li legge dalla
// scheda: senza portarli dentro, il giorno in cui le regole vanno in produzione
// ogni conteggio riparte da zero e un fix già segnalato come rotto torna in
// bacheca riapribile una seconda volta, cioè il doppione che quel segnale
// doveva impedire.

const VOTATO = {
  ...PULITO,
  _id: 'fb-votato',
  votes: { 'uid-a': { vote: 'works', at: '2026-06-23T10:00:00Z', credibilitySnapshot: 1 } },
  reopenRequests: { 'uid-b': { at: '2026-06-24T10:00:00Z' } },
};

test('i voti rimasti sul documento entrano nella scheda al primo passaggio', () => {
  const plan = V.planSync([], [VOTATO], { complete: true });
  assert.equal(plan.upsert.length, 1);
  const { card } = plan.upsert[0];
  assert.deepEqual(Object.keys(card.votes), ['uid-a']);
  assert.deepEqual(Object.keys(card.reopenRequests), ['uid-b']);
});

test('il segnale «ancora rotto» arrivato nella scheda blocca una seconda riapertura', () => {
  const MR = globalThis.SN_MANAGE_REVIEW;
  const { card } = V.planSync([], [VOTATO], { complete: true }).upsert[0];
  const scheda = { _id: VOTATO._id, ...card };
  assert.equal(MR.canReopen(scheda, { releasedVersion: '0.2.71' }), false,
    'senza il travaso la scheda nasce senza segnale e il fix si potrebbe ripagare');
});

test('chi ha votato DOPO il passaggio non si vede cancellare il voto', () => {
  const scheda = {
    _id: VOTATO._id,
    ...V.cardFor(VOTATO),
    votes: { 'uid-c': { vote: 'broken', at: '2026-07-01T10:00:00Z', credibilitySnapshot: 1 } },
  };
  const plan = V.planSync([scheda], [VOTATO], { complete: true });
  assert.equal(plan.upsert.length, 1, 'c\'è ancora un voto storico da portare dentro');
  const { card } = plan.upsert[0];
  assert.deepEqual(Object.keys(card.votes).sort(), ['uid-a', 'uid-c']);
  assert.equal(card.votes['uid-c'].vote, 'broken', 'il voto nuovo vince su quello storico');
});

test('a travaso finito la scheda non si riscrive più a vuoto', () => {
  const primo = V.planSync([], [VOTATO], { complete: true }).upsert[0];
  const scheda = { _id: VOTATO._id, ...primo.card };
  const secondo = V.planSync([scheda], [VOTATO], { complete: true });
  assert.equal(secondo.upsert.length, 0);
});

test('un voto già sulla scheda e cancellato da chi l\'aveva dato non torna dal documento', () => {
  // Il documento porta ancora il voto storico, ma la scheda ha già la chiave:
  // «ritirato» è una decisione, e il travaso non la deve annullare.
  const scheda = { _id: VOTATO._id, ...V.cardFor(VOTATO), votes: { 'uid-a': null } };
  const plan = V.planSync([scheda], [VOTATO], { complete: true });
  const daPortare = plan.upsert.filter((u) => u.card.votes);
  assert.equal(daPortare.length, 0, 'la chiave c\'è già sulla scheda: niente da portare');
});
