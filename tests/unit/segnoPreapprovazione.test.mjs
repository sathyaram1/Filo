// Il segno «fondi senza chiedermelo» ha due specie: a mano (copre tutto) e nato
// da un sì a una richiesta (solo i blocchi già approvati). src/shared/mergeApprovals.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'mergeApprovals.js'));
const UI = globalThis.SN_MERGE_APPROVALS;

const AT = '2026-09-26T10:26:00.000Z';
const ID = 'ab12cd34ef56ab12cd34ef56';
const aMano = { by: 'owner@esempio.it', at: AT };
const daSi = { by: `owner@esempio.it · approvazione ${ID}`, at: AT };

test('le due specie si riconoscono dalla forma di `by`', () => {
  assert.deepEqual(UI.segnoPreapprovazione(aMano), { tipo: 'pieno', by: aMano.by, at: AT });
  assert.deepEqual(UI.segnoPreapprovazione(daSi), { tipo: 'approvazione', by: daSi.by, at: AT, richiesta: ID });
  // Un id che non è di 24 cifre esadecimali non è la forma del server.
  assert.equal(UI.segnoPreapprovazione({ by: 'x · approvazione 123', at: AT }).tipo, 'pieno');
  assert.equal(UI.segnoPreapprovazione({ by: '  ', at: AT }), null);
  assert.equal(UI.segnoPreapprovazione(null), null);
});

test('il segno a mano si legge come prima', () => {
  const t = UI.segnoTesti(UI.segnoPreapprovazione(aMano));
  assert.equal(t.etichetta, 'senza chiedere');
  assert.equal(t.titolo, 'Si fonde senza chiedere: segno messo da owner@esempio.it');
});

test('il segno da approvazione dice che vale solo per i blocchi già approvati, e da quando', () => {
  const t = UI.segnoTesti(UI.segnoPreapprovazione(daSi));
  const quando = UI.dateTimeText(Date.parse(AT));
  assert.ok(!t.etichetta.includes('senza chiedere'));
  for (const s of [t.titolo, t.riga]) {
    assert.match(s, /solo coi blocchi che hai già approvato/);
    assert.ok(s.includes(`dal tuo sì alla richiesta del ${quando}`), s);
    assert.ok(!s.includes(ID) && !s.includes('owner@esempio.it'), s);
  }
});

test('un clic: sul segno da approvazione mette quello pieno, sul pieno lo toglie', () => {
  assert.equal(UI.segnoAlClic(null), true);
  assert.equal(UI.segnoAlClic(UI.segnoPreapprovazione(daSi)), true);
  assert.equal(UI.segnoAlClic(UI.segnoPreapprovazione(aMano)), false);
});

test('fra le fusioni fatte senza chiedere, il segno da approvazione non si stampa grezzo', () => {
  assert.equal(UI.preapprovedBy({ preapprovedBy: 'owner@esempio.it' }), 'pre-approvata da owner@esempio.it');
  const s = UI.preapprovedBy({ preapprovedBy: daSi.by, preapprovedAt: AT });
  assert.equal(s, `pre-approvata dal tuo sì alla richiesta del ${UI.dateTimeText(Date.parse(AT))}`);
});
