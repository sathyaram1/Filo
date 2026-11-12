// Riporta nel blocco della prossima versione le righe di novità che il ramo ha sotto versioni già uscite (#2057).
// Uso, dal clone: node scripts/novita-in-cima.mjs [--commit]: senza --commit dice cosa sposterebbe e non tocca niente.
// Regole: scripts/lib/novita-in-cima.mjs; sentinella: tests/unit/novitaInCima.test.mjs.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { absolutizeOutput, pinnedRepoRoot } from './lib/tools-pin.mjs';
import { testoRiportaInCima } from './lib/novita-in-cima.mjs';
import { riportaNelClone } from './routine-channel.mjs';

const root = process.env.FILO_REPO_ROOT ? resolve(process.env.FILO_REPO_ROOT) : (pinnedRepoRoot() || resolve(dirname(fileURLToPath(import.meta.url)), '..'));
absolutizeOutput(root);
const args = process.argv.slice(2);
const ignoti = args.filter((a) => a !== '--commit');
if (ignoti.length) {
  process.stderr.write(`argomento sconosciuto: ${ignoti[0]}\nUso: node scripts/novita-in-cima.mjs [--commit]\n`);
  process.exit(2);
}
const r = await riportaNelClone(root, { commit: args.includes('--commit') });
process.stdout.write(`${testoRiportaInCima(r).join('\n')}\n`);
process.exit(r.ok ? 0 : 1);
