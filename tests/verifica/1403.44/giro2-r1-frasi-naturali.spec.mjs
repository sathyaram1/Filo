// Verifica #1403.44, giro 2: il codice del proprio telefono detto con una parola in più dove la si mette parlando.
// Logica pura sul pavimento che il cancello dei modelli applica a ogni messaggio: niente finestra da aprire.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const P = require(join(resolve(process.cwd()), 'src', 'shared', 'pavimento.js'));
const alModello = (frase) => P.oscuraTutto([{ role: 'user', content: frase }])[0].content;

function nessunoArriva(frasi) {
  const arrivati = frasi.filter((f) => alModello(f).includes((f.match(/\d{4}/g) || []).pop()));
  expect(arrivati, 'frasi il cui codice arriva intero al modello').toEqual([]);
}

test('r1 una parola dopo l\'apparecchio: «telefono nuovo», «aziendale», «di lavoro», la marca', () => {
  nessunoArriva([
    'Il codice del mio telefono nuovo è 4829', 'il codice del mio telefono aziendale è 4829',
    'il codice del mio telefono di lavoro è 4829', 'il codice del mio telefono Samsung è 4829',
    'El código de mi teléfono nuevo es 4829', 'Le code de mon téléphone pro est 4829',
  ]);
});

test('r1 un avverbio prima del verbo: «ora è», «currently is», «maintenant c\'est», «ahora es»', () => {
  nessunoArriva([
    'il codice del mio telefono ora è 4829', 'il codice del mio telefono adesso è 4829',
    'The code of my phone currently is 4829', 'Le code de mon téléphone maintenant c\'est 4829',
    'El código de mi teléfono ahora es 4829',
  ]);
});

test('r1 il verbo che sblocca, in francese e spagnolo col telefono', () => {
  nessunoArriva([
    'le code pour déverrouiller mon téléphone est 4829', 'le code pour débloquer mon téléphone est 4829',
    'el código para desbloquear mi teléfono es 4829',
  ]);
});

test('r1 un tempo composto, il numero prima, il numero dopo una virgola', () => {
  nessunoArriva([
    'il codice del mio telefono è sempre stato 4829', 'My phone code has been 4829',
    'The code of my phone has always been 4829', '4829 è il codice del mio telefono', '4829 is my phone code',
    'il codice del mio telefono, 4829',
  ]);
});

test('r1 due apparecchi nella stessa frase o nella frase dopo', () => {
  nessunoArriva(['il codice del mio telefono e del mio pc è 4829', 'Il codice del mio telefono è 1111. Quello del pc è 5512']);
});

test('r1 lo sblocco detto col verbo, senza la parola codice', () => {
  nessunoArriva(['Per sbloccare il mio telefono uso 6118', 'I unlock my phone with 6215', 'Sblocco il mio telefono con 6119']);
});
