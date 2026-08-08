// Unit test del marcatore di ruolo (#443): chi sta lavorando adesso.
//
// PERCHÉ CONTA
//   La provenienza di un feedback aperto da un'automazione non può dipendere dal
//   fatto che il worker si ricordi di dichiararsi: prima di questo, su decine di
//   ritrovamenti uno solo risultava "esplorazione", l'unica volta in cui
//   qualcuno aveva passato la bandierina a mano. Qui si verifica che il ruolo
//   scritto dal dispatcher venga ritrovato da chi accoda — anche da una cartella
//   di lavoro separata — e che un marcatore vecchio non firmi feedback altrui.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const {
  normalizeRole, isFresh, writeRole, readRole, clearRole, roleFile, MAX_AGE_MS,
} = await import('../../scripts/lib/routine-role.mjs');

function tmpRoot() {
  return mkdtempSync(join(tmpdir(), 'filo-role-'));
}

test('normalizeRole: accetta solo i ruoli del dispatcher', () => {
  assert.equal(normalizeRole('prober'), 'prober');
  assert.equal(normalizeRole('NEW-WORK'), 'new-work');
  assert.equal(normalizeRole(' verifier '), 'verifier');
  assert.equal(normalizeRole('secaudit'), 'secaudit');
  assert.equal(normalizeRole('fixer'), 'fixer');
  // Il valore finisce nell'identità pubblica del feedback: niente testo libero.
  assert.equal(normalizeRole('owner'), '');
  assert.equal(normalizeRole('routine:prober'), '');
  assert.equal(normalizeRole(''), '');
  assert.equal(normalizeRole(null), '');
});

test('isFresh: un marcatore vecchio non firma il lavoro di oggi', () => {
  const now = Date.parse('2026-08-08T12:00:00.000Z');
  const at = (iso) => ({ role: 'prober', since: iso });
  assert.equal(isFresh(at('2026-08-08T11:59:00.000Z'), now), true);
  // Al limite delle 12 ore: ancora valido.
  assert.equal(isFresh(at('2026-08-08T00:00:00.000Z'), now), true);
  // Oltre: scaduto (meglio "automazione" generica che l'etichetta sbagliata).
  assert.equal(isFresh(at('2026-08-07T23:59:00.000Z'), now), false);
  assert.equal(isFresh({ role: 'prober', since: 'non-una-data' }, now), false);
  assert.equal(isFresh({ role: 'boh', since: '2026-08-08T11:59:00.000Z' }, now), false);
  assert.equal(isFresh(null, now), false);
  // Orologio leggermente avanti: tollerato entro un minuto.
  assert.equal(isFresh(at('2026-08-08T12:00:30.000Z'), now), true);
  assert.equal(isFresh(at('2026-08-08T13:00:00.000Z'), now), false);
});

test('writeRole → readRole: chi accoda ritrova il ruolo scritto dal dispatcher', () => {
  const root = tmpRoot();
  try {
    assert.equal(readRole(root), '');
    writeRole(root, 'prober');
    assert.equal(readRole(root), 'prober');
    // Il giro successivo sovrascrive: un solo worker alla volta, un solo ruolo.
    writeRole(root, 'verifier');
    assert.equal(readRole(root), 'verifier');
    clearRole(root);
    assert.equal(readRole(root), '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('writeRole: un ruolo non riconosciuto non lascia traccia', () => {
  const root = tmpRoot();
  try {
    assert.equal(writeRole(root, 'halt'), null);
    assert.equal(readRole(root), '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readRole: un marcatore scaduto vale come "non lo so"', () => {
  const root = tmpRoot();
  try {
    mkdirSync(resolve(root, '.claude'), { recursive: true });
    const old = new Date(Date.now() - MAX_AGE_MS - 60_000).toISOString();
    writeFileSync(roleFile(root), JSON.stringify({ role: 'prober', since: old }), 'utf8');
    assert.equal(readRole(root), '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readRole: la variabile d’ambiente esplicita vince sul marcatore', () => {
  const root = tmpRoot();
  const prev = process.env.FILO_ROUTINE_ROLE;
  try {
    writeRole(root, 'prober');
    process.env.FILO_ROUTINE_ROLE = 'fixer';
    assert.equal(readRole(root), 'fixer');
    // Un valore inventato non scavalca nulla: si ricade sul marcatore.
    process.env.FILO_ROUTINE_ROLE = 'qualsiasi-cosa';
    assert.equal(readRole(root), 'prober');
  } finally {
    if (prev === undefined) delete process.env.FILO_ROUTINE_ROLE;
    else process.env.FILO_ROUTINE_ROLE = prev;
    rmSync(root, { recursive: true, force: true });
  }
});
