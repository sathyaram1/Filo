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
    date: [{ pezzo: `martedì 9 ottobre ${carta}`, data: 'Il 9 ottobre', anni: [{ anno: 2024, giorno: 'mercoledì', dove: 'titolo', riga: `2024 ${carta}` }] }],
  });
  assert.ok(!JSON.stringify(p).includes(carta));
  assert.equal(p.luogo.sito, 'banca.example');
  assert.equal(p.candidati[0].perche, 'x');
  assert.deepEqual(p.date[0].anni[0], { anno: 2024, giorno: 'mercoledì', dove: 'titolo', riga: '2024 [dato riservato]' });
});

// #2673.5 — l'enfasi del Markdown coi due punti dentro («__Password:__ …») stava fra etichetta e valore.
test('un\'etichetta in grassetto o corsivo Markdown coi due punti dentro non fa partire il valore, nemmeno a pezzi', () => {
  for (const t of ['__Password:__ Nyckel!2024', '_Password:_ Nyckel!2024', '**Password:** Nyckel!2024',
    '- **Wi-Fi password:**\nNyckel!2024']) assert.ok(!R.oscura(t).includes('Nyckel!2024'), t);
  const p = R.richiestaSenzaRiservati({ prima: '__Password:__ ', nuovo: 'Nyckel!2024', dopo: '\n__Utente:__ mario' });
  assert.ok(!JSON.stringify(p).includes('Nyckel!2024'), JSON.stringify(p));
  assert.equal(p.dopo, '\n__Utente:__ mario');
});

// #2673.12 — lo stesso con l'etichetta in HTML, da un pezzo di pagina incollato.
test('un\'etichetta in grassetto HTML non fa partire il valore, nemmeno a pezzi', () => {
  for (const [t, segreto] of [['<b>Password:</b> Nyckel!2024', 'Nyckel!2024'], ['<strong>PIN:</strong> 4821', '4821'],
    ['<p><strong>Wi-Fi password:</strong></p><p>Nyckel!2024</p>', 'Nyckel!2024']]) assert.ok(!R.oscura(t).includes(segreto), t);
  const p = R.richiestaSenzaRiservati({ prima: '<b>Password:</b> ', nuovo: 'Nyckel!2024', dopo: '<br><b>Utente:</b> mario' });
  assert.ok(!JSON.stringify(p).includes('Nyckel!2024'), JSON.stringify(p));
  assert.equal(p.dopo, '<br><b>Utente:</b> mario');
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
  // #1403.35 — anche chiesto col nome che gli danno le banche.
  for (const sopra of ['Luca: qual è il numero segreto della carta?', 'Luca: wie ist deine Geheimzahl?', 'Luca: ¿cuál es el número secreto?']) {
    assert.equal(risposta('è 4821, non dirlo a nessuno', sopra).nuovo, 'è [dato riservato], non dirlo a nessuno', sopra);
  }
});

// #1403.14 — la domanda che nomina la password in un'altra lingua la chiede come quella in italiano.
test('la password data a chi la chiede in francese, tedesco, spagnolo, portoghese o russo non parte', () => {
  const domande = [
    "Marco: tu peux m'envoyer le mot de passe ?", 'Marco: envoie-moi le mot de passe du wifi',
    'Marco: wie ist das WLAN-Passwort?', 'Marco: gib mir das Passwort', 'Ana: ¿me pasas la contraseña del wifi?',
    'Ana: mándame la contraseña', 'Ana: qual é a senha do wifi?', 'Ana: какой пароль от wifi?',
  ];
  for (const sopra of domande) {
    assert.equal(R.oscura(`${sopra}\nLuc: Gatto2024`), `${sopra}\nLuc: [dato riservato]`, sopra);
    assert.equal(risposta('Gatto2024', sopra).nuovo, '[dato riservato]', sopra);
    assert.equal(risposta('certo, gattonero', sopra).nuovo, 'certo, [dato riservato]', sopra);
  }
  assert.equal(risposta('volontiers, gattonero', domande[0]).nuovo, 'volontiers, [dato riservato]');
  assert.equal(risposta('natürlich: Gatto2024', domande[2]).nuovo, 'natürlich: [dato riservato]');
  // Senza il nome della password la stessa frase non chiede niente.
  assert.equal(R.oscura('Marco: tu peux venir demain ?\nLuc: Gatto2024'), 'Marco: tu peux venir demain ?\nLuc: Gatto2024');
  assert.equal(risposta('certo, gattonero', 'Marco: gib mir das Buch').nuovo, 'certo, gattonero');
});

// #1403.14 — anche coi nomi corti, le richieste senza punto di domanda e le parole che presentano il dato.
test('nelle altre lingue valgono i nomi di chat, la cortesia in fondo e le parole che presentano la password', () => {
  const T = require('../../src/shared/riservatiNelTesto.js');
  for (const sopra of [
    'Marco: le mdp du wifi ?', "Marco: tu peux m'envoyer le mdp ?", 'Ana: ¿me pasas la clave del wifi?',
    'Ana: cuál es la clave del wifi', 'Marco: wie ist der WLAN-Schlüssel?', 'Marco: wie ist das Wlanpasswort?',
    'Marco: schick mir mal das Routerpasswort',
  ]) {
    assert.equal(R.oscura(`${sopra}\nLuc: Gatto2024`), `${sopra}\nLuc: [dato riservato]`, sopra);
    assert.equal(risposta('Gatto2024', sopra).nuovo, '[dato riservato]', sopra);
  }
  for (const sopra of [
    "Marco: le mot de passe du wifi s'il te plaît", 'Marco: le mot de passe du wifi stp', 'Marco: das WLAN-Passwort bitte',
    'Ana: la contraseña del wifi por favor', 'Ana: скинь пароль от wifi', 'Ana: me passa a senha do wifi',
    'Ana: pode me mandar a senha', 'Ana: preciso da senha',
  ]) assert.deepEqual(T.trova(`${sopra}\nLuc: Gatto2024`, { sotto: true }), ['gatto2024'], sopra);
  assert.ok(T.trova('Marco: me pasas el código del portal?\nLuis: 4821').includes('4821'));
  // «preciso» italiano non chiede niente: il numero d'ordine sotto resta.
  assert.deepEqual(T.trova('Preciso che la password del portale scade ogni 90 giorni\nOrdine ABCD5678 spedito', { sotto: true }), []);
  assert.deepEqual(T.trova("Marco: tu peux m'envoyer le mot de passe ?\nLuc: oui, c'est Gatto2024"), ['gatto2024']);
  assert.deepEqual(T.trova("Marco: tu peux m'envoyer le mot de passe ?\nLuc: le mot de passe est Gatto2024"), ['gatto2024']);
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
  // Lontana oltre il tetto: più vicino, con la risposta già sopra, la parola con la forma di una password si toglie
  // ancora (correttorePasswordAMano.test.mjs).
  const lontana = `Marco: mi mandi la password del wifi?\n${'Io: parliamo di altro adesso\n'.repeat(40)}`;
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
  // Un racconto o un ricordo nominano la password senza chiederla: la risposta perde solo le parole con cifre (#1446.4).
  for (const detto of ['ho cambiato la password del wifi', 'non mi ricordo la password']) {
    assert.equal(risposta('certo, alle venti al bar Gatto2024', `Marco: ${detto}`).nuovo, 'certo, alle venti al bar [dato riservato]', detto);
  }
  // L'inglese «pass» non nomina nessuna password.
  assert.equal(risposta('certo, alle 1830 al bar Gatto2024', 'Marco: I need to pass the exam').nuovo, 'certo, alle 1830 al bar Gatto2024');
});

// #1403.8 — i nomi della password fuori dall'alfabeto latino sono quelli della lista comune: la chat li riconosce.
test('la password chiesta o detta in chat con un nome non latino non parte, e la parola attaccata resta', () => {
  assert.equal(risposta('пароль? gattoneroferoce', '').nuovo, 'пароль? [dato riservato]');
  assert.equal(risposta('当然，gattoneroferoce', '小明：wifi密码是多少？').nuovo, '当然，[dato riservato]');
  assert.equal(risposta('もちろん、gattoneroferoce', '田中：wifiのパスワードは？').nuovo, 'もちろん、[dato riservato]');
  assert.equal(risposta('certo, Gatto2024', 'Ahmed: ما هي كلمة المرور للواي فاي؟').nuovo, 'certo, [dato riservato]');
  assert.equal(risposta('конечно, gattoneroferoce', 'Иван: как дела?').nuovo, 'конечно, gattoneroferoce');
});
