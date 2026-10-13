// Verifica locale #1159, giro 1, rilievo 2: le istruzioni di un lavoro server per chi verifica, quando il token non esce.
import { test, expect } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r2 il verificatore di un lavoro server sa cosa fare se il token non esce, con quello che ha', async () => {
  const d = await import(pathToFileURL(resolve(APP, 'scripts', 'dispatch.mjs')).href);
  // Le istruzioni come le compone dispatch per una verifica piena con la busta `lavoroServer`.
  const testo = [d.readRoleInstructions('verifier', { scope: 'pieno' }), d.testoLavoroServer({ clone: '/home/user/filo-security' })].join('\n\n');
  // Ogni sezione che il testo nomina come «…» per dire cosa fare deve stare nel testo che riceve.
  const rimandi = [...testo.matchAll(/come dice «([^»]+)»/g)].map((m) => m[1]);
  const mancanti = rimandi.filter((titolo) => !testo.includes(`## ${titolo}`));
  expect(mancanti).toEqual([]);
  // Chi verifica non può consegnare uno stato (il server glielo rifiuta): non deve essere la strada che gli si indica.
  expect(testo).not.toMatch(/deliver status/);
});
