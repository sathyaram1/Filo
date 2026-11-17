// L'intervista di benvenuto: salvataggio, ripartenza, ripristino delle impostazioni, chiusura.
// Libreria nata da handlers.js: niente registrazioni di messaggi qui.

const FiloParla = require('./filoParla');
const { SN_CONST, SN_MSG } = globalThis;
const { MSG } = SN_MSG;
const Storage = globalThis.SN_STORAGE;
const FiloMem = globalThis.SN_FILO_MEMORY;
const Onboarding = globalThis.SN_ONBOARDING;
const { broadcastToTabs } = require('./broadcast');
const { contaSe, winOf } = require('./handlersComuni');
const { applySettingsUpdate } = require('./impostazioniEffettive');
const { maybeRunLessonAgent, maybeRunCompactor } = require('./chiamateModello');

// Ogni scrittura dello stato dell'intervista viene ANNUNCIATA a tutte le schede: di schede
// nuove se ne aprono quante si vuole, e senza annuncio la seconda resterebbe indietro.
// `via`: come si è chiusa, quando è questa scrittura a chiuderla («Salta», una frase di stop, il tetto degli scambi).
async function saveOnboarding(state, { via = '' } = {}) {
  let prima = null;
  try { prima = await FiloMem.getOnboarding(); } catch (_) {}
  const next = await FiloMem.setOnboarding(state);
  contaIntervista(prima, next, via);
  try { broadcastToTabs({ type: MSG.FILO_ONBOARDING_UPDATED, onboarding: next }); } catch (_) {}
  return next;
}

// Rifare l'intervista dalle Preferenze o dalla chat riparte dal benvenuto; quella di prima resta nell'archivio (`past`).
// `riprendi` (#1297): la stessa intervista, da dove si era fermata.
async function ricominciaIntervista({ riprendi = false } = {}) {
  const prev = await FiloMem.getOnboarding();
  const base = riprendi ? Onboarding.riprendi(prev) : Onboarding.restart(prev);
  // Rifatta da capo (#1473), dal pulsante o dalla chat: «Riprendiamola» continua quella che c'era, e non è una riapertura.
  if (!riprendi) require('./contatoriHomePagina').misura('intervistaRiaperta');
  return saveOnboarding(base.thread.length
    ? base
    : Onboarding.appendTurn(base, { role: 'filo', text: Onboarding.WELCOME_MESSAGE }));
}

// Il ripristino di tutte le impostazioni, dalla pagina e dalla chat: sostituisce l'oggetto intero invece di fonderlo.
async function ripristinaImpostazioni() {
  const correnti = await Storage.getSettings();
  await Storage.setSettings(globalThis.SN_PULSANTI_PREFERENZE.impostazioniDiSerie(correnti));
  return applySettingsUpdate({});
}
// Cosa cambierebbe il ripristino, letto con la regola del registro dei cambi: le sue frasi e il livello del suo annullo.
async function anteprimaRipristino() {
  const K = globalThis.SN_CAMBI;
  const correnti = await Storage.getSettings();
  const serie = globalThis.SN_PULSANTI_PREFERENZE.impostazioniDiSerie(correnti);
  const cambi = K.cambiImpostazioni(correnti, serie, globalThis.SN_STORAGE.normalizza);
  const evento = { tipo: 'impostazioni', cambi };
  // Toglie un freno solo se le voci che cambierebbero ne allentano una, con la regola delle preferenze e lo stesso pezzo
  // che scriverebbe un «rimetti com'era» dal di serie (#1840).
  let allenta = true;
  try {
    const verso = { cambi: K.cambiImpostazioni(serie, correnti, globalThis.SN_STORAGE.normalizza) };
    allenta = globalThis.SN_PREF.allentaParziale(K.annulloImpostazioni(verso, correnti, globalThis.SN_STORAGE.REPLACE_KEYS), correnti);
  } catch (_) { allenta = true; }
  return { frasi: K.frasi(evento), livello: K.livello(evento), allenta };
}
// La home che ospita l'intervista rifatta: col segno, così le altre home restano il filo (#1297).
function apriIntervistaRifatta(sender) {
  const win = winOf(sender);
  if (!win || !win._filoTabs) return false;
  win._filoTabs.openTab('filo://newtab/?accoglienza=1');
  return true;
}

// L'intervista per i contatori (#1461): le voci spuntate, come si è chiusa e, chiusa a metà, il passo dove si è fermata.
// Le scelte (autonomia, contatori) si leggono dalle impostazioni a fine turno, quando la voce è spuntata: col clic o a
// parole, è la stessa scelta, e nello stesso turno il modello può spuntare prima di applicare.
const SCELTE_INTERVISTA = ['autonomia', 'contatori'];
const scelteDaContare = new Set();
function contaIntervista(prima, dopo, via) {
  try {
    if (!Onboarding || !dopo) return;
    // Rifatta dalle Preferenze (#1473): solo dove si ferma, nei suoi contatori; quelli qui sotto sono della prima volta.
    if (dopo.daCapo === true) { contaIntervistaRifatta(prima, dopo); return; }
    const gia = new Set((prima && Array.isArray(prima.ticked)) ? prima.ticked : []);
    for (const id of Array.isArray(dopo.ticked) ? dopo.ticked : []) {
      if (gia.has(id)) continue;
      contaSe('intervista', id, 'spuntata');
      if (SCELTE_INTERVISTA.includes(id)) scelteDaContare.add(id);
    }
    const passo = Onboarding.ITEM_IDS.find((id) => !(dopo.ticked || []).includes(id));
    if ((prima && prima.done) || !dopo.done) {
      // Aperta: il passo dove si trova, per chi la lascia lì senza chiuderla (contato dopo un giorno di fermo).
      if (!dopo.done) contaSe('intervistaToccata', passo || 'chiusura', false, { inizio: dopo.startedAt || '' });
      return;
    }
    if (Onboarding.isComplete(dopo)) contaSe('intervista', 'chiusura', 'completa');
    else {
      contaSe('intervista', 'chiusura', 'anticipata');
      if (passo) contaSe('intervistaAbbandonata', passo);
    }
    if (via) contaSe('intervista', 'chiusura', via);
    contaSe('intervistaToccata', '', true);
  } catch (_) {}
}

function contaIntervistaRifatta(prima, dopo) {
  const passo = Onboarding.ITEM_IDS.find((id) => !(dopo.ticked || []).includes(id));
  const segni = { daCapo: true, inizio: dopo.startedAt || '' };
  if (!dopo.done) { contaSe('intervistaToccata', passo || 'chiusura', false, segni); return; }
  if (prima && prima.done) return;
  if (Onboarding.isComplete(dopo)) require('./contatoriHomePagina').misura('intervistaFine', 'completa');
  else contaSe('intervistaAbbandonata', passo || 'chiusura', { daCapo: true });
  contaSe('intervistaToccata', '', true);
}

async function contaScelteIntervista() {
  if (!scelteDaContare.size) return;
  const ids = [...scelteDaContare];
  scelteDaContare.clear();
  let s = {};
  try { s = (await Storage.getSettings()) || {}; } catch (_) { return; }
  // Spenti, il No non esce: non esce niente.
  if (ids.includes('contatori') && !(s.contatori && s.contatori.attivi === false)) contaSe('intervista', 'contatori', 'si');
  if (ids.includes('autonomia') && globalThis.SN_AUTONOMIA) {
    contaSe('intervista', 'autonomia', globalThis.SN_AUTONOMIA.livelloAttivo(s.autonomia && s.autonomia.livello));
  }
}

// La chiusura dell'intervista, in un posto solo. L'ordine non è un dettaglio:
// prima l'agente-lezioni estrae quello che l'ultimo turno ha insegnato, POI la
// compattazione lo porta dentro PROFILO/PREFERENZE (forzata: senza aspettare la
// soglia), e solo allora Filo scrive il primo messaggio della home personale — che è
// l'ultimo atto dell'accoglienza, al posto di un "fatto".
// Vale per tutte e tre le strade che la chiudono: il modello che dichiara
// `fine`, la parola di stop riconosciuta dall'app, il pulsante «Salta».
function finishOnboarding({ userMessage = '', filoReply = '', stateText = '', lessons = true, fonti = [] } = {}) {
  const done = (d) => broadcastToTabs({
    type: MSG.FILO_ONBOARDING_DONE,
    message: d?.message || '', suggestions: d?.suggestions || [], ts: d?.ts || new Date().toISOString(),
  });
  const first = lessons
    ? maybeRunLessonAgent({ userMessage, filoReply, stateText, fonti })
    : Promise.resolve();
  first
    .then(() => maybeRunCompactor())
    // Il primo messaggio della home personale è il primo turno di Filo nel filo (#869), dopo l'accoglienza.
    .then(() => FiloParla.giro({ subito: [{ tipo: 'accoglienza' }] }))
    .then(done)
    .catch((e) => {
      console.warn('[Filo] chiusura onboarding', e);
      // La home personale non è arrivata (chiave assente, provider giù): si dice comunque che è
      // finita e il client la genera per la sua strada. Restare dentro sarebbe il vicolo cieco.
      done(null);
    });
}

module.exports = {
  saveOnboarding,
  ricominciaIntervista,
  ripristinaImpostazioni,
  anteprimaRipristino,
  apriIntervistaRifatta,
  contaScelteIntervista,
  finishOnboarding,
};
