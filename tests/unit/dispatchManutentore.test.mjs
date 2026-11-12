// Il ruolo `manutentore` (SPEC-MANUTENTORE § 4): la sessione che il pacemaker accende per lui riceve un biglietto senza
// feedback; dispatch lo sa eseguire, gli dà il suo ruolo col contratto dei worker e il contesto piccolo del server.
import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkEnvelope, buildPayload, serverCtx, readRoleInstructions } from '../../scripts/dispatch.mjs';
import { normalizeRole } from '../../scripts/lib/routine-role.mjs';

const CONTESTO = {
  motivo: 'mattino', stato: { ordine: [], segnali: [] }, taccuino: { testo: 'criterio', versione: 2 },
  schede: [{ num: '812', priorita: 3 }], endpoint: 'routineManutentore',
};

test('la busta del manutentore non ha un feedback, ma deve avere il suo contesto', () => {
  assert.equal(checkEnvelope({ role: 'manutentore', payload: { manutentore: CONTESTO } }), null);
  assert.match(checkEnvelope({ role: 'manutentore', payload: {} }), /manutentore senza il suo contesto/);
  assert.equal(normalizeRole('manutentore'), 'manutentore');
});

test('il payload è il contesto piccolo com\'è, col motivo dell\'accensione come caso', () => {
  const ctx = serverCtx({ role: 'manutentore' }, { payload: { manutentore: CONTESTO } });
  const p = buildPayload({ role: 'manutentore' }, ctx);
  assert.equal(p.case, 'mattino');
  assert.deepEqual(p.taccuino, CONTESTO.taccuino);
  assert.deepEqual(p.schede, CONTESTO.schede);
});

test('le istruzioni sono il ruolo del manutentore col contratto dei worker', () => {
  const t = readRoleInstructions('manutentore');
  assert.match(t, /^# Ruolo: manutentore/);
  assert.match(t, /## La decisione del mattino|decisione del mattino/);
  assert.match(t, /Contratto comune dei worker/);
});
