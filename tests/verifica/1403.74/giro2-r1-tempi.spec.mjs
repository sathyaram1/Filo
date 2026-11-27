// #1403.74 giro 2: una pagina piena di collegamenti codificati qualunque (newsletter, risultati di ricerca) non deve
// rallentare il filtro verso i modelli molto più della stessa pagina coi collegamenti scritti in chiaro.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');

function tempo(s) {
  P.oscura(s);
  const t0 = process.hrtime.bigint();
  for (let k = 0; k < 5; k++) P.oscura(s);
  return Number(process.hrtime.bigint() - t0) / 5e6;
}

const pagine = {
  newsletter: (cod) => Array.from({ length: 300 }, (_, i) => cod
    ? `[Articolo ${i}](https://news.example.it/articolo/${i}?utm_source=newsletter%2Bsettimanale&utm_campaign=autunno%202026&ref=https%3A%2F%2Fhome.example.it%2F)`
    : `[Articolo ${i}](https://news.example.it/articolo/${i}?utm_source=newsletter-settimanale&utm_campaign=autunno-2026&ref=home.example.it)`).join('\n'),
  ricerca: (cod) => Array.from({ length: 300 }, (_, i) => cod
    ? `[Risultato ${i}](https://www.google.com/search?q=ricetta+della+pasta+al+forno+${i}&hl=it)`
    : `[Risultato ${i}](https://www.google.com/search?q=ricetta-della-pasta-al-forno-${i}&hl=it)`).join('\n'),
};

for (const [nome, pagina] of Object.entries(pagine)) {
  test(`r1 ${nome}: i collegamenti codificati non costano molto più di quelli in chiaro`, () => {
    const chiaro = tempo(pagina(false));
    const codificato = tempo(pagina(true));
    expect(codificato, `codificati ${codificato.toFixed(1)} ms, in chiaro ${chiaro.toFixed(1)} ms`).toBeLessThan(chiaro * 3 + 5);
  });
}
