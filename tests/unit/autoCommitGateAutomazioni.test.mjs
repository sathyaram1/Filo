// Il salvataggio non committa e non spedisce un'automazione (#1140): un file di .github/workflows gira appena il
// ramo arriva su GitHub, senza fusione, e le automazioni le cambia solo l'owner. La scena: tests/helpers/scenaHook.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { git, scene, runHookRaw, rigaJson, commitFile, shaOf, remoto } from '../helpers/scenaHook.mjs';

const WF = '.github/workflows/prova.yml';
const ROUTINE = { FILO_ROUTINE: '1' };

function scriviAutomazione(work, testo = 'on: workflow_dispatch\n') {
  mkdirSync(resolve(work, '.github', 'workflows'), { recursive: true });
  writeFileSync(resolve(work, WF), testo, 'utf8');
}
const contesto = (r) => JSON.parse(rigaJson(r) || '{}').hookSpecificOutput?.additionalContext || '';
const sulRamoRemoto = (work, ramo) => {
  git(work, ['fetch', '-q', 'origin', ramo]);
  return git(work, ['ls-tree', '-r', '--name-only', `origin/${ramo}`]).split('\n');
};

describe('un\'automazione nuova o cambiata resta nella cartella, il resto del lavoro parte', () => {
  for (const [chi, env, rimedio] of [['routine', ROUTINE, /rimandalo in locale/], ['locale', {}, /owner, a mano/]]) {
    test(`${chi}: il file accanto parte, l'automazione no, e la sessione sa cosa farne`, () => {
      const { work } = scene();
      const ramo = `claude/automazione-${chi}`;
      git(work, ['checkout', '-q', '-b', ramo]);
      writeFileSync(resolve(work, 'lavoro.js'), 'x\n', 'utf8');
      scriviAutomazione(work);

      const r = runHookRaw(work, '', env);

      assert.equal(r.status, 0);
      const suOrigin = sulRamoRemoto(work, ramo);
      assert.ok(suOrigin.includes('lavoro.js'), 'il resto del lavoro deve arrivare su origin come sempre');
      assert.ok(!suOrigin.includes(WF), 'un\'automazione spedita girerebbe subito, senza fusione');
      assert.ok(existsSync(resolve(work, WF)), 'il file resta nella cartella: niente è perso');
      assert.match(git(work, ['status', '--porcelain']), /\.github\//, 'e resta fuori dai commit');
      const detto = contesto(r);
      assert.match(detto, /NON committo \.github\/workflows\/prova\.yml/, 'la sessione deve sapere che quel file non è salvato');
      assert.match(detto, rimedio);
    });
  }

  test('un\'automazione che c\'è già, cambiata o cancellata, non parte nemmeno lei', () => {
    const { work } = scene();
    const ramo = 'claude/automazione-esistente';
    scriviAutomazione(work, 'on: workflow_dispatch\n# prima\n');
    git(work, ['add', WF]);
    git(work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'automazione di main']);
    git(work, ['push', '-q', 'origin', 'main']);
    git(work, ['checkout', '-q', '-b', ramo]);

    writeFileSync(resolve(work, WF), 'on: push\n', 'utf8');
    writeFileSync(resolve(work, 'a.js'), 'a\n', 'utf8');
    runHookRaw(work, '', ROUTINE);
    assert.equal(git(work, ['show', `origin/${ramo}:${WF}`]), 'on: workflow_dispatch\n# prima', 'la modifica non deve partire');

    rmSync(resolve(work, WF));
    writeFileSync(resolve(work, 'b.js'), 'b\n', 'utf8');
    runHookRaw(work, '', ROUTINE);
    assert.ok(sulRamoRemoto(work, ramo).includes(WF), 'nemmeno la cancellazione: anche togliere un\'automazione è cambiarla');
    assert.ok(sulRamoRemoto(work, ramo).includes('b.js'));
  });
});

describe('un ramo coi commit di un\'automazione ancora da spedire non parte', () => {
  test('il commit fatto a mano non esce col salvataggio; spinto dall\'owner, il salvataggio riparte', () => {
    const { work } = scene();
    const ramo = 'claude/automazione-a-mano';
    git(work, ['checkout', '-q', '-b', ramo]);
    commitFile(work, 'prima.js');
    git(work, ['push', '-q', 'origin', `refs/heads/${ramo}:refs/heads/${ramo}`]);
    const spedito = shaOf(work, ramo);
    scriviAutomazione(work);
    git(work, ['add', WF]);
    git(work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'automazione a mano']);
    writeFileSync(resolve(work, 'dopo.js'), 'y\n', 'utf8');

    const r = runHookRaw(work, '', ROUTINE);

    assert.equal(remoto(work, ramo), spedito, 'il ramo su origin deve restare dov\'era');
    const detto = contesto(r);
    assert.match(detto, /NON spedisco 'claude\/automazione-a-mano'.*\.github\/workflows\/prova\.yml/);
    assert.match(detto, /git reset --soft/, 'una routine deve sapere come togliere quel commit');
    assert.doesNotMatch(detto, /git push del ramo/, 'il push a mano, da una routine, è proprio ciò che non va fatto');

    // L'owner spinge il ramo con la sua credenziale: da lì in poi l'automazione è su origin e non ferma più niente.
    git(work, ['push', '-q', 'origin', `refs/heads/${ramo}:refs/heads/${ramo}`]);
    writeFileSync(resolve(work, 'ancora.js'), 'z\n', 'utf8');
    const dopo = runHookRaw(work, '', {});
    assert.equal(String(dopo.stdout || '').trim(), '', 'niente da dire quando tutto è partito');
    assert.ok(sulRamoRemoto(work, ramo).includes('ancora.js'));
  });

  test('un\'automazione che arriva da main già su origin (un rebase) non ferma il ramo', () => {
    const { work } = scene();
    scriviAutomazione(work);
    git(work, ['add', WF]);
    git(work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'automazione di main']);
    git(work, ['push', '-q', 'origin', 'main']);
    const ramo = 'claude/sopra-main';
    git(work, ['checkout', '-q', '-b', ramo]);
    writeFileSync(resolve(work, 'lavoro.js'), 'x\n', 'utf8');

    const r = runHookRaw(work, '', ROUTINE);

    assert.equal(String(r.stdout || '').trim(), '', `nessun allarme, trovato: ${r.stdout}`);
    assert.ok(sulRamoRemoto(work, ramo).includes('lavoro.js'));
  });
});
