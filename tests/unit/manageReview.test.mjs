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
require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackStatus.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'manageReview.js'));

const MR = globalThis.SN_MANAGE_REVIEW;

// ── classifyBlock ─────────────────────────────────────────────────────────

test('espone classifyBlock e sortReview', () => {
  assert.equal(typeof MR.classifyBlock, 'function');
  assert.equal(typeof MR.sortReview, 'function');
});

test('classifyBlock: nessuna pipeline → bianco se aperto (mai giudicato), null se chiuso', () => {
  // Un feedback aperto senza pipeline non è ancora stato giudicato → non filtrato.
  assert.equal(MR.classifyBlock({ status: 'new' }).reason, 'unfiltered');
  assert.equal(MR.classifyBlock({}).reason, 'unfiltered');          // status assente = new
  assert.equal(MR.classifyBlock({ pipeline: null }).reason, 'unfiltered');
  assert.equal(MR.classifyBlock({ pipeline: undefined }).reason, 'unfiltered');
  // I chiusi non vanno giudicati → nessun colore (e restano nella board/Risolti).
  assert.equal(MR.classifyBlock({ status: 'done' }), null);
  assert.equal(MR.classifyBlock({ status: 'verified' }), null);
  assert.equal(MR.classifyBlock({ status: 'archived' }), null);
  assert.equal(MR.classifyBlock({ status: 'ignored' }), null);
});

test('classifyBlock: mittente fidato (routine/owner) bloccato a L1 → unfiltered, non attacco', () => {
  // Identità dell'owner flaggata per errore: va RI-GIUDICATA, non mostrata come attacco.
  const r = MR.classifyBlock({ clientId: 'routine:routine', pipeline: { action: 'human_review', l1Category: 'dangerous', verdicts: [] } });
  assert.equal(r.reason, 'unfiltered');
  // Un mittente ESTERNO con lo stesso pipeline resta un attacco (rosso).
  const ext = MR.classifyBlock({ clientId: 'caf22093', pipeline: { action: 'human_review', l1Category: 'dangerous', verdicts: [] } });
  assert.equal(ext.reason, 'attack');
});

test('classifyBlock: mittente fidato CON verdetti completi → classificato normalmente', () => {
  const verdicts = ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'].map((j) => ({ judge: j, class: 'design' }));
  const r = MR.classifyBlock({ clientId: 'routine:routine', pipeline: { l2Class: 'design', verdicts } });
  assert.equal(r.reason, 'design');
});

test('classifyBlock: aligned/auto-approvato → null; pipeline in corso → unlabeled', () => {
  assert.equal(MR.classifyBlock({ pipeline: { l2Class: 'aligned', action: 'candidate_change' } }), null);
  // Macchina a stati: panel non completo = `unlabeled` (bianco), anche se la
  // pipeline è solo "in corso" — prima tornava null.
  assert.equal((MR.classifyBlock({ pipeline: { stage: 'L1' } }) || {}).reason, 'unfiltered');
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

test('classifyBlock: l2Degraded (pipeline vecchia, zero verdetti) → unfiltered/bianco', () => {
  // Lo storico giudicato prima del campo l2Unfiltered: panel a zero verdetti.
  const r = MR.classifyBlock({ pipeline: { l2Degraded: true, action: 'human_review', verdicts: [] } });
  assert.equal(r.reason, 'unfiltered');
  assert.equal(r.color, '#ffffff');
});

test('classifyBlock: storico con DUE verdetti su quattro attesi → unfiltered (dedotto dal conteggio)', () => {
  // Pipeline vecchia senza l2Unfiltered/expectedJudges: 2 verdetti < 4 attesi.
  const r = MR.classifyBlock({ pipeline: {
    action: 'human_review', l2Class: 'aligned', l1Category: 'clean',
    verdicts: [{ judge: 'fixed_1', class: 'aligned' }, { judge: 'fixed_2', class: 'aligned' }],
  } });
  assert.equal(r.reason, 'unfiltered');
});

test('classifyBlock: panel COMPLETO (4 verdetti) design → design, non unfiltered', () => {
  const verdicts = ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'].map((j) => ({ judge: j, class: 'design' }));
  const r = MR.classifyBlock({ pipeline: { l2Class: 'design', verdicts } });
  assert.equal(r.reason, 'design');
});

test('classifyBlock: expectedJudges accorcia il panel atteso (2 attesi, 2 verdetti → completo)', () => {
  const r = MR.classifyBlock({ pipeline: {
    l2Class: 'design', expectedJudges: ['fixed_1', 'fixed_2'],
    verdicts: [{ judge: 'fixed_1', class: 'design' }, { judge: 'fixed_2', class: 'design' }],
  } });
  assert.equal(r.reason, 'design'); // 2 di 2 = completo, non unfiltered
});

test('classifyBlock: block_attack a panel parziale resta attacco (decisione L1/completa, non bianco)', () => {
  // action block_attack ⇒ decisione vera: tiene il rosso anche con pochi verdetti.
  const r = MR.classifyBlock({ pipeline: {
    action: 'block_attack', l2Class: 'attack', verdicts: [{ judge: 'fixed_1', class: 'attack' }],
  } });
  assert.equal(r.reason, 'attack');
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

// ── Sicurezza-conservativa: categoria PIÙ ALTA, non maggioritaria ───────────

test('classifyBlock: un solo giudice attacco tra tanti allineati → attacco (non maggioranza)', () => {
  // 3 allineati + 1 attacco: l'aggregato del backend dice "aligned", ma la
  // dashboard deve segnalarlo ROSSO (categoria di sicurezza più alta).
  const verdicts = [
    { judge: 'fixed_1', class: 'aligned' },
    { judge: 'fixed_2', class: 'aligned' },
    { judge: 'fixed_3', class: 'aligned' },
    { judge: 'dynamic', class: 'attack' },
  ];
  const r = MR.classifyBlock({ status: 'aligned', pipeline: { l2Class: 'aligned', verdicts } });
  assert.equal(r.reason, 'attack');
  assert.equal(r.color, '#c0392b');
  assert.equal(r.severity, 3);
});

test('classifyBlock: aggregato design ma un giudice attacco → escala ad attacco', () => {
  const verdicts = [
    { judge: 'fixed_1', class: 'design' },
    { judge: 'fixed_2', class: 'design' },
    { judge: 'fixed_3', class: 'design' },
    { judge: 'dynamic', class: 'attack' },
  ];
  const r = MR.classifyBlock({ pipeline: { l2Class: 'design', verdicts } });
  assert.equal(r.reason, 'attack');
});

test('classifyBlock: aggregato design ma un giudice spam → escala a spam (non oltre)', () => {
  const verdicts = [
    { judge: 'fixed_1', class: 'design' },
    { judge: 'fixed_2', class: 'design' },
    { judge: 'fixed_3', class: 'spam' },
    { judge: 'dynamic', class: 'design' },
  ];
  const r = MR.classifyBlock({ pipeline: { l2Class: 'design', verdicts } });
  assert.equal(r.reason, 'spam');
});

test('classifyBlock: nessun dissenso di rischio → resta la categoria dell aggregato', () => {
  const verdicts = ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'].map((j) => ({ judge: j, class: 'design' }));
  const r = MR.classifyBlock({ pipeline: { l2Class: 'design', verdicts } });
  assert.equal(r.reason, 'design'); // nessun voto più severo
});

test('classifyBlock: non-filtrato (bianco) resta bianco anche con un voto attacco', () => {
  // unfiltered (sev 4) > attack (sev 3): il filtraggio inaffidabile ha priorità,
  // l escalation non lo declassa.
  const verdicts = [{ judge: 'fixed_1', class: 'attack' }];
  const r = MR.classifyBlock({ pipeline: { l2Unfiltered: true, l2Class: 'aligned', verdicts } });
  assert.equal(r.reason, 'unfiltered');
});

test('classifyBlock: dissenso di rischio NON ri-segnala un feedback già accettato (todo)', () => {
  // L owner ha accettato → todo (In coda). I verdetti dei giudici non lo
  // riportano tra i Ricevuti: la decisione umana ha superato il panel.
  const verdicts = [{ judge: 'dynamic', class: 'attack' }];
  assert.equal(MR.classifyBlock({ status: 'todo', pipeline: { verdicts } }), null);
  assert.equal(MR.classifyBlock({ reviewDecision: 'accepted', pipeline: { action: 'block_attack', verdicts } }), null);
});

test('isAligned: allineato con un voto di attacco → NON allineato (fuori dal bulk-approve)', () => {
  const verdicts = [
    { judge: 'fixed_1', class: 'aligned' },
    { judge: 'fixed_2', class: 'aligned' },
    { judge: 'fixed_3', class: 'aligned' },
    { judge: 'dynamic', class: 'attack' },
  ];
  assert.equal(MR.isAligned({ status: 'aligned', pipeline: { l2Class: 'aligned', verdicts } }), false);
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

test('classifyBlock: blocked + blockReason=loop → design con reason=loop (macchina a stati)', () => {
  // Il loop è uno dei tre sotto-casi di `design` (spec §5): verde, la storia
  // sta nella chat. Il nero è ora riservato a `suspicious_file`.
  const r = MR.classifyBlock({ status: 'blocked', blockReason: 'loop' });
  assert.equal(r.reason, 'loop');
  assert.equal(r.color, '#2e9e5b');
  assert.equal(r.label, 'Design');
});

test('classifyBlock: loop vince sul pipeline di sicurezza', () => {
  // Un feedback bloccato per loop che ha anche un verdetto pipeline → resta loop.
  const r = MR.classifyBlock({ status: 'blocked', blockReason: 'loop', pipeline: { action: 'block_attack' } });
  assert.equal(r.reason, 'loop');
});

test('classifyBlock: blockReason=loop ma status non blocked → non è un blocco loop', () => {
  // Il loop richiede lo stato `blocked`; senza, ricade sulla logica normale: qui
  // niente pipeline + aperto ⇒ non filtrato (bianco), comunque NON 'loop'.
  assert.notEqual((MR.classifyBlock({ status: 'todo', blockReason: 'loop' }) || {}).reason, 'loop');
});

test('classifyBlock: blocked senza blockReason loop → nessun bordo loop', () => {
  // Un `blocked` generico (es. branch sensibile) non è un loop: niente nero.
  assert.notEqual((MR.classifyBlock({ status: 'blocked' }) || {}).reason, 'loop');
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

test('manageTabFor: lo status È la verità — todo/review in coda, blocked si scioglie', () => {
  // Macchina a stati: `todo` significa "approvato, in coda" per definizione
  // (chi approva SCRIVE todo). `review` legacy = fix in attesa di verifica →
  // revision_capability (In coda). `blocked` legacy senza pipeline né loop →
  // unlabeled (Ricevuti, bianco).
  assert.equal(MR.manageTabFor({ status: 'todo' }), 'queue');
  assert.equal(MR.manageTabFor({ status: 'review' }), 'queue');
  assert.equal(MR.manageTabFor({ status: 'blocked' }), 'inbox');
});

test('manageTabFor: approvato (aligned+automatica o owner) → queue (In coda)', () => {
  // Auto-approvato: la pipeline ha emesso candidate_change (aligned + automatica ON).
  assert.equal(MR.manageTabFor({ status: 'todo', pipeline: { action: 'candidate_change' } }), 'queue');
  // Approvato a mano dall'owner.
  assert.equal(MR.manageTabFor({ status: 'todo', reviewDecision: 'accepted' }), 'queue');
  assert.equal(MR.manageTabFor({ status: 'blocked', reviewDecision: 'accepted' }), 'queue');
});

test('manageTabFor: blocchi e non-filtrati legacy → inbox (richiedono decisione)', () => {
  // Un legacy `new` si scioglie dai verdetti: blocco di sicurezza o panel
  // parziale → Ricevuti. Con status canonico (es. todo) i verdetti NON contano
  // più: la fonte di verità è lo status.
  assert.equal(MR.manageTabFor({ status: 'new', pipeline: { action: 'block_attack' } }), 'inbox');
  assert.equal(MR.manageTabFor({ status: 'new', pipeline: { l2Class: 'spam' } }), 'inbox');
  assert.equal(MR.manageTabFor({ status: 'new', pipeline: { l2Unfiltered: true } }), 'inbox');
  assert.equal(MR.manageTabFor({ status: 'todo', pipeline: { l2Class: 'spam' } }), 'queue');
});

test('manageTabFor: done/archived/ignored vincono sull\'approvazione', () => {
  // Già chiuso/archiviato: lo status vince a prescindere dall'approvazione.
  assert.equal(MR.manageTabFor({ status: 'done', pipeline: { action: 'candidate_change' } }), 'resolved');
  assert.equal(MR.manageTabFor({ status: 'archived', reviewDecision: 'accepted' }), 'archived');
  // `ignored` è ritirato: diventa un archiviato (resta ispezionabile come log).
  assert.equal(MR.manageTabFor({ status: 'ignored', pipeline: { action: 'candidate_change' } }), 'archived');
});

// ── isApproved ──────────────────────────────────────────────────────────────

test('isApproved: vero se lo status (normalizzato) è nell\'iter di lavorazione', () => {
  assert.equal(MR.isApproved({ reviewDecision: 'accepted' }), true);              // legacy accepted → todo
  assert.equal(MR.isApproved({ pipeline: { action: 'candidate_change' } }), true); // auto-approvato → todo
  assert.equal(MR.isApproved({ status: 'todo' }), true);                          // todo È approvato per definizione
  assert.equal(MR.isApproved({ status: 'working' }), true);
  assert.equal(MR.isApproved({ pipeline: { action: 'human_review' } }), false);
  assert.equal(MR.isApproved({ pipeline: { l2Unfiltered: true } }), false);
  assert.equal(MR.isApproved({ status: 'aligned' }), false);                      // aspetta l'owner
  assert.equal(MR.isApproved(null), false);
});

// ── isAligned: panel completo, tutti i giudici d'accordo (bordo BLU) ─────────

test('espone isAligned e ALIGNED_COLOR (blu)', () => {
  assert.equal(typeof MR.isAligned, 'function');
  assert.equal(typeof MR.ALIGNED_COLOR, 'string');
  assert.match(MR.ALIGNED_COLOR, /^#/);
});

test('isAligned: allineato IN ATTESA di approvazione → true; auto-approvato → false', () => {
  assert.equal(MR.isAligned({ pipeline: { l2Class: 'aligned' } }), true);
  const verdicts = ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'].map((j) => ({ judge: j, class: 'aligned' }));
  assert.equal(MR.isAligned({ pipeline: { verdicts } }), true);
  assert.equal(MR.isAligned({ status: 'aligned' }), true); // status canonico
  // candidate_change = auto-approvato al giudizio → è già `todo`, non "aligned
  // in attesa": il badge blu spetta solo a chi aspetta l'owner.
  assert.equal(MR.isAligned({ pipeline: { action: 'candidate_change' } }), false);
  assert.equal(MR.isApproved({ pipeline: { action: 'candidate_change' } }), true);
});

test('isAligned: blocchi/non-filtrati/in-corso → false', () => {
  assert.equal(MR.isAligned({ pipeline: { action: 'block_attack' } }), false);
  assert.equal(MR.isAligned({ pipeline: { l2Class: 'spam' } }), false);
  assert.equal(MR.isAligned({ pipeline: { l2Unfiltered: true, l2Class: 'aligned' } }), false); // panel parziale
  assert.equal(MR.isAligned({ pipeline: { stage: 'L1' } }), false); // nessun verdetto ancora
  assert.equal(MR.isAligned({ status: 'new' }), false);             // nessuna pipeline
  assert.equal(MR.isAligned(null), false);
});

// ── La modalità automatica NON è più letta dai consumer (macchina a stati) ──
// Agisce UNA volta, al momento del giudizio (pipeline scrive todo o aligned).
// Attivarla dopo non ri-tocca i vecchi allineati: l'owner li approva (bulk
// aligned→todo). Era il bug strutturale: dashboard e routine usavano due
// criteri diversi per "questo è lavorabile?".

test('isApproved/manageTabFor: la modalità automatica di OGGI viene IGNORATA', () => {
  // Vecchio allineato giudicato con automatica OFF (nessun candidate_change).
  const old = { status: 'new', pipeline: { l2Class: 'aligned', action: 'human_review' } };
  assert.equal(MR.isApproved(old), false);
  assert.equal(MR.isApproved(old, { autoMode: true }), false);       // ignorata
  assert.equal(MR.manageTabFor(old), 'inbox');
  assert.equal(MR.manageTabFor(old, { autoMode: true }), 'inbox');   // ignorata
  // Un blocco non è mai approvato.
  assert.equal(MR.isApproved({ pipeline: { action: 'block_attack' } }, { autoMode: true }), false);
});

test('listForManageTab: gli allineati restano nei Ricevuti finché l\'owner non scrive todo', () => {
  const items = [
    { _id: 'al', status: 'new', pipeline: { l2Class: 'aligned' }, createdAt: '2026-01-01' },
    { _id: 'bl', status: 'new', pipeline: { action: 'block_attack' }, createdAt: '2026-01-02' },
  ];
  assert.deepEqual(MR.listForManageTab(items, 'queue').map((f) => f._id), []);
  assert.deepEqual(MR.listForManageTab(items, 'inbox').map((f) => f._id), ['bl', 'al']);
  // Anche con automatica ON (parametro ormai ignorato): identico.
  assert.deepEqual(MR.listForManageTab(items, 'queue', { autoMode: true }).map((f) => f._id), []);
  // L'approvazione = SCRIVERE lo status (bulk aligned→todo): allora è in coda.
  const approved = { ...items[0], status: 'todo' };
  assert.deepEqual(MR.listForManageTab([approved], 'queue').map((f) => f._id), ['al']);
});

test('manageTabFor: done → resolved; verified/ignored (ritirati) → archived', () => {
  assert.equal(MR.manageTabFor({ status: 'done' }), 'resolved');
  // `verified` era "verificato dall'owner" = l'archived della macchina a stati.
  assert.equal(MR.manageTabFor({ status: 'verified' }), 'archived');
  assert.equal(MR.manageTabFor({ status: 'archived' }), 'archived');
  assert.equal(MR.manageTabFor({ status: 'ignored' }), 'archived');
});

test('listForManageTab: filtra per tab e ordina (Ricevuti per severità, In coda per status)', () => {
  const items = [
    { _id: 'n1', status: 'new', createdAt: '2026-01-01' },
    { _id: 'n2', status: 'new', createdAt: '2026-06-01' },
    { _id: 't1', status: 'todo', createdAt: '2026-02-01' },                                   // todo = in coda
    { _id: 'b1', status: 'new', pipeline: { action: 'block_attack' }, createdAt: '2026-01-01' }, // blocco → inbox
    { _id: 'u1', status: 'new', pipeline: { l2Unfiltered: true }, createdAt: '2026-05-01' },    // non filtrato → inbox
    { _id: 'q1', status: 'todo', pipeline: { action: 'candidate_change' }, createdAt: '2026-04-01' }, // in coda
    { _id: 'd1', status: 'done', createdAt: '2026-03-01' },
    { _id: 'ig', status: 'ignored', createdAt: '2026-03-01' },
  ];
  // inbox: i new senza verdetti sono "non filtrati" (sev4) come u1; b1 è sev3.
  // sev4 per data: n2(06) > u1(05) > n1(01); poi b1 (sev3).
  assert.deepEqual(MR.listForManageTab(items, 'inbox').map((f) => f._id), ['n2', 'u1', 'n1', 'b1']);
  // queue: tutti i todo (a parità di priorità/severità: più recenti prima).
  assert.deepEqual(MR.listForManageTab(items, 'queue').map((f) => f._id), ['q1', 't1']);
  // resolved / archived (ignored ritirato → archiviato).
  assert.deepEqual(MR.listForManageTab(items, 'resolved').map((f) => f._id), ['d1']);
  assert.deepEqual(MR.listForManageTab(items, 'archived').map((f) => f._id), ['ig']);
});

// ── Priorità (visibile + modificabile dalla dashboard) ─────────────────────

test('priorityOf: normalizza a 1-3, fuori range/non numerico → 0', () => {
  assert.equal(MR.priorityOf({ priority: 1 }), 1);
  assert.equal(MR.priorityOf({ priority: 3 }), 3);
  assert.equal(MR.priorityOf({ priority: '2' }), 2);   // stringhe numeriche ok
  assert.equal(MR.priorityOf({ priority: 0 }), 0);
  assert.equal(MR.priorityOf({ priority: 5 }), 0);     // sopra il massimo → nessuna
  assert.equal(MR.priorityOf({ priority: -1 }), 0);
  assert.equal(MR.priorityOf({ priority: 'FENC1:abc' }), 0); // cifrato non decifrato → 0 (no crash)
  assert.equal(MR.priorityOf({}), 0);
  assert.equal(MR.priorityOf(null), 0);
});

test('listForManageTab queue: priorità DESC come criterio primario', () => {
  // Tutti approvati → in coda. La priorità detta l'ordine: 3 > 1 > (0).
  const items = [
    { _id: 'lo', status: 'todo', reviewDecision: 'accepted', priority: 0, createdAt: '2026-06-01' },
    { _id: 'hi', status: 'todo', reviewDecision: 'accepted', priority: 3, createdAt: '2026-01-01' },
    { _id: 'mid', status: 'todo', reviewDecision: 'accepted', priority: 1, createdAt: '2026-03-01' },
  ];
  assert.deepEqual(MR.listForManageTab(items, 'queue').map((f) => f._id), ['hi', 'mid', 'lo']);
});

test('listForManageTab queue: a parità di priorità resta l\'ordine per recenza', () => {
  // Stessa priorità → il sort stabile conserva sortReview (severità poi recenza).
  const items = [
    { _id: 'old', status: 'todo', reviewDecision: 'accepted', priority: 2, createdAt: '2026-01-01' },
    { _id: 'new', status: 'todo', reviewDecision: 'accepted', priority: 2, createdAt: '2026-06-01' },
  ];
  assert.deepEqual(MR.listForManageTab(items, 'queue').map((f) => f._id), ['new', 'old']);
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

// ── Quanti feedback ci sono in ogni scheda-lista (#495) ────────────────────

test('listArchiveTab: filtro "Bloccati confermati" tiene solo attacchi/spam confermati', () => {
  const items = [
    { _id: 'a1', status: 'archived', createdAt: '2026-01-01' },
    { _id: 'x1', status: 'attack_confirmed', createdAt: '2026-02-01' },
    { _id: 'x2', status: 'spam_confirmed', createdAt: '2026-03-01' },
  ];
  assert.deepEqual(
    MR.listArchiveTab(items, { confirmedOnly: true }).map((f) => f._id),
    ['x2', 'x1']
  );
  // Senza il filtro ci sono tutti e tre (i confermati vivono negli Archiviati).
  assert.equal(MR.listArchiveTab(items).length, 3);
});

test('manageTabCounts: conta le quattro schede-lista, e solo quelle', () => {
  const items = [
    { _id: 'i1', status: 'unlabeled', createdAt: '2026-01-01' },
    { _id: 'i2', status: 'attack', createdAt: '2026-01-02' },
    { _id: 'i3', status: 'design', createdAt: '2026-01-03' },
    { _id: 'q1', status: 'todo', createdAt: '2026-02-01' },
    { _id: 'q2', status: 'working', createdAt: '2026-02-02' },
    { _id: 'r1', status: 'done', createdAt: '2026-03-01' },
    { _id: 'z1', status: 'archived', createdAt: '2026-04-01' },
  ];
  assert.deepEqual(MR.manageTabCounts(items), {
    inbox: 3, queue: 2, resolved: 1, archived: 1,
  });
  // Nessuna chiave in più: le schede senza lista (statistiche, modelli,
  // automazioni, log) non hanno un numero da mostrare.
  assert.deepEqual(Object.keys(MR.manageTabCounts(items)).sort(),
    ['archived', 'inbox', 'queue', 'resolved']);
});

test('manageTabCounts: liste vuote → quattro zeri (una scheda vuota lo dice)', () => {
  assert.deepEqual(MR.manageTabCounts([]), { inbox: 0, queue: 0, resolved: 0, archived: 0 });
  assert.deepEqual(MR.manageTabCounts(null), { inbox: 0, queue: 0, resolved: 0, archived: 0 });
});

test('manageTabCounts: ogni numero è la LUNGHEZZA della lista che la scheda mostra', () => {
  const items = [
    { _id: 'i1', status: 'unlabeled', createdAt: '2026-01-01' },
    { _id: 'q1', status: 'todo', createdAt: '2026-02-01' },
    { _id: 'q2', status: 'done', createdAt: '2026-02-02', resolvedInVersion: '9.9.9' },
    { _id: 'r1', status: 'done', createdAt: '2026-03-01', resolvedInVersion: '1.0.0' },
    { _id: 'z1', status: 'archived', createdAt: '2026-04-01', starred: true },
    { _id: 'z2', status: 'archived', createdAt: '2026-04-02' },
  ];
  const opts = { releasedVersion: '1.2.0' };
  const counts = MR.manageTabCounts(items, opts);
  for (const tab of ['inbox', 'queue', 'resolved']) {
    assert.equal(counts[tab], MR.listForManageTab(items, tab, opts).length, tab);
  }
  assert.equal(counts.archived, MR.listArchiveTab(items, opts).length);
  // DB3: il fix non ancora spedito (9.9.9 > 1.2.0) resta contato in "In coda".
  assert.equal(counts.queue, 2);
  assert.equal(counts.resolved, 1);
});

test('manageTabCounts: gli Archiviati seguono i filtri della colonna (⭐, confermati)', () => {
  const items = [
    { _id: 'z1', status: 'archived', createdAt: '2026-04-01' },
    { _id: 'z2', status: 'archived', createdAt: '2026-04-02' },
    { _id: 'x1', status: 'attack_confirmed', createdAt: '2026-04-03' },
    { _id: 's1', status: 'todo', starred: true, createdAt: '2026-05-01' },
  ];
  // Filtro spento: i tre che stanno negli Archiviati.
  assert.equal(MR.manageTabCounts(items).archived, 3);
  // ⭐ acceso: la lista diventa "tutti i preferiti", il numero la segue.
  assert.equal(MR.manageTabCounts(items, { starredOnly: true }).archived, 1);
  // Solo i bloccati confermati.
  assert.equal(MR.manageTabCounts(items, { confirmedOnly: true }).archived, 1);
  // I due filtri insieme: preferiti E confermati → nessuno.
  assert.equal(MR.manageTabCounts(items, { starredOnly: true, confirmedOnly: true }).archived, 0);
});

test('manageTabCounts: spostare un feedback sposta due numeri (approvazione)', () => {
  const items = [{ _id: 'a', status: 'unlabeled', createdAt: '2026-01-01' }];
  assert.deepEqual(MR.manageTabCounts(items), { inbox: 1, queue: 0, resolved: 0, archived: 0 });
  items[0].status = 'todo';   // l'owner approva: Ricevuti → In coda
  assert.deepEqual(MR.manageTabCounts(items), { inbox: 0, queue: 1, resolved: 0, archived: 0 });
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

// ── classifyReevalResult: esito onesto della ri-valutazione dei "non filtrati" ─
// Traduce la risposta del backend (per UN feedback, un id per chiamata) nell'esito
// che la dashboard mostra all'owner, distinguendo il PROGRESSO reale dai crediti
// spesi a vuoto. È la difesa contro "Valutati N" con i pallini ancora bianchi.

test('classifyReevalResult: recupero reale (recovered>0) → outcome recovered', () => {
  const r = { ok: true, remaining: 0, results: [{ ok: true, changed: true, recovered: 1, attempted: 1 }] };
  const out = MR.classifyReevalResult(r);
  assert.equal(out.outcome, 'recovered');
  assert.equal(out.recovered, 1);
});

test('classifyReevalResult: giudici ri-eseguiti ma nessun recupero → outcome wasted (crediti a vuoto)', () => {
  const r = { ok: true, remaining: 0, results: [{ ok: true, changed: false, recovered: 0, attempted: 1, stillUnfiltered: true }] };
  const out = MR.classifyReevalResult(r);
  assert.equal(out.outcome, 'wasted');
  assert.equal(out.recovered, 0);
});

test('classifyReevalResult: propaga errorKind (es. credito esaurito) per il messaggio all\'owner', () => {
  const r = { ok: true, remaining: 0, results: [{ ok: true, changed: false, attempted: 1, stillUnfiltered: true, errorKind: 'credit' }] };
  const out = MR.classifyReevalResult(r);
  assert.equal(out.outcome, 'wasted');
  assert.equal(out.errorKind, 'credit');
});

test('reevalErrorHint: ogni causa azionabile ha una frase; sconosciuto/other → null', () => {
  assert.match(MR.reevalErrorHint('credit'), /credito/i);
  assert.match(MR.reevalErrorHint('auth'), /chiave/i);
  assert.match(MR.reevalErrorHint('rate_limit'), /sovraccarico|riprova/i);
  assert.match(MR.reevalErrorHint('bad_request'), /modell/i);
  assert.match(MR.reevalErrorHint('timeout'), /[Tt]imeout/);
  assert.equal(MR.reevalErrorHint('other'), null);
  assert.equal(MR.reevalErrorHint(null), null);
});

test('classifyReevalResult: niente da fare (already_complete / not_unfiltered) → outcome noop', () => {
  const r = { ok: true, remaining: 0, results: [{ ok: true, changed: false, reason: 'already_complete' }] };
  assert.equal(MR.classifyReevalResult(r).outcome, 'noop');
});

test('classifyReevalResult: run completa (fullRun, mai giudicato) → outcome recovered', () => {
  const r = { ok: true, remaining: 0, results: [{ ok: true, changed: true, fullRun: true }] };
  assert.equal(MR.classifyReevalResult(r).outcome, 'recovered');
});

test('classifyReevalResult: budget/tempo lato server (remaining>0) → outcome budget', () => {
  const r = { ok: true, remaining: 1, results: [] };
  assert.equal(MR.classifyReevalResult(r).outcome, 'budget');
});

test('classifyReevalResult: errore di canale o di singolo id → outcome error', () => {
  assert.equal(MR.classifyReevalResult({ ok: false }).outcome, 'error');
  assert.equal(MR.classifyReevalResult(null).outcome, 'error');
  assert.equal(MR.classifyReevalResult({ ok: true, results: [{ ok: false, error: 'x' }] }).outcome, 'error');
});

test('REEVAL_WASTE_LIMIT: soglia bassa e positiva (basta poco per capire che i giudici non rispondono)', () => {
  assert.equal(typeof MR.REEVAL_WASTE_LIMIT, 'number');
  assert.ok(MR.REEVAL_WASTE_LIMIT >= 1 && MR.REEVAL_WASTE_LIMIT <= 5);
});

// ── workProgress: avanzamento dell'iter di lavorazione (card pinnata) ───────

test('workProgress: null fuori dall\'iter (todo/done/inbox)', () => {
  assert.equal(MR.workProgress({ status: 'todo' }), null);
  assert.equal(MR.workProgress({ status: 'done' }), null);
  assert.equal(MR.workProgress({ status: 'attack' }), null);
  assert.equal(MR.workProgress(null), null);
});

test('workProgress: working → implementazione in corso, resto da fare', () => {
  const now = Date.parse('2026-07-09T12:00:00Z');
  const p = MR.workProgress({ status: 'working', workingSince: '2026-07-09T11:50:00Z' }, { now });
  assert.equal(p.status, 'working');
  assert.deepEqual(p.steps.map((s) => s.state), ['current', 'pending', 'pending']);
  assert.equal(p.current.key, 'impl');
  // workingSince fresco (10 min < TTL 60) → un'istanza è al lavoro anche senza claim.
  assert.equal(p.active, true);
});

test('workProgress: working con workingSince scaduto e senza claim → NON attivo', () => {
  const now = Date.parse('2026-07-09T12:00:00Z');
  const p = MR.workProgress({ status: 'working', workingSince: '2026-07-09T09:00:00Z' }, { now });
  assert.equal(p.active, false);
});

test('workProgress: revision_capability → impl fatta, controllo funzionalità in corso', () => {
  const now = Date.parse('2026-07-09T12:00:00Z');
  const p = MR.workProgress({ status: 'revision_capability' }, { now });
  assert.deepEqual(p.steps.map((s) => s.state), ['done', 'current', 'pending']);
  assert.equal(p.current.key, 'verify');
  assert.equal(p.active, false); // nessun battito → in attesa di un verificatore
});

test('workProgress: revision_security che batte → sicurezza in corso, istanza attiva', () => {
  const now = Date.parse('2026-07-09T12:00:00Z');
  const p = MR.workProgress({
    status: 'revision_security',
    claimedBy: 'vm-123',
    beatAt: '2026-07-09T11:57:00Z',
  }, { now });
  assert.deepEqual(p.steps.map((s) => s.state), ['done', 'done', 'current']);
  assert.equal(p.current.key, 'security');
  assert.equal(p.active, true);
  assert.equal(p.by, 'vm-123');
});

test('workProgress: claim SCADUTO non conta come istanza attiva', () => {
  const now = Date.parse('2026-07-09T12:00:00Z');
  const p = MR.workProgress({
    status: 'revision_capability',
    claimExpiresAt: '2026-07-09T11:00:00Z',
  }, { now });
  assert.equal(p.active, false);
});

test('workProgress: status legacy review → normalizzato a revision_capability', () => {
  const p = MR.workProgress({ status: 'review' });
  assert.equal(p.status, 'revision_capability');
});

test('listForManageTab queue: gli in-lavorazione sono PINNATI in cima, attivi prima', () => {
  const now = Date.parse('2026-07-09T12:00:00Z');
  const items = [
    { _id: 'a', status: 'todo', priority: 3, createdAt: '2026-07-01T00:00:00Z' },
    { _id: 'b', status: 'revision_capability', createdAt: '2026-06-01T00:00:00Z' },
    { _id: 'c', status: 'working', workingSince: '2026-07-09T11:55:00Z', createdAt: '2026-05-01T00:00:00Z' },
    { _id: 'd', status: 'todo', priority: 1, createdAt: '2026-07-02T00:00:00Z' },
  ];
  const list = MR.listForManageTab(items, 'queue', { now });
  const ids = list.map((f) => f._id);
  // c è ATTIVO (workingSince fresco) → primo; b è in iter ma in attesa → secondo;
  // poi i todo per priorità (a=3 prima di d=1).
  assert.deepEqual(ids, ['c', 'b', 'a', 'd']);
});
