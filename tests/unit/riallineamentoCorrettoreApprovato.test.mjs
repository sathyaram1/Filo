// Dopo un salto il server rimanda a chi riallinea il commit approvato (#1968), che il primo rebase ha tolto dai rami:
// la copia nuova del correttore deve averlo, o il confronto della consegna fallisce.

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

// Approvato, primo rebase spinto con la forza (il salto), main che va avanti ancora, copia nuova per il secondo.
const BASE = cartellaTemporanea('riallineamento-correttore-');
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
const APPROVATO = commit(work, 'b.js', 'lavoro\n', 'il lavoro approvato');
git(work, ['push', '-q', 'origin', 'worker/x']);
execFileSync('git', ['clone', '-q', `file://${origin}`, altro], { stdio: 'ignore' });
identita(altro);
commit(altro, 'c.js', 'da main\n', 'main avanza');
git(altro, ['push', '-q', 'origin', 'main']);
git(work, ['fetch', '-q', 'origin', 'main']);
git(work, ['rebase', '-q', 'origin/main']);
git(work, ['push', '-q', '--force', 'origin', 'worker/x']);
commit(altro, 'd.js', 'ancora main\n', 'main avanza ancora');
git(altro, ['push', '-q', 'origin', 'main']);
execFileSync('git', ['clone', '-q', '--branch', 'worker/x', `file://${origin}`, copia], { stdio: 'ignore' });

const STRUMENTI = cartellaTemporanea('riallineamento-correttore-strumenti-');
mkdirSync(join(STRUMENTI, 'routines', 'roles'), { recursive: true });
writeFileSync(join(STRUMENTI, 'routines', 'roles', 'resolver-rebase.md'), '# riallineamento\n');
const TEMP = cartellaTemporanea('riallineamento-correttore-tmp-');
Object.assign(process.env, {
  FILO_DISPATCH_STATE_DIR: cartellaTemporanea('riallineamento-correttore-stato-'),
  FILO_REPO_ROOT: copia,
  FILO_TOOLS_ROOT: STRUMENTI,
  CLAUDE_CONFIG_DIR: cartellaTemporanea('filo-claude-utente-'),
  TMPDIR: TEMP, TEMP, TMP: TEMP,
});
const { emit, serverCtx } = await import('../../scripts/dispatch.mjs');
const { readMarker } = await import('../../scripts/lib/routine-role.mjs');
const { fileRiscritti } = await import('../../scripts/lib/su-main.mjs');

test.after(() => { for (const d of [BASE, STRUMENTI, TEMP]) { try { togliCartella(d); } catch (_) {} } });

test('il correttore del secondo riallineamento riceve il commit approvato e lo confronta con la sua punta', () => {
  assert.throws(() => git(copia, ['cat-file', '-e', `${APPROVATO}^{commit}`]), 'la copia del correttore parte senza');
  const bucket = { role: 'fixer', id: 'x', num: '#9', branch: 'worker/x' };
  const [o, e] = [process.stdout.write, process.stderr.write];
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try { emit(bucket, serverCtx(bucket, { payload: { feedback: { text: 't' }, shaVerificato: APPROVATO } })); } finally {
    process.stdout.write = o; process.stderr.write = e;
  }
  const dal = readMarker(copia).dal;
  assert.equal(dal, APPROVATO);
  const c = fileRiscritti(copia, { prima: dal });
  assert.equal(c.ok, true, c.errore);
  assert.deepEqual(c.file, [], 'il rebase non ha cambiato la modifica del ramo');
});
