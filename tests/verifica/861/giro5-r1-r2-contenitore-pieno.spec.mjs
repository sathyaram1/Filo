// #861 giro 5 — nel contenitore vero da 1 GB, lo spazio che il motore dice libero non si raggiunge tutto: chi scrive
// esattamente quel tanto si vede rifiutare con «servono 0, ne restano 0», e chi sostituisce un file perde il vecchio.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const M = require('../../../src/main/services/segreto/motore.js');
const PROVA = { passate: 1, memoriaKiB: 1024, parallelismo: 1 };
const MB = 1 << 20;
const GB = 1024 * MB;
const impronta = (b) => createHash('sha256').update(b).digest('hex');

// Ogni prova scrive mezzo GB: rifarla non cambia l'esito e triplica l'attesa.
test.describe.configure({ retries: 0, timeout: 8 * 60_000 });

let dir;
test.beforeAll(() => { dir = cartellaTemporanea('verifica-861-'); });
test.afterAll(() => togliCartella(dir));

async function contenitore(nome) {
  const percorso = join(dir, nome);
  await M.creaContenitore(percorso, GB);
  return { contenitore: percorso, dimensione: GB, sale: Buffer.alloc(16, 1), parametriChiave: PROVA };
}

test('r1 scrivere esattamente lo spazio che il segreto dice libero riesce, o il rifiuto dice numeri veri', async () => {
  const base = await contenitore('r1.bin');
  const { segreto } = await M.creaSegreto({ ...base, nome: 'Casa' });
  const { disponibili } = segreto.spazio();
  expect(disponibili).toBeGreaterThan(500 * MB);
  let errore = null;
  try {
    await segreto.scriviFile('tutto.bin', randomBytes(disponibili));
  } catch (e) {
    errore = { codice: e.codice, servono: e.servono, disponibili: e.disponibili, dopo: segreto.spazio().disponibili };
  }
  expect(errore).toBeNull();
});

test('r2 sostituire un file con uno della dimensione massima annunciata non perde il vecchio', async () => {
  const base = await contenitore('r2.bin');
  const { segreto } = await M.creaSegreto({ ...base, nome: 'Casa' });
  const vecchio = randomBytes(300 * MB);
  await segreto.scriviFile('foto.bin', vecchio);
  let massimo = 0;
  await segreto.scriviFile('foto.bin', Buffer.alloc(560 * MB)).catch((e) => { massimo = e.disponibili; });
  expect(massimo).toBeGreaterThan(300 * MB);
  const nuovo = randomBytes(massimo);
  const riuscito = await segreto.scriviFile('foto.bin', nuovo).then(() => true, () => false);
  const r = await M.apriSegreto({ ...base, nome: 'Casa' });
  expect(r.esito).toBe('aperto');
  const letto = await r.segreto.leggiFile('foto.bin').catch((e) => e.codice);
  expect(Buffer.isBuffer(letto), `foto.bin dopo la sostituzione ${riuscito ? 'riuscita' : 'rifiutata'}: ${letto}`).toBe(true);
  expect(impronta(letto)).toBe(impronta(riuscito ? nuovo : vecchio));
});
