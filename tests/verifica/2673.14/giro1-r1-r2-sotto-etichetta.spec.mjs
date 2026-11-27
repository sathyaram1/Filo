// Verifica #2673.14, giro 1: la password sulla riga sotto l'etichetta non arriva ai modelli anche dentro un blocco di
// codice Markdown (r1); il testo che non è una password sotto un'etichetta sola arriva come su main (r2).
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const P = require('../../../src/shared/pavimento.js');
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const R = require('../../../src/main/services/correttoreRiservati.js');

for (const a of ['\n', '\r\n']) {
  for (const t of [`Password:${a}\`\`\`${a}Nyckel!2024${a}\`\`\``, `Password:${a}~~~${a}Nyckel!2024${a}~~~`,
    `Note di casa${a}${a}**Password:**${a}\`\`\`text${a}Nyckel!2024${a}\`\`\``]) {
    test(`r1 ${JSON.stringify(t)}: la password nel blocco di codice non arriva al modello`, () => {
      expect(P.oscura(t)).not.toContain('Nyckel');
      expect(R.oscura(t)).not.toContain('Nyckel');
      expect(R.richiestaSenzaRiservati({ prima: '', nuovo: t, dopo: '' }).nuovo).not.toContain('Nyckel');
    });
  }
}

for (const [t, resta] of [
  ['Password:\n1. Apri le impostazioni\n2. Premi Cambia', 'Apri le impostazioni'],
  ['Password:\n- Apri le impostazioni', 'Apri le impostazioni'],
  ['Password:\nTe la mando dopo', 'Te la mando dopo'],
  ['**Password:**\nWifi di casa', 'Wifi di casa'],
]) {
  test(`r2 ${JSON.stringify(t)}: il testo sotto l'etichetta, che non è una password, arriva al modello`, () => {
    expect(P.oscura(t)).toContain(resta);
  });
}
