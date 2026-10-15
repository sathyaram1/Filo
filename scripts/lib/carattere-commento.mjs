// Il carattere di commento di git nella config del repo (#762): i titoli dei commit cominciano con `#<numero>`, e un
// commit che passa dall'editor (rebase/merge/cherry-pick --continue, amend) li toglierebbe come commenti. Si imposta
// dove nasce la copia di lavoro, mai ricetta per ricetta. Regole: tests/unit/carattereCommento.test.mjs.

import { spawnSync } from 'node:child_process';

export const CARATTERE_COMMENTO = ';';

/** Il valore che git userà fra le voci `chiave\nvalore\0` di `--null --get-regexp`: l'ultima vince. PURA. */
export function valoreEffettivo(uscitaNull) {
  const voci = String(uscitaNull || '').split('\0').filter(Boolean);
  if (!voci.length) return '';
  const v = voci[voci.length - 1];
  const a = v.indexOf('\n');
  return a < 0 ? '' : v.slice(a + 1);
}

/** Lascia vivi i titoli `#<numero>`? Nessun valore vale `#`, il default di git; una scelta diversa si rispetta. PURA. */
export function carattereSicuro(valore) {
  const v = String(valore ?? '');
  return v !== '' && v !== '#';
}

/**
 * Porta il carattere di commento della config del repo (comune a tutte le sue worktree) a `;` se git userebbe `#`.
 * Idempotente e best-effort: non lancia mai, e una config che non si legge non si scrive.
 * @returns {{ok:boolean, cambiato:boolean, valore:string, why?:string}}
 */
export function ensureCommentChar(root) {
  const g = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  // `commentString` (git 2.45+) è un sinonimo: conta l'ultima delle due voci, come per git.
  const letto = g(['config', '--null', '--get-regexp', '^core\\.comment(char|string)$']);
  // 1 = nessuna voce; ogni altro esito è una config che non si legge.
  if (letto.status !== 0 && letto.status !== 1) {
    return { ok: false, cambiato: false, valore: '', why: String(letto.stderr || (letto.error && letto.error.message) || '').trim() };
  }
  const prima = letto.status === 0 ? valoreEffettivo(letto.stdout) : '';
  if (carattereSicuro(prima)) return { ok: true, cambiato: false, valore: prima };
  const s = g(['config', '--local', '--replace-all', 'core.commentChar', CARATTERE_COMMENTO]);
  if (s.status !== 0) return { ok: false, cambiato: false, valore: prima, why: String(s.stderr || (s.error && s.error.message) || '').trim() };
  return { ok: true, cambiato: true, valore: CARATTERE_COMMENTO };
}
