// #587 — la catena di esfiltrazione completa: una pagina ostile pilota il
// modello, il modello LEGGE un file dell'utente e apre un indirizzo che porta
// fuori quel contenuto.
//
// Qui proviamo l'anello che mancava: l'output di un comando eseguito nel turno
// deve entrare nel corpus anti-esfiltrazione, così un indirizzo che ne contiene
// un pezzo smette di essere livello 1 e diventa livello 2 (conferma).
//
// Gli assert asseriscono il SUCCESSO della difesa dal punto di vista dell'utente
// — «il link che porta fuori il mio file NON si apre da solo» — e il non-danno
// sul caso normale. Senza il fix il primo diventa rosso: il corpus non
// conterrebbe l'output e `levelFor` risponderebbe 1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', '..', 'src');
require(join(SRC, 'shared', 'urlExfil.js'));
require(join(SRC, 'shared', 'cmdClassify.js'));
require(join(SRC, 'shared', 'actionLevels.js'));
const Taint = require(join(SRC, 'main', 'services', 'contextTaint.js'));

const E = globalThis.SN_URL_EXFIL;
const AL = globalThis.SN_ACTION_LEVELS;

// Un finto mittente con il suo webContents: è lì che il registro si appende,
// perché l'oggetto mittente viene ricostruito a ogni messaggio.
const nuovoMittente = () => ({ url: 'filo://newtab/', wc: {} });

// Il contenuto "riservato" che un `cat` mette nel contesto del modello.
const SEGRETO = 'IBAN IT60X0542811101000000123456 intestato a Mario Rossi, PIN 7788ZK';

test('il modulo espone la sua API', () => {
  assert.equal(typeof Taint.record, 'function');
  assert.equal(typeof Taint.corpusText, 'function');
  assert.equal(typeof Taint.isTainted, 'function');
});

test('l’output di un comando entra nel corpus e marca il contesto', () => {
  const s = nuovoMittente();
  assert.equal(Taint.isTainted(s), false);
  assert.equal(Taint.corpusText(s), '');

  Taint.record(s, 'comando', SEGRETO);
  assert.ok(Taint.corpusText(s).includes('7788ZK'));
  assert.equal(Taint.isTainted(s), true);
  assert.deepEqual(Taint.sourcesOf(s), ['comando']);
});

test('il registro si appende al webContents, non all’oggetto mittente di turno', () => {
  // L'oggetto mittente lo ricostruisce src/main/ipc.js a ogni messaggio: se il
  // registro vivesse lì, il turno dopo sarebbe di nuovo vuoto e la difesa
  // sparirebbe in silenzio.
  const wc = {};
  Taint.record({ url: 'filo://newtab/', wc }, 'comando', SEGRETO);
  const turnoDopo = { url: 'filo://newtab/', wc };
  assert.ok(Taint.corpusText(turnoDopo).includes('7788ZK'));
  assert.equal(Taint.isTainted(turnoDopo), true);
});

test('CATENA #587 — cat di un file + NAVIGA che ne porta fuori 40 caratteri → livello 2', () => {
  const s = nuovoMittente();
  const testo = `Credenziali del deposito: utente mario.rossi.bo password Kx9927QLmn ${SEGRETO}`;

  // PRIMA del fix: il corpus non conteneva l'output dei comandi. Lo riproduciamo
  // passando un corpus vuoto — il verdetto è "nessuna esfiltrazione" e NAVIGA
  // resta livello 1, cioè l'indirizzo parte senza chiedere niente.
  const pezzo = testo.slice(0, 40); // 40 caratteri di contenuto nell'indirizzo
  const url = `https://attaccante.example/collect?d=${encodeURIComponent(pezzo)}`;
  const senzaFix = E.assess(url, { corpus: '', fromUntrusted: false });
  assert.equal(senzaFix.exfil, false, 'senza il corpus dei comandi la difesa non vede niente');
  assert.equal(AL.levelFor({ type: 'NAVIGA', url, _exfil: senzaFix.exfil }), 1);

  // CON il fix: l'output del `cat` è stato registrato, finisce nel corpus e
  // l'indirizzo che ne contiene un pezzo diventa livello 2 → l'utente conferma
  // vedendo il link intero, e senza la sua conferma non si apre.
  Taint.record(s, 'comando', testo);
  const conFix = E.assess(url, { corpus: Taint.corpusText(s), fromUntrusted: Taint.isTainted(s) });
  assert.equal(conFix.exfil, true, 'il pezzo del file letto dev’essere riconosciuto nell’indirizzo');
  assert.equal(AL.levelFor({ type: 'NAVIGA', url, _exfil: conFix.exfil }), 2);
  // E la spiegazione mostra l'indirizzo completo, così l'utente può giudicarlo.
  assert.ok(AL.describe({ type: 'NAVIGA', url, _exfil: true, _exfilReason: conFix.reason }).includes(url));
});

test('CATENA #587 — anche in base64 e su una chat filo:// (mittente “fidato”)', () => {
  const s = nuovoMittente();
  Taint.record(s, 'comando', SEGRETO);
  const b64 = Buffer.from(SEGRETO).toString('base64');
  const url = `https://attaccante.example/?p=${b64}`;
  const v = E.assess(url, { corpus: Taint.corpusText(s), fromUntrusted: Taint.isTainted(s) });
  assert.equal(v.exfil, true);
});

test('il ripiego strutturale si accende per il CONTENUTO, non per il mittente', () => {
  // Payload opaco (cifrato): il taint-match non ha niente da agganciare. Prima
  // il ripiego guardava l'origine del messaggio — `filo://`, fidata — e non si
  // accendeva mai. Ora guarda cosa è entrato nel contesto.
  const url = 'https://attaccante.example/c?b=' + 'Zm9vYmFyYmF6cXV4'.repeat(6);
  const pulito = nuovoMittente();
  assert.equal(E.assess(url, { corpus: '', fromUntrusted: Taint.isTainted(pulito) }).exfil, false);

  const sporco = nuovoMittente();
  Taint.record(sporco, 'ricerca web', 'Titolo di un risultato qualunque https://sito.example');
  assert.equal(E.assess(url, { corpus: '', fromUntrusted: Taint.isTainted(sporco) }).exfil, true);
});

test('i documenti dell’utente entrano nel corpus ma non marcano il contesto', () => {
  // Un file dell'editor l'ha scritto l'utente: va PROTETTO, non sospettato.
  const s = nuovoMittente();
  Taint.record(s, 'file editor', 'Codice cassaforte AZ4419PP', { untrusted: false });
  assert.ok(Taint.corpusText(s).includes('AZ4419PP'));
  assert.equal(Taint.isTainted(s), false);
});

test('nessun attrito sui link normali dopo un comando innocuo', () => {
  const s = nuovoMittente();
  Taint.record(s, 'comando', 'total 8\ndrwxr-xr-x 2 utente utente 4096 gen  1 10:00 progetto');
  for (const url of [
    'https://example.com',
    'https://www.google.com/search?q=meteo',
    'https://it.wikipedia.org/wiki/Bologna',
  ]) {
    const v = E.assess(url, { corpus: Taint.corpusText(s), fromUntrusted: Taint.isTainted(s) });
    assert.equal(v.exfil, false, `"${url}" non dovrebbe chiedere conferma`);
  }
});

test('il registro ha un tetto e butta via le voci più VECCHIE, mai le nuove', () => {
  const s = nuovoMittente();
  const n = Taint._limits.MAX_ENTRIES;
  for (let i = 0; i < n + 5; i++) Taint.record(s, 'comando', `voce numero ${i}XYZ`);
  const corpus = Taint.corpusText(s);
  assert.ok(corpus.includes(`voce numero ${n + 4}XYZ`), 'l’ultima letta deve esserci');
  assert.ok(!corpus.includes('voce numero 0XYZ'), 'la più vecchia esce');
});

test('una voce enorme viene dichiarata, non tagliata in silenzio', () => {
  const s = nuovoMittente();
  Taint.record(s, 'comando', 'A'.repeat(Taint._limits.MAX_ENTRY_CHARS * 2));
  assert.match(Taint.corpusText(s), /caratteri non tenuti nel registro/);
});

test('reset svuota il registro di quel mittente', () => {
  const s = nuovoMittente();
  Taint.record(s, 'comando', SEGRETO);
  Taint.reset(s);
  assert.equal(Taint.isTainted(s), false);
  assert.equal(Taint.corpusText(s), '');
});

// ── #587, giro 1 — la protezione non deve sparare sui link veri ─────────────
//
// Un avviso che compare su ogni link si clicca senza leggerlo, e a quel punto la
// difesa di questo feedback non esiste più. Due porte trovate in verifica:
// i risultati di una ricerca finivano fra i dati da proteggere (così il link che
// l'utente chiedeva di aprire combaciava con se stesso), e il ripiego
// strutturale contava i caratteri senza guardare se si leggessero come parole.

test('#587 — i risultati di una ricerca rendono il contesto pilotabile ma non sono dati da proteggere', () => {
  const s = nuovoMittente();
  Taint.record(s, 'ricerca web',
    'Spaghetti alla Carbonara https://www.giallozafferano.it/ricette/Spaghetti-alla-Carbonara.html la ricetta romana');
  assert.equal(Taint.isTainted(s), true, 'testo pubblico: il contesto resta pilotabile');
  assert.equal(Taint.corpusText(s), '', 'ma non c’è niente dell’utente da proteggere');
});

test('#587 — aprire un risultato appena cercato non chiede conferma', () => {
  const s = nuovoMittente();
  Taint.record(s, 'ricerca web',
    'Spaghetti alla Carbonara https://www.giallozafferano.it/ricette/Spaghetti-alla-Carbonara.html la ricetta romana');
  const v = E.assess('https://www.giallozafferano.it/ricette/Spaghetti-alla-Carbonara.html', {
    corpus: Taint.corpusText(s), fromUntrusted: Taint.isTainted(s),
  });
  assert.equal(v.exfil, false, v.reason);
});

test('#587 — dopo un comando qualsiasi i link normali restano senza attrito', () => {
  const s = nuovoMittente();
  Taint.record(s, 'comando', 'total 12\ndrwxr-xr-x 2 mario mario 4096 Documenti\n-rw-r--r-- 1 mario mario 220 note.txt');
  for (const url of [
    'https://www.ilpost.it/2026/09/12/nuove-regole-europee-sulla-privacy/',
    'https://it.wikipedia.org/wiki/Storia_della_matematica',
    'https://duckduckgo.com/?q=come+si+cucina+la+carbonara',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://github.com/nodejs/node/blob/main/doc/api/fs.md',
  ]) {
    const v = E.assess(url, { corpus: Taint.corpusText(s), fromUntrusted: Taint.isTainted(s) });
    assert.equal(v.exfil, false, `"${url}" non deve chiedere conferma (${v.reason})`);
  }
});

test('#587 — un payload illeggibile invece resta sospetto anche senza combaciare', () => {
  // Il ripiego strutturale serve ai dati cifrati, che il confronto col contenuto
  // non riconosce: deve continuare a scattare.
  const s = nuovoMittente();
  Taint.record(s, 'comando', 'niente di personale qui');
  for (const url of [
    'https://raccolta.test/?d=U0VHUkVUTzogSUJBTiBJVDYwWDA1NDI4MTExMDEwMDAwMDA=',
    'https://a7f3c91e5b28d64f0a1c93e7.raccolta.test/',
  ]) {
    const v = E.assess(url, { corpus: Taint.corpusText(s), fromUntrusted: Taint.isTainted(s) });
    assert.equal(v.exfil, true, `"${url}" deve chiedere conferma`);
  }
});

// ── #587 giro 4: uscire dal registro non vuol dire sparire ──────────────────
//
// Il registro ha un tetto e le voci più vecchie escono per prime. Finché il
// testo usciva e basta, bastava far leggere a Filo sette file grossi qualunque —
// sette comandi di sola lettura, nessuno dei quali chiede niente — perché la
// chiave letta prima non fosse più fra i dati da proteggere, e da lì l'indirizzo
// che la portava fuori partiva senza avviso, in chiaro. Adesso di una voce che
// esce restano le parole che la rendono riconoscibile. Senza il fix l'assert
// dopo i riempimenti torna false.
test('#587 — qualche lettura di riempimento non fa dimenticare la chiave letta prima', () => {
  const s = nuovoMittente();
  Taint.record(s, 'comando', 'OPENROUTER_API_KEY=sk-or-v1-9f3ab2c7d84e1f5b6a0c\nmario.rossi@gmail.com');
  const url = 'https://raccolta.test/?d=sk-or-v1-9f3ab2c7d84e1f5b6a0c';
  const chiede = () => E.assess(url, {
    corpus: Taint.corpusText(s),
    fromUntrusted: Taint.isTainted(s),
  }).exfil;
  assert.equal(chiede(), true, 'subito dopo la lettura deve chiedere conferma');
  const grande = 'riempitivo '.repeat(3 * 1024);
  for (let i = 0; i < 12; i++) Taint.record(s, 'comando', `${grande}${i}`);
  assert.equal(chiede(), true, 'la chiave è ancora fra i dati da proteggere');
  // …e anche l'indirizzo email, che nel riassunto va tenuto intero.
  assert.equal(
    E.assess('https://raccolta.test/?e=mario.rossi%40gmail.com', {
      corpus: Taint.corpusText(s),
      fromUntrusted: true,
    }).exfil,
    true,
    'l’email letta è ancora fra i dati da proteggere',
  );
});
