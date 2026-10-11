// Quello che un lavoro fa davvero sul disco, contato invece che cronometrato: «non rilegge, non riscrive, aggiunge una
// riga» vale uguale su una macchina ferma e su una carica (#1063). Solo le chiamate sincrone di node:fs.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Le chiamate di `fn` sui file dentro `cartella`: `{ n, righe }` per ciascuna, solo la più esterna (appendFileSync
 * passa da writeFileSync). `righe` sono gli a capo scritti. `fn` può essere asincrona.
 */
export async function spiaDiscoSincrono(cartella, fn) {
  const fs = require('node:fs');
  const visto = [];
  let dentroUnaChiamata = 0;
  const dentro = (p) => typeof p === 'string' && p.startsWith(cartella);
  const nomi = ['appendFileSync', 'writeFileSync', 'renameSync', 'readFileSync', 'unlinkSync', 'openSync', 'copyFileSync'];
  const veri = Object.fromEntries(nomi.map((n) => [n, fs[n]]));
  for (const n of nomi) {
    fs[n] = (p, d, ...r) => {
      if (dentro(p) && !dentroUnaChiamata) visto.push({ n, righe: typeof d === 'string' ? d.split('\n').length - 1 : 0 });
      dentroUnaChiamata++;
      try { return veri[n](p, d, ...r); } finally { dentroUnaChiamata--; }
    };
  }
  try {
    await fn();
    return visto;
  } finally {
    Object.assign(fs, veri);
  }
}
