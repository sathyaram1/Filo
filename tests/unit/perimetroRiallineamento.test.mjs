// Chi verifica un riallineamento legge il diff dal commit che aveva passato la verifica (#1968): se quello che arriva
// è già la punta riallineata il diff è vuoto, e il compito deve dirlo invece di promettere un confronto che non c'è.

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

// Il lavoro verificato su origin, main che va avanti, il rebase spinto con la forza, e la copia nuova di chi verifica:
// lì il commit verificato non arriva col clone, perché nessun ramo lo contiene più.
const BASE = cartellaTemporanea('perimetro-riallineamento-');
const origin = join(BASE, 'origin.git');
const work = join(BASE, 'work');
const altro = join(BASE, 'altro');
const copia = join(BASE, 'copia');
mkdirSync(origin); mkdirSync(work);
git(origin, ['init', '--bare', '-q', '--initial-branch=main']);
git(origin, ['config', 'uploadpack.allowAnySHA1InWant', 'true']);
git(work, ['init', '-q', '--initial-branch=main']);
identita(work);
git(work, ['remote', 'add', 'origin', `file://${origin}`]);
writeFileSync(join(work, '.gitignore'), '.claude/\n');
commit(work, 'a.js', 'uno\n', 'inizio');
git(work, ['push', '-q', 'origin', 'main']);
git(work, ['checkout', '-qb', 'worker/x']);
const VERIFICATO = commit(work, 'b.js', 'lavoro\n', 'il lavoro di #9');
git(work, ['push', '-q', 'origin', 'worker/x']);
execFileSync('git', ['clone', '-q', `file://${origin}`, altro], { stdio: 'ignore' });
identita(altro);
commit(altro, 'c.js', 'da main\n', 'arrivato su main');
git(altro, ['push', '-q', 'origin', 'main']);
git(work, ['fetch', '-q', 'origin', 'main']);
git(work, ['rebase', '-q', 'origin/main']);
const RIALLINEATO = git(work, ['rev-parse', 'HEAD']);
git(work, ['push', '-q', '--force', 'origin', 'worker/x']);
execFileSync('git', ['clone', '-q', '--branch', 'worker/x', `file://${origin}`, copia], { stdio: 'ignore' });

const STRUMENTI = cartellaTemporanea('perimetro-riallineamento-strumenti-');
mkdirSync(join(STRUMENTI, 'routines', 'roles'), { recursive: true });
writeFileSync(join(STRUMENTI, 'routines', 'roles', 'verifier-riallineamento.md'), '# verifica dopo il riallineamento\n');
const TEMP = cartellaTemporanea('perimetro-riallineamento-tmp-');
Object.assign(process.env, {
  FILO_DISPATCH_STATE_DIR: cartellaTemporanea('perimetro-riallineamento-stato-'),
  FILO_REPO_ROOT: copia,
  FILO_TOOLS_ROOT: STRUMENTI,
  CLAUDE_CONFIG_DIR: cartellaTemporanea('filo-claude-utente-'),
  TMPDIR: TEMP, TEMP, TMP: TEMP,
});
const { emit, serverCtx, esaminaShaVerificato, perimetroNote } = await import('../../scripts/dispatch.mjs');
const { readMarker } = await import('../../scripts/lib/routine-role.mjs');

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

test('il commit «verificato» che è la punta riallineata non promette un diff, e non va nel marcatore', () => {
  const r = consegna({ shaVerificato: RIALLINEATO, reportRebase: 'conflitto in b.js' });
  assert.match(r.instructions, /# verifica dopo il riallineamento/);
  assert.match(r.instructions, /è la punta di questo ramo: il diff da lì a `HEAD` è vuoto/);
  assert.match(r.instructions, /Il confronto manca: dichiaralo nella critica/);
  assert.ok(!r.instructions.includes(`git diff ${RIALLINEATO}..HEAD`), 'un diff vuoto non si consegna come confronto');
  assert.match(r.instructions, /> conflitto in b\.js/);
  assert.equal(readMarker(copia).dal, undefined, 'finish:check non deve scegliere gli spec da un confronto vuoto');
  assert.match(r.err, /è la punta del ramo/);
});

test('il commit verificato che un rebase ha tolto dai rami si scarica, e il confronto mostra cosa è cambiato', () => {
  assert.throws(() => git(copia, ['cat-file', '-e', `${VERIFICATO}^{commit}`]), 'la copia di chi verifica parte senza');
  const r = consegna({ shaVerificato: VERIFICATO });
  assert.match(r.instructions, new RegExp(`il diff da leggere è \`git diff ${VERIFICATO}\\.\\.HEAD\``));
  assert.equal(readMarker(copia).dal, VERIFICATO);
  assert.deepEqual(git(copia, ['diff', '--name-only', VERIFICATO, 'HEAD']).split('\n'), ['c.js']);
  assert.equal(r.err, '');
});

test('un commit verificato che origin non ha: il compito lo dice e indica come riprovare', () => {
  const ignoto = 'f'.repeat(40);
  assert.equal(esaminaShaVerificato(ignoto, copia), 'assente');
  const r = consegna({ shaVerificato: ignoto });
  assert.match(r.instructions, /in questa copia non c'è e da origin non è arrivato/);
  assert.match(r.instructions, new RegExp(`git fetch origin ${ignoto}`));
  assert.equal(readMarker(copia).dal, ignoto, 'finish:check ritenta da sé, e dice se non arriva');
});

test('senza git che risponde non si scarta niente: non aver potuto guardare non è un commit sbagliato', () => {
  assert.equal(esaminaShaVerificato(RIALLINEATO, STRUMENTI), '');
  assert.equal(esaminaShaVerificato('abc; rm -rf .', copia), '');
  assert.equal(esaminaShaVerificato(RIALLINEATO, copia), 'punta');
  assert.equal(esaminaShaVerificato(RIALLINEATO.slice(0, 10), copia), 'punta');
});

test('senza report e senza confronto, il compito dice dove cercare le zone', () => {
  const n = perimetroNote('riallineamento', { shaVerificato: RIALLINEATO }, { scartato: 'punta' });
  assert.match(n, /nessun report e nessun confronto/);
  assert.match(n, /git diff --stat origin\/main\.\.\.HEAD/);
  const conDiff = perimetroNote('riallineamento', { shaVerificato: VERIFICATO });
  assert.match(conDiff, /nessun report: le zone in conflitto le ricavi dal diff/);
});
