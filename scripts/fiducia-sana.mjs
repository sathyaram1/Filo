// fiducia-sana.mjs — la sanatoria di un registro dei rami bucato (#2021), con le credenziali dell'owner. Regola e scrittura
// le fa il server (ownerFiducia {op:'sana'}): qui solo la richiesta, a secco di default.
// Uso: npm run fiducia:sana -- <ramo> [--server] [--dal-vero]. Prove: tests/unit/fiduciaSana.test.mjs.

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { risultatoOwnerFiducia } from './lib/owner-fiducia.mjs';

const USO = 'Uso: npm run fiducia:sana -- <ramo> [--server] [--dal-vero]';

/** Le parole della riga di comando. PURA. @returns {{ ramo, repo: 'app'|'server', dalVero } | { errore }} */
export function leggiArgomenti(argv) {
  const a = (Array.isArray(argv) ? argv : []).map(String);
  const opzioni = a.filter((x) => x.startsWith('--'));
  const strana = opzioni.find((x) => x !== '--server' && x !== '--dal-vero');
  if (strana) return { errore: `"${strana}" non vale qui. ${USO}` };
  const rami = a.filter((x) => !x.startsWith('--'));
  if (rami.length !== 1 || !rami[0].trim()) return { errore: `serve un ramo, uno solo. ${USO}` };
  return { ramo: rami[0].trim(), repo: a.includes('--server') ? 'server' : 'app', dalVero: a.includes('--dal-vero') };
}

/** Cosa chiedere al server: a secco (`prova`) finché non si dice --dal-vero. PURA. */
export function richiesta({ ramo, repo, dalVero }) {
  return Object.assign({ op: 'sana', repo, ramo }, dalVero ? {} : { prova: true });
}

/** Una riga per l'owner dalla risposta del server. PURA. */
export function rigaEsito(r, { dalVero } = {}) {
  if (!r || r.ok !== true) return `Non si sana: ${(r && (r.detail || r.reason)) || 'risposta senza esito'}.`;
  const conto = `${Number(r.commits) || 0} commit oltre main, tutti dentro una voce registrata`;
  return dalVero
    ? `Sanato: il buco è tolto, la punta ${String(r.punta || '').slice(0, 12)} resta l'ultima registrata (${conto}).`
    : `Si può sanare (${conto}). Rilancia con --dal-vero per togliere il buco.`;
}

/** deps: { chiama(data) → risultato della callable, scrivi(riga) }. → codice d'uscita. */
export async function sana(argv, { chiama = chiamaServer, scrivi = console.log } = {}) {
  const args = leggiArgomenti(argv);
  if (args.errore) { scrivi(args.errore); return 2; }
  let r;
  try {
    r = await chiama(richiesta(args));
  } catch (e) {
    scrivi(`Non si sana: ${String((e && e.message) || e)}.`);
    return 1;
  }
  scrivi(rigaEsito(r, args));
  return r && r.ok === true ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  sana(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(`fiducia-sana: ${String((e && e.message) || e)}`); process.exitCode = 1; });
}
