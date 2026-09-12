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

let fallback = null; // registro condiviso quando non c'è un mittente

function newLedger() {
  return { entries: [], chars: 0, sources: new Set() };
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
function record(sender, source, text, { untrusted = true, proteggi = true } = {}) {
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
  }
}

// Il materiale registrato, come testo unico per il taint-match.
function corpusText(sender) {
  const led = ledgerFor(sender, false);
  return led ? led.entries.join('\n') : '';
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
  record, corpusText, isTainted, sourcesOf, reset,
  _limits: { MAX_ENTRIES, MAX_CHARS, MAX_ENTRY_CHARS },
};
