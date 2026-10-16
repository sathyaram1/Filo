// #861 giro 2 — il motore gira nel processo principale: aprire, salvare o togliere un segreto grosso non deve fermarlo
// per tempi che si vedono (la finestra smette di rispondere). Contenitore da 512 MB, segreto da 200 MB.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const M = require('../../../src/main/services/segreto/motore.js');
const PROVA = { passate: 1, memoriaKiB: 1024, parallelismo: 1 };
const FERMO_MAX_MS = 200;

test('r2 aprire, leggere e togliere un file da un segreto da 200 MB non ferma il processo per più di un attimo', async () => {
  test.setTimeout(240_000);
  const dir = cartellaTemporanea('segreto-fermo-');
  try {
    const base = { contenitore: join(dir, 'c.bin'), dimensione: 512 << 20, sale: Buffer.alloc(16, 1), parametriChiave: PROVA };
    await M.creaContenitore(base.contenitore, base.dimensione);
    const { segreto } = await M.creaSegreto({ ...base, nome: 'Casa' });
    const dati = randomBytes(200 << 20);
    const fermi = {};
    let max = 0;
    let ultimo = performance.now();
    const battito = setInterval(() => { const ora = performance.now(); max = Math.max(max, ora - ultimo); ultimo = ora; }, 5);
    const misura = async (nome, fn) => {
      max = 0;
      ultimo = performance.now();
      const r = await fn();
      fermi[nome] = Math.round(max);
      return r;
    };
    try {
      await misura('salva', () => segreto.scriviFile('foto.bin', dati));
      await segreto.chiudi();
      const r = await misura('apri', () => M.apriSegreto({ ...base, nome: 'Casa' }));
      await misura('leggi', () => r.segreto.leggiFile('foto.bin'));
      await misura('togli il file', () => r.segreto.cancellaFile('foto.bin'));
      await r.segreto.chiudi();
    } finally {
      clearInterval(battito);
    }
    const troppo = Object.fromEntries(Object.entries(fermi).filter(([, ms]) => ms > FERMO_MAX_MS));
    expect(troppo, `fermi del processo in ms: ${JSON.stringify(fermi)}`).toEqual({});
  } finally {
    togliCartella(dir);
  }
});
