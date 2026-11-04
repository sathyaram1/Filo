// Verifica #1926 giro 2, r2: il nome di una parola d'ordine che il server rifiuta lo rifiuta già Gestione, con la regola
// del server (una lettera o cifra in testa, poi lettere, cifre, punto, trattino basso e trattino, 63 al massimo).
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/routineChiavi.js');
const C = globalThis.SN_ROUTINE_CHIAVI;

test('r2 Gestione rifiuta subito i nomi che il server non accetta, e accetta quelli che accetta', () => {
  for (const slug of ['città', 'pc/casa', '_pc', 'pc:casa', 'a'.repeat(64)]) {
    expect(C.validaNuova({ slug, scope: 'sessione' }).ok, slug).toBe(false);
  }
  for (const slug of ['pc-casa', 'pc_casa', 'pc.casa', 'a'.repeat(63)]) {
    expect(C.validaNuova({ slug, scope: 'sessione' }).ok, slug).toBe(true);
  }
});
