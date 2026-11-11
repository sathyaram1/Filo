// fiducia-copri.mjs — l'owner, lette le note del manutentore su un feedback, se ne fida (#2215): lo scritto sporco che
// avevano messo non tiene più locale il lavoro server. Regola e scrittura le fa il server (ownerFiducia {op:'copri'}):
// qui solo la richiesta, a secco di default. Uso: npm run fiducia:copri -- <numero> [--dal-vero]. Prove: tests/unit/fiduciaCopri.test.mjs.

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { risultatoOwnerFiducia } from './lib/owner-fiducia.mjs';

const USO = 'Uso: npm run fiducia:copri -- <numero del feedback> [--dal-vero]';
const NUMERO_RE = /^#?[1-9]\d{0,6}(?:\.[1-9]\d{0,3})?$/;

/** Le parole della riga di comando. PURA. @returns {{ numero, dalVero } | { errore }} */
export function leggiArgomenti(argv) {
  const a = (Array.isArray(argv) ? argv : []).map(String);
  const strana = a.filter((x) => x.startsWith('--')).find((x) => x !== '--dal-vero');
  if (strana) return { errore: `"${strana}" non vale qui. ${USO}` };
  const numeri = a.filter((x) => !x.startsWith('--'));
  if (numeri.length !== 1 || !NUMERO_RE.test(numeri[0].trim())) return { errore: `serve il numero di un feedback, uno solo. ${USO}` };
  return { numero: numeri[0].trim().replace(/^#/, ''), dalVero: a.includes('--dal-vero') };
}

/** Cosa chiedere al server: a secco (`prova`) finché non si dice --dal-vero. PURA. */
export function richiesta({ numero, dalVero }) {
  return Object.assign({ op: 'copri', numero }, dalVero ? {} : { prova: true });
}

/** Una riga per l'owner dalla risposta del server. PURA. */
export function rigaEsito(r, { dalVero } = {}) {
  if (!r || r.ok !== true) return `Non si copre: ${(r && (r.detail || r.reason)) || 'risposta senza esito'}.`;
  const n = Number(r.coperte) || 0;
  if (!n) return `#${r.numero}: nessuna nota del manutentore da coprire.`;
  const note = n === 1 ? 'una nota del manutentore' : `${n} note del manutentore`;
  const altre = Number(r.restano) > 0 ? `; restano ${r.restano} scritture di altri, che lo sporcano ancora` : '';
  if (!dalVero) return `#${r.numero}: si coprono ${note}${altre}. Rilancia con --dal-vero se le hai lette.`;
  const locale = Array.isArray(r.restaLocale) && r.restaLocale.length ? ` Resta locale: ${r.restaLocale.join('; ')}.` : ' Il lavoro può ripartire.';
  return `#${r.numero}: coperte ${note}${altre}.${locale}`;
}

/** deps: { chiama(data) → risultato della callable, scrivi(riga), rete (i deps della chiamata comune) }. → codice d'uscita. */
export async function copri(argv, { rete = {}, chiama = (data) => risultatoOwnerFiducia(data, rete), scrivi = console.log } = {}) {
  const args = leggiArgomenti(argv);
  if (args.errore) { scrivi(args.errore); return 2; }
  let r;
  try {
    r = await chiama(richiesta(args));
  } catch (e) {
    scrivi(`Non si copre: ${String((e && e.message) || e)}.`);
    return 1;
  }
  scrivi(rigaEsito(r, args));
  return r && r.ok === true ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  copri(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(`fiducia-copri: ${String((e && e.message) || e)}`); process.exitCode = 1; });
}
