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
// Il NOME di un riquadro decide solo l'ordine (il contorno va in coda), MAI il cestino: gli stessi nomi stanno sul
// contenuto (il listino «menu», i «cookies» di una pasticceria, i piani «subscribe»). Nel cestino va solo la
// navigazione DICHIARATA (tag o ruolo) fatta di link. Prove in tests/unit/pageText.test.mjs.
const NAV_TAG = new Set(['nav', 'menu']);
const NAV_RUOLI = new Set(['navigation', 'menu', 'menubar']);
const CODA_TAG = new Set(['aside']);
const CODA_RUOLI = new Set(['banner', 'contentinfo', 'complementary', 'search', 'toolbar', 'dialog', 'alertdialog', 'tooltip']);
const CODA_NOMI = new Set([
  'nav', 'navbar', 'navigation', 'menu', 'menubar', 'mainmenu', 'breadcrumb', 'breadcrumbs', 'share', 'sharing', 'social',
  'ad', 'ads', 'advert', 'adverts', 'advertisement', 'adsbygoogle', 'cookie', 'cookies', 'consent', 'gdpr', 'skiplink',
  'promo', 'newsletter', 'subscribe', 'related', 'recommended', 'popup', 'modal', 'sidebar', 'widget', 'sponsor', 'sponsored',
]);
// Quanta parte del testo di una navigazione dev'essere link perché sia solo navigazione.
const QUOTA_LINK = 0.6;
const SOLO_LETTORI = /(?:^|\s)(?:sr-only|visually-hidden|visuallyhidden|screen-reader-text|a-offscreen)(?:\s|$)/i;
const CESTINO = 1;
const CODA = 2;
const CHIUSO = 3;
const PREFISSI = new Set(['site', 'main', 'top', 'primary', 'global', 'page', 'js', 'is', 'c', 'l', 'o', 'u', 'm']);
const SUFFISSI = new Set(['bar', 'wrapper', 'wrap', 'container', 'area', 'box', 'block', 'links', 'list', 'section', 'banner', 'notice', 'overlay', 'inner', 'outer', 'holder', 'slot', 'unit']);
const MAI_SALTARE = new Set(['html', 'body', 'main', 'article']);
// Chiudono un <p> aperto solo fino a questi: oltre, il paragrafo è di un altro contenitore.
const FERMA_P = new Set(['div', 'section', 'article', 'main', 'td', 'th', 'li', 'blockquote', 'body']);
const FERMA_LI = new Set(['ul', 'ol', 'menu']);
const FERMA_DL = new Set(['dl']);
const FERMA_TR = new Set(['table', 'tbody', 'thead', 'tfoot']);
const FERMA_TD = new Set(['tr', 'table']);
const FERMA_TABELLA = new Set(['table']);
// Un link dentro un link il browser lo chiude: annidati all'infinito costerebbero il quadrato della pagina.
const FERMA_A = new Set(['td', 'th', 'table', 'body', 'html']);
const FERMA_CHIUSURA = new Set(['table', 'body']);
const FERMA_SELECT = new Set(['select', 'datalist']);
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
  // Quanti ne sono aperti per nome: una chiusura senza apertura non ripercorre tutta la pila.
  const aperti = new Map();
  const scendi = (nodo) => { cur = nodo; profondita++; aperti.set(nodo.tag, (aperti.get(nodo.tag) || 0) + 1); };
  const risali = (fino) => {
    for (let x = cur; x && x !== fino; x = x.parent) { aperti.set(x.tag, aperti.get(x.tag) - 1); profondita--; }
    cur = fino;
  };
  const chiudiFinoA = (tag, fermaA) => {
    if (!aperti.get(tag)) return false;
    for (let x = cur; x && x !== radice; x = x.parent) {
      if (fermaA && fermaA.has(x.tag)) return false;
      if (x.tag === tag) { risali(x.parent); return true; }
    }
    return false;
  };
  const apri = (tag, attrs) => {
    if (CHIUDE_P.has(tag)) chiudiFinoA('p', FERMA_P);
    if (tag === 'li') chiudiFinoA('li', FERMA_LI);
    if (tag === 'dt' || tag === 'dd') { chiudiFinoA('dt', FERMA_DL) || chiudiFinoA('dd', FERMA_DL); }
    if (tag === 'tr') chiudiFinoA('tr', FERMA_TR);
    if (tag === 'td' || tag === 'th') { chiudiFinoA('td', FERMA_TD) || chiudiFinoA('th', FERMA_TD); }
    if (tag === 'tbody' || tag === 'thead' || tag === 'tfoot') {
      chiudiFinoA('tbody', FERMA_TABELLA) || chiudiFinoA('thead', FERMA_TABELLA) || chiudiFinoA('tfoot', FERMA_TABELLA);
    }
    if (tag === 'a') chiudiFinoA('a', FERMA_A);
    if (tag === 'option' || tag === 'optgroup') chiudiFinoA('option', FERMA_SELECT);
    const nodo = nuovoNodo(tag, attrs, cur);
    cur.children.push(nodo);
    if (VOID.has(tag)) return nodo;
    if (profondita < PROFONDITA_MAX) scendi(nodo);
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
      if (tag === 'p' || tag === 'li' || tag === 'td' || tag === 'th' || tag === 'tr') chiudiFinoA(tag, FERMA_CHIUSURA);
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
      if (cur === nodo) risali(nodo.parent);
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

function partiDelNome(token) {
  const parti = String(token).toLowerCase().split(/[-_]+/).filter(Boolean);
  if (!parti.length) return '';
  if (parti.length > 1 && PREFISSI.has(parti[0])) parti.shift();
  if (parti.length > 1 && SUFFISSI.has(parti[parti.length - 1])) parti.pop();
  return parti.join('');
}

function nomeDiContorno(token) {
  const n = partiDelNome(token);
  return !!n && (NAV_NOMI.has(n) || CESTINO_NOMI.has(n) || CODA_NOMI.has(n));
}

const RE_DICHIARAZIONE = new Map();
function dichiarazione(stile, prop) {
  let re = RE_DICHIARAZIONE.get(prop);
  if (!re) { re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]*)`, 'g'); RE_DICHIARAZIONE.set(prop, re); }
  re.lastIndex = 0;
  let v = '';
  let m;
  while ((m = re.exec(stile))) v = m[1].replace(/!\s*important/, '').trim();
  return v;
}

function px(v) {
  const m = /^(-?\d*\.?\d+)(px|em|rem|%|pt|vw|vh)?$/.exec(String(v || '').trim());
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  const u = m[2] || 'px';
  if (u === 'em' || u === 'rem') return n * 16;
  if (u === '%') return n * 0.16;
  if (u === 'pt') return (n * 4) / 3;
  if (u === 'vw' || u === 'vh') return n * 10;
  return n;
}

// Chiuso finché l'utente non lo apre (la risposta di una domanda frequente, la scheda non attiva di un listino):
// non si butta, arriva in fondo sotto un titolo che lo dichiara.
function nascosto(nodo) {
  const a = nodo.attrs;
  if ('hidden' in a) return true;
  if (nodo.tag === 'dialog' && !('open' in a)) return true;
  if (!a.style) return false;
  const st = String(a.style).toLowerCase();
  if (dichiarazione(st, 'display') === 'none') return true;
  if (/^(?:hidden|collapse)$/.test(dichiarazione(st, 'visibility'))) return true;
  return px(dichiarazione(st, 'max-height')) === 0 && /hidden|clip/.test(dichiarazione(st, 'overflow'));
}

// Scritto dove nessun gesto lo mostra: è testo per chi legge con un programma, non per l'utente, e non arriva.
// Una dissolvenza in attesa (parte scorrendo la pagina) non conta: il testo l'utente lo vedrà.
function invisibile(nodo) {
  const a = nodo.attrs;
  if (!a.style) return false;
  const st = String(a.style).toLowerCase();
  const animata = /transition|animation|will-change/.test(st) || 'data-w-id' in a || 'data-aos' in a;
  const op = dichiarazione(st, 'opacity');
  if (op && !animata && !/transform/.test(st) && parseFloat(op) <= 0.05) return true;
  // Il corpo zero su un contenitore coi figli serve a togliere gli spazi fra i riquadri: i figli hanno il loro.
  const fs = px(dichiarazione(st, 'font-size'));
  if (fs < 2 && !nodo.children.some((c) => typeof c !== 'string')) return true;
  if (px(dichiarazione(st, 'text-indent')) <= -999) return true;
  if (/absolute|fixed/.test(dichiarazione(st, 'position'))
    && ['left', 'top', 'right', 'bottom'].some((p) => px(dichiarazione(st, p)) <= -999)) return true;
  if (/rect\(\s*(?:0|1px)(?:px)?[\s,]+(?:0|1px)/.test(dichiarazione(st, 'clip'))) return true;
  if (/inset\(\s*(?:50|100)%|circle\(\s*0/.test(dichiarazione(st, 'clip-path'))) return true;
  if (/scale[xy]?\(\s*0(?:\.0*)?\s*[,)]/.test(dichiarazione(st, 'transform'))) return true;
  // Il titolo sfumato ha il testo trasparente e lo sfondo ritagliato sulle lettere: quello si vede.
  if (dichiarazione(st, 'color') === 'transparent' && !/background-clip/.test(st)) return true;
  const w = px(dichiarazione(st, 'width'));
  const h = px(dichiarazione(st, 'height'));
  return (w <= 1 || h <= 1) && /hidden|clip/.test(dichiarazione(st, 'overflow'));
}

// Testo e testo dentro i link di ogni riquadro, in una passata: la navigazione è ciò che è fatto quasi solo di link.
function misura(radice) {
  const pila = [[radice, 0]];
  while (pila.length) {
    const cima = pila[pila.length - 1];
    const x = cima[0];
    if (cima[1] < x.children.length) {
      const c = x.children[cima[1]++];
      if (typeof c !== 'string' && !MAI.has(c.tag)) pila.push([c, 0]);
      continue;
    }
    pila.pop();
    let tot = 0;
    let link = 0;
    for (const c of x.children) {
      if (typeof c === 'string') { tot += c.trim().length; continue; }
      if (MAI.has(c.tag)) continue;
      tot += c.lt || 0;
      link += c.ll || 0;
    }
    x.lt = tot;
    x.ll = x.tag === 'a' ? tot : link;
  }
}

function fattoDiLink(nodo) {
  const tot = nodo.lt || 0;
  return tot === 0 || (nodo.ll || 0) / tot >= QUOTA_LINK;
}

// Dove va un riquadro: nel testo (0), in coda, fra i chiusi o nel cestino. Il nome decide solo la coda.
function classifica(nodo, ctx) {
  const tag = nodo.tag;
  if (tag === 'html' || tag === 'body') return 0;
  const a = nodo.attrs;
  // La UI che Filo stesso disegna nella pagina (menu, avvisi) non è la pagina: vedi src/shared/filoUi.js.
  if ('data-sn-ui' in a) return CESTINO;
  if (!ctx.ignoraInvisibile && invisibile(nodo)) return CESTINO;
  if (nascosto(nodo)) return CHIUSO;
  if (MAI_SALTARE.has(tag)) return 0;
  const nomi = (a.class || a.id) ? `${a.class || ''} ${a.id || ''}`.split(/\s+/).filter(Boolean).map(partiDelNome) : [];
  if (nomi.some((n) => CESTINO_NOMI.has(n))) return CESTINO;
  const ruolo = a.role ? String(a.role).toLowerCase().trim() : '';
  if (NAV_TAG.has(tag) || NAV_RUOLI.has(ruolo) || nomi.some((n) => NAV_NOMI.has(n))) return fattoDiLink(nodo) ? CESTINO : CODA;
  if (CODA_TAG.has(tag) || CODA_RUOLI.has(ruolo) || nomi.some((n) => CODA_NOMI.has(n))) return CODA;
  // L'intestazione e il piede di un ARTICOLO sono contenuto (titolo, autore, data); quelli del sito vanno in coda.
  if ((tag === 'header' || tag === 'footer') && !ctx.dentroArticolo) return CODA;
  return 0;
}

function salta(nodo, ctx) {
  if (MAI.has(nodo.tag)) return true;
  const c = classifica(nodo, ctx);
  return c === CESTINO || (c === CHIUSO && ctx.modo !== 'chiusi') || (c === CODA && ctx.modo === 'principale');
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
  constructor() { this.righe = []; this.cur = ''; this.prefisso = ''; this.spazio = false; }
  // Lo spazio in fondo si ricorda in un campo: guardarlo sulla riga a ogni pezzo costava il quadrato della riga.
  inline(t) {
    if (!t) return;
    if (!this.cur || this.spazio) t = t.replace(/^\s+/, '');
    if (!t) return;
    this.cur += t;
    this.spazio = /\s$/.test(t);
  }
  riga() {
    const s = this.cur.replace(/\s+$/, '').replace(/^\s+/, (m) => (this.prefisso ? m : ''));
    if (s.trim() && s.trim() !== this.prefisso.trim()) this.righe.push(s);
    this.cur = '';
    this.prefisso = '';
    this.spazio = false;
  }
  blocco() {
    this.riga();
    if (this.righe.length && this.righe[this.righe.length - 1] !== '') this.righe.push('');
  }
  inizia(prefisso) { this.riga(); this.cur = prefisso; this.prefisso = prefisso; this.spazio = /\s$/.test(prefisso); }
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
    .filter((c) => typeof c !== 'string' && (c.tag === 'td' || c.tag === 'th') && !salta(c, ctx))
    .map((c) => inlineDi(c.children, { ...ctx, cella: true }).replace(/\|/g, '/'));
  if (celle.some(Boolean)) { w.riga(); w.righe.push(celle.join(' | ')); }
}

function scriviTabella(nodo, w, ctx) {
  w.blocco();
  const pila = [...nodo.children].reverse();
  while (pila.length) {
    const x = pila.pop();
    if (typeof x === 'string') continue;
    if (salta(x, ctx)) continue;
    if (x.tag === 'caption') { w.riga(); w.righe.push(inlineDi(x.children, ctx)); continue; }
    if (x.tag === 'tr') { scriviRiga(x, w, ctx); continue; }
    if (x.tag === 'td' || x.tag === 'th') { scriviRiga({ children: [x] }, w, ctx); continue; }
    if (x.tag === 'thead' || x.tag === 'tbody' || x.tag === 'tfoot') { for (let k = x.children.length - 1; k >= 0; k--) pila.push(x.children[k]); }
  }
  w.blocco();
}

const pulisci = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

function scrivi(nodo, w, ctx) {
  if (typeof nodo === 'string') { w.inline(nodo.replace(/\s+/g, ' ')); return; }
  const tag = nodo.tag;
  if (salta(nodo, ctx)) return;
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
      const t = testoCrudo(nodo, ctx);
      if (t.trim()) w.crudo(t.replace(/^\n/, ''));
      w.blocco();
      return;
    }
    case 'table':
      // Una tabella dentro una cella o un link si scrive di fila: rifarla per livello costerebbe il quadrato.
      if (ctx.cella || ctx.inLink) { w.inline(' '); figli(sotto); w.inline(' '); return; }
      scriviTabella(nodo, w, sotto);
      return;
    case 'ul': case 'ol': case 'menu': {
      const stacca = () => (ctx.lista ? w.riga() : w.blocco());
      stacca();
      const livello = (ctx.lista || 0) + 1;
      let n = 0;
      for (const x of nodo.children) {
        if (typeof x !== 'string' && x.tag === 'li') {
          if (salta(x, sotto)) continue;
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
      if (ctx.inLink) { figli(sotto); return; }
      const t = inlineDi(nodo.children, { ...sotto, inLink: true });
      if (!t) return;
      const url = risolviLink(nodo.attrs.href, ctx.base);
      w.inline(url && url !== t ? `[${t}](${url})` : t);
      return;
    }
    // Il prezzo scritto in un'immagine, le etichette dei bottoni di un listino, gli orari di una tendina.
    case 'img': {
      const alt = pulisci(nodo.attrs.alt, 200);
      if (alt.length > 1) w.inline(` [immagine: ${alt}] `);
      return;
    }
    case 'input': {
      const tipo = String(nodo.attrs.type || '').toLowerCase();
      const v = pulisci(nodo.attrs.value, 200);
      if (v && (tipo === 'submit' || tipo === 'button' || tipo === 'reset')) w.inline(` ${v} `);
      return;
    }
    case 'select': {
      const voci = trova(nodo, (x) => x.tag === 'option').map((x) => pulisci(testoGrezzo(x), 200)).filter(Boolean);
      if (voci.length) w.inline(` ${voci.join(' / ')} `);
      return;
    }
    case 'button': w.inline(' '); figli(sotto); w.inline(' '); return;
    default: break;
  }
  // Il prezzo disegnato per gli occhi e quello ripetuto per i lettori di schermo stanno attaccati: uno spazio li separa.
  if (nodo.attrs['aria-hidden'] === 'true' || SOLO_LETTORI.test(String(nodo.attrs.class || ''))) {
    w.inline(' '); figli(sotto); w.inline(' '); return;
  }
  if (BLOCCHI.has(tag)) { w.blocco(); figli(sotto); w.blocco(); return; }
  if (RIGHE.has(tag)) { w.riga(); figli(sotto); w.riga(); return; }
  if (tag === 'td' || tag === 'th') { w.inline(' '); figli(sotto); w.inline(' '); return; }
  figli(sotto);
}

function testoCrudo(nodo, ctx) {
  let s = '';
  const pila = [nodo];
  while (pila.length) {
    const x = pila.pop();
    if (typeof x === 'string') { s += x; continue; }
    if (x !== nodo && salta(x, ctx)) continue;
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

// Il contorno, in ordine di pagina: i riquadri di contorno dentro la parte principale e tutto quello che le sta fuori.
function scriviCoda(corpo, principale, ctx) {
  const w = new Scrittore();
  const antenati = new Set();
  for (let x = principale; x; x = x.parent) antenati.add(x);
  const ctxDi = (dentroArticolo) => (dentroArticolo === ctx.dentroArticolo ? ctx : { ...ctx, dentroArticolo });
  const visita = (nodo, dentro, dentroArticolo) => {
    if (typeof nodo === 'string') { if (!dentro) w.inline(nodo.replace(/\s+/g, ' ')); return; }
    if (MAI.has(nodo.tag)) return;
    const c = classifica(nodo, ctxDi(dentroArticolo));
    if (c === CESTINO || c === CHIUSO) return;
    const art = dentroArticolo || nodo.tag === 'article' || nodo.tag === 'main';
    if (nodo === principale) {
      for (const x of nodo.children) visita(x, true, principale !== corpo || art);
      return;
    }
    if (dentro) {
      if (c === CODA) { w.blocco(); scrivi(nodo, w, { ...ctxDi(dentroArticolo), modo: 'largo' }); w.blocco(); return; }
      for (const x of nodo.children) visita(x, true, art);
      return;
    }
    if (antenati.has(nodo)) {
      w.blocco();
      for (const x of nodo.children) visita(x, false, art);
      w.blocco();
      return;
    }
    w.blocco();
    scrivi(nodo, w, { ...ctxDi(dentroArticolo), modo: 'largo' });
    w.blocco();
  };
  visita(corpo, corpo === principale, false);
  return w.testo();
}

// Quello che la pagina tiene chiuso, dovunque stia: arriva tutto, sotto un titolo che dice che l'utente non lo vede.
function scriviChiusi(corpo, ctx) {
  const w = new Scrittore();
  const visita = (nodo, dentroArticolo) => {
    if (typeof nodo === 'string' || MAI.has(nodo.tag)) return;
    const c = classifica(nodo, { ...ctx, dentroArticolo });
    if (c === CESTINO) return;
    if (c === CHIUSO) {
      w.blocco();
      scrivi(nodo, w, { ...ctx, dentroArticolo, modo: 'chiusi' });
      w.blocco();
      return;
    }
    const art = dentroArticolo || nodo.tag === 'article' || nodo.tag === 'main';
    for (const x of nodo.children) visita(x, art);
  };
  visita(corpo, false);
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
  const conTesto = (x) => scriviDa(x, { modo: 'principale', dentroArticolo: true, base: '', lista: 0 }).length >= SOGLIA_CONTENUTO;
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

const TITOLO_CODA = '[Contorno della pagina, qui in fondo: intestazione, piè di pagina, riquadri laterali]';
const TITOLO_CHIUSI = '[Chiuso o nascosto nella pagina: l\'utente lo vede solo aprendo un pannello, una scheda o «leggi tutto», o non lo vede affatto]';

function componi(nodo, corpo, ctx) {
  let principale = scriviDa(nodo, ctx);
  let coda = scriviCoda(corpo, nodo, ctx);
  // Un sito che mette tutto dentro un riquadro di contorno (lo chiama «menu», o è tutto un piè di pagina): letto in ordine.
  if (principale.length < 200 && coda.length > principale.length) {
    principale = scriviDa(corpo, { ...ctx, modo: 'largo', dentroArticolo: false });
    coda = '';
  }
  return { principale, coda, chiusi: scriviChiusi(corpo, ctx) };
}

/**
 * Estrae il testo leggibile da un documento HTML: prima il contenuto, poi il contorno, poi ciò che la pagina tiene chiuso.
 * Ritorna { titolo, descrizione, lingua, testo, soloJavaScript }.
 */
function estrai(html, { url = '' } = {}) {
  const radice = costruisciAlbero(String(html == null ? '' : html));
  misura(radice);
  const m = meta(radice);
  let base = url;
  if (m.base) { try { base = new URL(m.base, url || undefined).href; } catch (_) {} }
  const { nodo, corpo } = sceltaRadice(radice);
  const ctx = { modo: 'principale', dentroArticolo: nodo !== corpo, base, lista: 0 };
  let p = componi(nodo, corpo, ctx);
  // Una pagina tutta sotto un velo trasparente, che i suoi script tolgono a caricamento finito: il velo non è un'esca.
  if (p.principale.length + p.coda.length < 200) {
    const senzaVelo = componi(nodo, corpo, { ...ctx, ignoraInvisibile: true });
    if (senzaVelo.principale.length + senzaVelo.coda.length > 2 * (p.principale.length + p.coda.length)) p = senzaVelo;
  }
  let testo = p.principale;
  if (p.coda) testo += `${testo ? '\n\n' : ''}${TITOLO_CODA}\n${p.coda}`;
  if (p.chiusi) testo += `${testo ? '\n\n' : ''}${TITOLO_CHIUSI}\n${p.chiusi}`;
  return {
    titolo: m.titolo.slice(0, 300),
    descrizione: m.descrizione.slice(0, 500),
    lingua: m.lingua,
    testo,
    soloJavaScript: pareSoloJavaScript(radice, p.principale + p.coda),
  };
}

module.exports = { estrai, decodificaEntita, nomeDiContorno };
