// Chi può pubblicare sul ramo principale — spec: ROUTINE-BRANCH-INTEGRITY.md §Via 1
//
// L'assert che conta: dopo che l'automatismo di salvataggio ha girato, il ramo
// principale remoto NON deve contenere il codice appena scritto. Prima del
// 2026-08-07 lo conteneva — bastava che il ramo avesse un nome fuori
// dall'elenco dei prefissi vietati, e il codice usciva a ogni singola modifica
// saltando verifica e cancello di sicurezza.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOKS_DIR = resolve(ROOT, '.claude', 'hooks');
// Gli automatismi che girano da soli a ogni modifica: il salvataggio e il
// diagnostico dei limiti di sessione. Sono due file diversi, ma rispondono
// entrambi alla stessa domanda — "questo ramo lo posso toccare?" — e devono
// rispondere allo stesso modo.
const HOOKS = ['auto-commit-merge.sh', 'cap-observe.sh'];

const made = [];
function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Repo isolato con finto origin, e una copia degli hook veri da eseguire.
 * `poison` avvelena la configurazione locale di git come nello scenario reale:
 * `push.default=upstream` + `branch.<ramo>.merge=refs/heads/main` è ciò che git
 * imposta DA SÉ su ogni ramo nato da origin/main.
 */
function scene({ poison = false } = {}) {
  const base = mkdtempSync(resolve(tmpdir(), 'filo-hook-'));
  made.push(base);
  const origin = resolve(base, 'origin.git');
  const work = resolve(base, 'work');
  mkdirSync(origin); mkdirSync(work);
  git(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  git(work, ['init', '-q', '--initial-branch=main']);
  git(work, ['remote', 'add', 'origin', origin]);
  if (poison) {
    git(work, ['config', 'push.default', 'upstream']);
    git(work, ['config', 'branch.main.merge', 'refs/heads/main']);
    git(work, ['config', 'branch.main.remote', 'origin']);
  }
  writeFileSync(resolve(work, 'README.md'), 'base\n', 'utf8');
  git(work, ['add', '-A']);
  git(work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base']);
  git(work, ['push', '-q', 'origin', 'main']);

  mkdirSync(resolve(work, '.claude', 'hooks'), { recursive: true });
  for (const h of HOOKS) copyFileSync(resolve(HOOKS_DIR, h), resolve(work, '.claude', 'hooks', h));
  return { base, origin, work };
}

function runHook(work, env = {}, hook = 'auto-commit-merge.sh', stdin = '') {
  try {
    execFileSync('bash', [resolve(work, '.claude', 'hooks', hook)], {
      cwd: work, encoding: 'utf8', input: stdin,
      env: { ...process.env, CLAUDE_PROJECT_DIR: work, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (_) { /* l'hook non fallisce mai per contratto */ }
}

/** Il messaggio che una sessione limitata consegna a cap-observe.sh. */
const LIMITE = JSON.stringify({
  hook_event_name: 'StopFailure',
  error_type: 'usage_limit',
  error_message: 'session limit reached',
});

/** SHA locale di un ramo ('' se non esiste). */
function shaOf(work, ref) {
  try { return git(work, ['rev-parse', ref]); } catch (_) { return ''; }
}

function filesOnMain(work) {
  git(work, ['fetch', '-q', 'origin', 'main']);
  return git(work, ['ls-tree', '-r', '--name-only', 'origin/main']).split('\n').filter(Boolean);
}

test.after(() => {
  for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch (_) {} }
});

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
