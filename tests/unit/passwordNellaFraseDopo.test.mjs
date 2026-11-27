// #2695.4 — la password detta nella frase dopo la virgola, che la rimanda senza nominarla («la password scade, la nuova è
// …», «è sbagliata, prova …»), non arriva ai modelli: né dal correttore né, con la forma di una password, dal pavimento.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../src/shared/guardianoStatico.js');
require('../../src/shared/urlExfil.js');
const P = require('../../src/shared/pavimento.js');
const R = require('../../src/main/services/correttoreRiservati.js');
const S = P.SEGNAPOSTO;
const alCorrettore = (campo) => R.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0 }).nuovo;

test('le quattro frasi della segnalazione arrivano al correttore col segnaposto al posto della password', () => {
  for (const frase of ['la password scade, la nuova è gattonero', 'la password è sbagliata, prova gattonero',
    'the password expired, new one gattonero', 'password cambiata ieri, adesso gattonero']) {
    assert.equal(alCorrettore(frase), frase.replace('gattonero', S), frase);
  }
});

test('con la forma di una password la tolgono tutti e due i cancelli, anche dentro i messaggi verso il modello', () => {
  for (const frase of ['la password scade, la nuova è Gatto2024', 'la password è sbagliata, prova Gatto2024',
    'the password expired, new one Gatto2024', 'password cambiata ieri, adesso Gatto2024',
    'the password is wrong, try with Gatto2024']) {
    assert.equal(P.oscura(frase), frase.replace('Gatto2024', S), `pavimento: ${frase}`);
    assert.equal(alCorrettore(frase), frase.replace('Gatto2024', S), `correttore: ${frase}`);
  }
  assert.equal(P.oscura('la pass è sbagliata, prova Gatto2024'), `la pass è sbagliata, prova ${S}`);
  assert.doesNotMatch(alCorrettore('la pass è sbagliata, prova Gatto2024'), /Gatto2024/);
  const messaggi = [{ role: 'user', content: [{ type: 'text', text: 'Ciao! la password è sbagliata, prova Gatto2024 e dimmi' }] }];
  assert.doesNotMatch(JSON.stringify(P.oscuraTutto(messaggi)), /Gatto2024/);
});

test('gli altri modi di rimandarla: fra virgolette, dopo il punto con l\'annuncio, il punto e virgola, le altre lingue', () => {
  for (const [frase, v] of [
    ['la password è sbagliata, prova «Mela! Verde77»', 'Mela! Verde77'],
    ['la password scade, la nuova è "casa mia al mare"', 'casa mia al mare'],
    ['Ho cambiato la password, the new one: Brezza7Mare', 'Brezza7Mare'],
  ]) {
    assert.equal(P.oscura(frase), frase.replace(v, S), `pavimento: ${frase}`);
    assert.equal(alCorrettore(frase), frase.replace(v, S), `correttore: ${frase}`);
  }
  assert.equal(alCorrettore('il pin è sbagliato, prova 4821'), `il pin è sbagliato, prova ${S}`);
  assert.equal(alCorrettore('il codice sconto è scaduto, prova BENVENUTO10'), 'il codice sconto è scaduto, prova BENVENUTO10');
  for (const frase of ['La password è scaduta. La nuova è gattonero.', 'la password scade; la nuova è gattonero',
    'the password expired, the new one is gattonero', 'the password expired, the new one should be gattonero',
    'la password è sbagliata, prova con gattonero',
    'la password è scaduta, quella nuova sarà gattonero', 'la password è scaduta, la nuova: gattonero',
    'la password è sbagliata, prova gattonero e dimmi', 'la password è sbagliata, prova «gattonero»',
    'Marco: la password è sbagliata, prova gattonero', 'la password non è gattobianco, invece gattonero',
    'le mot de passe a expiré, la nouvelle est gattonero', 'la contraseña caducó, la nueva es gattonero',
    'das Passwort ist abgelaufen, das neue ist gattonero']) {
    assert.doesNotMatch(alCorrettore(frase), /gattonero/, frase);
  }
});

test('la frase dopo che parla d\'altro arriva intera, a tutti e due i cancelli', () => {
  for (const frase of ['Ho cambiato la password ieri, adesso funziona', 'ho cambiato la password ieri, è stato un casino',
    'la password è sbagliata, prova a rifarla', 'la password è sbagliata, prova domani', 'la password è sbagliata, prova ancora',
    'la password è sbagliata, riprova più tardi', 'la password è scaduta, adesso vado a cambiarla',
    'la password è scaduta, adesso è bloccata', 'la password è debole, usa almeno 12 caratteri',
    'la password è debole, usa maiuscole e numeri', 'the password is wrong, try again', 'the password expired, now I\'m locked out',
    'the password expired, now it works', 'the password is weak, use uppercase letters',
    'la password scade, la nuova procedura è online', 'Ho dimenticato la password, adesso come faccio?',
    'la password del wifi non va, prova a riavviare il router',
    'la password è scaduta. Ora devo cambiarla', 'la password è scaduta. Adesso funziona',
    'the password expired, the new one is ready', 'the password expired, the new one works',
    'la password è sbagliata, inserisci quella giusta', 'la password è scaduta, la nuova arriva domani',
    'la password è scaduta, la nuova è più lunga', 'password cambiata ieri, adesso tutto bene', 'password cambiata ieri, adesso entro',
    'la password è sbagliata, scrivi meglio', 'la password è sbagliata, prova con calma', 'la password è scaduta, ora rinnovala',
    'la password è cambiata, adesso basta', 'la password è sbagliata, prova «ok»']) {
    assert.equal(P.oscura(frase), frase, `pavimento: ${frase}`);
    assert.equal(alCorrettore(frase), frase, `correttore: ${frase}`);
  }
});

test('un indirizzo che porta la password detta così non esce', () => {
  const X = globalThis.SN_URL_EXFIL;
  assert.ok(X.taintScritto('https://esempio.it/?q=gattonero', 'la password scade, la nuova è gattonero'));
  assert.equal(X.taintScritto('https://esempio.it/?q=funziona', 'Ho cambiato la password ieri, adesso funziona'), null);
});

test('un testo lungo che ripete il nome e il rimando si legge in fretta', () => {
  const lungo = 'la password è sbagliata, prova '.repeat(5000);
  const t0 = Date.now();
  P.oscura(lungo);
  alCorrettore(lungo.slice(0, 20000));
  assert.ok(Date.now() - t0 < 5000, `${Date.now() - t0} ms`);
});
