// #2673 giro 1 — la password chiesta o etichettata in un'altra lingua: le forme comuni che restano fuori.
// Logica pura, senza aprire Filo: la risposta in chat passa dal correttore, l'etichetta dal pavimento.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const P = require('../../../src/shared/pavimento.js');
const C = require('../../../src/main/services/correttoreRiservati.js');
const S = P.SEGNAPOSTO;
const risposta = (campo, sopra) => C.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0, sopra }).nuovo;

test('r1 le richieste comuni in russo, greco e cinese senza un verbo dell\'elenco: la risposta sotto è una password', () => {
  // In italiano le stesse forme passano: «ricordami la password», «puoi mandarmi», «hai la password», «password del wifi».
  for (const it of ['ricordami la password', 'puoi mandarmi la password', 'hai la password del wifi', 'password del wifi']) {
    expect(risposta('gattonero', `Marco: ${it}`), it).toBe(S);
  }
  for (const d of ['напомни пароль от wifi', 'можешь скинуть пароль от wifi', 'у тебя есть пароль от wifi', 'пароль от wifi',
    'θυμάσαι τον κωδικό του wifi', 'μου λες τον κωδικό του wifi', 'τι κωδικό έχει το wifi',
    '你知道wifi密码吗', '密码呢', '请问wifi密码', 'wifi密码', 'wifi密码发一下']) {
    expect(risposta('gattonero', `Marco: ${d}`), d).toBe(S);
  }
});

test('r2 il punto di domanda greco: la domanda conta come col punto di domanda latino', () => {
  // Con «?» la risposta si riconosce; con il «;» greco no.
  expect(risposta('gattonero', 'Marco: τον κωδικό?')).toBe(S);
  expect(risposta('gattonero', 'Marco: τον κωδικό;')).toBe(S);
  // Il segno greco vero (U+037E) attaccato al nome lo cancella: nemmeno la risposta con le cifre si riconosce.
  expect(risposta('ok Nyckel2024', 'Marco: Ποιος είναι ο κωδικός;')).toBe(`ok ${S}`);
});

test('r3 le forme declinate dell\'etichetta: «parola» rumena con l\'articolo, «şifrem» turca', () => {
  for (const t of ['Şifrem: Nyckel!2024', 'Wi-Fi şifrem: Nyckel!2024', 'Parola mea: Nyckel!2024', 'Parola wifi: Nyckel!2024']) {
    expect(P.oscura(t), t).not.toContain('Nyckel');
  }
  for (const d of ['care e parola?', 'dă-mi parola', 'trimite-mi parola', 'spune-mi parola']) {
    expect(risposta('ok Nyckel2024', `Marco: ${d}`), d).toBe(`ok ${S}`);
  }
  // L'italiano resta com'è.
  expect(P.oscura('Parola del giorno: serendipità')).toBe('Parola del giorno: serendipità');
});
