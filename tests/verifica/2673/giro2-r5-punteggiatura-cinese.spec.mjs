// Verifica #2673 giro 2 — in cinese non ci sono spazi: dopo la password, la virgola o il punto a tutta larghezza chiudono
// il valore, e il resto della frase arriva ai modelli. Logica pura, senza Electron.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const P = require('../../../src/shared/pavimento.js');
const R = require('../../../src/main/services/correttoreRiservati.js');

test('r5 dopo l\'etichetta cinese si copre la password, non la frase che segue', () => {
  for (const riga of ['密码：Gatto2024。明天见面吧', '密码: Gatto2024，明天见面', 'Marco: 密码是多少\nLuca: Gatto2024，明天见']) {
    const t = P.oscura(riga);
    expect(t, riga).not.toContain('Gatto2024');
    expect(t, riga).toContain('明天见');
  }
});

test('r5 nella risposta in chat al correttore arriva la frase dopo la password', () => {
  for (const campo of ['gattonero。我们明天见面吧', 'gattonero，明天见', 'gattonero！明天见']) {
    const t = R.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0, sopra: 'Marco: 密码是多少' }).nuovo;
    expect(t, campo).not.toContain('gattonero');
    expect(t, campo).toContain('明天');
  }
});
