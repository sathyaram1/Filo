// #1052 giro 2, rilievo 1: il menu del tasto destro si trova sulla pagina anche per ruolo («menu») o per un attributo che
// solo lui porta (la riga dove si lascia un'icona trascinata); una prova nuova che lo cerca così senza l'aiuto deve
// essere vista dalla sentinella come quella che lo cerca per classe.

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

const PAGINA = '<!doctype html><title>Pagina</title><body style="margin:0;padding:24px;font:16px sans-serif"><p id="p">Un paragrafo dove fare tasto destro.</p></body>';

test('r1 il menu si trova sulla pagina per ruolo, e la sentinella non lo vede', async ({ openTab, testServer }) => {
  const page = await openTab(testServer.html(PAGINA));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await page.locator('#p').click({ button: 'right' });
  // La prova nuova che la sentinella dovrebbe fermare: trova davvero il menu, senza passare dall'aiuto.
  await expect(page.getByRole('menu')).toBeVisible();

  expect.soft(cerche("await expect(page.getByRole('menu')).toBeVisible();").length).toBe(1);
  expect.soft(cerche("await page.locator('[role=menu]').getByText('Copia').click();").length).toBe(1);
  expect.soft(cerche("await page.locator('[data-sn-drop-target=\"primary\"]').hover();").length).toBe(1);
});
