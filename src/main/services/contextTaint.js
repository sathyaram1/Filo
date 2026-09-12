// Registro del materiale NON FIDATO entrato nel contesto del modello (#587).
//
// La catena di esfiltrazione completa è: una pagina ostile pilota il modello →
// il modello LEGGE qualcosa dell'utente → apre un indirizzo che porta fuori quel
// qualcosa. Il terzo anello (NAVIGA) si spezza in src/shared/urlExfil.js, che
// però ha bisogno di due informazioni che solo il main può dare:
//
//   • il CORPUS sensibile, cioè cosa il modello aveva davanti. Prima conteneva
//     solo i dati persistenti (memoria, profilo, appunti): l'output di un `cat`
//     appena eseguito NON c'era, quindi `cat segreto.txt` seguito da
//     `https://sito/?d=<contenuto>` passava senza chiedere niente.
//   • se il contesto contiene materiale NON FIDATO, che accende il ripiego
//     strutturale (payload corposo o blob opaco = sospetto a prescindere).
//     Prima quel flag guardava l'ORIGINE DEL MITTENTE del messaggio: la chat
//     della home è `filo://`, cioè fidata, e il ripiego non si accendeva mai —
//     anche con mezza pagina ostile nel contesto. Il flag deve dipendere da COSA
//     è entrato (pagina web, risultati di ricerca, llms.txt, output di comandi),
//     non da CHI ha mandato il messaggio.
//
// Il registro sta per-webContents (muore con la scheda), come la cartella di
// lavoro dell'assistente, con un ripiego condiviso quando non c'è un mittente
// (test e chiamate interne).
//
// Il registro NON si svuota a fine turno: il materiale letto RESTA nel contesto
// del modello anche nei turni successivi (gli output dei comandi vengono
// re-immessi nel prompt, vedi commandOutputsForPrompt), quindi svuotarlo
// riaprirebbe la porta al turno dopo. Cresce con un tetto: oltre quello escono
// le voci più VECCHIE, che sono anche quelle che il modello ha più probabilmente
// perso dal contesto.
//
// Uscire dal registro però non vuol dire SPARIRE. Finché il testo intero usciva
// e basta, bastava far leggere a Filo sette file grossi qualunque — sette
// comandi di sola lettura, nessuno dei quali chiede niente — perché la chiave
// letta prima non fosse più fra i dati da proteggere, e da lì l'indirizzo che la
// portava fuori partiva senza avviso, in chiaro (#587, giro 4). Di una voce che
// esce si tiene il RIASSUNTO: le parole che la rendono riconoscibile (parole di
// almeno cinque caratteri e indirizzi email), senza ripetizioni. È tutto ciò che
// il confronto col link usa davvero, e costa una frazione del testo: perdere
// qualcosa adesso richiede di leggere decine di migliaia di parole diverse, non
// sette file.

'use strict';

// Tetti del registro. Il taint-match scorre i token del corpus una volta per
// URL: anche al massimo sono decine di migliaia di confronti di sottostringa su
// una stringa corta, cioè millisecondi. Dimensionati sul caso peggiore
// realistico (un turno agentico lungo che legge parecchi file), non sul comune.
const MAX_ENTRIES = 60;
const MAX_CHARS = 200 * 1024;
// Una singola voce enorme (un `cat` su un file da 10 MB) non deve svuotare il
// registro da sola: la tagliamo tenendo la TESTA e la CODA, che è dove stanno i
// dati identificabili, e la cosa viene detta nel testo.
const MAX_ENTRY_CHARS = 32 * 1024;

// Provenienze che rendono il contesto pilotabile ma NON sono dati dell'utente da
// proteggere: testo pubblico, che il modello ha appena scaricato e che contiene
// gli indirizzi che l'utente chiederà di aprire subito dopo.
const NON_PROTETTE = new Set(['ricerca web']);

// Il riassunto di ciò che è uscito dal registro: parole distinte, quindi molto
// più capiente del testo da cui nasce. Oltre il tetto escono le più vecchie.
const MAX_DIGEST = 40000;
// Una "parola" più lunga di così non può stare in un indirizzo: tenerla vorrebbe
// dire riempire il riassunto con l'output binario di un comando.
const MAX_TOKEN_CHARS = 512;

let fallback = null; // registro condiviso quando non c'è un mittente

// Quanti link indietro si guarda per riconoscere un dato spedito un pezzo per
// volta. Chi attacca può spezzare il dato in più richieste; noi ne teniamo
// abbastanza da ricomporlo, e ognuna pesa il carico di un indirizzo.
const MAX_LINK = 24;
const MAX_LINK_CHARS = 4096;

function newLedger() {
  return {
    entries: [], chars: 0, sources: new Set(), digest: new Set(), links: [],
  };
}

// Le parole che rendono riconoscibile un testo: indirizzi email interi e parole
// di almeno cinque caratteri utili. È la stessa materia che il confronto col
// link estrae dal corpus (src/shared/urlExfil.js → corpusTokens): tenere questa
// vuol dire non perdere nessun confronto.
//
// Le parole si tengono INTERE, con la punteggiatura che hanno dentro, e non
// spezzate a ogni carattere che non sia una lettera o una cifra. Il confronto
// col link non guarda solo le parole spezzate: di ogni parola guarda anche la
// forma INCOLLATA, ed è quella che riconosce i segreti scritti come li scrive la
// gente (`Casa_Mia_2026_xy`, `ab12.cd34.ef56.gh78`, `Rosa-Blu-2026`). Spezzando,
// di quei segreti non restava niente — tutti i pezzi sono più corti di cinque —
// e bastavano otto letture qualsiasi, che non chiedono niente, perché la
// password letta prima uscisse dal registro e con lei ogni difesa: il link che
// la portava fuori partiva in chiaro, senza avviso (#587, giro 8, che riapriva
// la porta del giro 4 su metà dei segreti).
// Tenere la parola intera non costa più della somma dei suoi pezzi ed è
// l'unico modo di non dover ripetere QUI le regole del confronto: la parola
// torna nel corpus e da lì passa dalla stessa porta di sempre.
function paroleDi(text) {
  const s = String(text || '');
  const out = [];
  // I pezzi dell'indirizzo email hanno una lunghezza MASSIMA: senza, su un testo
  // lungo senza chiocciole (l'output di un comando su un file compatto) il
  // motore torna indietro a ogni posizione e il conto arriva a costare secondi.
  const emailRe = /[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,255}\.[a-z]{2,24}/gi;
  let m;
  while ((m = emailRe.exec(s))) out.push(m[0]);
  for (const w of s.split(/\s+/)) {
    if (!w || w.length > MAX_TOKEN_CHARS) continue;
    // Cinque caratteri utili: sotto quelli non c'è niente da riconoscere, né
    // spezzato né incollato.
    if (w.replace(/[^A-Za-z0-9]+/g, '').length >= 5) out.push(w);
  }
  return out;
}

function ricorda(led, entry) {
  for (const w of paroleDi(entry)) led.digest.add(w);
  while (led.digest.size > MAX_DIGEST) {
    const primo = led.digest.values().next().value;
    led.digest.delete(primo);
  }
}

// Il "mittente" che arriva agli handler è un oggetto DESCRITTIVO ricostruito a
// ogni messaggio (src/main/ipc.js → senderInfo): appendergli qualcosa sopra
// significa perderlo al messaggio dopo. Il registro va appeso al webContents
// vero (`sender.wc`), che vive quanto la scheda.
function hostOf(sender) {
  if (!sender) return null;
  try { return sender.wc || sender; } catch (_) { return sender; }
}

function ledgerFor(rawSender, create) {
  const sender = hostOf(rawSender);
  if (!sender) {
    if (!fallback && create) fallback = newLedger();
    return fallback;
  }
  try {
    if (!sender._filoContextTaint && create) sender._filoContextTaint = newLedger();
    return sender._filoContextTaint || null;
  } catch (_) {
    // webContents distrutto: ripieghiamo sul registro condiviso invece di
    // perdere la difesa in silenzio.
    if (!fallback && create) fallback = newLedger();
    return fallback;
  }
}

function clip(text) {
  const s = String(text == null ? '' : text);
  if (s.length <= MAX_ENTRY_CHARS) return s;
  const half = Math.floor(MAX_ENTRY_CHARS / 2);
  return `${s.slice(0, half)}\n…(${s.length - MAX_ENTRY_CHARS} caratteri non tenuti nel registro)…\n${s.slice(-half)}`;
}

// Registra del materiale entrato nel contesto del modello.
//   source    — etichetta della provenienza ('comando', 'ricerca web', …)
//   text      — il testo entrato
//   untrusted — se quel materiale può contenere istruzioni ostili (default sì).
//               I documenti dell'utente entrano nel corpus ma non accendono il
//               ripiego strutturale: sono roba sua, non di un attaccante.
//   proteggi  — se quel materiale è roba dell'UTENTE, da fermare se un link prova
//               a portarla fuori (default sì).
//
// Le due domande sono diverse e vanno tenute separate, perché i risultati di una
// ricerca rispondono sì alla prima e no alla seconda: sono testo pubblico preso
// da pagine che non controlliamo, quindi rendono il contesto pilotabile, ma non
// sono dati dell'utente. Metterli fra le cose da proteggere faceva combaciare
// ogni risultato con se stesso: «cerca la carbonara e aprimi il primo» apriva un
// avviso di furto di dati sul link che la ricerca aveva appena restituito
// (#587, giro 1). È la stessa ragione per cui gli indirizzi delle schede aperte
// non entrano nel corpus.
//
// La risposta sta QUI e non in chi chiama: è una proprietà della provenienza, e
// se la decidesse ogni chiamante basterebbe dimenticarsene una volta per
// rimettere in circolo l'avviso falso. Il default protegge, così una provenienza
// nuova sbaglia dalla parte prudente.
function record(sender, source, text, opts) {
  const o = opts || {};
  const untrusted = o.untrusted !== false;
  const proteggi = o.proteggi === undefined ? !NON_PROTETTE.has(String(source)) : !!o.proteggi;
  const body = String(text == null ? '' : text).trim();
  if (!body) return;
  const led = ledgerFor(sender, true);
  if (!led) return;
  if (untrusted && source) led.sources.add(String(source));
  if (!proteggi) return;
  const entry = clip(body);
  led.entries.push(entry);
  led.chars += entry.length;
  while (led.entries.length > MAX_ENTRIES || (led.chars > MAX_CHARS && led.entries.length > 1)) {
    const gone = led.entries.shift();
    led.chars -= gone.length;
    ricorda(led, gone); // esce il testo, restano le parole
  }
}

// Il materiale registrato, come testo unico per il taint-match: le voci intere
// più il riassunto di quelle uscite.
function corpusText(sender) {
  const led = ledgerFor(sender, false);
  if (!led) return '';
  const pezzi = led.entries.slice();
  if (led.digest.size) pezzi.push(Array.from(led.digest).join(' '));
  return pezzi.join('\n');
}

// Il carico dei link già aperti in questa scheda, il più recente per ultimo.
// Serve a riconoscere un dato spedito un pezzo per volta: due link che presi da
// soli non portano fuori niente e insieme portano fuori una password intera
// (#587, giro 5).
function ricordaLink(sender, carico) {
  const c = String(carico || '');
  if (!c) return;
  const led = ledgerFor(sender, true);
  if (!led) return;
  if (!Array.isArray(led.links)) led.links = [];
  led.links.push(c.slice(0, MAX_LINK_CHARS));
  while (led.links.length > MAX_LINK) led.links.shift();
}

function carichiLink(sender) {
  const led = ledgerFor(sender, false);
  return led && Array.isArray(led.links) ? led.links.slice() : [];
}

// Il contesto contiene materiale non fidato? (accende il ripiego strutturale)
function isTainted(sender) {
  const led = ledgerFor(sender, false);
  return !!(led && led.sources.size);
}

// Da dove viene quel materiale, in chiaro: serve alla spiegazione del popup.
function sourcesOf(sender) {
  const led = ledgerFor(sender, false);
  return led ? Array.from(led.sources) : [];
}

// Svuota il registro di un mittente. Non lo chiama il flusso normale (il
// materiale resta nel contesto finché la scheda vive): serve ai test e a un
// eventuale "ricomincia da capo".
function reset(rawSender) {
  const sender = hostOf(rawSender);
  if (!sender) { fallback = null; return; }
  try { sender._filoContextTaint = null; } catch (_) {}
}

module.exports = {
  record, corpusText, isTainted, sourcesOf, reset, ricordaLink, carichiLink,
  _limits: { MAX_ENTRIES, MAX_CHARS, MAX_ENTRY_CHARS, MAX_LINK },
};
