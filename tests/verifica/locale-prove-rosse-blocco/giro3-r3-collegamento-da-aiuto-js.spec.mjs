// Verifica locale, giro 3: un aiuto dei test scritto in .cjs (in tests/ ci sono già file .js) crea il collegamento
// che Windows nega senza privilegi, un controllo di logica lo usa, e la sentinella resta verde.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { copia } from './giro3-copia.mjs';

let c;
test.beforeAll(async () => { test.setTimeout(300_000); c = await copia(); });
test.afterAll(() => { if (c) c.chiudi(); });

test('la sentinella dei collegamenti vede anche un aiuto .cjs usato da un controllo di logica', async () => {
  test.setTimeout(300_000);
  // Il nome si compone: scritto intero, la sentinella del repo vero troverebbe questo file.
  const S = `${'sym'}${'link'}Sync`;
  c.scrivi('tests/helpers/giro3-collega.cjs', [
    "const fs = require('node:fs');",
    "const { join } = require('node:path');",
    `exports.collega = (dir) => fs.${S}(join(dir, 'verso'), join(dir, 'collegamento'));`, ''].join('\n'));
  c.scrivi('tests/unit/giro3Collega.test.mjs', [
    "import { test } from 'node:test';",
    "import { createRequire } from 'node:module';",
    "import { cartellaTemporanea } from '../helpers/percorsi.mjs';",
    'const { collega } = createRequire(import.meta.url)(\'../helpers/giro3-collega.cjs\');',
    "test('collega', () => { collega(cartellaTemporanea('giro3-')); });", ''].join('\n'));
  const sentinella = spawnSync(process.execPath, ['--test', '--test-name-pattern=nessun test crea un collegamento',
    'tests/unit/cartelleTemporanee.test.mjs'], { cwd: c.dir, encoding: 'utf8' });
  const usato = spawnSync(process.execPath, ['--test', 'tests/unit/giro3Collega.test.mjs'], { cwd: c.dir, encoding: 'utf8' });
  const eperm = /EPERM/.test(usato.stdout + usato.stderr);
  expect(sentinella.status, `sentinella verde; il controllo che usa l'aiuto ${eperm ? 'esce con EPERM' : `esce con ${usato.status}`}`)
    .not.toBe(0);
});
