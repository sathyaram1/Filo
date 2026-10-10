// Verifica locale «clone-worker», giro 2, rilievo 2: un `npm ci` lanciato a mano dentro il clone di un worker non deve
// svuotare i pacchetti del principale, che gli altri worker e il principale stesso stanno usando.
// Principale finto con origin nudo locale e node_modules finto: il node_modules vero non si tocca mai.
import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
  const dir = cartellaTemporanea('clone-npm-ci-canarino-');
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

test('r2 un npm ci lanciato dentro il clone di un worker non svuota i pacchetti del principale', () => {
  const c = canarino();
  const env = { ...process.env, FILO_REPO_ROOT: c.principale, FILO_CLONI_DIR: join(c.dir, 'cloni'), FILO_TOOLS_DIR: join(c.dir, 'strumenti') };
  try {
    const p = spawnSync(process.execPath, ['scripts/clone-worker.mjs', 'prepara', '1', '--paralleli', '2'], { cwd: ROOT, env, encoding: 'utf8' });
    expect(p.status, p.stdout + p.stderr).toBe(0);
    const clone = JSON.parse(p.stdout.trim().split('\n').pop()).dir;
    expect(existsSync(join(clone, 'node_modules', 'pacco', 'index.js'))).toBe(true);

    // Il gesto di un worker che vuole i pacchetti allineati al suo lock: lo stesso package-lock del principale.
    spawnSync('npm', ['ci', '--no-audit', '--no-fund', '--offline'], { cwd: clone, encoding: 'utf8', shell: process.platform === 'win32' });

    expect(existsSync(join(c.principale, 'node_modules', 'pacco', 'index.js'))).toBe(true);
  } finally {
    spawnSync(process.execPath, ['scripts/clone-worker.mjs', 'togli', '1'], { cwd: ROOT, env, encoding: 'utf8' });
    togliCartella(c.dir);
  }
});
