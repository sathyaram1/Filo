// Verifica locale di #1222: carica i moduli del server dal checkout di filo-security dello stesso lavoro.
// FILO_SECURITY_DIR (la cartella functions) vince; altrimenti il worktree omonimo, poi il checkout accanto.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

export function cartellaFunctions() {
  if (process.env.FILO_SECURITY_DIR) return process.env.FILO_SECURITY_DIR;
  const nome = basename(APP_ROOT);
  let dir = APP_ROOT;
  for (let i = 0; i < 7; i++) {
    const wt = join(dir, 'filo-security', '.claude', 'worktrees', nome, 'functions');
    if (existsSync(join(wt, 'src', 'routine', 'fusioneServer.js'))) return wt;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

export function richiedi(rel) {
  const f = cartellaFunctions();
  if (!f) throw new Error('filo-security non trovato (FILO_SECURITY_DIR)');
  return createRequire(join(f, 'index.js'))(join(f, rel));
}

export const X = 'a'.repeat(40);
export const M = 'b'.repeat(40);

/** GitHub finto: ramo del server su X davanti a main M, suite verde su X, nessuna parte dell'app. */
export function githubFinto() {
  const chiamate = { avanzaMain: [], mergeMainInto: [] };
  return {
    chiamate,
    branchHead: async (ramo, o = {}) => {
      if (!o || o.repo !== 'server') return { ok: false, reason: 'github_404' };
      return { ok: true, sha: ramo === 'main' ? M : X };
    },
    confronta: async () => ({ ok: true, status: 'ahead', ahead: 1, behind: 0 }),
    workflowRuns: async () => ({ ok: true, runs: [{ status: 'completed', conclusion: 'success', url: 'https://example.invalid/run/1', id: 1, headSha: X }] }),
    compareDiff: async () => ({ ok: true, diff: '' }),
    avanzaMain: async (sha, mainSha) => { chiamate.avanzaMain.push({ sha, mainSha }); return { ok: true, status: 'merged', sha }; },
    mergeMainInto: async (ramo) => { chiamate.mergeMainInto.push(ramo); return { ok: false, reason: 'github_403' }; },
  };
}
