// Il verdetto della porta delle uscite (#810): la chiusura a guasto e il registro dei collegamenti che un modello mostra
// (#868.6, #1505). Una porta che non risponde ferma l'uscita; un collegamento senza verdetto chiede l'OK al clic.
// Niente Electron: le regole si provano in tests/unit/usciteSegreti.test.mjs, la porta vera gliela passa handlers.js.

// Largo: una risposta onesta ha pochi collegamenti, e ognuno costa una passata della porta. Oltre, si chiede l'OK.
const MAX_GIUDICATI_PER_TESTO = 200;
const MAX_DA_CONFERMARE = 5000;
// Più largo: dimenticare un collegamento giudicato costa solo un OK in più al clic.
const MAX_GIUDICATI = 20000;

// Si leggono dopo «Aprire un link che …» nel pannello dell'OK.
const MOTIVI = Object.freeze({
  guasto: 'non ho potuto controllare, perché il controllo dei dati in uscita non ha funzionato',
  troppi: 'non ho potuto controllare, perché la risposta aveva troppi collegamenti',
  senzaVerdetto: 'non ho potuto controllare prima di mostrartelo',
});
const FRASE_GUASTO = 'il controllo dei dati in uscita non ha funzionato, e senza quel controllo non lascio uscire niente';

function guasto(action) {
  const tipo = String((action && action.type) || '').toUpperCase();
  let verbo = '';
  try { verbo = globalThis.SN_URL_EXFIL.verboUscita(tipo); } catch (_) {}
  return { blocca: true, exfil: false, regola: 'guasto', reason: '', frase: `${verbo || "non l'ho fatto"}: ${FRASE_GUASTO}` };
}

// La porta chiude a guasto in un punto solo: un'eccezione o le regole non caricate fermano l'uscita con la frase che
// lo dice, mai un via libera. Chi la chiama tratta `regola: 'guasto'` come ogni altro blocco.
function chiudiAGuasto(giudica, { regole = () => globalThis.SN_URL_EXFIL, avvisa = () => {} } = {}) {
  return async (action, opzioni) => {
    try {
      if (!regole()) throw new Error('regole delle uscite non caricate');
      return await giudica(action, opzioni);
    } catch (e) {
      try { avvisa(e); } catch (_) {}
      return guasto(action);
    }
  };
}

function chiave(url) {
  const raw = String(url || '').trim();
  try { const u = new URL(raw); return `${u.protocol}//${u.username}:${u.password}@${u.host.toLowerCase()}${u.pathname}${u.search}`; } catch (_) { return raw; }
}

// L'indirizzo che il browser aprirà: «https:sito/…» o con le barre rovesciate è lo stesso indirizzo web.
function indirizzoWeb(grezzo) {
  try {
    const u = new URL(String(typeof grezzo === 'string' ? grezzo : '').trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch (_) { return ''; }
}

const daConfermare = new Map(); // chiave → motivo
const giudicati = new Set();

function ricordaIn(insieme, k, max, valore) {
  insieme.delete(k);
  if (insieme instanceof Map) insieme.set(k, valore); else insieme.add(k);
  while (insieme.size > max) insieme.delete(insieme.keys().next().value);
}

function segnaDaConfermare(url, motivo) {
  ricordaIn(daConfermare, chiave(url), MAX_DA_CONFERMARE, String(motivo || ''));
}

function segnaGiudicato(url) {
  ricordaIn(giudicati, chiave(url), MAX_GIUDICATI);
}

function motivoDaConfermare(url) {
  return daConfermare.get(chiave(url));
}

function giudicato(url) {
  const k = chiave(url);
  return daConfermare.has(k) || giudicati.has(k);
}

// Un sito con un collegamento in attesa di OK: il dato può stare nel nome, quindi vale per tutto il sito (#848).
function sitoDaConfermare(url) {
  let host = '';
  try { host = new URL(String(url || '')).host.toLowerCase(); } catch (_) { return false; }
  if (!host) return false;
  for (const k of daConfermare.keys()) {
    try { if (new URL(k).host.toLowerCase() === host) return true; } catch (_) {}
  }
  return false;
}

// `chiede(url, verdetto)`: se quel verdetto della porta, al clic, chiederebbe l'OK. Una porta che lancia o un
// collegamento oltre il tetto lo chiede col suo motivo. Torna quelli che lo chiedono; gli altri restano giudicati.
async function giudica(indirizzi, { porta, chiede = async () => true, tetto = MAX_GIUDICATI_PER_TESTO } = {}) {
  const out = [];
  const visti = new Set();
  let passati = 0;
  for (const grezzo of Array.isArray(indirizzi) ? indirizzi : []) {
    const url = indirizzoWeb(grezzo);
    if (!url) continue;
    const k = chiave(url);
    if (visti.has(k)) continue;
    visti.add(k);
    let motivo = null;
    if (passati >= tetto) {
      motivo = MOTIVI.troppi;
    } else {
      passati++;
      let u = null;
      try { u = await porta(url); } catch (_) { u = null; }
      // Un blocco vero la porta lo rifà al clic; non è un via libera, quindi non entra fra i giudicati.
      if (u && u.blocca && u.regola !== 'guasto') continue;
      if (!u || u.blocca) {
        motivo = MOTIVI.guasto;
      } else if (u.exfil || u.nonCompare) {
        const reason = u.nonCompare ? (u.datiReason || 'ha scritto Filo e che non compare da nessuna parte') : u.reason;
        let si = true;
        try { si = await chiede(url, { ...u, reason }); } catch (_) { si = true; }
        if (si) motivo = reason;
      }
    }
    if (motivo === null) { segnaGiudicato(url); continue; }
    segnaDaConfermare(url, motivo);
    out.push({ url, motivo });
  }
  return out;
}

// Al clic: se un collegamento web chiede l'OK e perché. `chiedi` = il motivo che la pagina ha conservato (una chat
// riaperta); `proposta` = l'ha mostrato un modello in una pagina che riceve i verdetti, dove uno mai giudicato lo chiede.
function alClic(url, { chiedi = '', proposta = false } = {}) {
  const web = indirizzoWeb(url);
  if (!web) return { daChiedere: false, motivo: '' };
  const k = chiave(web);
  if (daConfermare.has(k)) return { daChiedere: true, motivo: daConfermare.get(k) || String(chiedi || '') };
  if (chiedi) return { daChiedere: true, motivo: String(chiedi) };
  if (proposta && !giudicati.has(k)) return { daChiedere: true, motivo: MOTIVI.senzaVerdetto };
  return { daChiedere: false, motivo: '' };
}

// Prima del clic (icona, anteprima) un indirizzo si contatta solo se al clic si aprirebbe senza chiedere l'OK.
function contattabile(url, { proposta = false } = {}) {
  const web = indirizzoWeb(url);
  if (!web || sitoDaConfermare(web)) return false;
  return !(proposta && !giudicato(web));
}

// Una chat riaperta, anche dopo un riavvio, ritrova i verdetti dei suoi collegamenti; una frase mai giudicata
// (`senzaVerdetto`: risposta interrotta, riga scritta dalla pagina) non ne ha. `linkDi(testo)` = i suoi cliccabili.
function ricordaArchiviati(messages, linkDi) {
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || m.role !== 'filo') continue;
    const chiedono = Array.isArray(m.linkDaConfermare) ? m.linkDaConfermare : [];
    for (const x of chiedono) if (x && typeof x.url === 'string') segnaDaConfermare(x.url, x.motivo);
    if (m.senzaVerdetto) continue;
    for (const grezzo of linkDi(String(m.text || ''))) {
      const url = indirizzoWeb(grezzo);
      if (url && !daConfermare.has(chiave(url))) segnaGiudicato(url);
    }
  }
}

function svuota() {
  daConfermare.clear();
  giudicati.clear();
}

module.exports = {
  MOTIVI, MAX_GIUDICATI_PER_TESTO, MAX_DA_CONFERMARE, FRASE_GUASTO,
  guasto, chiudiAGuasto, chiave, indirizzoWeb,
  segnaDaConfermare, segnaGiudicato, motivoDaConfermare, giudicato, sitoDaConfermare,
  giudica, alClic, contattabile, ricordaArchiviati, svuota,
};
