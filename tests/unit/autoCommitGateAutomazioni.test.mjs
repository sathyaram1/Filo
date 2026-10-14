// Il salvataggio non spedisce un ramo i cui commit nuovi cambiano un'automazione (#1140): un ramo spinto con un file
// nuovo in .github/workflows lo fa girare subito, senza fusione. Regola e credenziali:
// patterns/le-automazioni-le-spinge-solo-l-owner-a-mano.md. Scena comune in tests/helpers/scenaHook.mjs.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  git, scene, togliScene, runHookRaw, rigaJson, stdinEdit, clone, remoto, shaOf, commitFile,
} from '../helpers/scenaHook.mjs';

after(togliScene);

function scriviAutomazione(dir, nome, testo = 'on: push\n') {
  mkdirSync(resolve(dir, '.github', 'workflows'), { recursive: true });
  const f = resolve(dir, '.github', 'workflows', nome);
  writeFileSync(f, testo, 'utf8');
  return f;
}

function contesto(r) {
  const riga = rigaJson(r);
  return riga ? JSON.parse(riga).hookSpecificOutput.additionalContext : '';
}

/** main riceve un'automazione dall'owner mentre il ramo di lavoro è già su origin; poi il ramo si riallinea a main. */
function ramoRiallineatoAMain(nomeRamo) {
  const { base, origin, work } = scene();
  git(work, ['checkout', '-q', '-b', nomeRamo]);
  commitFile(work, 'a.js');
  git(work, ['push', '-q', 'origin', nomeRamo]);
  const owner = clone(origin, base, 'owner');
  scriviAutomazione(owner, 'ci.yml');
  git(owner, ['add', '-A']);
  git(owner, ['-c', 'user.email=o@o', '-c', 'user.name=o', 'commit', '-q', '-m', 'automazione dell\'owner']);
  git(owner, ['push', '-q', 'origin', 'main']);
  git(work, ['fetch', '-q', 'origin']);
  git(work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', '-q', '--no-edit', 'origin/main']);
  return { base, origin, work };
}

describe('un\'automazione nei commit da spedire ferma il ramo', () => {
  test('routine: il ramo resta in locale, e la sessione sa che il lavoro va ai lavori locali', () => {
    const { work } = scene();
    git(work, ['checkout', '-q', '-b', 'worker/automazione']);
    const f = scriviAutomazione(work, 'nuova.yml');

    const r = runHookRaw(work, stdinEdit(f), { FILO_ROUTINE: '1' });

    assert.match(git(work, ['log', '-1', '--format=%s']), /^auto: /, 'il lavoro è committato: il paracadute resta');
    assert.equal(remoto(work, 'worker/automazione'), '', 'un ramo con un\'automazione nuova non deve arrivare su origin');
    const ctx = contesto(r);
    assert.match(ctx, /le automazioni le spinge solo l'owner/);
    assert.match(ctx, /\.github\/workflows\/nuova\.yml/);
    assert.match(ctx, /--reason locale/);
    assert.doesNotMatch(ctx, /git push del ramo/, 'non si consiglia di spingerlo a mano');
  });

  test('una modifica dopo, a un file qualsiasi, non fa partire il ramo finché l\'automazione è nella sua storia', () => {
    const { work } = scene();
    git(work, ['checkout', '-q', '-b', 'worker/dopo']);
    runHookRaw(work, stdinEdit(scriviAutomazione(work, 'x.yml')), { FILO_ROUTINE: '1' });
    writeFileSync(resolve(work, 'b.js'), 'altro\n', 'utf8');

    runHookRaw(work, stdinEdit(resolve(work, 'b.js')), { FILO_ROUTINE: '1' });

    assert.equal(remoto(work, 'worker/dopo'), '');
  });

  test('locale: il salvataggio non la spinge, e dice che la spinge l\'owner a mano', () => {
    const { work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/automazione']);
    const f = scriviAutomazione(work, 'suite.yml');

    const r = runHookRaw(work, stdinEdit(f));

    assert.equal(remoto(work, 'claude/automazione'), '');
    const ctx = contesto(r);
    assert.match(ctx, /La spinge l'owner a mano/);
    assert.match(ctx, /patterns\/le-automazioni-le-spinge-solo-l-owner-a-mano\.md/);
  });

  test('anche togliere un\'automazione conta', () => {
    const { base, origin, work } = scene();
    const owner = clone(origin, base, 'owner');
    scriviAutomazione(owner, 'vecchia.yml');
    git(owner, ['add', '-A']);
    git(owner, ['-c', 'user.email=o@o', '-c', 'user.name=o', 'commit', '-q', '-m', 'automazione']);
    git(owner, ['push', '-q', 'origin', 'main']);
    git(work, ['pull', '-q', 'origin', 'main']);
    git(work, ['checkout', '-q', '-b', 'worker/togli']);
    git(work, ['rm', '-q', '.github/workflows/vecchia.yml']);

    runHookRaw(work, stdinEdit(resolve(work, '.github', 'workflows', 'vecchia.yml')), { FILO_ROUTINE: '1' });

    assert.equal(remoto(work, 'worker/togli'), '');
  });
});

describe('riallinearsi a main non ferma il ramo', () => {
  test('una fusione di main che porta l\'automazione dell\'owner parte come sempre', () => {
    const { work } = ramoRiallineatoAMain('worker/riallineato');
    writeFileSync(resolve(work, 'b.js'), 'dopo la fusione\n', 'utf8');

    const r = runHookRaw(work, stdinEdit(resolve(work, 'b.js')), { FILO_ROUTINE: '1' });

    assert.equal(remoto(work, 'worker/riallineato'), shaOf(work, 'worker/riallineato'),
      'la fusione non cambia l\'automazione rispetto a main: il ramo deve arrivare su origin');
    assert.equal(contesto(r), '');
  });

  test('se GitHub la rifiuta lo stesso, la sessione legge il perché e cosa fare', () => {
    const { origin, work } = ramoRiallineatoAMain('worker/rifiutato');
    const pre = resolve(origin, 'hooks', 'pre-receive');
    writeFileSync(pre, '#!/bin/sh\necho "refusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yml` without `workflow` scope" >&2\nexit 1\n');
    chmodSync(pre, 0o755);
    writeFileSync(resolve(work, 'b.js'), 'dopo la fusione\n', 'utf8');

    const r = runHookRaw(work, stdinEdit(resolve(work, 'b.js')), { FILO_ROUTINE: '1' });

    const ctx = contesto(r);
    assert.match(ctx, /GitHub l'ha RIFIUTATO perche' porta un cambiamento a un'automazione/);
    assert.match(ctx, /--reason locale/);
    assert.match(ctx, /without `workflow` scope/);
    assert.doesNotMatch(ctx, /git push del ramo/);
  });
});
