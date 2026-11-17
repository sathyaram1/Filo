// I pezzi comuni ai moduli nati da handlers.js: finestre e schede del mittente, lo schermo, i contatori d'uso.
// Libreria nata da handlers.js: niente registrazioni di messaggi qui.

const { BrowserWindow } = require('electron');

const Schermo = require('./schermo').crea();
// Più chiamate che per chi usa Filo sono una richiesta sola (un messaggio coi suoi giri di strumenti, una dettatura
// coi suoi ripieghi) contano un uso, con l'attesa da quando è partita la richiesta (#969).
function unUsoContato(action, fn) {
  const C = globalThis.SN_CONTATORI_MAIN;
  return C && typeof C.unUso === 'function' ? C.unUso(action, fn) : fn();
}
// Gli altri conti (#1461): un contatore rotto o non ancora creato non ferma niente.
function contaSe(metodo, ...args) {
  try {
    const C = globalThis.SN_CONTATORI_MAIN;
    return C && typeof C[metodo] === 'function' ? C[metodo](...args) : undefined;
  } catch (_) { return undefined; }
}

// NON usare getAllWindows()[0]: le finestre figlie (tooltip, menu) si mettono in testa,
// e dopo il primo hover [0] è il tooltip, senza _filoTabs: /newtab smette di funzionare.
function filoWin() {
  const wins = BrowserWindow.getAllWindows();
  return wins.find((w) => w._filoTabs) || wins[0] || null;
}

// La finestra del tab MITTENTE: in incognito i comandi devono agire lì, e i link restare
// effimeri, invece di dirottare sulla principale. Ripiego su filoWin() senza mittente.
function winOf(sender) {
  const w = sender && sender.win;
  return (w && w._filoTabs) ? w : filoWin();
}

// Le schede web in cui LEGGI_PAGINA cerca la pagina prima di scaricarla: prima la finestra di chi chiede, poi le
// altre dello stesso tipo. Una finestra in incognito non presta le sue schede a una normale, e viceversa.
function schedeLeggibili(sender) {
  const prima = winOf(sender);
  const incognito = !!(prima && prima._filoTabs && prima._filoTabs.incognito);
  let finestre = [];
  try { finestre = BrowserWindow.getAllWindows(); } catch (_) {}
  const out = [];
  for (const w of [prima, ...finestre.filter((x) => x !== prima)]) {
    const tm = w && !(w.isDestroyed && w.isDestroyed()) && w._filoTabs;
    if (!tm || !!tm.incognito !== incognito) continue;
    for (const t of tm.tabs || []) {
      const wc = t && t.view && t.view.webContents;
      if (wc && /^https?:/i.test(String(t.url || ''))) out.push({ wc, url: t.url });
    }
  }
  return out;
}

// La chat vive nella dashboard, che è interna e non instradabile: «questa tab» è la scheda
// web attiva, e se l'attiva è interna si ripiega sull'ultima web che l'utente guardava.
function targetWebTab(sender) {
  const win = winOf(sender);
  const tm = win && win._filoTabs;
  if (!tm) return { win: null, tm: null, tab: null };
  const isWeb = (t) => t && !t.isInternal && /^https?:\/\//i.test(t.url || '');
  const active = tm.tabs.find((t) => t.id === tm.activeId);
  if (isWeb(active)) return { win, tm, tab: active };
  const recent = tm.tabs.filter(isWeb).sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0));
  return { win, tm, tab: recent[0] || null };
}

// #1279.1 — «fammi rivedere il banner qui» / «torna a rifiutarli qui» in chat: per il sito della scheda davanti si fa
// quello che fa la voce del menu della scheda (via la risposta salvata, pagina ricaricata). Altri siti: solo l'elenco.
async function bannerDellaScheda(elenco, sender) {
  if (!elenco || elenco.percorso !== 'security.cookies.bannerSites' || elenco.voci.length !== 1) return false;
  if (elenco.op !== 'aggiungi' && elenco.op !== 'togli') return false;
  const { tm, tab } = targetWebTab(sender);
  if (!tm || !tab || !require('../../shared/stessoSito').voceSalvata(tab.url, elenco.voci)) return false;
  const r = await tm.setCookieBanners(tab.id, elenco.op === 'aggiungi');
  return !!(r && r.ok);
}

// Il nome di una scheda come lo vede il modello in TAB APERTE: il titolo, e di una pagina delicata solo il sito (#1004).
async function nomeDellaScheda() {
  let delicata = () => null;
  try { if (globalThis.SN_DELICATE) delicata = await globalThis.SN_DELICATE.filtro(); } catch (_) {}
  return (t) => {
    let sito = '';
    try { sito = new URL(t.url || '').hostname.replace(/^www\./, ''); } catch (_) {}
    if (delicata(t.url || '')) return `${sito || 'sito'} (pagina delicata)`;
    return String(t.title || '').replace(/\s+/g, ' ').trim().slice(0, 80) || sito || 'scheda senza titolo';
  };
}

// Risincronizza la cache delle regole proxy in TUTTE le finestre dopo un
// cambio (la scrittura su storage è condivisa, le cache in-memory no).
function refreshProxyRulesAllWindows() {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win._filoTabs && typeof win._filoTabs.loadProxyRules === 'function') {
        win._filoTabs.loadProxyRules().catch(() => {});
      }
    }
  } catch (_) {}
}

module.exports = {
  Schermo,
  unUsoContato,
  contaSe,
  filoWin,
  winOf,
  schedeLeggibili,
  targetWebTab,
  bannerDellaScheda,
  nomeDellaScheda,
  refreshProxyRulesAllWindows,
};
