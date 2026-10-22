// Verifica #1480 giro 1: i controlli di finish:check girano sull'ultimo commit; una modifica ancora fuori dai commit
// (un file nato da una shell) non va provata in silenzio: o la provano, o lo dicono.
import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 un test rosso non ancora committato non sparisce in silenzio da finish:check', () => {
  test.setTimeout(8 * 60 * 1000);
  const dir = cartellaTemporanea('filo-v1480-');
  try {
    const clone = join(dir, 'c');
    const git = (...a) => execFileSync('git', a, { cwd: clone, encoding: 'utf8' });
    execFileSync('git', ['clone', '-q', ROOT, clone]);
    git('checkout', '-q', '-b', 'prova/sporco', execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim());
    symlinkSync(join(ROOT, 'node_modules'), join(clone, 'node_modules'), 'junction');
    // Unit ridotti a uno verde, committato: la corsa dura secondi.
    const unit = join(clone, 'tests', 'unit');
    git('rm', '-q', ...readdirSync(unit).filter((f) => f.endsWith('.test.mjs')).map((f) => `tests/unit/${f}`));
    writeFileSync(join(unit, 'verde.test.mjs'), "import test from 'node:test';\ntest('verde', () => {});\n");
    git('add', '-A');
    git('-c', 'user.email=v@v', '-c', 'user.name=v', 'commit', '-qm', 'unit ridotti');
    // La modifica fuori dai commit: un test rosso.
    writeFileSync(join(unit, 'rosso.test.mjs'), "import test from 'node:test';\nimport assert from 'node:assert';\ntest('rosso non committato', () => { assert.fail('ROSSO'); });\n");
    const r = spawnSync(process.execPath, ['scripts/finish-local.mjs', '--check'], { cwd: clone, encoding: 'utf8', timeout: 7 * 60 * 1000 });
    const uscita = `${r.stdout}\n${r.stderr}`;
    // Provata (il suo nome compare nella corsa) o dichiarata esclusa.
    expect(uscita).toMatch(/rosso non committato|non committat|fuori dai commit|rosso\.test\.mjs/);
  } finally {
    togliCartella(dir);
  }
});
