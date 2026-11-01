// #1669 giro 2 — r1: la rete riconosce nome e cognome solo come parole separate; attaccati o legati da un punto o un
// trattino, come nella cartella personale che il Mac crea di serie, passano nel feedback.

import { test, expect } from '../../fixtures/electron.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/segnalazioneAnonima.js');
const A = globalThis.SN_SEGNALAZIONE_ANONIMA;

test('r1 nome e cognome attaccati in un percorso o in un nome di file escono dalla segnalazione', () => {
  const id = { nomi: ['Giulia Ferraris'], email: ['giulia.ferraris@example.com'] };
  for (const t of [
    'Non trova /Users/giuliaferraris/Desktop/foto.png',
    'Il file C:\\Users\\GiuliaFerraris\\Desktop\\nota.txt non si apre.',
    'La cartella /home/giulia.ferraris/progetti resta vuota.',
    'Il file cv-giulia-ferraris.pdf non si apre.',
  ]) expect(A.ripulisci(t, id), t).not.toMatch(/giulia|ferraris/i);
});
