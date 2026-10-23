// #1589 — il pavimento: password, carte e CVV, codici usa e getta, chiavi e token (anche in un indirizzo) non arrivano a
// nessun modello, a nessun livello. L'IBAN e il testo qualunque restano com'erano.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

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
    'Il mio token di Telegram bot: 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw': 'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
    'Recovery codes\nKeep these somewhere safe.\n\n3f9a1-b2c7d\n8e4d0-a6f15\nc1b7e-90d2a\n77d3f-1e0b9\n4a2b1-9c8d7\n0e1f2-3a4b5\nDownload': '0e1f2-3a4b5',
  };
  for (const [t, s] of Object.entries(segreti)) assert.ok(!P.oscura(t).includes(s), t);
  for (const t of ['docker run -u 1000:1000 -p 8080:80 nginx', 'ssh -l mario -p 2222 host.example.com', 'mysql -u root -p mydb',
    'mkdir -p dir2 && cp -a src2 dst', 'https://github.com/x/y/settings/hooks/12345678']) assert.equal(P.oscura(t), t, t);
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
