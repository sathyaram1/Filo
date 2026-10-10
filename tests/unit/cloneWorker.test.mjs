// Un clone per worker (#1157): origin giusto per costruzione, node_modules collegato e mai attraversato, chiavi
// d'accesso copiate senza stamparle, installazione privata solo se il lock cambia, rimozione che toglie prima il
// collegamento. Più il marcatore del worker, che non deve mai finire in un commit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import {
  MARCATORE_WORKER, allineaPacchetti, cartellaRegistro, chiaviAccesso, concorrenzaUnit, datiWorker, elencoCloni,
  preparaClone, stessoRemoto, togliClone,
} from '../../scripts/lib/clone-worker.mjs';
import { PINNED_PATHS, pinnedDirWorker, pinnedRepoRoot } from '../../scripts/lib/tools-pin.mjs';
import { SESSION_MARKERS } from '../../scripts/lib/branch-integrity.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
// Nessuna prova installa pacchetti davvero: con lo stesso lock non deve nemmeno provarci.
const npmMai = () => { throw new Error('npm ci lanciato con lo stesso package-lock'); };
const eLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch (_) { return false; } };

/** Origin nudo, principale clonato da lì con node_modules (e un canarino dentro), strumenti finti dell'orchestratore. */
function scena() {
  const base = cartellaTemporanea('filo-clone-worker-');
  const origin = resolve(base, 'origin.git');
  mkdirSync(origin);
  git(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  const principale = resolve(base, 'principale');
  execFileSync('git', ['clone', '-q', origin, principale], { stdio: 'ignore' });
  git(principale, ['config', 'core.autocrlf', 'false']);
  writeFileSync(resolve(principale, 'package-lock.json'), '{"lockfileVersion":3}\n', 'utf8');
  writeFileSync(resolve(principale, '.gitignore'), 'node_modules\n', 'utf8');
  git(principale, ['add', '-A']);
  git(principale, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base']);
  git(principale, ['push', '-q', 'origin', 'main']);
  mkdirSync(resolve(principale, 'node_modules', 'pacchetto'), { recursive: true });
  writeFileSync(resolve(principale, 'node_modules', 'pacchetto', 'canarino.txt'), 'vivo\n', 'utf8');
  const strumenti = resolve(base, 'strumenti-orchestratore');
  for (const p of PINNED_PATHS) {
    if (p.endsWith('.js')) { mkdirSync(dirname(resolve(strumenti, p)), { recursive: true }); writeFileSync(resolve(strumenti, p), '', 'utf8'); } else mkdirSync(resolve(strumenti, p), { recursive: true });
  }
  return { base, origin, principale, strumenti, basePin: resolve(base, 'pin'), canarino: resolve(principale, 'node_modules', 'pacchetto', 'canarino.txt') };
}

test('il clone nasce con l\'origin VERO del principale, node_modules collegato, marcatore, registro e strumenti suoi', () => {
  const s = scena();
  try {
    const dest = resolve(s.base, 'lavori', '1');
    const r = preparaClone(s.principale, 1, { dest, paralleli: 3, strumentiDa: s.strumenti, basePin: s.basePin, npmCi: npmMai });
    assert.equal(r.ok, true, r.why);
    assert.equal(r.pacchetti, 'collegati');
    const originClone = git(dest, ['remote', 'get-url', 'origin']);
    assert.ok(stessoRemoto(originClone, s.origin), `origin del clone: ${originClone}`);
    assert.ok(!stessoRemoto(originClone, s.principale), 'mai il percorso del principale: spedirebbe li\', in silenzio');
    assert.ok(collegato(dest), 'node_modules e\' una cartella sua con un collegamento per pacchetto');
    assert.ok(existsSync(resolve(dest, 'node_modules', 'pacchetto', 'canarino.txt')), 'che porta a quello del principale');
    assert.deepEqual(JSON.parse(readFileSync(resolve(dest, MARCATORE_WORKER), 'utf8')).indice, 1);
    assert.deepEqual(datiWorker({ env: {}, root: dest }), { indice: 1, paralleli: 3 });
    assert.equal(git(dest, ['status', '--porcelain']), '', 'ne\' il marcatore ne\' il collegamento finiscono in un commit');
    assert.deepEqual(elencoCloni(s.principale).map((c) => [c.indice, resolve(c.cartella)]), [[1, dest]], 'il registro lo conosce');
    assert.ok(cartellaRegistro(s.principale).startsWith(resolve(s.principale, '.git')), 'e sta dentro la .git del principale');
    assert.equal(r.strumenti, pinnedDirWorker(1, s.basePin));
    assert.equal(pinnedRepoRoot(r.strumenti), dest, 'gli strumenti del worker conoscono il suo clone');

    const di = preparaClone(s.principale, 1, { dest, paralleli: 3, strumentiDa: s.strumenti, basePin: s.basePin, npmCi: npmMai });
    assert.equal(di.ok, true, `rilanciato riprende lo stesso clone: ${di.why}`);
  } finally {
    togliCartella(s.base);
  }
});

test('le chiavi d\'accesso locali passano al clone, e non si stampano mai', () => {
  const s = scena();
  try {
    git(s.principale, ['config', 'http.https://example.invalid/.extraheader', 'AUTHORIZATION: basic SEGRETO-1157']);
    git(s.principale, ['config', 'credential.helper', 'store --file=/nessuno']);
    const dest = resolve(s.base, 'lavori', '2');
    const env = { ...process.env, FILO_REPO_ROOT: s.principale, FILO_TOOLS_DIR: s.basePin, FILO_CLONI_DIR: resolve(s.base, 'lavori') };
    const cli = spawnSync(process.execPath, [resolve(ROOT, 'scripts', 'clone-worker.mjs'), 'prepara', '2', '--dest', dest], { encoding: 'utf8', env });
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    assert.equal(JSON.parse(cli.stdout.trim()).ok, true);
    assert.doesNotMatch(cli.stdout + cli.stderr, /SEGRETO/, 'il valore non compare in nessuna uscita');
    assert.equal(git(dest, ['config', '--get', 'http.https://example.invalid/.extraheader']), 'AUTHORIZATION: basic SEGRETO-1157');
    assert.equal(git(dest, ['config', '--get', 'credential.helper']), 'store --file=/nessuno');
    const tolto = spawnSync(process.execPath, [resolve(ROOT, 'scripts', 'clone-worker.mjs'), 'togli', '2'], { encoding: 'utf8', env });
    assert.equal(tolto.status, 0, tolto.stdout + tolto.stderr);
    assert.ok(!existsSync(dest));
  } finally {
    togliCartella(s.base);
  }
});

test('package-lock diverso dal principale: installazione privata, e il node_modules del principale non si tocca', () => {
  const s = scena();
  try {
    const dest = resolve(s.base, 'lavori', '1');
    assert.equal(preparaClone(s.principale, 1, { dest, strumentiDa: s.strumenti, basePin: s.basePin, npmCi: npmMai }).ok, true);
    let chiamate = 0;
    const npmCi = (cartella) => { chiamate += 1; mkdirSync(resolve(cartella, 'node_modules', 'privato'), { recursive: true }); return { ok: true }; };
    assert.equal(allineaPacchetti(dest, s.principale, { npmCi }).pacchetti, 'collegati', 'stesso lock: collegati');
    assert.equal(chiamate, 0);
    writeFileSync(resolve(dest, 'package-lock.json'), '{"lockfileVersion":3,"nuovo":true}\n', 'utf8');
    const r = allineaPacchetti(dest, s.principale, { npmCi });
    assert.equal(r.pacchetti, 'privati');
    assert.equal(chiamate, 1);
    assert.ok(!eLink(resolve(dest, 'node_modules')), 'un node_modules suo, non il collegamento');
    assert.ok(existsSync(s.canarino), 'il principale ha ancora i suoi pacchetti');
    assert.ok(!existsSync(resolve(s.principale, 'node_modules', 'privato')), 'e l\'installazione privata non e\' finita li\'');
    git(dest, ['checkout', '--', 'package-lock.json']);
    assert.equal(allineaPacchetti(dest, s.principale, { npmCi }).pacchetti, 'collegati', 'tornato uguale: di nuovo collegati');
    assert.ok(eLink(resolve(dest, 'node_modules')));
  } finally {
    togliCartella(s.base);
  }
});

test('la rimozione toglie il collegamento PRIMA della cartella: il principale resta intero', () => {
  const s = scena();
  try {
    const dest = resolve(s.base, 'lavori', '1');
    const r = preparaClone(s.principale, 1, { dest, strumentiDa: s.strumenti, basePin: s.basePin, npmCi: npmMai });
    assert.equal(r.ok, true, r.why);
    const t = togliClone(s.principale, 1, { basePin: s.basePin });
    assert.equal(t.ok, true, t.why);
    assert.ok(!existsSync(dest), 'il clone non c\'e\' piu\'');
    assert.ok(existsSync(s.canarino), 'il node_modules del principale e\' intatto');
    assert.deepEqual(elencoCloni(s.principale), [], 'la voce del registro se ne va');
    assert.ok(!existsSync(r.strumenti), 'e gli strumenti del worker pure');

    const estranea = resolve(s.base, 'estranea');
    mkdirSync(estranea, { recursive: true });
    writeFileSync(resolve(estranea, 'cosa.txt'), 'x\n', 'utf8');
    const no = togliClone(s.principale, 3, { dest: estranea, basePin: s.basePin });
    assert.equal(no.ok, false, 'una cartella senza il marcatore del worker non si toglie');
    assert.ok(existsSync(resolve(estranea, 'cosa.txt')));
    assert.equal(preparaClone(s.principale, 3, { dest: estranea, strumentiDa: s.strumenti, basePin: s.basePin, npmCi: npmMai }).ok, false, 'e non si usa come clone');
  } finally {
    togliCartella(s.base);
  }
});

test('la misura di K, fuori dal registro, non toglie il worker vero che ha lo stesso numero', () => {
  const s = scena();
  try {
    const vero = resolve(s.base, 'lavori', '1');
    assert.equal(preparaClone(s.principale, 1, { dest: vero, strumentiDa: s.strumenti, basePin: s.basePin, npmCi: npmMai }).ok, true);
    const registrati = () => elencoCloni(s.principale).map((c) => resolve(c.cartella));
    const pinMisura = resolve(s.base, 'pin-misura');
    const misura = resolve(s.base, 'misura', 'clone-1');
    const m = preparaClone(s.principale, 1, { dest: misura, strumentiDa: s.strumenti, basePin: pinMisura, npmCi: npmMai, registra: false });
    assert.equal(m.ok, true, m.why);
    assert.deepEqual(registrati(), [vero], 'il clone della misura non entra nel registro');
    assert.equal(togliClone(s.principale, 1, { dest: misura, basePin: pinMisura, registra: false }).ok, true);
    assert.deepEqual(registrati(), [vero], 'e togliendolo il worker vero resta');

    const altro = resolve(s.base, 'altro', '1');
    assert.equal(preparaClone(s.principale, 1, { dest: altro, strumentiDa: s.strumenti, basePin: pinMisura, npmCi: npmMai, registra: false }).ok, true);
    assert.equal(togliClone(s.principale, 1, { dest: altro, basePin: pinMisura }).ok, true);
    assert.deepEqual(registrati(), [vero], 'una voce che punta a un\'altra cartella non se ne va col dest di qualcun altro');
    assert.ok(existsSync(s.canarino));

    assert.equal(togliClone(s.principale, 1, { basePin: s.basePin }).ok, true);
    assert.deepEqual(registrati(), [], 'il worker vero, tolto lui, esce dal registro');
  } finally {
    togliCartella(s.base);
  }
});

test('stessoRemoto, chiaviAccesso, datiWorker, concorrenzaUnit: le parti pure', () => {
  assert.ok(stessoRemoto('https://github.com/Sathyaram1/Filo.git', 'https://github.com/sathyaram1/filo/'));
  assert.ok(!stessoRemoto('https://github.com/sathyaram1/filo', 'C:/Users/x/Filo'));
  assert.ok(!stessoRemoto('', ''), 'nessun origin non e\' lo stesso origin');
  const voci = chiaviAccesso('core.autocrlf\nfalse\0http.https://github.com/.extraheader\nAUTHORIZATION: x y\0credential.helper\nstore\0user.name\nio\0');
  assert.deepEqual(voci, [['http.https://github.com/.extraheader', 'AUTHORIZATION: x y'], ['credential.helper', 'store']]);
  assert.deepEqual(datiWorker({ env: { FILO_WORKER: '2', FILO_WORKER_PARALLELI: '4' } }), { indice: 2, paralleli: 4 });
  assert.equal(datiWorker({ env: {} }), null, 'fuori da un clone di worker: niente');
  assert.equal(datiWorker({ env: { FILO_WORKER: 'x' } }), null);
  assert.equal(concorrenzaUnit(4, 16), 4);
  assert.equal(concorrenzaUnit(3, 2), 1);
  assert.equal(concorrenzaUnit(1, 16), 0, 'un worker solo: decide node');
});

test('il marcatore del worker e\' un file di sessione: in .gitignore e fra i marcatori esclusi', () => {
  assert.ok(SESSION_MARKERS.includes(MARCATORE_WORKER));
  const ignorati = readFileSync(resolve(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
  assert.ok(ignorati.includes(MARCATORE_WORKER), `${MARCATORE_WORKER} manca in .gitignore`);
});
