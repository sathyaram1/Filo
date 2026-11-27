// #2695 — i due cancelli verso i modelli, il pavimento e il correttore, tolgono le stesse password scritte in chiaro:
// quello che il pavimento toglie non parte nemmeno col correttore, e una frase che spiega la password resta intera.

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

test('nella riga di una tabella il valore nella cella dopo l\'etichetta coi due punti non arriva al modello', () => {
  for (const [riga, v] of [
    ['| Password: | Nyckel!2024 |', 'Nyckel!2024'], ['| Password = | Nyckel!2024 |', 'Nyckel!2024'],
    ['| Password： | Nyckel!2024 |', 'Nyckel!2024'], ['| Lösenord: | Nyckel!2024 |', 'Nyckel!2024'],
    ['| Wi-Fi password: | Faro7Blu55 |\n| Rete: | CasaRossi |', 'Faro7Blu55'], ['Password: | Nyckel!2024', 'Nyckel!2024'],
  ]) {
    const fuori = P.oscura(riga);
    assert.ok(!fuori.includes(v), `${riga} -> ${fuori}`);
    assert.ok(fuori.includes(S), riga);
  }
  assert.equal(P.oscura('| Password: | Mela Verde 77 |'), `| Password: | ${S} |`, 'la cella vale tutta, come senza i due punti');
  for (const riga of ['| Password: | obbligatoria |', '| Password: | |', '| Campo | Note |\n|---|---|\n| Password: | almeno 8 caratteri |']) {
    assert.equal(P.oscura(riga), riga);
  }
});

test('quello che il pavimento toglie non parte nemmeno verso il modello del correttore', () => {
  for (const [testo, v] of [
    ['CVV: 123', '123'], ['login_password: Nyckel!2024', 'Nyckel!2024'], ['Il CVV è 615', '615'],
    ['| Password: | Nyckel!2024 |', 'Nyckel!2024'], ['Codice di sicurezza (CVV): 847', '847'],
  ]) {
    assert.ok(!P.oscura(testo).includes(v), `il pavimento non lo toglie più: ${testo}`);
    const fuori = alCorrettore(testo);
    assert.ok(!fuori.includes(v), `${testo} -> ${fuori}`);
    assert.ok(fuori.includes(S), testo);
  }
  // Il CVV di tre cifre si toglie da solo: l'ordine che le contiene resta.
  assert.equal(alCorrettore('Ordine 81234, CVV: 123'), `Ordine 81234, CVV: ${S}`);
});

test('la chiave col nome della password davanti a un\'altra parola non lascia passare il valore da nessuno dei due cancelli', () => {
  for (const testo of ['password_login: Nyckel!2024', 'pwd_login: Nyckel!2024', 'PASSWORD_DB=Nyckel!2024', 'passwordLogin: Nyckel!2024',
    '{"password_admin": "Nyckel!2024"}', '<pwd_login>Nyckel!2024</pwd_login>', 'pwd_login: hunter',
    'https://x.example/login?password_login=Nyckel2024', 'https://x.example/login?login_password=Nyckel2024']) {
    const v = testo.includes('hunter') ? 'hunter' : testo.includes('Nyckel2024') ? 'Nyckel2024' : 'Nyckel!2024';
    assert.ok(!P.oscura(testo).includes(v), `pavimento: ${testo}`);
    const fuori = alCorrettore(testo);
    assert.ok(!fuori.includes(v) && fuori.includes(S), `correttore: ${testo} -> ${fuori}`);
  }
  // Quello che una parola dopo descrive della password resta; «pass» davanti a un'altra parola non è la password.
  for (const testo of ['password_hint: usa il nome del cane', 'password_min_length: 8', 'PASSWORD_MAX_AGE_DAYS=90',
    'password_policy: strict', 'password_manager: Bitwarden', 'passwordResetTimeout: 3600', 'pass_rate: 0.95x',
    'https://x.example/a?show_password=true&forgot_password=1']) {
    assert.equal(P.oscura(testo), testo, testo);
    assert.equal(alCorrettore(testo), testo, testo);
  }
});

test('la frase che spiega la password arriva intera al correttore; la password detta no', () => {
  for (const frase of ['la password va cambiata ogni 90 giorni', 'la password deve avere almeno otto caratteri',
    'Ricorda: la password va cambiata ogni 3 mesi']) {
    assert.equal(alCorrettore(frase), frase);
  }
  for (const [frase, v] of [['la password ora è gattonero', 'gattonero'], ['password wifi gattonero', 'gattonero'],
    ['la password del wifi è gattonero', 'gattonero'], ['la password gattonero vale per 30 giorni', 'gattonero']]) {
    assert.equal(alCorrettore(frase), frase.replace(v, S), frase);
  }
});

test('ogni frase che dice com\'è la password arriva intera, anche col verbo prima della data', () => {
  for (const frase of ['la password scade tra 30 giorni', 'la password è scaduta', 'la password è sbagliata',
    'la tua password è debole', 'la password non funziona più', 'la password va rinnovata ogni anno',
    'la password non va mai detta a nessuno', 'la password del wifi è sul retro del router', 'la password cambia ogni mese',
    'the password expires in 30 days', 'la password è stata resettata', 'la password è la stessa di prima']) {
    assert.equal(alCorrettore(frase), frase);
  }
});

test('dopo la frase che spiega, la parola che presenta il valore lo fa togliere', () => {
  for (const [frase, v] of [['la password da oggi diventa gattonero', 'gattonero'],
    ['la password da oggi eccola gattonero', 'gattonero'], ['password scaduta ieri nuova gattonero', 'gattonero'],
    ['la password del mese è Giugno', 'Giugno'], ['la password è troppo corta: usa Nyckel', 'Nyckel'],
    ['la password è lunga gattonero', 'gattonero']]) {
    assert.ok(!alCorrettore(frase).includes(v), frase);
  }
});

test('una spiegazione accanto alla password, prima o dopo, non la fa partire', () => {
  for (const frase of ['la password del wifi è gattonero ma scade a giugno', 'la password è gattonero va bene?',
    'la password wifi è gattonero non dirla a nessuno', 'la password è gattonero prima di tutto',
    'la password è gattonero scade domani', 'la password del wifi è sul retro gattonero',
    'la password è nel cassetto gattonero', 'la password cambiata in gattonero', 'password del conto gattonero',
    'la password scade tra 30 giorni gattonero', 'la password è scaduta diventa gattonero']) {
    assert.ok(!alCorrettore(frase).includes('gattonero'), `${frase} -> ${alCorrettore(frase)}`);
  }
});

test('le frasi comuni che spiegano la password arrivano intere al correttore', () => {
  for (const frase of ['la password ha una maiuscola', 'cambia la password domani', 'la password scade domani',
    'la password del conto è scritta sul foglio', 'la password deve contenere un numero',
    'ho cambiato la password stamattina', 'la password è salvata nel portachiavi',
    'usa una password diversa per ogni sito', 'la password è temporanea', 'la password è obbligatoria',
    'la password è richiesta', 'la password serve per entrare', 'la password resta segreta',
    'la password va inserita due volte', 'la password si cambia dalle impostazioni',
    "la password dell'email è diversa da quella del conto", 'la password è bloccata dopo tre tentativi']) {
    assert.equal(alCorrettore(frase), frase);
  }
});

test('una cella che descrive la password resta, in tutti e due i cancelli; quella col valore no', () => {
  for (const riga of ['| Scadenza password: | 90 giorni |', '| Lunghezza password: | 12 caratteri |',
    '| Password: | da cambiare ogni 90 giorni |', '| Password: | scade ogni 90 giorni |', '| Password: | vedi sotto |',
    '| Recupero password: | via email |', '| Password dimenticata: | clicca il link |', '| Password | vedi sotto |',
    '| Scadenza password | 90 giorni |', '| Password: | cambiata ieri |']) {
    assert.equal(P.oscura(riga), riga, 'pavimento');
    assert.equal(alCorrettore(riga), riga, 'correttore');
  }
  for (const riga of ['| Password: | Nyckel!2024 |', '| Passphrase: | cavallo batteria graffetta |',
    '| Nuova password: | gattonero |', '| Password | Mela Verde 77 |']) {
    assert.ok(P.oscura(riga).includes(S), riga);
    assert.ok(alCorrettore(riga).includes(S), riga);
  }
});
