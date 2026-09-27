// Verifica locale, giro 3: la prova ancora rossa di un rilievo da correggere smette di esserlo senza che il codice
// sia corretto, e la consegna passa. Tre porte: l'aiuto della cartella cambiato da chi corregge o nella pulizia, e
// il caso da correggere tolto insieme a quello messo da parte da una prova che li copre tutti e due.

import { test, expect } from '@playwright/test';
import { copia, RIASSUNTO, REPORT } from './giro3-copia.mjs';

const CRITICA = [RIASSUNTO, '[2i] rilievo a: la cosa a non funziona.', '[1i?] rilievo b: bordo grigio o caldo? Scelta di gusto.'].join('\n');
let c;
test.beforeAll(async () => { test.setTimeout(300_000); c = await copia(); });
test.afterAll(() => { if (c) c.chiudi(); });

// Le prove r1 e r2 chiamano un aiuto comune nella cartella del giro, come fanno molte cartelle vere.
async function conAiuto(nome) {
  const cart = await c.ramo(nome, ['a', 'b']);
  c.scrivi(`${cart}/giro3-aiuto.mjs`, [
    "import { readFileSync } from 'node:fs';",
    'export function chiuso(k) {',
    "  const t = readFileSync(`stato-${k}.txt`, 'utf8');",
    "  if (!t.includes('corretto')) throw new Error(`rilievo ${k} ancora aperto`);",
    '}', ''].join('\n'));
  for (const [n, k] of [[1, 'a'], [2, 'b']]) {
    c.scrivi(`${cart}/giro3-r${n}-${k}.spec.mjs`, [
      "import { test } from '@playwright/test';", "import { chiuso } from './giro3-aiuto.mjs';",
      `test('rilievo ${k} chiuso', () => { chiuso('${k}'); });`, ''].join('\n'));
  }
  c.commit('prove del giro');
  expect((await c.vl('critica', CRITICA)).out).toContain('ESITO: c\'è da correggere');
  const neutra = () => c.scrivi(`${cart}/giro3-aiuto.mjs`,
    c.leggi(`${cart}/giro3-aiuto.mjs`).split('\n').filter((l) => !l.includes('throw')).join('\n'));
  return { cart, neutra };
}

// Il rilievo a resta rotto in tutti e tre i casi: o la pulizia è respinta, o la consegna si ferma.
const aperto = (pulizia, consegna) => pulizia.status === 0 && consegna.status === 0;

test('chi corregge cambia l\'aiuto della cartella e la prova rossa di a diventa verde', async () => {
  test.setTimeout(300_000);
  const { cart, neutra } = await conAiuto('aiuto-correzione');
  c.git('rm', '-q', `${cart}/giro3-r2-b.spec.mjs`);
  c.commit('pulizia del giro');
  const pulizia = await c.vl('pulizia');
  neutra();
  c.scrivi('stato-z.txt', 'una modifica qualsiasi: a resta rotto\n');
  c.commit('correzione');
  const consegna = await c.vl('corretto', REPORT);
  expect(c.leggi('stato-a.txt')).toContain('rotto');
  expect(aperto(pulizia, consegna), `${pulizia.out}\n---\n${consegna.out}`).toBe(false);
});

test('la pulizia toglie righe dall\'aiuto della cartella e la prova rossa di a diventa verde', async () => {
  test.setTimeout(300_000);
  const { cart, neutra } = await conAiuto('aiuto-pulizia');
  c.git('rm', '-q', `${cart}/giro3-r2-b.spec.mjs`);
  neutra();
  c.commit('pulizia del giro');
  const pulizia = await c.vl('pulizia');
  c.scrivi('stato-z.txt', 'una modifica qualsiasi: a resta rotto\n');
  c.commit('correzione');
  const consegna = await c.vl('corretto', REPORT);
  expect(aperto(pulizia, consegna), `${pulizia.out}\n---\n${consegna.out}`).toBe(false);
});

test('la pulizia di una prova che copre a e b toglie anche il caso di a', async () => {
  test.setTimeout(300_000);
  const cart = await c.ramo('misto', ['a', 'b']);
  const f = `${cart}/giro3-r1-r2-misto.spec.mjs`;
  c.prova(cart, 'giro3-r1-r2-misto.spec.mjs', ['a', 'b']);
  c.commit('prove del giro');
  expect((await c.vl('critica', CRITICA)).out).toContain('ESITO: c\'è da correggere');
  const righe = c.leggi(f).split('\n');
  righe.splice(righe.findIndex((r) => r.includes('rilievo b')), 3);
  c.scrivi(f, righe.filter((r) => !r.includes('stato-a')).join('\n'));
  c.commit('pulizia del giro');
  const pulizia = await c.vl('pulizia');
  c.scrivi('stato-z.txt', 'una modifica qualsiasi: a resta rotto\n');
  c.commit('correzione');
  const consegna = await c.vl('corretto', REPORT);
  expect(aperto(pulizia, consegna), `${pulizia.out}\n---\n${consegna.out}`).toBe(false);
});
