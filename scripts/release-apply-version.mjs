// Applica in locale, al manifesto del commit provato dalla suite, il numero che
// il server ha scritto su main (release.yml, #641), e lo stesso al lockfile (#2040). Non committa e non spinge:
// cambia solo le righe della versione; `prossimaVersione` resta, qui non la legge nessuno.
//
// USO   node scripts/release-apply-version.mjs <X.Y.Z | vX.Y.Z>
// Exit  0 fatto · 2 rifiutato (numero malformato, non più alto, manifesto strano)

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

/** X.Y.Z dalla richiesta, anche con la v davanti; '' se malformata. PURA. */
function numeroRichiesto(richiesta) {
  const version = String(richiesta || '').trim().replace(/^v/, '');
  return /^\d+\.\d+\.\d+$/.test(version) ? version : '';
}

/**
 * Dal testo del manifesto al testo col numero nuovo. PURA.
 * Un numero uguale o più basso vuol dire che l'albero non è quello atteso
 * (o che il numero è di un'altra release): pubblicarlo scriverebbe sopra una
 * release esistente.
 */
export function applicaVersione(testo, richiesta) {
  const version = numeroRichiesto(richiesta);
  if (!version) {
    return { ok: false, reason: `numero malformato: "${richiesta}"` };
  }
  let prima;
  try { prima = JSON.parse(testo); } catch (_) { return { ok: false, reason: 'manifesto non leggibile' }; }
  const previous = String(prima.version || '');
  if (!/^\d+\.\d+\.\d+$/.test(previous)) return { ok: false, reason: `versione attuale malformata: "${previous}"` };
  if (confrontaVersioni(version, previous) <= 0) {
    return { ok: false, reason: `${version} non è più alto di ${previous}, il numero di questo albero` };
  }
  // Un numero diverso da quello dichiarato: il server non ha letto questo campo (non lo conosce, o su main è cambiato), e
  // le note del blocco in cima uscirebbero sotto un numero che non è il loro.
  if (Object.hasOwn(prima, 'prossimaVersione') && prima.prossimaVersione !== version) {
    return { ok: false, reason: `il manifesto dichiara come prossima versione ${JSON.stringify(prima.prossimaVersione)}, il server ha scritto ${version}` };
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

/**
 * Lo stesso numero nel lockfile, nei due campi dove npm tiene quello del progetto: in cima e in `packages[""]`. PURA.
 * Il numero vecchio non si confronta: un lockfile rimasto indietro (#2040) si riallinea, non ferma niente.
 */
export function applicaVersioneAlLock(testo, richiesta) {
  const version = numeroRichiesto(richiesta);
  if (!version) return { ok: false, reason: `numero malformato: "${richiesta}"` };
  let prima;
  try { prima = JSON.parse(testo); } catch (_) { return { ok: false, reason: 'lockfile non leggibile' }; }
  if (!prima || typeof prima !== 'object' || Array.isArray(prima)) return { ok: false, reason: 'lockfile non leggibile' };
  if (!Object.hasOwn(prima, 'version')) return { ok: false, reason: 'il lockfile non porta il numero del progetto' };
  // Si riscrive nel formato di npm: se il testo non è già in quel formato cambierebbero righe che non c'entrano.
  if (`${JSON.stringify(prima, null, 2)}\n` !== testo) return { ok: false, reason: 'il lockfile non è nel formato di npm' };
  const dopo = structuredClone(prima);
  dopo.version = version;
  const radice = dopo.packages && dopo.packages[''];
  if (radice && typeof radice === 'object' && Object.hasOwn(radice, 'version')) radice.version = version;
  return { ok: true, testo: `${JSON.stringify(dopo, null, 2)}\n`, version, previous: String(prima.version ?? '') };
}

function main() {
  const radice = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const file = resolve(radice, 'package.json');
  const esito = applicaVersione(readFileSync(file, 'utf8'), process.argv[2]);
  if (!esito.ok) {
    console.error(`[release-apply-version] RIFIUTATO: ${esito.reason}. Non costruisco.`);
    process.exitCode = 2;
    return;
  }
  writeFileSync(file, esito.testo);
  console.error(`[release-apply-version] manifesto locale ${esito.previous} → ${esito.version} (niente commit, niente push).`);
  // Alla costruzione il lockfile non serve per il numero: uno che non si riallinea si dice, e non ferma la pubblicazione.
  const lock = resolve(radice, 'package-lock.json');
  if (!existsSync(lock)) return;
  const l = applicaVersioneAlLock(readFileSync(lock, 'utf8'), esito.version);
  if (!l.ok) {
    console.log(`::warning::[release-apply-version] package-lock.json resta com'è (${l.reason}): solo il manifesto porta ${esito.version}.`);
    return;
  }
  writeFileSync(lock, l.testo);
  console.error(`[release-apply-version] lockfile locale ${l.previous} → ${l.version}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
