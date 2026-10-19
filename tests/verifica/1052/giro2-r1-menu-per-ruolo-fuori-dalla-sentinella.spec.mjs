// #1052 giro 2, rilievo 1: un attributo che solo il menu del tasto destro porta (la riga dove si lascia un'icona
// trascinata) lo trova sulla pagina quanto una sua classe; una prova nuova che lo cerca così senza l'aiuto deve essere
// vista dalla sentinella.

import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SENTINELLA = pathToFileURL(join(ROOT, 'tests', 'unit', 'menuSoloDallAiuto.test.mjs')).href;

function cerche(codice) {
  const script = `import { cercheFuoriDallAiuto } from ${JSON.stringify(SENTINELLA)};
    console.log('ESITO=' + JSON.stringify(cercheFuoriDallAiuto(${JSON.stringify(codice)})));`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: ROOT, encoding: 'utf8' });
  const riga = out.split('\n').find((r) => r.startsWith('ESITO='));
  return JSON.parse(riga.slice('ESITO='.length));
}

test('r1 la sentinella vede chi cerca sulla pagina il menu per un attributo che solo lui porta', () => {
  expect(cerche("await page.locator('[data-sn-drop-target=\"primary\"]').hover();").length).toBe(1);
});
