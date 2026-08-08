// Spedizione isolata al ramo principale — spec: ROUTINE-BRANCH-INTEGRITY.md §Via 2
//
// L'assert che conta è UNO: dopo aver spedito il fogliettino della decisione, il
// ramo principale deve contenere QUEL FILE E NIENTE ALTRO. Con il vecchio
// `push HEAD:main` questi test diventano rossi, perché insieme al fogliettino
// saliva tutto il codice del ramo — saltando il cancello di sicurezza senza
// lasciare traccia distinguibile da una fusione legittima.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { pushFileToMain, removeFileOnMain, repoPath } from '../../scripts/lib/isolated-push.mjs';

const made = [];
function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function commit(dir, name, body) {
  const f = resolve(dir, name);
  mkdirSync(resolve(f, '..'), { recursive: true });
  writeFileSync(f, body, 'utf8');
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', `add ${name}`]);
  return git(dir, ['rev-parse', 'HEAD']);
}
function makeRepo() {
  const base = mkdtempSync(resolve(tmpdir(), 'filo-ip-'));
  made.push(base);
  const origin = resolve(base, 'origin.git');
  const work = resolve(base, 'work');
  mkdirSync(origin); mkdirSync(work);
  git(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  git(work, ['init', '-q', '--initial-branch=main']);
  git(work, ['remote', 'add', 'origin', origin]);
  commit(work, 'README.md', 'base\n');
  git(work, ['push', '-q', 'origin', 'main']);
  git(work, ['fetch', '-q', 'origin']);
  return { base, origin, work };
}
/** I file presenti sul ramo principale remoto. */
function filesOnMain(work) {
  git(work, ['fetch', '-q', 'origin', 'main']);
  return git(work, ['ls-tree', '-r', '--name-only', 'origin/main']).split('\n').filter(Boolean).sort();
}

test.after(() => {
  for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch (_) {} }
});

describe('Via 2 — al ramo principale arriva SOLO la decisione', () => {
  test('il codice del ramo di lavoro NON sale insieme al fogliettino', () => {
    const { work } = makeRepo();

    // Una routine sta lavorando: ha del codice non ancora esaminato dal cancello.
    git(work, ['checkout', '-q', '-b', 'worker/in-corso']);
    commit(work, 'src/codice-non-esaminato.js', 'pericoloso\n');

    // Registra la decisione sul feedback.
    const spool = resolve(work, 'feedback-triage', 'abc.json');
    mkdirSync(resolve(work, 'feedback-triage'), { recursive: true });
    writeFileSync(spool, JSON.stringify({ id: 'abc', status: 'done' }), 'utf8');

    const r = pushFileToMain(work, spool, 'feedback: decisione abc');
    assert.equal(r.ok, true, r.out);

    const files = filesOnMain(work);
    assert.ok(files.includes('feedback-triage/abc.json'), 'la decisione deve atterrare');
    assert.equal(files.includes('src/codice-non-esaminato.js'), false,
      'il codice NON deve salire: era il biglietto di un file, non di tutto il treno');
    assert.deepEqual(files, ['README.md', 'feedback-triage/abc.json'],
      'sul ramo principale non deve comparire nient’altro');
  });

  test('il commit nasce sopra lo stato remoto, non sulla storia locale', () => {
    const { work } = makeRepo();
    const baseSha = git(work, ['rev-parse', 'origin/main']);
    git(work, ['checkout', '-q', '-b', 'worker/x']);
    commit(work, 'src/roba.js', 'x\n');

    const spool = resolve(work, 'feedback-triage', 'k.json');
    mkdirSync(resolve(work, 'feedback-triage'), { recursive: true });
    writeFileSync(spool, '{"id":"k"}', 'utf8');
    const r = pushFileToMain(work, spool, 'feedback: k');
    assert.equal(r.ok, true, r.out);

    const parent = git(work, ['rev-parse', `${r.sha}^`]);
    assert.equal(parent, baseSha, 'il genitore deve essere il ramo principale remoto, non il lavoro locale');
  });

  test('non tocca il lavoro in corso: indice e directory restano intatti', () => {
    const { work } = makeRepo();
    git(work, ['checkout', '-q', '-b', 'worker/y']);
    writeFileSync(resolve(work, 'in-lavorazione.txt'), 'bozza\n', 'utf8');
    git(work, ['add', 'in-lavorazione.txt']);
    const before = git(work, ['status', '--porcelain']);

    const spool = resolve(work, 'feedback-triage', 'z.json');
    mkdirSync(resolve(work, 'feedback-triage'), { recursive: true });
    writeFileSync(spool, '{"id":"z"}', 'utf8');
    pushFileToMain(work, spool, 'feedback: z');

    assert.equal(git(work, ['status', '--porcelain']), before,
      'la spedizione usa un indice temporaneo: il lavoro in corso non si tocca');
  });

  test('spedizione ripetuta e identica: non fa nulla invece di sporcare la storia', () => {
    const { work } = makeRepo();
    const spool = resolve(work, 'feedback-triage', 'due.json');
    mkdirSync(resolve(work, 'feedback-triage'), { recursive: true });
    writeFileSync(spool, '{"id":"due"}', 'utf8');
    assert.equal(pushFileToMain(work, spool, 'm').ok, true);
    const second = pushFileToMain(work, spool, 'm');
    assert.equal(second.ok, true);
    assert.equal(second.skipped, true, 'niente da cambiare ⇒ niente commit');
  });

  test('rimozione isolata: toglie il semaforo e nient’altro', () => {
    const { work } = makeRepo();
    const claim = resolve(work, 'feedback-triage', 'claims', 'c1.json');
    mkdirSync(resolve(work, 'feedback-triage', 'claims'), { recursive: true });
    writeFileSync(claim, '{"id":"c1"}', 'utf8');
    assert.equal(pushFileToMain(work, claim, 'claim').ok, true);
    assert.ok(filesOnMain(work).includes('feedback-triage/claims/c1.json'));

    git(work, ['checkout', '-q', '-b', 'worker/z']);
    commit(work, 'src/altro.js', 'y\n');

    const r = removeFileOnMain(work, repoPath(work, claim), 'release c1');
    assert.equal(r.ok, true, r.out);
    const files = filesOnMain(work);
    assert.equal(files.includes('feedback-triage/claims/c1.json'), false, 'il semaforo va rilasciato');
    assert.equal(files.includes('src/altro.js'), false, 'e nemmeno il rilascio deve portare su del codice');
  });

  test('se il ramo principale è avanzato la spedizione viene rifiutata, non forzata', () => {
    const { origin, work } = makeRepo();
    // Un altro clone avanza il ramo principale.
    const other = resolve(origin, '..', 'other');
    mkdirSync(other);
    git(other, ['clone', '-q', origin, '.']);
    const altrui = commit(other, 'altrui.txt', 'lavoro di un altro\n');
    git(other, ['push', '-q', 'origin', 'main']);

    const spool = resolve(work, 'feedback-triage', 'race.json');
    mkdirSync(resolve(work, 'feedback-triage'), { recursive: true });
    writeFileSync(spool, '{"id":"race"}', 'utf8');
    const r = pushFileToMain(work, spool, 'feedback: race');

    // Costruendo sopra origin/main appena riletto, la spedizione RIESCE e
    // preserva il lavoro altrui: è il comportamento voluto (nessuna forzatura).
    assert.equal(r.ok, true, r.out);
    const files = filesOnMain(work);
    assert.ok(files.includes('altrui.txt'), 'il lavoro di chi è arrivato prima non si perde mai');
    assert.ok(files.includes('feedback-triage/race.json'));
    assert.equal(git(work, ['rev-parse', `${r.sha}^`]), altrui, 'si costruisce SOPRA, non si sovrascrive');
  });
});
