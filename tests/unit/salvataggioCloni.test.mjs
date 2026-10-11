// Il salvataggio automatico salva solo la cartella di chi ha modificato (#1157): clone, worktree, due insieme, battito.
// Scena e lancio dell'hook in tests/helpers/scenaHook.mjs; stanno fuori da autoCommitGate per il tetto di tempo per file.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { clone, git, remoto, runHookAsync, runHookRaw, scene, stdinEdit, togliScene } from '../helpers/scenaHook.mjs';
import { aspettaChe } from '../helpers/attese.mjs';

test.after(togliScene);
describe('#1157 — si salva solo la cartella di chi ha modificato', () => {
  test('il caso di oggi resta identico: una sessione, una cartella, salvata e spedita, stdout vuoto', () => {
    for (const stdin of [stdinEdit('§'), JSON.stringify({ hook_event_name: 'PostToolUse' }), '']) {
      const { work } = scene();
      git(work, ['checkout', '-q', '-b', 'claude/oggi']);
      writeFileSync(resolve(work, 'lavoro.js'), 'x\n', 'utf8');
      const r = runHookRaw(work, stdin.replace('§', resolve(work, 'lavoro.js').replace(/\\/g, '\\\\')));
      assert.equal(r.status, 0);
      assert.equal(git(work, ['status', '--porcelain']), '', `salvata (stdin: ${stdin.slice(0, 40)})`);
      assert.equal(remoto(work, 'claude/oggi'), git(work, ['rev-parse', 'HEAD']), 'e spedita');
      assert.equal(String(r.stdout).trim(), '', 'niente contesto quando tutto e\' arrivato');
    }
  });

  test('Edit in un clone fuori dalle worktree: il clone si salva e si spedisce, un secondo clone sporco no', () => {
    const { origin, work, base } = scene();
    const a = clone(origin, base, 'clone-a', 'claude/a');
    const b = clone(origin, base, 'clone-b', 'claude/b');
    writeFileSync(resolve(a, 'lavoro.js'), 'a\n', 'utf8');
    writeFileSync(resolve(b, 'lavoro.js'), 'b\n', 'utf8');
    const r = runHookRaw(work, stdinEdit(resolve(a, 'lavoro.js'), { cwd: work }));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(git(a, ['status', '--porcelain']), '', 'il clone di chi ha modificato e\' committato');
    assert.equal(remoto(a, 'claude/a'), git(a, ['rev-parse', 'HEAD']), 'e spedito sul suo ramo');
    assert.match(git(b, ['status', '--porcelain']), /lavoro\.js/, 'l\'altro clone resta sporco');
    assert.equal(remoto(b, 'claude/b'), '', 'e il suo ramo non parte');
  });

  test('due worktree: un Edit nella prima non tocca la seconda', () => {
    const { work, base } = scene();
    const altra = resolve(base, 'altra');
    git(work, ['worktree', 'add', '-q', altra, '-b', 'claude/altra']);
    writeFileSync(resolve(altra, 'suo.txt'), 'x\n', 'utf8');
    git(work, ['checkout', '-q', '-b', 'claude/mia']);
    writeFileSync(resolve(work, 'mio.txt'), 'x\n', 'utf8');
    const prima = git(altra, ['rev-parse', 'HEAD']);
    const r = runHookRaw(work, stdinEdit(resolve(work, 'mio.txt'), { cwd: work }));
    assert.equal(git(work, ['status', '--porcelain']), '');
    assert.equal(git(altra, ['rev-parse', 'HEAD']), prima, 'niente commit nella seconda');
    assert.match(git(altra, ['status', '--porcelain']), /suo\.txt/);
    assert.doesNotMatch(String(r.stdout) + String(r.stderr), /altra/, 'e nessuna riga su di lei');
  });

  test('due salvataggi insieme su due clone: tutti e due salvati, nessun index.lock', async () => {
    const { origin, work, base } = scene();
    const a = clone(origin, base, 'clone-a', 'claude/a');
    const b = clone(origin, base, 'clone-b', 'claude/b');
    for (let i = 0; i < 2; i += 1) {
      writeFileSync(resolve(a, 'lavoro.js'), `a${i}\n`, 'utf8');
      writeFileSync(resolve(b, 'lavoro.js'), `b${i}\n`, 'utf8');
      const [ra, rb] = await Promise.all([
        runHookAsync(work, stdinEdit(resolve(a, 'lavoro.js'))),
        runHookAsync(work, stdinEdit(resolve(b, 'lavoro.js'))),
      ]);
      for (const [r, dir, ramo] of [[ra, a, 'claude/a'], [rb, b, 'claude/b']]) {
        assert.equal(r.status, 0);
        assert.doesNotMatch(r.stdout + r.stderr, /index\.lock/, 'nessuna contesa sui lock');
        assert.equal(git(dir, ['status', '--porcelain']), '', `${ramo} salvato`);
        assert.equal(remoto(dir, ramo), git(dir, ['rev-parse', 'HEAD']), `${ramo} spedito`);
      }
    }
  });

  test('il battito parte dal biglietto del clone del file, con transcript e sessione dello stdin', async () => {
    const { origin, work, base } = scene();
    const a = clone(origin, base, 'clone-a', 'claude/a');
    mkdirSync(resolve(a, '.claude'), { recursive: true });
    mkdirSync(resolve(a, 'scripts'), { recursive: true });
    writeFileSync(resolve(a, '.claude', 'routine-ticket.json'), '{"ticket":"t-a"}\n', 'utf8');
    const esito = resolve(base, 'battito.json');
    writeFileSync(resolve(a, 'scripts', 'routine-channel.mjs'),
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(esito)}, JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2), root: process.env.FILO_REPO_ROOT, transcript: process.env.FILO_TRANSCRIPT, sessione: process.env.FILO_SESSION_ID }));\n`, 'utf8');
    writeFileSync(resolve(a, 'lavoro.js'), 'x\n', 'utf8');
    const transcript = resolve(base, 'sessioni', 'abc.jsonl');
    const r = runHookRaw(work, stdinEdit(resolve(a, 'lavoro.js'), { session_id: 'sess-1157', transcript_path: transcript, cwd: work }));
    assert.equal(r.status, 0);
    let letto = null;
    await aspettaChe(() => {
      try { letto = JSON.parse(readFileSync(esito, 'utf8')); } catch (_) { /* non ancora scritto */ }
      return letto;
    }, { cosa: 'il battito del clone non e\' partito', ogniMs: 250 });
    const norm = (p) => resolve(String(p)).toLowerCase();
    assert.equal(norm(letto.cwd), norm(a), 'dalla cartella del clone');
    assert.equal(norm(letto.root), norm(a));
    assert.deepEqual(letto.argv, ['heartbeat']);
    assert.equal(norm(letto.transcript), norm(transcript));
    assert.equal(letto.sessione, 'sess-1157');
  });
});
