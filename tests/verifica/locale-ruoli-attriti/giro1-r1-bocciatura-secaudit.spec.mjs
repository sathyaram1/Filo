// Giro locale «ruoli-attriti», giro 1, rilievo 1 — sulla bocciatura la ricetta
// del controllo di sicurezza chiede di «accodare design» senza un comando.
//
// Il server, ricevuto un fail, porta già da solo il feedback in design (motivo
// secaudit), e design→design non è un passaggio ammesso: un'azione di chiusura
// da fare a mano sulla bocciatura manda chi esegue a cercarsi lo strumento per
// una consegna che verrebbe respinta.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DISPATCH = fileURLToPath(new URL('../../../scripts/dispatch.mjs', import.meta.url));

test('sulla bocciatura la ricetta non chiede di accodare design a mano', () => {
  const out = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import(${JSON.stringify(pathToFileURL(DISPATCH).href)});`
    + 'process.stdout.write(m.readRoleInstructions("secaudit"));'],
  { encoding: 'utf8', env: { ...process.env, FILO_NO_BEAT: '1' } });
  expect(out.status, out.stderr).toBe(0);
  const ricetta = out.stdout.replace(/\s+/g, ' ');
  // La frase che oggi manda a cercare il comando: «su fail … accoda `design`».
  const trovata = ricetta.match(/\*\*fail\*\*[^.]{0,40}accoda `design`[^)]*/);
  expect(trovata && trovata[0], 'il server porta già in design su un fail: la ricetta non deve chiedere un\'azione a mano').toBeNull();
});
