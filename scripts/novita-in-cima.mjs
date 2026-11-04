// Riporta nel blocco della prossima versione le righe di novità che il ramo ha sotto versioni già uscite (#2057).
// Uso, dal clone: node scripts/novita-in-cima.mjs [--commit]. Uscita 0 anche quando non c'è niente da spostare.
// Regole: scripts/lib/novita-in-cima.mjs; sentinella: tests/unit/novitaInCima.test.mjs.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinnedRepoRoot } from './lib/tools-pin.mjs';
import { isRoutineInstance } from './lib/routine-role.mjs';
import { riportaInCima, testoRiportaInCima } from './lib/novita-in-cima.mjs';
import { operazioneGitInCorso } from './routine-channel.mjs';

/** Il riporto con le dipendenze vere del clone: chi committa e quando git è a metà. */
export function riportaNelClone(root, { commit = false } = {}) {
  const routine = isRoutineInstance(root);
  return riportaInCima(root, {
    commit,
    aMeta: (r) => operazioneGitInCorso(r),
    identita: routine ? { nome: 'claude-routine', email: 'claude@routine' } : null,
  });
}

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const ignoti = args.filter((a) => a !== '--commit');
  if (ignoti.length) {
    process.stderr.write(`argomento sconosciuto: ${ignoti[0]}\nUso: node scripts/novita-in-cima.mjs [--commit]\n`);
    process.exit(2);
  }
  const root = process.env.FILO_REPO_ROOT ? resolve(process.env.FILO_REPO_ROOT) : (pinnedRepoRoot() || resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  const r = riportaNelClone(root, { commit: args.includes('--commit') });
  process.stdout.write(`${testoRiportaInCima(r).join('\n')}\n`);
  process.exit(r.ok ? 0 : 1);
}
