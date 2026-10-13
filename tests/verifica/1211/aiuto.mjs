// #1211 — un repo usa e getta col biglietto finto di una sessione, per provare il gancio delle letture esterne.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

export const SESSIONE = 'verifica1211';

export function repoConBiglietto() {
  const repo = cartellaTemporanea('v1211-repo-');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const dir = join(repo, '.claude', 'biglietti');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${SESSIONE}.json`), JSON.stringify({ ticket: 'a'.repeat(40), fp: 'b'.repeat(64), natoIl: 1 }));
  return repo;
}

/** Le letture annotate accanto al biglietto della sessione. */
export function annotate(repo) {
  try { return readdirSync(join(repo, '.claude', 'biglietti', 'sporchi', 'b'.repeat(64))).filter((n) => n.endsWith('.json')); } catch (_) { return []; }
}

export function envPulito(repo) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: repo, FILO_FUNCTIONS_BASE: 'http://127.0.0.1:9' };
  delete env.FILO_ROUTINE;
  delete env.FILO_BIGLIETTO_FILE;
  delete env.CLAUDE_CODE_SESSION_ID;
  return env;
}
