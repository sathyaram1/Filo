// Un riallineamento registrato senza arrivare su origin lascia il ramo al commit verificato (#2101): chi verifica deve
// sapere che il rebase dichiarato nel report non c'è, invece di cercare un confronto o rifare prove già fatte.

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const identita = (dir) => {
  git(dir, ['config', 'user.email', 't@t']); git(dir, ['config', 'user.name', 't']); git(dir, ['config', 'commit.gpgsign', 'false']);
};
const commit = (dir, file, testo, msg) => {
  writeFileSync(join(dir, file), testo);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', msg]);
  return git(dir, ['rev-parse', 'HEAD']);
};
const clona = (dir) => {
  execFileSync('git', ['clone', '-q', '--branch', 'worker/x', `file://${origin}`, dir], { stdio: 'ignore' });
  identita(dir);
};

// Il lavoro verificato su origin, main che va avanti, e il rebase che non arriva mai: la copia di chi verifica è al
// commit verificato, su una base che non contiene il main nominato nel report.
const BASE = cartellaTemporanea('riallineamento-non-arrivato-');
const origin = join(BASE, 'origin.git');
const work = join(BASE, 'work');
const altro = join(BASE, 'altro');
const copia = join(BASE, 'copia');
const riallineata = join(BASE, 'riallineata');
const sopra = join(BASE, 'sopra');
mkdirSync(origin); mkdirSync(work);
git(origin, ['init', '--bare', '-q', '--initial-branch=main']);
git(work, ['init', '-q', '--initial-branch=main']);
identita(work);
git(work, ['remote', 'add', 'origin', `file://${origin}`]);
writeFileSync(join(work, '.gitignore'), '.claude/\n');
const INIZIO = commit(work, 'a.js', 'uno\n', 'inizio');
git(work, ['push', '-q', 'origin', 'main']);
git(work, ['checkout', '-qb', 'worker/x']);
const VERIFICATO = commit(work, 'b.js', 'lavoro\n', 'il lavoro di #9');
git(work, ['push', '-q', 'origin', 'worker/x']);
execFileSync('git', ['clone', '-q', `file://${origin}`, altro], { stdio: 'ignore' });
identita(altro);
const MAIN = commit(altro, 'c.js', 'da main\n', 'arrivato su main');
git(altro, ['push', '-q', 'origin', 'main']);
clona(copia);
clona(riallineata);
git(riallineata, ['rebase', '-q', 'origin/main']);
clona(sopra);
commit(sopra, 'd.js', 'altro\n', 'spinto senza rebase');

const REPORT = `Riallineato su main (${MAIN.slice(0, 9)}), prima era su ${INIZIO.slice(0, 9)}. Conflitto in b.js, solo meccanico.`;

const STRUMENTI = cartellaTemporanea('riallineamento-non-arrivato-strumenti-');
mkdirSync(join(STRUMENTI, 'routines', 'roles'), { recursive: true });
writeFileSync(join(STRUMENTI, 'routines', 'roles', 'verifier-riallineamento.md'), '# verifica dopo il riallineamento\n');
const TEMP = cartellaTemporanea('riallineamento-non-arrivato-tmp-');
Object.assign(process.env, {
  FILO_DISPATCH_STATE_DIR: cartellaTemporanea('riallineamento-non-arrivato-stato-'),
  FILO_REPO_ROOT: copia,
  FILO_TOOLS_ROOT: STRUMENTI,
  CLAUDE_CONFIG_DIR: cartellaTemporanea('filo-claude-utente-'),
  TMPDIR: TEMP, TEMP, TMP: TEMP,
});
const { emit, serverCtx, riallineamentoMancante, perimetroNote } = await import('../../scripts/dispatch.mjs');

test.after(() => { for (const d of [BASE, STRUMENTI, TEMP]) { try { togliCartella(d); } catch (_) {} } });

function consegna(perimetro) {
  const bucket = { role: 'verifier', id: 'x', num: '#9', branch: 'worker/x' };
  let out = '';
  let err = '';
  const [o, e] = [process.stdout.write, process.stderr.write];
  process.stdout.write = (s) => { out += s; return true; };
  process.stderr.write = (s) => { err += s; return true; };
  try { emit(bucket, serverCtx(bucket, { payload: { feedback: { text: 't' }, scope: 'riallineamento', perimetro } })); } finally {
    process.stdout.write = o; process.stderr.write = e;
  }
  return { ...JSON.parse(out), err };
}

test('sulla punta verificata senza il rebase dichiarato il compito dice che non c\'è niente da verificare', () => {
  const r = consegna({ shaVerificato: VERIFICATO, reportRebase: REPORT });
  assert.match(r.instructions, /Il riallineamento non è su questo ramo/);
  assert.ok(r.instructions.includes(`\`${MAIN.slice(0, 9)}\``), 'il compito nomina il commit di main che manca');
  assert.ok(!r.instructions.includes(`\`${INIZIO.slice(0, 9)}\``), 'la vecchia base è contenuta: non manca');
  assert.match(r.instructions, /registra la critica senza rilievi/);
  assert.doesNotMatch(r.instructions, /Il confronto manca: dichiaralo nella critica/, 'niente rilievo da chiedere su un rebase che non c\'è');
  assert.match(r.err, /il rebase non è arrivato su origin/);
});

test('un rebase arrivato non fa scattare niente', () => {
  assert.deepEqual(riallineamentoMancante(REPORT, riallineata), []);
  const n = perimetroNote('riallineamento', { shaVerificato: VERIFICATO, reportRebase: REPORT }, { mancante: riallineamentoMancante(REPORT, riallineata) });
  assert.doesNotMatch(n, /non è su questo ramo/);
  assert.match(n, new RegExp(`git diff ${VERIFICATO}\\.\\.HEAD`));
});

test('commit nuovi sopra la vecchia base: si verificano, e il rebase mancante è un rilievo interno', () => {
  const mancante = riallineamentoMancante(REPORT, sopra);
  assert.deepEqual(mancante, [MAIN.slice(0, 9)]);
  const n = perimetroNote('riallineamento', { shaVerificato: VERIFICATO, reportRebase: REPORT }, { mancante });
  assert.match(n, /Il riallineamento non è su questo ramo/);
  assert.match(n, /rilievo interno di livello 2/);
  assert.match(n, new RegExp(`git diff ${VERIFICATO}\\.\\.HEAD`), 'il diff da provare resta');
});

test('senza commit di main nel report, o senza git, non si giudica', () => {
  assert.deepEqual(riallineamentoMancante('conflitto in b.js, solo meccanico', copia), []);
  assert.deepEqual(riallineamentoMancante(REPORT, STRUMENTI), []);
  assert.deepEqual(riallineamentoMancante(`il ramo era a ${VERIFICATO.slice(0, 9)} e a ${'f'.repeat(12)}`, copia), [], 'commit fuori da main o sconosciuti');
  assert.deepEqual(riallineamentoMancante(undefined, copia), []);
});
