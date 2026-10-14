// Giro 4, rilievo 2: la pubblicazione oraria delle regole prende main di Filo all'inizio della corsa e la guardia lo
// confronta con origin/main un minuto dopo. Una fusione su main di Filo in quel minuto non deve far finire rossa la corsa.
// Il passo «regole:pubblica» si legge da regole.yml e gira su un clone vero; firebase è finto. Non apre Filo.

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { ROOT, SERVER } from './aiuti-giro2.mjs';

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Il comando del passo che porta `name: <nome>` in un workflow del server. */
function passo(workflow, nome) {
  const testo = readFileSync(join(SERVER, '.github', 'workflows', workflow), 'utf8').replace(/\r\n/g, '\n');
  const p = testo.split(/\n(?=\s*- name:)/).find((x) => new RegExp(`- name:\\s*${nome}\\s*\\n`).test(x));
  if (!p) throw new Error(`${workflow}: manca il passo ${nome}`);
  return { run: /\n\s*run:\s*([^\n]+)/.exec(p)[1].trim(), cartella: (/\n\s*working-directory:\s*([^\n]+)/.exec(p) || [])[1] || '.' };
}

test.describe('r2 pubblicazione oraria delle regole', () => {
  test.skip(!SERVER, 'il worktree di filo-security accanto a questo non c’è');

  test('r2 una fusione su main di Filo durante la corsa non la fa finire rossa', async () => {
    const tmp = cartellaTemporanea('giro4-r2-');
    const origine = join(tmp, 'origine.git');
    const lavoro = join(tmp, 'lavoro');
    const corsa = join(tmp, 'filo');
    const bin = join(tmp, 'bin');
    git(tmp, 'init', '--bare', '-b', 'main', origine);
    git(tmp, 'clone', '-q', origine, lavoro);
    git(lavoro, 'config', 'user.email', 'v@example.invalid');
    git(lavoro, 'config', 'user.name', 'verifica');
    for (const rel of ['scripts/regole-pubblica.mjs', 'scripts/lib/argomenti.mjs', 'firebase.json', '.firebaserc', 'firestore.rules', 'firestore.indexes.json', 'storage.rules']) {
      mkdirSync(dirname(join(lavoro, rel)), { recursive: true });
      copyFileSync(join(ROOT, rel), join(lavoro, rel));
    }
    mkdirSync(join(lavoro, 'site', 'approvazioni'), { recursive: true });
    writeFileSync(join(lavoro, 'site', 'approvazioni', 'index.html'), '<!doctype html>\n');
    writeFileSync(join(lavoro, 'LEGGIMI.txt'), 'uno\n');
    git(lavoro, 'add', '-A');
    git(lavoro, 'commit', '-q', '-m', 'regole nuove');
    git(lavoro, 'push', '-q', 'origin', 'main');

    // Il passo «Main di Filo» della corsa: main com'è adesso.
    git(tmp, 'clone', '-q', '-b', 'main', origine, corsa);
    // Nel minuto dopo un altro lavoro arriva su main di Filo, senza toccare le regole.
    writeFileSync(join(lavoro, 'LEGGIMI.txt'), 'due\n');
    git(lavoro, 'commit', '-q', '-am', 'un altro lavoro');
    git(lavoro, 'push', '-q', 'origin', 'main');

    // firebase finto: registra la pubblicazione ed esce 0.
    mkdirSync(bin, { recursive: true });
    const segno = join(tmp, 'pubblicato.txt');
    writeFileSync(join(bin, 'firebase.cmd'), `@echo off\r\necho %* > "${segno}"\r\n`);
    writeFileSync(join(bin, 'firebase'), `#!/bin/sh\necho "$@" > "${segno}"\n`, { mode: 0o755 });

    const p = passo('regole.yml', 'regole:pubblica');
    const [cmd, ...args] = p.run.split(/\s+/);
    const r = spawnSync(cmd === 'node' ? process.execPath : cmd, args, {
      cwd: join(tmp, p.cartella), encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, GIT_TERMINAL_PROMPT: '0' },
    });
    expect(`${r.status} ${r.stderr}`.trim(), 'la corsa pubblica le regole fuse invece di fermarsi').toMatch(/^0\b/);
  });
});
