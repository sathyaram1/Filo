// Verifica #644, giro 2 — la terza strada per tenersi un racconto lungo senza
// che la misura dei commenti se ne accorga.
//
// Il giro 1 ne ha chiuse due (l'intestazione per posizione, la riga vuota che
// spezzava il muro). Resta quella di chi attacca il commento in coda a una riga
// di codice: da lì in poi può scendere quanto vuole.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function corsa(albero) {
  const dir = cartellaTemporanea('filo-commenti-g2-');
  try {
    for (const [nome, testo] of Object.entries(albero)) {
      const dest = join(dir, nome);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, testo);
    }
    const env = { ...process.env, FILO_COMMENTI_ROOT: dir };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, ['--test', 'tests/unit/commentiRegola.test.mjs'], {
      cwd: ROOT, encoding: 'utf8', timeout: 240000, env,
    });
    return `${r.stdout || ''}${r.stderr || ''}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const rosso = (uscita, nome) => new RegExp(`not ok \\d+ - ${nome}`).test(uscita);

test('un commento attaccato in coda a una riga di codice non sfugge alla misura', () => {
  const uscita = corsa({
    'coda.css': ['.a { color: red; } /* riga uno del racconto',
      '   riga due del racconto',
      '   riga tre del racconto',
      '   riga quattro del racconto */',
      '.b { color: blue; }', ''].join('\n'),
    'coda.html': ['<!doctype html>', '<html><body>', '<div>x</div> <!-- riga uno del racconto',
      '  riga due del racconto',
      '  riga tre del racconto -->',
      '<p>y</p>', '</body></html>', ''].join('\n'),
  });
  expect(rosso(uscita, 'un commento a sé non supera le due righe'),
    `un racconto di quattro righe attaccato in coda a una riga di codice passa indisturbato:\n${uscita}`).toBe(true);
});
