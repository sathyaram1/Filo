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

// ─── Nel mezzo di un conflitto l'hook si astiene ─────────────────────────────
//
// Giro del 14/09/2026, terza verifica: un rebase (o una fusione) fermo su un
// conflitto, l'agente risolve UN file con un Edit, l'hook riparte e `git add
// -A` mette in commit anche i file ancora in conflitto, coi segni <<<<<<<
// dentro. Nel rebase spariva il commit che si stava riportando; nella fusione
// il commit rotto arrivava su origin. Ora l'hook non tocca niente finché
// l'operazione è a metà.

const SEGNI = /^<{7}|^={7}$|^>{7}/m;

/** Un ramo di lavoro spedito su origin e main che diverge sugli stessi due file. */
function sceneConflitto() {
  const { work, origin } = scene();
  git(work, ['config', 'core.autocrlf', 'false']);
  git(work, ['checkout', '-q', '-b', 'claude/prova']);
  writeFileSync(resolve(work, 'a.txt'), 'mio\n', 'utf8');
  writeFileSync(resolve(work, 'b.txt'), 'mio\n', 'utf8');
  git(work, ['add', '-A']);
  git(work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'mio']);
  git(work, ['push', '-q', '-u', 'origin', 'claude/prova']);
  git(work, ['checkout', '-q', 'main']);
  writeFileSync(resolve(work, 'a.txt'), 'loro\n', 'utf8');
  writeFileSync(resolve(work, 'b.txt'), 'loro\n', 'utf8');
  git(work, ['add', '-A']);
  git(work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'loro']);
  git(work, ['checkout', '-q', 'claude/prova']);
  return { work, origin };
}

describe('nel mezzo di un conflitto l\'hook si astiene', () => {
  test('rebase fermo su un conflitto: niente commit coi segni, il rebase resta a metà e il commit riportato conserva il suo nome', () => {
    const { work } = sceneConflitto();
    const reb = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'rebase', 'main'], { cwd: work, encoding: 'utf8' });
    assert.notEqual(reb.status, 0, 'il rebase deve fermarsi sul conflitto');
    const prima = shaOf(work, 'HEAD');
    writeFileSync(resolve(work, 'a.txt'), 'risolto\n', 'utf8');
    runHook(work);
    assert.equal(shaOf(work, 'HEAD'), prima, 'durante il rebase l\'hook non deve committare');
    assert.ok(git(work, ['ls-files', '-u']).includes('b.txt'), 'b.txt è ancora in conflitto, come deve');
    // Chi ha iniziato il rebase lo finisce, e il commit arriva col suo nome.
    writeFileSync(resolve(work, 'b.txt'), 'risolto\n', 'utf8');
    git(work, ['add', '-A']);
    const cont = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'rebase', '--continue'], { cwd: work, encoding: 'utf8', env: { ...process.env, GIT_EDITOR: 'true' } });
    assert.equal(cont.status, 0, cont.stderr);
    assert.equal(git(work, ['log', '--format=%s', '-1']), 'mio');
    assert.doesNotMatch(git(work, ['show', 'HEAD:b.txt']), SEGNI);
  });

  test('fusione ferma su due conflitti: dopo l\'Edit sul primo file la fusione resta aperta e su origin non arriva niente', () => {
    const { work, origin } = sceneConflitto();
    const m = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', 'main'], { cwd: work, encoding: 'utf8' });
    assert.notEqual(m.status, 0, 'la fusione deve fermarsi sul conflitto');
    const prima = shaOf(work, 'HEAD');
    const suOriginPrima = git(origin, ['rev-parse', 'claude/prova']);
    writeFileSync(resolve(work, 'a.txt'), 'risolto\n', 'utf8');
    runHook(work);
    assert.equal(shaOf(work, 'HEAD'), prima, 'durante la fusione l\'hook non deve committare');
    assert.ok(git(work, ['rev-parse', '--verify', '-q', 'MERGE_HEAD']), 'la fusione deve restare aperta');
    assert.equal(git(origin, ['rev-parse', 'claude/prova']), suOriginPrima, 'su origin non deve arrivare niente');
    assert.doesNotMatch(git(origin, ['show', 'claude/prova:b.txt']), SEGNI);
  });
});

// ─── Giro 4 della verifica (16/09/2026): il no del remoto e l'astensione ────
//
// Due cose che la sessione deve sentire, e un JSON che deve restare leggibile
// qualunque cosa scriva il remoto.
describe('il no del server remoto e l\'astensione arrivano alla sessione, in un JSON che si legge', () => {

  /** Da qui in poi origin rifiuta ogni push, con un messaggio che finisce in ritorno carrello e porta virgolette e tab. */
  function originRifiuta(origin) {
    const f = resolve(origin, 'hooks', 'pre-receive');
    writeFileSync(f, '#!/bin/sh\nprintf "GH013: push declined due to repository rule violations\\r\\nsecondo \\"motivo\\" con\\ttab\\n" >&2\nexit 1\n', 'utf8');
    chmodSync(f, 0o755);
  }

  test('un ritorno carrello nel messaggio del remoto non rompe il JSON: il contesto arriva, col messaggio', () => {
    const { origin, work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/regola']);
    originRifiuta(origin);
    // Piu' corse: git lascia passare il ritorno carrello a seconda di come
    // spezza i pacchetti del remoto, e la porta si apriva una volta su poche.
    for (let i = 0; i < 3; i += 1) {
      writeFileSync(resolve(work, 'lavoro.js'), `x${i}\n`, 'utf8');
      const r = runHookRaw(work, JSON.stringify({ hook_event_name: 'PostToolUse' }));
      assert.equal(r.status, 0);
      const riga = rigaJson(r);
      assert.ok(riga, `una riga JSON su stdout, trovato: «${r.stdout}»`);
      let json;
      assert.doesNotThrow(() => { json = JSON.parse(riga); }, 'il contesto deve restare un JSON valido anche con caratteri di controllo nel messaggio di git');
      const ctx = json.hookSpecificOutput.additionalContext;
      assert.doesNotMatch(ctx, /[\x00-\x08\x0b-\x1f]/, 'nessun carattere di controllo nella stringa');
      assert.match(ctx, /GH013/);
      assert.match(ctx, /secondo "motivo"/);
      assert.match(ctx, /committato in locale ma NON e' su origin/, 'la coda che dice di spedire resta');
    }
  });

  test('un rifiuto del remoto per una regola non e\' «storia divergente»: si dice per quello che e\', senza consigliare un rebase', () => {
    const { origin, work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/regola-2']);
    originRifiuta(origin);
    writeFileSync(resolve(work, 'lavoro.js'), 'x\n', 'utf8');
    const r = runHookRaw(work, '');
    const ctx = JSON.parse(rigaJson(r)).hookSpecificOutput.additionalContext;
    assert.match(ctx, /server remoto ha RIFIUTATO/, 'la diagnosi giusta');
    assert.doesNotMatch(ctx, /Storia divergente|qualcun altro ha spinto/i, 'non e\' storia divergente e un rebase non lo cura');
    assert.match(ctx, /GH013/, 'col motivo del remoto');
    assert.doesNotMatch(String(r.stderr || ''), /force-with-lease/, 'il lease non si tenta: il remoto direbbe di no lo stesso');
  });

  test('a meta\' di una fusione l\'astensione arriva alla sessione, senza la coda che dice di spedire', () => {
    const { work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/conflitto']);
    commitFile(work, 'a.txt', 'mio\n');
    git(work, ['checkout', '-q', 'main']);
    commitFile(work, 'a.txt', 'loro\n');
    git(work, ['checkout', '-q', 'claude/conflitto']);
    const m = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', 'main'], { cwd: work, encoding: 'utf8' });
    assert.match(String(m.stdout) + String(m.stderr), /CONFLICT/, 'la fusione deve fermarsi su un conflitto vero');
    assert.notEqual(m.status, 0, 'la fusione si ferma sul conflitto');
    writeFileSync(resolve(work, 'a.txt'), 'risolto\n', 'utf8');
    const prima = git(work, ['rev-parse', 'HEAD']);
    const r = runHookRaw(work, JSON.stringify({ hook_event_name: 'PostToolUse' }));
    assert.equal(r.status, 0);
    assert.equal(git(work, ['rev-parse', 'HEAD']), prima, 'niente commit a meta\' fusione');
    const riga = rigaJson(r);
    assert.ok(riga, `l'astensione deve arrivare alla sessione su stdout, trovato: «${r.stdout}»`);
    const ctx = JSON.parse(riga).hookSpecificOutput.additionalContext;
    assert.match(ctx, /a meta'/, 'dice che c\'e\' un rebase o una fusione a meta\'');
    assert.match(ctx, /NON committo/);
    assert.doesNotMatch(ctx, /committato in locale ma NON e' su origin/, 'qui non c\'e\' niente di committato da spedire');
  });
});
