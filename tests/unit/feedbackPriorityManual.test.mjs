// Unit test per il campo `priorityManual` (P6).
//
// Asserisce il SUCCESSO (fallisce senza il fix):
//   a. updateStatus con priorityManual:true → booleanValue:true nel PATCH + in mask
//   b. updateStatus con priorityManual:false → NON compare nei fields/mask
//   c. updateStatus senza priorityManual → NON compare nei fields/mask (retrocompat)
//   d. updateStatus con priority+priorityManual:true → entrambi nel PATCH
//   e. updateStatus con solo priority (senza priorityManual) → priorityManual assente
//
// Gira senza Electron in millisecondi (node:test, nessuna dipendenza da UI).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const require = createRequire(import.meta.url);

// Carica feedback.js (IIFE → SN_FEEDBACK su globalThis).
// Il modulo usa `fetch` globale: lo sostituiamo con un mock che cattura la
// chiamata e ritorna un oggetto ok senza toccare la rete.
require(join(ROOT, 'src', 'shared', 'feedback.js'));
const FB = globalThis.SN_FEEDBACK;

// ── helper: stub fetch che cattura l'ultima chiamata PATCH ──────────────────
let lastCall = null;

function installFetchMock() {
  lastCall = null;
  globalThis.fetch = async (url, opts) => {
    lastCall = { url: String(url), opts };
    // Risposta minimale ok — feedback.js controlla solo res.ok e non usa il body
    // per updateStatus (ritorna `true` direttamente se ok).
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
    };
  };
}

// Decodifica i querystring della mask dall'URL catturato.
function extractMask(url) {
  const qs = url.split('?')[1] || '';
  const params = new URLSearchParams(qs);
  return params.getAll('updateMask.fieldPaths');
}

// Estrae il body JSON della chiamata.
function extractFields(opts) {
  const body = JSON.parse(opts.body || '{}');
  return body.fields || {};
}

// ─── Test a: priorityManual:true → booleanValue:true nel PATCH + in mask ────

test('P6: updateStatus con priorityManual:true scrive booleanValue:true + finisce in mask', async () => {
  installFetchMock();

  await FB.updateStatus('doc-id-123', { priorityManual: true });

  assert.ok(lastCall, 'fetch deve essere stata chiamata');
  assert.ok(lastCall.url.includes('/feedback/'), 'URL deve includere il path feedback');

  const mask = extractMask(lastCall.url);
  assert.ok(mask.includes('priorityManual'), `priorityManual deve essere in mask, mask attuale: ${JSON.stringify(mask)}`);

  const fields = extractFields(lastCall.opts);
  assert.ok('priorityManual' in fields, 'priorityManual deve essere nei fields');
  assert.deepEqual(fields.priorityManual, { booleanValue: true }, 'priorityManual deve essere { booleanValue: true }');
});

// ─── Test b: priorityManual:false → NON compare (solo true è significativo) ──

test('P6: updateStatus con priorityManual:false NON scrive il campo', async () => {
  installFetchMock();

  await FB.updateStatus('doc-id-456', { priorityManual: false });

  assert.ok(lastCall, 'fetch deve essere stata chiamata');
  const mask = extractMask(lastCall.url);
  assert.ok(!mask.includes('priorityManual'), `priorityManual NON deve essere in mask con value false, mask: ${JSON.stringify(mask)}`);
  const fields = extractFields(lastCall.opts);
  assert.ok(!('priorityManual' in fields), 'priorityManual NON deve essere nei fields con value false');
});

// ─── Test c: senza priorityManual → NON compare (retrocompatibilità) ─────────

test('P6: updateStatus senza priorityManual NON scrive il campo (retrocompat)', async () => {
  installFetchMock();

  // Aggiornamento normale senza priorityManual.
  await FB.updateStatus('doc-id-789', { notes: 'una nota qualsiasi' });

  assert.ok(lastCall, 'fetch deve essere stata chiamata');
  const mask = extractMask(lastCall.url);
  assert.ok(!mask.includes('priorityManual'), `priorityManual NON deve comparire in mask se non passato, mask: ${JSON.stringify(mask)}`);
  const fields = extractFields(lastCall.opts);
  assert.ok(!('priorityManual' in fields), 'priorityManual NON deve essere nei fields se non passato');
});

// ─── Test d: priority + priorityManual:true → entrambi nel PATCH ─────────────

test('P6: updateStatus con priority+priorityManual:true scrive entrambi in mask', async () => {
  installFetchMock();

  // Cifratura spenta (gate dormiente): priority viene scritto come integerValue.
  const savedFlag = globalThis.SN_FEEDBACK_ENC_ENABLED;
  globalThis.SN_FEEDBACK_ENC_ENABLED = false;
  try {
    await FB.updateStatus('doc-id-combo', { priority: 2, priorityManual: true });

    assert.ok(lastCall, 'fetch deve essere stata chiamata');
    const mask = extractMask(lastCall.url);

    assert.ok(mask.includes('priority'), `priority deve essere in mask, mask: ${JSON.stringify(mask)}`);
    assert.ok(mask.includes('priorityManual'), `priorityManual deve essere in mask, mask: ${JSON.stringify(mask)}`);

    const fields = extractFields(lastCall.opts);
    assert.ok('priority' in fields, 'priority deve essere nei fields');
    assert.ok('priorityManual' in fields, 'priorityManual deve essere nei fields');
    assert.deepEqual(fields.priorityManual, { booleanValue: true }, 'priorityManual deve essere booleanValue:true');
    // priority senza cifratura → integerValue '2'
    assert.deepEqual(fields.priority, { integerValue: '2' }, 'priority deve essere { integerValue: "2" }');
  } finally {
    globalThis.SN_FEEDBACK_ENC_ENABLED = savedFlag;
  }
});

// ─── Test e: solo priority senza priorityManual → priorityManual assente ─────

test('P6: updateStatus con solo priority (senza priorityManual) NON scrive priorityManual', async () => {
  installFetchMock();

  const savedFlag = globalThis.SN_FEEDBACK_ENC_ENABLED;
  globalThis.SN_FEEDBACK_ENC_ENABLED = false;
  try {
    await FB.updateStatus('doc-id-prio-only', { priority: 3 });

    assert.ok(lastCall, 'fetch deve essere stata chiamata');
    const mask = extractMask(lastCall.url);

    assert.ok(mask.includes('priority'), `priority deve essere in mask, mask: ${JSON.stringify(mask)}`);
    assert.ok(!mask.includes('priorityManual'), `priorityManual NON deve comparire in mask senza flag, mask: ${JSON.stringify(mask)}`);

    const fields = extractFields(lastCall.opts);
    assert.ok(!('priorityManual' in fields), 'priorityManual NON deve essere nei fields se non passato esplicitamente');
  } finally {
    globalThis.SN_FEEDBACK_ENC_ENABLED = savedFlag;
  }
});
