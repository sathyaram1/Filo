// Verifica #2695.8, giro 2: la password detta prima del suo nome, ai due cancelli verso i modelli (correttore e pavimento).
// Logica pura: niente Filo da aprire. r1 dati non segreti tolti, r2 forme prima del nome mancanti, r3 parole comuni nascoste.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const P = require('../../../src/shared/pavimento.js');
const R = require('../../../src/main/services/correttoreRiservati.js');
const cancelli = { pavimento: (t) => P.oscura(t), correttore: (t) => R.oscura(t) };

test('r1 il nome utente, l\'email o il sito prima di «e la password» arrivano ai modelli', () => {
  const casi = [
    ['l\'utente è mario88 e la password è Gatto2024', 'mario88'],
    ['accedi con mario@example.com e la password che ti ho dato', 'mario@example.com'],
    ['vai su example.com e la password è nel foglio', 'example.com'],
    ['username mario_88 e la password te la mando dopo', 'mario_88'],
  ];
  for (const [nome, oscura] of Object.entries(cancelli)) {
    for (const [t, resta] of casi) expect(oscura(t), `${nome}: ${t}`).toContain(resta);
  }
});

test('r2 prima del nome si toglie anche con un nome composto, un avverbio o «codice»', () => {
  const casi = [
    ['Gatto2024 is my wifi password', 'my wifi password is Gatto2024'],
    ['use Gatto2024 as the wifi password', 'the wifi password is Gatto2024'],
    ['Gatto2024 ist das WLAN-Passwort', 'das WLAN-Passwort ist Gatto2024'],
    ['Gatto2024 è anche la password della mail', 'la password della mail è anche Gatto2024'],
    ['Gatto2024 è diventata la password', 'la password è diventata Gatto2024'],
    ['Gatto2024 è il codice del wifi', 'il codice del wifi è Gatto2024'],
  ];
  for (const [nome, oscura] of Object.entries(cancelli)) {
    for (const [prima, dopo] of casi) {
      if (oscura(dopo).includes('Gatto2024')) continue;
      expect(oscura(prima), `${nome}: «${prima}» passa, «${dopo}» no`).not.toContain('Gatto2024');
    }
  }
});

test('r3 una parola comune prima di «come password» o «è la password» resta al correttore', () => {
  for (const t of ['usa qualcosa come password', 'scegli qualcosa come password', 'use anything as the password',
    'anything is the password', 'sbagliata è la password', 'scaduta è la password']) {
    expect(R.oscura(t), t).toBe(t);
  }
});
