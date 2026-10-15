// I titoli `#<numero>` dei commit sopravvivono a un rebase con conflitto (#762): il carattere di commento si imposta
// dove nasce la copia di lavoro (routine, clone dei worker, sessione, orchestratore locale), mai nelle ricette.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { CARATTERE_COMMENTO, carattereSicuro, ensureCommentChar, valoreEffettivo } from '../../scripts/lib/carattere-commento.mjs';
import { prepareBranch } from '../../scripts/lib/branch-integrity.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fatte = [];
test.after(() => { for (const d of fatte) { try { togliCartella(d); } catch (_) { /* best-effort */ } } });

// Una config globale vuota: quella della macchina che lancia non deve decidere l'esito.
const globale = cartellaTemporanea('filo-commento-globale-');
fatte.push(globale);
writeFileSync(join(globale, 'gitconfig'), '[user]\n\tname = t\n\temail = t@t\n[commit]\n\tgpgsign = false\n[core]\n\tautocrlf = false\n', 'utf8');
process.env.GIT_CONFIG_GLOBAL = join(globale, 'gitconfig');
process.env.GIT_CONFIG_NOSYSTEM = '1';

const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }).trim();
const carattere = (cwd) => { try { return git(cwd, ['config', '--get', 'core.commentChar']); } catch (_) { return ''; } };
function scrivi(dir, testo, messaggio) {
  writeFileSync(join(dir, 'f.txt'), testo, 'utf8');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', messaggio]);
}

/** Origin con `worker/x` (due commit `#n`, uno di solo titolo) e `main` andata avanti sulla stessa riga. */
function scena() {
  const base = cartellaTemporanea('filo-commento-');
  fatte.push(base);
  const origin = join(base, 'origin.git');
  const prima = join(base, 'prima');
  mkdirSync(origin); mkdirSync(prima);
  git(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  git(prima, ['init', '-q', '--initial-branch=main']);
  git(prima, ['remote', 'add', 'origin', origin]);
  scrivi(prima, 'base\n', 'base');
  git(prima, ['push', '-q', 'origin', 'main']);
  git(prima, ['checkout', '-q', '-b', 'worker/x']);
  scrivi(prima, 'lavoro\n', '#762 Titoli salvi nel rebase');
  scrivi(prima, 'lavoro due\n', '#763 Secondo passo\n\nIl corpo resta.');
  git(prima, ['push', '-q', 'origin', 'worker/x']);
  git(prima, ['checkout', '-q', 'main']);
  scrivi(prima, 'main\n', 'main va avanti');
  git(prima, ['push', '-q', 'origin', 'main']);
  return { base, origin };
}

/** Il rebase che le ricette consigliano, con un conflitto a ogni commit e l'editor che conferma il messaggio com'è. */
function rebaseConConflitti(dir) {
  git(dir, ['fetch', '-q', 'origin', 'main']);
  let r = spawnSync('git', ['rebase', 'origin/main'], { cwd: dir, encoding: 'utf8' });
  for (let giro = 0; r.status !== 0 && giro < 4; giro++) {
    writeFileSync(join(dir, 'f.txt'), `tutte e due ${giro}\n`, 'utf8');
    git(dir, ['add', 'f.txt']);
    r = spawnSync('git', ['rebase', '--continue'], { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_EDITOR: 'true' } });
  }
  return r;
}

function assertTitoliSalvi(dir, r) {
  assert.equal(r.status, 0, `il rebase deve arrivare in fondo: ${r.stdout}${r.stderr}`);
  assert.deepEqual(git(dir, ['log', '-3', '--format=%s']).split('\n'), ['#763 Secondo passo', '#762 Titoli salvi nel rebase', 'main va avanti']);
  assert.equal(git(dir, ['log', '-1', '--format=%b']), 'Il corpo resta.');
}

test('valoreEffettivo e carattereSicuro: vince l’ultima voce, e solo `#` (o niente) va cambiato', () => {
  assert.equal(valoreEffettivo(''), '');
  assert.equal(valoreEffettivo('core.commentchar\n#\0core.commentstring\n%\0'), '%');
  assert.equal(valoreEffettivo('core.commentchar\0'), '', 'una voce senza valore non sceglie niente');
  for (const v of ['', '#', undefined, null]) assert.equal(carattereSicuro(v), false, `«${v}»`);
  for (const v of [';', '%', 'auto', CARATTERE_COMMENTO]) assert.equal(carattereSicuro(v), true, `«${v}»`);
});

test('ensureCommentChar: imposta `;` al posto di `#`, rispetta una scelta diversa, e fuori da un repo non lancia', () => {
  const dir = cartellaTemporanea('filo-commento-solo-');
  fatte.push(dir);
  git(dir, ['init', '-q', '--initial-branch=main']);
  assert.deepEqual(ensureCommentChar(dir), { ok: true, cambiato: true, valore: CARATTERE_COMMENTO });
  assert.deepEqual(ensureCommentChar(dir), { ok: true, cambiato: false, valore: CARATTERE_COMMENTO }, 'idempotente');
  git(dir, ['config', 'core.commentChar', '#']);
  assert.equal(ensureCommentChar(dir).cambiato, true);
  assert.equal(carattere(dir), CARATTERE_COMMENTO);
  git(dir, ['config', 'core.commentChar', '%']);
  assert.equal(ensureCommentChar(dir).cambiato, false);
  assert.equal(carattere(dir), '%', 'la scelta dell’utente resta');
  const fuori = cartellaTemporanea('filo-commento-fuori-');
  fatte.push(fuori);
  assert.equal(ensureCommentChar(fuori).ok, false);
});

test('routine: dopo prepareBranch un rebase con conflitti tiene i titoli `#n` e non si ferma sul messaggio vuoto', () => {
  const { base, origin } = scena();
  const copia = join(base, 'copia');
  git(base, ['clone', '-q', origin, copia]);
  assert.equal(carattere(copia), '', 'la copia nasce col carattere di default');
  const r = prepareBranch({ root: copia, branch: 'worker/x' });
  assert.equal(r.ok, true, r.message);
  assertTitoliSalvi(copia, rebaseConConflitti(copia));
});

test('routine: anche il ramo di un lavoro nuovo nasce col carattere giusto', () => {
  const { base, origin } = scena();
  const copia = join(base, 'nuovo');
  git(base, ['clone', '-q', origin, copia]);
  assert.equal(prepareBranch({ root: copia, branch: 'worker/nuovo-1', create: true }).ok, true);
  assert.equal(carattere(copia), CARATTERE_COMMENTO);
});

test('sessione: l’hook di avvio imposta il carattere, e una worktree nata dopo fa il rebase senza perdere i titoli', () => {
  const { base, origin } = scena();
  const principale = join(base, 'principale');
  git(base, ['clone', '-q', origin, principale]);
  const gancio = (dir) => spawnSync('bash', [join(ROOT, '.claude', 'hooks', 'session-start.sh')], {
    cwd: dir, encoding: 'utf8', input: '', env: { ...process.env, CLAUDE_PROJECT_DIR: dir, FILO_ROUTINE: '1' },
  });
  const h = gancio(principale);
  assert.equal(h.status, 0, h.stderr);
  assert.equal(carattere(principale), CARATTERE_COMMENTO, 'stesso valore del modulo');
  const wt = join(principale, '.claude', 'worktrees', 'lavoro');
  git(principale, ['worktree', 'add', '-q', wt, '-b', 'claude/lavoro', 'origin/worker/x']);
  assertTitoliSalvi(wt, rebaseConConflitti(wt));

  git(principale, ['config', 'core.commentChar', '%']);
  assert.equal(gancio(principale).status, 0);
  assert.equal(carattere(principale), '%', 'una scelta diversa da `#` resta');
  const fuori = cartellaTemporanea('filo-commento-hook-fuori-');
  fatte.push(fuori);
  assert.equal(gancio(fuori).status, 0, 'fuori da un repo l’hook esce 0');
});

// Il clone del worker lo prova tests/unit/cloneWorker.test.mjs, sul clone vero.
test('orchestratore locale: avvia passa dalla stessa funzione prima che nascano le worktree', () => {
  const orch = readFileSync(join(ROOT, 'scripts', 'orchestratore-locale.mjs'), 'utf8');
  assert.match(orch, /\[P\.radice, P\.serverRadice\]\.filter\(Boolean\)\) ensureCommentChar\(radice\);\s*\n\s*const fine = await creaMotore\(depVere/,
    'avvia, per l’app e per il server, prima che nascano le worktree');
});

test('nessuna ricetta imposta il carattere per conto suo: la regola vive solo dove nasce la copia', () => {
  const ammessi = new Set(['scripts/lib/carattere-commento.mjs', '.claude/hooks/session-start.sh']);
  const visti = [];
  const giro = (dir, filtro) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { giro(p, filtro); continue; }
      if (!filtro.test(e.name)) continue;
      const rel = relative(ROOT, join(ROOT, p)).replace(/\\/g, '/');
      if (!ammessi.has(rel) && /core\.comment(char|string)/i.test(readFileSync(join(ROOT, p), 'utf8'))) visti.push(rel);
    }
  };
  giro('routines', /\.md$/);
  giro('scripts', /\.(mjs|js|sh)$/);
  giro('.claude/hooks', /\.sh$/);
  assert.deepEqual(visti, []);
});
