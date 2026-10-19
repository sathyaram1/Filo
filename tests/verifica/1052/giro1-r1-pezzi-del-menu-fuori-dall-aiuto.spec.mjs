// #1052 giro 1, rilievo 1: l'immagine che segue il puntatore mentre si trascina un'icona del menu e l'etichetta delle
// icone sono pezzi del menu, disegnati dove è disegnato lui; una prova che li cerca sulla pagina senza l'aiuto deve
// essere vista dalla sentinella, e nessuna prova del repo deve farlo.

import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

test('r1 la sentinella vede chi cerca sulla pagina l\'immagine del trascinamento o l\'etichetta del menu', () => {
  expect.soft(cerche("await expect(page.locator('.sn-drag-preview')).toHaveCount(1);").length).toBe(1);
  expect.soft(cerche("await expect(page.locator('.sn-tooltip')).toBeVisible();").length).toBe(1);
});

test('r1 la prova della barra laterale trova l\'immagine del trascinamento del menu dall\'aiuto', () => {
  const testo = readFileSync(join(ROOT, 'tests', 'barra-laterale.spec.mjs'), 'utf8');
  expect(/page\.locator\(\s*['"`]\.sn-drag-preview/.test(testo)).toBe(false);
});
