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
    nascosto('gattonero', richiesta, 'gattonero', richiesta);
  }
});

test('#2638: il solo nome della password in fondo alla frase è una richiesta, anche per una risposta di sole lettere', () => {
  for (const richiesta of [
    'Marco: password del wifi',
    'Marco: sono arrivato. password del wifi',
    'Marco: sono arrivato, la password del wifi 🙏',
    'Marco: sono qui, pw di casa',
    'Marco: sono qui - la pass del wifi',
    'Marco: arrived, wifi password',
    'sono arrivato, password del wifi',
  ]) {
    nascosto('gattonero', richiesta, 'gattonero', richiesta);
    nascosto('certo, gattonero', `Anna: ciao!\n${richiesta}`, 'gattonero', richiesta);
  }
  nascosto('4821', 'Marco: sono al portone, codice del cancello', '4821', 'codice');
  // Il nome dentro una frase che dice altro non chiede niente: la risposta di sole lettere parte.
  for (const sopra of [
    'Marco: la password del wifi è cambiata',
    'Marco: grazie per la password del wifi',
    'Marco: nuova password del wifi',
    'Marco: cose da fare: chiamare Luca, password del wifi, spesa',
  ]) assert.equal(alModello('figurati, a stasera', sopra).nuovo, 'figurati, a stasera', sopra);
});

// Il filtro delle pagine verso i modelli e il correttore leggono la richiesta corta dallo stesso posto: tutti e due
// tolgono la password data sotto, e tutti e due lasciano le righe sotto chi la nomina e basta.
const pavimento = () => {
  globalThis.self = globalThis;
  require('../../src/shared/novita.js');
  return require('../../src/shared/pavimento.js');
};

test('#2638.1: un aggettivo dopo il nome della password non fa una richiesta', () => {
  const P = pavimento();
  for (const [sopra, campo] of [
    ['Marco: password dimenticata', 'nessun problema te la rimando stasera'],
    ['Marco: sono arrivato, password diversa', 'strano controlla meglio'],
    ['Marco: password persa', 'nessun problema domani'],
    ['Marco: password perfetta', 'grazie mille davvero'],
    ['Marco: password definitiva', 'nessun problema te la rimando stasera'],
  ]) {
    assert.equal(alModello(campo, sopra).nuovo, campo, sopra);
    const pagina = `${sopra}\nIo: ci vediamo alle 18:30 al bar`;
    assert.equal(P.oscura(pagina), pagina, `pavimento: ${sopra}`);
  }
  // Con la preposizione staccata resta la richiesta: «di casa», «dell'ufficio», «per il router».
  for (const sopra of ['Marco: password di casa', "Marco: sono qui, password dell'ufficio", 'Marco: password per il router']) {
    nascosto('gattonero', sopra, 'gattonero', sopra);
  }
});

test('#2638.1: il solo nome della password su una riga è un\'etichetta, non una richiesta', () => {
  const P = pavimento();
  for (const p of [
    'Sicurezza\nPassword\nUltima modifica il 12/03/2024\nVerifica in due passaggi',
    'Impostazioni router\nPassword del wifi\nModello AX1800-Pro, firmware 3.2.1',
    'Accedi\nEmail\nPassword\nProblemi? Chiama il 800-123-456',
  ]) {
    assert.equal(P.oscura(p), p, p);
    assert.equal(R.oscura(p), p, p);
  }
  for (const sopra of ['Sicurezza\nPassword', 'Impostazioni router\nPassword del wifi']) {
    assert.equal(alModello('ultima modifica tre mesi fa', sopra).nuovo, 'ultima modifica tre mesi fa', sopra);
  }
  // Con chi parla davanti, o un'altra frase sulla stessa riga, resta la richiesta.
  for (const sopra of ['Marco: password', 'sono arrivato, password', 'Marco: sono arrivato. password del wifi']) {
    nascosto('gattonero', sopra, 'gattonero', sopra);
  }
});

test('#2638.1: ogni saluto che apre la risposta vale anche prima della richiesta corta', () => {
  for (const saluto of ['ciao', 'ciaooo', 'ehi', 'ehilà', 'hey', 'hi', 'hello', 'salve', 'buongiorno', 'buonasera']) {
    const sopra = `Marco: ${saluto} password del wifi`;
    nascosto('gattonero', sopra, 'gattonero', sopra);
    // Il saluto in testa alla risposta non è la password, e la password dopo sì.
    const p = nascosto(`${saluto} Marco! gattonero`, 'Marco: mi mandi la password del wifi?', 'gattonero', saluto);
    assert.ok(p.nuovo.startsWith(`${saluto} Marco!`), `${saluto}: ${p.nuovo}`);
  }
});

test('#2638.1: il filtro delle pagine toglie la password data sotto la richiesta corta', () => {
  const P = pavimento();
  for (const pagina of [
    'Marco: sono arrivato, password del wifi\nIo: Gatto2024',
    'Marco: pw di casa\nGatto2024',
    'Marco: ciao, password del wifi\nAnna: Gatto2024 con la G maiuscola',
  ]) assert.ok(!P.oscura(pagina).includes('Gatto2024'), pagina);
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
// Oggi costa circa 300 unità su Linux e sopra 400 sul Windows del cancello (i refusi letti come il nome, #2678.21), la
// versione quadratica circa tremila: il tetto sta fra le due.
test('un testo lunghissimo che ripete la parola password senza punti si legge in fretta', () => {
  const c = costoInUnita(() => R.oscura('pasword passowrd password '.repeat(12000)), { tetto: 1000 });
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

// Le pagine di chat non mettono nomi: una riga «Parola: …» può essere un «PS:», un orario o un altro del gruppo.
test('#1723: un altro del gruppo, un «PS:» o un sollecito che rinomina la password non sciolgono il legame', () => {
  for (const sopra of [
    'Marco: mi mandi la password del wifi?\nLuca: anche a me serve!',
    'Marco: mi mandi la password del wifi?\nIndirizzo: via Roma 5',
    'mi mandi la password del wifi?\n18:01\nPS: porta il vino\n18:02',
    'mi mandi la password del wifi?\nOre 20: cena da me',
  ]) nascosto('Gatto2024', sopra, 'Gatto2024', sopra);
  nascosto('gattonero', 'Marco: mi mandi la password del wifi?\nMarco: dai la password', 'gattonero', 'sollecito che rinomina');
});

test('#1723: «era» e «sarebbe» annunciano il dato anche in fondo a una risposta lunga', () => {
  for (const a of ['era', 'sarebbe']) {
    const t = `certo aspetta che vado a vedere sul router perché non me la ricordo mai, ${a} gattonero`;
    nascosto(t, 'Marco: mi mandi la password del wifi?', 'gattonero', t);
  }
});

test('#1723: le varianti delle forme libere non lasciano passare la password', () => {
  for (const [t, v] of [
    ['Login: mario / Girasole2024', 'Girasole2024'],
    ['Account: mario / Girasole2024', 'Girasole2024'],
    ['Credenziali: mario - Girasole2024', 'Girasole2024'],
    ['Utente / Parola chiave: mario / Girasole2024', 'Girasole2024'],
    ['Username / Pasword: mario / Girasole2024', 'Girasole2024'],
    ['WiFi CasaRossi - Faro7Blu55', 'Faro7Blu55'],
    ['Rete: CasaRossi - Faro7Blu55', 'Faro7Blu55'],
    ['Wi-Fi: CasaRossi, Faro7Blu55', 'Faro7Blu55'],
    ['per la password su whatsapp, è Girasole2024', 'Girasole2024'],
  ]) nascosto(t, '', v, t);
  for (const t of ['il wifi non va, AX1800 è il router', 'poi, è Office365 che non va']) assert.equal(alModello(t).nuovo, t);
});

// Un'etichetta di rete ripetuta su una riga rileggeva la riga da capo a ogni volta: 48 mila caratteri erano più di cento
// unità, su main meno di una.
test('#1723: un campo lungo con tante etichette di rete su una riga si legge in fretta', () => {
  for (const t of ['wifi: '.repeat(8000), 'ssid: a '.repeat(6000), 'wifi: a - '.repeat(5000)]) {
    const c = costoInUnita(() => R.oscura(t), { tetto: 20 });
    assert.ok(c.entro, `${t.slice(0, 10)}: ${c.come}`);
  }
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

test('#1723.1: con la risposta già data sopra, in una frase o di sole lettere, il messaggio dopo parte intero', () => {
  for (const data of [
    'è Gatto2024 con la G maiuscola', 'certo, la password è Gatto2024 ma non dirla in giro', 'Gatto2024 (con la G maiuscola)',
    'la password è gattonero', 'eccola: gattonero', 'è gattonero tutto minuscolo', 'la pass del wifi risulta gattonero',
  ]) {
    const sopra = `mi mandi la password del wifi?\n${data}\ngrazie! a che ora ci vediamo?`;
    assert.equal(alModello('alle venti davanti al cinema', sopra).nuovo, 'alle venti davanti al cinema', data);
    assert.equal(alModello('alle 20:30, il 2024 è stato un anno lungo', sopra).nuovo, 'alle 20:30, il 2024 è stato un anno lungo', data);
    // Una password corretta dopo la prima resta un dato.
    nascosto('scusa, ho sbagliato: è Gatto2025', sopra, 'Gatto2025', `correzione sotto «${data}»`);
  }
  const conNomi = 'Marco: mi mandi la password del wifi?\nAnna: eccola: gattonero\nMarco: grazie';
  assert.equal(alModello('alle venti davanti al cinema', conNomi).nuovo, 'alle venti davanti al cinema');
});

// Senza nomi un sollecito ha la forma di una risposta di sole lettere: chiude solo se sotto è arrivato altro.
test('#1723.1: un sollecito di chi ha chiesto non chiude il legame, nemmeno se somiglia a una risposta', () => {
  for (const sopra of [
    'mi mandi la password del wifi?\nsono arrivato', 'mi mandi la password del wifi?\nè urgente',
    'Marco: mi mandi la password del wifi?\nMarco: sono arrivato\nMarco: è urgente', 'Marco: mi mandi la password del wifi?\nMarco: eccomi: sono sotto',
    'mi mandi la password?\ngattonero\nla password è sbagliata', 'Marco: mi mandi la password del wifi?\nMarco: è Gatto2024?',
  ]) nascosto('gattobianco', sopra, 'gattobianco', sopra);
});

test('#1723.1: «pass» come etichetta, coi due punti o accanto al nome utente, e «le credenziali sono» tolgono la password', () => {
  for (const [t, v] of [
    ['Pass: Girasole2024', 'Girasole2024'], ['User: mario / Pass: Girasole2024', 'Girasole2024'],
    ['User: mario\nPass: Girasole2024', 'Girasole2024'], ['utente: mario pass: Girasole2024', 'Girasole2024'],
    ['user mario pass Girasole2024', 'Girasole2024'], ['Wi-Fi CasaRossi pass Faro7Blu55', 'Faro7Blu55'],
    ['Le credenziali sono: mario / Girasole2024', 'Girasole2024'], ['Le mie credenziali sono mario@gmail.com / Girasole2024', 'Girasole2024'],
  ]) {
    nascosto(t, '', v, t);
    assert.equal(R.oscura(t), t.replace(v, S), t);
  }
  // Le forme sono le stesse per il pavimento, che le prende dallo stesso posto.
  globalThis.self = globalThis;
  const P = require('../../src/shared/pavimento.js');
  for (const t of ['User: mario / Pass: Girasole2024', 'Le credenziali sono: mario / Girasole2024']) assert.ok(!P.oscura(t).includes('Girasole2024'), `pavimento: ${t}`);
  for (const t of ['il pass, è bellissimo', 'la pass giornaliera', 'il pass del concerto costa 50', 'pass: costa 10 euro',
    'I need to pass the exam', 'il green pass 2021 è scaduto', 'ho comprato il passaporto AB1234567']) {
    assert.equal(alModello(t).nuovo, t, t);
  }
});

test('#1723.1: dopo la frase della password la risposta perde una seconda password, non un orario o un numero', () => {
  const S0 = 'Marco: mi mandi la password del wifi?';
  for (const [t, atteso] of [
    ["Gatto2024. Anzi no, l'ho cambiata: Gatto2025", `${S}. Anzi no, l'ho cambiata: ${S}`],
    ['Gatto2024. Se non va prova Pesca7Mela', `${S}. Se non va prova ${S}`],
    ['Gatto2024\nse non va prova Pesca7Mela', `${S}\nse non va prova ${S}`],
    ['Gatto2024. Ci vediamo alle 20:30 al bar, il treno è il 9542', `${S}. Ci vediamo alle 20:30 al bar, il treno è il 9542`],
    ['Gatto2024. Domani faccio il check-in online', `${S}. Domani faccio il check-in online`],
  ]) assert.equal(alModello(t, S0).nuovo, atteso, t);
});

// Le parole che annunciano il dato dopo un'etichetta sono un elenco solo: il correttore e il filtro delle pagine le
// riconoscono tutte e due, e uno nuovo vale per entrambi.
test('#1723.1: correttore e filtro delle pagine riconoscono le stesse parole che annunciano la password', () => {
  const G = globalThis.SN_GUARDIANO_STATICO;
  assert.ok(G.ANNUNCI.length >= 10);
  for (const a of G.ANNUNCI) {
    nascosto(`la pass del wifi ${a} gattonero`, '', 'gattonero', a);
    nascosto(`pw ${a} gattonero`, '', 'gattonero', a);
    assert.ok(G.segretiNelTesto(`La password ${a} Tr7#kq29Lm`).some((s) => s.valore === 'Tr7#kq29Lm'), `pagine: ${a}`);
  }
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

const Q = 'Marco: mi mandi la password del wifi?';

test('#1723.1: la risposta con la password e una domanda o una seconda frase chiude il legame', () => {
  for (const risposta of ['Gatto2024. Tu a che ora arrivi?', 'la password è gattonero, tu quando arrivi?',
    'eccola: gattonero. funziona?', 'sì: Gatto2024 ma te la cambio stasera, ok?']) {
    const sopra = `${Q}\n${risposta}\nMarco: grazie! a che ora ci vediamo?`;
    assert.equal(alModello('alle venti davanti al cinema', sopra).nuovo, 'alle venti davanti al cinema', risposta);
  }
  // Una domanda che contiene il valore non è la risposta.
  nascosto('no, è gattobianco', `${Q}\nla password è gattonero?\nsì`, 'gattobianco', 'conferma chiesta');
});

test('#1723.1: un «non va» dopo la risposta riapre il legame, e un sollecito in due righe non lo chiude', () => {
  for (const [sopra, campo] of [
    [`${Q}\nè gattonero\nMarco: non va`, 'scusa, è gattobianco'],
    [`${Q}\nla password è gattonero\nMarco: non funziona, sicuro?`, 'scusa, era gattobianco'],
    ['mi mandi la password del wifi?\nsono arrivato\nè urgente', 'gattobianco'],
    ['mi mandi la password del wifi?\nè urgente\ndai', 'gattobianco'],
    ['mi mandi la password del wifi?\nsono sotto casa\nsbrigati', 'gattobianco'],
  ]) nascosto(campo, sopra, 'gattobianco', sopra);
  // Dopo la correzione e un grazie il legame si richiude.
  const sopra = 'mi mandi la password del wifi?\nè gattonero\nnon va\nscusa, è gattobianco\ngrazie, ora funziona';
  assert.equal(alModello('alle venti davanti al cinema', sopra).nuovo, 'alle venti davanti al cinema');
});

test('#1723.1: dopo «pw» e «la pass» un avverbio o un verbo di cambio presentano la password come dopo «password»', () => {
  for (const t of ['pw ora è gattonero', 'la pass ora è gattonero', 'la pass del wifi adesso è gattonero', 'pw diventa gattonero',
    'pw resta gattonero', 'la password ora è gattonero']) {
    const p = nascosto(t, '', 'gattonero', t);
    assert.equal(p.nuovo, t.replace('gattonero', S), t);
  }
});

test('#1723.1: le credenziali senza la barra e i trattini valgono come nella risposta in chat', () => {
  for (const t of ['Credenziali: mario Girasole2024', 'le credenziali sono mario Girasole2024']) nascosto(t, '', 'Girasole2024', t);
  for (const t of ['Le credenziali sono scadute ieri', 'Pass: check-in', 'pass self-service']) assert.equal(alModello(t).nuovo, t, t);
});

test('#1723.1: oltre le prime parole della risposta «sono», «vale», «risulta» non presentano una password', () => {
  for (const [t, parola] of [
    ['certo, te la mando subito appena arrivo a casa stasera perché adesso non la ricordo, comunque sono stanco morto', 'stanco'],
    ['certo, te la mando subito appena arrivo a casa stasera perché adesso non la ricordo. Il prezzo vale poco, risulta strano', 'strano'],
  ]) assert.ok(alModello(t, 'mi mandi la password?').nuovo.includes(parola), t);
});
