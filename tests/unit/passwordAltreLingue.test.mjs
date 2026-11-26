// #2673 — la password nominata nelle altre lingue: l'etichetta davanti al valore (pavimento) e chi la chiede in chat
// (correttore e pagina) valgono come in italiano. Regole: src/shared/urlExfil.js (PRESENTA), riservatiNelTesto.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../src/shared/guardianoStatico.js');
require('../../src/shared/urlExfil.js');
const P = require('../../src/shared/pavimento.js');
const C = require('../../src/main/services/correttoreRiservati.js');
const X = globalThis.SN_URL_EXFIL;
const S = P.SEGNAPOSTO;

const ETICHETTE = ['Lösenord', 'Losenord', 'Lösenordet', 'Passord', 'Adgangskode', 'Kodeord', 'Salasana', 'Jelszó', 'Heslo',
  'Şifre', 'ŞİFRE', 'Sifre', 'Parolă', 'Lozinka', 'Mật khẩu', 'Kata sandi', 'Пароль', 'Κωδικός', 'ΚΩΔΙΚΟΣ', 'Συνθηματικό',
  '密码', '密碼', 'パスワード', '비밀번호', 'كلمة المرور', 'Passwort', 'Hasło', 'Contraseña', 'Clave wifi'];

test('una password dopo l\'etichetta in un\'altra lingua non arriva ai modelli; l\'etichetta resta', () => {
  for (const e of ETICHETTE) assert.equal(P.oscura(`${e}: Nyckel!2024`), `${e}: ${S}`, e);
  assert.equal(P.oscura('Användare: mario\nLösenord: Nyckel!2024'), `Användare: mario\nLösenord: ${S}`);
});

test('anche sotto l\'etichetta, in una cella o nella colonna di un CSV', () => {
  for (const t of ['Şifre\nNyckel!2024', 'Пароль | Nyckel!2024', 'Användare\tLösenord\nmario\tNyckel!2024',
    'användare,lösenord,anteckning\nmario,Nyckel!2024,hemma']) assert.ok(!P.oscura(t).includes('Nyckel'), t);
});

test('le parole che somigliano a un\'etichetta straniera restano', () => {
  for (const t of ['Parola del giorno: serendipità', 'Parole: Ciao2024', 'Lösenordshanterare: Bitwarden1', 'Κωδικοποίηση: UTF-8',
    'Clavel: Rojo2024', 'La clavicola: Rotta2024', 'Passwortmanager: Bitwarden1']) assert.equal(P.oscura(t), t, t);
});

const risposta = (campo, sopra) => C.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0, sopra }).nuovo;

test('chi chiede la password in russo, greco, cinese o in un\'altra lingua: la risposta sotto è una password', () => {
  for (const domanda of ['скинь пароль от wifi', 'какой пароль от вайфая', '密码是多少', 'wifi密码是什么', 'πες μου τον κωδικό του wifi',
    'ποιος είναι ο κωδικός του wifi;', 'vad är lösenordet till wifi', 'wifi şifresi nedir', 'pošli mi heslo', 'mikä on salasana',
    'dime la contraseña del wifi', 'sag mir das Passwort', 'Wi-Fi的密码？']) {
    assert.equal(risposta('gattonero', `Marco: ${domanda}`), S, domanda);
    assert.equal(risposta('certo, Nyckel2024', `Marco: ${domanda}`), `certo, ${S}`, domanda);
  }
});

test('nominata senza chiederla, la risposta perde solo le parole con cifre', () => {
  for (const detto of ['я поменял пароль от wifi', 'sag mal, ich habe das Passwort geändert', 'jag bytte lösenordet igår']) {
    assert.equal(risposta('отлично, увидимся вечером', `Marco: ${detto}`), 'отлично, увидимся вечером', detto);
    assert.equal(risposta('ok Nyckel2024', `Marco: ${detto}`), `ok ${S}`, detto);
  }
});

test('nella pagina di una chat la risposta sotto la domanda straniera non arriva ai modelli', () => {
  for (const domanda of ['скинь пароль от wifi', '密码是多少', 'πες μου τον κωδικό'] ) {
    assert.equal(P.oscura(`Marco: ${domanda}\nNyckel2024`), `Marco: ${domanda}\n${S}`, domanda);
  }
});

test('la password detta in chat in un\'altra lingua non esce in un indirizzo', () => {
  for (const scritto of ['мой пароль от wifi gattonero', 'wifi的密码 gattonero', 'lösenordet är gattonero']) {
    assert.ok(X.taintScritto('https://raccolta.example/?q=gattonero', scritto, 'apri il sito'), scritto);
  }
  assert.equal(X.taintScritto('https://raccolta.example/?q=gattonero', 'ho visto gattonero ieri', 'apri il sito'), null);
});

test('come in italiano: chi ricorda, chi può, chi ce l\'ha, la particella finale e il solo nome chiedono', () => {
  for (const d of ['напомни пароль от wifi', 'можешь скинуть пароль от wifi', 'у тебя есть пароль от wifi', 'пароль от wifi',
    'θυμάσαι τον κωδικό του wifi', 'μου λες τον κωδικό του wifi', 'τι κωδικό έχει το wifi', 'τον κωδικό του wifi',
    '你知道wifi密码吗', '密码呢', '请问wifi密码', 'wifi密码', 'wifi的密码', 'wifi密码发一下',
    'kan du sende passordet', 'şifreyi atar mısın', 'wifi şifresi ne', 'care e parola?', 'dă-mi parola', 'trimite-mi parola']) {
    assert.equal(risposta('gattonero', `Marco: ${d}`), S, d);
  }
  for (const [d, r] of [['у меня есть новый пароль', 'отлично'], ['Τι ωραία μέρα', 'υπέροχη'], ['ne parliamo domani della password', 'ok vediamo']]) {
    assert.equal(risposta(r, `Marco: ${d}`), r, d);
  }
});

test('il punto di domanda greco, scritto col punto e virgola o col suo segno, chiude la domanda', () => {
  for (const d of ['τον κωδικό;', 'τον κωδικό;', 'Ποιος είναι ο κωδικός;', 'έχεις τον κωδικό του wifi;']) {
    assert.equal(risposta('gattonero', `Marco: ${d}`), S, d);
    assert.equal(risposta('ok Nyckel2024', `Marco: ${d}`), `ok ${S}`, d);
  }
  // Fuori dal greco il punto e virgola resta quello che è.
  assert.equal(risposta('ok a domani', 'Marco: ho cambiato la password; ci vediamo'), 'ok a domani');
});

test('le forme declinate: il rumeno «parola» col possessivo o il wifi, il turco «şifrem»', () => {
  for (const t of ['Şifrem: Nyckel!2024', 'Wi-Fi şifrem: Nyckel!2024', 'Parola mea: Nyckel!2024', 'Parola wifi: Nyckel!2024']) {
    assert.ok(!P.oscura(t).includes('Nyckel'), t);
  }
  for (const t of ['Parola: Ciao2024', 'Parola mia, Ciao2024 è il saluto']) assert.equal(P.oscura(t), t, t);
});

test('i due punti e l\'uguale a tutta larghezza valgono i nostri', () => {
  for (const e of ['密码', 'パスワード', 'WiFi密码', 'Lösenord', 'Passwort']) {
    assert.equal(P.oscura(`${e}：Nyckel!2024`), `${e}：${S}`, e);
    assert.equal(P.oscura(`${e}＝Nyckel!2024`), `${e}＝${S}`, e);
  }
  assert.equal(risposta('密码：gattonero', 'Marco: 密码是多少'), `密码：${S}`);
});

test('il codice postale, quelli di prodotto e la parola chiave spagnola non sono password', () => {
  for (const t of ['Ταχυδρομικός κωδικός: 10558', 'Κωδικός προϊόντος: AB-1234', 'ΚΩΔΙΚΟΣ ΠΡΟΪΟΝΤΟΣ: AB-1234',
    'Κωδικός πελάτη: C-99812', 'Palabras clave: seo2024', 'Palabra clave: seo2024']) assert.equal(P.oscura(t), t, t);
  for (const t of ['Κωδικός: Nyckel!2024', 'Κωδικός πρόσβασης: Nyckel!2024', 'Clave: Nyckel!2024']) {
    assert.ok(!P.oscura(t).includes('Nyckel'), t);
  }
});

test('dopo il punto cinese o il punto di domanda greco la frase della risposta è finita', () => {
  // Una parola di sole lettere conta solo nella frase del dato: dopo il punto è il resto del messaggio.
  assert.equal(risposta('Nyckel2024。明天见', 'Marco: 密码是多少'), `${S}。明天见`);
  assert.equal(risposta('Nyckel2024. αύριο', 'Marco: πες μου τον κωδικό'), `${S}. αύριο`);
});
