// Unit test per src/main/services/resolveSupportModel.js (DD3).
//
// Asserisce il SUCCESSO della centralizzazione backward-compat:
//   1. Config presente con valore per lo slot → ritorna QUEL modello (dalla config).
//   2. Config assente (null/undefined) → ritorna il fallback hard-coded.
//   3. Slot vuoto nella config ('') → ritorna il fallback hard-coded.
//   4. Config non raggiungibile (getter lancia) → ritorna il fallback hard-coded.
//   5. Nessun fallback esplicito → ritorna SLOT_DEFAULTS[slot] (default built-in).
//   6. Slot sconosciuto senza fallback → ritorna 'flash' (safe default).
//
// Niente rete: il getter è mockato.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const { resolveSupportModel, SLOT_DEFAULTS } = require(
  join(ROOT, 'src', 'main', 'services', 'resolveSupportModel.js')
);

// ── Helper getter mockati ──────────────────────────────────────────────────

function configWith(overrides) {
  return async () => ({
    sanitizer: '', judge1: '', judge2: '', judge3: '', judgeDynamic: '',
    judgeRedTeam: '', judgePriority: '', ...overrides,
  });
}

function configThrows() {
  return async () => { throw new Error('rete non disponibile'); };
}

function configNull() {
  return async () => null;
}

// ── Test 1: config presente con valore → ritorna la config ─────────────────

test('slot sanitizer con config "gemma" → ritorna "gemma"', async () => {
  const model = await resolveSupportModel('sanitizer', 'flash', configWith({ sanitizer: 'gemma' }));
  assert.equal(model, 'gemma', 'deve ritornare il valore dalla config, non il fallback');
});

test('slot judge1 con config "claude-haiku, flash" → ritorna la catena', async () => {
  const model = await resolveSupportModel('judge1', 'flash, flash-or', configWith({ judge1: 'claude-haiku, flash' }));
  assert.equal(model, 'claude-haiku, flash');
});

test('ogni giudice del panel ha uno slot indipendente', async () => {
  const cfg = configWith({ judge1: 'a', judge2: 'b', judge3: 'c', judgeDynamic: 'd' });
  assert.equal(await resolveSupportModel('judge1', 'x', cfg), 'a');
  assert.equal(await resolveSupportModel('judge2', 'x', cfg), 'b');
  assert.equal(await resolveSupportModel('judge3', 'x', cfg), 'c');
  assert.equal(await resolveSupportModel('judgeDynamic', 'x', cfg), 'd');
});

test('valore config con spazi marginali → ritornato trimmato', async () => {
  const model = await resolveSupportModel('sanitizer', 'flash', configWith({ sanitizer: '  flash-lite  ' }));
  assert.equal(model, 'flash-lite', 'i whitespace marginali vengono rimossi');
});

// ── Test 2: config assente → fallback hard-coded ────────────────────────────

test('config null → ritorna il fallback hard-coded', async () => {
  const model = await resolveSupportModel('sanitizer', 'my-fallback', configNull());
  assert.equal(model, 'my-fallback', 'fallback se config è null');
});

test('config assente (slot non presente) → ritorna il fallback', async () => {
  // configWith() produce un oggetto senza override, tutti i slot = ''
  const model = await resolveSupportModel('sanitizer', 'default-model', configWith({}));
  assert.equal(model, 'default-model', 'slot vuoto → fallback');
});

// ── Test 3: slot vuoto nella config ────────────────────────────────────────

test('slot esplicitamente vuoto nella config → ritorna il fallback', async () => {
  const model = await resolveSupportModel('sanitizer', 'flash-lite', configWith({ sanitizer: '' }));
  assert.equal(model, 'flash-lite', 'stringa vuota → fallback');
});

test('slot con solo spazi nella config → ritorna il fallback', async () => {
  const model = await resolveSupportModel('sanitizer', 'flash', configWith({ sanitizer: '   ' }));
  assert.equal(model, 'flash', 'stringa di soli spazi → fallback');
});

// ── Test 4: getter che lancia → fallback (backward-compat) ─────────────────

test('getter che lancia → ritorna il fallback senza propagare l\'eccezione', async () => {
  const model = await resolveSupportModel('judgeRedTeam', 'flash', configThrows());
  assert.equal(model, 'flash', 'eccezione del getter non si propaga');
});

test('getter che lancia → usa il fallback passato esplicitamente', async () => {
  const model = await resolveSupportModel('judgePriority', 'claude-haiku', configThrows());
  assert.equal(model, 'claude-haiku');
});

// ── Test 5: nessun fallback esplicito → SLOT_DEFAULTS ──────────────────────

test('senza fallback esplicito → usa SLOT_DEFAULTS[slot]', async () => {
  const model = await resolveSupportModel('judgeL2', undefined, configNull());
  assert.equal(model, SLOT_DEFAULTS.judgeL2, 'deve usare il default built-in dello slot');
});

test('senza fallback esplicito per sanitizer → SLOT_DEFAULTS.sanitizer', async () => {
  const model = await resolveSupportModel('sanitizer', undefined, configNull());
  assert.equal(model, SLOT_DEFAULTS.sanitizer);
});

// ── Test 6: slot sconosciuto → 'flash' come safe default ───────────────────

test('slot sconosciuto senza fallback → "flash" come safe default', async () => {
  const model = await resolveSupportModel('slotInesistente', undefined, configNull());
  assert.equal(model, 'flash', 'slot sconosciuto senza fallback → "flash"');
});

// ── Test 7: SLOT_DEFAULTS espone i 4 slot attesi ───────────────────────────

test('SLOT_DEFAULTS ha i 4 slot di DD1', () => {
  assert.ok('sanitizer' in SLOT_DEFAULTS, 'slot sanitizer');
  assert.ok('judgeL2' in SLOT_DEFAULTS, 'slot judgeL2');
  assert.ok('judgeRedTeam' in SLOT_DEFAULTS, 'slot judgeRedTeam');
  assert.ok('judgePriority' in SLOT_DEFAULTS, 'slot judgePriority');
  // I valori devono essere stringhe non vuote.
  for (const [k, v] of Object.entries(SLOT_DEFAULTS)) {
    assert.equal(typeof v, 'string', `SLOT_DEFAULTS.${k} deve essere una stringa`);
    assert.ok(v.trim().length > 0, `SLOT_DEFAULTS.${k} non deve essere vuoto`);
  }
});
