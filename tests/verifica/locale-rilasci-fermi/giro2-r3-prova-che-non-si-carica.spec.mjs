// Giro 2, rilievo 3: una prova che non si carica ferma tutta la suite (Playwright non esegue nessun caso). La chiave
// dell'allarme deve nominare quel file, non la «suite non partita» di un'installazione fallita o di un tetto scaduto.

import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const VERDETTO = fileURLToPath(new URL('../../../scripts/suite-verdict.mjs', import.meta.url));
const RADICE = '/home/runner/work/Filo/Filo';

// La forma che Playwright 1.60 scrive nel JSON quando un file non si carica: nessuna suite, un errore globale.
const ESITI = {
  'import che non risolve': {
    suites: [],
    errors: [{
      message: `Error: Cannot find module '${RADICE}/tests/helpers/spostato.mjs' imported from ${RADICE}/tests/rotto.spec.mjs`,
    }],
  },
  'errore di sintassi': {
    suites: [],
    errors: [{
      message: `SyntaxError: ${RADICE}/tests/rotto.spec.mjs: Unexpected token (3:0)`,
      location: { file: `${RADICE}/tests/rotto.spec.mjs`, line: 3, column: 0 },
    }],
  },
};

const verdetto = (cwd, json) => new Promise((ok) => {
  writeFileSync(join(cwd, 'suite.json'), JSON.stringify(json));
  execFile(process.execPath, [VERDETTO, join(cwd, 'suite.json'), '--chiavi', join(cwd, 'chiavi.txt')], { cwd },
    (err) => ok(readFileSync(join(cwd, 'chiavi.txt'), 'utf8').split(/\r?\n/).filter(Boolean)));
});

for (const [caso, json] of Object.entries(ESITI)) {
  test(`${caso}: la chiave nomina il file che non si carica`, async () => {
    const dir = cartellaTemporanea('giro2-r3');
    try {
      const chiavi = await verdetto(dir, json);
      expect(chiavi.some((k) => k.includes('rotto')),
        `chiavi ${JSON.stringify(chiavi)}: con un feedback «suite non partita» già aperto questo guasto non ne apre uno suo`)
        .toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
