// Cookie dei contenuti incorporati di terzi (#758), modalità Automatico: restano per la visita e non oltre.
// Non tocca il sito principale di una scheda, i siti dove hai un account (`loggedSites`) e i siti fidati.
// Le decisioni stanno in cookieIncorporatiRegole.js; il resto della gestione cookie in cookies.js.

'use strict';

const { session } = require('electron');
const R = require('./cookieIncorporatiRegole');
require('../../shared/authPopup');

// «Qualche minuto» dopo l'ultima scheda che ospitava il riquadro: chi riapre l'articolo un attimo dopo non perde
// quello che il riquadro stava facendo (un video a metà, un commento scritto).
const MARGINE_MS = 3 * 60 * 1000;
// Da quando si vede la pagina di accesso a quando il cookie di sessione deve arrivare: un accesso lento ci sta dentro.
const ATTESA_ACCESSO_MS = 10 * 60 * 1000;
// Da quando si invia l'accesso (modulo, codice, ritorno da «Continua con…») al cookie che lo conferma: i rimbalzi
// dopo l'invio ci stanno dentro, un cookie da visitatore messo mentre si guarda la pagina no.
const FINESTRA_INVIO_MS = 2 * 60 * 1000;
const MAX_SITI = 500;
const MAX_NOMI = 200;
const GIRO_MS = 30 * 1000;
// Fra la risposta della pagina principale e il suo arrivo nella scheda passa un attimo; questo è il tetto largo.
const ARRIVO_MS = 60 * 1000;

let margine = MARGINE_MS;
// Solo i test accorciano il margine: nell'app lo decide MARGINE_MS.
function margineTest(ms) {
  if (process.env.NODE_ENV === 'test' && Number(ms) > 0) margine = Number(ms);
}

// sito incorporato → { ospiti: siti che lo ospitavano, nomi: cookie declassati, chiusoDa, at }
const siti = new Map();
// sito → { at, prima: nome → valore, credenziali, invio } dalla pagina di accesso: il cookie che arriva dopo l'invio
// dice che sei entrato.
const attesa = new Map();
// Cookie con scadenza appena sovrascritti (dominio|percorso|nome): c'erano già prima che un riquadro li riscrivesse,
// quindi non sono nati da lui (un accesso fatto prima di #758, o che Filo non ha visto) e non si declassano.
const preesistenti = new Map();
// webContents → sito della pagina principale che sta arrivando: i cookie della sua risposta nascono prima che la
// scheda cambi indirizzo, e sono del sito principale, non di un riquadro.
const inArrivo = new Map();
// sito → nomi dei cookie partizionati dei suoi riquadri: Electron non sa riscriverli senza scadenza, quindi si
// tolgono a fine visita (o all'uscita da Filo).
const partizionati = new Map();

let modo = 'default';
let fidati = new Set();
let accessi = new Set();
let agganciata = null;
let giro = null;
let scrittura = Promise.resolve();

function Cookies() { return require('./cookies'); }

function sitoDi(url) {
  try { return Cookies().registrableOf(url) || null; } catch (_) { return null; }
}

// Mentre si sta guardando un accesso a un sito (la sua pagina di accesso è aperta, o la finestrella «Continua
// con…»), i suoi cookie non si toccano: declassare quelli del giro di accesso lo farebbe uscire al riavvio.
function protetti() {
  const out = new Set(accessi);
  for (const d of fidati) out.add(d);
  const ora = Date.now();
  for (const [sito, v] of [...attesa]) {
    if (ora - v.at > ATTESA_ACCESSO_MS) attesa.delete(sito);
    else out.add(sito);
  }
  return out;
}

// I siti aperti ADESSO come pagina principale di una scheda: i loro cookie non si toccano mai, nemmeno quando lo
// stesso sito compare incorporato altrove. L'incognito ha la sua sessione e non c'entra con questi cookie.
function aperti() {
  const out = new Set();
  try {
    const { BrowserWindow } = require('electron');
    for (const w of BrowserWindow.getAllWindows()) {
      if (w._filoIncognito || !w._filoTabs) continue;
      for (const t of w._filoTabs.tabs || []) {
        for (const u of [t.url, t._urlNavigato]) {
          const s = u && sitoDi(u);
          if (s) out.add(s);
        }
      }
    }
  } catch (_) {}
  const ora = Date.now();
  for (const [id, v] of [...inArrivo]) {
    let wc = null;
    try { wc = require('electron').webContents.fromId(id); } catch (_) {}
    if (!wc || wc.isDestroyed() || ora - v.at > ARRIVO_MS) inArrivo.delete(id);
    else out.add(v.sito);
  }
  return out;
}

// Chi ospita `sito` in un riquadro in questo momento. Serve quando la risposta del riquadro non è passata dal
// registro (pagina dalla cache, riquadro creato da uno script): senza, il cookie resterebbe per sempre.
function ospitiOra(sito) {
  const out = new Set();
  try {
    const { BrowserWindow } = require('electron');
    for (const w of BrowserWindow.getAllWindows()) {
      if (w._filoIncognito || !w._filoTabs) continue;
      for (const t of w._filoTabs.tabs || []) {
        const wc = t.view && t.view.webContents;
        if (!wc || wc.isDestroyed()) continue;
        let frames = [];
        try { frames = wc.mainFrame.framesInSubtree; } catch (_) { continue; }
        const cima = sitoDi(wc.getURL());
        if (!cima || cima === sito) continue;
        for (const f of frames) {
          let u = '';
          try { u = f.url || ''; } catch (_) {}
          if (u && sitoDi(u) === sito) { out.add(cima); break; }
        }
      }
    }
  } catch (_) {}
  return out;
}

function voce(sito) {
  let v = siti.get(sito);
  if (!v) {
    v = { sito, ospiti: new Set(), nomi: new Set(), chiusoDa: 0, at: Date.now() };
    siti.set(sito, v);
    while (siti.size > MAX_SITI) siti.delete(siti.keys().next().value);
  }
  v.at = Date.now();
  return v;
}

// Una risposta arrivata per un sito diverso da quello della scheda: da qui si sa che i suoi cookie nascono
// incorporati, anche quando il cookie lo scrive uno script del riquadro.
function registraTerzaParte(url, urlCima) {
  const sito = sitoDi(url);
  const ospite = sitoDi(urlCima);
  if (!sito || !ospite || sito === ospite) return;
  const v = voce(sito);
  v.ospiti.add(ospite);
  v.chiusoDa = 0;
}

function urlDi(c) {
  const dominio = String(c.domain || '').replace(/^\./, '');
  return (c.secure ? 'https://' : 'http://') + dominio + (c.path || '/');
}

// Il cookie torna identico ma senza scadenza: vale per la visita e non oltre. Si riscrive il valore di adesso (un
// avviso superato da uno più nuovo rimetterebbe uno stato che il riquadro aveva sostituito). Un partizionato si vede
// solo per dominio, accanto all'eventuale cookie normale con lo stesso nome: torna 'partizionato' e quello non si tocca.
async function declassa(ses, c0) {
  const percorso = c0.path || '/';
  const stesso = (x) => x.name === c0.name && x.domain === c0.domain && (x.path || '/') === percorso;
  const c = (await ses.cookies.get({ url: urlDi(c0), name: c0.name })).find(stesso);
  if (!c || c.value !== c0.value) {
    const lista = await ses.cookies.get({ domain: String(c0.domain || '').replace(/^\./, '') });
    if (lista.some((x) => stesso(x) && !x.session && (!c || x.value !== c.value))) return 'partizionato';
  }
  if (!c || c.session) return false;
  const dominio = String(c.domain || '').replace(/^\./, '');
  await ses.cookies.set({
    url: urlDi(c),
    name: c.name,
    value: c.value,
    path: c.path || '/',
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
    sameSite: c.sameSite,
    ...(c.hostOnly ? {} : { domain: dominio }),
  });
  return true;
}

// L'accesso osservato: pagina di accesso del sito, e dopo un cookie di sessione suo che prima non c'era.
// `forte`: la pagina chiedeva una password (non solo un indirizzo che somiglia a un accesso).
function paginaDiAccesso(url, { forte = false } = {}) {
  if (modo !== 'default') return;
  if (!/^https?:/i.test(String(url || ''))) return;
  const sito = sitoDi(url);
  if (!sito || accessi.has(sito)) return;
  const vecchia = attesa.get(sito);
  attesa.set(sito, {
    credenziali: 0,
    invio: 0,
    ...vecchia,
    at: Date.now(),
    prima: vecchia ? vecchia.prima : new Map(),
    forte: forte || !!(vecchia && vecchia.forte),
  });
  if (vecchia) return;
  const ses = agganciata;
  if (!ses) return;
  // La foto dei cookie di adesso: senza, un cookie già lì che si rinfresca sembrerebbe un accesso appena fatto.
  ses.cookies.get({ domain: sito }).then((lista) => {
    const v = attesa.get(sito);
    if (!v) return;
    for (const c of lista || []) v.prima.set(c.name, c.value);
  }).catch(() => {});
}

// L'utente ha scritto una password nella pagina principale della scheda: da qui una scrittura verso il sito è l'invio
// dell'accesso. Senza, una richiesta che la pagina fa da sola lo sembrerebbe.
function credenziali(url) {
  if (modo !== 'default') return;
  paginaDiAccesso(url, { forte: true });
  const v = attesa.get(sitoDi(url));
  if (v) v.credenziali = Date.now();
}

// La pagina di accesso riconosciuta dall'indirizzo (#209): il resto lo dice il campo password che la pagina segnala.
function navigazione(url) {
  if (modo !== 'default') return;
  const AP = globalThis.SN_AUTH_POPUP;
  if (!AP || !AP.isAuthPopup(String(url || ''))) return;
  paginaDiAccesso(url);
}

// La rimozione per indirizzo toglie anche il cookie normale con lo stesso nome: quello con scadenza si rimette.
async function togliPartizionati(ses, sito, nomi) {
  let lista = [];
  try { lista = await ses.cookies.get({ domain: sito }); } catch (_) { return; }
  for (const nome of nomi) {
    for (const url of new Set(lista.filter((c) => c.name === nome).map(urlDi))) {
      let normali = [];
      try { normali = (await ses.cookies.get({ url, name: nome })).filter((c) => !c.session); } catch (_) {}
      try { await ses.cookies.remove(url, nome); } catch (_) {}
      for (const c of normali) {
        preesistenti.set(chiaveCookie(c), Date.now());
        try {
          await ses.cookies.set({
            url: urlDi(c), name: c.name, value: c.value, path: c.path || '/', secure: !!c.secure, httpOnly: !!c.httpOnly,
            sameSite: c.sameSite, expirationDate: c.expirationDate,
            ...(c.hostOnly ? {} : { domain: String(c.domain || '').replace(/^\./, '') }),
          });
        } catch (_) {}
      }
    }
  }
}

// All'uscita da Filo i cookie di sessione se ne vanno da soli; i partizionati ancora in attesa si tolgono qui.
async function allUscita() {
  const ses = agganciata;
  if (!ses || !partizionati.size) return;
  const prot = protetti();
  for (const [sito, nomi] of [...partizionati]) {
    partizionati.delete(sito);
    if (!prot.has(sito)) await togliPartizionati(ses, sito, nomi);
  }
}

function segnaAccesso(sito) {
  if (!sito || accessi.has(sito)) return;
  accessi.add(sito);
  attesa.delete(sito);
  siti.delete(sito);
  partizionati.delete(sito);
  scrittura = scrittura.then(async () => {
    const Storage = globalThis.SN_STORAGE;
    const { applySettingsUpdate } = require('./handlers');
    const s = await Storage.getSettings();
    const prima = (s.security && s.security.cookies && s.security.cookies.loggedSites) || [];
    if (Array.isArray(prima) && prima.includes(sito)) return;
    const lista = [...new Set([...(Array.isArray(prima) ? prima : []), sito])].sort();
    await applySettingsUpdate({ security: { cookies: { loggedSites: lista } } });
  }).catch(() => {});
}

function chiaveCookie(c) {
  return `${String(c.domain || '').toLowerCase()}|${c.path || '/'}|${c.name}`;
}

async function cookieCambiato(ses, c, removed, giaLi = false) {
  if (removed || !c || !c.name) return;
  const sito = sitoDi(urlDi(c));
  if (!sito) return;
  const inAttesa = attesa.get(sito);
  if (inAttesa) {
    const ora = Date.now();
    if (ora - inAttesa.at > ATTESA_ACCESSO_MS) attesa.delete(sito);
    else if (inAttesa.invio && ora - inAttesa.invio <= FINESTRA_INVIO_MS
      && R.segnaleDiAccesso(c, inAttesa.prima, { forte: inAttesa.forte })) { segnaAccesso(sito); return; }
  }
  if (c.session || giaLi || modo !== 'default') return;
  const prot = protetti();
  if (prot.has(sito)) return;
  let v = siti.get(sito);
  if (!v || !v.ospiti.size) {
    const ospiti = ospitiOra(sito);
    if (!ospiti.size) return;
    v = voce(sito);
    for (const o of ospiti) v.ospiti.add(o);
  }
  if (!R.daDeclassare({ modo, sito, ospiti: v.ospiti, aperti: aperti(), protetti: prot })) return;
  let esito;
  try { esito = await declassa(ses, c); } catch (_) { return; }
  if (!esito) return;
  if (esito === 'partizionato') marcaPartizionato(sito, c.name);
  v.nomi.add(c.name);
  while (v.nomi.size > MAX_NOMI) v.nomi.delete(v.nomi.keys().next().value);
  v.chiusoDa = 0;
  avviaGiro();
}

// Nessuna scheda tiene più aperto il sito che ospitava il riquadro: passato il margine i suoi cookie vanno via.
async function giroDiPulizia() {
  const ses = agganciata;
  if (!ses) return;
  const ora = Date.now();
  const stato = { aperti: aperti(), protetti: protetti(), ora, margine };
  for (const [sito, v] of [...siti]) {
    if (!v.nomi.size) {
      if (ora - v.at > ATTESA_ACCESSO_MS) siti.delete(sito);
      continue;
    }
    const esito = R.esitoVoce(v, stato);
    v.chiusoDa = esito.chiusoDa;
    if (esito.azione === 'aspetta') continue;
    if (esito.azione === 'dimentica') { siti.delete(sito); partizionati.delete(sito); continue; }
    siti.delete(sito);
    let lista = [];
    try { lista = await ses.cookies.get({ domain: sito }); } catch (_) { continue; }
    const nomiP = partizionati.get(sito) || new Set();
    partizionati.delete(sito);
    for (const c of lista) {
      // Solo quelli che abbiamo declassato noi e che sono ancora di sessione: se un tuo accesso ne ha riscritto
      // uno con scadenza, quello è tuo e non si tocca.
      if (!c.session || !v.nomi.has(c.name) || nomiP.has(c.name)) continue;
      try { await ses.cookies.remove(urlDi(c), c.name); } catch (_) {}
    }
    if (nomiP.size) await togliPartizionati(ses, sito, nomiP);
  }
  if (![...siti.values()].some((v) => v.nomi.size)) fermaGiro();
}

function avviaGiro() {
  if (giro) return;
  giro = setInterval(() => { giroDiPulizia().catch(() => {}); }, GIRO_MS);
  if (giro.unref) giro.unref();
}
function fermaGiro() {
  if (giro) clearInterval(giro);
  giro = null;
}

function marcaPartizionato(sito, nome) {
  if (!partizionati.has(sito)) partizionati.set(sito, new Set());
  partizionati.get(sito).add(nome);
  while (partizionati.size > MAX_SITI) partizionati.delete(partizionati.keys().next().value);
}

// Electron non sa riscrivere un cookie partizionato senza scadenza: quello che arriva da un'intestazione nasce già di
// sessione, togliendogli la scadenza qui; quello scritto da uno script si toglie a fine visita.
function partizionatiDiSessione(d, sito, ospite) {
  const h = d.responseHeaders;
  if (!h) return null;
  const chiavi = Object.keys(h).filter((k) => k.toLowerCase() === 'set-cookie' && Array.isArray(h[k]));
  if (!chiavi.some((k) => h[k].some((r) => R.nomePartizionatoConScadenza(r)))) return null;
  const v = siti.get(sito);
  const ospiti = v && v.ospiti.size ? v.ospiti : new Set([ospite]);
  if (!R.daDeclassare({ modo, sito, ospiti, aperti: aperti(), protetti: protetti() })) return null;
  const nuove = { ...h };
  const voceSito = voce(sito);
  voceSito.ospiti.add(ospite);
  for (const k of chiavi) {
    nuove[k] = h[k].map((r) => {
      const nome = R.nomePartizionatoConScadenza(r);
      if (!nome) return r;
      voceSito.nomi.add(nome);
      marcaPartizionato(sito, nome);
      return String(r).replace(/;\s*(max-age|expires)\s*=[^;]*/gi, '');
    });
  }
  voceSito.chiusoDa = 0;
  avviaGiro();
  return { responseHeaders: nuove };
}

function esitoIntestazioni(d) {
  if (modo !== 'default' || !d) return null;
  if (attesa.size) {
    try {
      const v = attesa.get(sitoDi(d.url));
      const scritte = !!v && !!v.credenziali && Date.now() - v.credenziali <= FINESTRA_INVIO_MS;
      if (v && R.richiestaDiAccesso(d, { credenziali: scritte })) v.invio = Date.now();
    } catch (_) {}
  }
  if (d.resourceType === 'mainFrame') {
    const s = sitoDi(d.url);
    if (s && d.webContentsId != null) {
      inArrivo.delete(d.webContentsId);
      inArrivo.set(d.webContentsId, { sito: s, at: Date.now() });
      while (inArrivo.size > MAX_SITI) inArrivo.delete(inArrivo.keys().next().value);
    }
    return null;
  }
  let cima = '';
  try { cima = (d.frame && d.frame.top && d.frame.top.url) || ''; } catch (_) {}
  if (!cima) return null;
  try { registraTerzaParte(d.url, cima); } catch (_) {}
  const sito = sitoDi(d.url);
  const ospite = sitoDi(cima);
  if (!sito || !ospite || sito === ospite) return null;
  return partizionatiDiSessione(d, sito, ospite);
}

// Unico ascolto onHeadersReceived della sessione (Electron ne tiene uno solo per evento): registra chi ospita chi e
// la pagina principale in arrivo; delle intestazioni tocca solo la scadenza dei cookie partizionati dei riquadri.
function aggancia(ses) {
  if (!ses || agganciata === ses) return;
  agganciata = ses;
  try {
    ses.webRequest.onHeadersReceived((d, callback) => {
      let risposta = {};
      try { risposta = esitoIntestazioni(d) || {}; } catch (_) {}
      callback(risposta);
    });
  } catch (_) {}
  try {
    // Chromium avvisa prima della sovrascrittura del vecchio cookie e poi dell'arrivo del nuovo: il primo avviso
    // si segna qui, subito, e il secondo lo consuma.
    ses.cookies.on('changed', (_e, c, cause, removed) => {
      if (!c || !c.name) return;
      const k = chiaveCookie(c);
      if (removed) {
        if (cause === 'overwrite' && !c.session) {
          preesistenti.set(k, Date.now());
          while (preesistenti.size > MAX_NOMI) preesistenti.delete(preesistenti.keys().next().value);
        }
        return;
      }
      const giaLi = preesistenti.delete(k);
      cookieCambiato(ses, c, false, giaLi).catch(() => {});
    });
  } catch (_) {}
}

// Le impostazioni cambiate da una finestra incognito valgono solo lì, e l'incognito ha la sua sessione: questi
// cookie non sono suoi (#754).
function inIncognito() {
  try { return !!require('../shim/storage').inIncognito(); } catch (_) { return false; }
}

function configureFromSettings(settings) {
  if (inIncognito()) return;
  const C = Cookies();
  const c = (settings && settings.security && settings.security.cookies) || {};
  modo = C.getMode(settings);
  fidati = new Set(C.getTrustedSites(settings).map((d) => String(d || '').toLowerCase()).filter(Boolean));
  accessi = new Set((Array.isArray(c.loggedSites) ? c.loggedSites : []).map((d) => String(d || '').toLowerCase()).filter(Boolean));
  for (const s of [...accessi, ...fidati]) { siti.delete(s); partizionati.delete(s); }
  // Fuori dall'Automatico Filo non tocca più niente: i cookie già declassati valgono per la visita e muoiono con lei.
  if (modo !== 'default') { attesa.clear(); siti.clear(); fermaGiro(); }
}

function init(settings) {
  aggancia(session.defaultSession);
  configureFromSettings(settings);
}

module.exports = {
  init,
  aggancia,
  configureFromSettings,
  navigazione,
  paginaDiAccesso,
  credenziali,
  giroDiPulizia,
  allUscita,
  margineTest,
};
