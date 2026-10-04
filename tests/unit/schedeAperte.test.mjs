// Quali schede Filo legge e guida (#534): mai le pagine dell'account Google; Gmail è mail.google.com/mail, e una
// pagina che si chiama «mail» altrove non lo diventa. Il copione della pagina è codice che si può eseguire da solo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Schede = require('../../src/main/services/schedeAperte.js');
const Posta = require('../../src/main/services/postaGmail.js');
const { CODICE, MONDO, regoleComandi } = require('../../src/main/services/paginaGuidata.js');

test('le pagine dell\'account Google non si leggono e non si toccano, Gmail sì', () => {
  for (const u of ['https://myaccount.google.com/security', 'https://accounts.google.com/v3/signin?service=mail',
    'https://passwords.google.com/', 'https://pay.google.com/gp/w/home']) assert.equal(Schede.vietata(u), true, u);
  for (const u of ['https://mail.google.com/mail/u/0/#inbox', 'https://www.google.com/search?q=x', 'https://accounts.google.com.evil.example/']) {
    assert.equal(Schede.vietata(u), false, u);
  }
});

test('Gmail è la posta su mail.google.com, non una pagina qualunque che lo imita', () => {
  const prima = process.env.FILO_GMAIL_ORIGIN;
  delete process.env.FILO_GMAIL_ORIGIN;
  try {
    assert.equal(Posta.eGmail('https://mail.google.com/mail/u/0/#inbox'), true);
    assert.equal(Posta.eGmail('https://mail.google.com/mail/u/1/#search/from%3Amarco'), true);
    assert.equal(Posta.eGmail('https://mail.google.com/chat/u/0/'), false);
    assert.equal(Posta.eGmail('http://mail.google.com.evil.example/mail/'), false);
    assert.equal(Posta.eGmail('https://evil.example/mail/u/0/'), false);
    assert.equal(Posta.accessoGmail('https://accounts.google.com/ServiceLogin?service=mail&continue=https://mail.google.com/mail/'), true);
    assert.equal(Posta.accessoGmail('https://accounts.google.com/signin'), false);
  } finally {
    if (prima !== undefined) process.env.FILO_GMAIL_ORIGIN = prima;
  }
});

test('il numero di una scheda è la riga di TAB APERTE: le più recenti prima', () => {
  const tabs = [
    { id: 'a', url: 'filo://newtab/', title: 'Nuova scheda', isInternal: true, lastActiveAt: 30 },
    { id: 'b', url: 'https://www.repubblica.it/', title: 'la Repubblica', lastActiveAt: 10 },
    { id: 'c', url: 'https://mail.google.com/mail/u/0/', title: 'Posta in arrivo - Gmail', lastActiveAt: 20 },
  ];
  const win = { _filoTabs: { tabs, activeId: 'a' } };
  assert.equal(Schede.trovaScheda(win, '2').id, 'c');
  assert.equal(Schede.trovaScheda(win, 3).id, 'b');
  assert.equal(Schede.trovaScheda(win, 'repubblica').id, 'b');
  assert.equal(Schede.trovaScheda(win, 'Gmail').id, 'c');
  // Senza indicazione vale la scheda web usata per ultima, non la home in cui si scrive.
  assert.equal(Schede.trovaScheda(win, '').id, 'c');
  assert.equal(Schede.trovaScheda(win, 'nessuna così'), null);
});

test('il copione della pagina è codice valido, in un mondo suo', () => {
  assert.doesNotThrow(() => new Function(CODICE));
  assert.equal(MONDO, 1534);
  // Un carattere invisibile scritto per davvero nel sorgente spezzerebbe una regex senza dirlo.
  assert.equal(/[\u2028\u2029\u200b-\u200f\ufeff]/.test(CODICE), false);
});

// Un clic che invia, paga o cancella non esiste anche quando il sito lo chiama in un altro modo: «invio» e non
// «invia», il verbo che chiude più la cosa che si chiude. Il «Conferma» nudo lo decide il riquadro (spec).
test('i nomi dei comandi che inviano o pagano si riconoscono nelle forme comuni, e i nomi innocui no', () => {
  const R = regoleComandi();
  for (const n of ['invia', 'altre opzioni di invio', 'programma invio', 'schedule send', 'conferma ordine',
    'conferma l\'ordine', 'effettua l\'ordine', 'esegui bonifico', 'autorizza pagamento', 'conferma il pagamento',
    'completa l\'acquisto', 'conferma operazione', 'ordina ora', 'paga ora', 'elimina definitivamente', 'segnala come spam']) {
    assert.equal(R.vietato(n), true, n);
  }
  for (const n of ['rispondi', 'inoltra', 'posta inviata', 'inviati', 'mostra altro', 'ordina per data', 'pagamenti',
    'metodi di pagamento', 'i miei ordini', 'conferma']) {
    assert.equal(R.vietato(n), false, n);
  }
  assert.equal(R.nudo('conferma'), true);
  assert.equal(R.nudo('ok'), true);
  assert.equal(R.nudo('conferma indirizzo email'), false);
  assert.equal(R.cosa('riepilogo del pagamento'), true);
  assert.equal(R.cosa('il tuo profilo'), false);
});
