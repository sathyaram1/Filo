// Verifica #2340 giro 2: nelle routine il manutentore legge i rami del server dal clone che la sessione ha (poco
// profondo, solo main e il ramo della sessione) e non lo aggiorna: i lavori del server devono comparire lo stesso,
// negli elenchi e negli incroci. Repo finti: scripts, src e node_modules sono collegamenti a quelli di Filo.

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ORA = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const SERVER_A = `worker/serverUnoAAAAAAAAAAAAAAA-${ORA}T000000Z`;
const SERVER_B = `worker/serverDueBBBBBBBBBBBBBBB-${ORA}T000000Z`;

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function repoCon(dir, origine, file) {
  git(dirname(dir), ['init', '-q', dir]);
  git(dir, ['checkout', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'verifica@example.invalid']);
  git(dir, ['config', 'user.name', 'verifica']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  mkdirSync(join(dir, dirname(file)), { recursive: true });
  writeFileSync(join(dir, file), 'base\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'base']);
  git(dir, ['remote', 'add', 'origin', origine]);
  git(dir, ['push', '-q', 'origin', 'main']);
}

function ramoCon(dir, ramo, file, msg) {
  git(dir, ['checkout', '-q', '-b', ramo, 'main']);
  writeFileSync(join(dir, file), `${ramo}\n`);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', msg]);
  git(dir, ['push', '-q', 'origin', ramo]);
  git(dir, ['checkout', '-q', 'main']);
}

test('r1 nelle routine i lavori del server compaiono fra i rami e negli incroci del manutentore', () => {
  const tmp = cartellaTemporanea('filo-2340-server-routine-');
  try {
    const origineApp = join(tmp, 'app.git');
    const origineServer = join(tmp, 'server.git');
    git(tmp, ['init', '-q', '--bare', origineApp]);
    git(tmp, ['init', '-q', '--bare', origineServer]);
    const repo = join(tmp, 'Filo');
    repoCon(repo, origineApp, 'LEGGIMI.md');
    git(repo, ['fetch', '-q', 'origin']);
    for (const d of ['scripts', 'src', 'node_modules']) symlinkSync(join(APP_ROOT, d), join(repo, d), 'dir');

    // Il server: due lavori che toccano lo stesso file.
    const lavoro = join(tmp, 'lavoro-server');
    repoCon(lavoro, origineServer, 'functions/src/routine/manutentore.js');
    ramoCon(lavoro, SERVER_A, 'functions/src/routine/manutentore.js', 'lavoro uno (#7001)');
    ramoCon(lavoro, SERVER_B, 'functions/src/routine/manutentore.js', 'lavoro due (#7002)');

    // Il clone che la sessione cloud riceve: poco profondo, solo main (più il ramo della sessione), refspec di tutti i rami.
    const clone = join(tmp, 'filo-security');
    git(tmp, ['clone', '-q', '--depth', '1', '--single-branch', '--branch', 'main', pathToFileURL(origineServer).href, clone]);
    git(clone, ['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*']);

    const env = { ...process.env };
    delete env.FILO_SERVER_CLONE;
    const lancia = (cmd) => spawnSync(process.execPath, ['--preserve-symlinks', '--preserve-symlinks-main',
      join(repo, 'scripts', 'manutentore.mjs'), cmd, '--ticket', 'biglietto-della-routine', '--clone-server', clone,
    ], { cwd: repo, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });

    const rami = lancia('rami');
    expect(rami.status, rami.stderr).toBe(0);
    expect(rami.stdout, 'il primo lavoro del server').toContain(SERVER_A);
    expect(rami.stdout, 'il secondo lavoro del server').toContain(SERVER_B);

    const inc = lancia('incroci');
    expect(inc.status, inc.stderr).toBe(0);
    expect(inc.stdout, 'l’incrocio fra i due lavori del server, col file').toMatch(/filo-security:functions\/src\/routine\/manutentore\.js/);
  } finally {
    togliCartella(tmp);
  }
});
