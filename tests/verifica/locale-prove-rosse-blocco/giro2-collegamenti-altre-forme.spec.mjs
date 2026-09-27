// Verifica locale, giro 2 (ramo claude/prove-rosse-blocco): un test che crea un collegamento negato da Windows senza
// privilegi non deve arrivare rosso alla chiusura dell'owner. O la sentinella lo trova quando lo si scrive, o non fallisce.
// Gira su una copia del ramo: i test d'esempio non entrano mai nel repo vero.

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const RADICE = fileURLToPath(new URL('../../../', import.meta.url));
// Spezzato, o la sentinella vera troverebbe questo file.
const S = 'sym' + 'link';

const testa = [
  "import { test } from 'node:test';",
  "import { join } from 'node:path';",
  "import { cartellaTemporanea } from '../helpers/percorsi.mjs';",
];
const FORME = {
  'zzCollegamentoAlias.test.mjs': [
    `import { ${S}Sync as collega, mkdirSync } from 'node:fs';`, ...testa,
    "test('alias', () => { const d = cartellaTemporanea('alias-'); mkdirSync(join(d, 'v'));",
    "  collega(join(d, 'v'), join(d, 'f')); });",
  ],
  'zzCollegamentoPromisify.test.mjs': [
    "import fs from 'node:fs';", "import { promisify } from 'node:util';", ...testa,
    "test('promisify', async () => { const d = cartellaTemporanea('prom-'); fs.mkdirSync(join(d, 'v'));",
    `  await promisify(fs.${S})(join(d, 'v'), join(d, 'f')); });`,
  ],
  'zzCollegamentoGuardiaAltrove.test.mjs': [
    `import { ${S}Sync, mkdirSync } from 'node:fs';`, ...testa,
    "test('solo posix', { skip: process.platform !== 'win32' ? false : 'posix' }, () => {});",
    "test('senza guardia', () => { const d = cartellaTemporanea('guardia-'); mkdirSync(join(d, 'v'));",
    `  ${S}Sync(join(d, 'v'), join(d, 'f')); });`,
  ],
};

test('ogni forma di collegamento negato o la ferma la sentinella, o non fa rossa la chiusura', () => {
  test.setTimeout(180_000);
  const base = cartellaTemporanea('collegamenti-giro2-');
  const dir = join(base, 'repo');
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: RADICE, encoding: 'utf8' }).trim();
    execFileSync('git', ['clone', '-q', '--shared', '--no-checkout', RADICE, dir], { stdio: 'ignore' });
    execFileSync('git', ['checkout', '-q', sha], { cwd: dir, stdio: 'ignore' });
    for (const [nome, righe] of Object.entries(FORME)) writeFileSync(join(dir, 'tests', 'unit', nome), `${righe.join('\n')}\n`);
    const sentinella = spawnSync(process.execPath, ['--test', 'tests/unit/cartelleTemporanee.test.mjs'], { cwd: dir, encoding: 'utf8' });
    const trovate = `${sentinella.stdout}${sentinella.stderr}`;
    const scappate = [];
    for (const nome of Object.keys(FORME)) {
      const r = spawnSync(process.execPath, ['--test', `tests/unit/${nome}`], { cwd: dir, encoding: 'utf8' });
      const eperm = /EPERM/.test(`${r.stdout}${r.stderr}`);
      if (eperm && !(sentinella.status !== 0 && trovate.includes(nome))) scappate.push(nome);
    }
    expect(scappate, trovate.slice(-2000)).toEqual([]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
