// La memoria degli spec già verdi su un contenuto, che fa riprendere un controllo fermato dal tetto di un comando
// (#2113). La leggono il controllo di fine lavoro e il reporter che la scrive spec per spec; mai committata.

import { readFileSync, writeFileSync } from 'node:fs';

/** I verdi di `chiave`; la memoria di un altro contenuto non vale niente. */
export function leggiSpecVerdi(file, chiave) {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    return new Set(j && j.sha === chiave && Array.isArray(j.verdi) ? j.verdi.map(String) : []);
  } catch (_) { return new Set(); }
}

/** La memoria di un altro contenuto si butta. Una scrittura fallita costa solo la ripresa, non il controllo. */
export function segnaSpecVerdi(file, chiave, specs) {
  const verdi = leggiSpecVerdi(file, chiave);
  for (const s of specs || []) verdi.add(String(s));
  return scrivi(file, chiave, verdi);
}

/** Toglie spec già segnati che il lancio ha poi dato rossi fuori da un test. */
export function togliSpecVerdi(file, chiave, specs) {
  const verdi = leggiSpecVerdi(file, chiave);
  for (const s of specs || []) verdi.delete(String(s));
  return scrivi(file, chiave, verdi);
}

function scrivi(file, chiave, verdi) {
  try { writeFileSync(file, JSON.stringify({ sha: chiave, verdi: [...verdi].sort() })); } catch (_) { /* si riparte da capo */ }
  return verdi;
}
