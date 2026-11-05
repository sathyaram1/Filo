// Sentinella: i file di sessione (i biglietti prima di tutto) non partono per nessuna strada, qualunque sia la base del
// ramo (#2154: una cartella su un main del 07/10, prima della riga del .gitignore, ha spedito 198 biglietti).

import '../helpers/senzaSessione.mjs';
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scene, togliScene, runHookRaw, stdinEdit, git } from '../helpers/scenaHook.mjs';
import { eMarcatore, marcatoriFuoriDallaScena, SESSION_MARKERS } from '../../scripts/lib/marcatori-sessione.mjs';
import { installaControlloSpedizione } from '../../scripts/lib/copie-di-dati.mjs';
import { scriviFile } from '../../scripts/lib/biglietto-locale.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STRUMENTI = ['scripts/copie-in-scena.mjs', 'scripts/lib/copie-di-dati.mjs', 'scripts/lib/marcatori-sessione.mjs'];
const BIGLIETTO = `${JSON.stringify({ ticket: 'x'.repeat(43), fp: 'f'.repeat(64), natoIl: 1 })}\n`;
const commit = (cwd, msg) => git(cwd, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', msg]);
const suOrigin = (origin, ramo) => git(origin, ['ls-tree', '-r', '--name-only', ramo]).split('\n').filter(Boolean);
const storia = (origin, ramo) => git(origin, ['log', '--format=', '--name-only', ramo]).split('\n').filter(Boolean);
const biglietti = (elenco) => elenco.filter((f) => f.startsWith('.claude/biglietti/'));

after(togliScene);

/**
 * Il checkout che lancia l'hook ha gli strumenti di adesso; la cartella salvata è un suo worktree nato dal main di
 * partenza, che non sa niente dei biglietti, col controllo vecchio che non toglie nulla.
 */
function cartellaSuBaseVecchia() {
  const s = scene();
  const base = git(s.work, ['rev-parse', 'HEAD']);
  for (const f of STRUMENTI) { mkdirSync(dirname(join(s.work, f)), { recursive: true }); copyFileSync(join(ROOT, f), join(s.work, f)); }
  const wt = join(s.base, 'vecchia');
  git(s.work, ['worktree', 'add', '-q', '-b', 'claude/vecchia', wt, base]);
  mkdirSync(join(wt, 'scripts'), { recursive: true });
  writeFileSync(join(wt, 'scripts', 'copie-in-scena.mjs'), '// il controllo di un ramo vecchio: non conosce i biglietti\n');
  git(wt, ['add', '-A']);
  commit(wt, 'base vecchia');
  git(wt, ['push', '-q', 'origin', 'claude/vecchia']);
  return { ...s, wt };
}
const bigliettoIn = (dir, nome = 'sessione-1') => {
  mkdirSync(join(dir, '.claude', 'biglietti'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'biglietti', `${nome}.json`), BIGLIETTO);
};

describe('i biglietti non partono, qualunque sia la base del ramo', () => {
  test('il salvataggio di una cartella su una base vecchia spedisce il lavoro senza i biglietti', () => {
    const { origin, wt } = cartellaSuBaseVecchia();
    for (let i = 0; i < 3; i++) bigliettoIn(wt, `sessione-${i}`);
    writeFileSync(join(wt, 'a.txt'), 'lavoro\n');
    const r = runHookRaw(join(wt, '..', 'work'), stdinEdit(join(wt, 'a.txt')), { FILO_ROUTINE: '1' });
    assert.equal(r.status, 0, r.stderr);
    const spediti = suOrigin(origin, 'claude/vecchia');
    assert.ok(spediti.includes('a.txt'), `il lavoro parte: ${spediti}`);
    assert.deepEqual(biglietti(storia(origin, 'claude/vecchia')), [], 'nessun biglietto nella storia pubblica');
    assert.ok(existsSync(join(wt, '.claude', 'biglietti', 'sessione-0.json')), 'il biglietto resta dove la sessione lo cerca');
    // Invisibili a git anche dopo: il salvataggio seguente non li rivede e non avvisa ogni volta.
    assert.equal(git(wt, ['status', '--porcelain']), '');
    writeFileSync(join(wt, 'b.txt'), 'altro\n');
    runHookRaw(join(wt, '..', 'work'), stdinEdit(join(wt, 'b.txt')), { FILO_ROUTINE: '1' });
    assert.ok(suOrigin(origin, 'claude/vecchia').includes('b.txt'));
    assert.deepEqual(biglietti(storia(origin, 'claude/vecchia')), []);
  });

  test('un ramo che i biglietti li tracciava già li lascia al primo salvataggio, e il file resta sul disco', () => {
    const { origin, wt } = cartellaSuBaseVecchia();
    bigliettoIn(wt);
    git(wt, ['add', '-f', '.claude/biglietti']);
    commit(wt, 'il commit del 20/10');
    git(wt, ['push', '-q', '--no-verify', 'origin', 'claude/vecchia']);
    writeFileSync(join(wt, '.claude', 'biglietti', 'sessione-1.json'), BIGLIETTO.replace('"natoIl":1', '"natoIl":2'));
    writeFileSync(join(wt, 'a.txt'), 'lavoro\n');
    assert.equal(runHookRaw(join(wt, '..', 'work'), stdinEdit(join(wt, 'a.txt')), { FILO_ROUTINE: '1' }).status, 0);
    const spediti = suOrigin(origin, 'claude/vecchia');
    assert.ok(spediti.includes('a.txt'), `${spediti}`);
    assert.deepEqual(biglietti(spediti), [], 'la punta del ramo non porta più il biglietto');
    assert.match(readFileSync(join(wt, '.claude', 'biglietti', 'sessione-1.json'), 'utf8'), /"natoIl":2/, 'il biglietto di adesso resta');
  });

  test('un biglietto entrato in un commit a mano esce dalla storia prima della spedizione', () => {
    const { origin, wt } = cartellaSuBaseVecchia();
    bigliettoIn(wt);
    writeFileSync(join(wt, 'a.txt'), 'uno\n');
    git(wt, ['add', '-A']);
    commit(wt, 'a mano');
    writeFileSync(join(wt, 'README.md'), 'lavoro\n');
    const r = runHookRaw(join(wt, '..', 'work'), stdinEdit(join(wt, 'README.md')), { FILO_ROUTINE: '1' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(suOrigin(origin, 'claude/vecchia').includes('a.txt'));
    assert.deepEqual(biglietti(storia(origin, 'claude/vecchia')), [], 'nemmeno in un commit di mezzo');
    assert.match(r.stdout, /file di sessione/, 'la sessione sa cosa è stato tolto');
    assert.doesNotMatch(r.stdout, /os\.tmpdir/, 'un biglietto non si sposta: la sessione lo cerca lì');
  });

  test('col controllo di git un biglietto non parte nemmeno con un git push a mano', () => {
    const { origin, wt } = cartellaSuBaseVecchia();
    assert.equal(installaControlloSpedizione(join(wt, '..', 'work')), 'installato');
    bigliettoIn(wt);
    git(wt, ['add', '-A']);
    commit(wt, 'a mano');
    assert.throws(() => git(wt, ['push', '-q', 'origin', 'claude/vecchia']), /file di sessione/);
    assert.deepEqual(biglietti(storia(origin, 'claude/vecchia')), []);
  });

  test('il file del biglietto nasce già invisibile a git, in ogni worktree, anche senza la riga del .gitignore', () => {
    const { wt, work } = cartellaSuBaseVecchia();
    scriviFile(join(work, '.claude', 'biglietti', 'sessione-9.json'), { ticket: 'x'.repeat(43), fp: 'f'.repeat(64), natoIl: 1 });
    assert.equal(git(work, ['status', '--porcelain', '--', '.claude/biglietti']), '');
    bigliettoIn(wt, 'sessione-10');
    assert.equal(git(wt, ['status', '--porcelain']), '', 'info/exclude vale anche nel worktree sulla base vecchia');
  });

  test('al rilascio un biglietto resta fuori dal commit, il resto parte', async () => {
    const { commitRestante } = await import('../../scripts/routine-channel.mjs');
    const { wt } = cartellaSuBaseVecchia();
    bigliettoIn(wt);
    writeFileSync(join(wt, 'note.txt'), 'lavoro\n');
    const c = commitRestante(wt, { env: { FILO_ROUTINE: '1' } });
    assert.ok(c.ok, c.reason);
    assert.deepEqual(c.committed, ['note.txt']);
    assert.deepEqual(biglietti(git(wt, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n')), []);
  });

  test('la regola riconosce ogni file di sessione e niente altro', () => {
    for (const m of SESSION_MARKERS) assert.ok(eMarcatore(m.endsWith('/') ? `${m}x.json` : m), m);
    for (const f of ['.claude/biglietti.json', 'claude/biglietti/x.json', '.claude/settings.json', 'scripts/lib/biglietto-locale.mjs']) {
      assert.equal(eMarcatore(f), false, f);
    }
    assert.ok(eMarcatore('.claude\\biglietti\\x.json'), 'le barre di Windows');
    assert.deepEqual(marcatoriFuoriDallaScena(ROOT, { exec: () => '' }), [], 'senza niente in scena non tocca l\'indice');
  });
});
