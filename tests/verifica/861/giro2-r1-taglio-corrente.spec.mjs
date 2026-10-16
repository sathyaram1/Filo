// #861 giro 2 — corrente che salta mentre si salva un file: fra due sincronizzazioni il disco può tenere un sottoinsieme
// qualsiasi delle scritture. I file che c'erano già devono restare leggibili; quello nuovo c'è intero o non c'è.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const fsp = require('node:fs/promises');
const M = require('../../../src/main/services/segreto/motore.js');
const K = require('../../../src/main/services/segreto/chiave.js');
const F = M._formato;
const PROVA = { passate: 1, memoriaKiB: 1024, parallelismo: 1 };

test('r1 salvare un file nuovo con la corrente che salta non rovina i file già salvati', async () => {
  test.setTimeout(180_000);
  const dir = cartellaTemporanea('segreto-taglio-');
  const base = { contenitore: join(dir, 'c.bin'), dimensione: 16 << 20, sale: Buffer.alloc(16, 0x5a), parametriChiave: PROVA };
  const open0 = fsp.open;
  try {
    await M.creaContenitore(base.contenitore, base.dimensione);
    const PIENO = randomBytes(12 * F.CARICO);
    const A = randomBytes(3 * F.CARICO + 100);
    const B = randomBytes(6 * F.CARICO);
    const { segreto } = await M.creaSegreto({ ...base, nome: 'Casa' });
    await segreto.scriviFile('pieno', PIENO);
    await segreto.scriviFile('a', A);
    await segreto.chiudi();
    const r0 = await M.apriSegreto({ ...base, nome: 'Casa' });

    const prima = readFileSync(base.contenitore);
    const k = await K.derivaChiavi(F.normalizzaNome('Casa'), base.sale, PROVA);
    const giaSue = new Set();
    for (let p = 0; p < prima.length / F.BLOCCO; p++) {
      if (F.leggiPrefisso(F.apriBlocco(k.cifra, p, prima.subarray(p * F.BLOCCO, (p + 1) * F.BLOCCO)))) giaSue.add(p);
    }

    const registro = [];
    fsp.open = async (...a) => {
      const fh = await open0(...a);
      const w0 = fh.write.bind(fh);
      const s0 = fh.datasync.bind(fh);
      fh.write = async (buf, off, len, pos) => {
        for (let x = 0; x < len; x += F.BLOCCO) registro.push({ p: (pos + x) / F.BLOCCO, dati: Buffer.from(buf.subarray(off + x, off + x + F.BLOCCO)) });
        return w0(buf, off, len, pos);
      };
      fh.datasync = async () => { registro.push(null); return s0(); };
      return fh;
    };
    await r0.segreto.scriviFile('b', B);
    fsp.open = open0;
    await r0.segreto.chiudi();

    const epoche = [[]];
    for (const w of registro) if (w) epoche[epoche.length - 1].push(w); else epoche.push([]);
    const guasti = [];
    for (let ep = 0; ep < epoche.length; ep++) {
      // Sono arrivate al disco le prime m scritture sopra le copie vecchie, nessuna di quelle nei posti nuovi.
      const sopra = epoche[ep].filter((w) => giaSue.has(w.p));
      for (let m = 1; m <= sopra.length; m++) {
        const quali = `prime ${m} di ${sopra.length} scritte sopra le copie vecchie, nessuna nei posti nuovi`;
        const disco = Buffer.from(prima);
        for (let x = 0; x < ep; x++) for (const w of epoche[x]) w.dati.copy(disco, w.p * F.BLOCCO);
        for (const w of sopra.slice(0, m)) w.dati.copy(disco, w.p * F.BLOCCO);
        writeFileSync(base.contenitore, disco);
        const r = await M.apriSegreto({ ...base, nome: 'Casa' });
        const esito = { aperto: r.esito };
        if (r.segreto) {
          const leggi = (n) => r.segreto.leggiFile(n).then((b) => b, (e) => e.codice);
          esito.pieno = await leggi('pieno').then((b) => (Buffer.isBuffer(b) ? b.equals(PIENO) : b));
          esito.a = await leggi('a').then((b) => (Buffer.isBuffer(b) ? b.equals(A) : b));
          esito.b = r.segreto.elencaFile().some((f) => f.nome === 'b') ? await leggi('b').then((b) => (Buffer.isBuffer(b) ? b.equals(B) : b)) : 'assente';
          await r.segreto.chiudi();
        }
        if (!(esito.aperto === 'aperto' && esito.pieno === true && esito.a === true && (esito.b === true || esito.b === 'assente'))) {
          guasti.push(`tratto ${ep + 1} di ${epoche.length}, ${quali}: ${JSON.stringify(esito)}`);
        }
      }
    }
    expect(guasti).toEqual([]);
  } finally {
    fsp.open = open0;
    togliCartella(dir);
  }
});
