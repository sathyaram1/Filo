// Giro 1, rilievo 2: anche il verificatore riceve la cartella per appunti, script di prova e note.
import { test, expect } from '@playwright/test';
import { creaMotore, nuovaPratica } from '../../../scripts/lib/orchestratore.mjs';
import { finti } from './_finti.mjs';

test('il compito del verificatore indica la cartella fuori dal repo', async () => {
  const p = nuovaPratica({ num: 8, richiesta: 'x' });
  const superata = { ok: true, entry: { request: 'x', verdict: 'pass', derived: [] } };
  const d = finti({ stato: { coda: [8], pratiche: { 8: p } }, verdetti: [{}, superata] });
  await creaMotore(d, { pausaMs: 0 }).avvia();
  const lav = d.prompt.find((x) => x.ruolo === 'lavoratore');
  const ver = d.prompt.find((x) => x.ruolo === 'verificatore');
  expect(lav.testo).toContain('/cartella-note');
  expect(ver.testo).toContain('/cartella-note');
});
