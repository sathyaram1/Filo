// Verifica locale #1157, giro 3, rilievo 1: con una base che esce con un rosso, la misura di K non vede un worker
// che cade in un modo diverso (il fermo del lanciatore degli unit, o un crollo senza righe rosse) e promuove N=2.
// Principale finto minuscolo (repo nudo locale, node_modules finto): niente rete, niente Electron, pochi secondi.

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MISURA = join(ROOT, 'scripts', 'misura-k.mjs');

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@prova', '-c', 'core.autocrlf=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function principaleFinto() {
  const base = cartellaTemporanea('g3-misura-');
  const origine = join(base, 'origine.git');
  const principale = join(base, 'principale');
  git(base, 'init', '-q', '--bare', origine);
  git(base, 'clone', '-q', origine, principale);
  git(principale, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(principale, 'package.json'), '{"name":"finto","version":"1.0.0"}\n');
  writeFileSync(join(principale, 'package-lock.json'),
    '{"name":"finto","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"finto","version":"1.0.0"}}}\n');
  mkdirSync(join(principale, 'tests'), { recursive: true });
  writeFileSync(join(principale, 'tests', 'rossi-noti.json'), '{"specs":[]}\n');
  writeFileSync(join(principale, '.gitignore'), 'node_modules/\n');
  git(principale, 'add', '-A');
  git(principale, 'commit', '-q', '-m', 'base');
  git(principale, 'push', '-q', '-u', 'origin', 'main');
  git(origine, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  mkdirSync(join(principale, 'node_modules', 'pacchetto'), { recursive: true });
  writeFileSync(join(principale, 'node_modules', 'pacchetto', 'index.js'), '');
  // Da solo ogni worker esce 1 con lo stesso rosso leggibile; con due insieme il worker 2 cade in un altro modo.
  const finto = join(base, 'finto.mjs');
  writeFileSync(finto, [
    'const w = Number(process.env.FILO_WORKER), n = Number(process.env.FILO_WORKER_PARALLELI);',
    'if (w === 2 && n === 2) {',
    "  if (process.env.FINTO_MODO === 'fermo') console.log('[test:unit] ROSSO: tests/unit/autoCommitGate.test.mjs non è andato avanti per 20 minuti, e la corsa è stata chiusa.');",
    "  else console.error('Error: spawn npx ENOENT');",
    '  process.exit(1);',
    '}',
    "console.log('not ok 1 - un rosso che c\\'è anche con un worker solo');",
    'process.exit(1);',
  ].join('\n'));
  return { base, principale, finto };
}

function misura(s, modo) {
  const r = spawnSync(process.execPath, [MISURA, '--corse', '1,2', '--comando', `node "${s.finto}"`, '--spec', '', '--base', join(s.base, 'k')], {
    cwd: s.principale,
    encoding: 'utf8',
    env: { ...process.env, FILO_REPO_ROOT: s.principale, FILO_TOOLS_DIR: join(s.base, 'strumenti'), FINTO_MODO: modo },
  });
  return `${r.stdout}\n${r.stderr}`;
}

for (const [modo, come] of [
  ['fermo', 'il lanciatore degli unit chiude la corsa ferma'],
  ['crollo', 'il worker crolla senza una riga rossa'],
]) {
  test(`r1 base con un rosso, ${come} solo con due insieme: K resta 1`, async () => {
    test.setTimeout(240_000);
    const s = principaleFinto();
    const out = misura(s, modo);
    expect(out, out).toMatch(/corsa 2 finita: uscite 1,1/);
    expect(out, out).toMatch(/\[misura-k\] K = 1\b/);
  });
}
