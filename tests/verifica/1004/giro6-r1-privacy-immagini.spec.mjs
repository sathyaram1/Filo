// Verifica #1004 giro 6, rilievo 1: la pagina Privacy elenca ciò che parte verso i modelli senza che lo si chieda,
// ma non dice che ogni screenshot e ogni immagine copiata vanno a un modello per farne il nome.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';

test('la sezione «Quello che parte senza che tu lo chieda» nomina gli screenshot e le immagini copiate', async () => {
  const testo = fs.readFileSync(path.join(process.cwd(), 'transparency', 'privacy.md'), 'utf8');
  const inizio = testo.indexOf('Quello che parte senza che tu lo chieda');
  expect(inizio).toBeGreaterThan(-1);
  const sezione = testo.slice(inizio, testo.indexOf('\n\nNiente di questo passa dal server', inizio));
  expect(sezione).toMatch(/screenshot/i);
  expect(sezione).toMatch(/immagin[ei] che copi|immagine copiata|copi un'immagine/i);
});
