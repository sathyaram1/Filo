// Verifica locale «domande-server», giro 3, rilievo 1: fuso con la linea principale, il ramo lascia verde la sentinella
// che vuole ogni prova dei moduli che misurano la sessione senza l'identità di chi la lancia. Sentinella vera.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());

test.setTimeout(5 * 60_000);

test('r1 la sentinella delle prove senza sessione è verde sul ramo', () => {
  const { NODE_TEST_CONTEXT: _figlio, ...env } = process.env;
  const r = spawnSync(process.execPath, [
    '--test', '--test-reporter=tap', '--test-name-pattern=importa senzaSessione', 'tests/unit/proveSenzaSessione.test.mjs',
  ], { cwd: ROOT, env, encoding: 'utf8', timeout: 4 * 60_000 });
  const out = String(r.stdout || '') + String(r.stderr || '');
  expect(out, 'la sentinella non è partita').toMatch(/^# pass [1-9]/m);
  expect(out, (out.match(/^not ok .*$|^\s+\+ .*$/gm) || []).join('\n')).toMatch(/^# fail 0$/m);
  expect(r.status).toBe(0);
});
