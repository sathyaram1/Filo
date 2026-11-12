// package-lock.json com'è nel commit, nella cartella di chi guida un giro: l'install del setup lo riscrive e il rebase
// dopo rifiuta la cartella sporca (#2040). Lì nessuno lo cambia apposta; non tocca altri file né un lockfile in
// conflitto. Prove: tests/unit/lockfileDelCommit.test.mjs.

import { execFileSync } from 'node:child_process';

export const LOCKFILE = 'package-lock.json';

// Le coppie di `git status --porcelain` di un file a metà di un merge o di un rebase.
const IN_CONFLITTO = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
const RIGA_DEL_LOCKFILE = new RegExp(`^\\S{1,2}\\s+${LOCKFILE.replace(/\./g, '\\.')}$`);

/**
 * Dalla riga di `git status --porcelain -- package-lock.json`. PURA.
 * @returns {'niente'|'rimetti'|'conflitto'|'fuori-dal-commit'}
 */
export function decidiLockfile(riga) {
  const xy = String(riga || '').split('\n')[0].slice(0, 2);
  if (!xy.trim()) return 'niente';
  if (IN_CONFLITTO.has(xy)) return 'conflitto';
  // Senza una copia nel commit non c'è niente a cui tornare.
  if (xy === '??' || xy === '!!' || xy[0] === 'A') return 'fuori-dal-commit';
  return 'rimetti';
}

/** Tutte le righe di `git status --porcelain` (anche già passato da trim) sono del solo lockfile? PURA. */
export function sporcoSoloDalLockfile(porcelain) {
  const righe = String(porcelain || '').split('\n').map((r) => r.trim()).filter(Boolean);
  return righe.length > 0 && righe.every((r) => RIGA_DEL_LOCKFILE.test(r));
}

const primaRiga = (e) => String((e && (e.stderr || e.message)) || e).trim().split('\n')[0].slice(0, 200);

/** @returns {{ ok: boolean, rimesso: boolean, why?: string }} */
export function rimettiLockfile(cartella) {
  const git = (args) => execFileSync('git', args, { cwd: cartella, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  let riga;
  try { riga = git(['status', '--porcelain', '--', LOCKFILE]); } catch (e) { return { ok: false, rimesso: false, why: primaRiga(e) }; }
  const cosa = decidiLockfile(riga);
  if (cosa === 'conflitto') {
    return { ok: false, rimesso: false, why: `${LOCKFILE} è in conflitto: c'è un merge o un rebase a metà, e non lo sciolgo io` };
  }
  if (cosa !== 'rimetti') return { ok: true, rimesso: false };
  try { git(['checkout', 'HEAD', '--', LOCKFILE]); } catch (e) { return { ok: false, rimesso: false, why: primaRiga(e) }; }
  return { ok: true, rimesso: true };
}
