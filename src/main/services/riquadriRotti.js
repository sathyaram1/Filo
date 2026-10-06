// Il riquadro di terzi rotto dai cookie che Filo rifiuta (#760): lo riconosce (regole, poi un modello che guarda solo
// il riquadro) e propone sul posto di riattivare i cookie di quel servizio. Non decide niente sui cookie: l'eccezione
// la applicano cookieIncorporati.js (Automatico) e cookies.js (Privacy). Le regole: riquadriRottiRegole.js.

'use strict';

const crypto = require('node:crypto');
const R = require('./riquadriRottiRegole');

// Il modello guarda al massimo questi riquadri in un'ora: un sito pieno di riquadri strani non diventa una spesa.
const VISIONI_ORA = 20;
// Un servizio che il modello ha visto funzionare non si riguarda per un giorno.
const FUNZIONA_MS = 24 * 60 * 60 * 1000;
const MAX_VOCI = 500;
// Il lato lungo dell'immagine che parte: basta a leggere un segnaposto.
const LATO_MAX = 768;

let riattivati = new Set();
let chiamaModello = null;
const proposte = new Map();   // gettone → { wcId, ftn, servizio, ospite, nome, url, origin }
const visti = new Set();      // riquadri già proposti o già guardati: una volta per riquadro
const rifiutate = new Set();  // servizio|ospite a cui l'utente ha detto no, per questa sessione di Filo
const funziona = new Map();   // servizio → quando il modello l'ha visto funzionare
let visioni = [];

function Cookies() { return require('./cookies'); }
function MSG() { return (globalThis.SN_MSG && globalThis.SN_MSG.MSG) || {}; }

function tieni(set, v) {
  set.add(v);
  while (set.size > MAX_VOCI) set.delete(set.values().next().value);
}

function sitoDi(url) {
  if (!/^https?:/i.test(String(url || ''))) return null;
  try { return Cookies().registrableOf(url) || null; } catch (_) { return null; }
}

function stesso(a, b) { return a === b || !!(a && b && a.frameTreeNodeId === b.frameTreeNodeId); }

// Il riquadro che ha scritto, il suo antenato figlio della pagina (quello che la pagina vede), e i due siti.
function contesto(sender) {
  const wc = sender && sender.wc;
  const frame = sender && sender.frame;
  if (!wc || wc.isDestroyed() || !frame) return null;
  const top = wc.mainFrame;
  if (!top || stesso(frame, top)) return null;
  let figlio = frame;
  while (figlio.parent && !stesso(figlio.parent, top)) figlio = figlio.parent;
  if (!figlio.parent) return null;
  let urlFrame = '';
  let urlTop = '';
  try { urlFrame = frame.url || ''; urlTop = wc.getURL() || ''; } catch (_) { return null; }
  const servizio = sitoDi(urlFrame);
  const ospite = sitoDi(urlTop);
  if (!servizio || !ospite || servizio === ospite) return null;
  const incognito = !!(sender.win && sender.win._filoIncognito);
  return { wc, top, frame, figlio, servizio, ospite, urlFrame, urlTop, incognito };
}

// I cookie di quel servizio, in quel riquadro, li sta rifiutando Filo adesso.
function rifiutati(c) {
  if (c.incognito || riattivati.has(c.servizio)) return false;
  const C = Cookies();
  const modo = C.currentMode(false);
  if (modo === C.MODES.PRIVACY) return !C.keepsSiteData(c.ospite);
  if (modo !== C.MODES.DEFAULT) return false;
  try { return require('./cookieIncorporati').declassaQui(c.servizio, c.ospite); } catch (_) { return false; }
}

function pubblicita(url) {
  try { if (Cookies().isTrackerUrl(url)) return true; } catch (_) {}
  try { return !!require('./adblock').isBlockedUrl(url); } catch (_) { return false; }
}

function diCasa(url) {
  const N = globalThis.SN_URL_NAV;
  return !!(N && typeof N.isHomeNetworkUrl === 'function' && N.isHomeNetworkUrl(url));
}

function hostEPercorso(url) {
  try { const u = new URL(url); return { host: u.hostname, percorso: u.pathname }; } catch (_) { return { host: '', percorso: '' }; }
}

function osservazione(msg) {
  const m = msg || {};
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    testo: typeof m.testo === 'string' ? m.testo.slice(0, 4000) : '',
    parole: n(m.parole),
    media: n(m.media),
    password: !!m.password,
    larghezza: n(m.larghezza),
    altezza: n(m.altezza),
  };
}

function proponi(c, nome) {
  const token = crypto.randomUUID();
  let url = '';
  let origin = '';
  try { url = String(c.figlio.url || ''); origin = String(c.figlio.origin || ''); } catch (_) {}
  proposte.set(token, { wcId: c.wc.id, ftn: c.figlio.frameTreeNodeId, servizio: c.servizio, ospite: c.ospite, nome, url, origin });
  while (proposte.size > MAX_VOCI) proposte.delete(proposte.keys().next().value);
  try { c.top.send('filo:broadcast', { type: MSG().RIQUADRO_COOKIE_PROPONI, token, nome, url, origin }); } catch (_) {}
}

// Il rettangolo del riquadro nella pagina, letto in un mondo isolato: la pagina non lo può falsare a suo piacere.
const MONDO = 1760;
function codiceMisura(url, origin) {
  return `(() => {
  const url = ${JSON.stringify(url)}, origin = ${JSON.stringify(origin)};
  const orig = (u) => { try { return new URL(u, location.href).origin; } catch (_) { return ''; } };
  const tutti = [...document.querySelectorAll('iframe')];
  const esatti = tutti.filter((f) => f.src && new URL(f.src, location.href).href === url);
  const scelti = esatti.length ? esatti : tutti.filter((f) => orig(f.src) === origin);
  for (const f of scelti) {
    const r = f.getBoundingClientRect();
    const x = Math.max(0, r.left), y = Math.max(0, r.top);
    const w = Math.min(innerWidth, r.right) - x, h = Math.min(innerHeight, r.bottom) - y;
    if (w >= 40 && h >= 40) return { x, y, w, h };
  }
  return null;
})()`;
}

async function foto(c) {
  let r = null;
  try { r = await c.wc.executeJavaScriptInIsolatedWorld(MONDO, [{ code: codiceMisura(c.figlio.url, c.figlio.origin) }]); } catch (_) { return null; }
  if (!r) return null;
  let z = 1;
  try { z = c.wc.getZoomFactor() || 1; } catch (_) {}
  const rect = { x: Math.round(r.x * z), y: Math.round(r.y * z), width: Math.round(r.w * z), height: Math.round(r.h * z) };
  let img = null;
  try { img = await c.wc.capturePage(rect); } catch (_) { return null; }
  if (!img || img.isEmpty()) return null;
  const { width, height } = img.getSize();
  const scala = Math.min(1, LATO_MAX / Math.max(width, height));
  if (scala < 1) img = img.resize({ width: Math.round(width * scala), height: Math.round(height * scala) });
  return 'data:image/jpeg;base64,' + img.toJPEG(80).toString('base64');
}

function puoGuardare() {
  const ora = Date.now();
  visioni = visioni.filter((t) => ora - t < 60 * 60 * 1000);
  if (visioni.length >= VISIONI_ORA) return false;
  visioni.push(ora);
  return true;
}

async function guarda(c) {
  if (typeof chiamaModello !== 'function') return null;
  const quando = funziona.get(c.servizio);
  if (quando && Date.now() - quando < FUNZIONA_MS) return null;
  if (diCasa(c.urlFrame) || diCasa(c.urlTop)) return null;
  if (!puoGuardare()) return null;
  const immagine = await foto(c);
  if (!immagine) return null;
  let testo = '';
  try { testo = await chiamaModello(R.messaggi({ immagine, sito: c.servizio })); } catch (e) {
    console.warn('[Filo riquadri] riconoscimento non riuscito:', (e && e.message) || e);
    return null;
  }
  const esito = R.leggiRisposta(testo, c.servizio);
  if (esito && !esito.rotto) {
    funziona.set(c.servizio, Date.now());
    while (funziona.size > MAX_VOCI) funziona.delete(funziona.keys().next().value);
  }
  return esito;
}

// Il riquadro racconta cosa mostra; da qui in poi decide il main.
async function segnala(msg, sender) {
  const c = contesto(sender);
  if (!c) return { ok: false };
  const chiave = `${c.wc.id}|${c.figlio.frameTreeNodeId}|${c.servizio}`;
  if (visti.has(chiave) || rifiutate.has(`${c.servizio}|${c.ospite}`)) return { ok: true };
  if (!rifiutati(c) || pubblicita(c.urlFrame)) return { ok: true };
  const o = osservazione(msg);
  const { host, percorso } = hostEPercorso(c.urlFrame);
  const regola = R.riconosci({ host, percorso, testo: o.testo });
  if (regola) {
    tieni(visti, chiave);
    proponi(c, regola.nome || R.nomeDi(c.servizio, host, percorso));
    return { ok: true, via: 'regola' };
  }
  if (!R.sembraRotto(o)) return { ok: true };
  tieni(visti, chiave);
  const esito = await guarda(c);
  if (!esito || !esito.rotto || c.wc.isDestroyed() || !rifiutati(c)) return { ok: true };
  proponi(c, esito.nome);
  return { ok: true, via: 'modello' };
}

function stato(sender) {
  const c = contesto(sender);
  if (!c || c.incognito) return { ok: false };
  const { host, percorso } = hostEPercorso(c.urlFrame);
  return {
    ok: true,
    nome: R.nomeDi(c.servizio, host, percorso),
    consentito: riattivati.has(c.servizio),
    proponibile: rifiutati(c),
  };
}

async function scrivi(sito, attiva) {
  const Storage = globalThis.SN_STORAGE;
  const { applySettingsUpdate } = require('./handlers');
  const s = await Storage.getSettings();
  const prima = Cookies().getEmbedSites(s);
  if (prima.includes(sito) === attiva) return;
  const lista = attiva ? [...new Set([...prima, sito])].sort() : prima.filter((d) => d !== sito);
  await applySettingsUpdate({ security: { cookies: { embedSites: lista } } });
}

function frameDi(wcId, ftn) {
  let wc = null;
  try { wc = require('electron').webContents.fromId(wcId); } catch (_) {}
  if (!wc || wc.isDestroyed()) return null;
  try { return wc.mainFrame.framesInSubtree.find((f) => f.frameTreeNodeId === ftn) || null; } catch (_) { return null; }
}

function ritira(wc, token) {
  try { wc.mainFrame.send('filo:broadcast', { type: MSG().RIQUADRO_COOKIE_RITIRA, token }); } catch (_) {}
}

// Il tasto destro sul riquadro: riattiva o toglie i cookie del suo servizio, e il riquadro si ricarica.
async function cambia(msg, sender) {
  const c = contesto(sender);
  if (!c || c.incognito) return { ok: false };
  const attiva = !!(msg && msg.attiva);
  if (attiva && !riattivati.has(c.servizio) && !rifiutati(c)) return { ok: false };
  await scrivi(c.servizio, attiva);
  for (const [token, p] of [...proposte]) {
    if (p.wcId === c.wc.id && p.servizio === c.servizio) { proposte.delete(token); ritira(c.wc, token); }
  }
  try { c.figlio.reload(); } catch (_) {}
  return { ok: true };
}

// La risposta alla proposta arriva dalla pagina che l'ha mostrata, col gettone che le ha dato il main.
async function risposta(msg, sender) {
  const token = String((msg && msg.token) || '');
  const p = proposte.get(token);
  const wc = sender && sender.wc;
  if (!p || !wc || wc.isDestroyed() || wc.id !== p.wcId || !stesso(sender.frame, wc.mainFrame)) return { ok: false };
  proposte.delete(token);
  if (!(msg && msg.si === true)) {
    tieni(rifiutate, `${p.servizio}|${p.ospite}`);
    return { ok: true };
  }
  await scrivi(p.servizio, true);
  const f = frameDi(p.wcId, p.ftn);
  if (f) { try { f.reload(); } catch (_) {} }
  return { ok: true, ricaricato: !!f };
}

function configureFromSettings(settings) {
  try { if (require('../shim/storage').inIncognito()) return; } catch (_) {}
  riattivati = new Set(Cookies().getEmbedSites(settings));
}

function init(settings) { configureFromSettings(settings); }

// La chiamata al modello la dà handlers.js, che tiene il cancello dei modelli.
function usaModello(fn) { chiamaModello = typeof fn === 'function' ? fn : null; }

module.exports = {
  init,
  usaModello,
  configureFromSettings,
  segnala,
  stato,
  cambia,
  risposta,
  servizioTest: R.servizioTest,
};
