// Chi è il worker di questa cartella, per le prove che non devono contendersi display e CPU (#1157). Lo scrive
// scripts/lib/clone-worker.mjs nel marcatore del clone; fuori da un clone di worker tutto resta com'era.
// Unit test: tests/unit/cloneWorker.test.mjs.

import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';

export const MARCATORE_WORKER = '.claude/filo-worker.json';

/**
 * `{ indice, paralleli }` dall'ambiente (`FILO_WORKER`, `FILO_WORKER_PARALLELI`) o, con `root`, dal marcatore del
 * clone: in Claude Code l'ambiente non passa da una chiamata Bash all'altra, il marcatore sì. `null` = non è un worker.
 */
export function datiWorker({ env = process.env, root = null } = {}) {
  const num = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
  let indice = num(env.FILO_WORKER);
  let paralleli = num(env.FILO_WORKER_PARALLELI);
  if (root && (!indice || !paralleli)) {
    try {
      const m = JSON.parse(readFileSync(resolve(root, MARCATORE_WORKER), 'utf8'));
      indice = indice || num(m.indice);
      paralleli = paralleli || num(m.paralleli);
    } catch (_) { /* nessun marcatore */ }
  }
  return indice ? { indice, paralleli } : null;
}

/** File di prova insieme per worker: le CPU divise fra i worker, almeno uno; 0 = decide node. PURA. */
export function concorrenzaUnit(paralleli, cpu = cpus().length) {
  const k = Number(paralleli);
  if (!Number.isInteger(k) || k < 2) return 0;
  return Math.max(1, Math.floor(Number(cpu) / k));
}

/**
 * Da quale display parte la ricerca di `xvfb-run -a` per il worker: due `-a` dalla stessa base scelgono lo stesso
 * numero libero e il secondo Xvfb non parte. Dieci numeri a testa, sopra il 99 predefinito. PURA.
 */
export function displayDelWorker(indice) {
  return 100 + 10 * Number(indice);
}
