// Unit test per src/main/services/supportModelsStore.js — slot del doc
// config/supportModels. Asserisce che il panel L2 abbia uno slot per giudice
// (judge1/judge2/judge3/judgeDynamic) e che il vecchio slot unico judgeL2 sia
// stato rimosso. Niente rete: si ispeziona solo l'array SLOTS esportato.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const { SLOTS, sanitizeRegistry } = require(join(ROOT, 'src', 'main', 'services', 'supportModelsStore.js'));

test('SLOTS espone uno slot per ogni giudice del panel L2 + dinamico', () => {
  for (const slot of ['judge1', 'judge2', 'judge3', 'judgeDynamic']) {
    assert.ok(SLOTS.includes(slot), `manca lo slot ${slot}`);
  }
});

test('SLOTS conserva gli slot non-panel (sanitizer, red-team, priorità)', () => {
  for (const slot of ['sanitizer', 'judgeRedTeam', 'judgePriority']) {
    assert.ok(SLOTS.includes(slot), `manca lo slot ${slot}`);
  }
});

test('il vecchio slot unico judgeL2 è stato rimosso', () => {
  assert.ok(!SLOTS.includes('judgeL2'), 'judgeL2 non deve più comparire in SLOTS');
});

test('SLOTS non ha duplicati', () => {
  assert.equal(SLOTS.length, new Set(SLOTS).size, 'gli slot devono essere unici');
});

// ── Registro modelli dei giudici (judgeRegistry) ─────────────────────────────

test('sanitizeRegistry: voce valida → provider openrouter forzato, model conservato', () => {
  const out = sanitizeRegistry({ 'giudice-veloce': { model: 'deepseek/deepseek-v4-pro' } });
  assert.deepEqual(out, { 'giudice-veloce': { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' } });
});

test('sanitizeRegistry: conserva la label se presente', () => {
  const out = sanitizeRegistry({ g: { model: 'x/y', label: 'Giudice rapido' } });
  assert.equal(out.g.label, 'Giudice rapido');
});

test('sanitizeRegistry: scarta voci senza nickname o senza modello', () => {
  const out = sanitizeRegistry({
    '': { model: 'x/y' },          // nickname vuoto
    'no-model': { model: '  ' },   // modello vuoto
    buona: { model: 'a/b' },
  });
  assert.deepEqual(Object.keys(out), ['buona']);
});

test('sanitizeRegistry: trim del nickname e del modello', () => {
  const out = sanitizeRegistry({ '  g  ': { model: '  a/b  ' } });
  assert.deepEqual(out, { g: { provider: 'openrouter', model: 'a/b' } });
});

test('sanitizeRegistry: input non-oggetto → mappa vuota', () => {
  assert.deepEqual(sanitizeRegistry(null), {});
  assert.deepEqual(sanitizeRegistry(undefined), {});
  assert.deepEqual(sanitizeRegistry('stringa'), {});
});
