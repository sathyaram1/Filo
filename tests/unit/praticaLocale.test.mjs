// La pratica di un lavoro locale (#908): «#908», «908» o un id, da riga di comando
// fino all'id Firestore che npm run finish manda al server. Rete finta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRiferimento, estraiOpzioneFeedback, risolviFeedback, avvisoDaCampi,
} from '../../scripts/lib/pratica-locale.mjs';
import { withRequest } from '../../scripts/verify-local.mjs';

test('parseRiferimento: numero col cancelletto o senza, sotto-numero, id', () => {
  assert.deepEqual(parseRiferimento('#908'), { ok: true, seq: 908, subSeq: 0 });
  assert.deepEqual(parseRiferimento('908'), { ok: true, seq: 908, subSeq: 0 });
  assert.deepEqual(parseRiferimento('#22.1'), { ok: true, seq: 22, subSeq: 1 });
  assert.deepEqual(parseRiferimento('xEedWgj3AnlLh3lTZ5z5'), { ok: true, id: 'xEedWgj3AnlLh3lTZ5z5' });
  for (const male of ['', '#', '#abc', '0', 'a/b', '../x', 'id con spazi']) {
    assert.equal(parseRiferimento(male).ok, false, male);
  }
});

test('estraiOpzioneFeedback: le due forme, e il resto della riga intatto', () => {
  assert.deepEqual(estraiOpzioneFeedback(['--check', '--feedback', '908']), { valore: '908', resto: ['--check'] });
  assert.deepEqual(estraiOpzioneFeedback(['--feedback=#908', 'x']), { valore: '#908', resto: ['x'] });
  assert.deepEqual(estraiOpzioneFeedback(['a']), { valore: null, resto: ['a'] });
  // «--feedback #908» non quotato: la conchiglia si mangia il valore, e lo si dice.
  assert.match(estraiOpzioneFeedback(['--feedback']).errore, /commento/);
  assert.ok(estraiOpzioneFeedback(['--feedback', '--check']).errore);
  assert.ok(estraiOpzioneFeedback(['--feedback', '1', '--feedback', '2']).errore);
});

function rete(risposte) {
  const viste = [];
  const fetchImpl = async (url, opts = {}) => {
    viste.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
    const r = risposte(String(url), opts);
    return { ok: r.status === 200, status: r.status, json: async () => r.body };
  };
  return { fetchImpl, viste };
}

test('risolviFeedback: #N → l’id del documento col sotto-numero giusto', async () => {
  const doc = (id, sub) => ({ document: { name: `p/documents/feedback/${id}`, fields: { subSeq: { integerValue: String(sub) } } } });
  const { fetchImpl, viste } = rete(() => ({ status: 200, body: [doc('figlio', 1), doc('padre', 0), { readTime: 'x' }] }));
  const r = await risolviFeedback('#908', { bearer: 't', base: 'B', fetchImpl });
  assert.deepEqual(r, { ok: true, id: 'padre', seq: 908 });
  assert.equal(viste[0].url, 'B:runQuery');
  assert.equal(viste[0].body.structuredQuery.where.fieldFilter.value.integerValue, '908');
  const r2 = await risolviFeedback('#908.1', { bearer: 't', base: 'B', fetchImpl });
  assert.equal(r2.id, 'figlio');
});

test('risolviFeedback: numero che non esiste, id che non esiste, rete che risponde male', async () => {
  const vuota = rete(() => ({ status: 200, body: [{ readTime: 'x' }] }));
  assert.match((await risolviFeedback('5', { bearer: 't', base: 'B', fetchImpl: vuota.fetchImpl })).motivo, /nessun feedback #5/);
  const assente = rete(() => ({ status: 404, body: {} }));
  assert.equal((await risolviFeedback('abcDEF123', { bearer: 't', base: 'B', fetchImpl: assente.fetchImpl })).ok, false);
  const giu = rete(() => ({ status: 503, body: {} }));
  assert.match((await risolviFeedback('#9', { bearer: 't', base: 'B', fetchImpl: giu.fetchImpl })).motivo, /503/);
  const ok = rete(() => ({ status: 200, body: { fields: { seq: { integerValue: '77' } } } }));
  assert.deepEqual(await risolviFeedback('abcDEF123', { bearer: 't', base: 'B', fetchImpl: ok.fetchImpl }), { ok: true, id: 'abcDEF123', seq: 77 });
});

test('avvisoDaCampi: dice cosa manca perché L5 si salti, e tace se non manca niente', () => {
  const pieno = { senderProof: { stringValue: 'admin' }, localOnly: { mapValue: { fields: {} } }, statusPublic: { stringValue: 'open' } };
  assert.equal(avvisoDaCampi(pieno), '');
  assert.match(avvisoDaCampi({ ...pieno, senderProof: undefined }), /prova del mittente/);
  assert.match(avvisoDaCampi({ ...pieno, localOnly: undefined }), /solo in locale/);
  assert.match(avvisoDaCampi({ ...pieno, statusPublic: { stringValue: 'closed' } }), /chiusa/);
  // Chiusa dalla parte del server dello stesso lavoro da poco: per l'app vale ancora, e si dice fino a quando (#915).
  const ora = Date.parse('2026-10-03T10:00:00Z');
  const valore = (v) => (typeof v === 'string' ? { stringValue: v } : { integerValue: String(v) });
  const parti = (m) => ({ localMerges: { mapValue: { fields: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, valore(v)])) } } });
  const chiusa = { ...pieno, statusPublic: { stringValue: 'closed' } };
  const tardiva = avvisoDaCampi({ ...chiusa, ...parti({ server: ora - 3600e3, ramo: 'claude/lavoro' }) }, ora);
  assert.match(tardiva, /solo dal ramo con lo stesso nome, fino a 2026-10-05T09:00:00\.000Z/);
  assert.match(tardiva, /claude\/lavoro/);
  assert.doesNotMatch(tardiva, /manca/);
  // Senza il ramo che l'ha chiusa non si sa di quale lavoro è: vale come chiusa.
  assert.match(avvisoDaCampi({ ...chiusa, ...parti({ server: ora - 3600e3 }) }, ora), /una pratica aperta/);
  assert.match(avvisoDaCampi({ ...chiusa, ...parti({ server: ora - 49 * 3600e3 }) }, ora), /una pratica aperta/);
  assert.match(avvisoDaCampi({ ...chiusa, ...parti({ server: ora, app: ora }) }, ora), /una pratica aperta/);
});

test('verify-local start: la pratica resta legata al ramo finché non se ne indica un’altra', () => {
  let s = withRequest({}, 'claude/x', { request: 'r', sha: 'a', feedbackId: 'ID1', feedbackNum: 908 });
  assert.equal(s['claude/x'].feedbackId, 'ID1');
  assert.equal(s['claude/x'].feedbackNum, 908);
  // Ripartire dopo una correzione, senza --feedback: la pratica resta.
  s = withRequest(s, 'claude/x', { request: 'r', sha: 'b' });
  assert.deepEqual([s['claude/x'].feedbackId, s['claude/x'].feedbackNum], ['ID1', 908]);
  // Un'altra pratica la sostituisce, numero compreso.
  s = withRequest(s, 'claude/x', { request: 'r', sha: 'c', feedbackId: 'ID2', feedbackNum: 912 });
  assert.deepEqual([s['claude/x'].feedbackId, s['claude/x'].feedbackNum], ['ID2', 912]);
  // Un ramo senza pratica non se ne inventa una.
  assert.equal(withRequest({}, 'claude/y', { request: 'r', sha: 'a' })['claude/y'].feedbackId, undefined);
});

// Giro 4 della verifica locale: a ogni avvio la pratica riceve il giro che parte e com'è andato quello prima.
test('notaDelGiro: il giro che parte, e il precedente coi rilievi in una frase e il livello a parole', async () => {
  const { notaDelGiro } = await import('../../scripts/verify-local.mjs');
  const primo = notaDelGiro({ rounds: [] }, { branch: 'claude/x', sha: 'abcdef1234567' });
  assert.equal(primo, 'Verifica locale, giro 1: avviata sul ramo claude/x (abcdef12).');
  const critica = 'Ho provato tutto.\n[2i] Il salvataggio non parte. Passi lunghi.\n    passi\n[0e] Un menu esce dallo schermo.';
  const secondo = notaDelGiro({ rounds: [{ outcome: 'corretto', critique: critica }] }, { branch: 'claude/x', sha: 'ff00ff00ff' });
  assert.match(secondo, /^Verifica locale, giro 2: avviata sul ramo claude\/x \(ff00ff00\)\./);
  assert.match(secondo, /Giro 1: corretto, 2 rilievi\./);
  assert.match(secondo, /· livello 2: Il salvataggio non parte\./);
  assert.match(secondo, /· livello 0, di un altro lavoro: Un menu esce dallo schermo\./);
  assert.doesNotMatch(secondo, /\[\d[iev]/, 'niente quadre col livello: nella conversazione sembrerebbero rilievi');
});
