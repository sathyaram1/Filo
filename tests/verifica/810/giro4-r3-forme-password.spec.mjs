// Verifica #810, giro 4, rilievo 3: password e chiavi di recupero scritte in forme comuni non vengono
// riconosciute nel testo letto da fuori.

import { test, expect } from '../../fixtures/electron.mjs';

const FORME = [
  ['Password di accesso: Tr7#kq29Lm', 'Tr7#kq29Lm'],
  ['Password per il primo accesso: Tr7kq29Lm', 'Tr7kq29Lm'],
  ['La password provvisoria è Tr7kq29Lm', 'Tr7kq29Lm'],
  ['Password iniziale: Tr7kq29Lm', 'Tr7kq29Lm'],
  ['Password for your account: Tr7#kq29Lm', 'Tr7#kq29Lm'],
  ['Recovery key: ABCD-EFGH-IJKL-MNOP', 'ABCD-EFGH-IJKL-MNOP'],
];

test('le forme comuni di password e chiavi di recupero sono riconosciute nel testo letto', async ({ app }) => {
  const trovati = await app.evaluate((_electron, forme) => forme.map(([testo]) => (
    globalThis.SN_GUARDIANO_STATICO.segretiNelTesto(testo).map((x) => x.valore)
  )), FORME);
  FORME.forEach(([testo, valore], i) => expect(trovati[i], testo).toContain(valore));
});
