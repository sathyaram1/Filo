// Il riallineamento rifà solo la base: gli unit rossi sulla fusione non li corregge chi riallinea, li giudica la
// verifica come rilievi (#1204). Una logica cambiata per far passare un test non deve arrivare su main senza giudizio.

import test from 'node:test';
import assert from 'node:assert/strict';

const { readRoleInstructions, buildPayload, serverCtx } = await import('../../scripts/dispatch.mjs');
const { perimetroNote } = await import('../../scripts/lib/verifier-scope.mjs');
const { testoUnitRossi, exitCodeFor } = await import('../../scripts/merge-gate.mjs');

const CRITICA = 'FAIL tecnico, non di qualità: gli unit test sono ROSSI sul risultato della fusione del ramo con main.\n'
  + '  - tests/unit/somma.test.mjs › somma due numeri';

test('chi riallinea per unit rossi riceve l\'elenco, e il testo gli dice di elencarli senza correggerli', () => {
  const bucket = { role: 'fixer', branch: 'worker/X', id: 'X', num: '#1204' };
  const payload = buildPayload(bucket, serverCtx(bucket, { payload: { feedback: { text: 't' }, critique: CRITICA } }));
  assert.equal(payload.case, 'riallineamento');
  assert.match(payload.critique, /somma\.test\.mjs › somma due numeri/);

  const testo = readRoleInstructions('fixer', { caso: payload.case });
  for (const vecchio of [/tornare verd/i, /farli passare/i, /unica eccezione/i, /oltre i test rossi/i]) {
    assert.doesNotMatch(testo, vecchio, `il testo chiede ancora di sistemare i test rossi (${vecchio})`);
  }
  assert.match(testo, /Unit rossi sulla fusione/);
  assert.match(testo, /quei test non\s+li correggi/);
  assert.match(testo, /l'elenco degli unit rossi dopo il rebase/);
  assert.match(testo, /compresi quelli elencati dal server, resta com'è e va nel\s+report/);
});

test('chi verifica il riallineamento fa di ogni unit rosso sulla fusione un rilievo interno', () => {
  const testo = readRoleInstructions('verifier', { scope: 'riallineamento' });
  assert.match(testo, /unit rossi sul risultato della fusione/);
  assert.match(testo, /\*\*gli unit sono verdi\*\*/);
  assert.match(testo, /ogni test\s+rosso che su `main` da solo passa è un rilievo \*\*interno\*\*/);
  assert.match(testo, /livello è quello di ogni altro rosso dei controlli automatici/);
  // La regola del livello sta in un posto solo: il testo comune dei controlli automatici.
  assert.match(testo, /Un rosso \*\*fuori dai rossi noti\*\* è un rilievo di livello 2/);
});

test('il perimetro del riallineamento chiede a chi verifica di leggere anche gli unit rimasti rossi', () => {
  const note = perimetroNote('riallineamento', { shaVerificato: 'abc1234', reportRebase: 'nessun conflitto\nrossi: tests/unit/somma.test.mjs' });
  assert.match(note, /quali unit erano rossi dopo il rebase/);
  assert.match(note, /> rossi: tests\/unit\/somma\.test\.mjs/);
});

test('il cancello, fermo per unit rossi, non chiede di farli tornare verdi', () => {
  assert.equal(exitCodeFor({ ok: true, result: 'unit_rossi' }), 20);
  const t = testoUnitRossi();
  assert.match(t, /^\[merge-gate\] UNIT ROSSI SULLA FUSIONE: niente fusione\./);
  assert.match(t, /chi riallinea rifà solo la base/);
  assert.match(t, /li giudica come rilievi la verifica/);
  assert.doesNotMatch(t, /tornare verd|correggi|sistema/i);
});
