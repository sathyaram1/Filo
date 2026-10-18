// Il salvataggio automatico ai confini del progetto (#1157): altri repo, file fuori, percorsi di Windows, ramo principale del clone.
// Scena e lancio dell'hook in tests/helpers/scenaHook.mjs; stanno fuori da autoCommitGate per il tetto di tempo per file.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { clone, git, remoto, runHookRaw, scene, stdinEdit, togliScene } from '../helpers/scenaHook.mjs';

test.after(togliScene);
describe('#1157 — si salva solo la cartella di chi ha modificato', () => {
  test('un file di un repo con un altro origin, o fuori da ogni repo: li\' niente, si salva la cartella della sessione e basta', () => {
    const { work, base } = scene();
    const altroOrigin = resolve(base, 'server.git');
    mkdirSync(altroOrigin);
    git(altroOrigin, ['init', '--bare', '-q', '--initial-branch=main']);
    const server = resolve(base, 'server');
    execFileSync('git', ['clone', '-q', altroOrigin, server], { stdio: 'ignore' });
    git(server, ['checkout', '-q', '-b', 'claude/server']);
    writeFileSync(resolve(server, 'index.js'), 'x\n', 'utf8');
    const altra = resolve(base, 'altra');
    git(work, ['worktree', 'add', '-q', altra, '-b', 'claude/altra']);
    writeFileSync(resolve(altra, 'suo.txt'), 'x\n', 'utf8');
    git(work, ['checkout', '-q', '-b', 'claude/mia']);
    writeFileSync(resolve(work, 'mio.txt'), 'x\n', 'utf8');
    const fuori = resolve(base, 'appunti', 'nota.md');
    mkdirSync(dirname(fuori), { recursive: true });
    writeFileSync(fuori, 'x\n', 'utf8');

    for (const file of [resolve(server, 'index.js'), fuori]) {
      const r = runHookRaw(work, stdinEdit(file, { cwd: work }));
      assert.equal(r.status, 0);
      assert.match(git(server, ['status', '--porcelain']), /index\.js/, 'il repo con un altro origin resta a mano');
      assert.equal(git(server, ['rev-list', '--all', '--count']), '0', 'nessun commit li\'');
      assert.equal(git(work, ['status', '--porcelain']), '', 'la cartella della sessione si salva');
      assert.match(git(altra, ['status', '--porcelain']), /suo\.txt/, 'le altre no');
    }
  });

  test('percorso di Windows con le barre raddoppiate e uno spazio, e notebook_path', () => {
    const { origin, work, base } = scene();
    const a = clone(origin, base, 'con spazio', 'claude/spazio');
    writeFileSync(resolve(a, 'nb.ipynb'), '{}\n', 'utf8');
    // JSON.stringify raddoppia le barre rovesciate dei percorsi di Windows, come Claude Code.
    const r = runHookRaw(work, JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'NotebookEdit', tool_input: { notebook_path: resolve(a, 'nb.ipynb'), new_source: 'x' } }));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(git(a, ['status', '--porcelain']), '', 'il clone con lo spazio nel nome e\' salvato');
    assert.equal(remoto(a, 'claude/spazio'), git(a, ['rev-parse', 'HEAD']));
  });

  test('un clone sul suo ramo principale si astiene: il ramo dichiarato si legge nel repo del clone', () => {
    const { origin, work, base } = scene();
    // Il remoto dichiara `sviluppo` come principale; il progetto non lo sa, il clone si'.
    git(work, ['push', '-q', 'origin', 'main:sviluppo']);
    git(origin, ['symbolic-ref', 'HEAD', 'refs/heads/sviluppo']);
    const a = clone(origin, base, 'clone-a');
    assert.equal(git(a, ['rev-parse', '--abbrev-ref', 'HEAD']), 'sviluppo', 'premessa');
    writeFileSync(resolve(a, 'lavoro.js'), 'x\n', 'utf8');
    const prima = git(a, ['rev-parse', 'HEAD']);
    const r = runHookRaw(work, stdinEdit(resolve(a, 'lavoro.js')));
    assert.equal(git(a, ['rev-parse', 'HEAD']), prima, 'niente commit sul ramo principale del clone');
    assert.match(git(a, ['status', '--porcelain']), /lavoro\.js/, 'le modifiche restano');
    assert.match(String(r.stderr), /ramo principale \('sviluppo'\)/);
  });});
