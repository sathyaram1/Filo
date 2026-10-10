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
// rifiuta) l'hook taceva: /dev/null su add e commit. (2) L'hook gira su tutte
// le cartelle di lavoro e diceva i guai delle ALTRE con le parole di un
// problema tuo: la sessione andava a finire il rebase di qualcun altro.
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

  test('una fusione a meta\' in un\'ALTRA cartella si dice come altrui, in una riga, senza ordini; nella propria come oggi', () => {
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

    // La sessione sta in `work`: il guaio di `altra` e' altrui.
    const r = runHookRaw(work, JSON.stringify({ hook_event_name: 'PostToolUse', cwd: work }));
    assert.equal(r.status, 0);
    assert.equal(shaOf(work, 'claude/mia'), git(work, ['rev-parse', 'HEAD']));
    assert.equal(git(work, ['ls-remote', 'origin', 'refs/heads/claude/mia']).split(/\s/)[0], git(work, ['rev-parse', 'HEAD']), 'il proprio lavoro si salva e si spedisce');
    const ctx = contesto(r);
    const righe = ctx.split('\n').filter((l) => /altra/.test(l));
    assert.equal(righe.length, 1, `un guaio altrui e' UNA riga, trovato: «${ctx}»`);
    assert.match(righe[0], /un'altra cartella di lavoro, non la tua: '.*altra'/);
    assert.match(righe[0], /a meta'/);
    assert.doesNotMatch(ctx, /Finiscilo|NON committo/, 'mai come ordini, mai come un problema tuo');
    assert.doesNotMatch(ctx, /committato in locale ma NON e' su origin/, 'la coda che dice di spedire riguarda solo la propria cartella');

    // La sessione sta in `altra`: lo stesso guaio e' suo, con le parole di oggi.
    const r2 = runHookRaw(work, JSON.stringify({ hook_event_name: 'PostToolUse', cwd: altra }));
    const ctx2 = contesto(r2);
    assert.match(ctx2, /a meta'/);
    assert.match(ctx2, /NON committo/);
    assert.doesNotMatch(ctx2, /non la tua/);
  });

  test('senza il campo cwd nello stdin ogni cartella e\' «tua», com\'era prima', () => {
    const { work, base } = scene();
    git(work, ['config', 'core.autocrlf', 'false']);
    const altra = resolve(base, 'altra');
    git(work, ['worktree', 'add', '-q', altra, '-b', 'claude/altra2']);
    commitFile(altra, 'a.txt', 'mio\n');
    commitFile(work, 'a.txt', 'loro\n');
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', 'main'], { cwd: altra, encoding: 'utf8' });
    const r = runHookRaw(work, JSON.stringify({ hook_event_name: 'PostToolUse' }));
    const ctx = contesto(r);
    assert.match(ctx, /non la tua: '.*altra'/);
    assert.doesNotMatch(ctx, /NON committo/);
  });
});
