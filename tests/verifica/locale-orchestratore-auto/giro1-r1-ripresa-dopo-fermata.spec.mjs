// Giro 1, rilievo 1: la ripresa di un lavoro fermo deve ripartire da dove si era fermato.
import { test, expect } from '@playwright/test';
import { creaMotore, nuovaPratica, riprendi } from '../../../scripts/lib/orchestratore.mjs';
import { finti } from './_finti.mjs';

const superata = { ok: true, entry: { request: 'x', verdict: 'pass', derived: [] } };

test('fusione in attesa di approvazione: riprendi fonde, senza una verifica nuova', async () => {
  const p = nuovaPratica({ num: 956, richiesta: 'x' });
  Object.assign(p, { fase: 'chiusura', giri: 1, giriTotali: 1 });
  const d = finti({ stato: { coda: [956], pratiche: { 956: p } }, verdetti: [superata], finish: [10] });
  const fermo = (await creaMotore(d, { pausaMs: 0 }).avvia()).pratiche[956];
  expect(fermo.fase).toBe('fermo');

  const ripresa = riprendi(fermo, '');
  const d2 = finti({ stato: { coda: [956], pratiche: { 956: ripresa } }, verdetti: [superata], finish: [0] });
  const fine = (await creaMotore(d2, { pausaMs: 0 }).avvia()).pratiche[956];
  expect(d2.comandi.filter((c) => /claude|verify-local/.test(c))).toEqual([]);
  expect(fine.fase).toBe('fuso');
});

test('correzione rimasta a metà: chi riprende riceve i rilievi da correggere', async () => {
  const p = nuovaPratica({ num: 7, richiesta: 'x' });
  const sospesa = { ok: false, entry: { request: 'x', verdict: 'fix-pending', pending: { findings: [{ level: 2, sede: 'i', text: 'il pulsante Salva non salva col titolo vuoto' }] } } };
  const d = finti({ stato: { coda: [7], pratiche: { 7: p } }, verdetti: [{}, sospesa] });
  const fermo = (await creaMotore(d, { pausaMs: 0 }).avvia()).pratiche[7];
  expect(fermo.fase).toBe('fermo');

  const ripresa = riprendi(fermo, 'vai pure');
  const d2 = finti({ stato: { coda: [7], pratiche: { 7: ripresa } }, verdetti: [sospesa] });
  await creaMotore(d2, { pausaMs: 0, tetto: 1 }).avvia();
  const primo = d2.prompt[0];
  expect(primo.ruolo).toBe('lavoratore');
  expect(primo.testo).toContain('il pulsante Salva non salva col titolo vuoto');
});
