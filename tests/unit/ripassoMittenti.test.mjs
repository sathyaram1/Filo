// Il ripasso della prova del mittente (#595, #908): solo owner e sessioni, solo i documenti nati (ora del
// server) prima del primo feedback che porta la prova, mai i segnalati come attacco. Puro.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mod = await import(pathToFileURL(join(ROOT, 'scripts', 'ripasso-mittenti.mjs')).href);

const T = (s) => `2026-${s}Z`;
const doc = (id, clientId, status, createTime, senderProof = '') => ({ id, seq: 1, clientId, status, createTime, senderProof });

test('la soglia è il primo feedback con la prova, altrimenti adesso', () => {
  const adesso = Date.parse(T('10-01T12:00:00'));
  assert.equal(mod.sogliaDellaProva([doc('a', 'local:claude', 'todo', T('09-01T00:00:00'))], adesso), adesso);
  const conProva = [
    doc('p2', 'local:claude', 'todo', T('10-03T00:00:00'), 'admin'),
    doc('p1', 'owner:me', 'todo', T('10-02T00:00:00'), 'admin'),
    doc('s', 'routine:x', 'todo', T('09-20T00:00:00'), 'server'),
  ];
  assert.equal(mod.sogliaDellaProva(conProva, Date.parse(T('10-09T00:00:00'))), Date.parse(T('10-02T00:00:00')));
});

test('prendono la prova solo owner e sessioni nati prima della soglia, fuori dai segnalati', () => {
  const soglia = Date.parse(T('10-02T00:00:00'));
  const docs = [
    doc('vecchio-locale', 'local:claude', 'todo', T('09-29T00:00:00')),
    doc('vecchio-owner', 'owner:abc', 'design', T('09-10T00:00:00')),
    doc('falso-dopo', 'local:claude', 'todo', T('10-05T00:00:00')),
    doc('attacco', 'local:claude', 'attack', T('09-01T00:00:00')),
    doc('illeggibile', 'owner:abc', 'FENC1:zz', T('09-01T00:00:00')),
    doc('utente', 'c-123', 'todo', T('09-01T00:00:00')),
    doc('routine', 'routine:worker', 'todo', T('09-01T00:00:00')),
    doc('gia', 'local:claude', 'todo', T('09-01T00:00:00'), 'admin'),
    doc('senza-ora', 'local:claude', 'todo', ''),
  ];
  const r = mod.candidatiAlRipasso(docs, soglia);
  assert.deepEqual(r.promossi.map((d) => d.id), ['vecchio-locale', 'vecchio-owner']);
  const saltati = Object.fromEntries(r.saltati.map((s) => [s.motivo, s.n]));
  assert.equal(saltati['nati quando la prova esisteva già'], 2);
  assert.equal(saltati['segnalati come attacco, spam o file sospetto'], 1);
  assert.equal(saltati['stato non decifrabile'], 1);
});
