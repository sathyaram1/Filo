// Unit test per la macchina a stati dei feedback (src/shared/feedbackStatus.js,
// spec: FEEDBACK-STATES.md). Gira via `npm run test:unit` senza Electron né rete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackStatus.js'));

const FS = globalThis.SN_FB_STATUS;

// ── Vocabolario ────────────────────────────────────────────────────────────

test('la lista canonica è quella della spec (chiusa, 14 stati)', () => {
  assert.deepEqual(FS.CANONICAL.sort(), [
    'aligned', 'archived', 'attack', 'attack_confirmed', 'design', 'done',
    'revision_capability', 'revision_security', 'spam', 'spam_confirmed',
    'suspicious_file', 'todo', 'unlabeled', 'working',
  ].sort());
  assert.ok(FS.isCanonical('todo'));
  assert.ok(!FS.isCanonical('new'));      // legacy: NON canonico
  assert.ok(!FS.isCanonical('blocked'));  // legacy: NON canonico
  assert.ok(!FS.isCanonical(''));
});

test('ogni stato canonico ha una tab valida e ogni legacy è dichiarato', () => {
  for (const s of FS.CANONICAL) {
    assert.ok(['inbox', 'queue', 'resolved', 'archived'].includes(FS.STATUSES[s].tab), s);
  }
  for (const s of ['new', 'blocked', 'clarify', 'review', 'verified', 'ignored']) {
    assert.ok(FS.isLegacy(s), `${s} deve essere legacy`);
  }
});

// ── tabFor: lookup pura (spec §4) ──────────────────────────────────────────

test('tabFor instrada come la spec §4', () => {
  for (const s of ['unlabeled', 'suspicious_file', 'attack', 'spam', 'design', 'aligned']) {
    assert.equal(FS.tabFor(s), 'inbox', s);
  }
  for (const s of ['todo', 'working', 'revision_capability', 'revision_security']) {
    assert.equal(FS.tabFor(s), 'queue', s);
  }
  assert.equal(FS.tabFor('archived'), 'archived');
  // I confermati NON stanno in Ricevuti: vanno in Archiviati (filtro dedicato).
  assert.equal(FS.tabFor('attack_confirmed'), 'archived');
  assert.equal(FS.tabFor('spam_confirmed'), 'archived');
});

test('done: In coda finché non rilasciato, Risolti dopo (gate DB3)', () => {
  assert.equal(FS.tabFor('done'), 'queue');
  assert.equal(FS.tabFor('done', { shipped: false }), 'queue');
  assert.equal(FS.tabFor('done', { shipped: true }), 'resolved');
});

test('tabFor su legacy/sconosciuto → null (serve normalizzare prima)', () => {
  assert.equal(FS.tabFor('new'), null);
  assert.equal(FS.tabFor('blocked'), null);
  assert.equal(FS.tabFor('boh'), null);
});

// ── Transizioni (spec §3): legali, attori, illegali ────────────────────────

test('solo la pipeline fa uscire da unlabeled', () => {
  for (const to of ['attack', 'spam', 'design', 'todo', 'aligned', 'suspicious_file']) {
    assert.ok(FS.canTransition('unlabeled', to, 'pipeline'), to);
    assert.ok(!FS.canTransition('unlabeled', to, 'owner'), `owner non può → ${to}`);
    assert.ok(!FS.canTransition('unlabeled', to, 'routine'), `routine non può → ${to}`);
  }
});

test('solo l\'owner fa uscire dagli stati di revisione umana', () => {
  assert.ok(FS.canTransition('suspicious_file', 'todo', 'owner'));
  assert.ok(FS.canTransition('suspicious_file', 'attack_confirmed', 'owner'));
  assert.ok(FS.canTransition('attack', 'attack_confirmed', 'owner'));
  assert.ok(FS.canTransition('attack', 'todo', 'owner'));           // falso positivo
  assert.ok(FS.canTransition('spam', 'spam_confirmed', 'owner'));
  assert.ok(FS.canTransition('design', 'todo', 'owner'));
  assert.ok(FS.canTransition('aligned', 'todo', 'owner'));          // approvazione (bulk)
  assert.ok(FS.canTransition('done', 'archived', 'owner'));         // verifica umana
  assert.ok(FS.canTransition('done', 'todo', 'owner'));             // riapertura
  assert.ok(FS.canTransition('archived', 'todo', 'owner'));         // ripristino
  assert.ok(FS.canTransition('attack_confirmed', 'todo', 'owner')); // "era legittimo"
  // La routine NON tocca gli stati owner-only:
  assert.ok(!FS.canTransition('aligned', 'todo', 'routine'));
  assert.ok(!FS.canTransition('done', 'archived', 'routine'));
  assert.ok(!FS.canTransition('attack', 'todo', 'routine'));
});

test('l\'iter di lavorazione è delle routine', () => {
  assert.ok(FS.canTransition('todo', 'working', 'routine'));
  assert.ok(FS.canTransition('working', 'revision_capability', 'routine'));
  assert.ok(FS.canTransition('revision_capability', 'revision_security', 'routine'));
  assert.ok(FS.canTransition('revision_security', 'done', 'routine'));
  // FAIL → design (loop / domande):
  assert.ok(FS.canTransition('revision_capability', 'design', 'routine'));
  assert.ok(FS.canTransition('revision_security', 'design', 'routine'));
  assert.ok(FS.canTransition('todo', 'design', 'routine'));
  assert.ok(FS.canTransition('working', 'design', 'routine'));
  // Riconciliazione TTL:
  assert.ok(FS.canTransition('working', 'todo', 'routine'));
  // L'owner non muove l'iter macchina:
  assert.ok(!FS.canTransition('todo', 'working', 'owner'));
  assert.ok(!FS.canTransition('revision_security', 'done', 'owner'));
});

test('lavori senza branch: la routine può chiudere direttamente (estensione §3)', () => {
  // Es. il pianificatore che spezza una spec in sub-feedback: nessun branch da
  // verificare, chiude il padre con done.
  assert.ok(FS.canTransition('todo', 'done', 'routine'));
  assert.ok(FS.canTransition('working', 'done', 'routine'));
  assert.ok(!FS.canTransition('todo', 'done', 'owner'));
});

test('transizioni NON elencate = illegali (nessun default permissivo)', () => {
  assert.ok(!FS.canTransition('attack', 'spam', 'owner'));
  assert.ok(!FS.canTransition('archived', 'done', 'owner'));
  assert.ok(!FS.canTransition('done', 'todo', 'pipeline'));
  assert.ok(!FS.canTransition('boh', 'todo', 'owner'));         // stato sconosciuto
  assert.ok(!FS.canTransition('todo', 'working', 'admin'));     // attore sconosciuto
  assert.ok(!FS.canTransition('todo', 'working', ''));
});

test('canReach: accetta le CATENE di passi dello stesso attore (coda collassata)', () => {
  // La coda tiene un file per feedback: todo→working→revision_capability può
  // arrivare all'apply come un solo salto. Vale la catena.
  assert.ok(FS.canReach('todo', 'revision_capability', 'routine'));
  assert.ok(FS.canReach('todo', 'revision_security', 'routine'));
  assert.ok(FS.canReach('todo', 'done', 'routine'));
  assert.ok(FS.canReach('working', 'done', 'routine'));
  // Ma NON mischia attori né inventa salti: la routine non arriva ad archived,
  // né agli stati owner-only; l'owner non attraversa l'iter delle routine.
  assert.ok(!FS.canReach('todo', 'archived', 'routine'));
  assert.ok(!FS.canReach('aligned', 'todo', 'routine'));
  assert.ok(!FS.canReach('todo', 'revision_capability', 'owner'));
  assert.ok(!FS.canReach('attack', 'done', 'owner'));
  // L'owner però raggiunge todo→…→? no: da todo l'owner non ha uscite.
  assert.deepEqual(FS.transitionsFrom('todo', 'owner'), []);
});

test('transitionsFrom elenca le destinazioni per attore', () => {
  assert.deepEqual(FS.transitionsFrom('aligned', 'owner'), ['todo']);
  assert.deepEqual(FS.transitionsFrom('aligned', 'routine'), []);
  assert.ok(FS.transitionsFrom('working', 'routine').includes('revision_capability'));
});

// ── Legacy (spec §8) ───────────────────────────────────────────────────────

test('mappatura legacy semplice: clarify/review/verified/ignored', () => {
  assert.equal(FS.LEGACY_SIMPLE.clarify.status, 'design');
  assert.equal(FS.LEGACY_SIMPLE.clarify.statusReason, 'clarify');
  assert.equal(FS.LEGACY_SIMPLE.review.status, 'revision_capability');
  assert.equal(FS.LEGACY_SIMPLE.verified.status, 'archived');
  assert.equal(FS.LEGACY_SIMPLE.ignored.status, 'archived');
  // new/blocked dipendono dal doc intero: NON in LEGACY_SIMPLE, ma dichiarati legacy.
  assert.equal(FS.LEGACY_SIMPLE.new, undefined);
  assert.equal(FS.LEGACY_SIMPLE.blocked, undefined);
  assert.ok(FS.isLegacy('new') && FS.isLegacy('blocked'));
});

// ── Lock working (spec §6) ─────────────────────────────────────────────────

test('isWorkingExpired: TTL 60 minuti, workingSince mancante = morto', () => {
  const now = Date.parse('2026-07-02T12:00:00Z');
  const fresh = { status: 'working', workingSince: '2026-07-02T11:30:00Z' };
  const dead  = { status: 'working', workingSince: '2026-07-02T10:30:00Z' };
  assert.equal(FS.isWorkingExpired(fresh, now), false);
  assert.equal(FS.isWorkingExpired(dead, now), true);
  assert.equal(FS.isWorkingExpired({ status: 'working' }, now), true); // senza timestamp
  assert.equal(FS.isWorkingExpired({ status: 'todo', workingSince: '2020-01-01' }, now), false);
  assert.equal(FS.WORKING_TTL_MS, 60 * 60 * 1000);
});

// ── statusPublic (S1.F2.1) ─────────────────────────────────────────────────

test('PUBLIC_MAP copre TUTTI i canonici e i beccati collassano sui normali', () => {
  for (const s of FS.CANONICAL) {
    assert.ok(['open', 'closed'].includes(FS.PUBLIC_MAP[s]), s);
  }
  // Cuore di sicurezza: un attacco intercettato è indistinguibile da un
  // feedback in lavorazione.
  assert.equal(FS.PUBLIC_MAP.attack, 'open');
  assert.equal(FS.PUBLIC_MAP.suspicious_file, 'open');
});

test('#476 — un beccato CONFERMATO resta "in lavorazione" per chi l\'ha mandato', () => {
  // Prima stavano su 'closed', come i risolti. Sembrava innocuo (nessun valore
  // dedicato ai bloccati) ma 'closed' è il grilletto della ricompensa e della
  // bacheca pubblica: l'attaccante riceveva 50 crediti, la notifica "risolto" e
  // il suo feedback in vetrina. Cioè la conferma del colpo, pagata da noi.
  assert.equal(FS.PUBLIC_MAP.attack_confirmed, 'open');
  assert.equal(FS.PUBLIC_MAP.spam_confirmed, 'open');
  // E la proprietà che conta davvero, indipendente dai nomi: da fuori un
  // confermato dev'essere identico a un feedback ancora in lavorazione, e
  // diverso da un risolto.
  assert.equal(FS.PUBLIC_MAP.attack_confirmed, FS.PUBLIC_MAP.working);
  assert.notEqual(FS.PUBLIC_MAP.attack_confirmed, FS.PUBLIC_MAP.done);
  assert.notEqual(FS.PUBLIC_MAP.spam_confirmed, FS.PUBLIC_MAP.done);
});

test('#476 — nessuna ricompensa e nessun annuncio per un attacco confermato', () => {
  // È la conseguenza che l'utente VEDE, e va asserita sul comportamento, non
  // sulla tabella: se un giorno la mappa torna indietro, questo diventa rosso.
  const comeLoVedeChiLoHaMandato = (fine) => ({ statusPublic: FS.PUBLIC_MAP[fine] });
  assert.equal(FS.isResolvedForUser(comeLoVedeChiLoHaMandato('attack_confirmed')), false);
  assert.equal(FS.isResolvedForUser(comeLoVedeChiLoHaMandato('spam_confirmed')), false);
  assert.equal(FS.isResolvedForUser(comeLoVedeChiLoHaMandato('attack')), false);
  // …e il lavoro vero continua a essere premiato: la protezione non deve
  // spegnere la funzione, o il test passerebbe anche rompendo le ricompense.
  assert.equal(FS.isResolvedForUser(comeLoVedeChiLoHaMandato('done')), true);
  assert.equal(FS.isResolvedForUser(comeLoVedeChiLoHaMandato('archived')), true);
});

test('#476 — retrocompat: feedback storici senza enum grossolano', () => {
  assert.equal(FS.isResolvedForUser({ status: 'done' }), true);
  assert.equal(FS.isResolvedForUser({ status: 'attack_confirmed' }), false);
  // Status cifrato e nessun enum: non si sa → non si premia.
  assert.equal(FS.isResolvedForUser({ status: 'FENC1:abcdef' }), false);
  assert.equal(FS.isResolvedForUser({}), false);
  assert.equal(FS.isResolvedForUser(null), false);
});
