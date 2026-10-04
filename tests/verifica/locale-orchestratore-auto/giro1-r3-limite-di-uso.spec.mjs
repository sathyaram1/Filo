// Giro 1, rilievo 3: il limite d'uso dell'abbonamento si aspetta, non ferma il lavoro.
import { test, expect } from '@playwright/test';
import { creaMotore, nuovaPratica } from '../../../scripts/lib/orchestratore.mjs';
import { finti } from './_finti.mjs';

test('il lavoratore che incontra il limite d’uso riparte dopo l’attesa', async () => {
  const p = nuovaPratica({ num: 9, richiesta: 'x' });
  const superata = { ok: true, entry: { request: 'x', verdict: 'pass', derived: [] } };
  const limite = { ok: false, testo: '', costo: 0, errore: "You've hit your limit · resets 3pm (Europe/Rome)" };
  const d = finti({ stato: { coda: [9], pratiche: { 9: p } }, verdetti: [{}, superata], claude: [limite] });
  const fine = (await creaMotore(d, { pausaMs: 0 }).avvia()).pratiche[9];
  expect(fine.fase).toBe('fuso');
});
