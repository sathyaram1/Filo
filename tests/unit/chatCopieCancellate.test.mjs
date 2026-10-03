// Sentinella delle copie di una chat cancellata (#866): il suo testo si toglie dalle copie intere, scritte come JSON o
// troncate, e un messaggio corto non porta via le parole uguali dentro altre parole.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../src/shared/chatArchive.js';

const CA = globalThis.SN_CHAT_ARCHIVE;
const X = CA.CHAT_CANCELLATA;

test('un messaggio si toglie intero, scritto come JSON e troncato in fondo a una copia', () => {
  const lungo = 'Ho ricevuto i risultati delle analisi e vorrei capire cosa significano. '.repeat(5);
  const forme = CA.formeDaDimenticare(['La mia diagnosi è "seria"\nche faccio?', lungo, 'ok']);
  const copia = {
    interazione: 'UTENTE: La mia diagnosi è "seria"\nche faccio?\nFILO: ok',
    risposta: JSON.stringify({ text: 'La mia diagnosi è "seria"\nche faccio?' }),
    registro: lungo.slice(0, 200),
    tagliato: `Domanda: ${lungo.slice(0, 120)}…`,
  };
  assert.ok(CA.riguardaChat(copia, forme));
  assert.deepEqual(CA.redigiChat(copia, forme), {
    interazione: `UTENTE: ${X}\nFILO: ${X}`,
    risposta: JSON.stringify({ text: X }),
    registro: X,
    tagliato: `Domanda: ${X}…`,
  });
});

test('un messaggio corto vale solo intero e fra confini di parola; da solo non lega una copia alla chat', () => {
  const forme = CA.formeDaDimenticare(['ok']);
  assert.equal(CA.redigiChat('book ok, okay', forme), `book ${X}, okay`);
  assert.equal(CA.riguardaChat('ho detto ok a tutti', forme), false);
  assert.equal(CA.riguardaChat(['ok'], forme), true);
  assert.equal(CA.riguardaChat('un’altra chat sul Barocco', CA.formeDaDimenticare(['La mia diagnosi PRIVATO-77'])), false);
});
