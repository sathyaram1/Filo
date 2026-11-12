// Il valore atteso del rinvio forzato di un ramo, per il rilascio delle routine e per l'hook di salvataggio (#1776).
// Da riga di comando: `node lease-atteso.mjs <cartella> <ramo>` stampa lo sha, ed esce 1 se il rinvio non deve partire.
// Le regole stanno in tests/unit/routineChannelRilascio.test.mjs e tests/unit/autoCommitGateSpedizione.test.mjs.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * La traccia remota di `ramo`, solo se è passata dalla storia locale del ramo (il suo reflog), altrimenti ''. Senza
 * valore il lease si fida di un `git fetch` (verifica del giro 2); --force-if-includes vuole il reflog della traccia
 * remota, che un clone appena nato non ha, e rifiuta sempre.
 */
export function leaseAtteso(root, ramo, { exec = execFileSync } = {}) {
  const git = (args) => String(exec('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) || '').trim();
  try {
    const atteso = git(['rev-parse', '-q', '--verify', `refs/remotes/origin/${ramo}^{commit}`]);
    const passati = [...new Set(git(['log', '-g', '--format=%H', `refs/heads/${ramo}`, '--']).split('\n').map((s) => s.trim()).filter(Boolean))];
    if (!atteso || !passati.length) return '';
    if (passati.includes(atteso)) return atteso;
    // --independent tiene solo i commit che nessun altro della lista contiene: se l'atteso sparisce, un passato lo
    // contiene. Un rev-list fra rami lontani supererebbe il buffer dell'uscita (decine di migliaia di commit); a
    // blocchi, perché un reflog di salvataggi automatici sfora la riga di comando di Windows.
    for (let i = 0; i < passati.length; i += 200) {
      const indipendenti = git(['merge-base', '--independent', atteso, ...passati.slice(i, i + 200)]).split('\n').map((s) => s.trim());
      if (!indipendenti.includes(atteso)) return atteso;
    }
    return '';
  } catch (_) {
    return '';
  }
}

if (resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url))) {
  const atteso = process.argv[2] && process.argv[3] ? leaseAtteso(process.argv[2], process.argv[3]) : '';
  process.stdout.write(atteso);
  process.exitCode = atteso ? 0 : 1;
}
