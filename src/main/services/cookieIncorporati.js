// Cookie dei contenuti incorporati di terzi (#758), modalità Automatico: restano per la visita e non oltre.
// Non tocca il sito principale di una scheda, i siti dove hai un account (`loggedSites`) e i siti fidati.
// Le decisioni stanno in cookieIncorporatiRegole.js; il resto della gestione cookie in cookies.js.

'use strict';

const { session } = require('electron');
const R = require('./cookieIncorporatiRegole');

// «Qualche minuto» dopo l'ultima scheda che ospitava il riquadro: chi riapre l'articolo un attimo dopo non perde
// quello che il riquadro stava facendo (un video a metà, un commento scritto).
const MARGINE_MS = 3 * 60 * 1000;
// Da quando si vede la pagina di accesso a quando il cookie di sessione deve arrivare: un accesso lento ci sta dentro.
const ATTESA_ACCESSO_MS = 10 * 60 * 1000;
const MAX_SITI = 500;
const MAX_NOMI = 200;
const GIRO_MS = 30 * 1000;

let margine = MARGINE_MS;
// Solo i test accorciano il margine: nell'app lo decide MARGINE_MS.
function margineTest(ms) {
  if (process.env.NODE_ENV === 'test' && Number(ms) > 0) margine = Number(ms);
}

// sito incorporato → { ospiti: siti che lo ospitavano, nomi: cookie declassati, chiusoDa, at }
const siti = new Map();
// sito → { at, prima: nome → valore } dalla pagina di accesso: il cookie che arriva dopo dice che sei entrato.
const attesa = new Map();

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

function protetti() {
  const out = new Set(accessi);
  for (const d of fidati) out.add(d);
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

// Il cookie torna identico ma senza scadenza: vale per la visita e non oltre. La pagina continua a leggerlo.
async function declassa(ses, c) {
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
}

// L'accesso osservato: pagina di accesso del sito, e dopo un cookie di sessione suo che prima non c'era.
function paginaDiAccesso(url) {
  if (modo !== 'default') return;
  if (!/^https?:/i.test(String(url || ''))) return;
  const sito = sitoDi(url);
  if (!sito || accessi.has(sito)) return;
  attesa.set(sito, { at: Date.now(), prima: new Map() });
  const ses = agganciata;
  if (!ses) return;
  // La foto dei cookie di adesso: senza, un cookie già lì che si rinfresca sembrerebbe un accesso appena fatto.
  ses.cookies.get({ domain: sito }).then((lista) => {
    const v = attesa.get(sito);
    if (!v) return;
    for (const c of lista || []) v.prima.set(c.name, c.value);
  }).catch(() => {});
}

// La pagina di accesso riconosciuta dall'indirizzo (#209): il resto lo dice il campo password che la pagina segnala.
function navigazione(url) {
  if (modo !== 'default') return;
  const AP = globalThis.SN_AUTH_POPUP;
  if (!AP || !AP.isAuthPopup(String(url || ''))) return;
  paginaDiAccesso(url);
}

function segnaAccesso(sito) {
  if (!sito || accessi.has(sito)) return;
  accessi.add(sito);
  attesa.delete(sito);
  siti.delete(sito);
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

async function cookieCambiato(ses, c, removed) {
  if (removed || !c || !c.name) return;
  const sito = sitoDi(urlDi(c));
  if (!sito) return;
  const inAttesa = attesa.get(sito);
  if (inAttesa) {
    if (Date.now() - inAttesa.at > ATTESA_ACCESSO_MS) attesa.delete(sito);
    else if (R.segnaleDiAccesso(c, inAttesa.prima)) { segnaAccesso(sito); return; }
  }
  if (c.session || modo !== 'default') return;
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
  try { await declassa(ses, c); } catch (_) { return; }
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
    if (esito.azione === 'dimentica') { siti.delete(sito); continue; }
    siti.delete(sito);
    let lista = [];
    try { lista = await ses.cookies.get({ domain: sito }); } catch (_) { continue; }
    for (const c of lista) {
      // Solo quelli che abbiamo declassato noi e che sono ancora di sessione: se un tuo accesso ne ha riscritto
      // uno con scadenza, quello è tuo e non si tocca.
      if (!c.session || !v.nomi.has(c.name)) continue;
      try { await ses.cookies.remove(urlDi(c), c.name); } catch (_) {}
    }
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

// Unico ascolto onHeadersReceived della sessione (Electron ne tiene uno solo per evento): qui si registra solo
// chi ospita chi, le intestazioni non si toccano.
function aggancia(ses) {
  if (!ses || agganciata === ses) return;
  agganciata = ses;
  try {
    ses.webRequest.onHeadersReceived((d, callback) => {
      callback({});
      if (modo !== 'default' || !d || d.resourceType === 'mainFrame') return;
      let cima = '';
      try { cima = (d.frame && d.frame.top && d.frame.top.url) || ''; } catch (_) {}
      if (cima) { try { registraTerzaParte(d.url, cima); } catch (_) {} }
    });
  } catch (_) {}
  try {
    ses.cookies.on('changed', (_e, c, _cause, removed) => { cookieCambiato(ses, c, removed).catch(() => {}); });
  } catch (_) {}
}

function configureFromSettings(settings) {
  const C = Cookies();
  const c = (settings && settings.security && settings.security.cookies) || {};
  modo = C.getMode(settings);
  fidati = new Set(C.getTrustedSites(settings).map((d) => String(d || '').toLowerCase()).filter(Boolean));
  accessi = new Set((Array.isArray(c.loggedSites) ? c.loggedSites : []).map((d) => String(d || '').toLowerCase()).filter(Boolean));
  for (const s of accessi) siti.delete(s);
  for (const s of fidati) siti.delete(s);
  if (modo !== 'default') { attesa.clear(); }
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
  giroDiPulizia,
  margineTest,
  _stato: () => ({ modo, accessi: [...accessi], siti: [...siti.keys()], attesa: [...attesa.keys()] }),
};
