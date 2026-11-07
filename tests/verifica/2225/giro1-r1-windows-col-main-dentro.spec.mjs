// Verifica #2225 giro 1: un ramo che contiene già main (il caso di #1718, da cui è nato il rosso di #2223) deve
// passare lo stesso dagli unit su Windows: lì nessuno li ha mai girati. Il rosso di Windows qui non si fabbrica: il test
// nuovo è rosso ovunque, e conta che la parte Windows lo provi invece di dire «main contenuto».
import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MARCA_PARTE = 'ESITO-PARTE-UNIT';

function repoFinto() {
  const casa = cartellaTemporanea('filo-2225-dentro-');
  const lavoro = join(casa, 'prova');
  const origin = join(casa, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', origin]);
  mkdirSync(join(lavoro, 'scripts', 'lib'), { recursive: true });
  mkdirSync(join(lavoro, 'tests', 'unit'), { recursive: true });
  for (const f of ['scripts/run-unit-tests.mjs', 'scripts/lib/riga-di-comando.mjs', 'scripts/lib/riepilogo-unit.mjs', 'scripts/lib/avanzamento-unit.mjs']) {
    copyFileSync(join(ROOT, f), join(lavoro, f));
  }
  writeFileSync(join(lavoro, '.gitignore'), 'node_modules\n', 'utf8');
  writeFileSync(join(lavoro, 'tests', 'unit', 'base.test.mjs'), "import { test } from 'node:test';\ntest('base', () => {});\n", 'utf8');
  mkdirSync(join(lavoro, 'node_modules'));
  const git = (args) => String(execFileSync('git', args, { cwd: lavoro, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).trim();
  for (const a of [['init', '-q', '--initial-branch=main'], ['config', 'user.email', 't@t'], ['config', 'user.name', 't'], ['add', '-A'], ['commit', '-qm', 'base'],
    ['remote', 'add', 'origin', origin], ['push', '-q', 'origin', 'main']]) git(a);
  return { casa, lavoro, git };
}

test('r1 la parte Windows prova il test nuovo di un ramo che contiene già main', () => {
  const r = repoFinto();
  try {
    const main = r.git(['rev-parse', 'HEAD']);
    r.git(['checkout', '-q', '-b', 'claude/import']);
    writeFileSync(join(r.lavoro, 'tests', 'unit', 'nuovo.test.mjs'),
      "import { test } from 'node:test';\nimport assert from 'node:assert';\ntest('nuovo', () => assert.fail('rosso su Windows'));\n", 'utf8');
    r.git(['add', '-A']);
    r.git(['commit', '-qm', 'ramo: test nuovo']);
    const ramo = r.git(['rev-parse', 'HEAD']);
    const { NODE_TEST_CONTEXT: _f, GITHUB_STEP_SUMMARY: _s, GITHUB_OUTPUT: _o, ...env } = process.env;
    const p = spawnSync(process.execPath, [join(ROOT, 'scripts', 'unit-fusione-azione.mjs'), '--root', r.lavoro, '--ramo', ramo, '--main', main,
      '--parte', 'windows', '--unit', 'toccati'], { cwd: r.casa, env, encoding: 'utf8', timeout: 120000 });
    const riga = String(p.stdout || '').split('\n').find((l) => l.startsWith(`${MARCA_PARTE} windows `));
    expect(riga, `${p.stdout}${p.stderr}`).toBeTruthy();
    const campo = JSON.parse(riga.slice(`${MARCA_PARTE} windows `.length));
    expect(campo.esito, `${p.stdout}${p.stderr}`).toBe('rosso_sulla_fusione');
  } finally {
    togliCartella(r.casa);
  }
});
