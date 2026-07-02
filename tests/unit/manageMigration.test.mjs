// Unit test della MIGRAZIONE alla dashboard unificata `manage` (DB5).
//
// La vecchia dashboard `feedback` aveva superfici separate (Ricevuti, Agente,
// Chiarimenti, Bozze, In coda, Risolti…). La nuova `manage` carica TUTTI i
// feedback (FB.list pageSize 500) e li instrada nelle 4 tab-lista con la sola
// logica pura `manageTabFor`/`listForManageTab` (DB1) + il filtro Archiviati
// (DB2). Questo test inietta feedback di OGNI stato e verifica:
//   1) ognuno finisce nella tab corretta (la migrazione non sposta nulla nel
//      posto sbagliato);
//   2) NESSUNA PERDITA DATI: ogni feedback che era visibile nella vecchia
//      dashboard compare in esattamente una tab-lista di `manage` (gli unici
//      "invisibili" sono gli `ignored`, nascosti anche prima — non è perdita).
// Logica pura: gira via `npm run test:unit` senza Electron né rete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackStatus.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'manageReview.js'));

const MR = globalThis.SN_MANAGE_REVIEW;

const LIST_TABS = ['inbox', 'queue', 'resolved', 'archived'];

// Un campione che rappresenta TUTTE le superfici della vecchia dashboard,
// con i clientId tipici (tester reale, ritrovamento routine, agente LLM).
function corpus() {
  return [
    // ── Ricevuti: nuovi dei tester + ritrovamenti agente/routine + chiarimenti ──
    { _id: 'new-user',    status: 'new',    clientId: 'caf22093', createdAt: '2026-06-20' },
    { _id: 'new-routine', status: 'new',    clientId: 'routine:nice-wozniak', createdAt: '2026-06-19' },
    { _id: 'new-agent',   status: 'new',    clientId: 'agent:gemini-3.1-flash-lite', createdAt: '2026-06-18' },
    { _id: 'clarify-1',   status: 'clarify', clientId: 'owner:caf', createdAt: '2026-06-17' },
    // ── Bozze rimosse (DB2): un `draft` resta sotto Ricevuti nel suo stato ──
    { _id: 'draft-1',     status: 'draft',  clientId: 'routine:routine', createdAt: '2026-06-16' },
    // ── In coda: solo i feedback APPROVATI (auto o a mano) in lavorazione ──
    { _id: 'todo-1',      status: 'todo',   reviewDecision: 'accepted', createdAt: '2026-06-15' },
    { _id: 'review-1',    status: 'review', branch: 'worker/x', pipeline: { action: 'candidate_change' }, createdAt: '2026-06-14' },
    // ── Ricevuti: un blocco worker e un blocco di sicurezza richiedono la mia
    //    approvazione → restano nei Ricevuti finché non li sblocco. ──
    { _id: 'blocked-1',   status: 'blocked', branch: 'worker/y', createdAt: '2026-06-13' },
    { _id: 'pipe-block',  status: 'new', pipeline: { action: 'block_attack' }, createdAt: '2026-06-12' },
    // ── Risolti: solo i fix davvero spediti (DB3). Senza releasedVersion il gate
    //    è OFF → done/verified vanno in Risolti (comportamento storico). ──
    { _id: 'done-1',      status: 'done',     createdAt: '2026-06-11' },
    { _id: 'verified-1',  status: 'verified', createdAt: '2026-06-10' },
    // ── Archiviati ──
    { _id: 'archived-1',  status: 'archived', createdAt: '2026-06-09' },
    // ── Nascosto sia prima sia ora (NON è perdita dati) ──
    { _id: 'ignored-1',   status: 'ignored',  createdAt: '2026-06-08' },
  ];
}

test('migrazione: ogni stato finisce nella tab attesa', () => {
  const expected = {
    'new-user': 'inbox',
    'new-routine': 'inbox',
    'new-agent': 'inbox',
    'clarify-1': 'inbox',
    'draft-1': 'inbox',       // Bozze rimosse → draft resta sotto Ricevuti
    'todo-1': 'queue',        // approvato a mano dall'owner
    'review-1': 'queue',      // legacy review → revision_capability (In coda)
    'blocked-1': 'inbox',     // blocco worker: richiede la mia approvazione
    'pipe-block': 'inbox',    // blocco di sicurezza: richiede la mia approvazione
    'done-1': 'resolved',
    'verified-1': 'archived', // macchina a stati: verificato dall'owner = archiviato
    'archived-1': 'archived',
    'ignored-1': 'archived',  // ritirato: resta ispezionabile come log in Archiviati
  };
  for (const fb of corpus()) {
    assert.equal(MR.manageTabFor(fb), expected[fb._id], `${fb._id} (${fb.status})`);
  }
});

test('migrazione: NESSUNA PERDITA — ogni feedback visibile compare in esattamente una tab', () => {
  const all = corpus();
  // Unione di tutte le tab-lista (filtro ⭐ OFF).
  const seen = new Map();
  for (const tab of LIST_TABS) {
    for (const fb of MR.listForManageTab(all, tab)) {
      const prev = seen.get(fb._id);
      assert.equal(prev, undefined, `${fb._id} compare in due tab: ${prev} e ${tab}`);
      seen.set(fb._id, tab);
    }
  }
  // Tutti i NON-ignored devono comparire da qualche parte; gli ignored no.
  for (const fb of all) {
    if (fb.status === 'ignored') {
      assert.equal(seen.has(fb._id), false, `${fb._id} ignored non deve comparire`);
    } else {
      assert.equal(seen.has(fb._id), true, `${fb._id} PERSO: non in nessuna tab`);
    }
  }
  // Conteggio: 14 nel corpus, 1 ignored ⇒ 13 visibili instradati.
  assert.equal(seen.size, all.length - 1);
});

test('migrazione: gli archived compaiono SOLO in Archiviati (no doppione in coda)', () => {
  const all = corpus();
  assert.deepEqual(MR.listForManageTab(all, 'archived').map((f) => f._id), ['archived-1']);
  for (const tab of ['inbox', 'queue', 'resolved']) {
    assert.equal(
      MR.listForManageTab(all, tab).some((f) => f._id === 'archived-1'),
      false,
      `archived-1 non deve comparire in ${tab}`,
    );
  }
});

test('migrazione: il filtro ⭐ Archiviati raccoglie i preferiti di qualunque stato', () => {
  const all = corpus().concat([
    { _id: 'star-todo', status: 'todo', starred: true, createdAt: '2026-06-07' },
    { _id: 'star-done', status: 'done', starred: true, createdAt: '2026-06-06' },
  ]);
  // OFF: solo gli archived.
  assert.deepEqual(MR.listArchiveTab(all, { starredOnly: false }).map((f) => f._id), ['archived-1']);
  // ON: tutti i ⭐, di qualunque stato (recenti prima).
  assert.deepEqual(
    MR.listArchiveTab(all, { starredOnly: true }).map((f) => f._id),
    ['star-todo', 'star-done'],
  );
});

test('migrazione: con releasedVersion (DB3) un done non ancora rilasciato resta In coda', () => {
  const all = [
    { _id: 'shipped', status: 'done', resolvedInVersion: '0.2.70', createdAt: '2026-06-05' },
    { _id: 'pending', status: 'done', resolvedInVersion: '0.2.99', createdAt: '2026-06-04' },
  ];
  const opts = { releasedVersion: '0.2.75' };
  assert.deepEqual(MR.listForManageTab(all, 'resolved', opts).map((f) => f._id), ['shipped']);
  assert.deepEqual(MR.listForManageTab(all, 'queue', opts).map((f) => f._id), ['pending']);
});
