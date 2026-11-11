// Verifica #2340 giro 1: «manutentore rami» letto attraverso una pipe (| grep, | tail) con più di 64 KB di rami
// deve portare lo stesso, in coda, l'avviso del clone del server mancante. Il comando vero gira su un repo finto:
// scripts, src e node_modules sono collegamenti a quelli di Filo, e --preserve-symlinks tiene la radice nel repo finto.

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RAMO = 'worker/lungo-20261111T000000Z';

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('r1 rami in una pipe: con più di 64 KB di rami l’avviso del clone del server mancante arriva lo stesso', () => {
  const tmp = cartellaTemporanea('filo-2340-pipe-');
  try {
    const origine = join(tmp, 'origine.git');
    const repo = join(tmp, 'Filo');
    git(tmp, ['init', '-q', '--bare', origine]);
    git(tmp, ['init', '-q', repo]);
    git(repo, ['checkout', '-q', '-b', 'main']);
    git(repo, ['config', 'user.email', 'verifica@example.invalid']);
    git(repo, ['config', 'user.name', 'verifica']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    writeFileSync(join(repo, 'LEGGIMI.md'), 'base\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'base']);
    git(repo, ['remote', 'add', 'origin', origine]);
    git(repo, ['push', '-q', 'origin', 'main']);
    git(repo, ['checkout', '-q', '-b', RAMO]);
    const cartella = join(repo, 'f');
    mkdirSync(cartella);
    for (let i = 0; i < 700; i += 1) writeFileSync(join(cartella, `${'un-nome-di-file-molto-lungo-'.repeat(4)}${i}.txt`), `${i}\n`);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'tanti file (#1)']);
    git(repo, ['push', '-q', 'origin', RAMO]);
    git(repo, ['checkout', '-q', 'main']);
    git(repo, ['fetch', '-q', 'origin']);
    for (const d of ['scripts', 'src', 'node_modules']) symlinkSync(join(APP_ROOT, d), join(repo, d), 'dir');

    const env = { ...process.env };
    delete env.FILO_SERVER_CLONE;
    // Una pipe della shell, come `npm run manutentore -- rami | grep …`: quella di spawnSync è un socket più capiente.
    const r = spawnSync('sh', ['-c', '"$@" | cat', 'sh', process.execPath,
      '--preserve-symlinks', '--preserve-symlinks-main', join(repo, 'scripts', 'manutentore.mjs'),
      'rami', '--senza-fetch', '--clone-server', join(tmp, 'manca'),
    ], { cwd: repo, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024, timeout: 60_000 });

    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.length, 'l’elenco supera i 64 KB di una pipe').toBeGreaterThan(64 * 1024);
    expect(r.stdout, 'il ramo lungo c’è').toContain(RAMO);
    expect(r.stdout.slice(-400), 'la coda dell’uscita').toContain('Rami del server NON letti');
  } finally {
    togliCartella(tmp);
  }
});
