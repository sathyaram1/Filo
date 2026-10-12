// #1184 giro 3 — l'avviso di una suite Playwright rossa su main elenca i commit sospetti a partire dall'ultimo commit
// dove Playwright era verde. Una corsa verde di prima del lavoro unit su Windows resta un verde di Playwright: senza,
// l'avviso dice «nessuna suite verde» e non elenca nessun sospetto. `gh` finto: risponde con una corsa sola.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const RADICE = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const VERDE = '52bb144133f11ec4c7b4002f84815a82256b61f1';

test('r1 l\'avviso Playwright rosso trova l\'ultimo commit con Playwright verde', async () => {
  test.skip(process.platform === 'win32', 'il gh finto è uno script di shell');
  const presente = spawnSync('git', ['merge-base', '--is-ancestor', VERDE, 'HEAD'], { cwd: RADICE });
  test.skip(presente.status !== 0, 'il commit verde non è nella storia di questo clone');

  const suite = readFileSync(join(RADICE, '.github', 'workflows', 'suite.yml'), 'utf8');
  const lavoroPlaywright = suite.split(/^  unit-windows:/m)[0];
  const comando = lavoroPlaywright.match(/VERDE=\$\((node scripts\/ultima-suite-verde\.mjs[^\n]*)\)\s*$/m)?.[1];
  expect(comando, 'l\'avviso Playwright chiede ancora l\'ultimo verde a ultima-suite-verde').toBeTruthy();

  const tmp = cartellaTemporanea('v1184-gh-');
  try {
    const corsa = { id: 101, head_sha: VERDE, conclusion: 'success', status: 'completed', event: 'push', head_branch: 'main', html_url: 'https://example.invalid/101' };
    writeFileSync(join(tmp, 'gh.mjs'), `const p = process.argv[3] || '';
const corsa = ${JSON.stringify(corsa)};
let r = {};
if (/\\/jobs/.test(p)) r = { jobs: [{ name: 'suite', conclusion: 'success' }] };
else if (/workflows\\/suite\\.yml\\/runs/.test(p)) r = { workflow_runs: [corsa] };
process.stdout.write(JSON.stringify(r));
`);
    writeFileSync(join(tmp, 'gh'), `#!/bin/sh\nexec "${process.execPath}" "${join(tmp, 'gh.mjs')}" "$@"\n`);
    chmodSync(join(tmp, 'gh'), 0o755);
    const r = spawnSync('bash', ['-c', `VERDE=$(${comando}); printf '%s' "$VERDE"`], {
      cwd: RADICE,
      env: { ...process.env, PATH: `${tmp}:${process.env.PATH}`, GITHUB_REPOSITORY: 'prova/filo', GH_TOKEN: 'finto' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(r.stdout.trim(), `corsa con Playwright verde e senza unit su Windows: l'avviso Playwright deve partire da lì\n${r.stderr}`).toBe(VERDE);
  } finally {
    togliCartella(tmp);
  }
});
