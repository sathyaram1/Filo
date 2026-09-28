// Dal codice HTML di una pagina al suo TESTO LEGGIBILE, per l'azione LEGGI_PAGINA.
// Pura: niente DOM e niente rete. Serve sia la pagina scaricata sia quella letta dalla scheda, con la stessa regola.
// Cosa è contenuto e cosa è contorno sta solo qui; le prove in tests/unit/pageText.test.mjs.

'use strict';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
// Il loro contenuto è testo crudo fino alla chiusura: un «<» lì dentro non apre un tag.
const RAW = new Set(['script', 'style', 'textarea', 'title', 'noscript', 'xmp', 'iframe', 'noembed', 'noframes']);
// Mai testo da leggere, in nessuna modalità. Immagini, bottoni e tendine hanno una regola loro in `scrivi`.
const MAI = new Set([
  'head', 'script', 'style', 'noscript', 'template', 'svg', 'math', 'canvas', 'iframe', 'object', 'embed',
  'video', 'audio', 'picture', 'textarea', 'datalist', 'link', 'meta', 'title', 'noembed', 'noframes', 'xmp', 'map',
]);
// Il NOME di un riquadro decide solo l'ordine (il contorno va in coda), mai il cestino: gli stessi nomi stanno sul
// contenuto (il listino «menu», il piè di pagina con gli orari, i piani «subscribe»). Nel cestino va solo la
// navigazione fatta di link, la pubblicità e il banner dei cookie. Prove in tests/unit/pageText.test.mjs.
const NAV_TAG = new Set(['nav', 'menu']);
const NAV_RUOLI = new Set(['navigation', 'menu', 'menubar']);
const NAV_NOMI = new Set(['nav', 'navbar', 'navigation', 'menu', 'menubar', 'mainmenu', 'breadcrumb', 'breadcrumbs', 'share', 'sharing', 'social']);
const CESTINO_NOMI = new Set(['ad', 'ads', 'advert', 'adverts', 'advertisement', 'adsbygoogle', 'cookie', 'cookies', 'consent', 'gdpr', 'skiplink']);
const CODA_TAG = new Set(['aside']);
const CODA_RUOLI = new Set(['banner', 'contentinfo', 'complementary', 'search', 'toolbar', 'dialog', 'alertdialog', 'tooltip']);
const CODA_NOMI = new Set(['promo', 'newsletter', 'subscribe', 'related', 'recommended', 'popup', 'modal', 'sidebar', 'widget', 'sponsor', 'sponsored']);
// Quanta parte del testo di una navigazione dev'essere link perché sia solo navigazione.
const QUOTA_LINK = 0.6;
const CESTINO = 1;
const CODA = 2;
const CHIUSO = 3;
const PREFISSI = new Set(['site', 'main', 'top', 'primary', 'global', 'page', 'js', 'is', 'c', 'l', 'o', 'u', 'm']);
const SUFFISSI = new Set(['bar', 'wrapper', 'wrap', 'container', 'area', 'box', 'block', 'links', 'list', 'section', 'banner', 'notice', 'overlay', 'inner', 'outer', 'holder', 'slot', 'unit']);
const MAI_SALTARE = new Set(['html', 'body', 'main', 'article']);
const BLOCCHI = new Set([
  'address', 'article', 'blockquote', 'center', 'details', 'dialog', 'dl', 'fieldset', 'figure', 'footer', 'form',
  'header', 'hgroup', 'main', 'nav', 'ol', 'p', 'section', 'summary', 'ul', 'aside', 'figcaption', 'caption', 'legend',
]);
const RIGHE = new Set(['div', 'dt', 'dd', 'tbody', 'thead', 'tfoot', 'label']);
// Aprire uno di questi chiude il <p> rimasto aperto, come fa il browser.
const CHIUDE_P = new Set([...BLOCCHI, 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'pre', 'table', 'li', 'dd', 'dt']);
// Un documento annidato all'infinito non deve far saltare la pila della ricorsione.
const PROFONDITA_MAX = 400;
const SOGLIA_CONTENUTO = 250;

const ENTITA = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  shy: '', zwnj: '‌', zwj: '‍', lrm: '', rlm: '', hellip: '…', mdash: '—', ndash: '–', minus: '−',
  laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›', ldquo: '“', rdquo: '”', bdquo: '„', lsquo: '‘', rsquo: '’', sbquo: '‚',
  euro: '€', pound: '£', yen: '¥', cent: '¢', dollar: '$', copy: '©', reg: '®', trade: '™', deg: '°', middot: '·',
  bull: '•', times: '×', divide: '÷', plusmn: '±', frac12: '½', frac14: '¼', frac34: '¾', sup1: '¹', sup2: '²', sup3: '³',
  micro: 'µ', para: '¶', sect: '§', permil: '‰', prime: '′', Prime: '″', larr: '←', rarr: '→', uarr: '↑', darr: '↓',
  harr: '↔', le: '≤', ge: '≥', ne: '≠', asymp: '≈', infin: '∞', check: '✓', star: '☆', starf: '★', iexcl: '¡', iquest: '¿',
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ', ccedil: 'ç', egrave: 'è',
  eacute: 'é', ecirc: 'ê', euml: 'ë', igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï', ntilde: 'ñ', ograve: 'ò',
  oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø', ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü',
  yacute: 'ý', yuml: 'ÿ', szlig: 'ß', Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å',
  AElig: 'Æ', Ccedil: 'Ç', Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î',
  Iuml: 'Ï', Ntilde: 'Ñ', Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø', Ugrave: 'Ù',
  Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü', Yacute: 'Ý', oelig: 'œ', OElig: 'Œ', scaron: 'š', Scaron: 'Š', alpha: 'α',
  beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', omega: 'ω', Delta: 'Δ',
  Sigma: 'Σ', Omega: 'Ω',
};

function decodificaEntita(s) {
  if (!s || s.indexOf('&') < 0) return s || '';
  return s.replace(/&(#\d{1,8}|#[xX][0-9a-fA-F]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});?/g, (m, corpo) => {
    if (corpo[0] === '#') {
      const n = corpo[1] === 'x' || corpo[1] === 'X' ? parseInt(corpo.slice(2), 16) : parseInt(corpo.slice(1), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return '�';
      return String.fromCodePoint(n);
    }
    return Object.prototype.hasOwnProperty.call(ENTITA, corpo) ? ENTITA[corpo] : m;
  });
}

function leggiAttributi(s) {
  const attrs = Object.create(null);
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(s))) {
    const nome = m[1].toLowerCase();
    if (nome in attrs) continue;
    attrs[nome] = decodificaEntita(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

// Fine del tag che comincia in `da`, rispettando le virgolette. Un tag che non chiude entro il tetto è testo.
function fineTag(html, da) {
  let q = '';
  const tetto = Math.min(html.length, da + 8192);
  for (let i = da; i < tetto; i++) {
    const c = html[i];
    if (q) { if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '>') return i;
    if (c === '<') return -1;
  }
  return -1;
}

function nuovoNodo(tag, attrs, parent) {
  return { tag, attrs, children: [], parent };
}

// Un albero tollerante: chiusure mancanti o storte si aggiustano come farebbe, a grandi linee, il browser.
function costruisciAlbero(html) {
  const radice = nuovoNodo('#root', Object.create(null), null);
  const minuscolo = html.toLowerCase();
  let cur = radice;
  let profondita = 0;
  let i = 0;
  const n = html.length;
  const testo = (t) => { if (t) cur.children.push(decodificaEntita(t)); };
  const chiudiFinoA = (tag, fermaA) => {
    for (let x = cur, d = profondita; x && x !== radice; x = x.parent, d--) {
      if (fermaA && fermaA.has(x.tag)) return false;
      if (x.tag === tag) { cur = x.parent; profondita = d - 1; return true; }
    }
    return false;
  };
  const apri = (tag, attrs) => {
    if (CHIUDE_P.has(tag)) chiudiFinoA('p', new Set(['div', 'section', 'article', 'main', 'td', 'th', 'li', 'blockquote', 'body']));
    if (tag === 'li') chiudiFinoA('li', new Set(['ul', 'ol', 'menu']));
    if (tag === 'dt' || tag === 'dd') { chiudiFinoA('dt', new Set(['dl'])) || chiudiFinoA('dd', new Set(['dl'])); }
    if (tag === 'tr') chiudiFinoA('tr', new Set(['table', 'tbody', 'thead', 'tfoot']));
    if (tag === 'td' || tag === 'th') { chiudiFinoA('td', new Set(['tr', 'table'])) || chiudiFinoA('th', new Set(['tr', 'table'])); }
    if (tag === 'tbody' || tag === 'thead' || tag === 'tfoot') {
      chiudiFinoA('tbody', new Set(['table'])) || chiudiFinoA('thead', new Set(['table'])) || chiudiFinoA('tfoot', new Set(['table']));
    }
    const nodo = nuovoNodo(tag, attrs, cur);
    cur.children.push(nodo);
    if (VOID.has(tag)) return nodo;
    if (profondita < PROFONDITA_MAX) { cur = nodo; profondita++; }
    return nodo;
  };

  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { testo(html.slice(i)); break; }
    if (lt > i) testo(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) {
      const e = html.indexOf('-->', lt + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    const c1 = html[lt + 1];
    if (c1 === '!' || c1 === '?') {
      const e = html.indexOf('>', lt);
      i = e < 0 ? n : e + 1;
      continue;
    }
    const chiusura = c1 === '/';
    const inizioNome = chiusura ? lt + 2 : lt + 1;
    const mNome = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(html.slice(inizioNome, inizioNome + 64));
    const fine = mNome ? fineTag(html, inizioNome + mNome[0].length) : -1;
    if (!mNome || fine < 0) { testo('<'); i = lt + 1; continue; }
    const tag = mNome[0].toLowerCase();
    i = fine + 1;
    if (chiusura) {
      if (tag === 'br') { apri('br', Object.create(null)); continue; }
      if (tag === 'p' || tag === 'li' || tag === 'td' || tag === 'th' || tag === 'tr') chiudiFinoA(tag, new Set(['table', 'body']));
      else chiudiFinoA(tag);
      continue;
    }
    const attrs = leggiAttributi(html.slice(inizioNome + mNome[0].length, fine));
    const nodo = apri(tag, attrs);
    if (RAW.has(tag)) {
      const e = minuscolo.indexOf(`</${tag}`, i);
      const crudo = html.slice(i, e < 0 ? n : e);
      if (crudo) nodo.children.push(tag === 'title' || tag === 'textarea' ? decodificaEntita(crudo) : crudo);
      if (e < 0) { i = n; } else {
        const g = html.indexOf('>', e);
        i = g < 0 ? n : g + 1;
      }
      if (cur === nodo) { cur = nodo.parent; profondita--; }
    }
  }
  return radice;
}

function trova(radice, pred, acc = []) {
  const pila = [radice];
  while (pila.length) {
    const x = pila.pop();
    if (typeof x === 'string') continue;
    if (x !== radice && pred(x)) acc.push(x);
    for (let k = x.children.length - 1; k >= 0; k--) pila.push(x.children[k]);
  }
  return acc;
}

function testoGrezzo(nodo) {
  let s = '';
  const pila = [nodo];
  while (pila.length) {
    const x = pila.pop();
    if (typeof x === 'string') { s += x; continue; }
    for (let k = x.children.length - 1; k >= 0; k--) pila.push(x.children[k]);
  }
  return s.replace(/\s+/g, ' ').trim();
}

function nomeDiContorno(token) {
  const parti = String(token).toLowerCase().split(/[-_]+/).filter(Boolean);
  if (!parti.length) return false;
  if (parti.length > 1 && PREFISSI.has(parti[0])) parti.shift();
  if (parti.length > 1 && SUFFISSI.has(parti[parti.length - 1])) parti.pop();
  return CONTORNO_NOMI.has(parti.join(''));
}

function nascosto(nodo) {
  const a = nodo.attrs;
  if ('hidden' in a) return true;
  if (String(a['aria-hidden'] || '').toLowerCase() === 'true') return true;
  if (a.style && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(a.style)) return true;
  if (nodo.tag === 'dialog' && !('open' in a)) return true;
  // La UI che Filo stesso disegna nella pagina (menu, avvisi) non è la pagina: vedi src/shared/filoUi.js.
  if ('data-sn-ui' in a) return true;
  return false;
}

function diContorno(nodo, ctx) {
  if (MAI_SALTARE.has(nodo.tag)) return false;
  if (CONTORNO_TAG.has(nodo.tag)) return true;
  // L'intestazione e il piede di un ARTICOLO sono contenuto (titolo, autore, data); quelli del sito no.
  if ((nodo.tag === 'header' || nodo.tag === 'footer') && !ctx.dentroArticolo) return true;
  const a = nodo.attrs;
  if (a.role && CONTORNO_RUOLI.has(String(a.role).toLowerCase().trim())) return true;
  const nomi = `${a.class || ''} ${a.id || ''}`.split(/\s+/).filter(Boolean);
  return nomi.some(nomeDiContorno);
}

function risolviLink(href, base) {
  const h = String(href || '').trim();
  if (!h || h[0] === '#') return '';
  try {
    const u = new URL(h, base || undefined);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    u.hash = '';
    const s = u.href;
    return s.length > 300 ? '' : s;
  } catch (_) { return ''; }
}

class Scrittore {
  constructor() { this.righe = []; this.cur = ''; this.prefisso = ''; }
  inline(t) {
    if (!t) return;
    if (!this.cur || /\s$/.test(this.cur)) t = t.replace(/^\s+/, '');
    this.cur += t;
  }
  riga() {
    const s = this.cur.replace(/\s+$/, '').replace(/^\s+/, (m) => (this.prefisso ? m : ''));
    if (s.trim() && s.trim() !== this.prefisso.trim()) this.righe.push(s);
    this.cur = '';
    this.prefisso = '';
  }
  blocco() {
    this.riga();
    if (this.righe.length && this.righe[this.righe.length - 1] !== '') this.righe.push('');
  }
  inizia(prefisso) { this.riga(); this.cur = prefisso; this.prefisso = prefisso; }
  crudo(s) { this.riga(); for (const r of String(s).split('\n')) this.righe.push(r.replace(/\s+$/, '')); }
  testo() {
    this.riga();
    return this.righe.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
}

function inlineDi(nodi, ctx) {
  const s = new Scrittore();
  for (const x of nodi) scrivi(x, s, ctx);
  return s.testo().replace(/\s*\n+\s*/g, ' ').trim();
}

function scriviRiga(tr, w, ctx) {
  const celle = tr.children
    .filter((c) => typeof c !== 'string' && (c.tag === 'td' || c.tag === 'th') && !nascosto(c))
    .map((c) => inlineDi(c.children, ctx).replace(/\|/g, '/'));
  if (celle.some(Boolean)) { w.riga(); w.righe.push(celle.join(' | ')); }
}

function scriviTabella(nodo, w, ctx) {
  w.blocco();
  const pila = [...nodo.children].reverse();
  while (pila.length) {
    const x = pila.pop();
    if (typeof x === 'string') continue;
    if (nascosto(x)) continue;
    if (x.tag === 'caption') { w.riga(); w.righe.push(inlineDi(x.children, ctx)); continue; }
    if (x.tag === 'tr') { scriviRiga(x, w, ctx); continue; }
    if (x.tag === 'td' || x.tag === 'th') { scriviRiga({ children: [x] }, w, ctx); continue; }
    if (x.tag === 'thead' || x.tag === 'tbody' || x.tag === 'tfoot') { for (let k = x.children.length - 1; k >= 0; k--) pila.push(x.children[k]); }
  }
  w.blocco();
}

function scrivi(nodo, w, ctx) {
  if (typeof nodo === 'string') { w.inline(nodo.replace(/\s+/g, ' ')); return; }
  const tag = nodo.tag;
  if (MAI.has(tag) || nascosto(nodo)) return;
  if (ctx.stretta && diContorno(nodo, ctx)) return;
  const figli = (c) => { for (const x of nodo.children) scrivi(x, w, c || ctx); };
  const dentroArticolo = ctx.dentroArticolo || tag === 'article' || tag === 'main';
  const sotto = dentroArticolo !== ctx.dentroArticolo ? { ...ctx, dentroArticolo } : ctx;
  if (/^h[1-6]$/.test(tag)) {
    w.blocco();
    w.inizia(`${'#'.repeat(Number(tag[1]))} `);
    figli(sotto);
    w.blocco();
    return;
  }
  switch (tag) {
    case 'br': w.riga(); return;
    case 'hr': w.blocco(); return;
    case 'pre': {
      w.blocco();
      const t = testoCrudo(nodo);
      if (t.trim()) w.crudo(t.replace(/^\n/, ''));
      w.blocco();
      return;
    }
    case 'table': scriviTabella(nodo, w, sotto); return;
    case 'ul': case 'ol': case 'menu': {
      const stacca = () => (ctx.lista ? w.riga() : w.blocco());
      stacca();
      const livello = (ctx.lista || 0) + 1;
      let n = 0;
      for (const x of nodo.children) {
        if (typeof x !== 'string' && x.tag === 'li') {
          if (nascosto(x) || (ctx.stretta && diContorno(x, sotto))) continue;
          n++;
          w.inizia(`${'  '.repeat(livello - 1)}${tag === 'ol' ? `${n}.` : '-'} `);
          for (const y of x.children) scrivi(y, w, { ...sotto, lista: livello });
          w.riga();
        } else {
          scrivi(x, w, { ...sotto, lista: livello });
        }
      }
      stacca();
      return;
    }
    case 'li': w.inizia('- '); figli(sotto); w.riga(); return;
    case 'a': {
      const t = inlineDi(nodo.children, sotto);
      if (!t) return;
      const url = risolviLink(nodo.attrs.href, ctx.base);
      w.inline(url && url !== t ? `[${t}](${url})` : t);
      return;
    }
    default: break;
  }
  if (BLOCCHI.has(tag)) { w.blocco(); figli(sotto); w.blocco(); return; }
  if (RIGHE.has(tag)) { w.riga(); figli(sotto); w.riga(); return; }
  if (tag === 'td' || tag === 'th') { w.inline(' '); figli(sotto); w.inline(' '); return; }
  figli(sotto);
}

function testoCrudo(nodo) {
  let s = '';
  const pila = [nodo];
  while (pila.length) {
    const x = pila.pop();
    if (typeof x === 'string') { s += x; continue; }
    if (x !== nodo && (MAI.has(x.tag) || nascosto(x))) continue;
    if (x.tag === 'br') { s += '\n'; continue; }
    for (let k = x.children.length - 1; k >= 0; k--) pila.push(x.children[k]);
  }
  return s;
}

function scriviDa(radice, ctx) {
  const w = new Scrittore();
  scrivi(radice, w, ctx);
  return w.testo();
}

function meta(radice) {
  const out = { titolo: '', descrizione: '', lingua: '', base: '' };
  const titoli = trova(radice, (x) => x.tag === 'title');
  if (titoli.length) out.titolo = testoGrezzo(titoli[0]);
  for (const m of trova(radice, (x) => x.tag === 'meta')) {
    const nome = String(m.attrs.name || m.attrs.property || '').toLowerCase();
    const v = String(m.attrs.content || '').replace(/\s+/g, ' ').trim();
    if (!v) continue;
    if (!out.descrizione && (nome === 'description' || nome === 'og:description')) out.descrizione = v;
    if (!out.titolo && nome === 'og:title') out.titolo = v;
  }
  const html = trova(radice, (x) => x.tag === 'html')[0];
  if (html && html.attrs.lang) out.lingua = String(html.attrs.lang).trim().slice(0, 20);
  const base = trova(radice, (x) => x.tag === 'base' && x.attrs.href)[0];
  if (base) out.base = base.attrs.href;
  return out;
}

// Dove sta il contenuto: l'unico articolo, o la parte principale, purché abbia abbastanza testo; se no tutto il corpo.
function sceltaRadice(radice) {
  const corpo = trova(radice, (x) => x.tag === 'body')[0] || radice;
  const principali = trova(corpo, (x) => x.tag === 'main' || String(x.attrs.role || '').toLowerCase() === 'main');
  const articoli = trova(corpo, (x) => x.tag === 'article');
  const corpiArticolo = trova(corpo, (x) => String(x.attrs.itemprop || '').toLowerCase() === 'articlebody');
  const conTesto = (x) => scriviDa(x, { stretta: true, dentroArticolo: true, base: '', lista: 0 }).length >= SOGLIA_CONTENUTO;
  for (const gruppo of [articoli, principali, corpiArticolo]) {
    if (gruppo.length === 1 && conTesto(gruppo[0])) return { nodo: gruppo[0], corpo };
  }
  return { nodo: corpo, corpo };
}

// Un sito che si costruisce in JavaScript, scaricato senza eseguirlo, è una pagina quasi vuota piena di script.
function pareSoloJavaScript(radice, testo) {
  if (testo.length >= 200) return false;
  const script = trova(radice, (x) => x.tag === 'script').length;
  const contenitore = trova(radice, (x) => x.tag === 'div' && /^(root|app|__next|__nuxt|svelte|main-app)$/i.test(String(x.attrs.id || ''))).length;
  const avviso = trova(radice, (x) => x.tag === 'noscript').some((x) => /javascript/i.test(testoGrezzo(x)));
  return script >= 3 || contenitore > 0 || avviso;
}

/**
 * Estrae il testo leggibile da un documento HTML.
 * Ritorna { titolo, descrizione, lingua, testo, soloJavaScript }.
 */
function estrai(html, { url = '' } = {}) {
  const radice = costruisciAlbero(String(html == null ? '' : html));
  const m = meta(radice);
  let base = url;
  if (m.base) { try { base = new URL(m.base, url || undefined).href; } catch (_) {} }
  const { nodo, corpo } = sceltaRadice(radice);
  const ctx = { stretta: true, dentroArticolo: nodo !== corpo, base, lista: 0 };
  let testo = scriviDa(nodo, ctx);
  // Un sito che chiama «menu» il contenitore di tutto: la lettura stretta resta a mani vuote, la larga no.
  if (testo.length < 200) {
    const largo = scriviDa(corpo, { ...ctx, stretta: false, dentroArticolo: false });
    if (largo.length > testo.length * 2) testo = largo;
  }
  return {
    titolo: m.titolo.slice(0, 300),
    descrizione: m.descrizione.slice(0, 500),
    lingua: m.lingua,
    testo,
    soloJavaScript: pareSoloJavaScript(radice, testo),
  };
}

module.exports = { estrai, decodificaEntita, nomeDiContorno };
