// #2695 — i due cancelli verso i modelli, il pavimento e il correttore, tolgono le stesse password scritte in chiaro:
// quello che il pavimento toglie non parte nemmeno col correttore, e una frase che spiega la password resta intera.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { costoInUnita } from '../helpers/tempoRelativo.mjs';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../src/shared/guardianoStatico.js');
require('../../src/shared/urlExfil.js');
const P = require('../../src/shared/pavimento.js');
const R = require('../../src/main/services/correttoreRiservati.js');
const S = P.SEGNAPOSTO;
// In unità di riferimento: la lettura giusta ne costa al più una decina, quella che rilegge all'indietro le file di
// spazi da 200 a 1.800.
const TETTO_FILE_DI_SPAZI = 60;
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

test('#2695.1: nella riga di una tabella ogni etichetta, non solo la password, toglie il valore della cella dopo', () => {
  for (const [riga, v] of [
    ['| CVV: | 123 |', '123'], ['| CVV: | 1234 |', '1234'], ['| Codice CVV: | 123 |', '123'],
    ['| Codice di sicurezza: | 123 |', '123'], ['| CVV = | 123 |', '123'],
    ['| login_password: | Nyckel!2024 |', 'Nyckel!2024'], ['| login_password | Nyckel!2024 |', 'Nyckel!2024'],
    ['| db_password | hunter2x |', 'hunter2x'], ['| Chiave API: | abcd1234efgh5678 |', 'abcd1234efgh5678'],
    ['| api_key | abcd1234efgh5678 |', 'abcd1234efgh5678'],
    ['| Campo | Valore |\n|---|---|\n| Carta: | Visa |\n| CVV: | 482 |', '482'], ['CVV: | 123', '123'],
  ]) {
    assert.equal(P.oscura(riga), riga.replace(v, S), `pavimento: ${riga}`);
    assert.equal(alCorrettore(riga), riga.replace(v, S), `correttore: ${riga}`);
  }
  // Fuori dalla password e dalle chiavi la cella dopo resta: un numero qualunque, una spiegazione, una cella vuota.
  for (const riga of ['| Utenti: | 123 |', '| CVV: | vedi retro |', '| CVV: | |', '| Porta: | 3000 |',
    '| max_tokens | 4096 |', '| Campo | Note |\n|---|---|\n| CVV: | tre cifre sul retro |']) {
    assert.equal(P.oscura(riga), riga, `pavimento: ${riga}`);
    assert.equal(alCorrettore(riga), riga, `correttore: ${riga}`);
  }
});

test('#2695.7: l\'etichetta in grassetto, in corsivo o fra tag HTML, coi due punti dentro, toglie il valore da tutti e due i cancelli', () => {
  for (const [testo, v] of [
    ['| **Password:** | Nyckel!2024 |', 'Nyckel!2024'], ['| *Password:* | Nyckel!2024 |', 'Nyckel!2024'],
    ['**PIN:** 4821', '4821'], ['**CVV:** 123', '123'], ['*CVV:* 123', '123'],
    ['<b>Password:</b> Nyckel!2024', 'Nyckel!2024'], ['<strong>Password:</strong> Nyckel!2024', 'Nyckel!2024'],
    ['<b>PIN:</b> 4821', '4821'], ['<b>CVV:</b> 123', '123'], ['<i>CVV:</i> 123', '123'], ['<B>PIN:</B> 4821', '4821'],
    ['| <b>Password:</b> | Nyckel!2024 |', 'Nyckel!2024'], ['<span class="k">Password:</span> Nyckel!2024', 'Nyckel!2024'],
    ['**<b>CVV:</b>** 123', '123'], ['<b>**PIN:**</b> 4821', '4821'], ['<p>Password:</p> Nyckel!2024', 'Nyckel!2024'],
    ['<tr><td>CVV:</td><td>123</td></tr>', '123'], ['Password:<br>Nyckel!2024', 'Nyckel!2024'],
    ['Password: <b>Nyckel!2024</b>', 'Nyckel!2024'], ['Il <b>PIN</b> è 4821', '4821'],
    ['<strong>Codice di sicurezza (CVV):</strong> 847', '847'],
  ]) {
    assert.equal(P.oscura(testo), testo.replace(v, S), `pavimento: ${testo}`);
    assert.equal(alCorrettore(testo), testo.replace(v, S), `correttore: ${testo}`);
  }
  // Una password scritta fra parentesi angolari è una password, non un tag.
  assert.equal(P.oscura('Password: <Nyckel2024>'), `Password: ${S}`);
  // I tag non fanno di una spiegazione un valore.
  for (const testo of ['<em>Password:</em> obbligatoria', '**Password:** almeno 8 caratteri', '<b>Nota:</b> la password è obbligatoria',
    '<p>Ciao <b>Mario</b>, ci vediamo alle 5</p>']) {
    assert.equal(P.oscura(testo), testo, `pavimento: ${testo}`);
    assert.equal(alCorrettore(testo), testo, `correttore: ${testo}`);
  }
});

// #2673.10 — sotto l'etichetta il valore stava in una voce d'elenco o in un blocco di codice: il segno del blocco era
// letto come la riga sotto, e la password partiva (al posto suo si copriva «```»).
test('sotto l\'etichetta un valore in una voce d\'elenco, una citazione o un blocco di codice non arriva al modello', () => {
  for (const v of ['Nyckel!2024', 'gattonero']) {
    for (const [testo, atteso] of [
      [`Password:\n- ${v}`, `Password:\n- ${S}`],
      [`**Password:**\n- ${v}`, `**Password:**\n- ${S}`],
      [`- **Password:**\n  - ${v}`, `- **Password:**\n  - ${S}`],
      [`Password:\n* ${v}`, `Password:\n* ${S}`],
      [`Password:\n1. ${v}`, `Password:\n1. ${S}`],
      [`Password:\n> ${v}`, `Password:\n> ${S}`],
      [`Password:\n\`\`\`\n${v}\n\`\`\``, `Password:\n\`\`\`\n${S}\n\`\`\``],
      [`**Password:**\n\`\`\`text\n${v}\n\`\`\``, `**Password:**\n\`\`\`text\n${S}\n\`\`\``],
      [`Password:\n~~~\n${v}\n~~~`, `Password:\n~~~\n${S}\n~~~`],
    ]) {
      assert.equal(P.oscura(testo), atteso, 'pavimento');
      assert.equal(alCorrettore(testo), atteso, 'correttore');
    }
  }
  // Un elenco sotto l'etichetta che dice com'è la password resta intero.
  for (const testo of ['Requisiti della password:\n- almeno 8 caratteri\n- una maiuscola', 'Password:\n- obbligatoria',
    '## Password\nPer cambiarla vai nelle impostazioni', 'Password:\n```\nvedi sotto\n```']) {
    assert.equal(P.oscura(testo), testo, 'pavimento');
    assert.equal(alCorrettore(testo), testo, 'correttore');
  }
});

// Giro 4: la riga citata vuota, la riga di separazione, il titolo sottolineato e la definizione fra etichetta e valore;
// la password che comincia coi segni di un blocco non è un'apertura, e resta coperta come prima.
test('una riga di sola struttura Markdown fra etichetta e valore non prende il posto della password', () => {
  for (const testo of ['Password:\n>\n> Nyckel!2024', '> **Password:**\n>\n> Nyckel!2024', '> Password:\n> \n> Nyckel!2024',
    '>> Password:\n>>\n>> Nyckel!2024', '> PIN:\n>\n> 4821', 'Password:\n~~~Nyckel2024', 'Password:\n```Nyckel2024',
    'Password:\n---\nNyckel!2024', 'Password:\n___\nNyckel!2024', 'Password:\n* * *\nNyckel!2024',
    '**Password:**\n\n---\n\nNyckel!2024', 'Password\n========\nNyckel!2024', 'Password:\n: Nyckel!2024',
    'Password:\r\n>\r\n> Nyckel!2024', 'Password:\r\n---\r\nNyckel!2024', 'Password:\n\n---\n\n```bash\nNyckel!2024\n```',
    '| **Password:** | Nyckel!2024 |']) {
    assert.doesNotMatch(P.oscura(testo), /Nyckel|4821/, `pavimento: ${testo}`);
    assert.doesNotMatch(alCorrettore(testo), /Nyckel|4821/, `correttore: ${testo}`);
  }
  assert.equal(P.oscura('Password:\n---\nNyckel!2024'), `Password:\n---\n${S}`);
  for (const testo of ['# Titolo\n\n---\n\nTesto normale qui', 'Password:\n\n---\n\nLa trovi nel cassetto']) {
    assert.equal(P.oscura(testo), testo);
  }
});

// Le righe di apertura e chiusura di un blocco non contano come righe vuote: le righe vuote fra etichetta e valore sono
// le stesse per la parola sola e per la frase.
test('una password di più parole in un blocco di codice dopo una riga vuota non arriva al modello', () => {
  for (const testo of ['Password:\n\n```\ncasa mia al mare 2019\n```', 'Password:\n```\ncasa mia al mare 2019\n```',
    'Password:\n\n\n\ncasa mia al mare 2019', 'Password:\n\n\n\nNyckel!2024']) {
    assert.doesNotMatch(P.oscura(testo), /casa mia|Nyckel/, `pavimento: ${testo}`);
    assert.doesNotMatch(alCorrettore(testo), /casa mia|Nyckel/, `correttore: ${testo}`);
  }
});

// Una fila lunga di spazi, scritti o nati dai segni Markdown letti come spazi, si legge in un tempo che cresce con la
// lunghezza: un controllo all'indietro davanti a una parola rileggeva tutta la fila a ogni posto (secondi invece di ms).
test('righe lunghe di segni Markdown o di spazi non fermano il cancello dei modelli', () => {
  for (const testo of [`x\n${'\n- '.repeat(4000)}`, `x\n${'- '.repeat(4000)}x`, `x\n${'> '.repeat(4000)}x`,
    `Password:\n${'```\n'.repeat(4000)}`, `Password:\n${'> ```\n'.repeat(4000)}`, `${'```\n'.repeat(4000)}`,
    `${'> ```\n'.repeat(4000)}`, `${'   \n'.repeat(4000)}x`, `${' '.repeat(12000)}x`]) {
    for (const [cancello, fn] of [['pavimento', P.oscura], ['correttore', alCorrettore]]) {
      const c = costoInUnita(() => fn(testo), { tetto: TETTO_FILE_DI_SPAZI });
      assert.ok(c.entro, `${cancello} ${JSON.stringify(testo.slice(0, 12))}: ${c.come}`);
    }
  }
});

// #2754, #2758, #2761 — una parola lunghissima, una fila di cifre o di «[» si leggono in un tempo che cresce con la
// lunghezza: due letture ripartivano da ogni posto della parola o della fila e la rileggevano tutta (minuti su un milione
// di cifre). Prima del rimedio queste misure valevano centinaia di unità.
test('una parola lunghissima, una fila di cifre o di quadre aperte non fermano il cancello dei modelli', () => {
  for (const testo of ['0123456789'.repeat(10_000), `Vedi ${'['.repeat(100_000)} fine della spiegazione`,
    `${'a'.repeat(60_000)} SEGNO-DEL-MEZZO-77 ${'b'.repeat(60_000)}`, `x%41${'7'.repeat(100_000)}`]) {
    for (const [cancello, fn] of [['pavimento', P.oscura], ['correttore', alCorrettore]]) {
      const c = costoInUnita(() => fn(testo), { tetto: TETTO_FILE_DI_SPAZI });
      assert.ok(c.entro, `${cancello} ${JSON.stringify(testo.slice(0, 12))}: ${c.come}`);
    }
  }
});

// Le forme più rare dello stesso valore: il blocco di codice citato, più righe vuote, una cella vuota o una barra
// protetta in tabella. Il pavimento le copre come il correttore.
test('il blocco di codice citato, le righe vuote e le celle vuote non lasciano passare il valore sotto l\'etichetta', () => {
  for (const [testo, atteso] of [
    ['Password:\n> ```\n> Nyckel!2024\n> ```', `Password:\n> \`\`\`\n> ${S}\n> \`\`\``],
    ['> Password:\n> ```\n> Nyckel!2024\n> ```', `> Password:\n> \`\`\`\n> ${S}\n> \`\`\``],
    ['Password:\n\n\n\n- Nyckel!2024', `Password:\n\n\n\n- ${S}`],
    ['Password:\n\n\n```\nNyckel!2024\n```', `Password:\n\n\n\`\`\`\n${S}\n\`\`\``],
    ['| Password: | | Nyckel!2024 |', `| Password: | | ${S} |`],
    ['| Password: | Nyckel\\|2024 |', `| Password: | ${S} |`],
  ]) {
    assert.equal(P.oscura(testo), atteso, 'pavimento');
    assert.doesNotMatch(alCorrettore(testo), /Nyckel|2024/, 'correttore');
  }
  // Il testo che resta è uno che anche fuori dal blocco non è un valore: più parole sotto l'etichetta ora si coprono (#2714).
  for (const testo of ['Password:\n> ```\n> vedi sotto\n> ```','| Password: | | obbligatoria |', '| Password: | | |']) {
    assert.equal(P.oscura(testo), testo);
  }
});

// #2673.29 — la barra protetta vale come cella sola anche nella colonna «Password» sotto l'intestazione e nella coppia
// nome-valore: si spezzava su ogni barra, e «|2024» partiva. L'etichetta in grassetto coi due punti, la forma delle
// risposte dei modelli, copre la cella intera.
test('nella colonna «Password» e nella cella dopo l\'etichetta in grassetto la password con una barra protetta parte intera coperta', () => {
  for (const [testo, atteso] of [
    ['| Utente | Password |\n|---|---|\n| mario | Nyckel\\|2024 |', `| Utente | Password |\n|---|---|\n| mario | ${S} |`],
    ['| Utente | **Password** |\n| --- | --- |\n| mario | Nyckel\\|2024 |\n| anna | Faro7\\|Blu55 |',
      `| Utente | **Password** |\n| --- | --- |\n| mario | ${S} |\n| anna | ${S} |`],
    ['| Utente | Password | Sito |\n|---|---|---|\n| mar\\|io | Nyckel!2024 | posta |', null],
    ['| login_password | Nyckel\\|2024 |', `| login_password | ${S} |`],
    ['| **Password:** | Nyckel!2024 |', `| **Password:** | ${S} |`],
    ['| **Password:** | Nyckel\\|2024 |', `| **Password:** | ${S} |`],
  ]) {
    for (const [cancello, fuori] of [['pavimento', P.oscura(testo)], ['correttore', alCorrettore(testo)]]) {
      assert.doesNotMatch(fuori, /Nyckel|2024|Faro7|Blu55/, `${cancello}: ${testo}`);
      if (atteso) assert.equal(fuori, atteso, `${cancello}: ${testo}`);
    }
  }
  assert.equal(P.oscura('| Utente | Password |\n|---|---|\n| mar\\|io | Nyckel!2024 |'), `| Utente | Password |\n|---|---|\n| mar\\|io | ${S} |`,
    'la barra protetta nel nome non sposta la colonna');
});
