// Verifica #2101 giro 2: il report di chi ha rifatto la base non scrive lo sha di main e il rebase non è sul ramo.
// Chi verifica deve saperlo come nel caso con lo sha, qualunque sia l'età della punta e anche con commit sopra.
import '../../helpers/senzaSessione.mjs';
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const git = (dir, args, quando) => execFileSync('git', ['-C', dir, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ...(quando ? { GIT_COMMITTER_DATE: quando, GIT_AUTHOR_DATE: quando } : {}) },
}).trim();
const identita = (dir) => { git(dir, ['config', 'user.email', 't@t']); git(dir, ['config', 'user.name', 't']); git(dir, ['config', 'commit.gpgsign', 'false']); };
const commit = (dir, file, testo, msg, quando) => { writeFileSync(join(dir, file), testo); git(dir, ['add', '-A']); git(dir, ['commit', '-qm', msg], quando); return git(dir, ['rev-parse', 'HEAD']); };

const DIRS = [];
const tmp = (p) => { const d = cartellaTemporanea(p); DIRS.push(d); return d; };
const STRUMENTI = tmp('verifica-2101-strumenti-');
const TEMP = tmp('verifica-2101-tmp-');
// dispatch fissa la radice all'import: ogni scenario ricostruisce la copia nello stesso posto.
const COPIA = join(tmp('verifica-2101-copia-'), 'copia');
mkdirSync(join(STRUMENTI, 'routines', 'roles'), { recursive: true });
writeFileSync(join(STRUMENTI, 'routines', 'roles', 'verifier-riallineamento.md'), '# verifica dopo il riallineamento\n');
Object.assign(process.env, {
  FILO_DISPATCH_STATE_DIR: tmp('verifica-2101-stato-'),
  FILO_REPO_ROOT: COPIA, FILO_TOOLS_ROOT: STRUMENTI, TMPDIR: TEMP, TEMP, TMP: TEMP,
});
test.afterAll(() => { for (const d of DIRS) { try { togliCartella(d); } catch (_) {} } });

// Lavoro verificato, poi main va avanti; la copia di chi verifica è il ramo su origin, più gli eventuali commit sopra.
function scenario({ date = {}, sopra = false } = {}) {
  const BASE = tmp('verifica-2101-');
  const origin = join(BASE, 'origin.git'); const work = join(BASE, 'work'); const altro = join(BASE, 'altro');
  mkdirSync(origin); mkdirSync(work);
  git(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  git(work, ['init', '-q', '--initial-branch=main']); identita(work);
  git(work, ['remote', 'add', 'origin', `file://${origin}`]);
  writeFileSync(join(work, '.gitignore'), '.claude/\n');
  commit(work, 'a.js', 'uno\n', 'inizio', date.inizio);
  git(work, ['push', '-q', 'origin', 'main']);
  execFileSync('git', ['clone', '-q', `file://${origin}`, altro], { stdio: 'ignore' }); identita(altro);
  const MAIN = commit(altro, 'c.js', 'da main\n', 'arrivato su main', date.main);
  git(altro, ['push', '-q', 'origin', 'main']);
  git(work, ['checkout', '-qb', 'worker/x']);
  const VERIFICATO = commit(work, 'b.js', 'lavoro\n', 'il lavoro di #9', date.verificato);
  git(work, ['push', '-q', 'origin', 'worker/x']);
  rmSync(COPIA, { recursive: true, force: true });
  execFileSync('git', ['clone', '-q', '--branch', 'worker/x', `file://${origin}`, COPIA], { stdio: 'ignore' }); identita(COPIA);
  if (sopra) commit(COPIA, 'b.js', 'lavoro sistemato\n', 'risolto il conflitto', date.sopra);
  return { VERIFICATO, MAIN };
}

async function compito(perimetro) {
  const { emit, serverCtx } = await import('../../../scripts/dispatch.mjs');
  const bucket = { role: 'verifier', id: 'x', num: '#9', branch: 'worker/x' };
  let out = '';
  const o = process.stdout.write; const e = process.stderr.write;
  process.stdout.write = (s) => { out += s; return true; };
  process.stderr.write = () => true;
  try { emit(bucket, serverCtx(bucket, { payload: { feedback: { text: 't' }, scope: 'riallineamento', perimetro } })); } finally {
    process.stdout.write = o; process.stderr.write = e;
  }
  return JSON.parse(out).instructions;
}

const SENZA_SHA = 'Riallineato su main attuale. Conflitto in b.js, solo meccanico. Unit tutti verdi.';

test('r1 sulla punta verificata scritta poco dopo che main era andato avanti, il compito dice che il riallineamento non c\'è', async () => {
  const { VERIFICATO } = scenario();
  expect(await compito({ shaVerificato: VERIFICATO, reportRebase: SENZA_SHA })).toMatch(/Il riallineamento non è su questo ramo/);
});

test('r1 con commit sopra la vecchia base e un report senza sha, il compito dice che il riallineamento non c\'è, come con lo sha', async () => {
  const date = { inizio: '2026-10-01T10:00:00Z', main: '2026-10-02T10:00:00Z', verificato: '2026-10-05T10:00:00Z', sopra: '2026-10-08T10:00:00Z' };
  const { VERIFICATO, MAIN } = scenario({ date, sopra: true });
  expect(await compito({ shaVerificato: VERIFICATO, reportRebase: `Riallineato su main (${MAIN.slice(0, 9)}). Conflitto in b.js.` }))
    .toMatch(/Il riallineamento non è su questo ramo/);
  expect(await compito({ shaVerificato: VERIFICATO, reportRebase: SENZA_SHA })).toMatch(/Il riallineamento non è su questo ramo/);
});
