// Verifica #2383, giro 1, rilievo 2: una citazione cucita con «...» da frasi lontane non è una frase della pagina.
import { createRequire } from 'node:module';
import { test, expect } from '../../fixtures/electron.mjs';

const require = createRequire(import.meta.url);
require('../../../src/shared/fontiCitate.js');
const F = globalThis.SN_FONTI_CITATE;

const URL = 'https://it.wikipedia.org/wiki/Ada_Rossi';
const pagina = {
  tipo: 'pagina', url: URL, chiavi: new Set([F.chiave(URL)]), titolo: 'Ada Rossi', lettaIl: new Date().toISOString(),
  testo: 'Ada Rossi\nAda Rossi è nata a Roma nel 1961. Ha studiato lettere a Bologna. Nel 1990 ha vinto il premio di poesia.',
};

test('r2 «Ada Rossi è nata ... 1990» non è verificata: nella pagina è nata nel 1961, il 1990 è un\'altra frase', () => {
  const r = F.controlla(`È nata nel 1990. [[fonte: ${URL} | Ada Rossi è nata ... 1990]]`, [pagina]);
  expect(r.fonti).toHaveLength(1);
  expect(r.fonti[0].esito).toBe('non_trovata');
});

test('r2 la stessa frase accorciata dentro la stessa frase della pagina resta verificata', () => {
  const r = F.controlla(`È nata a Roma. [[fonte: ${URL} | Ada Rossi è nata [...] nel 1961]]`, [pagina]);
  expect(r.fonti[0].esito).toBe('verificata');
});
