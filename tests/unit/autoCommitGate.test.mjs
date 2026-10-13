// Chi può pubblicare sul ramo principale — spec: ROUTINE-BRANCH-INTEGRITY.md §Via 1
//
// L'assert che conta: dopo che l'automatismo di salvataggio ha girato, il ramo
// principale remoto NON deve contenere il codice appena scritto. Prima del
// 2026-08-07 lo conteneva — bastava che il ramo avesse un nome fuori
// dall'elenco dei prefissi vietati, e il codice usciva a ogni singola modifica
// saltando verifica e cancello di sicurezza.
// Le altre prove degli stessi agganci: tests/unit/autoCommitGate*.test.mjs (#1063).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ROOT, HOOKS, git, scene, runHook, runHookStderr, runHookRaw, rigaJson, LIMITE, shaOf, filesOnMain, commitFile,
} from '../helpers/scenaHook.mjs';

describe('Via 1 — la sessione si dichiara, non si indovina dal nome del ramo', () => {
  test('una ROUTINE non pubblica sul ramo principale, nemmeno da un ramo dal nome qualsiasi', () => {
    const { work } = scene();
    // Nome fuori da entrambi i prefissi "vietati": è il caso del 24 luglio.
    git(work, ['checkout', '-q', '-b', 'claude/nome-qualsiasi']);
    writeFileSync(resolve(work, 'codice-di-routine.js', ), 'non ancora esaminato\n', 'utf8');

    runHook(work, { FILO_ROUTINE: '1' });

    assert.equal(filesOnMain(work).includes('codice-di-routine.js'), false,
      'il codice di una routine non deve raggiungere il ramo principale senza passare dal cancello');
    // …ma deve essere al sicuro sul suo ramo (durabilità).
    assert.ok(git(work, ['ls-tree', '-r', '--name-only', 'origin/claude/nome-qualsiasi']).includes('codice-di-routine.js'),
      'il lavoro va comunque spedito sul suo ramo: è ciò che lo salva se la sessione viene interrotta');
  });

  test('anche una sessione LOCALE non pubblica a ogni modifica', () => {
    const { work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/lavoro-locale']);
    writeFileSync(resolve(work, 'lavoro-a-meta.js'), 'meta\n', 'utf8');

    runHook(work); // nessuna marcatura: sessione locale

    assert.equal(filesOnMain(work).includes('lavoro-a-meta.js'), false,
      'una versione viene distribuita agli utenti ogni 6 ore dal ramo principale: non può contenere lavori a metà');
  });

  test('una routine che DIMENTICA di dichiararsi resta comunque contenuta', () => {
    // La marcatura serve a distinguere le provenienze nella storia, ma la
    // sicurezza non deve dipenderne: appenderla a un'istruzione che qualcuno
    // può dimenticare rimetterebbe la protezione in prosa — il guasto del
    // 24 luglio in persona. Qui è il caso peggiore: sul ramo principale, senza
    // marcatura, con una sola cartella di lavoro (la forma delle sessioni cloud).
    const { work } = scene();
    writeFileSync(resolve(work, 'codice-non-esaminato.js'), 'x\n', 'utf8');

    runHook(work); // niente FILO_ROUTINE

    assert.equal(filesOnMain(work).includes('codice-non-esaminato.js'), false,
      'senza cartelle separate non si pubblica mai: al ramo principale ci si arriva solo dal cancello');
  });

  test('il lavoro viene comunque salvato: nessuna modifica resta fuori da git', () => {
    const { work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/durabilita']);
    writeFileSync(resolve(work, 'importante.js'), 'da non perdere\n', 'utf8');

    runHook(work);

    assert.equal(git(work, ['status', '--porcelain']), '',
      'salvataggio continuo: una sessione interrotta di colpo non deve perdere niente');
  });

  test('la provenienza resta nella storia: routine e locale hanno autori diversi', () => {
    const { work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/a']);
    writeFileSync(resolve(work, 'a.js'), 'a\n', 'utf8');
    runHook(work, { FILO_ROUTINE: '1' });
    const autoreRoutine = git(work, ['log', '-1', '--format=%an']);

    writeFileSync(resolve(work, 'b.js'), 'b\n', 'utf8');
    runHook(work);
    const autoreLocale = git(work, ['log', '-1', '--format=%an']);

    assert.notEqual(autoreRoutine, autoreLocale,
      'senza distinzione, fra sei mesi "questo codice da dove è arrivato?" non ha risposta');
  });
});

describe('gli agganci arrivano a chi clona il repo adesso', () => {
  // Un hook che nessun file registrato accende non gira sulle macchine che il
  // repo lo clonano (i contenitori delle routine), e nessuno se ne accorge.
  test('un file tracciato registra il salvataggio automatico e la guardia del ramo', () => {
    const tracciati = git(ROOT, ['ls-files']).split('\n').filter((f) => /\.json$/.test(f));
    const testi = tracciati.map((f) => {
      try { return readFileSync(resolve(ROOT, f), 'utf8'); } catch (_) { return ''; }
    });
    for (const hook of [...HOOKS, 'branch-guard.sh']) {
      assert.ok(testi.some((t) => t.includes(hook)),
        `nessun file registrato in git accende ${hook}: su un clone nuovo non parte, in silenzio`);
    }
  });
});
