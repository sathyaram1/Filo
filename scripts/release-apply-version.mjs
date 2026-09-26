// Applica in locale, al manifesto del commit provato dalla suite, il numero che
// il server ha scritto su main (release.yml, #641). Non committa e non spinge:
// cambia solo la riga della versione, come il commit del server.
//
// USO   node scripts/release-apply-version.mjs <X.Y.Z | vX.Y.Z>
// Exit  0 fatto · 2 rifiutato (numero malformato, non più alto, manifesto strano)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RIGA_VERSIONE = /^(\s*"version"\s*:\s*")([^"]*)(")/m;

/** -1, 0, 1 fra due X.Y.Z. PURA. */
export function confrontaVersioni(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Dal testo del manifesto al testo col numero nuovo. PURA.
 * Un numero uguale o più basso vuol dire che l'albero non è quello atteso
 * (o che il numero è di un'altra release): pubblicarlo scriverebbe sopra una
 * release esistente.
 */
export function applicaVersione(testo, richiesta) {
  const version = String(richiesta || '').trim().replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    return { ok: false, reason: `numero malformato: "${richiesta}"` };
  }
  let prima;
  try { prima = JSON.parse(testo); } catch (_) { return { ok: false, reason: 'manifesto non leggibile' }; }
  const previous = String(prima.version || '');
  if (!/^\d+\.\d+\.\d+$/.test(previous)) return { ok: false, reason: `versione attuale malformata: "${previous}"` };
  if (confrontaVersioni(version, previous) <= 0) {
    return { ok: false, reason: `${version} non è più alto di ${previous}, il numero di questo albero` };
  }
  const m = testo.match(RIGA_VERSIONE);
  if (!m || m[2] !== previous) return { ok: false, reason: 'la riga della versione non è quella del manifesto' };
  const nuovo = testo.replace(RIGA_VERSIONE, `$1${version}$3`);
  const dopo = JSON.parse(nuovo);
  if (JSON.stringify({ ...dopo, version: previous }) !== JSON.stringify(prima)) {
    return { ok: false, reason: 'sarebbe cambiato altro oltre alla versione' };
  }
  return { ok: true, testo: nuovo, version, previous };
}

function main() {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const esito = applicaVersione(readFileSync(file, 'utf8'), process.argv[2]);
  if (!esito.ok) {
    console.error(`[release-apply-version] RIFIUTATO: ${esito.reason}. Non costruisco.`);
    process.exitCode = 2;
    return;
  }
  writeFileSync(file, esito.testo);
  console.error(`[release-apply-version] manifesto locale ${esito.previous} → ${esito.version} (niente commit, niente push).`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
