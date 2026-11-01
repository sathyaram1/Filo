// #1669 giro 1 — r2: la rete riconosce il nome solo come parola a sé con la maiuscola; in un percorso scritto in
// minuscolo, o come metà di un cognome col trattino, il nome dell'account passa nel feedback.

import { test, expect } from '../../fixtures/electron.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/segnalazioneAnonima.js');
const A = globalThis.SN_SEGNALAZIONE_ANONIMA;

test('r2 il nome dell\'account in un percorso in minuscolo esce dalla segnalazione', () => {
  const id = { nomi: ['Giulia Ferraris'], email: ['giulia.ferraris@example.com'] };
  for (const t of [
    'Il file C:\\Users\\giulia\\Documents\\fattura.pdf non si apre.',
    'Non trova /Users/giulia/Desktop/foto.png',
    'La cartella /home/ferraris/progetti resta vuota.',
  ]) expect(A.ripulisci(t, id), t).not.toMatch(/giulia|ferraris/i);
});

test('r2 un pezzo di un cognome col trattino esce anche da solo', () => {
  const id = { nomi: ['José Núñez-García'], email: [] };
  expect(A.ripulisci('Núñez dice che il tema scuro non si applica.', id)).not.toMatch(/Núñez/);
});
