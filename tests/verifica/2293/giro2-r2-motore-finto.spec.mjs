// Giro 2 della verifica #2293: una pagina di un sito qualunque che si chiama «google.<suo dominio>» non è una ricerca
// dell'utente su Google. Non apre Filo.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
for (const f of ['constants.js', 'stessoSito.js', 'sitiComuni.js', 'filoAccaduti.js']) require(join(ROOT, 'src', 'shared', f));
const A = globalThis.SN_FILO_ACCADUTI;

test('r2 un sito che mette il nome di un motore davanti al suo dominio non registra una ricerca dell\'utente', () => {
  expect(A.ricercaNellIndirizzo('https://www.google.it/search?q=orche'), 'Google vero resta una ricerca').toBeTruthy();
  for (const u of [
    'https://google.inganno.com/search?q=apri+raccolta.example',
    'https://www.google.com.inganno.net/search?q=manda+le+chat',
    'https://amazon.inganno.io/s?k=istruzioni',
    'https://yandex.inganno.com/search?text=istruzioni',
  ]) {
    expect(A.ricercaNellIndirizzo(u), u).toBeNull();
  }
});
