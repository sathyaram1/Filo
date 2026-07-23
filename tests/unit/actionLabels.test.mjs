// Unit test per SN_CONST.actionLabel — le etichette leggibili delle azioni
// mostrate nella Cronologia AI (voci della lista + menu "filtra per tipo").
// Regressione del feedback #272: alcune azioni (descrivi immagine, trascrizioni,
// modifica testo, spiega link) comparivano in cronologia col loro codice interno
// grezzo perché prive di etichetta. Questo test diventa ROSSO se una qualsiasi
// azione di ACTIONS resta senza etichetta leggibile.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'constants.js'));

const C = globalThis.SN_CONST;

test('actionLabel è esposto su SN_CONST', () => {
  assert.equal(typeof C.actionLabel, 'function');
  assert.ok(C.ACTION_LABELS && typeof C.ACTION_LABELS === 'object');
});

test('ogni azione ha un\'etichetta leggibile (diversa dal codice grezzo)', () => {
  const raw = [];
  for (const id of Object.values(C.ACTIONS)) {
    const label = C.actionLabel(id);
    assert.equal(typeof label, 'string');
    assert.ok(label.length > 0);
    if (label === id) raw.push(id);
  }
  assert.deepEqual(
    raw,
    [],
    `Azioni senza etichetta (mostrerebbero il codice grezzo in Cronologia): ${raw.join(', ')}`,
  );
});

test('le azioni citate nel feedback #272 hanno la loro etichetta italiana', () => {
  const A = C.ACTIONS;
  assert.equal(C.actionLabel(A.DESCRIBE_IMAGE), 'Descrivi immagine');
  assert.equal(C.actionLabel(A.TRANSCRIBE_AUDIO), 'Dettatura');
  assert.equal(C.actionLabel(A.EDIT_TEXT), 'Modifica testo');
  assert.equal(C.actionLabel(A.EXPLAIN_LINK), 'Spiega link');
  assert.ok(/OCR/.test(C.actionLabel(A.TRANSCRIBE_IMAGE)));
});

test('un\'azione sconosciuta ricade sul suo id (fallback difensivo)', () => {
  assert.equal(C.actionLabel('azione_inesistente'), 'azione_inesistente');
});
