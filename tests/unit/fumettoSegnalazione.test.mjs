// #1635 — ogni riga del diario di una segnalazione (conferma chiesta, inviata, non inviata) porta titolo e testo interi
// per il fumetto; le altre azioni no. La prova nell'app: tests/home-fumetto-segnalazione.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['contenutoEsterno.js', 'nomiFile.js', 'timeFormat.js', 'actionLevels.js', 'sistema.js', 'esitoAzione.js', 'righeAttivita.js']) {
  require(join(ROOT, 'src', 'shared', f));
}
const RA = globalThis.SN_RIGHE_ATTIVITA;

const TESTO = `Il timer non suona quando la scheda è dietro.\nSuccede sempre. ${'Dettaglio lungo. '.repeat(200)}fine.`;
const base = { type: 'INVIA_FEEDBACK', titolo: 'Timer muto', testo: TESTO };

test('le righe di una segnalazione portano titolo e testo interi, in ogni stato', () => {
  const atteso = `Timer muto\n\n${TESTO.trim()}`;
  const stati = {
    inviata: { ...base, _executed: true },
    'non inviata': { ...base, _executed: false, _output: { error: 'problema di rete' } },
    'conferma chiesta': { ...base, _confirm: { level: 2, text: 'Inviare questo feedback a nome tuo:\nTimer muto' } },
  };
  for (const [nome, a] of Object.entries(stati)) {
    const r = RA.riga(a);
    assert.ok(r, nome);
    assert.equal(r.title, atteso, nome);
  }
  assert.equal(RA.testoSegnalazione({ type: 'invia_feedback', title: ' T ', text: ' x ' }), 'T\n\nx');
  assert.equal(RA.testoSegnalazione({ type: 'INVIA_FEEDBACK' }), '');
});

test('le altre azioni non prendono il fumetto della segnalazione', () => {
  assert.equal(RA.testoSegnalazione({ type: 'TIMER', testo: 'x' }), '');
  assert.equal(RA.riga({ type: 'TIMER', secondi: 60, _executed: true }).title, undefined);
});
