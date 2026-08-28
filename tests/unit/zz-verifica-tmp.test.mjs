// VERIFICA INDIPENDENTE (file temporaneo, da cancellare a fine verifica).
// Riallineamento: revision_security -> revision_capability, solo 'routine'.
// La matrice attesa qui sotto è TRASCRITTA A MANO dalla spec FEEDBACK-STATES.md §3
// (incluse le eccezioni in prosa: mittenti fidati, gate file, arenato, clarify),
// NON copiata dal codice: se il codice diverge dalla spec, questi test diventano rossi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackStatus.js'));

const S = globalThis.SN_FB_STATUS;

const STATUSES = [
  'unlabeled', 'suspicious_file', 'attack', 'spam', 'design', 'aligned',
  'todo', 'working', 'revision_capability', 'revision_security', 'done',
  'archived', 'attack_confirmed', 'spam_confirmed',
];
const ACTORS = ['owner', 'pipeline', 'routine'];

// Matrice ATTESA, derivata dalla spec §3 (from -> to -> [attori]).
// Qualsiasi coppia (from,to) non presente qui è ILLEGALE per OGNI attore.
const EXPECTED = {
  unlabeled: { // "ingresso → gate file: flag → suspicious_file; pulito → unlabeled" + panel
    suspicious_file: ['pipeline'],
    attack: ['pipeline'], spam: ['pipeline'], design: ['pipeline'],
    todo: ['pipeline'], aligned: ['pipeline'],
  },
  suspicious_file: {
    todo: ['owner'], attack_confirmed: ['owner'],
    spam_confirmed: ['owner'], archived: ['owner'],
  },
  attack: { // + eccezione mittenti fidati: flag identità su fidato → unlabeled (pipeline)
    attack_confirmed: ['owner'], todo: ['owner'], unlabeled: ['pipeline'],
  },
  spam: {
    spam_confirmed: ['owner'], todo: ['owner'], unlabeled: ['pipeline'],
  },
  design: { todo: ['owner'], archived: ['owner'] },
  aligned: { todo: ['owner'] },
  todo: { // NB: todo→done (routine) RITIRATO (aggiornamento 2026-08-19 in spec)
    working: ['routine'], design: ['routine'],
  },
  working: { // arenato → todo; arenato 3ª / domande → design; NB working→done RITIRATO
    revision_capability: ['routine'], design: ['routine'], todo: ['routine'],
  },
  revision_capability: {
    revision_security: ['routine'], design: ['routine'],
  },
  revision_security: {
    done: ['routine'], design: ['routine'],
    // IL PASSAGGIO IN VERIFICA: conflitto di fusione → riallineamento.
    revision_capability: ['routine'],
  },
  done: { archived: ['owner'], todo: ['owner'] },
  archived: { todo: ['owner'] },
  attack_confirmed: { todo: ['owner'] },
  spam_confirmed: { todo: ['owner'] },
};

test('il passaggio di riallineamento esiste per la routine', () => {
  assert.equal(S.canTransition('revision_security', 'revision_capability', 'routine'), true);
});

test('il passaggio di riallineamento è NEGATO a owner e pipeline', () => {
  assert.equal(S.canTransition('revision_security', 'revision_capability', 'owner'), false);
  assert.equal(S.canTransition('revision_security', 'revision_capability', 'pipeline'), false);
});

test('attori sconosciuti o vuoti restano fuori anche dal passaggio nuovo', () => {
  for (const a of ['', null, undefined, 'admin', 'ROUTINE', 'routine ', 'server']) {
    assert.equal(S.canTransition('revision_security', 'revision_capability', a), false,
      `attore ${JSON.stringify(a)} non deve passare`);
  }
});

test('matrice COMPLETA stati×stati×attori identica alla spec §3 (nessun allargamento)', () => {
  const diffs = [];
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const expActors = (EXPECTED[from] && EXPECTED[from][to]) || [];
      for (const actor of ACTORS) {
        const exp = expActors.includes(actor);
        const got = S.canTransition(from, to, actor);
        if (got !== exp) diffs.push(`${from} -> ${to} [${actor}]: atteso ${exp}, codice ${got}`);
      }
      // self-loop mai legale
      if (from === to) {
        for (const actor of ACTORS) {
          if (S.canTransition(from, to, actor)) diffs.push(`self-loop ${from} [${actor}] legale!`);
        }
      }
    }
  }
  assert.deepEqual(diffs, [], `divergenze codice vs spec §3:\n${diffs.join('\n')}`);
});

test('la lista degli stati del codice è esattamente quella della spec §2', () => {
  assert.deepEqual(S.STATUSES.slice().sort(), STATUSES.slice().sort());
  assert.deepEqual(S.ACTORS.slice().sort(), ACTORS.slice().sort());
});

test('la spec FEEDBACK-STATES.md documenta il passaggio nuovo in §3', () => {
  const spec = readFileSync(join(__dirname, '..', '..', 'FEEDBACK-STATES.md'), 'utf8');
  const s3 = spec.split('## 3.')[1].split('## 4.')[0];
  // la riga di revision_security deve citare il conflitto di fusione con
  // rientro in revision_capability
  assert.match(s3, /conflitto di fusione/i, 'manca la menzione del conflitto di fusione in §3');
  assert.match(s3.replace(/\s+/g, ' '),
    /revision_security[^.]*conflitto di fusione[^.]*revision_capability/i,
    'il conflitto di fusione non è documentato come transizione revision_security → revision_capability');
});

test('canReach: il riallineamento non apre catene nuove a owner/pipeline', () => {
  // l'owner non può raggiungere revision_capability da revision_security nemmeno in catena
  assert.equal(S.canReach('revision_security', 'revision_capability', 'owner'), false);
  assert.equal(S.canReach('revision_security', 'revision_capability', 'pipeline'), false);
  // e la pipeline non entra mai nell'iter di lavorazione
  assert.equal(S.canReach('todo', 'done', 'pipeline'), false);
  // la routine invece chiude il giro di riallineamento: rientro + ripassa l'iter
  assert.equal(S.canReach('revision_security', 'done', 'routine'), true);
});
