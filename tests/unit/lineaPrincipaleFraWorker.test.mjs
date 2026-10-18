// Fra un worker e l'altro la cartella torna su main: gli agenti (e il loro sforzo) li legge la sessione dalla
// cartella, e un ramo nato prima dell'ultima modifica li riporterebbe indietro (verifica sforzo-ruoli, giro 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { prepareBranch } from '../../scripts/lib/branch-integrity.mjs';

const DISPATCH = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'dispatch.mjs');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const agente = (dir, nome, sforzo) => {
  mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'agents', `${nome}.md`), `---\nname: ${nome}\nmodel: opus\neffort: ${sforzo}\n---\n`);
};
const sforzi = (dir) => Object.fromEntries(['routine-nuovo-lavoro', 'routine-worker', 'routine-secaudit'].map((n) => {
  const f = join(dir, '.claude', 'agents', `${n}.md`);
  return [n, existsSync(f) ? (readFileSync(f, 'utf8').match(/^effort:\s*(\S+)/m) || [])[1] : 'assente'];
}));

function giroConRamoVecchio() {
  const casa = cartellaTemporanea('filo-linea-principale-');
  const origine = join(casa, 'origine.git');
  const semina = join(casa, 'semina');
  const clone = join(casa, 'clone');
  git(casa, 'init', '-q', '--bare', origine);
  mkdirSync(semina);
  git(semina, 'init', '-q', '-b', 'main');
  git(semina, 'config', 'user.email', 't@t');
  git(semina, 'config', 'user.name', 't');
  agente(semina, 'routine-worker', 'xhigh');
  agente(semina, 'routine-secaudit', 'xhigh');
  writeFileSync(join(semina, 'codice.txt'), 'uno\n');
  git(semina, 'add', '-A');
  git(semina, 'commit', '-qm', 'agenti vecchi');
  git(semina, 'branch', 'worker/vecchio');
  agente(semina, 'routine-nuovo-lavoro', 'xhigh');
  agente(semina, 'routine-worker', 'high');
  agente(semina, 'routine-secaudit', 'high');
  git(semina, 'add', '-A');
  git(semina, 'commit', '-qm', 'sforzo per ruolo');
  git(semina, 'push', '-q', origine, 'main', 'worker/vecchio');
  git(casa, 'clone', '-q', origine, clone);
  git(clone, 'config', 'user.email', 't@t');
  git(clone, 'config', 'user.name', 't');
  // Il worker di prima: posizionato sul ramo vecchio, e morto lasciando una modifica non salvata.
  const r = prepareBranch({ root: clone, branch: 'worker/vecchio', mainBranch: 'main' });
  assert.equal(r.ok, true, r.message);
  writeFileSync(join(clone, 'codice.txt'), 'residuo\n');
  return { casa, clone };
}

const lancia = (clone, extra) => spawnSync(process.execPath, [DISPATCH, '--linea-principale'], {
  encoding: 'utf8',
  env: { ...process.env, FILO_REPO_ROOT: clone, FILO_DISPATCH_STATE_DIR: join(clone, '..', 'stato'), FILO_NO_BEAT: '1', FILO_ROUTINE: '', ...extra },
});

test('dopo un worker su un ramo vecchio, il prossimo parte con gli agenti di main', () => {
  const { casa, clone } = giroConRamoVecchio();
  try {
    assert.deepEqual(sforzi(clone), { 'routine-nuovo-lavoro': 'assente', 'routine-worker': 'xhigh', 'routine-secaudit': 'xhigh' });
    const r = lancia(clone, { FILO_ROUTINE: '1' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(git(clone, 'branch', '--show-current'), 'main');
    assert.deepEqual(sforzi(clone), { 'routine-nuovo-lavoro': 'xhigh', 'routine-worker': 'high', 'routine-secaudit': 'high' });
  } finally {
    togliCartella(casa);
  }
});

test('fuori dalle routine non scarta niente', () => {
  const { casa, clone } = giroConRamoVecchio();
  try {
    const r = lancia(clone, {});
    assert.equal(r.status, 1);
    assert.equal(git(clone, 'branch', '--show-current'), 'worker/vecchio');
    assert.equal(readFileSync(join(clone, 'codice.txt'), 'utf8'), 'residuo\n');
  } finally {
    togliCartella(casa);
  }
});

test("l'orchestratore riporta la cartella su main dopo ogni worker, prima del biglietto", () => {
  const testo = readFileSync(resolve(dirname(DISPATCH), '..', 'routines', 'roles', 'orchestrator.md'), 'utf8');
  const loop = testo.slice(testo.indexOf('## Loop'), testo.indexOf('## Chiusura'));
  const torna = loop.indexOf('node scripts/dispatch.mjs --linea-principale');
  assert.ok(torna > 0, 'il passo manca nel loop');
  assert.ok(torna < loop.indexOf('Chiedi un biglietto nuovo'), 'deve venire prima del biglietto, e quindi dello spawn');
});
