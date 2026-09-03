// La macchina a stati promossa a DATI (SPEC-RIDISEGNO-MAX.md §7 e §13).
//
// PERCHÉ QUESTO TEST: le tabelle vivevano in due copie a mano (dashboard +
// server filo-security) e la cura era "ricordarsi di riallinearle". Ora la
// fonte è UNA (src/shared/feedbackTransitions.js): la dashboard la legge, il
// server la incorpora al deploy (functions/tools/bake-shared.js). Questo test
// inchioda (a) che i dati ci sono e hanno la forma attesa, (b) che
// feedbackStatus.js li CONSUMA davvero invece di tenersi una copia propria,
// (c) i default dei contatori del verificatore (N e M) che il server e la
// dashboard devono leggere dallo stesso posto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
// feedbackStatus.js si carica i dati da solo (require del fratello): basta lui.
require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackStatus.js'));

const DATA = globalThis.SN_FB_TRANSITIONS;
const S = globalThis.SN_FB_STATUS;

test('i dati esistono e hanno la forma attesa', () => {
  assert.ok(DATA, 'SN_FB_TRANSITIONS deve registrarsi su globalThis');
  assert.equal(DATA.STATUSES.length, 14, 'la lista canonica è chiusa (spec §2)');
  assert.ok(DATA.TRANSITIONS && typeof DATA.TRANSITIONS === 'object');
  assert.deepEqual(DATA.ACTORS, ['owner', 'pipeline', 'routine']);
  assert.equal(DATA.CIPHER_PAD, 32);
});

test('feedbackStatus consuma i DATI, non una copia propria', () => {
  // Stesso riferimento: se feedbackStatus tornasse a una tabella inline, questi
  // assert diventano rossi — ed è il punto: mai più due copie.
  assert.equal(S.TRANSITIONS, DATA.TRANSITIONS);
  assert.equal(S.PUBLIC_MAP, DATA.PUBLIC_MAP);
  assert.equal(S.CIPHER_PAD, DATA.CIPHER_PAD);
  assert.deepEqual(S.CANONICAL.slice().sort(), DATA.STATUSES.slice().sort(),
    'la presentazione della dashboard copre esattamente la lista canonica dei dati');
});

test("l'API sopra i dati funziona come prima (nessun cambiamento per i chiamanti)", () => {
  assert.equal(S.canTransition('todo', 'working', 'routine'), true);
  assert.equal(S.canTransition('todo', 'done', 'routine'), false, 'il salto diretto resta illegale');
  assert.equal(S.canReach('todo', 'done', 'routine'), true, 'ma la catena dell\'iter resta legale');
  assert.equal(S.canTransition('unlabeled', 'todo', 'owner'), false, 'da unlabeled esce solo la pipeline');
  assert.equal(S.padForCipher('todo').length, DATA.CIPHER_PAD);
});

test('riallineamento: dopo un conflitto di fusione la routine può riportare il lavoro in revisione', () => {
  // Caso #500 (27/08/2026): verifica e sicurezza passate, ma main è avanzato e
  // il merge non passa più. Il ramo va ribasato e ricontrollato — e senza
  // questa transizione il giro di riallineamento moriva alla consegna.
  assert.equal(S.canTransition('revision_security', 'revision_capability', 'routine'), true);
  assert.equal(S.canTransition('revision_security', 'revision_capability', 'owner'), false,
    'il rientro è un passo dell\'iter: appartiene alle routine, non alla dashboard');
});

test('VERIFIER_CAPS: i default di N (improvableCap) e M (failCap) — SPEC §13', () => {
  // N = 0 (dal 2026-09-03): un «migliorabile» passa subito e i rilievi diventano
  // un feedback residuo a priorità minima; prima era 3.
  // M = 10: scelta di misura dell'owner per la prima settimana sul piano Max
  // (osservazione del processo), poi si abbassa dalla DASHBOARD, non da qui.
  assert.deepEqual(DATA.VERIFIER_CAPS, { improvableCap: 0, failCap: 10 });
});

test('PUBLIC_MAP: i confermati restano "open" (#476 — mai premiare un attacco)', () => {
  assert.equal(DATA.PUBLIC_MAP.attack_confirmed, 'open');
  assert.equal(DATA.PUBLIC_MAP.spam_confirmed, 'open');
  assert.equal(DATA.PUBLIC_MAP.done, 'closed');
  // Ogni stato canonico ha la sua voce: un buco nella mappa diventerebbe un
  // valore di ripiego deciso altrove.
  for (const st of DATA.STATUSES) {
    assert.ok(DATA.PUBLIC_MAP[st] === 'open' || DATA.PUBLIC_MAP[st] === 'closed',
      `manca statusPublic per "${st}"`);
  }
});
