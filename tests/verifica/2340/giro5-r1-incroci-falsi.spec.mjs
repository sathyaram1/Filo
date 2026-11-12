// Verifica #2340 giro 5: due lavori del server che toccano file diversi, ognuno con un riallineamento a mano che
// rifà una correzione già su main (poi fuso main, stesso contenuto), non devono risultare in incrocio sul file di main.
// Repo finti: scripts, src e node_modules sono collegamenti a quelli di Filo.

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ORA = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const SERVER_A = `worker/serverUnoAAAAAAAAAAAAAAA-${ORA}T000000Z`;
const SERVER_B = `worker/serverDueBBBBBBBBBBBBBBB-${ORA}T000000Z`;
const COMUNE = 'functions/src/l5/gates.js';

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function scrivi(dir, file, testo) {
  mkdirSync(join(dir, dirname(file)), { recursive: true });
  writeFileSync(join(dir, file), testo);
}

function commit(dir, msg) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', msg]);
}

function repoCon(dir, origine, file) {
  git(dirname(dir), ['init', '-q', dir]);
  git(dir, ['checkout', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'verifica@example.invalid']);
  git(dir, ['config', 'user.name', 'verifica']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  scrivi(dir, file, 'base\n');
  commit(dir, 'base');
  git(dir, ['remote', 'add', 'origin', origine]);
  git(dir, ['push', '-q', 'origin', 'main']);
}

test('r1 due lavori del server su file diversi, riallineati a mano su un file di main, non risultano in incrocio', () => {
  const tmp = cartellaTemporanea('filo-2340-incroci-falsi-');
  try {
    const origineApp = join(tmp, 'app.git');
    const origineServer = join(tmp, 'server.git');
    git(tmp, ['init', '-q', '--bare', origineApp]);
    git(tmp, ['init', '-q', '--bare', origineServer]);
    const repo = join(tmp, 'Filo');
    repoCon(repo, origineApp, 'LEGGIMI.md');
    git(repo, ['fetch', '-q', 'origin']);
    for (const d of ['scripts', 'src', 'node_modules']) symlinkSync(join(APP_ROOT, d), join(repo, d), 'dir');

    const srv = join(tmp, 'filo-security');
    repoCon(srv, origineServer, COMUNE);
    // Ogni lavoro tocca il suo file, e rifà a mano la correzione che main porta su COMUNE, poi fonde main.
    for (const [ramo, file] of [[SERVER_A, 'functions/src/uno.js'], [SERVER_B, 'functions/src/due.js']]) {
      git(srv, ['checkout', '-q', '-b', ramo, 'main']);
      scrivi(srv, file, `${ramo}\n`);
      commit(srv, `lavoro ${ramo}`);
      scrivi(srv, COMUNE, 'correzione di main\n');
      commit(srv, 'riallineamento: la correzione di main rifatta a mano');
      git(srv, ['checkout', '-q', 'main']);
    }
    scrivi(srv, COMUNE, 'correzione di main\n');
    commit(srv, 'main: la correzione');
    git(srv, ['push', '-q', 'origin', 'main']);
    for (const ramo of [SERVER_A, SERVER_B]) {
      git(srv, ['checkout', '-q', ramo]);
      git(srv, ['merge', '-q', '--no-edit', 'main']);
      git(srv, ['push', '-q', 'origin', ramo]);
    }
    git(srv, ['checkout', '-q', 'main']);
    git(srv, ['fetch', '-q', 'origin']);
    for (const ramo of [SERVER_A, SERVER_B]) {
      expect(git(srv, ['diff', '--name-only', `origin/main...origin/${ramo}`]), `${ramo} non cambia ${COMUNE}`).not.toContain(COMUNE);
    }

    const env = { ...process.env };
    delete env.FILO_SERVER_CLONE;
    const lancia = (cmd) => spawnSync(process.execPath, ['--preserve-symlinks', '--preserve-symlinks-main',
      join(repo, 'scripts', 'manutentore.mjs'), cmd, '--senza-fetch', '--clone-server', srv,
    ], { cwd: repo, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });

    const rami = lancia('rami');
    expect(rami.status, rami.stderr).toBe(0);
    expect(rami.stdout).toContain(SERVER_A);
    expect(rami.stdout).toContain(SERVER_B);
    expect(rami.stdout, 'un file che il lavoro non cambia rispetto a main non è fra i suoi').not.toContain(`filo-security:${COMUNE}`);

    const inc = lancia('incroci');
    expect(inc.status, inc.stderr).toBe(0);
    expect(inc.stdout, 'nessun incrocio fra due lavori che non hanno file in comune').not.toContain(`filo-security:${COMUNE}`);
  } finally {
    togliCartella(tmp);
  }
});
