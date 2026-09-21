// Sentinella: nel repo non viaggiano avanzi.
//
// Due cose che git si tiene finché qualcuno non le toglie a mano, perché
// `.gitignore` non ha nessun potere su ciò che è già registrato:
//
//   • le cartelle di lavoro annidate (`.claude/worktrees/…`). Committate per
//     sbaglio diventano dei «gitlink»: una riga che punta a un commit che su
//     nessun'altra macchina esiste. Chi clona si ritrova cartelle vuote che
//     `git status` non spiega, e i comandi sulle worktree si confondono. Tre ne
//     sono rimaste dentro per settimane, con `.gitignore` che dice da sempre
//     «mai committare come gitlink»;
//   • gli scarti dei comandi andati storti (`nf2.err`, vuoto, in radice).
//
// Non sono guasti visibili: sono peso che ogni copia del repo si porta dietro e
// che nessuno guarda più. Qui diventano rossi in millisecondi.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const git = (...args) => execFileSync('git', args, {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});

describe('il repo non si porta dietro avanzi', () => {
  test('nessuna cartella di lavoro registrata come gitlink', () => {
    // Il modo 160000 è la firma di un gitlink: un commit puntato invece di un file.
    const gitlink = git('ls-files', '-s')
      .split('\n')
      .filter((r) => r.startsWith('160000'))
      .map((r) => r.split('\t').pop());
    assert.deepEqual(gitlink, [],
      'queste voci sono worktree (o sottomoduli) finite nel repo per sbaglio. '
      + 'Si tolgono con `git rm --cached <percorso>`: restano sul disco, escono da git');
  });

  test('nessun file tracciato che .gitignore dice di escludere', () => {
    // `.gitignore` non tocca ciò che è già registrato: senza questo controllo
    // una regola di esclusione resta lì a dire una cosa che non è vera.
    // Contano SOLO i `.gitignore` del repo: le esclusioni personali di una
    // macchina non sono una regola del progetto, e il repo non può obbedirle.
    const ignorati = git('-c', 'core.excludesFile=/dev/null',
      'ls-files', '-i', '-c', '--exclude-per-directory=.gitignore')
      .split('\n').filter(Boolean);
    assert.deepEqual(ignorati, [],
      'questi file sono tracciati anche se .gitignore li esclude: o non dovevano entrare '
      + '(`git rm --cached <file>`), o la regola che li esclude è sbagliata');
  });
});
