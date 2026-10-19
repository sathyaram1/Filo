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

test('un messaggio su più righe si toglie anche dalle copie che lo riscrivono su una riga sola', () => {
  const utente = 'La mia diagnosi è arrivata oggi.\nIl medico dice PRIVATO-77, cosa ne pensi?';
  const filo = 'Ecco cosa penso:\n\n- primo punto SEGRETO-88\n- secondo punto\n\nFammi sapere.';
  const forme = CA.formeDaDimenticare([utente, filo]);
  const riga = (x) => x.replace(/\s+/g, ' ');
  const copia = {
    home: `<<<TESTO_SALVATO>>>\n- [ora] chat_user: ${riga(utente)}\n- [ora] chat_filo: ${riga(filo)}\n<<<FINE_TESTO_SALVATO>>>`,
    registro: riga(filo.slice(0, 30)),
    json: JSON.stringify({ text: riga(utente) }),
  };
  assert.ok(CA.riguardaChat(copia, forme));
  const redatta = JSON.stringify(CA.redigiChat(copia, forme));
  assert.ok(!/PRIVATO-77|SEGRETO-88|primo punto/.test(redatta), redatta);
  assert.match(redatta, /chat_user: \[chat cancellata\]\\n- \[ora\] chat_filo: \[chat cancellata\]\\n<<<FINE/);
});

test('la trascrizione di una chat lunga, tagliata in mezzo, perde il testo anche nella testa e nella coda tagliate', () => {
  const lungo = (x) => Array.from({ length: 80 }, (_, i) => `${x} (${i})`).join('\n');
  const messaggi = [
    { role: 'user', text: lungo('Il giorno in cui mio padre è stato male') },
    { role: 'filo', text: lungo('Mi dispiace, ecco un’idea concreta') },
  ];
  const trascrizione = CA.transcriptForTriage(messaggi, 4000);
  assert.match(trascrizione, /omessa/);
  const redatta = CA.redigiChat(trascrizione, CA.formeDaDimenticare(messaggi.map((m) => m.text)));
  assert.ok(!/padre|dispiace/.test(redatta), redatta);
});
