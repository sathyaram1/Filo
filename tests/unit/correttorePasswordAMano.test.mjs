// #1723 (#1446.4, #1649): le password scritte a mano in risposta a chi le chiede, accanto al nome utente, dopo il nome
// della rete o dentro una frase non arrivano al modello del correttore; i nomi di prodotto e il codice vicini restano.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

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
  // Il legame finisce quando scrive qualcun altro.
  const avanti = 'Marco: mi mandi la password del wifi?\nIo: arriva\nMarco: a che ora ci vediamo?';
  assert.equal(alModello('alle venti davanti al cinema 2024', avanti).nuovo, 'alle venti davanti al cinema 2024');
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
