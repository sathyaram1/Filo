// Sforzo degli agenti delle routine (decisione dell'owner del 2026-10-02): il primo lavoro a xhigh, verifica,
// correzione e controllo di sicurezza a high; la prosa dell'orchestratore dice lo stesso e sceglie l'agente per ruolo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const leggi = (...p) => readFileSync(resolve(ROOT, ...p), 'utf8');

const SFORZI = { 'routine-nuovo-lavoro': 'xhigh', 'routine-worker': 'high', 'routine-secaudit': 'high' };

for (const [nome, sforzo] of Object.entries(SFORZI)) {
  test(`${nome}: effort ${sforzo} nell'intestazione, e la descrizione non dice altro`, () => {
    const testo = leggi('.claude', 'agents', `${nome}.md`);
    const testa = /^---\n([\s\S]*?)\n---\n/.exec(testo);
    assert.ok(testa, 'intestazione YAML presente');
    const righe = testa[1].split('\n');
    assert.deepEqual(righe.filter((r) => /^name:/.test(r)), [`name: ${nome}`]);
    assert.deepEqual(righe.filter((r) => /^effort:/.test(r)), [`effort: ${sforzo}`]);
    assert.deepEqual(righe.filter((r) => /^model:/.test(r)), ['model: opus']);
    const descrizione = righe.find((r) => /^description:/.test(r)) || '';
    const detti = [...descrizione.matchAll(/sforzo (low|medium|high|xhigh)\b/g)].map((m) => m[1]);
    assert.deepEqual(detti, [sforzo], 'la descrizione nomina solo lo sforzo vero');
  });
}

test('l\'orchestratore manda ogni ruolo all\'agente giusto e dice gli stessi sforzi', () => {
  const testo = leggi('routines', 'roles', 'orchestrator.md').replace(/\s+/g, ' ');
  assert.match(testo, /`subagent_type: routine-nuovo-lavoro` se il ruolo è `new-work`/);
  assert.match(testo, /`subagent_type: routine-secaudit` se è `secaudit`/);
  assert.match(testo, /altrimenti `subagent_type: routine-worker`/);
  assert.match(testo, /il primo lavoro Opus a sforzo `xhigh`, gli altri due Opus a sforzo `high`/);
});
