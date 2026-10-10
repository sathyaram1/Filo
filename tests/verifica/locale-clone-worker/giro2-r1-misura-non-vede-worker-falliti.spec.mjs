// Verifica locale «clone-worker», giro 2, rilievo 1: la misura di K non deve contare come sano un worker che fallisce,
// né quando esce con errore senza righe rosse riconoscibili, né quando Playwright scrive il rosso con le barre di Windows.
// Principale finto con origin nudo locale: niente rete, niente repo vero.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());
test.setTimeout(600_000);

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function canarino() {
  const dir = cartellaTemporanea('misura-k-canarino-');
  const origine = join(dir, 'origine.git');
  git(dir, 'init', '-q', '--bare', '-b', 'main', origine);
  const principale = join(dir, 'principale');
  git(dir, 'clone', '-q', origine, principale);
  git(principale, 'config', 'user.email', 't@t');
  git(principale, 'config', 'user.name', 't');
  writeFileSync(join(principale, 'package.json'), '{"name":"x","version":"1.0.0"}\n');
  writeFileSync(join(principale, 'package-lock.json'), '{"name":"x","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"x","version":"1.0.0"}}}\n');
  writeFileSync(join(principale, '.gitignore'), 'node_modules\n');
  git(principale, 'add', '-A');
  git(principale, 'commit', '-qm', 'base');
  git(principale, 'push', '-q', 'origin', 'main');
  mkdirSync(join(principale, 'node_modules', 'pacco'), { recursive: true });
  writeFileSync(join(principale, 'node_modules', 'pacco', 'index.js'), 'SENTINELLA\n');
  return { dir, principale };
}

// Una corsa da uno e una da due, col comando finto al posto di finish:check.
function misura(c, finto) {
  const script = join(c.dir, 'finto.mjs');
  writeFileSync(script, finto);
  const r = spawnSync(process.execPath, ['scripts/misura-k.mjs', '--corse', '1,2', '--comando', `node "${script}"`, '--spec', '', '--base', join(c.dir, 'k')], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, FILO_REPO_ROOT: c.principale, FILO_CLONI_DIR: join(c.dir, 'cloni'), FILO_TOOLS_DIR: join(c.dir, 'strumenti') },
  });
  return `${r.stdout}\n${r.stderr}`;
}

test('r1 un worker che esce con errore senza righe rosse riconoscibili non vale come sano', () => {
  const c = canarino();
  try {
    // Il worker 2 cade subito, come un Playwright che non parte: con due insieme la misura non regge.
    const out = misura(c, [
      "if (process.env.FILO_WORKER === '2') {",
      "  console.error(\"Error: Cannot find module '@playwright/test'\");",
      '  process.exit(1);',
      '}',
      'process.exit(0);',
    ].join('\n'));
    expect(out).toMatch(/corsa 2 finita: uscite 0,1/);
    expect(out, out).toMatch(/\[misura-k\] K = 1\b/);
  } finally { togliCartella(c.dir); }
});

test('r1 un rosso di Playwright scritto con le barre di Windows conta fra i rossi in più', () => {
  const c = canarino();
  try {
    // Tutti hanno lo stesso unit rosso della base (come su questa macchina); il worker 2 in più ha uno spec rosso.
    const out = misura(c, [
      'const B = String.fromCharCode(92);',
      "console.log('not ok 1 - tests/unit/lento.test.mjs');",
      "if (process.env.FILO_WORKER === '2') console.log('  \\u2718  3 tests' + B + 'context-menu.spec.mjs:30:1 \\u203a la voce feedback (21.2s)');",
      'process.exit(1);',
    ].join('\n'));
    expect(out).toMatch(/corsa 2 finita/);
    expect(out, out).toMatch(/\[misura-k\] K = 1\b/);
  } finally { togliCartella(c.dir); }
});
