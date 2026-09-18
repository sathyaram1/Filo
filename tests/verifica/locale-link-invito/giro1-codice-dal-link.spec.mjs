// Giro di verifica locale del ramo claude/link-invito — giro 1.
//
// Un invito deve poter essere un LINK. Qui si prova la sola lettura di ciò che
// l'utente incolla o clicca, senza aprire Filo: il link com'è, il link come lo
// riscrive una chat (senza protocollo, con la coda di tracciamento, dentro una
// frase), e il collegamento che apre Filo da fuori — compreso il caso in cui
// una pagina qualsiasi prova a far aprire a Filo una cosa che non è un invito.
//
// Scritto da chi verifica, non da chi ha fatto il lavoro.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/wallet.js');
const W = globalThis.SN_WALLET;

const CODICE = 'ABCDEFGH';

test('il campo dell’invito accetta il link intero, in tutte le forme in cui arriva da una chat', () => {
  const forme = [
    'https://filo.red/i/ABCDEFGH',
    'https://filo.red/i/ABCD-EFGH',
    'https://filo.red/i/abcdefgh',
    'https://filo.red/i/ABCDEFGH/',
    'filo.red/i/ABCDEFGH',
    'https://www.filo.red/i/ABCDEFGH',
    '  https://filo.red/i/ABCDEFGH  ',
    'https://filo.red/i/ABCDEFGH\n',
    'https://filo.red/i/ABCDEFGH?utm_source=whatsapp',
    'https://filo.red/i/ABCDEFGH#scarica',
    'Entra qui: https://filo.red/i/ABCDEFGH',
    'Ciao! Entra su Filo: https://filo.red/i/ABCDEFGH — ci vediamo',
    'filo://invito/ABCDEFGH',
  ];
  for (const f of forme) {
    expect(W.codeFromInput(f), `forma non riconosciuta: ${JSON.stringify(f)}`).toBe(CODICE);
  }
});

test('il codice nudo continua a valere, comunque lo si scriva', () => {
  for (const f of ['ABCDEFGH', 'abcdefgh', 'ABCD-EFGH', 'abcd efgh', 'Codice: ABCD-EFGH', 'il tuo invito è abcd efgh']) {
    expect(W.codeFromInput(f), `forma non riconosciuta: ${JSON.stringify(f)}`).toBe(CODICE);
  }
});

test('quello che non è un invito non diventa un codice per sbaglio', () => {
  for (const f of ['', '   ', 'ZZZZ', 'ABCDEFGHI', 'ABCD-EFGO', 'ABCD-EFG1', '<script>alert(1)</script>', 'javascript:alert(1)', 'https://filo.red/i/', 'x'.repeat(10000)]) {
    expect(W.codeFromInput(f), `accettato per sbaglio: ${JSON.stringify(f).slice(0, 60)}`).toBeNull();
  }
});

test('un link da dare si costruisce solo attorno a un codice vero', () => {
  expect(W.inviteLink('abcd-efgh')).toBe('https://filo.red/i/ABCDEFGH');
  expect(W.inviteLink('ZZZZ')).toBe('');
  expect(W.formatCode('abcdefgh')).toBe('ABCD-EFGH');
});

test('il collegamento che apre Filo da fuori porta dentro solo gli inviti', () => {
  expect(W.inviteCodeFromDeepLink('filo://invito/ABCDEFGH')).toBe(CODICE);
  expect(W.inviteCodeFromDeepLink('filo://invito/ABCD-EFGH')).toBe(CODICE);
  expect(W.inviteCodeFromDeepLink('filo://INVITO/abcdefgh')).toBe(CODICE);
  // Una pagina web qualsiasi può scrivere un collegamento `filo://…`: tutto
  // ciò che non è un invito non deve far aprire niente.
  for (const brutto of ['filo://credits/credits.html', 'filo://dashboard', 'filo://manage/manage.html', 'https://filo.red/i/ABCDEFGH']) {
    expect(W.isInviteDeepLink(brutto), `aperto per sbaglio: ${brutto}`).toBe(false);
  }
  // Un invito col codice storto resta un invito (chi ha cliccato aspetta una
  // risposta), ma non produce un codice.
  expect(W.isInviteDeepLink('filo://invito/ZZZZ')).toBe(true);
  expect(W.inviteCodeFromDeepLink('filo://invito/ZZZZ')).toBeNull();
});

test('un invito vale tre posti e si vede quanti sono entrati', () => {
  const v = W.inviteView({ code: 'ABCDEFGH', max: 3, uses: [{ pseudonym: 'tizio', at: '2026-09-17T10:00:00Z' }] });
  expect(v.max).toBe(3);
  expect(v.used).toBe(1);
  expect(v.left).toBe(2);
  expect(v.exhausted).toBe(false);
  expect(W.inviteStateLine(v)).toBe('entrati 1 su 3');

  const pieno = W.inviteView({ code: 'ABCDEFGH', max: 3, used: 3 });
  expect(pieno.exhausted).toBe(true);
  expect(W.inviteStateLine(pieno)).toBe('entrati 3 su 3');

  // Un invito scritto prima degli inviti a più persone vale un posto solo e
  // non deve diventare «entrati 1 su 0».
  const vecchio = W.inviteView({ code: 'ABCDEFGH', used: true });
  expect(vecchio.max).toBe(1);
  expect(vecchio.used).toBe(1);
  expect(vecchio.exhausted).toBe(true);
});
