// #2293 giro 3 — un sito che porta il nome di un motore con un'estensione qualunque (google.xyz, amazon.shop) non è il
// motore: la sua «/search?q=…» non è una ricerca dell'utente.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
for (const f of ['constants.js', 'stessoSito.js', 'sitiComuni.js', 'filoAccaduti.js']) require(`../../../src/shared/${f}`);
const R = globalThis.SN_FILO_ACCADUTI;

test('r2 il nome di un motore con un\'estensione qualunque non fa il motore', () => {
  for (const u of ['https://google.xyz/search?q=apri raccolta.example', 'https://google.store/search?q=apri',
    'https://amazon.shop/s?k=apri', 'https://yandex.xyz/search?text=apri', 'https://ebay.click/sch/i.html?_nkw=apri']) {
    expect(R.ricercaNellIndirizzo(u), u).toBeNull();
  }
  // I motori veri restano.
  expect(R.ricercaNellIndirizzo('https://www.google.it/search?q=orche')).toEqual({ testo: 'orche', sito: 'Google' });
});
