// #861 giro 3 — due segreti non dichiarati: la riparazione del primo non deve riscrivere proprio i posti dove il secondo
// si era sovrapposto. Contenitore da 64 MB, Casa da 14 MB (circa 44% dei posti), Diario da 4 MB scritto dopo.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const M = require('../../../src/main/services/segreto/motore.js');
const K = require('../../../src/main/services/segreto/chiave.js');
const F = M._formato;
const PROVA = { passate: 1, memoriaKiB: 1024, parallelismo: 1 };

async function copie(base, nome) {
  const k = await K.derivaChiavi(F.normalizzaNome(nome), base.sale, PROVA);
  const buf = readFileSync(base.contenitore);
  const out = new Set();
  for (let p = 0; p < buf.length / F.BLOCCO; p++) {
    if (F.leggiPrefisso(F.apriBlocco(k.cifra, p, buf.subarray(p * F.BLOCCO, (p + 1) * F.BLOCCO)))) out.add(p);
  }
  return out;
}

test('r1 riaprire il primo segreto non distrugge il secondo, scritto dopo senza dichiararlo', async () => {
  test.setTimeout(240_000);
  const dir = cartellaTemporanea('segreto-mirata-');
  try {
    const base = { contenitore: join(dir, 'c.bin'), dimensione: 64 << 20, sale: Buffer.alloc(16, 0x2b), parametriChiave: PROVA };
    await M.creaContenitore(base.contenitore, base.dimensione);
    const FOTO = randomBytes(14 << 20);
    const NOTE = randomBytes(4 << 20);
    let s = (await M.creaSegreto({ ...base, nome: 'Casa' })).segreto;
    await s.scriviFile('foto', FOTO);
    await s.chiudi();
    s = (await M.creaSegreto({ ...base, nome: 'Diario' })).segreto;
    await s.scriviFile('note', NOTE);
    await s.chiudi();

    const prima = await copie(base, 'Diario');
    const casa = await M.apriSegreto({ ...base, nome: 'Casa' });
    expect((await casa.segreto.leggiFile('foto')).equals(FOTO)).toBe(true);
    await casa.segreto.chiudi();
    const dopo = await copie(base, 'Diario');
    const tolte = [...prima].filter((p) => !dopo.has(p)).length;

    const diario = await M.apriSegreto({ ...base, nome: 'Diario' });
    const esito = {
      aperto: diario.esito,
      note: diario.segreto ? await diario.segreto.leggiFile('note').then((b) => b.equals(NOTE), (e) => e.codice) : null,
      copieTolteDallaRiparazioneDiCasa: `${tolte} di ${prima.size}`,
    };
    if (diario.segreto) await diario.segreto.chiudi();
    expect(esito).toMatchObject({ aperto: 'aperto', note: true });
  } finally {
    togliCartella(dir);
  }
});
