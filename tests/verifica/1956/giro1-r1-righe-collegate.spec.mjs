// Verifica #1956, rilievo 1: nella pagina Novità «Apri la segnalazione» deve comparire sulle righe vere, non solo su una
// riga scritta apposta. Oggi nessuna riga uscita porta il numero della sua segnalazione.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const require = createRequire(import.meta.url);

test('r1 le righe uscite nate da una segnalazione ne portano il numero, e chi scrive il changelog lo sa', async () => {
  require('../../../src/shared/patchNotes.js');
  require('../../../src/shared/novita.js');
  const installata = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const uscite = globalThis.SN_NOVITA.uscite(null, installata);
  const collegate = uscite.flatMap((v) => [...v.features, ...v.fixes]).filter((r) => r.segnalazione);
  // Le righe arrivano quasi tutte da feedback lavorati dalle routine: almeno una su dieci deve aprirsi.
  const tutte = uscite.reduce((n, v) => n + v.features.length + v.fixes.length, 0);
  expect(collegate.length, `${collegate.length} righe collegate su ${tutte}`).toBeGreaterThanOrEqual(Math.ceil(tutte / 10));
  // La regola su come si scrive la riga di changelog sta nelle istruzioni condivise: deve dire del numero.
  const consegna = readFileSync('CLAUDE.md', 'utf8').split('## Consegna')[1] || '';
  expect(consegna).toMatch(/segnalazione/);
});
