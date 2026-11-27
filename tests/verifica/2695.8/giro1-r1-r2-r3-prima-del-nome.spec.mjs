// #2695.8 giro 1: la password detta prima del suo nome non arriva a nessuno dei due cancelli verso i modelli (il
// pavimento e il correttore), con la punteggiatura attaccata e nelle forme che dopo il nome valgono già.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');
const C = require('../../../src/main/services/correttoreRiservati.js');
const cancelli = { pavimento: (t) => P.oscuraTutto(t), correttore: (t) => C.oscura(t) };

function nessunoLaVede(frase, valore) {
  for (const [nome, oscura] of Object.entries(cancelli)) {
    const fuori = oscura(frase);
    expect(fuori, `${nome}: ${frase}`).not.toContain(valore);
    expect(fuori, `${nome}: ${frase}`).toContain('[dato riservato]');
  }
}

test('r1 il punto esclamativo o di domanda in fondo alla password non la fa passare', () => {
  for (const frase of [
    'Gatto2024! è la password',
    'usa Gatto2024! come password',
    'Gatto2024! è la mia password',
    'Gatto2024!! è la password',
    'Gatto2024? è la password',
    'Gatto2024, è la password',
  ]) nessunoLaVede(frase, 'Gatto2024');
  // Dopo il nome la stessa password si toglie già: il confronto che dice cosa ci si aspetta.
  nessunoLaVede('la password è Gatto2024!', 'Gatto2024');
});

test('r2 prima del nome valgono le forme che dopo il nome valgono già', () => {
  for (const frase of [
    'Gatto2024 ist das Passwort',
    'Gatto2024 est le mot de passe',
    'Gatto2024 es la contraseña',
    'benutze Gatto2024 als Passwort',
    'usa Gatto2024 como contraseña',
    'usa Gatto2024 come pass',
    'Gatto2024 e la password',
  ]) nessunoLaVede(frase, 'Gatto2024');
});

test('r3 una frase qualunque che finisce con «è la password» resta intera al correttore', () => {
  for (const frase of [
    'la cosa che mi manca è la password',
    "l'unica cosa che non ricordo è la password",
    'quello che ho dimenticato è la password',
    'la cosa più importante è la password',
  ]) expect(C.oscura(frase), frase).toBe(frase);
  // La password vera, nella stessa forma, si toglie ancora.
  expect(C.oscura('gattonero è la password')).toBe('[dato riservato] è la password');
});
