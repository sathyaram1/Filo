// Verifica #866 giro 1, rilievo 1 — una cancellazione di pagine vale per il tempo che dice, non per l'ordine in cui
// gli eventi arrivano: un import non cancella pagine visitate dopo, e una visita in arrivo del periodo cancellato non resta.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
require('../../../src/shared/filoEventi.js');
const { creaFilo } = require('../../../src/main/services/ilFilo.js');
const NO = { incognito: false };
const TUTTO = { da: null, a: null };

test('importare un backup di un altro profilo che aveva cancellato tutto non cancella le pagine di qui', async () => {
  const a = mkdtempSync(join(tmpdir(), 'filo-866-vA-'));
  const b = mkdtempSync(join(tmpdir(), 'filo-866-vB-'));
  try {
    const A = creaFilo({ cartella: a });
    const B = creaFilo({ cartella: b });
    await A.registraVisita({ url: 'https://a.example/', titolo: 'A', ts: new Date(Date.now() - 5 * 86400e3).toISOString() }, NO);
    await A.cancellaPagine(TUTTO, NO);
    const backup = await A.esporta(NO);
    await new Promise((r) => setTimeout(r, 20));
    await B.registraVisita({ url: 'https://b.example/1', titolo: 'B1' }, NO);
    await B.registraVisita({ url: 'https://b.example/2', titolo: 'B2' }, NO);
    await B.importa(backup, NO);
    expect((await B.pagine(TUTTO, NO)).map((p) => p.titolo).sort()).toEqual(['B1', 'B2']);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test('una pagina del periodo cancellato che arriva dopo la cancellazione (titolo ancora in caricamento) non resta', async () => {
  const d = mkdtempSync(join(tmpdir(), 'filo-866-vC-'));
  try {
    const F = creaFilo({ cartella: d });
    const aperta = new Date(Date.now() - 2000).toISOString();
    await F.cancellaPagine({ da: new Date(Date.now() - 3600e3).toISOString(), a: new Date().toISOString() }, NO);
    await F.registraVisita({ url: 'https://in-caricamento.example/', titolo: 'In caricamento', ts: aperta }, NO);
    expect((await F.pagine(TUTTO, NO)).map((p) => p.titolo)).toEqual([]);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
