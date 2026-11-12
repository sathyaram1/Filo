// Il giro d'avvio con un lockfile riscritto dall'install arriva comunque al rebase (#2040): la cartella di chi guida
// rimette package-lock.json com'è nel commit, e solo quello.
import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { decidiLockfile, sporcoSoloDalLockfile } from '../../scripts/lib/lockfile-del-commit.mjs';
import { espandiInclusioni } from '../../scripts/lib/role-text.mjs';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DISPATCH = join(RADICE, 'scripts', 'dispatch.mjs');
const RUOLI = join(RADICE, 'routines', 'roles');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tenta = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

const manifesto = (v) => `${JSON.stringify({ name: 'filo', version: v, private: true }, null, 2)}\n`;
const lockfile = (v) => `${JSON.stringify({
  name: 'filo', version: v, lockfileVersion: 3, requires: true, packages: { '': { name: 'filo', version: v } },
}, null, 2)}\n`;
// Quello che fa `npm install` col lockfile rimasto indietro: ci riscrive il numero del manifesto.
const comeNpmInstall = (dir) => {
  const v = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
  writeFileSync(join(dir, 'package-lock.json'), lockfile(v));
};

// main come nella segnalazione: manifesto alla 0.2.256, lockfile alla 0.2.246; poi main va avanti.
function giroDAvvio() {
  const casa = cartellaTemporanea('filo-lockfile-');
  const origine = join(casa, 'origine.git');
  const semina = join(casa, 'semina');
  const cartella = join(casa, 'sessione');
  git(casa, 'init', '-q', '--bare', origine);
  mkdirSync(semina);
  git(semina, 'init', '-q', '-b', 'main');
  git(semina, 'config', 'user.email', 't@t');
  git(semina, 'config', 'user.name', 't');
  writeFileSync(join(semina, '.gitattributes'), '* text=auto eol=lf\n');
  writeFileSync(join(semina, 'package.json'), manifesto('0.2.256'));
  writeFileSync(join(semina, 'package-lock.json'), lockfile('0.2.246'));
  writeFileSync(join(semina, 'codice.txt'), 'uno\n');
  git(semina, 'add', '-A');
  git(semina, 'commit', '-qm', 'release: v0.2.256 [skip ci]');
  git(semina, 'push', '-q', origine, 'main');
  git(casa, 'clone', '-q', '-b', 'main', origine, cartella);
  git(cartella, 'config', 'user.email', 't@t');
  git(cartella, 'config', 'user.name', 't');
  writeFileSync(join(semina, 'codice.txt'), 'due\n');
  git(semina, 'commit', '-qam', 'merge-gate: #1 via server');
  git(semina, 'push', '-q', origine, 'main');
  return { casa, cartella, semina };
}

const rimetti = (cartella, env) => spawnSync(process.execPath, [DISPATCH, '--rimetti-lockfile'], {
  encoding: 'utf8',
  env: { ...process.env, FILO_REPO_ROOT: cartella, FILO_DISPATCH_STATE_DIR: join(cartella, '..', 'stato'), FILO_NO_BEAT: '1', FILO_ROUTINE: '', FILO_ROUTINE_TICKET: '', FILO_ROUTINE_ROLE: '', ...env },
});

test('dopo un install che riscrive il lockfile il rebase del giro d\'avvio riesce, e la cartella è quella di main', () => {
  const { casa, cartella } = giroDAvvio();
  try {
    comeNpmInstall(cartella);
    git(cartella, 'fetch', '-q', 'origin', 'main');
    const senza = tenta(cartella, 'rebase', 'origin/main');
    assert.notEqual(senza.status, 0, 'senza il passo il rebase dovrebbe rifiutare la cartella sporca');
    assert.match(`${senza.stderr}${senza.stdout}`, /unstaged changes|non in staging|modifiche/i);

    const r = rimetti(cartella, { FILO_ROUTINE: '1' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /rimesso com'è nel commit/);
    assert.equal(git(cartella, 'status', '--porcelain'), '');
    const rebase = tenta(cartella, 'rebase', 'origin/main');
    assert.equal(rebase.status, 0, rebase.stderr);
    assert.equal(git(cartella, 'rev-parse', 'HEAD'), git(cartella, 'rev-parse', 'origin/main'));
    assert.equal(readFileSync(join(cartella, 'codice.txt'), 'utf8'), 'due\n');
  } finally {
    togliCartella(casa);
  }
});

// In cloud l'export di FILO_ROUTINE non arriva alla chiamata dopo (#1966): la routine la riconoscono gli strumenti fissati.
test('dagli strumenti fissati dal preflight, senza FILO_ROUTINE, il lockfile si rimette lo stesso', () => {
  const { casa, cartella } = giroDAvvio();
  try {
    comeNpmInstall(cartella);
    const pin = join(casa, 'strumenti');
    mkdirSync(pin);
    writeFileSync(join(pin, '.filo-repo-root'), cartella);
    const r = rimetti(cartella, { FILO_TOOLS_ROOT: pin, FILO_REPO_ROOT: '' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(git(cartella, 'status', '--porcelain'), '');
  } finally {
    togliCartella(casa);
  }
});

test('con il lockfile già pulito non tocca niente e lo dice', () => {
  const { casa, cartella } = giroDAvvio();
  try {
    const r = rimetti(cartella, { FILO_ROUTINE: '1' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /già com'è nel commit/);
    assert.equal(readFileSync(join(cartella, 'package-lock.json'), 'utf8'), lockfile('0.2.246'));
  } finally {
    togliCartella(casa);
  }
});

test('gli altri file sporchi restano: il rebase li deve ancora vedere', () => {
  const { casa, cartella } = giroDAvvio();
  try {
    comeNpmInstall(cartella);
    writeFileSync(join(cartella, 'codice.txt'), 'residuo\n');
    const r = rimetti(cartella, { FILO_ROUTINE: '1' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(git(cartella, 'status', '--porcelain'), 'M codice.txt');
    assert.equal(readFileSync(join(cartella, 'codice.txt'), 'utf8'), 'residuo\n');
  } finally {
    togliCartella(casa);
  }
});

test('fuori dalle routine non scarta niente', () => {
  const { casa, cartella } = giroDAvvio();
  try {
    comeNpmInstall(cartella);
    const r = rimetti(cartella, {});
    assert.equal(r.status, 1);
    assert.match(r.stderr, /solo nelle routine/);
    assert.equal(readFileSync(join(cartella, 'package-lock.json'), 'utf8'), lockfile('0.2.256'));
  } finally {
    togliCartella(casa);
  }
});

test('un lockfile in conflitto non si scioglie da qui', () => {
  const { casa, cartella, semina } = giroDAvvio();
  try {
    writeFileSync(join(semina, 'package-lock.json'), lockfile('0.2.300'));
    git(semina, 'commit', '-qam', 'lockfile su main');
    git(semina, 'push', '-q', join(casa, 'origine.git'), 'main');
    writeFileSync(join(cartella, 'package-lock.json'), lockfile('0.2.299'));
    git(cartella, 'commit', '-qam', 'lockfile qui');
    git(cartella, 'fetch', '-q', 'origin', 'main');
    assert.notEqual(tenta(cartella, 'rebase', 'origin/main').status, 0, 'serve un conflitto vero');
    const r = rimetti(cartella, { FILO_ROUTINE: '1' });
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /in conflitto/);
    assert.match(git(cartella, 'status', '--porcelain', '--', 'package-lock.json'), /^UU /);
  } finally {
    tenta(cartella, 'rebase', '--abort');
    togliCartella(casa);
  }
});

test('decidiLockfile: si rimette solo un lockfile che il commit ha e che non è in conflitto', () => {
  for (const riga of [' M package-lock.json', 'M  package-lock.json', 'MM package-lock.json', ' D package-lock.json', 'D  package-lock.json']) {
    assert.equal(decidiLockfile(riga), 'rimetti', riga);
  }
  for (const riga of ['UU package-lock.json', 'AA package-lock.json', 'DU package-lock.json', 'UD package-lock.json']) {
    assert.equal(decidiLockfile(riga), 'conflitto', riga);
  }
  for (const riga of ['?? package-lock.json', 'A  package-lock.json', 'AM package-lock.json']) {
    assert.equal(decidiLockfile(riga), 'fuori-dal-commit', riga);
  }
  for (const riga of ['', '\n', undefined, null]) assert.equal(decidiLockfile(riga), 'niente');
});

// Il preflight rimette il lockfile solo quando è l'unica cosa sporca: con altro accanto la cartella ferma il giro com'è.
test('sporcoSoloDalLockfile: vale solo per righe tutte del lockfile in cima al progetto', () => {
  for (const s of [' M package-lock.json', 'M package-lock.json', 'MM package-lock.json\n', ' D package-lock.json']) {
    assert.equal(sporcoSoloDalLockfile(s), true, JSON.stringify(s));
  }
  for (const s of ['', ' M package-lock.json\n M codice.txt', ' M sub/package-lock.json', '?? package-lock.json.bak', ' M package.json', 'M  "package-lock.json x"']) {
    assert.equal(sporcoSoloDalLockfile(s), false, JSON.stringify(s));
  }
});

test('orchestratore e sessione di un feedback rimettono il lockfile dopo il setup e prima del rebase', () => {
  for (const f of ['orchestrator.md', 'sessione.md']) {
    const t = espandiInclusioni(readFileSync(join(RUOLI, f), 'utf8'), RUOLI).replace(/\s+/g, ' ');
    const setup = t.search(/install con skip del binario Electron/);
    const passo = t.indexOf('node scripts/dispatch.mjs --rimetti-lockfile');
    const rebase = t.indexOf('git rebase origin/main');
    const biglietto = t.indexOf('node scripts/routine-channel.mjs ticket');
    assert.ok(setup > 0 && passo > 0 && rebase > 0 && biglietto > 0, `${f}: manca un passo`);
    assert.ok(setup < passo && passo < rebase && rebase < biglietto, `${f}: l'ordine è setup, lockfile, rebase, biglietto`);
  }
});
