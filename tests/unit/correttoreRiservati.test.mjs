// #1446 — chiavi, password e numeri di carta scritti in un campo non partono verso i modelli del correttore: al loro
// posto un segnaposto, e il resto del testo resta com'è perché il modello lo possa citare.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/guardianoStatico.js');
require('../../src/shared/urlExfil.js');
const R = require('../../src/main/services/correttoreRiservati.js');

test('carta a gruppi, chiave e password detta escono come segnaposto; il resto resta uguale', () => {
  const testo = 'Ti mando la carta 4111 1111 1111 1111, la chiave sk-abcdefghijklmnopqrstuvwx e la password wifi gattonero. Oggi sonno andato al mare.';
  const fuori = R.oscura(testo);
  for (const segreto of ['4111', 'sk-abcdef', 'gattonero']) assert.ok(!fuori.includes(segreto), `${segreto} è partito`);
  assert.ok(fuori.includes('Oggi sonno andato al mare.'));
  assert.equal(R.oscura('oggi sonno andato al mare con Luca'), 'oggi sonno andato al mare con Luca');
});

test('ogni parte della richiesta che porta testo passa dal segnaposto, anche la pagina intorno e i candidati', () => {
  const carta = '4111111111111111';
  const p = R.richiestaSenzaRiservati({
    prima: `carta ${carta}`, nuovo: `ancora ${carta}`, dopo: carta, candidati: [{ pezzo: carta, perche: 'x' }],
    luogo: { sito: 'banca.example', titolo: carta, conversazione: carta }, contesto: { prima: carta, dopo: carta },
  });
  assert.ok(!JSON.stringify(p).includes(carta));
  assert.equal(p.luogo.sito, 'banca.example');
  assert.equal(p.candidati[0].perche, 'x');
});

// La parola che presenta il dato e il dato possono partire in pezzi diversi, o la parola restare fuori dai pezzi: si
// cerca nel campo intero, e il campo non parte.
test('una password scritta dopo una pausa e una carta a metà fra due pezzi non partono', () => {
  const pw = R.richiestaSenzaRiservati({ prima: 'ciao Marco, la password del wifi è ', nuovo: 'Gatto2024', dopo: ' a presto' });
  assert.ok(!JSON.stringify(pw).includes('Gatto2024'));
  const carta = R.richiestaSenzaRiservati({ prima: 'la carta è 4111 1111 ', nuovo: '1111 1111', dopo: ' grazie' });
  assert.ok(!/1111/.test(JSON.stringify(carta)), JSON.stringify(carta));
  assert.equal(carta.dopo, ' grazie');
});

test('la parola che presenta la password sta nel campo, fuori dai pezzi: il valore non parte, e il campo nemmeno', () => {
  const campo = 'la password del wifi è gattonero e Gatto2024, ci vediamo';
  const da = campo.indexOf('è gattonero');
  const nuovo = 'Gatto2024';
  const i = campo.indexOf(nuovo);
  const p = R.richiestaSenzaRiservati({
    prima: campo.slice(da, i), nuovo, dopo: campo.slice(i + nuovo.length), campo, campoDa: da,
    candidati: [{ pezzo: 'gattonero', perche: 'x' }],
  });
  for (const segreto of ['gattonero', 'Gatto2024']) assert.ok(!JSON.stringify(p).includes(segreto), `${segreto} è partito`);
  assert.equal('campo' in p, false);
  assert.equal('campoDa' in p, false);
  assert.equal(p.dopo, ', ci vediamo');
});

test('un campo che non torna coi pezzi non conta: vale il testo dei pezzi', () => {
  const p = R.richiestaSenzaRiservati({ prima: 'ciao ', nuovo: 'oggi sonno andato', dopo: '', campo: 'la password è sonno', campoDa: 0 });
  assert.equal(p.nuovo, 'oggi sonno andato');
});

test('mezza carta scritta a gruppi non parte; un anno o un orario sì', () => {
  assert.equal(R.oscura('la carta è 4111 1111 '), 'la carta è [dato riservato] ');
  assert.equal(R.oscura('nel 2024 alle 1830 ci vediamo'), 'nel 2024 alle 1830 ci vediamo');
});

// Chi risponde a chi chiede una password o un codice non lo annuncia: lo annuncia la domanda, sopra il campo (anche
// arrivata da poco, `sopra` lo legge la pagina a ogni richiesta) o prima nello stesso testo.
const CHAT = 'Anna: ciao! ci vediamo martedì?\nMarco: mi mandi la password del wifi?';
const risposta = (campo, sopra = CHAT, altro = {}) => R.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0, sopra, ...altro });

test('la password scritta in risposta a chi la chiede non parte; il resto della risposta sì, e il testo sopra no', () => {
  const p = risposta('certo, Gatto2024 ', CHAT, { luogo: { sito: 'chat.example', conversazione: 'Anna: ciao!' } });
  assert.equal(p.nuovo, 'certo, [dato riservato] ');
  assert.equal('sopra' in p, false);
  assert.ok(!JSON.stringify(p).includes('Gatto2024'));
  assert.equal(risposta('certo, gattonero').nuovo, 'certo, [dato riservato]');
  assert.equal(risposta('Ciao Marco! Eccola: Tr7#kq29Lm, a dopo').nuovo.includes('Tr7#kq29Lm'), false);
  assert.equal(risposta('Gatto2024', 'Marco: mandami la password del wifi\n16:58').nuovo, '[dato riservato]');
  assert.equal(risposta('Ciao Marco! Certo: gattonero').nuovo, 'Ciao Marco! Certo: [dato riservato]');
});

test('dopo la frase che porta la password il resto della risposta parte intero, e si controlla', () => {
  assert.equal(risposta('certo, Gatto2024. Ieri sonno andato al mare').nuovo, 'certo, [dato riservato]. Ieri sonno andato al mare');
  assert.equal(risposta('gattonero\nieri sonno andato al mare').nuovo, '[dato riservato]\nieri sonno andato al mare');
});

test('un pin chiesto parte senza le sue cifre; per un codice le parole senza cifre restano', () => {
  assert.equal(risposta('è 4821, non dirlo a nessuno', 'Luca: qual è il pin del bancomat?').nuovo, 'è [dato riservato], non dirlo a nessuno');
  assert.equal(risposta('certo, domani mattina', 'Luca: mi mandi il codice?').nuovo, 'certo, domani mattina');
});

test('domanda e risposta nello stesso testo: nel campo e nella conversazione che parte', () => {
  const campo = 'mi hai chiesto la password? eccola: Gatto2024';
  assert.ok(!risposta(campo, '').nuovo.includes('Gatto2024'));
  const p = risposta('ok', '', { luogo: { conversazione: 'Marco: mi mandi la password?\nIo: certo, Gatto2024' }, contesto: { prima: 'Marco: il pin?\nIo: 4821' } });
  assert.ok(!JSON.stringify(p).includes('Gatto2024'));
  assert.ok(!JSON.stringify(p).includes('4821'));
});

test('il dato detto da un altro sopra il campo non parte quando chi scrive lo ripete', () => {
  assert.equal(risposta('Gatto2025 non funziona', 'Marco: la nuova password del wifi è Gatto2025').nuovo, '[dato riservato] non funziona');
});

test('senza una richiesta, o con la conversazione andata avanti, la risposta parte com\'è', () => {
  assert.equal(risposta('certo, alle 1830 al bar Gatto2024', 'Anna: ci vediamo martedì?').nuovo, 'certo, alle 1830 al bar Gatto2024');
  const avanti = 'Marco: mi mandi la password del wifi?\nIo: arriva\nMarco: grazie! a che ora ci vediamo domani?';
  assert.equal(risposta('alle venti davanti al cinema 2024', avanti).nuovo, 'alle venti davanti al cinema 2024');
  const lontana = `Marco: mi mandi la password del wifi?\n${'Io: parliamo di altro adesso\n'.repeat(20)}`;
  assert.equal(risposta('certo, Gatto2024', lontana).nuovo, 'certo, Gatto2024');
});

test('vale la coda del testo sopra, anche lunghissimo; una parola di sole lettere si toglie intera', () => {
  const lungo = `${'Anna: bla bla bla.\n'.repeat(2000)}Marco: mi mandi la password del wifi?`;
  assert.equal(risposta('certo, Gatto2024', lungo).nuovo, 'certo, [dato riservato]');
  assert.equal(R.oscura('la password è gatto. Il gattopardo dorme'), 'la password è [dato riservato]. Il gattopardo dorme');
});

test('in chat la richiesta si riconosce anche senza punto di domanda e con le abbreviazioni', () => {
  for (const domanda of ['mi mandi la password del wifi', 'mi dai la password del wifi', 'mi scrivi la password', 'me la mandi la password',
    'hai la password del wifi', 'qual è la password del wifi', "ce l'hai la pw", 'la password del wifi per favore', 'mi giri il codice',
    'mi mandi la pw del wifi?', 'mi dici la pass del wifi?', 'mi dai la chiave del wifi?', 'mi passi le credenziali',
    "what's the wifi password", 'can you send me the wifi password']) {
    assert.ok(!risposta('certo, Gatto2024 ', `Marco: ${domanda}`).nuovo.includes('Gatto2024'), domanda);
  }
  // Un racconto, un ricordo, l'inglese «pass»: non chiedono niente.
  for (const detto of ['ho cambiato la password del wifi', 'non mi ricordo la password', 'I need to pass the exam']) {
    assert.equal(risposta('certo, alle 1830 al bar Gatto2024', `Marco: ${detto}`).nuovo, 'certo, alle 1830 al bar Gatto2024', detto);
  }
});
