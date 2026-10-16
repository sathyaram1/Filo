// #861 giro 4 — un gruppo perso costa i file che toccava, non il segreto intero: anche quando è il gruppo che tiene
// l'elenco dei file, la riapertura non deve svuotare il segreto né cancellare i file rimasti integri.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const M = require('../../../src/main/services/segreto/motore.js');
const K = require('../../../src/main/services/segreto/chiave.js');
const F = M._formato;
const PROVA = { passate: 1, memoriaKiB: 1024, parallelismo: 1 };
const SALE = Buffer.alloc(16, 0x5a);

async function copie(base, nome) {
  const k = await K.derivaChiavi(F.normalizzaNome(nome), base.sale, PROVA);
  const buf = readFileSync(base.contenitore);
  const out = new Map();
  for (let p = 0; p < buf.length / F.BLOCCO; p++) {
    const pre = F.leggiPrefisso(F.apriBlocco(k.cifra, p, buf.subarray(p * F.BLOCCO, (p + 1) * F.BLOCCO)));
    if (!pre) continue;
    const i = 2 * pre.j + pre.c;
    if (out.has(i) && out.get(i).v >= pre.v) continue;
    out.set(i, { p, v: pre.v, testa: i === 0 ? F.leggiTesta(pre.carico) : null });
  }
  return out;
}

test('r1 perse 11 copie su 20 del gruppo con l’elenco dei file: la foto integra si apre ancora', async () => {
  test.setTimeout(180_000);
  const dir = cartellaTemporanea('segreto-v861-');
  try {
    const base = { contenitore: join(dir, 'c.bin'), dimensione: 16 << 20, sale: SALE, parametriChiave: PROVA };
    await M.creaContenitore(base.contenitore, base.dimensione);
    const s = (await M.creaSegreto({ ...base, nome: 'Casa' })).segreto;
    const foto = randomBytes(2 << 20);
    await s.scriviFile('foto', foto);
    for (let x = 0; x < 100; x++) await s.scriviFile(`nota-${x}.txt`, `nota numero ${x}`);
    await s.chiudi();

    const prima = await copie(base, 'Casa');
    const { blocchiTabella } = prima.get(0).testa;
    expect(blocchiTabella.length, 'con cento file l’elenco sta fuori dalla testa').toBeGreaterThan(0);
    const g = Math.floor(blocchiTabella[0] / F.GRUPPO);
    // Come le coprirebbe un altro segreto non dichiarato: 11 delle 20 copie di quel solo gruppo.
    const coperte = [...prima].filter(([i]) => Math.floor((i >> 1) / F.GRUPPO) === g).slice(0, 11).map(([, c]) => c.p);
    const fd = openSync(base.contenitore, 'r+');
    for (const p of coperte) writeSync(fd, randomBytes(F.BLOCCO), 0, F.BLOCCO, p * F.BLOCCO);
    closeSync(fd);

    const r = await M.apriSegreto({ ...base, nome: 'Casa' });
    expect(r.esito).toBe('aperto');
    const nomi = r.segreto.elencaFile().map((f) => f.nome);
    const letta = nomi.includes('foto') ? await r.segreto.leggiFile('foto').catch(() => null) : null;
    await r.segreto.chiudi();
    const rimaste = (await copie(base, 'Casa')).size;
    expect(rimaste, `copie del segreto rimaste dopo la riapertura, su ${prima.size}`).toBeGreaterThan(prima.size / 2);
    expect(nomi, 'la foto non è più nell’elenco').toContain('foto');
    expect(letta && letta.equals(foto), 'la foto non si legge più').toBe(true);
  } finally {
    togliCartella(dir);
  }
});
