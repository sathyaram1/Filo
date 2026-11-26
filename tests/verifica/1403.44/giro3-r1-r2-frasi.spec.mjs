// Verifica #1403.44, giro 3: il codice del proprio apparecchio detto cambiandolo, col posto prima, o in forme rare.
// Logica pura sul pavimento che il cancello dei modelli applica a ogni messaggio: niente finestra da aprire.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const P = require(join(resolve(process.cwd()), 'src', 'shared', 'pavimento.js'));
const alModello = (frase) => P.oscuraTutto([{ role: 'user', content: frase }])[0].content;

// ogni voce: [frase, ...pezzi che non devono arrivare]
function nessunoArriva(voci) {
  const arrivati = voci.filter(([f, ...segreti]) => {
    const out = alModello(f);
    return segreti.some((s) => out.includes(s));
  }).map(([f]) => f);
  expect(arrivati, 'frasi il cui codice arriva al modello').toEqual([]);
}

test('r1 il codice cambiato o impostato con un verbo, in italiano, francese, spagnolo e tedesco', () => {
  nessunoArriva([
    ['ho cambiato il codice del mio telefono in 4829', '4829'],
    ['ho cambiato il PIN del mio telefono in 4829', '4829'],
    ['ho cambiato il codice del mio pc in 4829', '4829'],
    ['il codice del mio telefono è stato cambiato in 4829', '4829'],
    ['il codice del mio telefono l\'ho cambiato in 4829', '4829'],
    ['il codice del mio telefono adesso l\'ho messo a 4829', '4829'],
    ['ho impostato 4829 come codice del mio telefono', '4829'],
    ['ho messo come codice del mio telefono 4829', '4829'],
    ['J\'ai changé le code de mon téléphone en 4829', '4829'],
    ['He cambiado el código de mi teléfono a 4829', '4829'],
    ['He puesto 4829 como código de mi teléfono', '4829'],
    ['I\'ve set 4829 as my phone code', '4829'],
    ['Ich habe den Code meines Handys auf 4829 geändert', '4829'],
  ]);
});

test('r1 il codice che diventa o resta: «è diventato», «rimane», «est devenu», «sigue siendo», «became»', () => {
  nessunoArriva([
    ['il codice del mio telefono è diventato 4829', '4829'],
    ['Le code de mon téléphone est devenu 4829', '4829'],
    ['the code of my phone became 4829', '4829'],
    ['il codice del mio telefono resta 4829', '4829'],
    ['il codice del mio telefono rimane 4829', '4829'],
    ['Il codice del mio telefono è tuttora 4829', '4829'],
    ['Il codice del mio telefono è di nuovo 4829', '4829'],
    ['Le code de mon téléphone reste 4829', '4829'],
    ['Le code de mon téléphone est encore 4829', '4829'],
    ['El código de mi teléfono sigue siendo 4829', '4829'],
  ]);
});

test('r1 l\'apparecchio detto prima del codice', () => {
  nessunoArriva([
    ['sul mio telefono il codice è 4829', '4829'],
    ['nel mio telefono il codice è 4829', '4829'],
    ['on my phone the code is 4829', '4829'],
    ['sur mon téléphone le code est 4829', '4829'],
    ['en mi teléfono el código es 4829', '4829'],
    ['ho messo il codice 4829 sul mio telefono', '4829'],
    ['sul mio telefono ho messo il codice 4829', '4829'],
    ['Mon téléphone a le code 4829', '4829'],
  ]);
});

test('r2 forme rare: due codici, cifre staccate, una parola in mezzo, un refuso', () => {
  nessunoArriva([
    ['il codice del mio telefono è 4829 o forse 4830', '4830'],
    ['il codice del mio telefono è 4829, oppure 4830', '4830'],
    ['My phone code is 4829 or maybe 4830', '4830'],
    ['il codice del mio telefono è 4 8 2 9', '4 8 2 9'],
    ['Il codice del mio telefono lo sai, è 4829', '4829'],
    ['il codice del mio telefono è sempre il solito, 4829', '4829'],
    ['il codice dle mio telefono è 4829', '4829'],
    ['il cdice del mio telefono è 4829', '4829'],
  ]);
});
