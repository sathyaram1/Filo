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
const FINESTRA_RIMANDO_MS = 15000;
// Il seguito di una pagina letta dalla scheda si prende dalla stessa lettura: ricopiarla a ogni pezzo costava minuti.
const SCHEDA_TTL_MS = 2 * 60 * 1000;
const TEMPO_ESTRAZIONE_MS = 20000;
// Quello che Filo ha letto dove l'utente ha fatto l'accesso (la sua scheda, un documento, un comando), per il freno.
const RISERVATE_TTL_MS = 60 * 60 * 1000;
const RISERVATE_MAX = 20;
// Un mondo isolato tutto nostro: la pagina non può ridefinire le funzioni che usa chi la legge.
const MONDO_ISOLATO = 1837;
const UA_RIPIEGO = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// Le prove sostituiscono lo scaricatore per raggiungere il loro server su 127.0.0.1, che safe-fetch giustamente rifiuta.
const dip = { scarica: safeFetch };
const cache = new Map();
const schedeLette = new Map();

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
// Deve bastare a sé stessa, perché viaggia come testo (`toString`). Le schede in secondo piano sono grandi 0×0:
// qui si guarda lo stile calcolato, mai le misure a schermo.
function serializzaVisibile() {
  const TETTO = 4000000;
  const MAX_ELEMENTI = 150000;
  const MAX_PROFONDITA = 400;
  const SALTA = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, CANVAS: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, VIDEO: 1,
    AUDIO: 1, PICTURE: 1, TEXTAREA: 1, LINK: 1, META: 1, DATALIST: 1,
  };
  // Niente `hidden` né stile: se si vede lo ha già deciso lo stile calcolato, e una classe può riaccendere un [hidden].
  const TIENI = ['id', 'class', 'role', 'href', 'open', 'itemprop', 'data-sn-ui', 'aria-hidden'];
  const VUOTI = { BR: 1, HR: 1, WBR: 1 };
  const out = [];
  let n = 0;
  let elementi = 0;
  let tagliata = false;
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
  const colore = (s) => {
    const m = /rgba?\(([^)]*)\)/.exec(s || '');
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const px = (v) => parseFloat(v);
  // Una dissolvenza in attesa (parte quando l'utente scorre fin lì) non è testo nascosto: l'utente lo vedrà.
  const animato = (cs) => (cs.transitionDuration && /[1-9]/.test(cs.transitionDuration))
    || (cs.animationName && cs.animationName !== 'none')
    || /opacity|transform/.test(cs.willChange || '')
    || (cs.transform && cs.transform !== 'none');
  // Dove nessun gesto lo mostra: trasparente, fuori dallo schermo, ritagliato, rimpicciolito a zero.
  const invisibile = (cs) => {
    if (px(cs.opacity) <= 0.05 && !animato(cs)) return true;
    if (/absolute|fixed/.test(cs.position) && [cs.left, cs.top, cs.right, cs.bottom].some((v) => px(v) <= -999)) return true;
    if (px(cs.textIndent) <= -999) return true;
    if (/rect\(\s*(?:0|1)px,?\s*(?:0|1)px/.test(cs.clip || '') || /inset\(\s*(?:50|100)%|circle\(\s*0/.test(cs.clipPath || '')) return true;
    if (/^matrix\(\s*0,\s*0,\s*0,\s*0,/.test(cs.transform || '')) return true;
    if (/hidden|clip/.test(`${cs.overflow} ${cs.overflowX} ${cs.overflowY}`) && (px(cs.maxHeight) === 0 || px(cs.height) <= 1)) return true;
    return false;
  };
  // Il colore sotto un elemento, o null se non si sa (un'immagine di sfondo, un riquadro posato sopra qualcos'altro).
  const sfondi = new Map();
  const sfondoDi = (el) => {
    const visti = [];
    let esito = null;
    for (let x = el; x && x.nodeType === 1; x = x.parentElement) {
      if (sfondi.has(x)) { esito = sfondi.get(x); break; }
      visti.push(x);
      let cs = null;
      try { cs = getComputedStyle(x); } catch (_) { break; }
      if (cs.backgroundImage && cs.backgroundImage !== 'none') break;
      // Un'immagine o un video fra i figli può stare sotto il testo: lì il colore di fondo non dice cosa si vede.
      if (x.querySelector && x.querySelector(':scope > img, :scope > video, :scope > picture, :scope > canvas, :scope > svg, :scope > iframe')) break;
      const c = colore(cs.backgroundColor);
      if (c && c.a >= 0.9) { esito = c; break; }
      if (cs.position !== 'static' && x !== document.body && x !== document.documentElement) break;
    }
    for (const v of visti) sfondi.set(v, esito);
    return esito;
  };
  const testoInvisibile = (cs, el) => {
    if (cs.visibility !== 'visible') return true;
    if (px(cs.fontSize) < 2) return true;
    const riempi = colore(cs.webkitTextFillColor) || colore(cs.color);
    if (riempi && riempi.a <= 0.05) {
      const sfumato = (cs.backgroundClip === 'text' || cs.webkitBackgroundClip === 'text') && cs.backgroundImage !== 'none';
      if (!sfumato) return true;
    }
    if (riempi && riempi.a > 0.5) {
      const bg = sfondoDi(el);
      if (bg && Math.abs(bg.r - riempi.r) + Math.abs(bg.g - riempi.g) + Math.abs(bg.b - riempi.b) < 24) return true;
    }
    return false;
  };
  const visita = (nodo, prof, csPadre, padre) => {
    if (n > TETTO || elementi > MAX_ELEMENTI || prof > MAX_PROFONDITA) { tagliata = true; return; }
    if (nodo.nodeType === 3) {
      const t = nodo.nodeValue;
      if (!t) return;
      if (/\S/.test(t) && csPadre && testoInvisibile(csPadre, padre)) return;
      out.push(esc(t));
      n += t.length;
      return;
    }
    if (nodo.nodeType !== 1) return;
    const tag = String(nodo.tagName || '').toUpperCase();
    if (SALTA[tag]) return;
    elementi++;
    let cs = null;
    try { cs = getComputedStyle(nodo); } catch (_) {}
    if (cs && (cs.display === 'none' || cs.contentVisibility === 'hidden' || invisibile(cs))) return;
    const nome = tag.toLowerCase();
    // Le voci di una tendina, l'etichetta di un bottone di modulo, il testo di un'immagine: niente valori scritti
    // dall'utente nei campi.
    if (tag === 'SELECT') {
      const voci = Array.from(nodo.options || []).map((o) => `<option>${esc(o.text || '')}</option>`).join('');
      out.push(`<select>${voci}</select>`);
      return;
    }
    if (tag === 'INPUT') {
      const tipo = String(nodo.type || '').toLowerCase();
      if (/^(submit|button|reset)$/.test(tipo) && nodo.value) out.push(`<input type="${tipo}" value="${escA(nodo.value)}">`);
      return;
    }
    if (tag === 'IMG') {
      if (nodo.alt) out.push(`<img alt="${escA(nodo.alt)}">`);
      return;
    }
    let attrs = '';
    for (const a of TIENI) {
      const v = nodo.getAttribute(a);
      if (v == null) continue;
      attrs += ` ${a}="${escA(a === 'href' && typeof nodo.href === 'string' ? nodo.href : v)}"`;
    }
    out.push(`<${nome}${attrs}>`);
    if (VUOTI[tag]) return;
    for (const c of Array.from(figli(nodo))) visita(c, prof + 1, cs, nodo);
    out.push(`</${nome}>`);
  };
  const d = document;
  visita(d.body || d.documentElement, 0, null, null);
  const lang = d.documentElement.getAttribute('lang') || '';
  const m = d.querySelector('meta[name="description"]');
  const desc = (m && m.getAttribute('content')) || '';
  return {
    url: location.href,
    tagliata,
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

// Le schede che Filo apre per leggerle: l'indirizzo chiesto resta legato alla scheda anche se il sito rimanda
// altrove appena caricato, così «aprila e rileggila con lo stesso indirizzo» ritrova la scheda.
const aperture = new WeakMap();
function ricordaApertura(wc, url) {
  const n = normalizzaUrl(url);
  const k = n.url ? chiaveConfronto(n.url) : '';
  if (!wc || !k || typeof wc.on !== 'function') return;
  const rec = { richiesto: k, arrivi: new Set([k]), t0: Date.now() };
  aperture.set(wc, rec);
  const segna = (_e, u) => {
    if (Date.now() - rec.t0 > FINESTRA_RIMANDO_MS) return;
    const c = chiaveConfronto(u);
    if (c) rec.arrivi.add(c);
  };
  wc.on('did-navigate', segna);
  wc.on('did-navigate-in-page', segna);
  const t = setTimeout(() => {
    try { wc.removeListener('did-navigate', segna); wc.removeListener('did-navigate-in-page', segna); } catch (_) {}
  }, FINESTRA_RIMANDO_MS);
  if (t && typeof t.unref === 'function') t.unref();
}

function trovaScheda(url, schede) {
  const k = chiaveConfronto(url);
  if (!k || !Array.isArray(schede)) return null;
  let perRimando = null;
  for (const s of schede) {
    if (!s || !s.wc) continue;
    let u = '';
    try { u = s.wc.getURL(); } catch (_) {}
    const qui = chiaveConfronto(u || s.url);
    if (qui === k) return s;
    // Solo se la scheda sta ancora dove l'ha portata il rimando: se poi l'utente è andato altrove, non è più lei.
    const rec = aperture.get(s.wc);
    if (!perRimando && rec && rec.richiesto === k && rec.arrivi.has(qui)) perRimando = s;
  }
  return perRimando;
}

// Il parere del rilevatore di siti pericolosi. `analyze` avvia anche le verifiche di rete: la seconda domanda, a
// download finito, trova le risposte arrivate nel frattempo.
function verdetto(url) {
  const SB = globalThis.SN_SAFEBROWSE;
  if (!SB) return null;
  try {
    const v = typeof SB.analyze === 'function' ? SB.analyze(url, { senzaApprofondire: true }) : SB.checkSync(url, {});
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

// Il tetto si sceglie dai primi byte: un PDF servito come file generico ha il tetto dei PDF, non quello delle pagine.
async function leggiCorpo(res, limiteDi) {
  const reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    const limite = limiteDi(buf);
    return { buf: buf.subarray(0, limite), tagliato: buf.length > limite };
  }
  const pezzi = [];
  let tot = 0;
  let limite = 0;
  let tagliato = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pezzi.push(Buffer.from(value));
    tot += value.byteLength;
    if (!limite && tot >= 8) limite = limiteDi(Buffer.concat(pezzi).subarray(0, 8));
    if (limite && tot > limite) { tagliato = true; break; }
  }
  if (tagliato) { try { await reader.cancel(); } catch (_) {} }
  const buf = Buffer.concat(pezzi);
  if (!limite) limite = limiteDi(buf);
  return { buf: buf.subarray(0, limite), tagliato };
}

function charsetDi(tipo, buf) {
  let m = /charset\s*=\s*["']?([\w.:-]+)/i.exec(tipo || '');
  if (m) return m[1];
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf-8';
  if (buf[0] === 0xff && buf[1] === 0xfe) return 'utf-16le';
  if (buf[0] === 0xfe && buf[1] === 0xff) return 'utf-16be';
  // Dove la dichiara un sito vecchio: in tutta l'intestazione, anche dopo una lunga fila di fogli di stile.
  let testa = buf.subarray(0, 65536).toString('latin1');
  const corpo = testa.search(/<body[\s>]/i);
  if (corpo > 0) testa = testa.slice(0, corpo);
  m = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(testa) || /^\s*<\?xml[^>]+encoding\s*=\s*["']([\w.:-]+)/i.exec(testa);
  return m ? m[1] : 'utf-8';
}

// Da 0x80 a 0x9F in windows-1252, che è ciò che un browser intende anche per «iso-8859-1». Il decodificatore di
// Electron li lascia come caratteri di controllo: l'euro di una pagina italiana vecchia sparirebbe.
const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
function decodifica(buf, charset) {
  let d;
  try { d = new TextDecoder(charset, { fatal: false }); } catch (_) { d = new TextDecoder('utf-8', { fatal: false }); }
  const t = d.decode(buf);
  return d.encoding === 'windows-1252' ? t.replace(/[\u0080-\u009f]/g, (c) => CP1252[c.charCodeAt(0) - 0x80]) : t;
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
      letto = await leggiCorpo(res, (testa) => (perPdf || testa.subarray(0, 5).toString('latin1') === '%PDF-' ? MAX_PDF_BYTES : MAX_HTML_BYTES));
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
      let e;
      try { e = await estraiInDisparte(grezzo, finale); } catch (err) { return { ok: false, url: finale, ...esitoEstrazione(err) }; }
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
  // Una scheda che non mostra testo (il visore di un PDF, una pagina ancora bianca) non è l'ultima parola: si prova
  // anche a scaricarla, e se nemmeno la rete la dà si riferisce la scheda vuota.
  let schedaVuota = null;
  const scheda = trovaScheda(url, schede);
  if (scheda) {
    const chiave = `${scheda.wc.id}|${url}`;
    const ricordata = Number(da) > 0 ? schedeLette.get(chiave) : null;
    if (ricordata && Date.now() - ricordata.t <= SCHEDA_TTL_MS) {
      esito = ricordata.esito;
      fonte = 'scheda';
    } else {
      try {
        const r = await leggiDallaScheda(scheda.wc);
        if (r) {
          const e = await estraiInDisparte(r.html, r.url || url);
          const letto = { ok: true, url: r.url || url, titolo: e.titolo, testo: e.testo, soloJavaScript: false, lettaInParte: !!r.tagliata };
          if (e.testo.trim()) {
            esito = letto;
            fonte = 'scheda';
            schedeLette.set(chiave, { t: Date.now(), esito: letto });
            while (schedeLette.size > CACHE_MAX) schedeLette.delete(schedeLette.keys().next().value);
            ricordaLetturaRiservata(letto.testo, letto.url);
          } else schedaVuota = letto;
        }
      } catch (_) { esito = null; }
    }
  }
  if (!esito) {
    esito = daCache(url);
    if (!esito) {
      esito = await scaricaPagina(url);
      if (esito.ok) inCache(url, esito);
    }
    if (schedaVuota && (!esito.ok || !String(esito.testo || '').trim())) { esito = schedaVuota; fonte = 'scheda'; }
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
    lettaInParte: !!esito.lettaInParte,
    soloJavaScript: !!esito.soloJavaScript,
    sospetto: v && v.livello === 'sospetto' ? (v.messaggio || 'sito sospetto') : '',
    ...p,
  };
}

// Estrazione in un thread a parte, col suo tetto di tempo: una pagina scritta male o apposta non ferma le finestre
// di Filo, e se non finisce si abbandona dicendolo. Il codice viaggia come testo, così vale anche dentro l'asar.
let codiceEstrattore = '';
function estraiInDisparte(html, url) {
  if (!codiceEstrattore) {
    const src = require('fs').readFileSync(require.resolve('./pageText'), 'utf8');
    codiceEstrattore = `const module = { exports: {} };\n(function (module, exports) {\n${src}\n})(module, module.exports);\n`
      + 'const { parentPort, workerData } = require(\'worker_threads\');\n'
      + 'parentPort.postMessage(module.exports.estrai(workerData.html, { url: workerData.url }));\n';
  }
  return new Promise((ok, no) => {
    let w;
    try {
      const { Worker } = require('worker_threads');
      w = new Worker(codiceEstrattore, { eval: true, workerData: { html: String(html == null ? '' : html), url: String(url || '') } });
    } catch (_) {
      // Senza thread (un ambiente che non li dà) si estrae qui: lento su una pagina enorme, ma la lettura riesce.
      try { ok(PT.estrai(html, { url })); } catch (e) { no(e); }
      return;
    }
    let finito = false;
    const chiudi = (fn, v) => { if (finito) return; finito = true; clearTimeout(t); try { w.terminate(); } catch (_) {} fn(v); };
    const t = setTimeout(() => chiudi(no, new Error('estrazione-lunga')), TEMPO_ESTRAZIONE_MS);
    w.once('message', (r) => chiudi(ok, r));
    w.once('error', (e) => chiudi(no, e));
    w.once('exit', (c) => chiudi(no, new Error(`estrazione-uscita-${c}`)));
  });
}

function esitoEstrazione(err) {
  if (String((err && err.message) || '') === 'estrazione-lunga') {
    return { errore: 'complessa', dettaglio: 'la pagina è troppo complessa da leggere in tempo' };
  }
  return { errore: 'lettura', dettaglio: 'il testo della pagina non si è lasciato estrarre' };
}

// Il freno contro l'esfiltrazione confronta l'indirizzo in uscita con quello che Filo ha letto dove l'utente ha fatto
// l'accesso. Solo i pezzi che identificano (codici, numeri lunghi, email), non le parole: il titolo di un articolo
// letto e poi aperto non è un dato che esce. I link che quella pagina conteneva si seguono senza allarme.
const riservate = [];
function ricordaLetturaRiservata(testo, url) {
  const t = String(testo || '');
  if (!t.trim()) return;
  const pezzi = new Set();
  for (const m of t.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) pezzi.add(m[0].toLowerCase());
  const compatto = t.replace(/(\d)[ .\-](?=\d)/g, '$1');
  for (const w of compatto.split(/[^A-Za-z0-9]+/)) {
    if (w.length >= 8 && (w.match(/\d/g) || []).length >= 4) pezzi.add(w.toLowerCase());
  }
  const link = new Set();
  for (const m of t.matchAll(/\]\((https?:\/\/[^\s)]+)\)/g)) link.add(chiaveLink(m[1]));
  if (url) link.add(chiaveLink(url));
  riservate.push({ t: Date.now(), pezzi, link });
  while (riservate.length > RISERVATE_MAX) riservate.shift();
}

function chiaveLink(u) {
  try { const x = new URL(u); x.hash = ''; return x.href.toLowerCase(); } catch (_) { return String(u || '').toLowerCase(); }
}

// Il materiale da confrontare per un indirizzo: vuoto se l'indirizzo è un link di una di quelle pagine.
function materialeRiservato(indirizzo) {
  const ora = Date.now();
  while (riservate.length && ora - riservate[0].t > RISERVATE_TTL_MS) riservate.shift();
  if (!riservate.length) return '';
  const k = chiaveLink(indirizzo);
  if (riservate.some((r) => r.link.has(k))) return '';
  const tutti = new Set();
  for (const r of riservate) for (const p of r.pezzi) tutti.add(p);
  return [...tutti].join('\n');
}

const api = {
  leggiPagina,
  ricordaApertura,
  ricordaLetturaRiservata,
  materialeRiservato,
  estraiInDisparte,
  normalizzaUrl,
  chiaveConfronto,
  porzione,
  serializzaVisibile,
  MAX_TEXT_CHARS,
  _dip: dip,
  _cache: cache,
  _riservate: riservate,
};
globalThis.SN_LETTURA_PAGINE = api;
module.exports = api;
