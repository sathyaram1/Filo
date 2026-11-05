// I file di sessione di questa macchina (biglietti, battito, stato della routine): non entrano mai in un commit, su
// nessun ramo, qualunque sia la sua base. Non decide niente sul lavoro; sentinella: tests/unit/bigliettiFuoriDaGit.test.mjs.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Vivono in `.claude/` DENTRO il progetto: il `.gitignore` di un ramo vecchio non li conosce, e lì la pulizia li
 * spazza e il salvataggio automatico li committa sul repo pubblico (25/08 il battito; 20/10 198 biglietti, #2154).
 */
export const SESSION_MARKERS = Object.freeze([
  '.claude/routine-ticket.json',
  '.claude/routine-beat.json',
  '.claude/routine-beat-hook.stamp',
  '.claude/routine-consumo.json',
  '.claude/routine-role.json',
  '.claude/branch-expect.json',
  '.claude/verify-local.json',
  '.claude/routine-state/',
  '.claude/biglietti/',
  '.claude/filo-worker.json',
]);

/** Vero se il percorso del repo `f` (barre normali) è un file di sessione. PURA. */
export function eMarcatore(f) {
  const p = String(f || '').replace(/\\/g, '/').replace(/^\.\//, '');
  return SESSION_MARKERS.some((m) => (m.endsWith('/') ? p.startsWith(m) : p === m));
}

const git = (root, args, exec = execFileSync, extra = {}) => String(exec('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...extra }) || '');

/**
 * Li scrive in `info/exclude` della .git comune: vale per ogni ramo e ogni worktree e non viaggia in un commit.
 * Idempotente; un errore vale false e non ferma niente.
 */
export function ensureSessionExcludes(root, { exec = execFileSync } = {}) {
  try {
    const comune = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'], exec).trim();
    if (!comune) return false;
    const dir = resolve(comune, 'info');
    const file = resolve(dir, 'exclude');
    const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const righe = current.split(/\r?\n/);
    const mancanti = SESSION_MARKERS.filter((m) => !righe.includes(m));
    if (!mancanti.length) return true;
    mkdirSync(dir, { recursive: true });
    const testa = current && !current.endsWith('\n') ? '\n' : '';
    writeFileSync(file,
      current + testa
      + '# Marcatori di sessione Filo (scripts/lib/marcatori-sessione.mjs): locali alla macchina,\n'
      + '# fuori da ogni commit e dalla pulizia anche quando il ramo checkoutato è più vecchio di loro.\n'
      + mancanti.join('\n') + '\n',
      'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Dopo un `git add -A`: toglie dall'indice i file di sessione messi in scena (uno che il ramo tracciava già esce dal
 * ramo) e li esclude per le volte dopo. → i percorsi tolti.
 */
export function marcatoriFuoriDallaScena(root, { exec = execFileSync } = {}) {
  const tolti = git(root, ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], exec).split('\0').filter(eMarcatore);
  // Da stdin: centinaia di biglietti in fila superano la riga di comando di Windows.
  if (tolti.length) {
    git(root, ['rm', '-q', '--cached', '--ignore-unmatch', '--pathspec-from-file=-', '--pathspec-file-nul'], exec,
      { input: `${tolti.join('\0')}\0`, stdio: ['pipe', 'pipe', 'pipe'] });
  }
  ensureSessionExcludes(root, { exec });
  return tolti;
}
