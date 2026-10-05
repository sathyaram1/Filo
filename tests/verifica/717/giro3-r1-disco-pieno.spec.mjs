// Verifica #717 giro 3: col disco pieno di cartelle lasciate da corse vecchie, `npm run test:unit` toglie quelle
// cartelle e poi gira, invece di fermarsi su ENOSPC prima della pulizia. Il disco pieno si finge: mkdtemp dice ENOSPC
// finché nella temporanea c'è la cartella vecchia.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('col disco pieno di cartelle vecchie dei test, i controlli di logica le tolgono e girano', () => {
  const base = cartellaTemporanea('filo-v717-');
  const tmp = join(base, 'tmp');
  const casa = join(base, 'casa');
  const unit = join(base, 'unit');
  for (const d of [tmp, casa, unit]) mkdirSync(d);
  const vecchia = join(tmp, 'filo-vl-cli-con spazio-Abc123');
  mkdirSync(vecchia);
  writeFileSync(join(vecchia, 'pesante'), 'x');
  const ieri = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  utimesSync(vecchia, ieri, ieri);
  writeFileSync(join(unit, 'ok.test.mjs'), "import { test } from 'node:test';\ntest('ok', () => {});\n");

  const pieno = join(base, 'disco-pieno.mjs');
  writeFileSync(pieno, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const vero = fs.mkdtempSync;
fs.mkdtempSync = function (p, ...r) {
  if (fs.existsSync(${JSON.stringify(vecchia)})) { const e = new Error('ENOSPC: no space left on device, mkdtemp'); e.code = 'ENOSPC'; throw e; }
  return vero.call(this, p, ...r);
};
syncBuiltinESMExports();
`);
  const env = { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp, HOME: casa, USERPROFILE: casa, FILO_UNIT_DIR: unit };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(pieno).href, join(RADICE, 'scripts', 'run-unit-tests.mjs')],
    { env, cwd: RADICE, encoding: 'utf8' });
  expect(existsSync(vecchia), 'la cartella vecchia che riempie il disco è ancora lì').toBe(false);
  expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
  expect(r.stdout).toMatch(/# pass 1/);
});
