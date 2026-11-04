// #1723 (#1446.4, #1649): le password scritte a mano in risposta a chi le chiede, accanto al nome utente, dopo il nome
// della rete o dentro una frase non arrivano al modello del correttore; i nomi di prodotto e il codice vicini restano.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { costoInUnita } from '../helpers/tempoRelativo.mjs';

const require = createRequire(import.meta.url);
require('../../src/shared/guardianoStatico.js');
require('../../src/shared/urlExfil.js');
const R = require('../../src/main/services/correttoreRiservati.js');

const S = R.SEGNAPOSTO;
// Quello che parte verso il modello quando si scrive `campo` sotto la conversazione `sopra`.
const alModello = (campo, sopra = '') => R.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0, sopra });
const nascosto = (campo, sopra, valore, msg) => {
  const p = alModello(campo, sopra);
  assert.ok(!JSON.stringify(p).includes(valore), `${msg}: ${valore} è partito (${p.nuovo})`);
  assert.ok(p.nuovo.includes(S), `${msg}: manca il segnaposto (${p.nuovo})`);
  return p;
};

test('#1446.4: la password data in risposta arriva come segnaposto, qualunque forma abbia la richiesta', () => {
  for (const richiesta of [
    'Marco: che password ha il wifi',
    'Marco: ti ricordi la password del wifi',
    'Marco: e la password del wifi',
    'Marco: sono arrivato, password del wifi',
    'Marco: come è la password del wifi',
    'Marco: mi mandi la pasword del wifi?',
    'Marco: mi mandi la passowrd del wifi',
    'Marco: mi mandi la pssword del wifi?',
  ]) {
    nascosto('certo, Gatto2024', `Anna: ciao!\n${richiesta}`, 'Gatto2024', richiesta);
    nascosto('Gatto2024', richiesta, 'Gatto2024', richiesta);
  }
});

test('#1446.4: un sollecito o una seconda domanda dopo la richiesta non sciolgono il legame', () => {
  for (const sopra of [
    'Marco: mi mandi la password del wifi?\nMarco: ci sei?',
    'Marco: mi mandi la password del wifi?\nMarco: ??',
    'Marco: mi mandi la password del wifi?\n16:58\nMarco: ci sei?\n17:02',
  ]) nascosto('eccola Gatto2024', sopra, 'Gatto2024', sopra);
  const p = nascosto('Gatto2024, alle 8', 'Marco: mi mandi la password del wifi? E a che ora ci vediamo?', 'Gatto2024', 'seconda domanda');
  assert.equal(p.nuovo, `${S}, alle 8`);
});

test('#1446.4: il valore si cerca in tutta la risposta, non solo nelle prime parole', () => {
  const lunga = 'certo aspetta che vado a vedere sul router perché non me la ricordo mai, è Gatto2024';
  nascosto(lunga, 'Marco: mi mandi la password del wifi?', 'Gatto2024', 'risposta lunga');
  const lunghissima = `${'aspetta un attimo che cerco il foglio dove l\'avevo scritta '.repeat(6)}ecco: Gatto2024`;
  nascosto(lunghissima, 'Marco: mi mandi la password del wifi?', 'Gatto2024', 'risposta lunghissima');
  nascosto('certo aspetta che vado a vedere sul router perché non me la ricordo mai, è gattonero', 'Marco: mi mandi la password del wifi?', 'gattonero', 'parola di sole lettere');
});

test('#1446.4: quando chi scrive ha già risposto, o l\'altro ha solo nominato la password, il resto parte', () => {
  // Il legame finisce quando chi scrive ha già scritto, o quando sotto la richiesta c'è già la risposta.
  const avanti = 'Marco: mi mandi la password del wifi?\nIo: arriva\nMarco: a che ora ci vediamo?';
  assert.equal(alModello('alle venti davanti al cinema 2024', avanti).nuovo, 'alle venti davanti al cinema 2024');
  for (const risposta of ['Gatto2024', 'certo, Gatto2024']) {
    const senzaNomi = `mi mandi la password del wifi?\n${risposta}\na che ora ci vediamo stasera?`;
    assert.equal(alModello('alle venti davanti al cinema', senzaNomi).nuovo, 'alle venti davanti al cinema', senzaNomi);
  }
  // Una password solo nominata lega le parole che ne hanno la forma, non le parole qualunque.
  assert.equal(alModello('ah ok, e adesso qual è? Gatto2024?', 'Marco: ho cambiato la password del wifi').nuovo, `ah ok, e adesso qual è? ${S}?`);
  assert.equal(alModello('certo, alle venti al bar', 'Marco: ho cambiato la password del wifi').nuovo, 'certo, alle venti al bar');
  assert.equal(alModello('certo, Gatto2024', 'Marco: I need to pass the exam').nuovo, 'certo, Gatto2024');
});

test('#1649: accanto al nome utente il valore che sta al posto della password non parte', () => {
  for (const [t, v] of [
    ['Username / Password: mario / Girasole2024', 'Girasole2024'],
    ['Password / Utente: Girasole2024 / mario', 'Girasole2024'],
    ['Credenziali: mario / Girasole2024', 'Girasole2024'],
    ['Accedi con mario@gmail.com / Girasole2024', 'Girasole2024'],
    ['Wi-Fi: CasaRossi - Faro7Blu55', 'Faro7Blu55'],
    ['SSID: CasaRossi\nKey: Brezza7Mare', 'Brezza7Mare'],
    ['utente mario.rossi, pw Ponte9Grigio', 'Ponte9Grigio'],
    ['la pass del wifi è Brezza7Mare', 'Brezza7Mare'],
    ['Ti ho mandato la password su whatsapp, è Girasole2024', 'Girasole2024'],
    ['Mi scrivi la password? Certo: Girasole2024', 'Girasole2024'],
  ]) {
    assert.ok(!R.oscura(t).includes(v), `${t} → ${R.oscura(t)}`);
    nascosto(t, '', v, t);
    // Anche nella conversazione che parte col campo.
    const p = R.richiestaSenzaRiservati({ prima: '', nuovo: 'ok', dopo: '', luogo: { conversazione: t } });
    assert.ok(!JSON.stringify(p).includes(v), `conversazione: ${t}`);
  }
  nascosto('Brezza7Mare', 'Qual è la password del wifi?', 'Brezza7Mare', 'riga sotto la domanda');
  assert.equal(R.oscura('Wi-Fi: CasaRossi - Faro7Blu55'), `Wi-Fi: CasaRossi - ${S}`);
  assert.equal(R.oscura('Credenziali: mario / Girasole2024'), `Credenziali: mario / ${S}`);
});

// I negativi di #1589: le porte nuove guardano il posto del valore, non le parole vicine all'etichetta.
test('#1649: le porte nuove non prendono nomi di prodotto, utenti, ticket e codice', () => {
  for (const t of [
    'come cambio la password del router TP-Link AX1500? E quella di Office365?',
    'ho dimenticato la password di Windows11',
    "Hai richiesto di reimpostare la password per l'account mario.rossi_87",
    'Reset password - Ticket #INC0012345',
    'body: JSON.stringify({ username, password: form.password.value }),',
    'Wi-Fi: gratuito - chiedi al bancone',
    'Wi-Fi: CasaRossi - Canale 11',
    'Accedi con Google / Apple',
    'Credenziali: vedi sotto',
    'il green pass 2021 è scaduto',
    'SSID: CasaRossi\nCanale: 11',
  ]) assert.deepEqual(R.formeLibere(t), [], t);
});

// Un testo lungo senza punti, con la parola ripetuta, cercava la fine della frase da capo a ogni menzione: 200 mila
// caratteri erano 17 secondi a ogni richiesta del correttore, e i refusi contati come menzioni li moltiplicavano.
// Oggi costa qualche decina di unità, la versione quadratica più di mille.
test('un testo lunghissimo che ripete la parola password senza punti si legge in fretta', () => {
  const c = costoInUnita(() => R.oscura('pasword passowrd password '.repeat(12000)), { tetto: 400 });
  assert.ok(c.entro, c.come);
});

test('#1446.4: dopo una fila di solleciti dell\'altro la risposta resta legata alla richiesta', () => {
  const sopra = [
    'Marco: mi mandi la password del wifi?', '17:02', 'Marco: ci sei?', '17:03',
    'Marco: sono sotto casa tua, ho finito i giga e devo scaricare il biglietto del treno', '17:04',
    'Marco: il citofono non funziona, ho provato tre volte', '17:05',
    'Marco: dai rispondi che fa freddo e sta per iniziare a piovere', '17:06', 'Marco: ??', '17:07',
    'Marco: scusa se insisto ma il treno parte alle 18:40 e non riesco a fare il check-in senza internet', '17:08',
  ].join('\n');
  nascosto('Gatto2024', sopra, 'Gatto2024', 'solleciti');
});

test('#1446.4: la password in fondo a una risposta di oltre seicento caratteri non parte', () => {
  const r = `${'aspetta che apro il cassetto della cucina dove tengo i fogli delle bollette e dei contratti, '.repeat(8)}eccola: Gatto2024`;
  assert.ok(r.indexOf('Gatto2024') > 600);
  nascosto(r, 'Marco: mi mandi la password del wifi?', 'Gatto2024', 'risposta di oltre seicento caratteri');
  // Senza la richiesta sopra la stessa risposta parte intera: è il legame a toglierla.
  assert.equal(alModello(r, 'Marco: ciao come stai?').nuovo, r);
});

test('#1649: le grafie vicine a quelle degli esempi non lasciano passare la chiave', () => {
  for (const [t, v] of [
    ['Wi-Fi: Casa Rossi - Faro7Blu55', 'Faro7Blu55'],
    ['Wi-Fi: WIND3 HUB-123456 - Faro7Blu55', 'Faro7Blu55'],
    ['SSID: CasaRossi, Key: Brezza7Mare', 'Brezza7Mare'],
    ['SSID: CasaRossi Key: Brezza7Mare', 'Brezza7Mare'],
    ['SSID: Casa Rossi\nKey: Brezza7Mare', 'Brezza7Mare'],
    ['Ti ho mandato la password su whatsapp, comunque è Girasole2024', 'Girasole2024'],
    ['Ti ho mandato la password su whatsapp, cmq è Girasole2024', 'Girasole2024'],
  ]) nascosto(t, '', v, t);
});

// Dopo «pw», «la pass» o «, è» una parola qualunque resta parola: il modello la vede e la corregge.
test('#1649: dopo le etichette corte e la virgola le parole normali restano', () => {
  for (const [t, parola] of [
    ['Ho cambiato la password ieri, è stato un casino. Il mio stato è sereno.', 'stato'],
    ['Ho comprato la pass giornaliera, è carissima', 'giornaliera'],
    ['Ho comprato la pass giornaliera, è carissima', 'carissima'],
    ['ho comprato il pass, è bellissimo', 'bellissimo'],
    ['il green pass, è scaduto', 'scaduto'],
    ['Il pw del documento. Il documento è pronto', 'documento'],
  ]) {
    const fuori = alModello(t).nuovo;
    assert.equal(fuori, t, `${t} → ${fuori}`);
    assert.ok(fuori.includes(parola));
  }
  // Presentata da «è» o dai due punti, o subito dopo «pw», resta un dato anche di sole lettere.
  for (const [t, v] of [['la pass è gattonero', 'gattonero'], ['la pass del wifi: gattonero', 'gattonero'], ['utente mario.rossi, pw pontegrigio', 'pontegrigio']]) {
    nascosto(t, '', v, t);
  }
});
