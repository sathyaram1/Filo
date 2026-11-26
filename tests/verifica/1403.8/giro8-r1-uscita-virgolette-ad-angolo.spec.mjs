// Verifica #1403.8 giro 8: una password fra le virgolette ad angolo, che su main fermava l'uscita e entrava nel
// registro dei letti, sul ramo non la riconosce più nessuno dei due; il pavimento invece sì.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/pavimento.js');
require('../../../src/shared/autonomia.js');
const G = globalThis.SN_GUARDIANO_STATICO;
const A = globalThis.SN_AUTONOMIA;

const FRASI = [
  'password: 「Mela!Verde77」', 'la password è 「Mela!Verde77」', 'password: 『Mela!Verde77』',
  'la password è 「 Mela!Verde77 」', 'パスワードは「Kx82mPq9」です', 'パスワード：「Kx82mPq9」', '密码：『Kx82mPq9』',
];

test('r1 un\'azione che scrive una password fra 「」 o 『』 chiede conferma', () => {
  for (const f of FRASI) expect(A.segretoDettaglio(f).tipo, f).toBe('password');
});

test('r1 una password fra 「」 o 『』 letta su una pagina entra nel registro dei letti', () => {
  for (const f of FRASI) {
    const valori = G.segretiNelTesto(f).map((x) => x.valore.replace(/[「」『』\s]/g, ''));
    expect(valori.some((v) => v === 'Mela!Verde77' || v === 'Kx82mPq9'), f).toBe(true);
  }
});
