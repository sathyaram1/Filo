// Lettura del TESTO di una pagina web (azione LEGGI_PAGINA).
//
// Il buco che chiude: la chat poteva cercare sul web (titolo, indirizzo e un
// riassunto di 240 caratteri) e aprire una scheda, ma il contenuto della pagina
// non tornava mai al modello. Per qualunque dato che sta DENTRO una pagina — un
// prezzo, un punteggio, un orario, una clausola — Filo poteva solo indovinare
// dal riassunto o rimandare l'utente a leggere da sé.
//
// SOLA LETTURA: scarica e basta. Non esegue lo JavaScript della pagina, non
// manda niente e non tocca il disco.
//
// DUE STRADE, e la prima vince. Se la pagina è già aperta in una scheda di
// Filo si legge il TESTO RESO di quella scheda: copre i siti che si
// costruiscono in JavaScript (dove l'HTML scaricato è un guscio vuoto), non
// ripaga un secondo scaricamento e vede la pagina esattamente come la vede
// l'utente — comprese quelle dietro a un login. Altrimenti si scarica, con le
// stesse guardie anti-SSRF delle altre richieste del main (safe-fetch.js).
//
// IL TESTO CHE ESCE DA QUI È DI SCONOSCIUTI. Lo scrive chi possiede il sito, ed
// entra nel prompt imbustato come ogni altro contenuto esterno (handlers.js →
// SN_ESTERNO). Qui dentro non si decide niente su quel testo: si estrae e si
// tronca dichiarandolo.

'use strict';

const { safeFetch } = require('./safe-fetch');

// Tetto sul TESTO restituito, come per i documenti dal disco: abbastanza per un
// articolo lungo o una tabella di prezzi intera, poco abbastanza da non far
// esplodere il prompt. Oltre il tetto si tronca e lo si DICHIARA.
const MAX_TEXT_CHARS = 16000;

// Tetto sullo SCARICAMENTO, prima ancora di convertire: una pagina vera sta in
// pochi MB, e un file enorme dietro un indirizzo che sembra una pagina non deve
// poter bloccare il processo main.
const MAX_BYTES = 5 * 1024 * 1024;

const TIMEOUT_MS = 15000;

// Elementi che non sono MAI contenuto: o non si leggono (script, stili) o sono
// la cornice del sito (menu, piè di pagina, colonne laterali). Il titolo
// dell'articolo torna a parte, quindi togliere anche `header` non perde niente.
const TAG_FUORI = new Set([
  'script', 'style', 'noscript', 'svg', 'iframe', 'template', 'canvas',
  'object', 'embed', 'video', 'audio', 'map', 'dialog', 'datalist',
  'nav', 'aside', 'footer', 'header',
]);

// Classi e id del rumore, confrontati come TOKEN INTERI. Un confronto per
// sottostringa qui è un disastro silenzioso: `class="header-price"` contiene
// «header» e il prezzo — cioè proprio il dato che l'utente sta chiedendo —
// sparirebbe senza che nessuno se ne accorga.
const TOKEN_RUMORE = /^(nav|navbar|navigation|menu|menubar|sidebar|side-?bar|footer|site-?footer|page-?footer|header|site-?header|masthead|topbar|top-?nav|breadcrumbs?|pagination|pager|cookie|cookies|cookie-?banner|cookie-?consent|consent|gdpr|advert|advertising|advertisement|ads?|adsense|banner|promo|promotion|social|social-?share|share|sharing|newsletter|subscribe|subscription|paywall|comments?|comment-?list|disqus|related|related-?posts|recommended|widget|skip-?link|screen-?reader-?text|sr-only|visually-hidden|modal|popup|overlay|toolbar|search-?form)$/i;

const ROLE_RUMORE = /^(navigation|banner|contentinfo|complementary|search|dialog|alertdialog|menu|menubar|toolbar|tablist)$/i;

const VUOTI = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

// Tag che separano due pezzi di testo: senza, «Prezzo</td><td>42» diventa
// «Prezzo42» e il numero non si legge più.
const BLOCCHI = new Set([
  'p', 'div', 'section', 'article', 'main', 'blockquote', 'pre', 'figure', 'figcaption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'dl', 'dt', 'dd', 'table', 'thead',
  'tbody', 'tfoot', 'tr', 'form', 'fieldset', 'address', 'hr', 'details', 'summary',
]);

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9:_-]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/g;

function attributi(raw) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(String(raw || '')))) {
    out[m[1].toLowerCase()] = (m[3] ?? m[4] ?? m[5] ?? '').trim();
  }
  return out;
}

/** Questo elemento è cornice del sito, non contenuto? PURA. */
function daScartare(nome, attrs) {
  if (TAG_FUORI.has(nome)) return true;
  if ('hidden' in attrs) return true;
  if (attrs['aria-hidden'] === 'true') return true;
  if (attrs.role && ROLE_RUMORE.test(attrs.role)) return true;
  if (/display\s*:\s*none/i.test(attrs.style || '')) return true;
  const token = `${attrs.class || ''} ${attrs.id || ''}`.split(/[\s]+/).filter(Boolean);
  return token.some((t) => TOKEN_RUMORE.test(t));
}

const ENTITA = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', ndash: '–', mdash: '—',
  laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…',
  euro: '€', pound: '£', yen: '¥', cent: '¢', deg: '°', middot: '·', bull: '•',
  times: '×', divide: '÷', plusmn: '±', frac12: '½', copy: '©', reg: '®', trade: '™',
  eacute: 'é', egrave: 'è', agrave: 'à', igrave: 'ì', ograve: 'ò', ugrave: 'ù',
};

/** Entità HTML → caratteri. PURA. */
function decodeEntita(s) {
  return String(s == null ? '' : s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (tutto, corpo) => {
    if (corpo[0] === '#') {
      const n = corpo[1] === 'x' || corpo[1] === 'X'
        ? parseInt(corpo.slice(2), 16)
        : parseInt(corpo.slice(1), 10);
      if (!Number.isFinite(n) || n < 9 || n > 0x10ffff) return tutto;
      try { return String.fromCodePoint(n); } catch (_) { return tutto; }
    }
    const v = ENTITA[corpo.toLowerCase()];
    return v === undefined ? tutto : v;
  });
}

/**
 * HTML → testo leggibile: salta gli elementi di cornice con tutto il loro
 * contenuto, tiene i confini fra blocchi e trasforma le voci di elenco in
 * righe. PURA.
 */
function htmlATesto(html) {
  const src = String(html == null ? '' : html).replace(/<!--[\s\S]*?-->/g, '');
  const fuori = []; // pila degli elementi di cornice ancora aperti
  const pila = [];
  const pezzi = [];
  let i = 0;
  TAG_RE.lastIndex = 0;
  let m;
  const testo = (s) => { if (!fuori.length && s) pezzi.push(decodeEntita(s)); };
  while ((m = TAG_RE.exec(src))) {
    testo(src.slice(i, m.index));
    i = TAG_RE.lastIndex;
    const chiusura = m[1] === '/';
    const nome = m[2].toLowerCase();
    const autochiuso = m[4] === '/' || VUOTI.has(nome);
    if (!chiusura) {
      if (autochiuso) {
        if (!fuori.length && (nome === 'br' || nome === 'hr')) pezzi.push('\n');
        continue;
      }
      pila.push(nome);
      if (!fuori.length && daScartare(nome, attributi(m[3]))) { fuori.push(pila.length); continue; }
      if (fuori.length) continue;
      if (nome === 'li') pezzi.push('\n• ');
      else if (BLOCCHI.has(nome)) pezzi.push('\n');
      else if (nome === 'td' || nome === 'th') pezzi.push('\t');
      continue;
    }
    // Chiusura: risale alla corrispondente aperta, se c'è (l'HTML vero è pieno
    // di tag non chiusi, e una pila che non si svuota manderebbe via il resto).
    const dove = pila.lastIndexOf(nome);
    if (dove >= 0) {
      pila.length = dove;
      while (fuori.length && fuori[fuori.length - 1] > pila.length) fuori.pop();
    }
    if (fuori.length) continue;
    if (BLOCCHI.has(nome)) pezzi.push('\n');
  }
  testo(src.slice(i));
  return normalizzaTesto(pezzi.join(''));
}

/** Spazi, tabulazioni e righe vuote ridotti a qualcosa di leggibile. PURA. */
function normalizzaTesto(s) {
  return String(s == null ? '' : s)
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n\t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\t+/g, '\t')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map((r) => r.replace(/\s+$/, '')).join('\n')
    .trim();
}

/**
 * Il sotto-albero del primo elemento che soddisfa `vale`, come HTML. PURA.
 * Torna null se non c'è.
 */
function sottoalbero(html, vale) {
  const src = String(html == null ? '' : html);
  const re = new RegExp(TAG_RE.source, 'g');
  let m;
  while ((m = re.exec(src))) {
    if (m[1] === '/' || m[4] === '/') continue;
    const nome = m[2].toLowerCase();
    if (VUOTI.has(nome) || !vale(nome, attributi(m[3]))) continue;
    // Trovato: cerca la chiusura corrispondente contando gli annidati.
    const dentro = new RegExp(`<(/?)${nome}\\b((?:"[^"]*"|'[^']*'|[^>])*?)(/?)>`, 'gi');
    dentro.lastIndex = re.lastIndex;
    let livello = 1;
    let d;
    while ((d = dentro.exec(src))) {
      if (d[3] === '/') continue;
      livello += d[1] === '/' ? -1 : 1;
      if (livello === 0) return src.slice(re.lastIndex, d.index);
    }
    return src.slice(re.lastIndex);
  }
  return null;
}

/** Il titolo della pagina: <title>, poi og:title, poi il primo <h1>. PURA. */
function titoloDa(html) {
  const src = String(html == null ? '' : html);
  const pick = (re) => { const m = src.match(re); return m ? decodeEntita(m[1]).trim() : ''; };
  return normalizzaTesto(
    pick(/<title[^>]*>([\s\S]*?)<\/title>/i)
    || pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i)
    || pick(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:title["']/i)
    || htmlATesto(sottoalbero(src, (n) => n === 'h1') || ''),
  ).split('\n')[0].slice(0, 300);
}

/**
 * Da una pagina HTML al suo CONTENUTO PRINCIPALE. PURA.
 *
 * La zona principale (`<main>`, `role="main"`, `<article>`) vince sul corpo
 * intero, ma solo se ci si trova davvero del testo: su un sito che marca
 * `<main>` attorno a un guscio la regola rigida darebbe una pagina vuota
 * proprio quando il contenuto c'è.
 */
function estraiContenuto(html) {
  const src = String(html == null ? '' : html);
  const titolo = titoloDa(src);
  const corpo = sottoalbero(src, (n) => n === 'body') ?? src;
  const zona = sottoalbero(corpo, (n, a) => n === 'main' || a.role === 'main')
    ?? sottoalbero(corpo, (n) => n === 'article');
  let testo = htmlATesto(zona ?? corpo);
  if (zona != null && testo.length < 200) {
    const tutto = htmlATesto(corpo);
    if (tutto.length > testo.length) testo = tutto;
  }
  return { titolo, testo };
}

/** Taglia al tetto dichiarando il troncamento. PURA. */
function tronca(testo, max = MAX_TEXT_CHARS) {
  const s = String(testo == null ? '' : testo);
  if (s.length <= max) return { text: s, truncated: false };
  return { text: s.slice(0, max), truncated: true };
}

function tipoDaContentType(ct) {
  const t = String(ct || '').toLowerCase().split(';')[0].trim();
  if (!t || t === 'text/html' || t === 'application/xhtml+xml') return 'html';
  if (t === 'application/pdf') return 'pdf';
  if (t.startsWith('text/') || t === 'application/json' || t === 'application/xml'
    || t === 'application/ld+json' || t.endsWith('+json') || t.endsWith('+xml')) return 'testo';
  return null;
}

// Perché non «formato non supportato»: chi legge la risposta è il modello, che
// deve poterlo spiegare all'utente in italiano senza inventarselo.
const SPIEGA_TIPO = {
  image: 'è un\'immagine, non una pagina di testo',
  video: 'è un video, non una pagina di testo',
  audio: 'è un file audio, non una pagina di testo',
};

/**
 * Normalizza l'indirizzo che arriva dall'LLM: toglie virgolette e spazi, mette
 * https:// dove manca lo schema. PURA. Torna '' se non è un indirizzo web.
 */
function normalizzaUrl(input) {
  let s = String(input == null ? '' : input).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('\'') && s.endsWith('\''))) {
    s = s.slice(1, -1).trim();
  }
  if (!s) return '';
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch (_) { return ''; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  return u.href;
}

/** Due indirizzi indicano la stessa pagina? Il frammento non conta. PURA. */
function stessoIndirizzo(a, b) {
  const chiave = (v) => {
    try {
      const u = new URL(String(v || ''));
      const path = u.pathname.replace(/\/+$/, '');
      return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
    } catch (_) { return ''; }
  };
  const ka = chiave(a);
  return !!ka && ka === chiave(b);
}

const BASE = {
  ok: false, url: '', title: '', text: '', truncated: false, bytes: 0,
  source: '', kind: '', empty: false, error: null, detail: '',
};

/**
 * Converte quello che è arrivato dalla rete in testo. Separata da `readPage`
 * perché è qui che sta tutta la logica: gli unit test la esercitano per intero
 * senza aprire una connessione.
 */
async function daContenuto({ url = '', contentType = '', buffer = null, status = 200 } = {}) {
  const base = { ...BASE, url, source: 'rete', bytes: buffer ? buffer.length : 0 };
  if (status >= 400) {
    return { ...base, error: 'http_error', detail: `il sito ha risposto ${status}` };
  }
  const tipo = tipoDaContentType(contentType);
  if (!tipo) {
    const famiglia = String(contentType || '').toLowerCase().split('/')[0];
    return { ...base, error: 'unsupported', detail: SPIEGA_TIPO[famiglia] || 'non è una pagina di testo' };
  }
  if (tipo === 'pdf') {
    // Un indirizzo che finisce su un PDF è una pagina come le altre dal punto
    // di vista di chi chiede: si riusa l'estrattore dei documenti dal disco.
    try {
      const { estraiPdf } = require('./documentRead');
      const out = await estraiPdf(buffer);
      const testo = String(out.text || '').trim();
      if (!testo) return { ...base, ok: true, kind: 'pdf', empty: true };
      const capped = tronca(testo);
      return { ...base, ok: true, kind: 'pdf', title: '', text: capped.text, truncated: capped.truncated };
    } catch (_) {
      return { ...base, kind: 'pdf', error: 'pdf_failed', detail: 'il PDF è danneggiato o protetto da password' };
    }
  }
  const grezzo = decodifica(buffer, contentType);
  if (tipo === 'testo') {
    const capped = tronca(normalizzaTesto(grezzo));
    return {
      ...base, ok: true, kind: 'text', text: capped.text, truncated: capped.truncated,
      empty: !capped.text,
    };
  }
  const { titolo, testo } = estraiContenuto(grezzo);
  const capped = tronca(testo);
  return {
    ...base, ok: true, kind: 'html', title: titolo, text: capped.text,
    truncated: capped.truncated, empty: !capped.text,
  };
}

/** Byte → stringa, rispettando il charset dichiarato quando lo sappiamo fare. */
function decodifica(buffer, contentType) {
  if (!buffer || !buffer.length) return '';
  const m = String(contentType || '').match(/charset\s*=\s*["']?([\w-]+)/i);
  const enc = (m ? m[1] : 'utf-8').toLowerCase();
  try { return new TextDecoder(enc, { fatal: false }).decode(buffer); } catch (_) {}
  try { return new TextDecoder('utf-8', { fatal: false }).decode(buffer); } catch (_) {}
  return Buffer.from(buffer).toString('utf8');
}

// Perché i motivi di safe-fetch si traducono qui: il modello deve poter dire
// all'utente COSA non è andato, e «blocked-private-address» non è italiano.
const MOTIVI_RETE = {
  'blocked-private-address': 'quell\'indirizzo non è un sito pubblico: è il tuo computer o la tua rete locale, e Filo non ci va a leggere',
  'blocked-scheme': 'non è un indirizzo web (http o https)',
  'bad-url': 'l\'indirizzo non è scritto in un modo valido',
  'too-many-redirects': 'il sito continua a rimandare altrove senza mai arrivare a una pagina',
  'dns-empty': 'quel dominio non esiste',
};

async function scarica(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await safeFetch(url, { signal: ac.signal, headers: { Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' } });
    const contentType = r.headers.get('content-type') || '';
    const pezzi = [];
    let totale = 0;
    const reader = r.body?.getReader?.();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        pezzi.push(Buffer.from(value));
        totale += value.byteLength;
        if (totale >= MAX_BYTES) { try { await reader.cancel(); } catch (_) {} break; }
      }
    } else {
      const ab = await r.arrayBuffer();
      pezzi.push(Buffer.from(ab));
      totale = pezzi[0].length;
    }
    return { status: r.status, contentType, buffer: Buffer.concat(pezzi).subarray(0, MAX_BYTES) };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Legge una pagina web e ne restituisce il TESTO.
 *
 * `leggiScheda(url)` è la strada preferita: se la pagina è già aperta in una
 * scheda di Filo deve tornare `{ text, title }` del testo RESO, altrimenti
 * niente. Esito sempre nella stessa forma, anche in caso di rifiuto: chi
 * formatta l'osservazione per il modello non deve indovinare niente.
 */
async function readPage(input, { leggiScheda = null } = {}) {
  const url = normalizzaUrl(input);
  if (!url) {
    return {
      ...BASE, url: String(input == null ? '' : input).trim(),
      error: 'bad_url',
      detail: String(input || '').trim() ? 'non è un indirizzo web (servono http o https)' : 'nessun indirizzo indicato',
    };
  }

  // Siti pericolosi: la stessa valutazione che protegge una scheda protegge
  // anche una lettura. Una pagina di phishing letta dall'agente è testo scritto
  // per ingannare chi la legge, e chi la legge qui decide cosa fare dopo.
  try {
    const SB = globalThis.SN_SAFEBROWSE;
    const v = SB && SB.analyze(url, {});
    if (v && v.level === 'pericoloso') {
      return { ...BASE, url, error: 'blocked_dangerous', detail: 'quel sito è segnalato come pericoloso: Filo non lo legge' };
    }
  } catch (_) {}

  if (typeof leggiScheda === 'function') {
    try {
      const reso = await leggiScheda(url);
      const testo = reso && normalizzaTesto(reso.text);
      if (testo) {
        const capped = tronca(testo);
        return {
          ...BASE, ok: true, url, source: 'scheda', kind: 'html',
          title: String((reso && reso.title) || '').trim(),
          text: capped.text, truncated: capped.truncated,
        };
      }
    } catch (_) {}
  }

  let r;
  try {
    r = await scarica(url);
  } catch (e) {
    const codice = String(e && e.message ? e.message : e);
    if (e && e.name === 'AbortError') {
      return { ...BASE, url, error: 'timeout', detail: 'il sito non ha risposto in tempo' };
    }
    return {
      ...BASE, url,
      error: MOTIVI_RETE[codice] ? codice.replace(/-/g, '_') : 'network',
      detail: MOTIVI_RETE[codice] || 'non è stato possibile raggiungere quel sito',
    };
  }
  return { ...(await daContenuto({ url, ...r })), url, source: 'rete' };
}

module.exports = {
  readPage,
  // esportati per gli unit test e per chi formatta l'osservazione
  daContenuto,
  estraiContenuto,
  htmlATesto,
  titoloDa,
  normalizzaUrl,
  normalizzaTesto,
  stessoIndirizzo,
  decodeEntita,
  tronca,
  MAX_TEXT_CHARS,
  MAX_BYTES,
};
