// #861 giro 1 — aiuto comune alle prove del motore del profilo segreto: contenitore, chiavi basse, impronta da fuori.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
export const M = require('../../../src/main/services/segreto/motore.js');
const K = require('../../../src/main/services/segreto/chiave.js');
export const F = M._formato;
export const MB = 1 << 20;
export const PROVA = { passate: 1, memoriaKiB: 1024, parallelismo: 1 };
const SALE = Buffer.alloc(16, 0x3c);

export async function contenitore(dir, dimensione, nome = 'c.bin') {
  const percorso = join(dir, nome);
  await M.creaContenitore(percorso, dimensione);
  return { contenitore: percorso, dimensione, sale: SALE, parametriChiave: PROVA };
}

// Le copie valide di un segreto viste da fuori, leggendo il file blocco per blocco.
export async function impronta(base, nome) {
  const k = await K.derivaChiavi(F.normalizzaNome(nome), base.sale, PROVA);
  const buf = readFileSync(base.contenitore);
  const copie = new Map();
  for (let p = 0; p < buf.length / F.BLOCCO; p++) {
    const pre = F.leggiPrefisso(F.apriBlocco(k.cifra, p, buf.subarray(p * F.BLOCCO, (p + 1) * F.BLOCCO)));
    if (!pre) continue;
    const i = 2 * pre.j + pre.c;
    const prima = copie.get(i);
    if (prima && prima.v >= pre.v) continue;
    copie.set(i, { p, v: pre.v });
  }
  return copie;
}

export function persi(prima, dopo) {
  let n = 0;
  for (const [i, c] of prima) {
    const d = dopo.get(i);
    if (!d || d.p !== c.p || d.v !== c.v) n++;
  }
  return n;
}
