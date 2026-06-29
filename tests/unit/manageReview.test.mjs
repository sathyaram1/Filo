// Unit test per la logica di classificazione e ordinamento della sezione
// "Revisione" della dashboard di gestione (src/shared/manageReview.js).
// Gira via `npm run test:unit` senza Electron né rete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'manageReview.js'));

const MR = globalThis.SN_MANAGE_REVIEW;

// ── classifyBlock ─────────────────────────────────────────────────────────

test('espone classifyBlock e sortReview', () => {
  assert.equal(typeof MR.classifyBlock, 'function');
  assert.equal(typeof MR.sortReview, 'function');
});

test('classifyBlock: nessuna pipeline → null', () => {
  assert.equal(MR.classifyBlock({}), null);
  assert.equal(MR.classifyBlock({ pipeline: null }), null);
  assert.equal(MR.classifyBlock({ pipeline: undefined }), null);
});

test('classifyBlock: aligned / nessun motivo → null', () => {
  assert.equal(MR.classifyBlock({ pipeline: { l2Class: 'aligned', action: 'candidate_change' } }), null);
  assert.equal(MR.classifyBlock({ pipeline: { stage: 'L1' } }), null);
});

test('classifyBlock: reason=attack via action block_attack', () => {
  const r = MR.classifyBlock({ pipeline: { action: 'block_attack' } });
  assert.equal(r.reason, 'attack');
  assert.equal(r.severity, 3);
});

test('classifyBlock: reason=attack via l1Category=dangerous', () => {
  const r = MR.classifyBlock({ pipeline: { l1Category: 'dangerous' } });
  assert.equal(r.reason, 'attack');
});

test('classifyBlock: reason=attack via l2Class=attack', () => {
  const r = MR.classifyBlock({ pipeline: { l2Class: 'attack' } });
  assert.equal(r.reason, 'attack');
});

test('classifyBlock: reason=spam via action block_spam', () => {
  const r = MR.classifyBlock({ pipeline: { action: 'block_spam' } });
  assert.equal(r.reason, 'spam');
  assert.equal(r.severity, 2);
});

test('classifyBlock: reason=spam via l1Category=spam', () => {
  const r = MR.classifyBlock({ pipeline: { l1Category: 'spam' } });
  assert.equal(r.reason, 'spam');
});

test('classifyBlock: reason=spam via l2Class=spam', () => {
  const r = MR.classifyBlock({ pipeline: { l2Class: 'spam' } });
  assert.equal(r.reason, 'spam');
});

test('classifyBlock: reason=design via l2Class=design', () => {
  const r = MR.classifyBlock({ pipeline: { l2Class: 'design' } });
  assert.equal(r.reason, 'design');
  assert.equal(r.severity, 1);
});

// ── Non filtrato (panel parziale): bianco, severità sopra attacco ────────────

test('classifyBlock: l2Unfiltered → reason=unfiltered, bianco', () => {
  const r = MR.classifyBlock({ pipeline: { l2Unfiltered: true, l2Class: 'aligned' } });
  assert.equal(r.reason, 'unfiltered');
  assert.equal(r.color, '#ffffff');
  assert.equal(r.severity, 4);
});

test('classifyBlock: unfiltered vince su un verdetto parziale di attacco', () => {
  // Un giudice presente dice attack ma il panel è parziale: prevale il bianco
  // (filtraggio non affidabile), i verdetti parziali restano nei pallini.
  const r = MR.classifyBlock({ pipeline: { l2Unfiltered: true, l2Class: 'attack' } });
  assert.equal(r.reason, 'unfiltered');
});

test('classifyBlock: unfiltered sotto reviewDecision=accepted → null (override owner)', () => {
  assert.equal(MR.classifyBlock({ reviewDecision: 'accepted', pipeline: { l2Unfiltered: true } }), null);
});

test('classifyBlock: attack vince su spam se entrambi presenti', () => {
  const r = MR.classifyBlock({ pipeline: { action: 'block_attack', l1Category: 'spam' } });
  assert.equal(r.reason, 'attack');
});

test('classifyBlock: spam vince su design', () => {
  const r = MR.classifyBlock({ pipeline: { l2Class: 'spam', action: 'block_spam' } });
  assert.equal(r.reason, 'spam');
  assert.notEqual(r.reason, 'design');
});

test('classifyBlock: reviewDecision=accepted → null anche con pipeline di blocco', () => {
  // L'override dell'owner vince su qualsiasi verdetto: il feedback esce dai bloccati.
  assert.equal(MR.classifyBlock({ reviewDecision: 'accepted', pipeline: { action: 'block_attack' } }), null);
  assert.equal(MR.classifyBlock({ reviewDecision: 'accepted', pipeline: { l2Class: 'spam' } }), null);
});

test('classifyBlock: reviewDecision diverso da accepted NON sblocca', () => {
  // Solo 'accepted' sblocca; altri valori lasciano il blocco attivo.
  const r = MR.classifyBlock({ reviewDecision: 'rejected', pipeline: { action: 'block_attack' } });
  assert.equal(r.reason, 'attack');
});

// ── loop (redesign routine): blocco duro dopo 3 verifiche fallite ───────────

test('classifyBlock: blocked + blockReason=loop → reason=loop, bordo nero, severità massima', () => {
  const r = MR.classifyBlock({ status: 'blocked', blockReason: 'loop' });
  assert.equal(r.reason, 'loop');
  assert.equal(r.color, '#111111');
  assert.equal(r.severity, 5); // sopra unfiltered(4)/attack(3)/spam(2)/design(1)
});

test('classifyBlock: loop vince sul pipeline di sicurezza', () => {
  // Un feedback bloccato per loop che ha anche un verdetto pipeline → resta loop.
  const r = MR.classifyBlock({ status: 'blocked', blockReason: 'loop', pipeline: { action: 'block_attack' } });
  assert.equal(r.reason, 'loop');
});

test('classifyBlock: blockReason=loop ma status non blocked → non è un blocco loop', () => {
  // Il loop richiede lo stato `blocked`; senza, ricade sulla logica pipeline (qui null).
  assert.equal(MR.classifyBlock({ status: 'todo', blockReason: 'loop' }), null);
});

test('classifyBlock: blocked senza blockReason loop → nessun bordo loop', () => {
  // Un `blocked` generico (es. branch sensibile) non è un loop: niente nero.
  assert.equal(MR.classifyBlock({ status: 'blocked' }), null);
});

test('classifyBlock: loop sotto reviewDecision=accepted → null (override owner vince)', () => {
  assert.equal(MR.classifyBlock({ status: 'blocked', blockReason: 'loop', reviewDecision: 'accepted' }), null);
});

// ── sortReview ─────────────────────────────────────────────────────────────

function fb(id, pipeline, createdAt) {
  return { _id: id, pipeline, createdAt };
}

test('sortReview: severità DESC (attack > spam > design)', () => {
  const input = [
    fb('d', { l2Class: 'design' },         '2026-01-01'),
    fb('a', { action: 'block_attack' },     '2026-01-02'),
    fb('s', { l1Category: 'spam' },         '2026-01-03'),
  ];
  const out = MR.sortReview(input);
  assert.equal(out[0]._id, 'a');
  assert.equal(out[1]._id, 's');
  assert.equal(out[2]._id, 'd');
});

test('sortReview: a parità di severità, più recenti prima', () => {
  const input = [
    fb('old',  { action: 'block_spam' }, '2026-01-01'),
    fb('new',  { action: 'block_spam' }, '2026-06-01'),
    fb('mid',  { action: 'block_spam' }, '2026-03-01'),
  ];
  const out = MR.sortReview(input);
  assert.equal(out[0]._id, 'new');
  assert.equal(out[1]._id, 'mid');
  assert.equal(out[2]._id, 'old');
});

test('sortReview: non muta l\'array originale', () => {
  const input = [
    fb('a', { action: 'block_attack' }, '2026-01-02'),
    fb('s', { action: 'block_spam' },   '2026-01-01'),
  ];
  const copy = input.slice();
  MR.sortReview(input);
  assert.deepEqual(input, copy);
});

test('sortReview: lista vuota → array vuoto', () => {
  assert.deepEqual(MR.sortReview([]), []);
});

// ── manageTabFor / listForManageTab (dashboard unificata DB1) ───────────────

test('espone manageTabFor e listForManageTab', () => {
  assert.equal(typeof MR.manageTabFor, 'function');
  assert.equal(typeof MR.listForManageTab, 'function');
});

test('manageTabFor: new e clarify → inbox (Ricevuti)', () => {
  assert.equal(MR.manageTabFor({ status: 'new' }), 'inbox');
  assert.equal(MR.manageTabFor({ status: 'clarify' }), 'inbox');
  // Status assente = nuovo per definizione.
  assert.equal(MR.manageTabFor({}), 'inbox');
});

test('manageTabFor: ritrovamenti agente/routine (clientId, status new) → inbox', () => {
  assert.equal(MR.manageTabFor({ status: 'new', clientId: 'routine:nice-wozniak' }), 'inbox');
  assert.equal(MR.manageTabFor({ status: 'new', clientId: 'agent:gemini-3.1-flash-lite' }), 'inbox');
});

test('manageTabFor: todo/review/blocked NON approvati → inbox (Ricevuti)', () => {
  // Nuova semantica: stare "In coda" richiede l'approvazione. Un feedback non
  // approvato (nessun candidate_change, nessun reviewDecision) resta nei Ricevuti.
  assert.equal(MR.manageTabFor({ status: 'todo' }), 'inbox');
  assert.equal(MR.manageTabFor({ status: 'review' }), 'inbox');
  assert.equal(MR.manageTabFor({ status: 'blocked' }), 'inbox');
});

test('manageTabFor: approvato (aligned+automatica o owner) → queue (In coda)', () => {
  // Auto-approvato: la pipeline ha emesso candidate_change (aligned + automatica ON).
  assert.equal(MR.manageTabFor({ status: 'todo', pipeline: { action: 'candidate_change' } }), 'queue');
  // Approvato a mano dall'owner.
  assert.equal(MR.manageTabFor({ status: 'todo', reviewDecision: 'accepted' }), 'queue');
  assert.equal(MR.manageTabFor({ status: 'blocked', reviewDecision: 'accepted' }), 'queue');
});

test('manageTabFor: blocchi e non-filtrati → inbox (richiedono approvazione)', () => {
  // Un blocco di sicurezza o un panel parziale NON è approvato → Ricevuti.
  assert.equal(MR.manageTabFor({ status: 'new', pipeline: { action: 'block_attack' } }), 'inbox');
  assert.equal(MR.manageTabFor({ status: 'todo', pipeline: { l2Class: 'spam' } }), 'inbox');
  assert.equal(MR.manageTabFor({ status: 'todo', pipeline: { l2Unfiltered: true } }), 'inbox');
});

test('manageTabFor: done/archived/ignored vincono sull\'approvazione', () => {
  // Già chiuso/archiviato: lo status vince a prescindere dall'approvazione.
  assert.equal(MR.manageTabFor({ status: 'done', pipeline: { action: 'candidate_change' } }), 'resolved');
  assert.equal(MR.manageTabFor({ status: 'archived', reviewDecision: 'accepted' }), 'archived');
  assert.equal(MR.manageTabFor({ status: 'ignored', pipeline: { action: 'candidate_change' } }), null);
});

// ── isApproved ──────────────────────────────────────────────────────────────

test('isApproved: vero solo con owner-accepted o candidate_change', () => {
  assert.equal(MR.isApproved({ reviewDecision: 'accepted' }), true);
  assert.equal(MR.isApproved({ pipeline: { action: 'candidate_change' } }), true);
  assert.equal(MR.isApproved({ status: 'todo' }), false);
  assert.equal(MR.isApproved({ pipeline: { action: 'human_review' } }), false);
  assert.equal(MR.isApproved({ pipeline: { l2Unfiltered: true } }), false);
  assert.equal(MR.isApproved(null), false);
});

test('manageTabFor: done e verified → resolved (Risolti); archived → archived; ignored → null', () => {
  assert.equal(MR.manageTabFor({ status: 'done' }), 'resolved');
  assert.equal(MR.manageTabFor({ status: 'verified' }), 'resolved');
  assert.equal(MR.manageTabFor({ status: 'archived' }), 'archived');
  assert.equal(MR.manageTabFor({ status: 'ignored' }), null);
});

test('listForManageTab: filtra per tab e ordina (queue per severità, altre per data)', () => {
  const items = [
    { _id: 'n1', status: 'new', createdAt: '2026-01-01' },
    { _id: 'n2', status: 'new', createdAt: '2026-06-01' },
    { _id: 't1', status: 'todo', createdAt: '2026-02-01' },
    { _id: 'b1', status: 'new', pipeline: { action: 'block_attack' }, createdAt: '2026-01-01' },
    { _id: 'd1', status: 'done', createdAt: '2026-03-01' },
    { _id: 'ig', status: 'ignored', createdAt: '2026-03-01' },
  ];
  // inbox: i due `new` puri, più recente prima; il blocco va in queue, non qui.
  assert.deepEqual(MR.listForManageTab(items, 'inbox').map((f) => f._id), ['n2', 'n1']);
  // queue: il blocco attacco (severità alta) prima del todo.
  assert.deepEqual(MR.listForManageTab(items, 'queue').map((f) => f._id), ['b1', 't1']);
  // resolved / archived.
  assert.deepEqual(MR.listForManageTab(items, 'resolved').map((f) => f._id), ['d1']);
  assert.deepEqual(MR.listForManageTab(items, 'archived').map((f) => f._id), []);
});

// ── Preferiti ⭐ e tab Archiviati (DB2) ─────────────────────────────────────

test('espone isStarred e listArchiveTab', () => {
  assert.equal(typeof MR.isStarred, 'function');
  assert.equal(typeof MR.listArchiveTab, 'function');
});

test('isStarred: solo starred===true conta', () => {
  assert.equal(MR.isStarred({ starred: true }), true);
  assert.equal(MR.isStarred({ starred: false }), false);
  assert.equal(MR.isStarred({}), false);
  assert.equal(MR.isStarred(null), false);
  // niente coercizioni strane: una stringa "true" non è una stella.
  assert.equal(MR.isStarred({ starred: 'true' }), false);
});

test('listArchiveTab: senza filtro mostra solo gli archived (recenti prima)', () => {
  const items = [
    { _id: 'a1', status: 'archived', createdAt: '2026-01-01' },
    { _id: 'a2', status: 'archived', createdAt: '2026-06-01' },
    { _id: 'd1', status: 'done', createdAt: '2026-03-01' },
    { _id: 's1', status: 'todo', starred: true, createdAt: '2026-05-01' },
  ];
  assert.deepEqual(MR.listArchiveTab(items).map((f) => f._id), ['a2', 'a1']);
  assert.deepEqual(MR.listArchiveTab(items, { starredOnly: false }).map((f) => f._id), ['a2', 'a1']);
});

test('listArchiveTab: filtro ⭐ mostra TUTTI i preferiti di qualunque status', () => {
  const items = [
    { _id: 'a1', status: 'archived', starred: true, createdAt: '2026-01-01' },
    { _id: 'a2', status: 'archived', createdAt: '2026-06-01' },          // archived ma non ⭐
    { _id: 's1', status: 'todo', starred: true, createdAt: '2026-05-01' }, // ⭐ ma non archived
    { _id: 'n1', status: 'new', starred: true, createdAt: '2026-02-01' },
  ];
  // Solo i ⭐, di qualunque status, più recenti prima.
  assert.deepEqual(
    MR.listArchiveTab(items, { starredOnly: true }).map((f) => f._id),
    ['s1', 'n1', 'a1']
  );
});

// ── Riapertura a pagamento dalla board (DC4) ────────────────────────────────

test('espone hasReopenRequest e canReopen', () => {
  assert.equal(typeof MR.hasReopenRequest, 'function');
  assert.equal(typeof MR.canReopen, 'function');
});

test('hasReopenRequest: true solo con almeno una entry nel map', () => {
  assert.equal(MR.hasReopenRequest({ reopenRequests: { uid1: { at: '2026-06-24' } } }), true);
  assert.equal(MR.hasReopenRequest({ reopenRequests: {} }), false);
  assert.equal(MR.hasReopenRequest({}), false);
  assert.equal(MR.hasReopenRequest(null), false);
});

test('canReopen: un fix "Risolti" spedito e senza riaperture pregresse → riapribile', () => {
  const fb = { status: 'done', resolvedInVersion: '0.2.70', createdAt: '2026-06-01' };
  assert.equal(MR.canReopen(fb, { releasedVersion: '0.2.74' }), true);
});

test('canReopen: già riaperto da qualcuno → NON riapribile di nuovo (anti-doppia-riapertura)', () => {
  const fb = {
    status: 'done', resolvedInVersion: '0.2.70', createdAt: '2026-06-01',
    reopenRequests: { someUid: { at: '2026-06-20' } },
  };
  assert.equal(MR.canReopen(fb, { releasedVersion: '0.2.74' }), false);
});

test('canReopen: non ancora in produzione (resolvedInVersion futura) → NON riapribile', () => {
  const fb = { status: 'done', resolvedInVersion: '0.2.90', createdAt: '2026-06-01' };
  assert.equal(MR.canReopen(fb, { releasedVersion: '0.2.74' }), false);
});

test('canReopen: status todo (non ancora risolto) → NON riapribile', () => {
  const fb = { status: 'todo', createdAt: '2026-06-01' };
  assert.equal(MR.canReopen(fb, { releasedVersion: '0.2.74' }), false);
});

test('canReopen: feedback con blocco di sicurezza nel pipeline → NON riapribile (mai visibilità board al red-team)', () => {
  const fb = {
    status: 'done', resolvedInVersion: '0.2.70', createdAt: '2026-06-01',
    pipeline: { action: 'block_attack' },
  };
  assert.equal(MR.canReopen(fb, { releasedVersion: '0.2.74' }), false);
});

test('canReopen: null/undefined → false, niente crash', () => {
  assert.equal(MR.canReopen(null, {}), false);
  assert.equal(MR.canReopen(undefined, {}), false);
});

test('listBoardTab: un fix con riapertura in sospeso ESCE da Risolti (criterio DC4)', () => {
  const shipped = { id: 'a', status: 'done', resolvedInVersion: '0.2.70', createdAt: '2026-06-01' };
  const reopened = {
    id: 'b', status: 'done', resolvedInVersion: '0.2.70', createdAt: '2026-06-02',
    reopenRequests: { someUid: { at: '2026-06-20' } },
  };
  const board = MR.listBoardTab([shipped, reopened], { releasedVersion: '0.2.74' });
  const ids = board.map((f) => f.id);
  assert.ok(ids.includes('a'), 'il fix non riaperto resta in board');
  assert.ok(!ids.includes('b'), 'il fix riaperto NON è più in board');
});
