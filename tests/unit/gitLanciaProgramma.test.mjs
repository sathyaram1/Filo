// #2618: le opzioni con cui git lancia un programma scritto nel comando valgono 3, come il codice arbitrario.
// La prova con git vero tiene la premessa: se git esegue il programma, il classificatore non può dire meno di 3.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
require('../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;
const lvl = (cmd) => C.classify(cmd);

test('#2618 — git che lancia un programma scritto nel comando vale 3, anche accorciato o in un gruppo di lettere', () => {
  for (const cmd of [
    'git push --receive-pack=x .', 'git push --receive-pack x .', 'git push --exec=x .', 'git push --e=x .', 'git push --rece=x .',
    'git push origin main --exec=x', 'git push "--receive-pack=x" .', 'git push --RECEIVE-PACK=x .', 'git push --e\\xec=x .',
    'git fetch --upload-pack=x .', 'git fetch --upl=x .', 'git fetch --upload-pack x .', 'git pull --upload-pack=x .', 'git pull --upl x .',
    'git ls-remote --upload-pack=x .', 'git ls-remote --exec=x .', 'git archive --exec=x --remote=. HEAD',
    'git clone -u x . copia', 'git clone -qu x . copia', 'git clone --upload-pack=x . copia', 'git clone --upl=x . copia',
    'git clone -c core.sshCommand=x ssh://h/r', 'git clone -qc core.sshCommand=x ssh://h/r', 'git clone --config core.fsmonitor=x .',
    'git clone --conf=core.sshCommand=x ssh://h/r', 'git clone ssh://h/r -c core.sshCommand=x', 'git clone --template=/tmp/t .',
    'git init --template=/tmp/t', 'git init --temp /tmp/t',
    'git rebase -x "make test" main', 'git rebase --exec=x main', 'git rebase --ex x main', 'git rebase -ix x main', 'git rebase -rx x main',
    'git submodule foreach "rm -rf ~"', 'git submodule --quiet foreach x', 'git submodule fore\\ach x',
    'cd .. && git fetch --upload-pack=x .', 'git status && git push --receive-pack=x .',
  ]) assert.equal(lvl(cmd), 3, `"${cmd}" lancia un programma scritto nel comando`);
  // Le forme di tutti i giorni restano dove stavano: anche quelle con lettere o nomi vicini.
  for (const cmd of [
    'git push', 'git push -u origin feature', 'git push --set-upstream origin x', 'git push --no-verify origin main', 'git push --tags',
    'git fetch', 'git fetch -u origin', 'git fetch --update-shallow', 'git pull', 'git pull --rebase', 'git pull -X ours',
    'git clone https://github.com/a/b.git', 'git clone -b main --depth 1 https://github.com/a/b.git', 'git clone -o up -j8 . copia',
    'git clone -bu . copia', 'git init', 'git init -b main', 'git rebase main', 'git rebase -i HEAD~3', 'git rebase -Xours main',
    'git rebase -Sx main', 'git rebase --no-exec main', 'git rebase --reschedule-failed-exec main', 'git rebase --empty=drop main',
    'git submodule update --init', 'git submodule add https://github.com/a/b.git b', 'git commit -m "--exec=x"',
  ]) assert.equal(lvl(cmd), 2, `"${cmd}" resta una scrittura che si rimedia`);
});

const git = (cwd, args, env = {}) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });

test('#2618 — git esegue davvero il programma di queste opzioni, e il classificatore le dà 3', (t) => {
  if (git(process.cwd(), ['--version']).status !== 0) return t.skip('git non c\'è');
  const casa = cartellaTemporanea('filo-git-lancia-');
  t.after(() => togliCartella(casa));
  const repo = join(casa, 'repo');
  const marca = join(casa, 'eseguito');
  const script = join(casa, 'programma.cjs');
  writeFileSync(script, "require('fs').writeFileSync(process.env.FILO_MARCA_2618, 'x'); process.exit(1);\n");
  const barre = (p) => p.replace(/\\/g, '/');
  const programma = `"${barre(process.execPath)}" "${barre(script)}"`;
  const env = { FILO_MARCA_2618: marca, GIT_TERMINAL_PROMPT: '0' };
  assert.equal(git(casa, ['init', '-q', repo]).status, 0);
  assert.equal(git(repo, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x']).status, 0);
  for (const args of [
    ['fetch', `--upl=${programma}`, '.'],
    ['pull', `--upload-pack=${programma}`, '.'],
    ['push', `--e=${programma}`, '.', 'HEAD:refs/heads/prova'],
    ['push', `--receive-pack=${programma}`, '.', 'HEAD:refs/heads/prova'],
    ['clone', '-qu', programma, repo, join(casa, 'copia')],
  ]) {
    rmSync(marca, { force: true });
    git(repo, args, env);
    assert.ok(existsSync(marca), `git ${args[0]} ${args[1]} avrebbe dovuto eseguire il programma`);
    assert.equal(lvl(['git', ...args].join(' ')), 3, `git ${args[0]} ${args[1]}`);
  }
});
