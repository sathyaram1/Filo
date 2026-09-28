// L'azione LEGGI_PAGINA: il testo di una pagina web, dalla scheda di Filo se è già aperta, se no scaricato.
// Non scarica indirizzi della rete locale (safe-fetch) e non legge un sito segnalato pericoloso.
// Cosa è contenuto lo decide pageText.js; prove in tests/unit/pageRead.test.mjs e tests/leggi-pagina.spec.mjs.

'use strict';

const { safeFetch } = require('./safe-fetch');
const PT = require('./pageText');

// Circa 7-8 mila parole: una pagina vera ci sta quasi sempre intera, e quella che non ci sta si legge a pezzi con `da`.
const MAX_TEXT_CHARS = 30000;
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 15000;
const ATTESA_SCHEDA_MS = 10000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 30;
// Un mondo isolato tutto nostro: la pagina non può ridefinire le funzioni che usa chi la legge.
const MONDO_ISOLATO = 1837;
const UA_RIPIEGO = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// Le prove sostituiscono lo scaricatore per raggiungere il loro server su 127.0.0.1, che safe-fetch giustamente rifiuta.
const dip = { scarica: safeFetch };
const cache = new Map();

function normalizzaUrl(input) {
  let s = String(input == null ? '' : input).trim().replace(/^[<"'«]+|[>"'»]+$/g, '').trim();
  if (!s) return { errore: 'indirizzo' };
  if (/^\/\//.test(s)) s = `https:${s}`;
  else if (/^[^\s/:]+:\d+(?:[/?#]|$)/.test(s)) s = `http://${s}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    if (!/^[^\s/]+\.[^\s/]+/.test(s)) return { errore: 'indirizzo' };
    s = `https://${s}`;
  }
  let u;
  try { u = new URL(s); } catch (_) { return { errore: 'indirizzo' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { errore: 'schema' };
  u.username = '';
  u.password = '';
  u.hash = '';
  return { url: u.href };
}

// Stessa pagina a meno di www, barra finale e frammento: è così che un indirizzo dei risultati ritrova la sua scheda.
function chiaveConfronto(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return `${host}${u.port ? `:${u.port}` : ''}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch (_) { return ''; }
}

// Gira DENTRO la pagina: serializza solo ciò che si vede, senza script, entrando nelle shadow root aperte.
// Deve bastare a sé stessa, perché viaggia come testo (`toString`).
function serializzaVisibile() {
  const TETTO = 4000000;
  const SALTA = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, CANVAS: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, VIDEO: 1,
    AUDIO: 1, IMG: 1, PICTURE: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, LINK: 1, META: 1,
  };
  const TIENI = ['id', 'class', 'role', 'href', 'aria-hidden', 'hidden', 'open', 'itemprop', 'data-sn-ui'];
  const VUOTI = { BR: 1, HR: 1, WBR: 1 };
  const out = [];
  let n = 0;
  let elementi = 0;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escA = (s) => esc(s).replace(/"/g, '&quot;');
  const figli = (el) => {
    if (el.shadowRoot) return el.shadowRoot.childNodes;
    if (el.tagName === 'SLOT' && el.assignedNodes) {
      const a = el.assignedNodes({ flatten: true });
      if (a.length) return a;
    }
    return el.childNodes;
  };
  const visita = (nodo, prof) => {
    if (n > TETTO || elementi > 150000 || prof > 400) return;
    if (nodo.nodeType === 3) {
      const t = nodo.nodeValue;
      if (t) { out.push(esc(t)); n += t.length; }
      return;
    }
    if (nodo.nodeType !== 1) return;
    const tag = String(nodo.tagName || '').toUpperCase();
    if (SALTA[tag]) return;
    elementi++;
    let cs = null;
    try { cs = getComputedStyle(nodo); } catch (_) {}
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse')) return;
    const nome = tag.toLowerCase();
    let attrs = '';
    for (const a of TIENI) {
      const v = nodo.getAttribute(a);
      if (v == null) continue;
      attrs += ` ${a}="${escA(a === 'href' && typeof nodo.href === 'string' ? nodo.href : v)}"`;
    }
    out.push(`<${nome}${attrs}>`);
    if (VUOTI[tag]) return;
    for (const c of Array.from(figli(nodo))) visita(c, prof + 1);
    out.push(`</${nome}>`);
  };
  const d = document;
  visita(d.body || d.documentElement, 0);
  const lang = d.documentElement.getAttribute('lang') || '';
  const m = d.querySelector('meta[name="description"]');
  const desc = (m && m.getAttribute('content')) || '';
  return {
    url: location.href,
    html: `<html lang="${escA(lang)}"><head><title>${esc(d.title || '')}</title>`
      + `<meta name="description" content="${escA(desc)}"></head>${out.join('')}</html>`,
  };
}

function conScadenza(promessa, ms) {
  let t;
  return Promise.race([
    promessa,
    new Promise((_, no) => { t = setTimeout(() => no(new Error('scaduto')), ms); }),
  ]).finally(() => clearTimeout(t));
}

function attendiCaricamento(wc, ms) {
  return new Promise((ok) => {
    const t = setTimeout(ok, ms);
    try {
      wc.once('did-stop-loading', () => { clearTimeout(t); ok(); });
    } catch (_) { clearTimeout(t); ok(); }
  });
}

async function leggiDallaScheda(wc) {
  if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return null;
  if (typeof wc.isLoading === 'function' && wc.isLoading()) {
    await attendiCaricamento(wc, ATTESA_SCHEDA_MS);
    // Una pagina che si costruisce in JavaScript scrive il contenuto un attimo dopo la fine del caricamento.
    await new Promise((r) => setTimeout(r, 500));
  }
  if (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) return null;
  const codice = `(${serializzaVisibile.toString()})()`;
  const r = await conScadenza(wc.executeJavaScriptInIsolatedWorld(MONDO_ISOLATO, [{ code: codice }]), 8000);
  return r && typeof r.html === 'string' ? r : null;
}

function trovaScheda(url, schede) {
  const k = chiaveConfronto(url);
  if (!k || !Array.isArray(schede)) return null;
  for (const s of schede) {
    if (!s || !s.wc) continue;
    let u = '';
    try { u = s.wc.getURL(); } catch (_) {}
    if (chiaveConfronto(u || s.url) === k) return s;
  }
  return null;
}

// Il parere del rilevatore di siti pericolosi. `analyze` avvia anche le verifiche di rete: la seconda domanda, a
// download finito, trova le risposte arrivate nel frattempo.
function verdetto(url) {
  const SB = globalThis.SN_SAFEBROWSE;
  if (!SB) return null;
  try {
    const v = typeof SB.analyze === 'function' ? SB.analyze(url, {}) : SB.checkSync(url, {});
    return v && v.level ? { livello: v.level, messaggio: v.message || '' } : null;
  } catch (_) { return null; }
}

function intestazioni() {
  let ua = '';
  let lingua = 'it-IT,it;q=0.9,en;q=0.8';
  try {
    const { app } = require('electron');
    if (app) {
      ua = app.userAgentFallback || '';
      const l = typeof app.getLocale === 'function' ? app.getLocale() : '';
      if (l) lingua = `${l},${l.split('-')[0]};q=0.9,en;q=0.8`;
    }
  } catch (_) {}
  return {
    'User-Agent': ua && !/Electron\//.test(ua) ? ua : UA_RIPIEGO,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,application/pdf;q=0.7,*/*;q=0.5',
    'Accept-Language': lingua,
  };
}

async function leggiCorpo(res, limite) {
  const reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { buf: buf.subarray(0, limite), tagliato: buf.length > limite };
  }
  const pezzi = [];
  let tot = 0;
  let tagliato = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pezzi.push(Buffer.from(value));
    tot += value.byteLength;
    if (tot > limite) { tagliato = true; break; }
  }
  if (tagliato) { try { await reader.cancel(); } catch (_) {} }
  return { buf: Buffer.concat(pezzi).subarray(0, limite), tagliato };
}

function charsetDi(tipo, buf) {
  let m = /charset\s*=\s*["']?([\w.:-]+)/i.exec(tipo || '');
  if (m) return m[1];
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf-8';
  if (buf[0] === 0xff && buf[1] === 0xfe) return 'utf-16le';
  if (buf[0] === 0xfe && buf[1] === 0xff) return 'utf-16be';
  m = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(buf.subarray(0, 4096).toString('latin1'));
  return m ? m[1] : 'utf-8';
}

function decodifica(buf, charset) {
  try { return new TextDecoder(charset, { fatal: false }).decode(buf); } catch (_) {
    return new TextDecoder('utf-8', { fatal: false }).decode(buf);
  }
}

function pareHtml(testa) {
  return /^\s*(?:<!--[\s\S]*?-->\s*)*<(?:!doctype\s+html|html|head|body)[\s>]/i.test(testa);
}

function nomeDaUrl(url) {
  try {
    const u = new URL(url);
    const ultimo = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return ultimo || u.hostname;
  } catch (_) { return ''; }
}

const MOTIVI_RETE = {
  'blocked-private-address': ['rete-locale', 'indirizzo della rete locale'],
  'blocked-scheme': ['schema', 'non è una pagina web'],
  'bad-url': ['indirizzo', 'indirizzo non valido'],
  'too-many-redirects': ['redirect', 'troppi rimandi da una pagina all\'altra'],
  'dns-empty': ['dns', 'il sito non esiste o non risponde'],
};

function esitoErroreRete(e) {
  const msg = String((e && e.message) || e || '');
  if (MOTIVI_RETE[msg]) return { errore: MOTIVI_RETE[msg][0], dettaglio: MOTIVI_RETE[msg][1] };
  if ((e && e.name === 'AbortError') || msg === 'scaduto' || /abort/i.test(msg)) return { errore: 'tempo', dettaglio: 'il sito non ha risposto in tempo' };
  const code = String((e && (e.code || (e.cause && e.cause.code))) || '');
  if (/ENOTFOUND|EAI_AGAIN/.test(code) || /ENOTFOUND|getaddrinfo/.test(msg)) return { errore: 'dns', dettaglio: 'il sito non esiste o non risponde' };
  return { errore: 'rete', dettaglio: 'il sito non risponde' };
}

function dettaglioHttp(stato) {
  if (stato === 404 || stato === 410) return `la pagina non esiste (${stato})`;
  if (stato === 401 || stato === 403) return `il sito non si lascia leggere (${stato})`;
  if (stato === 429) return 'il sito rifiuta troppe richieste (429)';
  if (stato >= 500) return `il sito ha un problema (${stato})`;
  return `il sito ha risposto ${stato}`;
}

async function scaricaPagina(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    let res;
    try {
      res = await dip.scarica(url, { signal: ac.signal, headers: intestazioni() });
    } catch (e) { return { ok: false, ...esitoErroreRete(e) }; }
    const finale = (res && res.url) || url;
    if (!res.ok) {
      try { res.body && res.body.cancel && res.body.cancel(); } catch (_) {}
      return { ok: false, url: finale, errore: 'http', stato: res.status, dettaglio: dettaglioHttp(res.status) };
    }
    const tipo = String((res.headers && res.headers.get && res.headers.get('content-type')) || '').toLowerCase();
    const perPdf = /application\/pdf/.test(tipo) || /\.pdf$/i.test(new URL(finale).pathname);
    let letto;
    try {
      letto = await leggiCorpo(res, perPdf ? MAX_PDF_BYTES : MAX_HTML_BYTES);
    } catch (e) { return { ok: false, url: finale, ...esitoErroreRete(e) }; }
    const { buf, tagliato } = letto;
    const base = { ok: true, url: finale, tipo, scaricataInParte: tagliato };
    if (buf.subarray(0, 5).toString('latin1') === '%PDF-') {
      if (tagliato) return { ok: false, url: finale, errore: 'troppo-grande', dettaglio: 'il PDF supera i 25 MB' };
      let r;
      try { r = await require('./documentRead').extractPdf(buf); } catch (_) {
        return { ok: false, url: finale, errore: 'pdf', dettaglio: 'il PDF non si apre' };
      }
      const testo = String(r.text || '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (!testo) return { ok: false, url: finale, errore: 'pdf-immagine', dettaglio: 'è un PDF fatto di immagini, senza testo' };
      return { ...base, tipo: 'application/pdf', titolo: nomeDaUrl(finale), testo, pagine: r.pages || 0 };
    }
    const charset = charsetDi(tipo, buf);
    const grezzo = decodifica(buf, charset);
    const html = /html|xhtml/.test(tipo) || (!tipo && pareHtml(grezzo.slice(0, 2048)))
      || (/^text\/plain/.test(tipo) && pareHtml(grezzo.slice(0, 2048)));
    if (html) {
      const e = PT.estrai(grezzo, { url: finale });
      return { ...base, titolo: e.titolo, descrizione: e.descrizione, lingua: e.lingua, testo: e.testo, soloJavaScript: e.soloJavaScript };
    }
    if (!tipo || /^text\/|json|xml|csv|markdown|yaml|javascript/.test(tipo)) {
      const testo = grezzo.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
      return { ...base, titolo: nomeDaUrl(finale), testo };
    }
    const breve = tipo.split(';')[0].trim();
    return { ok: false, url: finale, errore: 'tipo', tipo: breve, dettaglio: `è un file ${breve}, non una pagina da leggere` };
  } finally {
    clearTimeout(t);
  }
}

function daCache(url) {
  const e = cache.get(url);
  if (!e) return null;
  if (Date.now() - e.t > CACHE_TTL_MS) { cache.delete(url); return null; }
  return e.esito;
}

function inCache(url, esito) {
  cache.delete(url);
  cache.set(url, { t: Date.now(), esito });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

// Il pezzo da `da` in poi, lungo al massimo il tetto. Se può, taglia a un a capo, così il seguito riparte da una riga intera.
function porzione(testo, da) {
  const totale = testo.length;
  const inizio = Math.max(0, Math.min(Number.isFinite(da) ? Math.floor(da) : 0, totale));
  let fine = Math.min(totale, inizio + MAX_TEXT_CHARS);
  if (fine < totale) {
    const a = testo.lastIndexOf('\n', fine);
    if (a > inizio + MAX_TEXT_CHARS * 0.8) fine = a + 1;
    const c = testo.charCodeAt(fine - 1);
    if (c >= 0xd800 && c <= 0xdbff) fine -= 1;
  }
  return { testo: testo.slice(inizio, fine), da: inizio, fino: fine, totale, troncata: fine < totale };
}

/**
 * Legge una pagina web e ne restituisce il testo leggibile, a pezzi da MAX_TEXT_CHARS.
 * `schede`: le schede aperte in cui cercarla prima di scaricarla, come [{ wc, url }].
 * Esito sempre nella stessa forma: chi lo formatta per il modello non deve indovinare niente.
 */
async function leggiPagina(input, { da = 0, schede = [] } = {}) {
  const richiesto = String(input == null ? '' : input).trim();
  const vuoto = {
    pageRead: richiesto, ok: false, url: '', titolo: '', testo: '', fonte: '', da: 0, fino: 0, totale: 0,
    troncata: false, soloJavaScript: false, sospetto: '', errore: null, dettaglio: '', stato: 0,
  };
  const n = normalizzaUrl(richiesto);
  if (n.errore) {
    return { ...vuoto, errore: n.errore, dettaglio: n.errore === 'schema' ? 'non è una pagina web' : 'indirizzo non valido' };
  }
  const url = n.url;
  const pericolo = (u) => {
    const v = verdetto(u);
    if (v && v.livello === 'pericoloso') return { ...vuoto, url: u, errore: 'pericoloso', dettaglio: 'sito segnalato come pericoloso', motivo: v.messaggio };
    return null;
  };
  const primo = pericolo(url);
  if (primo) return primo;

  let esito = null;
  let fonte = 'rete';
  const scheda = trovaScheda(url, schede);
  if (scheda) {
    try {
      const r = await leggiDallaScheda(scheda.wc);
      if (r) {
        const e = PT.estrai(r.html, { url: r.url || url });
        esito = { ok: true, url: r.url || url, titolo: e.titolo, testo: e.testo, soloJavaScript: false };
        fonte = 'scheda';
      }
    } catch (_) { esito = null; }
  }
  if (!esito) {
    esito = daCache(url);
    if (!esito) {
      esito = await scaricaPagina(url);
      if (esito.ok) inCache(url, esito);
    }
  }
  if (!esito.ok) return { ...vuoto, ...esito, pageRead: richiesto, url: esito.url || url };
  const dopo = pericolo(esito.url);
  if (dopo) return dopo;
  const v = verdetto(esito.url);
  const p = porzione(String(esito.testo || ''), Number(da));
  return {
    ...vuoto,
    ok: true,
    url: esito.url,
    titolo: String(esito.titolo || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(),
    fonte,
    tipo: esito.tipo || '',
    pagine: esito.pagine || 0,
    scaricataInParte: !!esito.scaricataInParte,
    soloJavaScript: !!esito.soloJavaScript,
    sospetto: v && v.livello === 'sospetto' ? (v.messaggio || 'sito sospetto') : '',
    ...p,
  };
}

const api = {
  leggiPagina,
  normalizzaUrl,
  chiaveConfronto,
  porzione,
  serializzaVisibile,
  MAX_TEXT_CHARS,
  _dip: dip,
  _cache: cache,
};
globalThis.SN_LETTURA_PAGINE = api;
module.exports = api;
