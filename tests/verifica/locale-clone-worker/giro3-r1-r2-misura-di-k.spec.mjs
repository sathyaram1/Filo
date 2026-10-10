// Verifica locale #1157, giro 3. r1: un test VERDE col nome che contiene «index.lock» fa dire alla misura «errore
// d'infrastruttura», e col comando predefinito K non esce mai. r2: con una base che esce con un rosso, la misura non
// vede un worker che cade in un altro modo (fermo del lanciatore degli unit, crollo senza righe rosse) e promuove N=2.
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

// Il comando finto: MODO decide cosa scrive e come esce ogni worker.
const FINTO = [
  'const w = Number(process.env.FILO_WORKER), n = Number(process.env.FILO_WORKER_PARALLELI);',
  'const modo = process.env.FINTO_MODO;',
  "if (modo === 'verde') {",
  // La riga vera che node --test scrive per un test verde degli agganci di salvataggio (autoCommitGateSessione).
  "  console.log('    # Subtest: index.lock a terra: niente commit, e la sessione lo sa col motivo di git');",
  "  console.log('    ok 1 - index.lock a terra: niente commit, e la sessione lo sa col motivo di git');",
  "  console.log('# pass 1');",
  '  process.exit(0);',
  '}',
  'if (w === 2 && n === 2) {',
  "  if (modo === 'fermo') console.log('[test:unit] ROSSO: tests/unit/autoCommitGate.test.mjs non è andato avanti per 20 minuti, e la corsa è stata chiusa.');",
  "  else console.error('Error: spawn npx ENOENT');",
  '  process.exit(1);',
  '}',
  "console.log('not ok 1 - un rosso che c\\'è anche con un worker solo');",
  'process.exit(1);',
].join('\n');

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
  const finto = join(base, 'finto.mjs');
  writeFileSync(finto, FINTO);
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

test('r1 tutto verde, con un test verde che nomina index.lock: K vale 2 e non «misura da rifare»', async () => {
  test.setTimeout(240_000);
  const s = principaleFinto();
  const out = misura(s, 'verde');
  expect(out, out).toMatch(/corsa 2 finita: uscite 0,0/);
  expect(out, out).not.toMatch(/infrastruttura: lock/);
  expect(out, out).toMatch(/\[misura-k\] K = 2\b/);
});

for (const [modo, come] of [
  ['fermo', 'il lanciatore degli unit chiude la corsa ferma'],
  ['crollo', 'il worker crolla senza una riga rossa'],
]) {
  test(`r2 base con un rosso, ${come} solo con due insieme: K resta 1`, async () => {
    test.setTimeout(240_000);
    const s = principaleFinto();
    const out = misura(s, modo);
    expect(out, out).toMatch(/corsa 2 finita: uscite 1,1/);
    expect(out, out).toMatch(/\[misura-k\] K = 1\b/);
  });
}
