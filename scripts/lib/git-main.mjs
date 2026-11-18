// I due aiuti di git che servono a chi lancia gli unit coi segreti (run-unit-tests via unit-sul-pc): stanno qui e non
// in unit-sulla-fusione.mjs perché quel modulo maneggia il registro delle novità, che la sentinella L5 del server
// ammette solo come dato dello script delle novità del rilascio (#1737). Niente import del repo qui dentro.

import { execFileSync } from 'node:child_process';

const MAIN = 'main';
// Esplicito: in un clone a ramo singolo `fetch origin main` muove solo FETCH_HEAD, e origin/main resta vecchio (#2237.3).
export const refspecMain = (main = MAIN) => `+refs/heads/${main}:refs/remotes/origin/${main}`;

/** Esecutore git con un tetto sul tempo, come quello del cancello. */
export function gitIn(root, ms = 120000) {
  return function git(args) {
    try {
      return { ok: true, out: String(execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: ms }) || '').trim() };
    } catch (e) {
      return { ok: false, out: `${(e && e.stdout) || ''}${(e && e.stderr) || ''}`.trim() || String((e && e.message) || e) };
    }
  };
}
