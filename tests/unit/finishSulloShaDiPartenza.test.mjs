// finish:check fissa lo sha all'avvio e prova in una cartella staccata: se la cartella cambia ramo a metà (D-91: un
// altro worker la portava su main), l'esito resta quello del commit di partenza e lo dice (#1480). Gira anche lui
// dentro quella cartella staccata: node_modules si trova risalendo, mai accanto al repo.

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { aspettaChe } from '../helpers/attese.mjs';
import { apriProvaSulCommit, pulisciResti, gitIn, togliCollegamento } from '../../scripts/lib/unit-sulla-fusione.mjs';
import { testoFuoriDaiCommit } from '../../scripts/finish-local.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// node_modules vero, ovunque giri questo file: anche dalla cartella staccata di finish, che ce l'ha un livello sopra.
const MODULI = resolve(dirname(createRequire(import.meta.url).resolve('@playwright/test/package.json')), '..', '..');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// Il finto unit test dice da dove prova: aspetta che la cartella sia stata spostata, poi legge il segno del commit.
const FINTO = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const S = process.env.FILO_PROVA_SEGNALI;
test('il commit provato resta quello di partenza', async () => {
  writeFileSync(join(S, 'partito'), process.cwd());
  while (!existsSync(join(S, 'vai'))) await new Promise((r) => setTimeout(r, 100));
  assert.equal(readFileSync(new URL('../../segno.txt', import.meta.url), 'utf8').trim(), 'ramo');
});
`;

function deposito() {
  const casa = cartellaTemporanea('filo-finish-sha-');
  const origine = join(casa, 'origine.git');
  const semina = join(casa, 'semina');
  const lavoro = join(casa, 'lavoro');
  git(casa, 'init', '-q', '--bare', '-b', 'main', origine);
  mkdirSync(join(semina, 'tests', 'unit'), { recursive: true });
  mkdirSync(join(semina, 'src', 'main', 'services'), { recursive: true });
  cpSync(join(REPO, 'scripts'), join(semina, 'scripts'), { recursive: true });
  // Quello che finish-local importa da src (il segnale della fusione, l'accesso, le transizioni condivise).
  for (const d of [['main', 'services'], ['main', 'auth'], ['shared']]) cpSync(join(REPO, 'src', ...d), join(semina, 'src', ...d), { recursive: true });
  cpSync(join(REPO, 'package.json'), join(semina, 'package.json'));
  writeFileSync(join(semina, 'tests', 'unit', 'segno.test.mjs'), FINTO);
  writeFileSync(join(semina, 'segno.txt'), 'main\n');
  git(semina, 'init', '-q', '-b', 'main');
  git(semina, 'config', 'user.email', 't@t');
  git(semina, 'config', 'user.name', 't');
  git(semina, 'add', '-A');
  git(semina, 'commit', '-qm', 'inizio');
  git(semina, 'checkout', '-q', '-b', 'claude/prova');
  writeFileSync(join(semina, 'segno.txt'), 'ramo\n');
  git(semina, 'commit', '-qam', 'il ramo');
  git(semina, 'push', '-q', origine, 'main', 'claude/prova');
  git(casa, 'clone', '-q', '-b', 'claude/prova', origine, lavoro);
  git(lavoro, 'config', 'user.email', 't@t');
  git(lavoro, 'config', 'user.name', 't');
  symlinkSync(MODULI, join(lavoro, 'node_modules'), 'junction');
  appendFileSync(join(lavoro, '.git', 'info', 'exclude'), '\nnode_modules\n');
  return { casa, lavoro };
}
// Prima il collegamento, mai attraversato: una rimozione ricorsiva lo seguirebbe dentro node_modules vero.
const togli = (casa, lavoro) => { togliCollegamento(join(lavoro, 'node_modules')); togliCartella(casa); };

test('la cartella spostata su main durante finish:check: la prova resta sul commit del ramo, e l\'esito lo dice', async () => {
  const { casa, lavoro } = deposito();
  const segnali = join(casa, 'segnali');
  mkdirSync(segnali);
  const sha = git(lavoro, 'rev-parse', 'HEAD');
  try {
    const { NODE_TEST_CONTEXT: _figlio, ...env } = process.env;
    const p = spawn(process.execPath, [join(lavoro, 'scripts', 'finish-local.mjs'), '--check'], {
      cwd: lavoro, env: { ...env, FILO_PROVA_SEGNALI: segnali, FILO_ROUTINE: '' },
    });
    let out = '';
    p.stdout.on('data', (c) => { out += c; });
    p.stderr.on('data', (c) => { out += c; });
    const fine = new Promise((ok) => p.on('close', ok));
    await aspettaChe(() => existsSync(join(segnali, 'partito')) || p.exitCode !== null, { ogniMs: 100, cosa: () => `i controlli non partono:\n${out}` });
    assert.ok(existsSync(join(segnali, 'partito')), `i controlli non sono partiti:\n${out}`);
    // Un altro porta la cartella su main mentre i controlli girano.
    git(lavoro, 'checkout', '-q', 'main');
    writeFileSync(join(segnali, 'vai'), '');
    const codice = await fine;
    assert.equal(codice, 0, out);
    assert.match(out, new RegExp(`Controlli passati \\(--check: non chiedo la fusione\\) su claude/prova ${sha.slice(0, 8)}\\. Valgono per quel commit`));
    assert.match(out, /la cartella si è mossa durante i controlli \(adesso main /);
    assert.equal(git(lavoro, 'branch', '--show-current'), 'main');
    assert.equal(git(lavoro, 'worktree', 'list').split('\n').length, 1, 'la cartella di prova se ne va a fine controlli');
  } finally {
    togli(casa, lavoro);
  }
});

test('un file nuovo fuori dai commit ferma finish:check col suo nome: la prova sul commit non lo salta in silenzio', () => {
  const { casa, lavoro } = deposito();
  const segnali = join(casa, 'segnali');
  mkdirSync(segnali);
  writeFileSync(join(segnali, 'vai'), '');
  try {
    writeFileSync(join(lavoro, 'tests', 'unit', 'rosso.test.mjs'), "import { test } from 'node:test';\ntest('rosso', () => { throw new Error('rosso'); });\n");
    const { NODE_TEST_CONTEXT: _figlio, ...env } = process.env;
    const r = spawnSync(process.execPath, [join(lavoro, 'scripts', 'finish-local.mjs'), '--check'], {
      cwd: lavoro, encoding: 'utf8', env: { ...env, FILO_PROVA_SEGNALI: segnali, FILO_ROUTINE: '' },
    });
    const out = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 1, out);
    assert.match(out, /modifiche fuori dai commit[^\n]*tests\/unit\/rosso\.test\.mjs/);
    assert.doesNotMatch(out, /Controlli passati/);
  } finally {
    togli(casa, lavoro);
  }
});

test('testoFuoriDaiCommit nomina i file e dice quanti altri ne restano', () => {
  const t = testoFuoriDaiCommit(Array.from({ length: 12 }, (_, i) => `f${i}.js`));
  assert.match(t, /f0\.js, f1\.js/);
  assert.match(t, /e altri 2/);
  assert.doesNotMatch(t, /f11\.js/);
});

test('la cartella di prova: staccata sullo sha, coi moduli raggiungibili, e la pulizia dei resti non la tocca mentre vive', () => {
  const { casa, lavoro } = deposito();
  const sha = git(lavoro, 'rev-parse', 'HEAD');
  const albero = apriProvaSulCommit({ root: lavoro, sha });
  try {
    assert.ok(!albero.errore, albero.errore);
    git(lavoro, 'checkout', '-q', 'main');
    assert.equal(git(albero.dir, 'rev-parse', 'HEAD'), sha);
    assert.ok(readdirSync(albero.moduli).includes('@playwright'));
    pulisciResti({ git: gitIn(lavoro) });
    assert.ok(existsSync(albero.dir), 'la cartella in uso da questo processo resta');
  } finally {
    assert.equal(albero.chiudi().ok, true);
    assert.equal(existsSync(albero.base), false);
    assert.ok(existsSync(join(MODULI, '@playwright')), 'node_modules vero intatto');
    togli(casa, lavoro);
  }
});
