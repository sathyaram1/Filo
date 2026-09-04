// Il verdetto della suite che viaggia come ref git (scripts/suite-verdict.mjs).
//
// PERCHÉ SI PROVA CON GIT VERO
//   Il verdetto della suite completa non passa dalle API di GitHub — nell'ambiente
//   delle routine sono chiuse — ma da un ref fuori da `refs/heads/*`. Un ref è
//   una cosa che o si spedisce e si rilegge davvero, o non funziona: qui si
//   monta un origin finto (bare, in una cartella usa-e-getta) e si fa il giro
//   completo, pubblica da un clone e rileggi da UN ALTRO. È lo stesso metodo di
//   mergeGate.test.mjs, per la stessa ragione.
//
// Le due cose che non devono mai succedere:
//   1. un verdetto di un ALTRO commit letto come se fosse di questo (sarebbe un
//      verde ereditato da un lavoro precedente: il modo perfetto per far
//      passare una regressione);
//   2. "non lo so" (verdetto assente, o suite ancora in corso) che esce con lo
//      stesso codice di "verde".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', '..', 'scripts', 'suite-verdict.mjs');

const {
  chiaveRef, ramoValido, interpreta, exitCodeFor, componiVerdetto,
} = await import('../../scripts/suite-verdict.mjs');

// ─── logica pura ─────────────────────────────────────────────────────────────

test('chiaveRef: le barre del ramo diventano `__`, o due ref si escludono a vicenda', () => {
  assert.match(chiaveRef('worker/7'), /^refs\/suite\/worker__7-[0-9a-f]{8}$/);
  assert.match(chiaveRef('main'), /^refs\/suite\/main-[0-9a-f]{8}$/);
  // La collisione che questo evita: in git `refs/suite/worker` e
  // `refs/suite/worker/7` non possono coesistere (una cartella non può essere
  // anche un file), e con nomi di ramo generati da una macchina prima o poi
  // arriva — come un push che fallisce senza che nessuno capisca perché.
  assert.notEqual(chiaveRef('worker'), chiaveRef('worker/7'));
  assert.equal(chiaveRef(''), '');
  assert.ok(!chiaveRef('a b;rm -rf /').includes(' '));
  // Lo stesso ramo dà sempre lo stesso ref, o non lo si ritroverebbe.
  assert.equal(chiaveRef('worker/7'), chiaveRef('worker/7'));
});

test('due rami che la ripulitura appiattirebbe NON finiscono sullo stesso ref', () => {
  // Senza l'impronta del nome vero, `lavoro/a b` e `lavoro/a-b` diventavano lo
  // stesso ref: il verdetto di un ramo veniva letto come il verdetto
  // dell'altro, che è il "verde ereditato" contro cui esiste tutto il resto.
  assert.notEqual(chiaveRef('lavoro/a b'), chiaveRef('lavoro/a-b'));
  assert.notEqual(chiaveRef('worker/x_y'), chiaveRef('worker/x/y'));
});

test('ramoValido: HEAD staccato non è un ramo', () => {
  assert.ok(ramoValido('worker/7'));
  assert.ok(!ramoValido('HEAD'));
  assert.ok(!ramoValido(''));
});

test('interpreta: un verdetto di un ALTRO commit non è un verde', () => {
  const verde = componiVerdetto({ sha: 'a'.repeat(40), ramo: 'worker/7', stato: 'finito', esito: { verde: true, riassunto: 'tutto ok' } });
  assert.equal(interpreta(verde, 'a'.repeat(40)).esito, 'verde');
  // Stesso verdetto, commit diverso: vale zero. Senza questo, la punta nuova
  // di un ramo eredita il verde della punta vecchia.
  assert.equal(interpreta(verde, 'b'.repeat(40)).esito, 'altro-commit');
});

test('un verdetto SENZA commit non vale per nessun commit', () => {
  // È l'eccezione che annullava la regola: il confronto si faceva solo se il
  // verdetto portava un commit, e uno senza passava per buono su qualunque
  // punta. Ci si arriva pubblicando da fuori una copia git.
  const senzaCommit = { ...componiVerdetto({ sha: 'a'.repeat(40), ramo: 'worker/7', stato: 'finito', esito: { verde: true } }), sha: '' };
  assert.equal(interpreta(senzaCommit, 'b'.repeat(40)).esito, 'assente');
  assert.equal(exitCodeFor(interpreta(senzaCommit, 'b'.repeat(40)).esito), 3);
});

test('una domanda senza commit non riceve un verde', () => {
  // L'altra metà della stessa asimmetria: se chi legge non sa quale punta sta
  // guardando, nessun verdetto è "il suo".
  const verde = componiVerdetto({ sha: 'a'.repeat(40), ramo: 'worker/7', stato: 'finito', esito: { verde: true } });
  assert.equal(interpreta(verde, '').esito, 'assente');
});

test('il verdetto di un ALTRO ramo, finito sullo stesso ref, vale come assente', () => {
  const altrui = componiVerdetto({ sha: 'a'.repeat(40), ramo: 'lavoro/a b', stato: 'finito', esito: { verde: true } });
  assert.equal(interpreta(altrui, 'a'.repeat(40), 'lavoro/a-b').esito, 'assente');
  assert.equal(interpreta(altrui, 'a'.repeat(40), 'lavoro/a b').esito, 'verde');
});

test('interpreta: in corso, rossa, assente', () => {
  const sha = 'c'.repeat(40);
  assert.equal(interpreta(componiVerdetto({ sha, stato: 'in-corso' }), sha).esito, 'in-corso');
  assert.equal(
    interpreta(componiVerdetto({ sha, stato: 'finito', esito: { verde: false, riassunto: 'rotto' } }), sha).esito,
    'rossa',
  );
  assert.equal(interpreta(null, sha).esito, 'assente');
});

test('exitCodeFor: "non lo so" non esce mai come "verde"', () => {
  assert.equal(exitCodeFor('verde'), 0);
  assert.equal(exitCodeFor('rossa'), 1);
  assert.equal(exitCodeFor('in-corso'), 2);
  assert.equal(exitCodeFor('assente'), 3);
  assert.equal(exitCodeFor('altro-commit'), 3);
  assert.equal(exitCodeFor('qualcos’altro'), 4);
});

// ─── il giro completo, con git vero ──────────────────────────────────────────

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function hasGit() {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

const skip = !hasGit() ? 'git non disponibile' : false;

function cli(dir, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, FILO_REPO_ROOT: dir },
  });
}

function montaOrigin(base) {
  const origin = join(base, 'origin.git');
  const seme = join(base, 'seme');
  git(base, ['init', '--bare', '-b', 'main', origin]);
  git(base, ['clone', '-q', origin, seme]);
  git(seme, ['config', 'user.email', 't@t']); git(seme, ['config', 'user.name', 't']);
  writeFileSync(join(seme, 'README.md'), 'seme\n');
  git(seme, ['add', '-A']); git(seme, ['commit', '-q', '-m', 'seme']); git(seme, ['push', '-q', 'origin', 'main']);
  return origin;
}

function clona(base, origin, nome) {
  const dir = join(base, nome);
  git(base, ['clone', '-q', origin, dir]);
  git(dir, ['config', 'user.email', 't@t']); git(dir, ['config', 'user.name', 't']);
  return dir;
}

test('pubblicato da una macchina, riletto da un’altra — e non tocca nessun ramo', { skip }, () => {
  const base = mkdtempSync(join(tmpdir(), 'filo-verdetto-'));
  try {
    const origin = montaOrigin(base);
    const ci = clona(base, origin, 'ci');           // il workflow
    const chiLegge = clona(base, origin, 'chi-legge'); // il verificatore
    const sha = git(ci, ['rev-parse', 'HEAD']);
    const esito = join(base, 'esito.json');
    writeFileSync(esito, JSON.stringify({ verde: true, eseguiti: 465, rossi: [], riassunto: 'Suite completa verde: 465 test eseguiti.' }));

    const p = cli(ci, ['pubblica', '--ramo', 'worker/7', '--sha', sha, '--stato', 'finito', '--esito', esito]);
    assert.equal(p.status, 0, `pubblica exit 0 (${p.stderr})`);

    const l = cli(chiLegge, ['leggi', '--ramo', 'worker/7', '--sha', sha]);
    assert.equal(l.status, 0, `verde = exit 0 (${l.stdout} ${l.stderr})`);
    assert.match(l.stdout, /VERDE/);
    assert.match(l.stdout, /465 test eseguiti/);

    // Il verdetto NON è un ramo: la lista dei rami dell'origin resta quella di
    // prima. È tutto il punto di stare fuori da refs/heads/*.
    const rami = git(base, ['--git-dir=' + origin, 'for-each-ref', '--format=%(refname)', 'refs/heads/']);
    assert.equal(rami, 'refs/heads/main');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('il verdetto della punta vecchia non vale per la punta nuova', { skip }, () => {
  const base = mkdtempSync(join(tmpdir(), 'filo-verdetto-vecchio-'));
  try {
    const origin = montaOrigin(base);
    const ci = clona(base, origin, 'ci');
    const vecchio = git(ci, ['rev-parse', 'HEAD']);
    const esito = join(base, 'esito.json');
    writeFileSync(esito, JSON.stringify({ verde: true, eseguiti: 10, rossi: [], riassunto: 'verde' }));
    assert.equal(cli(ci, ['pubblica', '--ramo', 'worker/7', '--sha', vecchio, '--stato', 'finito', '--esito', esito]).status, 0);

    // Arriva un salvataggio nuovo: la punta cambia, il verdetto no.
    writeFileSync(join(ci, 'nuovo.txt'), 'lavoro nuovo\n');
    git(ci, ['add', '-A']); git(ci, ['commit', '-q', '-m', 'lavoro nuovo']);
    const nuovo = git(ci, ['rev-parse', 'HEAD']);

    const l = cli(ci, ['leggi', '--ramo', 'worker/7', '--sha', nuovo]);
    assert.equal(l.status, 3, `un verde ereditato deve valere "non lo so" (${l.stdout})`);
    assert.match(l.stdout, /ALTRO-COMMIT/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('suite in corso → exit 2; suite rossa → exit 1 con gli spec da rilanciare', { skip }, () => {
  const base = mkdtempSync(join(tmpdir(), 'filo-verdetto-rosso-'));
  try {
    const origin = montaOrigin(base);
    const ci = clona(base, origin, 'ci');
    const sha = git(ci, ['rev-parse', 'HEAD']);

    assert.equal(cli(ci, ['pubblica', '--ramo', 'worker/9', '--sha', sha, '--stato', 'in-corso']).status, 0);
    const inCorso = cli(ci, ['leggi', '--ramo', 'worker/9', '--sha', sha]);
    assert.equal(inCorso.status, 2, `in corso = exit 2 (${inCorso.stdout})`);

    const esito = join(base, 'esito.json');
    writeFileSync(esito, JSON.stringify({
      verde: false,
      eseguiti: 465,
      rossi: [{ file: 'tests/rotto.spec.mjs', titolo: 'la cosa chiesta' }],
      riassunto: 'Suite completa ROSSA: 1 spec rotti.\n\nSpec da rilanciare:\n- tests/rotto.spec.mjs › la cosa chiesta',
    }));
    assert.equal(cli(ci, ['pubblica', '--ramo', 'worker/9', '--sha', sha, '--stato', 'finito', '--esito', esito]).status, 0);
    const rossa = cli(ci, ['leggi', '--ramo', 'worker/9', '--sha', sha]);
    assert.equal(rossa.status, 1, `rossa = exit 1 (${rossa.stdout})`);
    assert.match(rossa.stdout, /tests\/rotto\.spec\.mjs/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('nessun verdetto per quel ramo → exit 3, non exit 0', { skip }, () => {
  const base = mkdtempSync(join(tmpdir(), 'filo-verdetto-assente-'));
  try {
    const origin = montaOrigin(base);
    const ci = clona(base, origin, 'ci');
    const l = cli(ci, ['leggi', '--ramo', 'ramo/mai-visto', '--sha', git(ci, ['rev-parse', 'HEAD'])]);
    assert.equal(l.status, 3, `assente = exit 3 (${l.stdout} ${l.stderr})`);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('corsa finita senza verbale: verdetto non verde, e dice perché', { skip }, () => {
  const base = mkdtempSync(join(tmpdir(), 'filo-verdetto-vuoto-'));
  try {
    const origin = montaOrigin(base);
    const ci = clona(base, origin, 'ci');
    const sha = git(ci, ['rev-parse', 'HEAD']);
    // `--esito` punta a un file che non c'è: è quello che succede quando la
    // corsa muore prima di eseguire un solo test.
    assert.equal(cli(ci, ['pubblica', '--ramo', 'worker/3', '--sha', sha, '--stato', 'finito', '--esito', join(base, 'mai-scritto.json')]).status, 0);
    const l = cli(ci, ['leggi', '--ramo', 'worker/3', '--sha', sha]);
    assert.equal(l.status, 1, `una corsa senza test non è un verde (${l.stdout})`);
    assert.match(l.stdout, /nessun verbale/i);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
