// La guardia del ramo attribuisce la chiamata al clone del worker (#1157).
// Scena e lancio dell'hook in tests/helpers/scenaHook.mjs; stanno fuori da autoCommitGate per il tetto di tempo per file.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HOOKS_DIR, git, scene, togliScene } from '../helpers/scenaHook.mjs';

test.after(togliScene);
describe('#1157 — la guardia del ramo attribuisce la chiamata al clone', () => {
  function guardia(work, stdin) {
    const ambiente = { ...process.env };
    return spawnSync('bash', [resolve(HOOKS_DIR, 'branch-guard.sh')], {
      cwd: work, encoding: 'utf8', input: stdin, env: { ...ambiente, CLAUDE_PROJECT_DIR: work },
    });
  }
  function scenaGuardia() {
    const { origin, work, base } = scene();
    const cloni = {};
    for (const nome of ['A', 'B']) {
      const dir = resolve(base, `lavoro ${nome}`);
      execFileSync('git', ['clone', '-q', origin, dir], { stdio: 'ignore' });
      git(dir, ['checkout', '-q', '-b', `worker/${nome}`]);
      mkdirSync(resolve(dir, '.claude'), { recursive: true });
      writeFileSync(resolve(dir, '.claude', 'branch-expect.json'), JSON.stringify({ branch: `worker/${nome}`, id: nome, root: dir }), 'utf8');
      cloni[nome] = dir;
    }
    // Il registro che scrive scripts/lib/clone-worker.mjs, dentro la .git del principale.
    const registro = resolve(work, '.git', 'filo-cloni');
    mkdirSync(registro, { recursive: true });
    writeFileSync(resolve(registro, '1'), `${cloni.A}\n`, 'utf8');
    writeFileSync(resolve(registro, '2'), `${cloni.B}\n`, 'utf8');
    // A deriva: e' finito su main.
    git(cloni.A, ['checkout', '-q', 'main']);
    return { work, ...cloni };
  }
  const bash = (comando) => JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: comando, description: 'x' } });

  test('la deriva in A blocca le chiamate attribuite ad A, non quelle di B', () => {
    const { work, A, B } = scenaGuardia();
    const editA = guardia(work, JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: resolve(A, 'README.md') } }));
    assert.equal(editA.status, 2, 'un Edit nel clone A che ha derivato si ferma');
    assert.match(editA.stderr, /worker\/A/);
    assert.equal(guardia(work, JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: resolve(B, 'README.md') } })).status, 0, 'un Edit in B passa');
    assert.equal(guardia(work, bash(`cd "${A.replace(/\\/g, '/')}" && npm test`)).status, 2, 'un comando che nomina A si ferma');
    assert.equal(guardia(work, bash(`git -C "${B.replace(/\\/g, '/')}" status`)).status, 0, 'uno che nomina B passa');
    assert.equal(guardia(work, bash('ls')).status, 0, 'uno che non nomina nessuno guarda il progetto, che non ha attese');
  });

  test('un comando che nomina tutti e due: una riga di avviso, nessun blocco', () => {
    const { work, A, B } = scenaGuardia();
    const r = guardia(work, bash(`diff -r "${A}" "${B}"`));
    assert.equal(r.status, 0);
    const ctx = JSON.parse(String(r.stdout).trim()).hookSpecificOutput.additionalContext;
    assert.equal(ctx.split('\n').length, 1, `una riga, trovato: «${ctx}»`);
    assert.match(ctx, /lavoro A/);
    assert.match(ctx, /worker\/A/);
    assert.doesNotMatch(ctx, /lavoro B/);
  });
});
