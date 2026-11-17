// Sul PC dell'owner gli unit girano solo se il suo ramo li cambia (#1497.3, D-185): le regole di scripts/lib/unit-sul-pc.mjs
// e il lanciatore vero, in un repo usa-e-getta con origin.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { unitLontane, soloDelRamo, unitDelRamo, testoSulPc } from '../../scripts/lib/unit-sul-pc.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('il PC dell\'owner è dove non gira una routine né GitHub Actions; la variabile lo forza nei due sensi', () => {
  const no = () => false;
  const si = () => true;
  assert.equal(unitLontane('/x', { env: {}, routine: no }), true);
  assert.equal(unitLontane('/x', { env: {}, routine: si }), false);
  assert.equal(unitLontane('/x', { env: { GITHUB_ACTIONS: 'true' }, routine: no }), false);
  assert.equal(unitLontane('/x', { env: { FILO_UNIT_LONTANE: '1', GITHUB_ACTIONS: 'true' }, routine: si }), true);
  assert.equal(unitLontane('/x', { env: { FILO_UNIT_LONTANE: '0' }, routine: no }), false);
});

test('soloDelRamo tiene i file trovati che il ramo cambia, con le barre di ogni sistema', () => {
  const root = resolve('/r');
  const tutti = ['a', 'b', 'c'].map((n) => join(root, 'tests', 'unit', `${n}.test.mjs`));
  assert.deepEqual(soloDelRamo({ tutti, cambiati: ['tests/unit/b.test.mjs', 'tests\\unit\\c.test.mjs', 'tests/unit/tolto.test.mjs'], root }), tutti.slice(1));
  assert.deepEqual(soloDelRamo({ tutti, cambiati: [], root }), []);
});

test('testoSulPc dice quanti ne girano e dove vanno gli altri; senza elenco non ne gira nessuno', () => {
  assert.match(testoSulPc({ file: ['x'] }, 10), /solo gli unit che il ramo cambia \(1 di 10\): gli altri 9, arrivati da main, girano su GitHub/);
  assert.match(testoSulPc({ file: [] }, 10), /Il ramo non cambia nessun file di unit: qui non ne giro/);
  assert.match(testoSulPc({ errore: 'rete giù' }, 10), /non so quali sono: rete giù\.\n.*Non ne lancio nessuno/);
});

function repo() {
  const casa = cartellaTemporanea('filo-unit-pc-');
  const origin = join(casa, 'origin.git');
  const lavoro = join(casa, 'lavoro');
  const senzaHook = join(casa, 'nessun-hook');
  const segno = join(casa, 'eseguita-da-main');
  mkdirSync(senzaHook);
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', origin]);
  for (const f of ['scripts/run-unit-tests.mjs', 'scripts/lib/riga-di-comando.mjs', 'scripts/lib/riepilogo-unit.mjs', 'scripts/lib/avanzamento-unit.mjs',
    'scripts/lib/unit-sul-pc.mjs', 'scripts/lib/routine-role.mjs', 'scripts/lib/routine-ticket.mjs', 'scripts/lib/tools-pin.mjs', 'scripts/lib/unit-sulla-fusione.mjs']) {
    mkdirSync(dirname(join(lavoro, f)), { recursive: true });
    copyFileSync(join(ROOT, f), join(lavoro, f));
  }
  const scrivi = (file, testo) => { mkdirSync(dirname(join(lavoro, file)), { recursive: true }); writeFileSync(join(lavoro, file), testo, 'utf8'); };
  const prova = (nome) => `import { test } from 'node:test';\ntest(${JSON.stringify(nome)}, () => {});\n`;
  scrivi('package.json', '{"type":"module"}\n');
  scrivi('.gitignore', 'node_modules\n');
  scrivi('tests/unit/vecchia.test.mjs', prova('vecchia'));
  const git = (...a) => execFileSync('git', a, { cwd: lavoro, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '--initial-branch=main');
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false'], ['core.hooksPath', senzaHook]]) git('config', k, v);
  git('remote', 'add', 'origin', origin);
  const commit = (msg) => { git('add', '-A'); git('commit', '-qm', msg); };
  commit('base');
  git('push', '-q', 'origin', 'main');
  git('checkout', '-q', '-b', 'claude/owner');
  scrivi('tests/unit/del-ramo.test.mjs', prova('del ramo'));
  commit('il ramo');
  // Main va avanti con una prova nuova, e l'owner la fonde nel suo ramo.
  git('checkout', '-q', 'main');
  scrivi('tests/unit/da-main.test.mjs', "import { test } from 'node:test';\nimport { writeFileSync } from 'node:fs';\n"
    + `test('da main', () => writeFileSync(${JSON.stringify(segno)}, 'x'));\n`);
  commit('main: prova nuova');
  git('push', '-q', 'origin', 'main');
  git('checkout', '-q', 'claude/owner');
  git('merge', '-q', '--no-edit', 'main');
  return { casa, lavoro, git, scrivi, prova, segno };
}

const rel = (r, files) => files.map((f) => f.slice(r.lavoro.length + 1).split('\\').join('/')).sort();

test('unitDelRamo: i file del ramo, anche fuori dai commit, mai quelli arrivati da main con la fusione', () => {
  const r = repo();
  try {
    const tutti = () => ['vecchia', 'del-ramo', 'da-main', 'in-corso', 'nuova'].map((n) => join(r.lavoro, 'tests', 'unit', `${n}.test.mjs`)).filter((f) => existsSync(f));
    assert.deepEqual(rel(r, unitDelRamo(r.lavoro, tutti()).file), ['tests/unit/del-ramo.test.mjs']);
    r.scrivi('tests/unit/vecchia.test.mjs', r.prova('vecchia cambiata'));
    r.scrivi('tests/unit/nuova.test.mjs', r.prova('nuova'));
    assert.deepEqual(rel(r, unitDelRamo(r.lavoro, tutti()).file), ['tests/unit/del-ramo.test.mjs', 'tests/unit/nuova.test.mjs', 'tests/unit/vecchia.test.mjs']);
    r.git('remote', 'set-url', 'origin', join(r.casa, 'non-esiste.git'));
    assert.match(unitDelRamo(r.lavoro, tutti()).errore, /non riesco a scaricare main da origin/, 'con main vecchio i file di main sembrerebbero del ramo');
  } finally {
    togliCartella(r.casa);
  }
});

// `intero`: env sostituisce quello del padre, così le variabili tolte non tornano da lì (sotto Actions GITHUB_ACTIONS e
// FILO_UNIT_LONTANE=0 della prova sulla fusione).
const lancia = (r, args = [], env = {}, { intero = false } = {}) => {
  const base = intero ? { ...env } : { ...process.env, ...env };
  for (const k of ['NODE_TEST_CONTEXT', 'FILO_UNIT_DIR']) delete base[k];
  return spawnSync(process.execPath, [join(r.lavoro, 'scripts', 'run-unit-tests.mjs'), ...args], { cwd: r.lavoro, encoding: 'utf8', env: base });
};

test('npm run test:unit sul PC dell\'owner: gira la prova del ramo, non quella arrivata da main', () => {
  const r = repo();
  try {
    const p = lancia(r, [], { FILO_UNIT_LONTANE: '1' });
    assert.equal(p.status, 0, p.stdout + p.stderr);
    assert.match(p.stdout, /^ok \d+ - del ramo$/m);
    assert.doesNotMatch(p.stdout, /da main|vecchia/);
    assert.ok(!existsSync(r.segno), 'la prova arrivata da main è girata sul PC dell\'owner');
    assert.match(p.stderr, /solo gli unit che il ramo cambia \(1 di 3\)/);

    const l = lancia(r, ['--list'], { FILO_UNIT_LONTANE: '1' });
    assert.deepEqual(l.stdout.trim().split(/\r?\n/).map((f) => f.split('\\').join('/').replace(/^.*\/tests\//, 'tests/')), ['tests/unit/del-ramo.test.mjs']);

    // Dove le credenziali non ci sono (routine, GitHub) girano tutte.
    const t = lancia(r, [], { FILO_UNIT_LONTANE: '0' });
    assert.equal(t.status, 0, t.stdout + t.stderr);
    assert.ok(existsSync(r.segno));
  } finally {
    togliCartella(r.casa);
  }
});

// Il PC vero: nessuna variabile che forzi la regola o dica routine.
const ambienteDelPc = () => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === 'GITHUB_ACTIONS' || /^FILO_(ROUTINE$|ROUTINE_TICKET|ROUTINE_ROLE|TOOLS_ROOT|UNIT_LONTANE)/.test(k)) delete env[k];
  return env;
};

test('#1737 giro 3: i segni di routine che il repo porta da main non fanno credere al PC dell\'owner di essere una routine', () => {
  const r = repo();
  try {
    const biglietto = `${JSON.stringify({ ticket: 'tk-da-main' })}\n`;
    r.git('checkout', '-q', 'main');
    r.scrivi('.filo-repo-root', '.\n');
    r.scrivi('.claude/routine-ticket.json', biglietto);
    r.git('add', '-f', '.filo-repo-root', '.claude/routine-ticket.json');
    r.git('commit', '-qm', 'main: segni di routine portati da un lavoro fidato');
    r.git('push', '-q', 'origin', 'main');
    r.git('checkout', '-q', 'claude/owner');
    r.git('merge', '-q', '--no-edit', 'main');
    assert.equal(unitLontane(r.lavoro, { env: ambienteDelPc() }), true);
    const p = lancia(r, [], ambienteDelPc(), { intero: true });
    assert.equal(p.status, 0, p.stdout + p.stderr);
    assert.ok(!existsSync(r.segno), `la prova arrivata da main è girata sul PC dell'owner:\n${p.stderr}`);

    // Lo stesso segno scritto da dispatch, che git non traccia, resta quello di una routine.
    r.git('rm', '-q', '--cached', '.claude/routine-ticket.json');
    r.scrivi('.claude/routine-ticket.json', biglietto);
    assert.equal(unitLontane(r.lavoro, { env: ambienteDelPc() }), false);
  } finally {
    togliCartella(r.casa);
  }
});

test('#1737 giro 3: gli spec sul PC si scelgono col conto degli unit; senza main fresco nessuno', async () => {
  const { specDelPc } = await import('../../scripts/finish-local.mjs');
  const r = repo();
  try {
    r.git('checkout', '-q', 'main');
    r.scrivi('tests/opzioni-da-main.spec.mjs', '// da main\n');
    r.git('add', '-A');
    r.git('commit', '-qm', 'main: uno spec');
    r.git('push', '-q', 'origin', 'main');
    r.git('checkout', '-q', 'claude/owner');
    r.git('merge', '-q', '--no-edit', 'main');
    r.scrivi('tests/opzioni-del-ramo.spec.mjs', '// del ramo\n');
    r.git('add', '-A');
    r.git('commit', '-qm', 'il ramo: uno spec');
    const specs = ['tests/opzioni-da-main', 'tests/opzioni-del-ramo'];
    assert.deepEqual(specDelPc({ lontane: true, specs, dir: r.lavoro }), { qui: ['tests/opzioni-del-ramo'], lontani: ['tests/opzioni-da-main'], nota: '' });
    // La copia di main resta indietro e lo scaricamento non riesce: lo spec di main sembrerebbe del ramo.
    r.git('update-ref', 'refs/remotes/origin/main', 'main~1');
    r.git('remote', 'set-url', 'origin', join(r.casa, 'non-esiste.git'));
    const d = specDelPc({ lontane: true, specs, dir: r.lavoro });
    assert.deepEqual([d.qui, d.lontani], [[], specs]);
    assert.match(d.nota, /non so quali cambia il ramo \(non riesco a scaricare main da origin/);
    assert.deepEqual(specDelPc({ lontane: false, specs, dir: r.lavoro }).qui, specs);
  } finally {
    togliCartella(r.casa);
  }
});

test('npm run test:unit sul PC dell\'owner senza main da origin: rosso e nessuna prova eseguita', () => {
  const r = repo();
  try {
    r.git('remote', 'set-url', 'origin', join(r.casa, 'non-esiste.git'));
    const p = lancia(r, [], { FILO_UNIT_LONTANE: '1' });
    assert.equal(p.status, 1, p.stdout + p.stderr);
    assert.match(p.stderr, /non so quali sono: non riesco a scaricare main da origin/);
    assert.doesNotMatch(p.stdout, /^ok /m);
    assert.ok(!existsSync(r.segno));
  } finally {
    togliCartella(r.casa);
  }
});
