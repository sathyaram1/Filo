// Le prove degli agganci di salvataggio stanno in più file perché girino in parallelo (#1063): la scena comune
// e il racconto della regola sono in tests/helpers/scenaHook.mjs e in tests/unit/autoCommitGate.test.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ROOT, HOOKS, git, scene, runHook, runHookStderr, runHookRaw, rigaJson, LIMITE, shaOf, filesOnMain, commitFile,
} from '../helpers/scenaHook.mjs';

// ─── Giro 5 della verifica (16/09/2026): due rilievi messi da parte ──────────
//
// (1) Quando è il COMMIT a non riuscire (index.lock a terra, pre-commit che
// rifiuta) l'hook taceva: /dev/null su add e commit. (2) I guai delle ALTRE
// cartelle arrivavano con le parole di un problema tuo: dal #1157 l'hook non
// le guarda piu'.
describe('un commit che non riesce, e i guai delle altre cartelle, arrivano alla sessione', () => {
  const contesto = (r) => {
    const riga = rigaJson(r);
    assert.ok(riga, `il contesto deve arrivare alla sessione su stdout, trovato: «${r.stdout}» / stderr: «${r.stderr}»`);
    return JSON.parse(riga).hookSpecificOutput.additionalContext;
  };

  test('index.lock a terra: niente commit, e la sessione lo sa col motivo di git', () => {
    const { work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/lock']);
    writeFileSync(resolve(work, 'lavoro.js'), 'x\n', 'utf8');
    writeFileSync(resolve(work, '.git', 'index.lock'), '', 'utf8');
    const prima = git(work, ['rev-parse', 'HEAD']);
    const r = runHookRaw(work, JSON.stringify({ hook_event_name: 'PostToolUse', cwd: work }));
    assert.equal(r.status, 0, 'l\'hook non fallisce mai per contratto');
    assert.equal(git(work, ['rev-parse', 'HEAD']), prima, 'niente commit');
    const ctx = contesto(r);
    assert.match(ctx, /NON sono state committate/);
    assert.match(ctx, /index\.lock/, 'col motivo di git');
    assert.doesNotMatch(ctx, /committato in locale ma NON e' su origin/, 'non c\'e\' niente di committato da spedire');
    assert.doesNotMatch(ctx, /non la tua/, 'e\' la cartella della sessione');
  });

  test('pre-commit che rifiuta: niente commit, e la sessione legge il perche\' del rifiuto', () => {
    const { work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/precommit']);
    writeFileSync(resolve(work, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "rifiuto: manca la firma XYZ" >&2\nexit 1\n', 'utf8');
    chmodSync(resolve(work, '.git', 'hooks', 'pre-commit'), 0o755);
    writeFileSync(resolve(work, 'lavoro.js'), 'x\n', 'utf8');
    const prima = git(work, ['rev-parse', 'HEAD']);
    const r = runHookRaw(work, JSON.stringify({ hook_event_name: 'PostToolUse', cwd: work }));
    assert.equal(r.status, 0);
    assert.equal(git(work, ['rev-parse', 'HEAD']), prima, 'niente commit');
    const ctx = contesto(r);
    assert.match(ctx, /NON sono state committate/);
    assert.match(ctx, /manca la firma XYZ/, 'col testo del pre-commit');
    assert.doesNotMatch(ctx, /committato in locale ma NON e' su origin/);
  });

  test('una fusione a meta\' in un\'ALTRA cartella non si tocca e non si nomina; nella propria si dice come oggi', () => {
    const { work, base } = scene();
    git(work, ['config', 'core.autocrlf', 'false']);
    const altra = resolve(base, 'altra');
    git(work, ['worktree', 'add', '-q', altra, '-b', 'claude/altra']);
    commitFile(altra, 'a.txt', 'mio\n');
    commitFile(work, 'a.txt', 'loro\n');
    const m = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', 'main'], { cwd: altra, encoding: 'utf8' });
    assert.notEqual(m.status, 0, 'la fusione nell\'altra cartella si ferma sul conflitto');
    git(work, ['checkout', '-q', '-b', 'claude/mia']);
    writeFileSync(resolve(work, 'lavoro.js'), 'x\n', 'utf8');

    const r = runHookRaw(work, JSON.stringify({ hook_event_name: 'PostToolUse', cwd: work, tool_input: { file_path: resolve(work, 'lavoro.js') } }));
    assert.equal(r.status, 0);
    assert.equal(git(work, ['ls-remote', 'origin', 'refs/heads/claude/mia']).split(/\s/)[0], git(work, ['rev-parse', 'HEAD']), 'il proprio lavoro si salva e si spedisce');
    assert.equal(rigaJson(r), undefined, `niente da dire alla sessione, trovato: «${r.stdout}»`);
    assert.doesNotMatch(String(r.stderr), /altra/, 'l\'altra cartella non e\' nemmeno guardata');

    // Senza file, la sessione che sta in `altra`: lo stesso guaio e' suo, con le parole di oggi.
    const r2 = runHookRaw(work, JSON.stringify({ hook_event_name: 'PostToolUse', cwd: altra }));
    const ctx2 = contesto(r2);
    assert.match(ctx2, /a meta'/);
    assert.match(ctx2, /NON committo/);
  });

  test('senza file ne\' cwd nello stdin si salva solo la cartella del progetto, mai le altre', () => {
    const { work, base } = scene();
    const altra = resolve(base, 'altra');
    git(work, ['worktree', 'add', '-q', altra, '-b', 'claude/altra2']);
    writeFileSync(resolve(altra, 'sporco.txt'), 'x\n', 'utf8');
    git(work, ['checkout', '-q', '-b', 'claude/mia2']);
    writeFileSync(resolve(work, 'lavoro.js'), 'x\n', 'utf8');
    const r = runHookRaw(work, JSON.stringify({ hook_event_name: 'PostToolUse' }));
    assert.equal(r.status, 0);
    assert.equal(git(work, ['status', '--porcelain']), '', 'la cartella del progetto e\' salvata');
    assert.match(git(altra, ['status', '--porcelain']), /sporco\.txt/, 'l\'altra resta com\'era');
    assert.equal(git(work, ['ls-remote', 'origin', 'refs/heads/claude/altra2']), '', 'e il suo ramo non parte');
  });
});
