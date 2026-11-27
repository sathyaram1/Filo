// #1589 — il pavimento: password, carte e CVV, codici usa e getta, chiavi e token (anche in un indirizzo) non arrivano a
// nessun modello, a nessun livello. L'IBAN e il testo qualunque restano com'erano.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { costoInUnita } from '../helpers/tempoRelativo.mjs';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const P = require('../../src/shared/pavimento.js');
const S = P.SEGNAPOSTO;

test('una password annunciata, una carta e il suo CVV diventano il segnaposto', () => {
  const t = P.oscura('La tua password: Tr7#kq29Lm. Carta 4111 1111 1111 1111, CVV 123, scade 12/28.');
  assert.ok(!t.includes('Tr7#kq29Lm'));
  assert.ok(!/4111/.test(t));
  assert.ok(!/\b123\b/.test(t));
  assert.ok(t.includes(S));
  assert.ok(t.includes('scade 12/28'), 'il resto della frase resta');
});

test('il CVV si toglie anche in una cella, dopo una parentesi o con altre parole prima del separatore; la frase che lo nomina resta', () => {
  for (const [riga, v] of [
    ['CVV | 592', '592'], ['CVV\t592', '592'], ['Codice di sicurezza (CVV): 847', '847'], ['CVV code: 739', '739'],
    ['Il codice CVV della carta è 615', '615'], ['CVV (3 cifre): 123', '123'], ['Security code (CVC): 456', '456'],
    ['CVV/CVC (sul retro): 321', '321'], ['Codice di sicurezza della carta 318', '318'],
  ]) assert.ok(!P.oscura(riga).includes(v), riga);
  for (const riga of ['CVV: le 3 cifre sul retro della carta', 'Inserisci il CVV, le ultime tre cifre. Ordine 4829 confermato',
    'The security code review found 120 issues']) assert.equal(P.oscura(riga), riga);
});

test('il CVV annunciato dal verbo si toglie in tutte le lingue delle etichette, come la password (#1403.25)', () => {
  for (const [riga, v] of [
    ['Le CVV est 123', '123'], ['Der CVV ist 123', '123'], ['El CVV es 123', '123'], ['O CVV é 123', '123'],
    ['Het CVV is 123', '123'], ['CVV jest 123', '123'], ['Kod CVV to 123', '123'], ['Le CVV était 654', '654'],
    ['El CVV de la tarjeta es 789', '789'], ['Die Prüfnummer (CVV) lautet 321', '321'], ['Il CVV è 123', '123'],
  ]) assert.ok(!P.oscura(riga).includes(v), riga);
  for (const riga of ['Le CVV est le code à 3 chiffres', 'El CVV es el número de 3 cifras', 'Send the CVV to 123 Main Street'])
    assert.equal(P.oscura(riga), riga);
});

test('#2681.2: il CVV con l\'articolo dopo il verbo, col trattino, al futuro e col suo nome in ogni lingua si toglie', () => {
  for (const [riga, atteso] of [
    ['Il CVV è il 123', `Il CVV è il ${S}`], ['El CVV es el 123', `El CVV es el ${S}`],
    ['Le cryptogramme est le 123', `Le cryptogramme est le ${S}`], ['Die Kartenprüfnummer ist die 123', `Die Kartenprüfnummer ist die ${S}`],
    ['CVV — 123', `CVV — ${S}`], ['Код безопасности — 444', `Код безопасности — ${S}`], ['Il CVV sarà 123', `Il CVV sarà ${S}`],
    ['Le cryptogramme sera 123', `Le cryptogramme sera ${S}`], ['CVV - 123', `CVV - ${S}`], ['CVV → 123', `CVV → ${S}`],
    ['Il codice di sicurezza è il 123', `Il codice di sicurezza è il ${S}`], ['Il codice CVV della carta è il 615', `Il codice CVV della carta è il ${S}`],
    ['Le cryptogramme visuel : 123', `Le cryptogramme visuel : ${S}`], ['Le code de sécurité de la carte est le 482', `Le code de sécurité de la carte est le ${S}`],
    ['El código de seguridad es el 123', `El código de seguridad es el ${S}`], ['O código de segurança é o 123', `O código de segurança é o ${S}`],
    ['Sicherheitscode: 123', `Sicherheitscode: ${S}`], ['Die Prüfziffer wird 321', `Die Prüfziffer wird ${S}`],
    ['Beveiligingscode: 123', `Beveiligingscode: ${S}`], ['Kod zabezpieczający to 123', `Kod zabezpieczający to ${S}`],
    ['Код CVV — 123', `Код CVV — ${S}`], ['Ο κωδικός CVV είναι 123', `Ο κωδικός CVV είναι ${S}`],
    ['The card verification value is the 123', `The card verification value is the ${S}`],
  ]) assert.equal(P.oscura(riga), atteso, riga);
  for (const riga of ['Il CVV - 3 cifre sul retro', 'CVV-123', 'Le cryptogramme est le code à 3 chiffres', 'La cryptographie est le 123e sujet',
    'Il CVV è il numero sul retro', 'Prüfung 123'])
    assert.equal(P.oscura(riga), riga);
});

test('il CVV chiamato col suo nome nelle lingue delle etichette si toglie come «Codice di sicurezza: 123» (#1403.61)', () => {
  for (const riga of ['Code de sécurité : 123', 'Cryptogramme : 123', 'Sicherheitscode: 123', 'Kartenprüfnummer: 123',
    'Código de seguridad: 123', 'Código de segurança: 123', 'Beveiligingscode: 123', 'Kod bezpieczeństwa: 123',
    'Codice di sicurezza: 123', 'Security code: 123', 'Code de securite: 123', 'Codigo de seguranca: 123',
    'Kod bezpieczenstwa: 123', 'Kartenpruefnummer: 123', 'Cryptogramme visuel 123', 'Code de sécurité 123',
    'Code de sécurité de la carte : 123', 'Código de seguridad de la tarjeta 123', 'Código de segurança do cartão: 123',
    'Sicherheitscode der Karte: 123', 'Kod bezpieczeństwa karty: 123', 'Veiligheidscode van de kaart: 123',
    'Le code de sécurité est 123', 'El código de seguridad es 1234', 'Der Sicherheitscode lautet 123',
    'Code de sécurité (au dos) : 123', 'Sicherheitscode | 123']) {
    const fuori = P.oscura(riga);
    assert.ok(!/\b12(34|3)\b/.test(fuori), riga);
    assert.ok(fuori.includes(S), riga);
  }
  for (const riga of ['Le code de sécurité est au dos de la carte', 'El código de seguridad tiene 3 cifras',
    'Der Sicherheitscode steht auf der Rückseite', 'Code de la sécurité sociale, article 123'])
    assert.equal(P.oscura(riga), riga);
});

test('il CVV col suo nome nelle lingue delle etichette si toglie; la frase che lo descrive resta (#2681)', () => {
  for (const [riga, v] of [
    ['Le cryptogramme est 123', '123'], ['El código de seguridad es 123', '123'], ['Die Kartenprüfnummer ist 123', '123'],
    ['Le CVV est 123', '123'], ['Le cryptogramme visuel : 592', '592'], ['Le code de sécurité de la carte est 789', '789'],
    ['O código de segurança é 321', '321'], ['Codi de seguretat: 888', '888'], ['KARTENPRÜFNUMMER: 4321', '4321'],
    ['Ihr Sicherheitscode lautet 555', '555'], ['De beveiligingscode is 222', '222'], ['Kod bezpieczeństwa karty to 333', '333'],
    ['Код безопасности: 444', '444'], ['Κωδικός ασφαλείας: 666', '666'], ['Card verification value: 777', '777'],
    ['Il CVV era 615', '615'],
    ['Kod CVV to 123', '123'], ['Mój CVV to 124', '124'], ['Kod CVC2 to 125 z tyłu karty', '125'],
    ['El código de verificación es 126', '126'], ['El código de verificación de la tarjeta: 127', '127'],
    ['O código de verificação é 128', '128'], ['Le code de vérification de la carte est 129', '129'],
    ['Kartenpruefnummer: 131', '131'], ['Kreditkartenprüfnummer: 132', '132'], ['Kreditkartensicherheitscode: 133', '133'],
    ['El codi de seguretat és 134', '134'], ['Security code: 135', '135'], ['Card security code is 136', '136'],
  ]) assert.ok(!P.oscura(riga).includes(v), riga);
  for (const riga of ['Le cryptogramme est un code à 3 chiffres', 'El código de seguridad tiene 3 dígitos',
    'Die Prüfziffer der IBAN ist 89', 'Kod bezpieczeństwa to trzy cyfry', 'Send the CVV to 123 Main St',
    'Cryptogrammeur 123', 'Die Prüfnummer des Gutachtens ist 2024', 'Der Prüfcode des Produkts ist 456',
    'Prüfziffer 1234 im Bericht', 'Prüfnummer 123 des TÜV']) assert.equal(P.oscura(riga), riga);
});

test('il nome del CVV con un errore di battitura si riconosce lo stesso (#2681)', () => {
  for (const riga of ['Le crytogramme est 123', 'Le cryptograme est 123', 'El codigo de seguirdad es 123',
    'Die Kartenprüfnumer ist 123']) assert.ok(!P.oscura(riga).includes('123'), riga);
  for (const riga of ['Le cryptogrammeur est 123', 'La securite est 123 fois mieux']) assert.equal(P.oscura(riga), riga);
});

test('un codice usa e getta e una chiave col suo prefisso non escono', () => {
  const t = P.oscura('Il tuo codice OTP è 482913. Chiave: sk-abcdefghijklmnop1234567890');
  assert.ok(!t.includes('482913'));
  assert.ok(!t.includes('sk-abcdefghijklmnop1234567890'));
});

test('il codice di verifica di una mail e un PIN non escono; un codice qualunque sì', () => {
  assert.ok(!P.oscura('Il tuo codice di verifica è 482913').includes('482913'));
  assert.ok(!P.oscura('Your verification code: 7731').includes('7731'));
  assert.ok(!P.oscura('PIN: 4821').includes('4821'));
  const t = 'Ordine numero 482913, codice cliente RSSMRA80A01H501U, CAP 20100.';
  assert.equal(P.oscura(t), t);
});

test('dentro un indirizzo: la password prima della chiocciola e i parametri col nome di una credenziale', () => {
  const t = P.oscura('Apri https://mario:Segreta99@esempio.it/reset?token=a8F3kL0pQ2zX9vB7&lang=it e poi https://x.it/?code=it');
  assert.ok(!t.includes('Segreta99'));
  assert.ok(!t.includes('a8F3kL0pQ2zX9vB7'));
  assert.ok(t.includes('lang=it'), 'un parametro qualunque resta');
  assert.ok(t.includes('code=it'), 'un valore corto non è una credenziale');
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  assert.ok(!P.oscura(`Authorization: Bearer ${jwt}`).includes(jwt));
});

test('l\'IBAN, i numeri qualunque e le frasi sulla password restano', () => {
  const t = 'Il mio IBAN è IT60X0542811101000000123456. Come cambio la password di Gmail? Ordine 1234567890123.';
  assert.equal(P.oscura(t), t);
  assert.deepEqual(P.trova('Password dimenticata?'), []);
});

test('una password con l\'etichetta accanto non esce: tabella, colonna, etichetta sopra, parole in mezzo, senza cifre', () => {
  const casi = [
    ['Nome rete | CasaRossi\nPassword | Girasole2024', 'Girasole2024'],
    ['| Utente | Password |\n|---|---|\n| mario | Tulipano!88 |', 'Tulipano!88'],
    ['Utente\tPassword\nmario\tGirasole2024', 'Girasole2024'],
    ['Password\tFiloPass99!', 'FiloPass99'],
    ['Password amministratore\nMela!Verde77', 'Mela!Verde77'],
    ['Password per il wifi: casaMia2019', 'casaMia2019'],
    ['La password del wifi è casaMia2019', 'casaMia2019'],
    ['Password: hunter', 'hunter'],
    ['Nuova password: correcthorsebatterystaple', 'correcthorsebatterystaple'],
    ['Check-in dalle 15.\n\nPassword\n\nGirasole2024\n\nBuona permanenza', 'Girasole2024'],
    ['Le tue credenziali: utente mario, password Mela!Verde77', 'Mela!Verde77'],
    ['Password del router (admin): Faro#Blu55', 'Faro#Blu55'],
    ['Password - Nuvola2023', 'Nuvola2023'],
    ['Password → Nuvola2023', 'Nuvola2023'],
  ];
  for (const [t, segreto] of casi) assert.ok(!P.oscura(t).includes(segreto), t);
});

test('le frasi e le etichette di un modulo intorno alla password restano: un falso allarme toglierebbe la parola ovunque', () => {
  for (const t of [
    'Password dimenticata?\nAccedi',
    'Password\nMostra',
    'La password è cambiata.',
    'Password: obbligatoria',
    'Password: almeno 8 caratteri',
    'Filo ha visto un campo password o carta: valgono solo per quel sito',
    'Non salva e non propone password né altre email: solo quella dell\'account',
    '| Password manager | Prezzo |\n|---|---|\n| Bitwarden | 10 euro |',
    'Password - Guida',
    'Password\n\nL\'accesso è protetto da due passaggi',
    'Cambia la password e-mail ogni 90 giorni',
    'Imposta una password sicura!',
    `Password: ${S}, e il resto del dato`,
  ]) assert.equal(P.oscura(t), t, t);
  assert.equal(P.oscura('Password: Girasole2024 (cambiala al primo accesso)'), `Password: ${S} (cambiala al primo accesso)`);
});

test('nei messaggi annidati cambia solo la stringa che ha un segreto; le foto non si toccano', () => {
  const foto = { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } };
  const msg = [{ role: 'user', content: [{ type: 'text', text: 'Password: Kx82mPq!z' }, foto] }, { role: 'system', content: 'ciao' }];
  const out = P.oscuraTutto(msg);
  assert.notEqual(out, msg);
  assert.ok(!JSON.stringify(out).includes('Kx82mPq!z'));
  assert.equal(out[0].content[1], foto);
  assert.equal(out[1], msg[1]);
  const pulito = [{ role: 'user', content: 'niente da togliere' }];
  assert.equal(P.oscuraTutto(pulito), pulito);
});

// La regola sulla forma non dipende dalla disposizione: bottoni accanto, parole in mezzo, altre etichette, altre lingue.
test('una password con la sua forma vicino a qualunque etichetta di credenziale non esce, comunque sia disposta', () => {
  const casi = [
    ['Password\nGirasole2024   Copia', 'Girasole2024'],
    ['Password: casa mia al mare 2019', 'casa mia al mare 2019'],
    ['Pass: Corallo5Neve', 'Corallo5Neve'],
    ['Chiave di sicurezza di rete: Brezza7Mare', 'Brezza7Mare'],
    ['WPA2 Key: Onda4Lunga', 'Onda4Lunga'],
    ['Mot de passe : Rondine8Sud', 'Rondine8Sud'],
    ['Passwort: Tanne3Grün', 'Tanne3Grün'],
    ['La password per entrare nel portale aziendale di Mario è Ponte9Grigio', 'Ponte9Grigio'],
    ['Codice di accesso: Lampo4Verde', 'Lampo4Verde'],
    ['Password del wifi\n\n\nGirasole2024', 'Girasole2024'],
    ['Password:Girasole2024', 'Girasole2024'],
  ];
  for (const [t, segreto] of casi) assert.ok(!P.oscura(t).includes(segreto), t);
  assert.equal(P.oscura('Password:Girasole2024'), `Password:${S}`, 'il separatore resta');
});

// #2673.3 — dopo altre parole l'etichetta coi due punti e il valore a capo valeva meno di quella da sola.
test('un\'etichetta preceduta da altre parole, coi due punti e il valore sulla riga sotto, copre il valore', () => {
  for (const [t, segreto] of [
    ['Wi-Fi password:\nNyckel!2024', 'Nyckel!2024'],
    ['Router Wi-Fi password:\n\nFaro#Blu55', 'Faro#Blu55'],
    ['La mia password:\n  Girasole2024  ', 'Girasole2024'],
    ['Wi-Fi password\nNyckel!2024', 'Nyckel!2024'],
  ]) assert.ok(!P.oscura(t).includes(segreto), t);
  assert.equal(P.oscura('Wi-Fi password:\nNyckel!2024\nSSID: Casa'), `Wi-Fi password:\n${S}\nSSID: Casa`);
  for (const t of ['Reset your password:\nhttps://example.com/reset', 'Recupero password:\nmario.rossi@example.com',
    'Wi-Fi password:\nchiedi al bancone']) assert.equal(P.oscura(t), t);
});

// #2673.5 — l'enfasi del Markdown coi due punti dentro («**Password:** …») stava fra etichetta e valore.
test('un\'etichetta in grassetto o corsivo Markdown coi due punti dentro copre il valore, sulla riga e sotto', () => {
  for (const [t, segreto] of [
    ['**Password:** Nyckel!2024', 'Nyckel!2024'],
    ['- **Wi-Fi password:** Nyckel!2024', 'Nyckel!2024'],
    ['__Password:__ Nyckel!2024', 'Nyckel!2024'],
    ['*Password:* Nyckel!2024', 'Nyckel!2024'],
    ['_Password:_ Nyckel!2024', 'Nyckel!2024'],
    ['***Password:*** Nyckel!2024', 'Nyckel!2024'],
    ['**Password :** Nyckel!2024', 'Nyckel!2024'],
    ['**Password:** gattonero', 'gattonero'],
    ['**Password:** `Nyckel!2024`', 'Nyckel!2024'],
    ['**Password:**\nNyckel!2024', 'Nyckel!2024'],
    ['- **Wi-Fi password:**\n\nNyckel!2024', 'Nyckel!2024'],
    ['**Utente:** mario  \n**Password:** Faro#Blu55', 'Faro#Blu55'],
    ['**Lösenord:** Nyckel!2024', 'Nyckel!2024'],
    ['**PIN:** 4821', '4821'],
    ['**CVV:** 123', '123'],
    ['**Codice di verifica:** 482193', '482193'],
  ]) assert.ok(!P.oscura(t).includes(segreto), t);
  assert.equal(P.oscura('**Password:** Nyckel!2024\n**SSID:** Casa'), `**Password:** ${S}\n**SSID:** Casa`, 'la forma resta');
  for (const t of ['**Nota:** la password va cambiata ogni 90 giorni', 'Usa *.js e *.ts, poi 2*3*4 e __init__']) {
    assert.equal(P.oscura(t), t);
  }
});

// #2673.6 — in un file di testo di Windows «Password:» a capo e il valore arrivavano ai modelli.
test('con gli a capo di Windows o col solo \\r il testo si copre come con l\'a capo semplice, e gli a capo restano', () => {
  assert.equal(P.oscura('Password:\r\nNyckel!2024'), `Password:\r\n${S}`);
  assert.equal(P.oscura('Wi-Fi password:\r\nNyckel!2024\r\nSSID: Casa'), `Wi-Fi password:\r\n${S}\r\nSSID: Casa`);
  assert.equal(P.oscura('Password:\rNyckel!2024\rSSID: Casa'), `Password:\r${S}\rSSID: Casa`);
  assert.equal(P.oscura('Note\nPassword:\r\nGirasole2024\nfine'), `Note\nPassword:\r\n${S}\nfine`);
  const casi = [
    'Password:\nNyckel!2024', 'Password:\n\nGirasole2024', 'Password:\nhunter\n', 'Password del wifi\n\n\nGirasole2024',
    'Router Wi-Fi password:\n\nFaro#Blu55', 'La mia password:\n  Girasole2024  ', 'Utente: mario\nPassword: tramonto\n',
    'Password: casa mia al mare 2019\nSSID: Casa', 'Il tuo codice di verifica\n\n904127\n\nScade tra 10 minuti.',
    'Your one-time codes:\n4417 2290\n8810 3321', 'nome,password\nmario,Girasole2024\nluca,Faro#Blu55\n',
    '| Servizio | Password |\n|---|---|\n| posta | Girasole2024 |',
    '-----BEGIN PGP PRIVATE KEY BLOCK-----\nVersion: GnuPG v2\n\nlQOYBF3jN2kBCAC5q8xR2vT7mN4pK9wL3sA1dF6gH8jZ0cX2vB5nM7qW4eR9tY1u\n=Ab3x\n-----END PGP PRIVATE KEY BLOCK-----',
    'Wi-Fi password:\nchiedi al bancone', 'Reset your password:\nhttps://example.com/reset', 'Lista della spesa\nlatte\npane',
  ];
  for (const lf of casi) {
    for (const a of ['\r\n', '\r']) assert.equal(P.oscura(lf.replaceAll('\n', a)), P.oscura(lf).replaceAll('\n', a), JSON.stringify(lf));
  }
  const crlf = 'Utente: mario\r\nPassword: tramonto\r\n';
  assert.deepEqual(P.trova(crlf).filter((x) => Number.isInteger(x.inizio)).map((x) => crlf.slice(x.inizio, x.inizio + x.valore.length)),
    P.trova(crlf).filter((x) => Number.isInteger(x.inizio)).map((x) => x.valore), 'i posti sono quelli del testo vero');
});

test('un codice di accesso con le lettere esce intero, non solo le sue cifre; l\'anno altrove resta', () => {
  const t = P.oscura('Codice di accesso: Girasole2024. Contratto firmato nel 2024.');
  assert.ok(!t.includes('Girasole'));
  assert.ok(t.includes('nel 2024'));
});

// La regola sulla forma vale anche per i codici: il codice prima della sua etichetta, col nome del servizio in mezzo,
// sulla riga sotto, a gruppi o col prefisso. Un numero qualunque vicino a «codice» resta, e l'anno resta.
test('un codice usa e getta non esce comunque sia disposto rispetto alla sua etichetta', () => {
  const casi = [
    ['551902 is your Instagram code', '551902'],
    ['G-738214 è il tuo codice di verifica Google', '738214'],
    ['Il tuo codice Amazon è 640317', '640317'],
    ['Il tuo codice di verifica\n\n904127\n\nScade tra 10 minuti.', '904127'],
    ['Il codice di verifica è 482 913', '482 913'],
    ['WhatsApp code 482-913', '482-913'],
    ['Your verification code: 48-29-13', '48-29-13'],
    ['Usa il codice 482913 per accedere', '482913'],
    ['Carta virtuale\nScadenza 12/27\nCodice di sicurezza 318', '318'],
  ];
  for (const [t, segreto] of casi) assert.ok(!P.oscura(t).includes(segreto), t);
  for (const t of [
    'Codice prodotto 48213 disponibile',
    'Il codice della strada del 1992 dice',
    'Il tuo codice sconto vale 1000 euro',
    'Prezzo 1299 euro, codice articolo 556677',
    'Il tuo ordine 12345678 è stato spedito. Codice di tracciamento AB12',
  ]) assert.equal(P.oscura(t), t, t);
});

// Il codice lo dice la frase: col suo nome conta senza altre parole (gli SMS di Telegram, delle banche, dei pagamenti),
// senza nome conta dopo «usa» o «enter»; un identificativo che non apre niente (prenotazione, ordine, cliente) resta.
test('un codice usa e getta non esce come lo scrivono gli SMS; i codici che non aprono niente restano', () => {
  for (const [t, segreto] of [
    ['Telegram code: 48291', '48291'],
    ['Intesa Sanpaolo: il codice per autorizzare l\'operazione è 73829164', '73829164'],
    ['Inserisci il codice 615204 per completare l\'acquisto', '615204'],
    ['PosteID: codice 482913', '482913'],
    ['Usa 902817 per verificare il tuo account', '902817'],
    ['Use 337164 to verify your account', '337164'],
    ['Enter 482913 on the sign in page', '482913'],
    ['Google\nVerify your identity\nG-482913', '482913'],
    ['Il tuo codice di sblocco è 4829-1736-5521', '4829-1736-5521'],
    ['Il PIN della SIM è 1234 e il PUK 48291736', '48291736'],
    ['psw: Girasole2024', 'Girasole2024'],
  ]) assert.ok(!P.oscura(t).includes(segreto), t);
  for (const t of [
    'Il tuo codice di prenotazione: 482913',
    'Codice ordine: 4829-1736',
    'Il tuo codice cliente è 551902',
    'Il codice sconto ESTATE20 è valido fino al 30-06-26',
    'Art. 1218 codice civile',
    'Codice errore 4829: riprova',
    'Verificato da 1532 utenti',
    'Verifica lo stato della tua spedizione 48291736',
    'Chiamaci al numero verde 800 482 913 per accedere al servizio',
    'Prenotazione 551902 confermata',
  ]) assert.equal(P.oscura(t), t, t);
});

// Le lingue delle etichette valgono anche per i codici (#1403.13): il nome del codice e il verbo che lo annuncia.
test('un codice usa e getta non esce in francese, tedesco, spagnolo, portoghese, olandese e polacco', () => {
  for (const t of [
    'Le code est 482913', "le code d'accès est 482913", "Le code c'est 482913", "le code d'accès 482913",
    '482913 est votre code de vérification',
    'der Zugangscode ist 482913', 'Ihr Bestätigungscode lautet 482913', '482913 ist dein Code',
    'el código es 482913', 'el código de acceso es 482913', 'el código de acceso 482913', '482913 es tu código',
    'O código é 482913', 'Uw verificatiecode is 482913', 'Twój kod to 482913', 'Kod dostępu: 482913',
    'il codice é 482913',
  ]) assert.ok(!P.oscura(t).includes('482913'), t);
  for (const t of [
    'Le code postal est 75001', 'El código de cliente es 4829', 'Der Kundencode ist 4829',
    'Le code est compilé en 4829 ms', 'El código tiene 4829 líneas', 'the barcode is 48291034',
    'Send the code to 4829 people',
  ]) assert.equal(P.oscura(t), t, t);
});

// #1403.35 — il PIN chiamato «numero segreto», «codice confidenziale», «Geheimzahl» o «Pincode», col verbo o coi due punti.
test('il PIN chiamato numero segreto, codice confidenziale, Geheimzahl o Pincode non esce, in tutte le lingue', () => {
  for (const t of [
    'Il numero segreto è 4829', 'Il codice confidenziale è 4829', 'Le numéro secret est 4829', 'El número secreto es 4829',
    'El código confidencial es 4829', 'Meine Geheimzahl ist 4829', 'Geheimzahl: 4829', 'Der Geheimcode ist 4829',
    'Der Pincode ist 4829', 'Numero segreto: 4829', 'Codice confidenziale: 4829', 'Il codice riservato è 4829',
    'Le numéro confidentiel est 4829', 'O número secreto é 4829', 'The secret number is 4829',
    'The confidential code is 4829', 'Die Geheimnummer ist 4829', 'Ihre neue Geheimzahl lautet 4829.', 'PIN-Code: 4829',
    'Je pincode is 4829', 'De geheime code is 4829', 'Tajny numer to 4829', 'Geheimzahl\n4829', 'Numero segreto | 4829',
    'Il numero segreto della carta, che ti abbiamo mandato, è 4829', 'Die Geheimzahl Ihrer Kundenkarte ist 4829',
  ]) assert.ok(!P.oscura(t).includes('4829'), t);
  // Il numero di un altro nome nella stessa frase resta: lì il PIN è solo nominato.
  for (const t of [
    'Codice cliente 4829, numero segreto inviato per posta', 'Il numero segreto è arrivato, codice cliente 4829',
    'Il numero ordine è 4829', 'Il numero segreto della lotteria è uscito nel 2024',
  ]) assert.equal(P.oscura(t), t, t);
});

// #1403.80 — il «to» polacco dopo il PIN o il CVV, con una parola polacca davanti; in inglese «to» resta una destinazione.
test('in polacco il PIN, il numero segreto e il CVV detti con «to» non escono, anche col possessivo davanti', () => {
  for (const t of [
    'Mój PIN to 4829', 'Mój kod PIN to 4829', 'Mój tajny numer to 4829', 'Twój PIN to 4829', 'Twój nowy kod PIN to 4829',
    'Nowy PIN to 4829', 'Mój numer PIN to 4829', 'Twój PIN do karty to 4829', 'Moja nowa karta: PIN to 4829',
    'Mój PIN to «4829»', 'Mój CVV to 4829', 'Moja karta, CVV to 4829',
  ]) assert.ok(!P.oscura(t).includes('4829'), t);
  for (const t of [
    'Send the PIN to 4829 people', 'Send the CVV to 4829 people', 'Mój numer to 4829', 'Numer klienta to 4829',
    'Kod rabatowy to 4829',
  ]) assert.equal(P.oscura(t), t, t);
});

// Come in italiano, nelle altre lingue un nome comune dopo il codice lo fa un identificativo, salvo quello che apre.
test('nelle altre lingue il codice di un ordine, di una spedizione o di un errore resta; quello di una porta no', () => {
  for (const t of [
    'Le code de suivi est 482913', 'Le code de la commande est 482913', "Le code d'erreur est 5003",
    'Le code produit est 482913', 'Le code couleur est 482913', 'Le code article : 482913',
    'El código de seguimiento es 482913', 'El código del pedido es 482913', 'Código de seguimiento: 482913',
    'Mi pedido tiene el código 482913', 'Su código de reserva es 482913', 'El código de barras es 84123',
    'O código do produto é 48291', 'Kod rabatowy to 4829', 'Kod produktu: 48291', 'Kod pocztowy: 00950',
    'Der Code der Bestellung ist 482913', 'Der Code des Fehlers ist 5003', 'De code van de bestelling is 482913',
  ]) assert.equal(P.oscura(t), t, t);
  for (const t of [
    'Le code de la porte est 4829', 'Le code du portail est 1990', "Le code d'entrée est 4829", 'Der Code für die Tür ist 4829',
    'El código de la alarma es 4829', 'Kod do drzwi to 4829', 'De code van de deur is 4829',
    'Votre code de retrait pour la commande est 482913', 'Tu código para recoger el pedido es 482913',
    'Le code de sécurité est 482913', 'Su código de seguridad es 482913', 'Kod weryfikacyjny to 482913', 'Kod BLIK to 482913',
    'El código secreto es 482913', 'Tu código de Netflix es 482913', 'Le code de vérification de votre commande est 482913',
    // Il verbo al futuro o al passato, e l'articolo dopo il verbo, annunciano il valore come il presente.
    'Votre code sera 482913', 'Tu código será 482913', 'El código era 482913', 'Il codice sarà 482913',
    'Il codice era 482913', 'El código es el 482913',
  ]) assert.ok(!P.oscura(t).includes(t.match(/\d{4,}/)[0]), t);
});

// Il possessivo vale l'articolo: «de mon colis» è un identificativo come «du colis», «de ma carte» un segreto come «de la carte».
test('col possessivo o col nome subito dopo «code» il numero di un pacco o di una banca resta; quello di una carta o di un conto no', () => {
  for (const t of [
    'Le code de mon colis est 482913', 'Le code de mon billet est 482913', 'Le code de mon dossier est 482913',
    'El código de mi paquete es 482913', 'El código de mi vuelo es 482913', 'Der Code meines Pakets ist 482913',
    'Der Code meiner Sendung ist 482913', 'O código do meu pacote é 482913', 'Kod mojej paczki to 482913',
    'Le code banque est 30004', 'Le code guichet est 00828', 'Le code commune est 75056', 'Le code établissement est 30004',
    'Le code douanier est 85171300', 'Le code NAF est 6201Z', 'Le code INSEE est 75056', 'El código CNAE es 6201',
  ]) assert.equal(P.oscura(t), t, t);
  for (const t of [
    'Le code de ma carte est 4829', 'Le code de la carte est 4829', 'Le code de mon compte est 482913',
    'El código de mi tarjeta es 4829', 'El código de la cuenta es 482913', 'El código de mi móvil es 4829',
    'Der Code meiner Karte ist 4829', 'Der Code meines Kontos ist 482913', 'Der Code meines Handys ist 4829',
    'O código do meu cartão é 4829', 'Kod mojej karty to 4829', 'Le code de ma porte est 4829', 'Der Code meiner Tür ist 4829',
    'Le code confidentiel est 4829', 'Le code généré est 482913', 'Le code affiché est 482913', 'Code sent: 482913',
  ]) assert.ok(!P.oscura(t).includes(t.match(/\d{4,}/)[0]), t);
});

// #1403.44: il codice del proprio telefono o computer lo sblocca, anche dove «telefono» o «phone» fa pensare a un numero.
test('il codice per sbloccare il proprio telefono o computer, detto col possessivo, non esce in nessuna lingua', () => {
  for (const t of [
    'Le code de mon téléphone est 4829', 'Le code de mon ordinateur est 4829', 'El código de mi teléfono es 4829',
    'Il codice del mio telefono è 4829', 'The code of my phone is 4829', 'My phone code is 4829', "My phone's code is 4829",
    'Le code de mon portable est 4829', 'My computer code is 4829', 'My laptop code is 4829', 'El código de mi ordenador es 4829',
    'El código de mi computadora es 4829', 'O código do meu computador é 4829', 'Kod do mojego komputera to 4829',
    'Il mio codice del telefono è 4829', 'Mon code de téléphone est 4829', 'Le code de mon nouveau téléphone est 4829',
    'Il codice della mia SIM è 4829', 'Il codice del mio telefono è 1990', 'Codice del mio telefono:\n4829',
    'Le code de mon téléphone est « 4829 »', 'De code van mijn computer is 4829', 'My phone unlock code: 4829',
  ]) assert.ok(!P.oscura(t).includes(t.match(/\d{4}/)[0]), t);
  for (const t of [
    'The code of my phone number is 4829', 'My phone code for Italy is 0039', 'The phone code for Italy is 0039',
    'Il codice del telefono del cliente è 4829', 'Il codice prodotto del telefono è 4829', 'Le code produit du téléphone est 4829',
    'Le numéro de mon téléphone est 4829', 'Il codice del mio ordine telefonico è 4829', 'Chiama il numero di telefono 0248291736',
  ]) assert.equal(P.oscura(t), t, t);
});

test('il codice del proprio telefono non esce nemmeno con un\'altra preposizione, la parola che dice a cosa serve, un avverbio o un refuso', () => {
  for (const t of [
    'The code to my phone is 5101', 'Il codice per il mio telefono è 5102', 'Il mio telefono ha il codice 4829',
    'Le code secret de mon téléphone est 4829', 'Le code de déverrouillage de mon téléphone est 4829',
    'El código de desbloqueo de mi teléfono es 4829', "Le code d'accès de mon ordinateur est 4829",
    'il codice del mio telefono è: 5103', "Le code de mon téléphone, c'est 5104", 'My phone code is now 5105',
    'Il codice del mio telefono è sempre 4829', 'Il codice del mio telefono sarebbe 4829', 'il codice del mio telefono e 5106',
    'Le code de mon tél est 5107', 'le code de mon portable cest 4829', 'El código de mi celu es 4829', 'El código de mi compu es 4829',
    'Mein Handycode ist 5108', 'Mijn telefooncode is 4829', 'Der Entsperrcode meines Handys ist 4829',
  ]) assert.ok(!P.oscura(t).includes(t.match(/\d{4}/)[0]), t);
});

test('un identificativo del proprio telefono resta in ogni lingua, anche in inglese col nome davanti a «code»', () => {
  for (const t of [
    'The serial code of my phone is 5200', 'The IMEI code of my phone is 5201', 'The product code of my phone is 5202',
    'The QR code of my phone is 4829', 'The model code of my phone is 4829', 'The area code of my phone is 0039',
    'Il codice seriale del mio telefono è 4829', 'Le code IMEI de mon téléphone est 4829', 'El código de modelo de mi teléfono es 4829',
    'My phone model code is 4829', 'Il codice di errore del mio pc è 4829', 'Il codice sorgente del mio computer è 4829',
  ]) assert.equal(P.oscura(t), t, t);
});

test('un apparecchio fa del suo codice un segreto con l\'etichetta come col possessivo: l\'elenco è uno solo', () => {
  for (const t of [
    'Le code du portable est 4829', "Le code de l'ordinateur est 4829", 'El código del portátil es 4829', 'Il codice del computer è 4829',
    'Le code de la tablette est 4829', 'Kod laptopa to 4829',
    // Lo stesso elenco per il nome attaccato a «code», e le parole che tengono segreto un codice anche qui.
    'Mijn mobielcode is 4829', 'Mein Gerätecode ist 4829', 'Mein Notebookcode ist 4829', 'Mein Smartphone-Code ist 4829',
    'Il codice personale del mio telefono è 4829', 'Il codice nuovo del mio telefono è 4829', 'Il codice temporaneo del mio telefono è 4829',
  ]) assert.ok(!P.oscura(t).includes('4829'), t);
});

test('il codice del proprio telefono non esce con le parole in più che si mettono parlando (#1403.44, giro 2)', () => {
  const alModello = (t) => P.oscuraTutto([{ role: 'user', content: t }])[0].content;
  for (const t of [
    'Il codice del mio telefono nuovo è 4829', 'il codice del mio telefono aziendale è 4829', 'il codice del mio telefono di lavoro è 4829',
    'il codice del mio telefono Samsung è 4829', 'El código de mi teléfono nuevo es 4829', 'Le code de mon téléphone pro est 4829',
    'il codice del mio telefono ora è 4829', 'il codice del mio telefono adesso è 4829', 'The code of my phone currently is 4829',
    'Le code de mon téléphone maintenant c\'est 4829', 'El código de mi teléfono ahora es 4829',
    'le code pour déverrouiller mon téléphone est 4829', 'le code pour débloquer mon téléphone est 4829',
    'el código para desbloquear mi teléfono es 4829', 'il codice del mio telefono è sempre stato 4829', 'My phone code has been 4829',
    'The code of my phone has always been 4829', '4829 è il codice del mio telefono', '4829 is my phone code',
    'il codice del mio telefono, 4829', 'il codice del mio telefono e del mio pc è 4829',
    'Il codice del mio telefono è 1111. Quello del pc è 4829', 'Il codice del mio telefono è 1111, quello del pc 4829',
    'The code of my phone is 1111, the one of my laptop is 4829', 'Per sbloccare il mio telefono uso 4829',
    'I unlock my phone with 4829', 'Sblocco il mio telefono con 4829',
  ]) assert.ok(!alModello(t).includes('4829'), t);
  for (const t of [
    'Il codice del mio telefono nuovo serie 71034', 'The code of my phone number is 4829', 'Il codice del mio telefono è 1111. Quello del mio pc costa 5512 euro',
    'Il prezzo del mio telefono è 300 euro, quello del mio pc è 1200 euro', 'Ho sbloccato il mio telefono nel 2019', '71024 è il codice IMEI del mio telefono',
    '71025 is the serial code of my phone', '71023 è il numero del mio telefono', 'il codice del mio telefono, modello 71032',
    'Il codice del mio telefono cliente è 71027', 'Per sbloccare il mio telefono uso l\'impronta, il modello è 71020',
  ]) assert.equal(alModello(t), t.replace('1111', P.SEGNAPOSTO), t);
});

test('in tedesco il codice annunciato al futuro, dopo una relativa o con lo scopo non esce', () => {
  for (const t of [
    'Dein Code wird 482913 sein', 'Der Code, den du erhalten hast, ist 482913', 'Der Code, den ich bekommen habe, lautet 482913',
    'Der Code zum Einloggen ist 482913', 'Der Code für die Anmeldung ist 482913', 'Il codice, che hai ricevuto, è 482913',
  ]) assert.ok(!P.oscura(t).includes('482913'), t);
  assert.equal(P.oscura('In the code, MAX_SIZE is 65536'), 'In the code, MAX_SIZE is 65536');
});

// Un elenco solo dei verbi per password e codici: due copie col nome uguale non si caricano dopo una fusione.
test('il verbo che annuncia una password vale come per i codici, al futuro e col «to» polacco', () => {
  for (const [t, v] of [
    ['Le mot de passe est Girasole77', 'Girasole77'], ['Das Passwort lautet Girasole77', 'Girasole77'],
    ['Das Passwort wird Girasole77 sein', 'Girasole77'], ['La password sarà Girasole77', 'Girasole77'],
    ['Le mot de passe sera Girasole77', 'Girasole77'], ['Hasło to Girasole77', 'Girasole77'],
  ]) assert.ok(!P.oscura(t).includes(v), t);
  assert.equal(P.oscura('send the password to mario77'), 'send the password to mario77');
});

// Il pavimento gira su ogni chiamata a un modello, nel processo principale: una riga lunga piena di codici annunciati
// si controlla in fretta e li toglie tutti (prima costava centinaia di unità di riferimento, ora meno di dieci).
test('una riga di 120.000 caratteri che ripete un codice annunciato si controlla in fretta', () => {
  for (const pezzo of ['the code is 482913. ', 'el código es 482913. ', 'der Zugangscode ist 482913 ']) {
    const s = pezzo.repeat(Math.ceil(120000 / pezzo.length));
    let fuori = '';
    const c = costoInUnita(() => { fuori = P.oscura(s); }, { tetto: 60 });
    assert.ok(c.entro, `${pezzo}: ${c.come}`);
    assert.ok(!fuori.includes('482913'), pezzo);
  }
});

// Al posto del valore una parola qualunque conta anche in mezzo alla riga e sotto i bottoni, se sta da sola.
test('una password nel posto del valore non esce: in mezzo alla riga, con una parentesi dopo, sotto i bottoni', () => {
  const casi = [
    ['Utente: mario Password: tramonto', 'tramonto'],
    ['Password: sunflower (non condividerla)', 'sunflower'],
    ['Rete: CasaRossi · Password: tramonto · Canale 6', 'tramonto'],
    ['Password\nMostra\nGirasole2024', 'Girasole2024'],
    ['Password\n••••••••\nCopia\nGirasole2024', 'Girasole2024'],
    ['Username\nmario\nPassword\nsunflower', 'sunflower'],
  ];
  for (const [t, segreto] of casi) assert.ok(!P.oscura(t).includes(segreto), t);
  for (const t of ['Password\nAccedi', 'Password\nAccedi\nPassword dimenticata?', 'Password: Ciao, come stai?']) assert.equal(P.oscura(t), t, t);
});

test('le etichette corte e le frasi intorno restano quando il valore non ha la forma di una password', () => {
  for (const t of [
    'Green pass: valido',
    'Ski pass 3 giorni: 120 euro',
    'Password: deve avere almeno otto caratteri, una maiuscola e un numero',
    'Scrivi a mario.rossi@esempio.it per la password',
  ]) assert.equal(P.oscura(t), t, t);
  assert.equal(P.oscura('Password: Girasole2024 (cambiala al primo accesso)'), `Password: ${S} (cambiala al primo accesso)`);
});

// Il posto del valore, non le parole vicine: quello che sta accanto all'etichetta senza esserne il valore arriva com'è.
test('vicino alla parola «password» restano i nomi di prodotto, gli utenti, gli indirizzi dei campi e il codice', () => {
  for (const t of [
    '✓ label "Password" :: form > div > label:nth-of-type(1)\n✓ input[type=password] "Password" :: #password1\n✓ button "Accedi" :: form > button.btn-primary',
    '✓ input "Password:" :: #c\n✓ label "Hasło" :: label[for="c"]',
    'come cambio la password del router TP-Link AX1500? E quella di Office365?',
    'ho dimenticato la password di Windows11',
    'password wifi Fritz!Box 7530 dove la trovo',
    'Hai richiesto di reimpostare la password per l\'account mario.rossi_87',
    'Reset password - Ticket #INC0012345',
    'Password scaduta: aggiornala entro il 30/11',
    'Wi-Fi password del bar: chiedi al bancone',
    'body: JSON.stringify({ username, password: form.password.value }),',
    'const password = process.env.DB_PASSWORD;',
    '<input type="password" name="password" id="pwd1" required>',
    '$hash = password_hash($password, PASSWORD_DEFAULT);',
  ]) assert.equal(P.oscura(t), t, t);
  assert.ok(!P.oscura('password provvisoria Tr7#kq29Lm').includes('Tr7#kq29Lm'));
  assert.ok(!P.oscura('Password per il wifi (chiedila a Mario se non va): Faro#Blu55').includes('Faro#Blu55'));
});

// Una parola senza la forma di una password si toglie solo al posto del valore: altrove nella pagina è una parola.
test('una password che è una parola si toglie al suo posto, non dentro le altre parole né nel resto della pagina', () => {
  assert.equal(P.oscura('Password del wifi: casa\nLa casalinga ha le chiavi di casa.'), `Password del wifi: ${S}\nLa casalinga ha le chiavi di casa.`);
  assert.equal(P.oscura('Password: Girasole2024\nRicorda: Girasole2024 vale anche per la posta.'), `Password: ${S}\nRicorda: ${S} vale anche per la posta.`);
  assert.equal(P.oscura('Impostazioni\nPassword\nNotifiche\n\nScegli quali Notifiche ricevere.'), `Impostazioni\nPassword\n${S}\n\nScegli quali Notifiche ricevere.`);
  assert.equal(P.oscura('Password: Attiva\nAttiva le notifiche'), `Password: ${S}\nAttiva le notifiche`);
});

// La pagina dell'account: la password a puntini è già coperta, e sotto «Modifica» viene il campo dopo.
test('oltre i puntini e i bottoni sotto «Password» conta solo la forma di una password: il campo dopo resta', () => {
  const quante = (t, p) => t.split(p).length - 1;
  for (const [t, campo] of [
    ['Nome\nMario Rossi\nModifica\nPassword\n••••••••\nModifica\nTelefono\n+39 333 1234567\nModifica\n\nAggiungi un Telefono di riserva', 'Telefono'],
    ['Email\nPassword\nModifica\nNotifiche\nAttive', 'Notifiche'],
    ['Email\nPassword\nMostra\nRicordami\nAccedi', 'Ricordami'],
  ]) assert.equal(quante(P.oscura(t), campo), quante(t, campo), t);
  assert.ok(!P.oscura('Password\n••••••••\nCopia\nGirasole2024').includes('Girasole2024'));
});

// Una tabella nome-valore: la riga «Password | x» non è un'intestazione, e le righe sotto sono altri campi.
test('in una tabella nome-valore si toglie solo il valore della password, le etichette sotto restano', () => {
  assert.equal(P.oscura('Utente\tmario\nPassword\tGirasole2024\nServer\timap.esempio.it\nPorta\t993'), `Utente\tmario\nPassword\t${S}\nServer\timap.esempio.it\nPorta\t993`);
  assert.equal(P.oscura('| Utente | mario |\n| Password | Girasole2024 |\n| Porta | 993 |'), `| Utente | mario |\n| Password | ${S} |\n| Porta | 993 |`);
  assert.equal(P.oscura('| Utente | Password |\n|---|---|\n| mario | tramonto |\nIl tramonto è bello'), `| Utente | Password |\n|---|---|\n| mario | ${S} |\nIl tramonto è bello`);
});

// Nei file di configurazione il posto del valore è dopo la chiave che si chiama password, anche dentro un nome composto.
test('una password come valore in JSON, .env, YAML e XML non esce; le espressioni e i segnaposti di tipo restano', () => {
  for (const [t, segreto] of [
    ['{ "username": "mario", "password": "Girasole2024" }', 'Girasole2024'],
    ['{"user":"mario","password":"Girasole2024"}', 'Girasole2024'],
    ['DB_HOST=db\nDB_PASSWORD=Ponte9Grigio', 'Ponte9Grigio'],
    ['POSTGRES_PASSWORD: Faro7Blu', 'Faro7Blu'],
    ['admin_password = "Girasole2024"', 'Girasole2024'],
    ['smtp_pass=Girasole2024', 'Girasole2024'],
    ['"adminPassword": "Lupo#88x"', 'Lupo#88x'],
    ['<utente>mario</utente>\n<password>Nuvola2023x</password>', 'Nuvola2023x'],
  ]) assert.ok(!P.oscura(t).includes(segreto), t);
  for (const t of [
    'DB_PASSWORD=${DB_PASSWORD}',
    '"password": "string"',
    'bypass=Girasole2024',
    'if (password == "x") {}',
    'password: process.env.DB_PASSWORD',
  ]) assert.equal(P.oscura(t), t, t);
});

test('dopo «Password:» resta la frase che dice dove trovarla o come sceglierla; la password con gli spazi no', () => {
  for (const t of [
    'Password Wi-Fi: disponibile alla reception',
    'Password del portale ospiti: sul retro della chiave magnetica',
    'Password: vedi email precedente',
    'Password: quella di sempre',
    'Password: deve avere almeno otto caratteri',
    'Password: min. 8 caratteri',
    'Password: 8-20 caratteri',
  ]) assert.equal(P.oscura(t), t, t);
  assert.equal(P.oscura('Password: casa mia al mare 2019'), `Password: ${S}`);
});

test('#2678.5: senza virgolette la frase-password si toglie anche con un articolo in testa, lunga o con un simbolo', () => {
  for (const riga of ['Password: la casa al mare', 'Password: il mio cane si chiama Fido da sempre',
    'Password: casa mia al mare sole vento pane luna', 'Password: the quick brown fox jumps over the lazy dog',
    'Password del wifi: la casa al mare 77!', 'parola d’ordine: una rondine non fa primavera', 'Passwort: der rote Hund',
    'Utente: mario\nPassword: la casa al mare\nServer: imap.esempio.it', 'Password: may the force be with you',
    'Password: ci vediamo ogni giorno']) {
    assert.ok(!/casa al mare|Fido|vento|lazy|rondine|rote|force|vediamo/.test(P.oscura(riga)), riga);
  }
  assert.equal(P.oscura('Password: la casa al mare'), `Password: ${S}`);
  assert.equal(P.oscura('Utente: mario\nPassword: la casa al mare\nServer: imap.esempio.it'), `Utente: mario\nPassword: ${S}\nServer: imap.esempio.it`);
  for (const riga of ['Password: la stessa di prima', 'Password: la trovi sul retro del modem', 'Password: la tua data di nascita',
    'Password: the same as before', 'Password: the one on the router', 'Password: le chiedi a Mario quando arrivi',
    'Password: deve avere almeno otto caratteri, una maiuscola, un numero e un simbolo speciale fra quelli ammessi',
    'Password: la riceverai per email entro due giorni lavorativi dalla richiesta', 'Password: Ciao, come stai?',
    'Password: otto caratteri minimo', 'Password: cambiata ieri', 'Password: scade tra trenta giorni',
    `Password: ${'parola '.repeat(40).trim()}`]) assert.equal(P.oscura(riga), riga, riga);
});

test('#2678.13: una nota fra parentesi o un\'emoji in fondo alla riga non salva la password, di una parola o di più', () => {
  for (const [riga, atteso] of [
    ['Password: casa mia al mare (tutto minuscolo)', `Password: ${S} (tutto minuscolo)`],
    ['Password: casa mia al mare 😊', `Password: ${S} 😊`],
    ['Password: casa mia al mare 👍🏽', `Password: ${S} 👍🏽`],
    ['Password: casa mia al mare ❤️ (minuscolo)', `Password: ${S} ❤️ (minuscolo)`],
    ['Password: casa mia al mare :)', `Password: ${S} :)`],
    ['Password: tramonto (minuscolo)', `Password: ${S} (minuscolo)`],
    ['Password: tramonto 😊', `Password: ${S} 😊`],
    ['Utente: mario\nPassword: la casa al mare (tutto minuscolo)\nServer: imap.esempio.it',
      `Utente: mario\nPassword: ${S} (tutto minuscolo)\nServer: imap.esempio.it`],
  ]) assert.equal(P.oscura(riga), atteso, riga);
  for (const riga of ['Password: disponibile alla reception (piano terra)', 'Password: la stessa di prima 😊',
    'Password: deve avere almeno otto caratteri (una maiuscola)', 'Password: (vedi email)', 'Password: dimenticata 😢',
    'Password: vedi email 😊 (oggetto «accesso»)']) assert.equal(P.oscura(riga), riga, riga);
});

test('#2678.13: la riga può continuare dopo la nota, con un segno o dopo un\'emoji; la nota anche fra quadre o attaccata', () => {
  for (const [riga, atteso] of [
    ['Password: casa mia al mare (tutto minuscolo).', `Password: ${S} (tutto minuscolo).`],
    ['Password: casa mia al mare (tutto minuscolo)!', `Password: ${S} (tutto minuscolo)!`],
    ['Password: casa mia al mare (tutto minuscolo), utente mario', `Password: ${S} (tutto minuscolo), utente mario`],
    ['Password: casa mia al mare (tutto minuscolo). Utente: mario', `Password: ${S} (tutto minuscolo). Utente: mario`],
    ['Password: casa mia al mare (minuscolo) — mi raccomando', `Password: ${S} (minuscolo) — mi raccomando`],
    ['Password: casa mia al mare 😊.', `Password: ${S} 😊.`],
    ['Password: casa mia al mare 😊 grazie', `Password: ${S} 😊 grazie`],
    ['Password: casa mia al mare (tutto minuscolo) 😊 a presto', `Password: ${S} (tutto minuscolo) 😊 a presto`],
    ['Password: tramonto 😊.', `Password: ${S} 😊.`],
    ['Password: casa mia al mare [tutto minuscolo]', `Password: ${S} [tutto minuscolo]`],
    ['Password: tramonto [minuscolo]', `Password: ${S} [minuscolo]`],
    ['Password: casa mia al mare(tutto minuscolo)', `Password: ${S}(tutto minuscolo)`],
    ['Password: casa mia al mare 1️⃣', `Password: ${S} 1️⃣`],
    ['Password: casa mia al mare 🇮🇹', `Password: ${S} 🇮🇹`],
    ['Password: casa mia al mare 👨‍👩‍👧', `Password: ${S} 👨‍👩‍👧`],
  ]) assert.equal(P.oscura(riga), atteso, riga);
  for (const riga of ['Password: la trovi nel cassetto (quello in alto).', 'Password: dimenticata 😅.',
    'Password: vedi email 😊 grazie', 'password = input("Password: ")']) assert.equal(P.oscura(riga), riga, riga);
});

// La nota si cerca solo nella coda della riga: da ogni punto di una riga lunga piena di emoji o di parentesi la ricerca
// costerebbe secondi (cresce col quadrato della lunghezza), su ogni chiamata a un modello.
test('#2678.13: una riga lunghissima di emoji o di parentesi dopo «Password:» si controlla in fretta', () => {
  // Le code che finiscono con una parola fanno fallire la ricerca da ogni punto: senza il limite costano secondi.
  for (const coda of [' (a)'.repeat(20000) + ' x', ' [a]'.repeat(20000) + ' x', ' 😊'.repeat(20000), ' ('.repeat(20000)]) {
    const s = `Password: casa mia al mare${coda}`;
    const c = costoInUnita(() => P.oscura(s), { tetto: 60 });
    assert.ok(c.entro, `${coda.slice(0, 4)}: ${c.come}`);
  }
});

test('#2678.14: un numero e una parola di tempo dentro la frase-password non la fanno passare per la sua data', () => {
  for (const frase of ['ci vediamo tra due giorni', 'casa mia al mare da tre anni', 'il mio cane si chiama Fido e ha tre anni',
    'sei la mia vita da 2 anni', 'we met 3 years ago in Rome']) {
    for (const riga of [`Password: ${frase}`, `Password: «${frase}»`, `La password è "${frase}"`]) {
      assert.ok(P.oscura(riga).includes(S) && !P.oscura(riga).includes(frase.split(' ').slice(-2).join(' ')), riga);
    }
  }
  assert.equal(P.oscura('Password: ci vediamo tra due giorni'), `Password: ${S}`);
  for (const riga of ['Password: 8 o più caratteri', 'Password: valida per 90 giorni', 'Password: ultima modifica 3 mesi fa',
    'Password: ultima modifica il 12 marzo 2024', 'Password: marzo 2024', 'Password: last changed 3 months ago',
    'Password: at least 8 characters', 'Password: 90 giorni', 'Password: «almeno 8 caratteri»', 'Password: tre anni fa']) {
    assert.equal(P.oscura(riga), riga, riga);
  }
});

test('#2678.14: la frase-password che apre col tempo si toglie; la riga che dice lo stato della password resta, con e senza virgolette', () => {
  for (const [frase, pezzo] of [['tre anni al mare con mia madre', 'mia madre'], ['due giorni a Parigi con Luca', 'Luca'],
    ['dieci anni di matrimonio felice', 'felice'], ['da tre anni vivo a Milano', 'Milano'], ['tra due giorni parto per Roma', 'Roma'],
    ['sette giorni in barca', 'barca'], ['three days in Paris', 'Paris']]) {
    for (const riga of [`Password: ${frase}`, `Password: «${frase}»`]) assert.ok(!P.oscura(riga).includes(pezzo), riga);
  }
  for (const stato of ['bloccata per 30 minuti', 'reimpostata 2 ore fa', 'la devo cambiare tra due giorni', 'me la chiede ogni 3 giorni',
    'te la dico tra due giorni', 'cambiala ogni tre mesi', 'sempre la solita da 5 anni', 'minimum 8 characters',
    'between 8 and 64 characters', 'lunga almeno 8 caratteri', 'creata 2 mesi fa', 'created 3 months ago', 'reset 2 days ago',
    'impostata il 3 marzo 2024', 'tra 8 e 16 caratteri', 'da 8 a 16 caratteri', 'scade tra 30 giorni', 'expires in 90 days']) {
    for (const riga of [`Password: ${stato}`, `Password: «${stato}»`]) assert.equal(P.oscura(riga), riga, riga);
  }
});

test('una chiave o una password per nome, in un file di configurazione o sulla pagina di un servizio, non esce', () => {
  const segreti = {
    'PGPASSWORD=Girasole2024': 'Girasole2024',
    'dbpassword: Girasole2024': 'Girasole2024',
    'SECRET_KEY=django-insecure-8h3k2j4h5g6f7d8s9a0': 'django-insecure-8h3k2j4h5g6f7d8s9a0',
    'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY': 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    'api_key=8f14e45fceea167a5a36dedd4bea2543': '8f14e45fceea167a5a36dedd4bea2543',
    'client_secret=GOCSPX-1a2B3c4D5e6F7g8H9i0J': 'GOCSPX-1a2B3c4D5e6F7g8H9i0J',
    '"apiKey": "8f14e45fceea167a5a36dedd4bea2543"': '8f14e45fceea167a5a36dedd4bea2543',
    'token: 8f14e45fceea167a5a36dedd4bea2543': '8f14e45fceea167a5a36dedd4bea2543',
    'Chiave API: 8f14e45fceea167a5a36dedd4bea2543': '8f14e45fceea167a5a36dedd4bea2543',
    'Chiave API\n8f14e45fceea167a5a36dedd4bea2543\nCopia': '8f14e45fceea167a5a36dedd4bea2543',
    'Secret key\nCopia\nsk9f8e7d6c5b4a3210zz': 'sk9f8e7d6c5b4a3210zz',
    'Authorization: Basic bWFyaW86R2lyYXNvbGUyMDI0': 'bWFyaW86R2lyYXNvbGUyMDI0',
    '<add key="Password" value="Girasole2024"/>': 'Girasole2024',
    'sshpass -p Girasole2024 ssh mario@host': 'Girasole2024',
    'mysql -u root -pGirasole2024 db': 'Girasole2024',
  };
  for (const [t, s] of Object.entries(segreti)) assert.ok(!P.oscura(t).includes(s), t);
  for (const t of ['max_tokens: 4096', 'token_type: bearer', 'tokenizer: cl100k_base', 'primary_key: user_id',
    'Segreto: lo sai solo tu', 'mysql -h localhost -p mydb', 'Apri https://x.it/reset?token=a8F3kL0pQ2zX9vB7&lang=it']) {
    assert.ok(P.oscura(t).includes(t.split(/[:=\n ]/).pop()), t);
  }
});

test('il telefono a cui parte il codice, il numero dell\'assistenza e la data di una password restano', () => {
  for (const t of ['Ti abbiamo inviato un codice di verifica al numero +39 333 1234567',
    'Ti abbiamo inviato un codice di verifica al +39 333 123 4567',
    'Codice di verifica\n\nNon hai ricevuto il codice? Chiama 02 4829 1736',
    'Password ultima modifica: 12 mar 2024', 'Password: modificata 2 mesi fa', 'Password: scade tra 30 giorni']) {
    assert.equal(P.oscura(t), t);
  }
  assert.equal(P.oscura('Il codice di verifica è 482 913'), `Il codice di verifica è ${S}`);
  assert.equal(P.oscura('Password: casa mia al mare 2019'), `Password: ${S}`);
});

test('il corpo di una chiave privata, la password di una riga di comando, un webhook e i codici di recupero non escono', () => {
  const pem = (tipo, corpo) => `-----BEGIN ${tipo}PRIVATE KEY-----\n${corpo}\n-----END ${tipo}PRIVATE KEY-----`;
  const segreti = {
    [pem('OPENSSH ', 'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\nQyNTUxOQAAACDkBvTqjD8mY3Jv5nQ2sXkzT7a9yH0b1fLqW3eR5cN4w')]: 'QyNTUxOQAAACDkBvTqjD8mY3Jv5nQ2sXkzT7a9yH0b1fLqW3eR5cN4w',
    [pem('RSA ', 'MIIEpAIBAAKCAQEAx5mT2rXyQ4pQe9yLk3Vv8pZq1wF8aB2cD3eF4gH5iJ6kL7mN8oP9')]: 'MIIEpAIBAAKCAQEAx5mT2rXyQ4pQe9yLk3Vv8pZq1wF8aB2cD3eF4gH5iJ6kL7mN8oP9',
    [pem('EC ', 'MHcCAQEEIIrYSSNQFaA2Hwf1duRSxKtLYX5CB04fSeQ6tF1aY/PuoAoGCCqGSM49AwEHoUQDQgAE')]: 'MHcCAQEEIIrYSSNQFaA2Hwf1duRSxKtLYX5CB04fSeQ6tF1aY',
    '{"private_key": "-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC\\nabcd1234EFGH\\n-----END PRIVATE KEY-----\\n"}': 'abcd1234EFGH',
    'docker login -u mario -p Faro7Blu2024 registry.example.com': 'Faro7Blu2024',
    'curl -u mario:Ponte9Grigio https://api.example.com/v1': 'Ponte9Grigio',
    'smbclient //server/share -U mario%Girasole2024': 'Girasole2024',
    'sqlcmd -S server -U sa -P Girasole2024': 'Girasole2024',
    'redis-cli -a Girasole2024': 'Girasole2024',
    'Webhook: https://discord.com/api/webhooks/123456789012345678/abcDEFghiJKLmnoPQRstuVWXyz1234567890abcdEFGH': 'abcDEFghiJKLmnoPQRstuVWXyz1234567890abcdEFGH',
    // Indirizzi composti a pezzi: scritti interi, la protezione dei push di GitHub li respinge come segreti veri.
    [`SLACK_WEBHOOK=https://hooks.${'slack'}.com/services/T00000000/B00000000/${'X'.repeat(24)}`]: 'X'.repeat(24),
    [`Webhook: https://hooks.${'slack'}.com/services/T024BE7LD/B01ABCDEF12/${'aBcDeFgHiJkL'}mNoPqRsTuVwX`]: 'aBcDeFgHiJkLmNoPqRsTuVwX',
    'Il mio token di Telegram bot:123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw': 'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
    'Recovery codes\nKeep these somewhere safe.\n\n3f9a1-b2c7d\n8e4d0-a6f15\nc1b7e-90d2a\n77d3f-1e0b9\n4a2b1-9c8d7\n0e1f2-3a4b5\nDownload': '0e1f2-3a4b5',
  };
  for (const [t, s] of Object.entries(segreti)) assert.ok(!P.oscura(t).includes(s), t);
  for (const t of ['docker run -u 1000:1000 -p 8080:80 nginx', 'ssh -l mario -p 2222 host.example.com', 'mysql -u root -p mydb',
    'mkdir -p dir2 && cp -a src2 dst', 'https://github.com/x/y/settings/hooks/12345678',
    'https://example.com/hooks/deployment-notifications-channel']) assert.equal(P.oscura(t), t, t);
  assert.ok(P.oscura('Recovery codes\n3f9a1-b2c7d\n8e4d0-a6f15\nKeep these in a safe place.').includes('Keep these in a safe place.'));
});

test('le etichette, i tempi e il codice accanto a una chiave password e le cifre finali di un telefono restano', () => {
  for (const t of ['"password_label": "Inserisci la password",\n"forgot_password": "Password dimenticata?",\n"password_hint": "Almeno otto caratteri"',
    'password_reset_timeout: 3600\ncache_ttl: 3600', 'def login(username: str, password: str) -> bool:\n    password = input("Password: ")',
    'interface User { email: string; password: string }', 'password = getpass.getpass()',
    'Abbiamo inviato un codice al numero che termina con 4567.', 'Abbiamo inviato un codice di verifica al ***4567']) {
    assert.equal(P.oscura(t), t, t);
  }
  for (const [t, s] of Object.entries({ 'password_confirmation: Girasole2024': 'Girasole2024', 'password2 = "Nuvola2023x"': 'Nuvola2023x',
    'Codice di verifica: 482913. Inviato al numero che termina con 4567': '482913' })) assert.ok(!P.oscura(t).includes(s), t);
  assert.ok(P.oscura('Codice di verifica: 482913. Inviato al numero che termina con 4567').endsWith('termina con 4567'));
});

// Il nome comune subito prima del numero lo fa un identificativo, senza elencarli; il servizio o il monouso no.
test('il numero di un «codice di qualcosa» resta; quello del codice di un servizio o temporaneo no', () => {
  for (const t of ['Codice abbonamento 48291375', 'Il tuo codice utente è 551902', 'Codice evento 739204', 'Il codice del corso è 4829',
    'Il codice dell\'esame è 48291', 'Codice aula 1203', 'Codice paziente 482913', 'Codice abbonamento\n48291375', 'The event code is 4829',
    'Codice abbonamento 48291375\nIl tuo codice utente è 551902']) {
    assert.equal(P.oscura(t), t, t);
  }
  for (const [t, s] of [['Codice temporaneo: 482913', '482913'], ['Inserisci il codice ricevuto via SMS: 482913', '482913'],
    ['your code is 482913', '482913'], ['backup code: 48291736', '48291736'], ['Il tuo codice segreto è 48291', '48291'],
    ['Codice evento 739204 per accedere alla sala', '739204'], ['Il codice SMS è 482913', '482913']]) {
    assert.ok(!P.oscura(t).includes(s), t);
  }
});

test('il corpo di una chiave privata PGP e di una chiave PuTTY non esce', () => {
  const pgp = '-----BEGIN PGP PRIVATE KEY BLOCK-----\nVersion: GnuPG v2\n\nlQOYBF3jN2kBCAC5q8xR2vT7mN4pK9wL3sA1dF6gH8jZ0cX2vB5nM7qW4eR9tY1u\n=Ab3x\n-----END PGP PRIVATE KEY BLOCK-----';
  assert.ok(!P.oscura(pgp).includes('lQOYBF3jN2kBCAC5q8xR2vT7mN4pK9wL3sA1dF6gH8jZ0cX2vB5nM7qW4eR9tY1u'));
  const ppk = 'PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: none\nPublic-Lines: 1\nAAAAC3NzaC1lZDI1NTE5AAAAIOgJ8X2vB5nM7qW4eR9tY1u\nPrivate-Lines: 1\nAAAAIFq8xR2vT7mN4pK9wL3sA1dF6gH8jZ0cX2vB5nM7qW4eR9tY1uLqW3eR5\nPrivate-MAC: 8f14e45f';
  const t = P.oscura(ppk);
  assert.ok(!t.includes('AAAAIFq8xR2vT7mN4pK9wL3sA1dF6gH8jZ0cX2vB5nM7qW4eR9tY1uLqW3eR5'));
  assert.ok(t.includes('AAAAC3NzaC1lZDI1NTE5AAAAIOgJ8X2vB5nM7qW4eR9tY1u'), 'la parte pubblica resta');
});

// Le cose che un codice apre si riconoscono; il numero sulla riga sotto conta solo per un codice che non ha già il suo.
test('il codice che apre un cancello, una cassaforte, un ritiro o un prelievo non esce; la riga sotto un codice completo resta', () => {
  for (const [t, s] of [['Il codice del cancello è 4829.', '4829'], ['Il codice della cassetta delle chiavi è 7316.', '7316'],
    ['Il codice della cassaforte è 5502.', '5502'], ['Il tuo codice di prelievo è 918273.', '918273'], ['Codice di ritiro: 640385', '640385'],
    ['Codice di ritiro del tuo ordine: 640385', '640385'], ['Codice allarme: 4829', '4829'], ['Il codice del wifi è 48291375', '48291375'],
    ['Il codice del dispositivo è 4829-1736', '4829-1736'], ['Codice porta 4829', '4829'], ['Your pickup code is 640385', '640385'],
    ['gate code 4829', '4829'], ['Il tuo codice di verifica\n482913', '482913'], ['Ti abbiamo inviato un codice al +39 333 1234567\n482913', '482913'],
    ['Grazie per l\'ordine 48291. Il tuo codice di verifica è:\n482913', '482913']]) {
    assert.ok(!P.oscura(t).includes(s), t);
  }
  for (const t of ['Codice evento | 739204\nPosti disponibili | 1200', 'Codice corso: 4829\nAula 1203',
    'Il corso inizia alle 18. Codice del corso: 4829\nIscritti 1250', 'Porta con te il codice abbonamento 48291375']) {
    assert.equal(P.oscura(t), t, t);
  }
});

// Quello che il codice apre è il suo nome, non una parola qualunque della frase; un anno dopo quel nome è il codice.
test('una parola dell\'aprire nella frase non copre un identificativo; il codice di quello che si apre, anche fuori elenco, non esce', () => {
  for (const t of ['Videocitofono smart Wi-Fi, codice prodotto 48291375', 'Codice evento 739204 - Teatro alla Scala, ingresso principale',
    'Codice ordine 482913: ritiro in negozio entro il 30/11', 'Codice errore 4829 sul dispositivo', 'Codice impianto 48291 (allarme)',
    'Codice prodotto: 48291 - Cassaforte a muro', 'Il codice postale dell\'ingresso è 20121', 'Codice del cancello installato nel 2019',
    'Apri il file e inserisci 48291 nel campo quantità', 'Codice abbonamento 48291375, apri l\'app per i dettagli']) {
    assert.equal(P.oscura(t), t, t);
  }
  for (const [t, s] of [['Il codice dell\'appartamento è 7316.', '7316'], ['Codice della serranda: 5502', '5502'], ['Codice ascensore: 6403', '6403'],
    ['building code 8812', '8812'], ['Codice bancomat: 91827', '91827'], ['Keycode: 4829', '4829'], ['front door code: 4829', '4829'],
    ['Per aprire il cancello digita 3958 sul tastierino', '3958'], ['Per entrare digita 4829', '4829'], ['Il codice del cancello è 1990', '1990'],
    ['Il codice per aprire il cancello è 4829', '4829'], ['Il codice del cancello è 4829, per problemi chiama il numero verde', '4829']]) {
    assert.ok(!P.oscura(t).includes(s), t);
  }
});

// #1403.93: il codice di quello che si apre, e il PIN, con le parole in più del parlato, come quello del telefono.
test('il codice di un cancello o di una porta detto con un avverbio, un verbo composto o col refuso non esce', () => {
  for (const [t, s] of [['Il codice del cancello è sempre 4829', '4829'], ['The gate code is now 4829', '4829'],
    ['Il codice del cancello e 4829', '4829'], ['Il codice del portone è ancora 4829', '4829'], ['The door code is still 4829', '4829'],
    ['Il codice del cancello è sempre stato 4829', '4829'], ['The gate code has been 4829', '4829'], ['Il codice del cancello, 4829', '4829'],
    ['Il codice del cancello nuovo e 4829', '4829'], ['Il codice per aprire il cancello e 4829', '4829'], ['Il codice di ritiro è sempre 640385', '640385'],
    ['Il codice del wifi è ancora 48291736', '48291736'], ['Il codice del cancello è sempre 1990', '1990'], ['The gate code is now 1990', '1990'],
    ['Le code du portail est toujours 4829', '4829'], ['El código de la puerta es siempre 4829', '4829'], ['Il pin è sempre 4829', '4829'],
    ['The pin is now 4829', '4829'], ['Il codice OTP è sempre 482913', '482913']]) {
    assert.ok(!P.oscura(t).includes(s), t);
  }
  // La «e» e la virgola dopo altre parole sono congiunzioni; un identificativo resta tale anche con l'avverbio.
  for (const t of ['Il codice del cancello non funziona e 4829 volte ho provato', 'Il codice del cancello lo sai, e 4829 è il numero della stanza',
    'Send the gate code to 4829 people', 'Il codice cliente è sempre 4829', 'Il codice prodotto è sempre 4829', 'Il codice del corso e 4829',
    'Il codice postale del cancello è sempre 20121', 'Codice del cancello installato nel 2019']) {
    assert.equal(P.oscura(t), t, t);
  }
});

// Il codice ha un posto, come la password: un altro numero della frase che dice «code» non è il codice, e non sparisce
// dalla pagina.
test('un numero nella frase del codice che non sta al posto del codice resta, in tutta la pagina e nelle ricerche', () => {
  for (const t of ['Start the server with npm start. The code uses port 3000.\nThen open http://localhost:3000',
    'Il codice è stato scaricato 48291 volte', 'My code returns 1024 instead of 2048', 'Il codice va eseguito con almeno 4096 MB di RAM',
    'Il codice è valido per 1200 utenti', 'Inserisci il codice e ricevi 1000 punti', 'QR code scansionato 4829 volte',
    'The building code requires 1200 mm of clearance', 'In the code below, MAX_SIZE is 65536', 'Il PIN dell\'evento è stato visto da 1532 persone',
    'node code port 3000 already in use', 'PIN predefinito 0000 cuffie bluetooth']) {
    assert.equal(P.oscura(t), t, t);
  }
  for (const [t, s] of [['Il tuo codice di verifica, valido 10 minuti, è 482913', '482913'], ['Il codice qui sotto scade tra 10 minuti: 482913', '482913'],
    ['Codice OTP | 482913', '482913'], ['Codice:\n482913', '482913'], ['Use code 482913 to sign in', '482913'],
    ['Codice di apertura: 6153', '6153'], ['Codice di disattivazione: 4829', '4829'], ['Per disattivare l\'allarme digita 5261', '5261']]) {
    assert.ok(!P.oscura(t).includes(s), t);
  }
});

test('un codice usa e getta di lettere e cifre non esce; un identificativo di lettere e cifre resta', () => {
  for (const [t, s] of [['Il tuo codice Steam Guard è 7K2F9', '7K2F9'], ['Enter this code on your TV: WDJB-MJHT', 'WDJB-MJHT']]) {
    assert.ok(!P.oscura(t).includes(s), t);
  }
  for (const t of ['Codice prodotto AB12C', 'Usa il codice sconto ESTATE20 al checkout', 'Codice modello KDL40W', 'Codice volo AZ1234',
    'The code uses SHA256 hashing', 'Il codice promozionale BLACK50 scade domani']) {
    assert.equal(P.oscura(t), t, t);
  }
});

// Coi puntini o un bottone sulla riga dell'etichetta la password è già mostrata coperta: la riga sotto è un altro campo.
test('con la password a puntini o un bottone accanto all\'etichetta, la parola della riga sotto resta', () => {
  for (const t of ['Password ••••••••\nNotifiche', 'Password Modifica\nSicurezza', 'Password ••••••• Modifica\nTelefono']) {
    assert.equal(P.oscura(t), t, t);
  }
  assert.ok(!P.oscura('Password ••••••• Mostra\nGirasole2024').includes('Girasole2024'));
});

// #1589.8 — le password scritte a mano le riconosce un posto solo (riservatiNelTesto.js), per il correttore e per il
// pavimento: la stessa pagina non le fa uscire né dal campo né verso la spiegazione o la chat.
test('la risposta sotto chi chiede la password esce come segnaposto dal pavimento come dal correttore', () => {
  require('../../src/shared/urlExfil.js');
  const R = require('../../src/main/services/correttoreRiservati.js');
  const pagina = 'Marco: mi mandi la password del wifi?\nIo: certo, Brezza7Mare';
  assert.equal(P.oscura(pagina), `Marco: mi mandi la password del wifi?\nIo: certo, ${S}`);
  const campo = R.richiestaSenzaRiservati({ prima: '', nuovo: 'certo, Brezza7Mare', dopo: '', sopra: 'Marco: mi mandi la password del wifi?' });
  assert.ok(!campo.nuovo.includes('Brezza7Mare'), 'il correttore la toglie dal campo');
  assert.equal(P.oscura('Username / Password: mario / Girasole2024'), `Username / Password: mario / ${S}`, 'le forme libere del correttore');
  assert.equal(P.oscura('SSID: CasaRossi\nKey: Faro7Blu55'), `SSID: CasaRossi\nKey: ${S}`);
  // Il resto di una pagina che parla di password resta: una parola qualunque, e la domanda con la risposta sulla stessa riga.
  for (const t of ['mi mandi la password del wifi?\ncerto, girasole', 'Come cambio la password di Gmail? Ordine 1234567890123.']) {
    assert.equal(P.oscura(t), t, t);
  }
  assert.ok(P.trova(pagina).some((x) => x.valore === 'Brezza7Mare'), 'il valore si toglie com\'è scritto, maiuscole comprese');
  // #1403.14 — anche sotto una domanda in un'altra lingua.
  for (const d of ["Marco: tu peux m'envoyer le mot de passe ?", 'Marco: wie ist das WLAN-Passwort?']) {
    assert.equal(P.oscura(`${d}\nLuc: Brezza7Mare`), `${d}\nLuc: ${S}`, d);
  }
});

// #2692 — il PIN dato in risposta in una conversazione copiata esce come la password: dopo il nome di chi scrive,
// dopo l'orario della copia di WhatsApp, dopo «certo,», sotto i solleciti di chi chiede, sotto i messaggi senza numero
// (degli altri, o di chi risponde prima del numero), dopo parole qualunque nel messaggio, nella copia di Telegram.
test('il codice dato in risposta a chi lo chiede in chat esce come segnaposto, come la password', () => {
  const casi = [
    ['Marco: qual è il pin della carta?\nAnna: anche io lo voglio\nLuc: 4821', `Marco: qual è il pin della carta?\nAnna: anche io lo voglio\nLuc: ${S}`],
    ['Marco: qual è il pin della carta?\nLuc: aspetta che controllo\nLuc: 4821', `Marco: qual è il pin della carta?\nLuc: aspetta che controllo\nLuc: ${S}`],
    ['Marco: qual è il pin della carta?\nLuc: ciao\nLuc: 4821', `Marco: qual è il pin della carta?\nLuc: ciao\nLuc: ${S}`],
    ['Marco: qual è il pin della carta?\nLuc: te lo scrivo qui: 4821', `Marco: qual è il pin della carta?\nLuc: te lo scrivo qui: ${S}`],
    ['Marco: qual è il pin della carta?\nLuc: è sempre 4821', `Marco: qual è il pin della carta?\nLuc: è sempre ${S}`],
    ['Marco: qual è il pin della carta?\nLuc: ciao Marco! 4821', `Marco: qual è il pin della carta?\nLuc: ciao Marco! ${S}`],
    ['qual è il pin?\nLuc: 4821', `qual è il pin?\nLuc: ${S}`],
    ['Marco, [26.11.26 15:42]\nqual è il pin della carta?\n\nLuc, [26.11.26 15:43]\n4821',
      `Marco, [26.11.26 15:42]\nqual è il pin della carta?\n\nLuc, [26.11.26 15:43]\n${S}`],
    ['Marco: ciao scusa, sono alla cassa del supermercato e non mi ricordo più il pin della carta, me lo dici?\nLuc: 4821',
      `Marco: ciao scusa, sono alla cassa del supermercato e non mi ricordo più il pin della carta, me lo dici?\nLuc: ${S}`],
    // Come la password («Totale: Gatto2024» sotto chi la chiede esce): una riga «Nome: …» sotto la domanda è chi risponde.
    ['Qual è il codice del cancello?\nTotale: 4821', `Qual è il codice del cancello?\nTotale: ${S}`],
    ['Marco: qual è il pin della carta?\nLuc: 4821', `Marco: qual è il pin della carta?\nLuc: ${S}`],
    ['Marco: mi mandi il codice del cancello?\nLuc: certo, 4829', `Marco: mi mandi il codice del cancello?\nLuc: certo, ${S}`],
    ['Marco: qual è il pin?\nMarco: dai sono alla cassa\n\nLuc: eccolo: 4821', `Marco: qual è il pin?\nMarco: dai sono alla cassa\n\nLuc: eccolo: ${S}`],
    ['[15:42, 26/11/2026] Marco: qual è il pin?\n[15:43, 26/11/2026] Luc: 4821', `[15:42, 26/11/2026] Marco: qual è il pin?\n[15:43, 26/11/2026] Luc: ${S}`],
    ['26/11/26, 15:42 - Marco: qual è il pin?\n26/11/26, 15:43 - Luc: sì è 4821', `26/11/26, 15:42 - Marco: qual è il pin?\n26/11/26, 15:43 - Luc: sì è ${S}`],
    ['Mark: what is the PIN?\nLuke: sure, 4821', `Mark: what is the PIN?\nLuke: sure, ${S}`],
    ['mi mandi il pin?\ncerto, 4821', `mi mandi il pin?\ncerto, ${S}`],
  ];
  for (const [t, atteso] of casi) assert.equal(P.oscura(t), atteso, t);
  // Un numero che non è la risposta, o la risposta che dà un identificativo, resta.
  for (const t of ['Marco: ho cambiato il pin della carta\nLuc: ok\nAnna: ci vediamo alle 1830',
    'Marco: qual è il pin?\nLuc: non lo so\nLuc: chiedi ad Anna, il suo numero finisce con 4821',
    'Marco: qual è il pin?\nLuc: chiamami al 333 1234567', 'Marco: qual è il codice cliente?\nLuc: 48213',
    'Marco: qual è il pin?\nLuc: ho 1500 euro sul conto', 'Marco: come cambio il codice di Gmail?\nLuc: vai in impostazioni, ordine 1234',
    'Qual è il codice di avviamento postale di Roma?\nÈ 00118']) {
    assert.equal(P.oscura(t), t, t);
  }
});

// #1403.2 — la colonna «password» di un CSV, a virgole o a punti e virgola, come quella a barre o a tabulazioni.
test('la colonna password di un CSV non esce: punti e virgola, esportazioni dei browser, virgolette, a capo di Windows', () => {
  const casi = [
    ['utente;password\nmario.rossi;hunter22', ['hunter22']],
    ['utente,password\r\nmario.rossi,hunter22\r\nanna,Mela!Verde77\r\n', ['hunter22', 'Mela!Verde77']],
    ['name,url,username,password,note\nBanca,https://banca.it,mario,gattino,\nPosta,https://posta.it,mario,Tr7#kq29Lm,lavoro', ['gattino', 'Tr7#kq29Lm']],
    ['"url","username","password"\n"https://a.it","mario","hunter22"\n"https://b.it","anna","con, virgola 9"', ['hunter22', 'con, virgola 9']],
    ['folder,favorite,type,name,login_uri,login_username,login_password\n,,login,Banca,https://banca.it,mario,Girasole2024', ['Girasole2024']],
    ['Utente;Password;Ruolo\n\nmario;Nuvola2023;admin', ['Nuvola2023']],
    // #1403.5 — anche con l'etichetta fuori dall'alfabeto latino.
    ['логин;пароль\nivan;Ключ!Зима2024', ['Ключ!Зима2024']],
    ['用户名,密码,备注\nzhang,Mima2024!,工作', ['Mima2024!']],
    ['url,login_пароль\nhttps://a.ru,Ключ!Зима2024', ['Ключ!Зима2024']],
  ];
  for (const [t, segreti] of casi) {
    const o = P.oscura(t);
    for (const s of segreti) assert.ok(!o.includes(s), `${s} in ${JSON.stringify(t)}`);
  }
  // Ogni riga, non solo quella sotto l'intestazione; e una parola senza forma si toglie solo dove sta.
  const export_ = 'name,url,username,password\nBanca,https://banca.it,mario,gattino\nPosta,https://posta.it,gattino,Xk9#pQ2v\nAltro,https://x.it,anna,hunter22\n';
  assert.equal(P.oscura(export_).split('\n').slice(2).join('\n'), `Posta,https://posta.it,gattino,${S}\nAltro,https://x.it,anna,${S}\n`);
});

test('una frase con le virgole che nomina la password non apre una colonna, e la tabella finisce dove cambiano le celle', () => {
  for (const t of [
    'Inserisci utente, password e premi invio\nPoi riprova, hunter22 non va',
    'Ciao, password\nOk, grazie',
    'utente;password\nscusate, non so come fare',
    'Password,Manager\nBitwarden,gratis',
  ]) assert.equal(P.oscura(t), t, t);
  const t = 'utente;password;ruolo\nmario;hunter22;admin\nUna riga qualunque\nanna;gattino;ospite\n';
  const trovati = P.trova(t).map((x) => x.valore);
  assert.ok(trovati.includes('hunter22'));
  assert.ok(!trovati.includes('gattino'), 'dopo la riga che non è della tabella la colonna non vale più');
});

test('#2678: fra virgolette il valore esce come senza, con le virgolette intorno al segnaposto', () => {
  for (const [riga, atteso] of [
    ['il pin è «4821»', `il pin è «${S}»`], ['il pin è « 4821 »', `il pin è « ${S} »`], ["il PIN è '4821'", `il PIN è '${S}'`],
    ['CVV: «123»', `CVV: «${S}»`], ['il CVV è "123"', `il CVV è "${S}"`],
    ['Il codice del cancello è «4829»', `Il codice del cancello è «${S}»`], ['Inserisci il codice «615204»', `Inserisci il codice «${S}»`],
    ['Telegram code: “48291”', `Telegram code: “${S}”`], ['«482913» è il tuo codice', `«${S}» è il tuo codice`],
    ['password «Mela!Verde77», utente «mario»', `password «${S}», utente «mario»`], ["password 'Mela!Verde77'", `password '${S}'`],
    ['Password: “casa mia al mare”', `Password: “${S}”`], ['Password: «casa mia al mare»', `Password: «${S}»`],
    ['Password: "casa mia al mare".', `Password: "${S}".`],
  ]) assert.equal(P.oscura(riga), atteso, riga);
  for (const riga of ['Password: “vedi email”', 'Password: «disponibile alla reception»', 'Password: «min 8 caratteri»',
    'il pin è «sul retro»', 'Codice abbonamento: «4829»', 'Ordine «4829» confermato', 'password «manager»',
    'la password «deve avere otto caratteri»']) assert.equal(P.oscura(riga), riga);
});

test('#2678: fra virgolette il valore finisce alla virgoletta che chiude, qualunque forma lo introduca', () => {
  for (const [riga, atteso] of [
    ['Password: “casa mia al mare”, grazie', `Password: “${S}”, grazie`], ['Password: «casa mia al mare», grazie', `Password: «${S}», grazie`],
    ['password: “casa mia al mare” (non dirla)', `password: “${S}” (non dirla)`],
    ['la password è “casa mia al mare”', `la password è “${S}”`], ['la password è «casa mia al mare»', `la password è «${S}»`],
    ['Password: „casa mia al mare“', `Password: „${S}“`], ['Password: “casa mia al mare“', `Password: “${S}“`],
    ['password: « Mela!Verde77 »', `password: « ${S} »`], ['la password è « Mela!Verde77 »', `la password è « ${S} »`],
    ['parola d’ordine: “l’albero di casa”', `parola d’ordine: “${S}”`],
  ]) assert.equal(P.oscura(riga), atteso, riga);
  for (const riga of ['il film «Password» è bello', 'ho scritto la password «sbagliata»', 'la password «non funziona più»',
    'il campo password «Mostra»']) assert.equal(P.oscura(riga), riga);
});

test('#2678: la frase-password fra virgolette esce intera qualunque parola la apra, lunga e in ogni lingua', () => {
  const lunga = 'casa mia al mare sole vento pane luna fiume rosso verde blu notte giorno';
  for (const [riga, atteso] of [
    ['Password: “la casa al mare”', `Password: “${S}”`], ['Password: “il mio cane Fido”', `Password: “${S}”`],
    ['Password: "non ti scordar di me"', `Password: "${S}"`], ['password: «con te partirò», ciao', `password: «${S}», ciao`],
    ['Password: “the quick brown fox”', `Password: “${S}”`], ['Password: «la casa al mare 77!»', `Password: «${S}»`],
    ['la password è «in bocca al lupo»', `la password è «${S}»`], [`Password: “${lunga}”`, `Password: “${S}”`],
    ['Password: “precipitevolissimevolmente straordinariamente indubitabilmente bellissime”', `Password: “${S}”`],
    ['le mot de passe est «chat noir»', `le mot de passe est «${S}»`], ['Passwort ist „Hund Katze“', `Passwort ist „${S}“`],
    ['la contraseña es «perro azul»', `la contraseña es «${S}»`], ['password «la casa al mare 77!»', `password «${S}»`],
  ]) assert.equal(P.oscura(riga), atteso, riga);
  for (const riga of ['la password è «la stessa di prima»', 'la password è «quella del wifi»',
    'nel menu password «Gestisci account» non trovo niente', 'cerca la voce Password "Accesso e sicurezza"',
    'la password "Recupera accesso" non va']) assert.equal(P.oscura(riga), riga);
});

test('#2689: fra parentesi PIN, CVV e codici escono come senza, con le parentesi intorno al segnaposto', () => {
  for (const [riga, atteso] of [
    ['il PIN è (4821)', `il PIN è (${S})`], ['il PIN è («4821»)', `il PIN è («${S}»)`], ['il CVV è (123)', `il CVV è (${S})`],
    ['il codice è (482913)', `il codice è (${S})`], ['il PIN: (4821)', `il PIN: (${S})`], ['CVV (123)', `CVV (${S})`],
    ['il PIN è [4821]', `il PIN è [${S}]`], ['il CVV è [123]', `il CVV è [${S}]`], ['il codice è [482913]', `il codice è [${S}]`],
    ['il codice è ( 482913 )', `il codice è ( ${S} )`], ['il pin è ( « 4821 » )', `il pin è ( « ${S} » )`],
    ['Il PIN è "(4821)"', `Il PIN è "(${S})"`], ['il codice è («482913»).', `il codice è («${S}»).`],
    ['Il codice del cancello è (4829)', `Il codice del cancello è (${S})`], ['Inserisci il codice (615204)', `Inserisci il codice (${S})`],
    ['Telegram code: (48291)', `Telegram code: (${S})`], ['(482913) è il tuo codice', `(${S}) è il tuo codice`],
    ['Use (337164) to verify', `Use (${S}) to verify`], ['il PIN è (4821) e il CVV è (123)', `il PIN è (${S}) e il CVV è (${S})`],
  ]) assert.equal(P.oscura(riga), atteso, riga);
  for (const riga of ['Il codice cliente è (482913)', 'Codice prodotto (482913)', 'Il codice è (2024)', 'il PIN è (12)',
    'Il PIN (4 cifre) va scelto', 'if (pin < 1000) return', 'il CVV è (123/2)', 'Chiama (02) 4829 1736 per il codice',
    'nel 2024 (482913 utenti)']) assert.equal(P.oscura(riga), riga);
});

// #1403.5 — un'etichetta fuori dall'alfabeto latino annuncia la password come «Password:». Una per ogni alternativa
// della lista di campiSegreti.js, che vale per il testo e per i campi dei moduli.
const ETICHETTE_NON_LATINE = ['пароль', 'Пароль', 'ПАРОЛЬ', 'пароля', 'лозинка', 'κωδικός', 'ΚΩΔΙΚΟΣ',
  'Κωδικός πρόσβασης', 'ΚΩΔΙΚΟΣ ΠΡΟΣΒΑΣΗΣ', 'κωδικός εισόδου', 'Ο κωδικός μου', 'Νέος κωδικός', 'κωδικός Wi-Fi',
  'συνθηματικό', 'كلمة المرور', 'كلمة السر', 'رمز عبور', 'סיסמה', 'पासवर्ड', 'รหัสผ่าน', '密码', '密碼', '口令',
  'パスワード', '비밀번호', '암호', 'گذرواژه', 'پاس ورڈ', 'পাসওয়ার্ড', 'પાસવર્ડ', 'கடவுச்சொல்', 'పాస్‌వర్డ్', 'ಪಾಸ್‌ವರ್ಡ್',
  'പാസ്‌വേഡ്', 'මුරපදය', 'პაროლი', 'Գաղտնաբառ', 'የይለፍ ቃል', 'စကားဝှက်', 'ពាក្យសម្ងាត់', 'ລະຫັດຜ່ານ', 'Құпия сөз', 'Нууц үг', 'Сырсөз'];
// In greco «κωδικός» è anche il codice di qualunque cosa: postale, d'errore, d'ordine, del prodotto, del coupon.
const CODICI_GRECI = ['Ταχυδρομικός κωδικός', 'ΤΑΧΥΔΡΟΜΙΚΟΣ ΚΩΔΙΚΟΣ', 'κωδικός σφάλματος', 'κωδικός παραγγελίας',
  'κωδικός προϊόντος', 'Κωδικός ΑΦΜ', 'Κωδικός κουπονιού', 'Κωδικός πελάτη'];

test('l\'elenco delle etichette della password sta in un posto solo, per il testo e per i moduli', () => {
  const codice = (p) => readFileSync(new URL(`../../src/shared/${p}`, import.meta.url), 'utf8').split('\n')
    .filter((r) => !/^\s*\/\//.test(r)).join('\n');
  // «κωδικός ασφαλείας» è il nome greco del CVV (#2681), non un'etichetta della password: solo lui fa eccezione.
  const ETICHETTA = /парол|κωδικ(?![^\n]{0,12}?ασφαλ)|密[码碼]|wachtwoord|kennwort/;
  for (const t of ['κωδικός', 'κωδικός πρόσβασης', 'κωδικ(?:[ωώ]ν|[οό])']) assert.match(t, ETICHETTA, t);
  for (const t of ['κωδικός ασφαλείας', 'κωδικ[όο]ς\\\\s+ασφαλε[ίι]ας']) assert.doesNotMatch(t, ETICHETTA, t);
  assert.doesNotMatch(codice('pavimento.js'), ETICHETTA, 'il pavimento le prende da urlExfil.js');
  // #1403.19: i campi dei moduli ricevono le latine dal pavimento; le non latine stanno qui (ETICHETTE_NON_LATINE, #1403.8).
  assert.doesNotMatch(codice('campiSegreti.js'), /wachtwoord|has\[łl\]|chiave\\\\s|network\\\\s/, 'i campi le prendono dal pavimento');
});

// #2673.8: la regola «un indirizzo o un'email non è una password» la scrive solo il guardiano; il pavimento la chiede.
test('il controllo che riconosce un indirizzo o un\'email sta in un posto solo, per il pavimento e il guardiano', () => {
  const codice = (p) => readFileSync(new URL(`../../src/shared/${p}`, import.meta.url), 'utf8').split('\n')
    .filter((r) => !/^\s*\/\//.test(r)).join('\n');
  assert.doesNotMatch(codice('pavimento.js'), /\^www\\\.|\[\^@\\s\]\+@/, 'il pavimento lo prende da SN_GUARDIANO_STATICO.indirizzoOEmail');
  assert.equal(codice('guardianoStatico.js').split('[^@\\s]+@[^@\\s]+\\.[a-z]{2,}').length - 1, 1, 'nel guardiano una volta sola');
  const G = globalThis.SN_GUARDIANO_STATICO;
  for (const v of ['mario.rossi2@example.com', 'https://example.com/reset1', 'www.esempio2024.it']) {
    assert.ok(G.indirizzoOEmail(v) && !G.sembraPassword(v), v);
    assert.equal(P.oscura(`Recupero password:\n${v}`), `Recupero password:\n${v}`, v);
  }
  for (const v of ['Tr7#kq29Lm', 'Girasole2024']) {
    assert.ok(!G.indirizzoOEmail(v), v);
    assert.equal(P.oscura(`Recupero password:\n${v}`), `Recupero password:\n${S}`, v);
  }
});

test('un codice greco che non è la password arriva intero, e la password greca sulla riga sotto si copre', () => {
  for (const e of CODICI_GRECI) {
    for (const t of [`${e}: 10431`, `${e}: AB-1234x`]) assert.equal(P.oscura(t), t, t);
  }
  assert.equal(P.oscura('Κωδικός\nΚλειδί!2024'), `Κωδικός\n${S}`);
});

test('un\'etichetta della password in cirillico, greco, cinese e negli altri alfabeti non latini non fa uscire il valore', () => {
  for (const e of ETICHETTE_NON_LATINE) {
    for (const t of [`${e}: Ключ!Зима2024`, `${e}：Mima2024!`, `2026-11-20 12:00:01 INFO логин: ivan, ${e}: Ключ!Зима2024`, `${e}\nКлюч!Зима2024`]) {
      assert.ok(!P.oscura(t).includes('Ключ!Зима2024') && !P.oscura(t).includes('Mima2024'), t);
    }
  }
  assert.equal(P.oscura('пароль: Ключ!Зима2024'), `пароль: ${S}`, 'il separatore e l\'etichetta restano');
  assert.ok(!P.oscura('Подтверждение пароля: Ключ!Зима2024').includes('Ключ'), 'con altre parole davanti');
  assert.ok(!P.oscura('Κωδικός πρόσβασης: Κλειδί!2024').includes('Κλειδί'), 'con altre parole dopo l\'etichetta');
  assert.ok(!P.oscura('用户名：admin 登录密码：Mima2024!').includes('Mima2024'), 'attaccata alla parola davanti');
  assert.ok(!P.oscura('пароль Ключ!Зима2024').includes('Ключ'), 'senza i due punti, con la forma di una password');
});

test('un campo di modulo con un\'etichetta della password non latina tiene il valore lontano dai modelli', () => {
  require('../../src/shared/campiSegreti.js');
  const C = globalThis.SN_CAMPI_SEGRETI.crea({ document: { querySelectorAll: () => [], getElementById: () => null }, getComputedStyle: () => ({}) },
    () => false, { etichette: globalThis.SN_CAMPI_SEGRETI.etichette() });
  const campo = (etichetta) => ({ nodeType: 1, tagName: 'INPUT', value: 'x', type: 'text', labels: [],
    getAttribute: (a) => (a === 'aria-label' ? etichetta : null) });
  for (const e of ETICHETTE_NON_LATINE) assert.equal(C.campoSegreto(campo(e)), true, e);
  for (const e of ['Имя пользователя', 'Όνομα χρήστη', '用户名', '密码学', '암호화 방식', ...CODICI_GRECI]) {
    assert.equal(C.campoSegreto(campo(e)), false, e);
  }
});

test('intorno alle etichette non latine restano le parole, le spiegazioni e i nomi che le contengono', () => {
  for (const t of ['контрольная работа 2024', '2026-11-20 INFO пароль пользователя изменён', 'Неверный пароль для пользователя ivan',
    'Пароль: должен содержать не менее 8 символов', 'Пароль: неверный', 'Пароль: не задан', 'Κωδικός: λάθος',
    '密码学: 2024年课程', '암호화: AES256', 'Παράδειγμα κωδικοποίησης: UTF8', 'Password: deve avere almeno otto caratteri']) {
    assert.equal(P.oscura(t), t, t);
  }
});

// #1403.8 — come «la password è …», anche col verbo della sua lingua; il valore finisce dove ricomincia la frase.
test('dopo il verbo che annuncia la password nella sua lingua il valore non arriva al modello, e la frase intorno sì', () => {
  for (const [t, atteso] of [['我的密码是Kx82mPq9', `我的密码是${S}`], ['パスワードは Kx82mPq9', `パスワードは ${S}`],
    ['비밀번호는 Kx82mPq9', `비밀번호는 ${S}`], ['كلمة المرور هي Kx82mPq9', `كلمة المرور هي ${S}`],
    ['הסיסמה היא Kx82mPq9', `הסיסמה היא ${S}`], ['ο κωδικός πρόσβασης είναι Kx82mPq9', `ο κωδικός πρόσβασης είναι ${S}`],
    ['密码：Kx82mPq9，然后点击登录', `密码：${S}，然后点击登录`], ['密码是Kx82mPq9，记住它', `密码是${S}，记住它`]]) {
    assert.equal(P.oscura(t), atteso, t);
  }
});

test('la frase cinese, giapponese o coreana dopo l\'etichetta arriva al modello, e la ricerca che la contiene parte', () => {
  for (const t of ['请输入密码：密码长度至少8位，包含字母和数字。忘记密码？点击这里重置。', '登录帮助\n密码：注册时设置的6到16位字符',
    'パスワード：8文字以上で英数字を含めてください。', '비밀번호: 8자 이상, 영문과 숫자를 포함해야 합니다.']) {
    assert.equal(P.oscura(t), t, t);
  }
  for (const q of ['微信密码：忘了怎么找回', 'パスワード：忘れた場合', '비밀번호: 잊어버렸어요', 'пароль: забыл что делать']) {
    assert.deepEqual(P.trova(q), [], q);
  }
});

test('un testo lunghissimo senza spazi dopo l\'etichetta non ferma il pavimento', () => {
  const lungo = `密码：${'这是一段很长的说明文字。'.repeat(6000)}`;
  assert.equal(P.oscura(lungo), lungo);
  const valore = `x1${'ab'.repeat(40000)}`;
  assert.equal(P.oscura(`password: ${valore}`), `password: ${S}`);
});

test('l\'etichetta araba con «e», «con» o «per» attaccati non lascia la password al modello', () => {
  for (const t of ['اسم المستخدم: ahmed وكلمة المرور: Gatto2024!', 'بكلمة المرور: Gatto2024!', 'ولكلمة المرور هي Gatto2024!']) {
    assert.ok(!P.oscura(t).includes('Gatto2024'), t);
  }
});

// #1403.6: il verbo e il nome della password nelle altre lingue, anche senza spazi (cinese, giapponese, coreano).
test('la password annunciata da un verbo non esce in nessuna lingua, e il resto della frase resta', () => {
  for (const [riga, v, resto] of [
    ['Le mot de passe est Mela!Verde77', 'Mela!Verde77', 'Le mot de passe est '],
    ['Das Passwort ist Mela!Verde77', 'Mela!Verde77', 'Das Passwort ist '],
    ['Das WLAN-Passwort lautet Mela!Verde77', 'Mela!Verde77', 'lautet '],
    ['la contraseña es Mela!Verde77', 'Mela!Verde77', 'la contraseña es '],
    ['A senha do wifi é Mela!Verde77', 'Mela!Verde77', 'A senha do wifi é '],
    ['Hasło do wifi to Mela!Verde77', 'Mela!Verde77', 'Hasło do wifi to '],
    ['Le mot de passe du wifi est 12345678', '12345678', 'du wifi est '],
    ['пароль это Ключ!Зима2024', 'Ключ!Зима2024', 'пароль это '],
    ['вход с паролем Ключ!Зима2024', 'Ключ!Зима2024', 'вход с паролем '],
    ['Пароли:\nКлюч!Зима2024', 'Ключ!Зима2024', 'Пароли:'],
    ['Пароль: зима', 'зима', 'Пароль: '],
    ['ο κωδικός είναι Κλειδί!2024', 'Κλειδί!2024', 'ο κωδικός είναι '],
    ['WiFi密码是12345678', '12345678', 'WiFi密码是'],
    ['密码为Mima2024!', 'Mima2024!', '密码为'],
    ['密码：Mima2024!', 'Mima2024!', '密码：'],
    ['パスワードはPass2024!です', 'Pass2024!', 'です'],
    ['비밀번호는 Pass2024!', 'Pass2024!', '비밀번호는 '],
    ['Der PIN ist 4821', '4821', 'Der PIN ist '],
    ['Le CVV est 123', '123', 'Le CVV est '],
    ['El CVV es 123', '123', 'El CVV es '],
    ["le mot de passe c'est Mela!Verde77", 'Mela!Verde77', "c'est "],
    ["le mot de passe du wifi, c'est Mela!Verde77", 'Mela!Verde77', "wifi, c'est "],
    ['пароль был Ключ!Зима2024', 'Ключ!Зима2024', 'пароль был '],
    ['паролем является Ключ!Зима2024', 'Ключ!Зима2024', 'паролем является '],
    ['密码是：Mima2024!', 'Mima2024!', '密码是：'],
    ['パスワードは、Pass2024!です', 'Pass2024!', 'です'],
    ['パスワードは：Pass2024!です', 'Pass2024!', 'パスワードは：'],
  ]) {
    const t = P.oscura(riga);
    assert.ok(!t.includes(v), riga);
    assert.ok(t.includes(S) && t.includes(resto), `${riga} → ${t}`);
  }
});

test('nelle altre lingue la frase che nomina la password senza darla resta com\'è', () => {
  for (const t of [
    'Le mot de passe est trop court', 'Das Passwort ist falsch', 'la contraseña es incorrecta', 'Hasło jest łatwe',
    'пароль это важно', 'ο κωδικός είναι λάθος', '密码是什么？', 'パスワードは忘れました', '비밀번호는 무엇입니까?',
    'パスワードマネージャー: 1Password', 'Send the password to bob@mail.com',
    "le mot de passe c'est important", 'пароль был неверный', '密码是：必填项', 'Le CVV est obligatoire',
  ]) assert.equal(P.oscura(t), t, t);
});

// Il pavimento gira a ogni chiamata a un modello nel processo principale: un testo lungo che ripete l'etichetta non lo
// deve fermare. Oggi costa 2-5 unità, col flag u sulle regex delle etichette ne costava 90-250. Il russo lungo è lento
// anche su main, per un'altra causa: lo tiene #1403.111.
test('un testo di 120.000 caratteri che ripete l\'etichetta si controlla in fretta', () => {
  for (const pezzo of ['비밀번호는 뭐예요 비밀번호는 ', 'mot de passe est' + ' '.repeat(200)]) {
    const s = pezzo.repeat(Math.ceil(120000 / pezzo.length));
    const c = costoInUnita(() => P.oscura(s), { tetto: 30 });
    assert.ok(c.entro, `${pezzo.slice(0, 12)}: ${c.come}`);
  }
});
