// Lettura del TESTO di una pagina web (azione LEGGI_PAGINA).
// Sola lettura: non scrive, non esegue lo JavaScript della pagina, non tocca il
// disco. Il testo che esce da qui lo scrive chi possiede il sito.
//
// DUE STRADE, E LA PRIMA VINCE. Se la pagina è già aperta in una scheda di Filo
// si legge l'HTML RESO di quella scheda: copre i siti che si costruiscono in
// JavaScript, dove l'HTML scaricato è un guscio vuoto. Altrimenti si scarica,
// con le guardie anti-SSRF di safe-fetch.js.

'use strict';

const { safeFetch } = require('./safe-fetch');

// Tetto sul TESTO, come per i documenti dal disco: un articolo lungo o una
// tabella di prezzi intera ci stanno. Oltre, si tronca e lo si DICHIARA.
const MAX_TEXT_CHARS = 16000;

// Tetto sullo SCARICAMENTO, lo stesso dei documenti letti dal disco: un
// manuale o un contratto scansionato pesano più di qualche MB, e chi chiede
// «leggi questo PDF» non deve avere due risposte diverse a seconda di dove
// sta il file. Oltre il tetto si taglia e lo si DICHIARA: in silenzio il
// modello risponderebbe sicuro su mezza pagina (#553).
const MAX_BYTES = 25 * 1024 * 1024;

// Tetto sull'HTML che si ATTRAVERSA, scaricato o preso da una scheda aperta.
// L'estrazione gira nel processo main: finché non ha finito, nessuna finestra
// risponde. Otto megabyte di markup sono dieci volte la pagina più pesante che
// si incontri e costano mezzo secondo; oltre, si taglia e lo si DICHIARA.
const MAX_HTML_CHARS = 8 * 1024 * 1024;

const TIMEOUT_MS = 15000;

// Quanto si aspetta la pagina già aperta prima di scaricarla lo stesso. È già
// caricata: o risponde subito, o il suo JavaScript è inchiodato e l'attesa non
// finirebbe mai (sullo scaricamento un tempo massimo c'era già).
const MAX_ATTESA_SCHEDA_MS = 5000;

// Quanto contorno entra in coda al contenuto: orari, telefono e indirizzo ci
// stanno; oltre è un elenco di link, che non deve mangiarsi la lettura. Largo
// perché la coda sta DOPO il contenuto e il tetto sul testo taglia da lì.
const MAX_CODA_CHARS = 8000;

// Elementi che non sono TESTO: dentro c'è codice, o roba che non si legge. Non
// escono mai, nemmeno dal ripiego: al modello arrivavano righe di JavaScript
// presentate come il testo della pagina, e lui rispondeva su quelle (#553).
const TAG_ILLEGGIBILI = new Set([
  'script', 'style', 'noscript', 'svg', 'iframe', 'template', 'canvas',
  'object', 'embed', 'video', 'audio', 'map', 'datalist',
]);

// Cornice del sito che non è mai il contenuto: un menu è un menu ovunque stia.
const TAG_FUORI = new Set([...TAG_ILLEGGIBILI, 'dialog', 'nav']);

// Contorno AMBIGUO: sul sito di un locale l'orario sta nel piè di pagina e la
// scheda tecnica nel riquadro di fianco. Non si butta: va in coda (#553).
const TAG_CORNICE = new Set(['header', 'footer', 'aside']);

// Classi e id del rumore, confrontati come TOKEN INTERI: per sottostringa
// `class="header-price"` contiene «header», e il prezzo sparirebbe in silenzio.
// Nel cestino solo i nomi che indicano una FUNZIONE del sito: navigare,
// acconsentire, condividere, pubblicizzare, impaginare, rimandare ad altre
// pagine. Un nome che indica un CONTENITORE il sito lo riempie di quello che
// vuole, quindi non decide niente e va in coda (#553).
const TOKEN_RUMORE = /^(nav|navbar|navigation|menubar|top-?nav|breadcrumbs?|pagination|pager|cookie|cookies|cookie-?banner|cookie-?consent|consent|gdpr|advert|advertising|advertisement|ads?|adsense|social|social-?share|share|sharing|newsletter|subscribe|related|related-?posts|recommended|skip-?link|screen-?reader-?text|sr-only|visually-hidden|toolbar|search-?form)$/i;

// Contorno che può contenere il dato chiesto, quindi va in coda e non nel
// cestino: l'orario sta nel piè di pagina, il prezzo scontato nel «promo», il
// listino di una trattoria nel riquadro chiamato «menu». Qui stanno anche i
// nomi che i programmi per fare siti scrivono da soli (#553).
const TOKEN_CORNICE = /^(banner|promo|promotion|widget|sidebar|side-?bar|hero|header|site-?header|page-?header|masthead|footer|site-?footer|page-?footer|colophon|topbar|top-?bar|bottom-?bar|menu|modal|popup|overlay|subscription|paywall)$/i;

const ROLE_RUMORE = /^(navigation|search|dialog|alertdialog|menu|menubar|toolbar)$/i;

// `tablist` porta le etichette delle schede, e su un listino quelle etichette
// sono i prezzi: «Mensile 9,99», «Annuale 99,00».
const ROLE_CORNICE = /^(banner|contentinfo|complementary|tablist)$/i;

const TAG_TABELLA = new Set(['table', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'caption', 'colgroup', 'col']);

const TAG_ZONA = new Set(['article', 'main']);

const VUOTI = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

// Tag che separano due pezzi di testo: senza, «Prezzo</td><td>42» diventa
// «Prezzo42» e il numero non si legge più.
const BLOCCHI = new Set([
  'p', 'div', 'section', 'article', 'main', 'blockquote', 'pre', 'figure', 'figcaption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'dl', 'dt', 'dd', 'table', 'thead',
  'tbody', 'tfoot', 'tr', 'form', 'fieldset', 'address', 'hr', 'details', 'summary',
  // Sullo schermo sono riquadri separati: senza lo stacco le voci di un menù a
  // tendina diventano «10:0014:3018:00», un orario che non esiste (#553).
  'option', 'optgroup', 'select', 'button', 'label', 'legend', 'caption', 'textarea',
  'output', 'header', 'footer', 'aside', 'nav', 'hgroup',
]);

const LETTERA = /[a-zA-Z]/;

// I nomi dei colori che servono a far sparire del testo. Gli altri non
// servono: l'esca è bianco su bianco, o nero su nero.
const NOMI_COLORE = { white: '#ffffff', black: '#000000' };

/**
 * Lo stile scritto addosso all'elemento, letto come DICHIARAZIONI. PURA.
 *
 * A confrontare il testo grezzo, «opacity:0!important» non somigliava a
 * «opacity:0» e l'esca passava: la parola che serve a far vincere la regola la
 * scrive proprio chi vuole che vinca (#553).
 */
function dichiarazioni(style) {
  const out = new Map();
  for (const pezzo of String(style || '').split(';')) {
    const i = pezzo.indexOf(':');
    if (i < 0) continue;
    const nome = pezzo.slice(0, i).trim().toLowerCase();
    if (nome) out.set(nome, pezzo.slice(i + 1).replace(/!\s*important\s*$/i, '').trim().toLowerCase());
  }
  return out;
}

/** Un colore CSS in una forma confrontabile. PURA. */
function coloreNormale(v) {
  const s = String(v || '').trim().toLowerCase().replace(/\s+/g, '');
  const m = /^#([0-9a-f]{3,4})$/.exec(s);
  const hex = m ? `#${m[1].split('').map((c) => c + c).join('')}` : s;
  const rgb = /^rgba?\((\d+),(\d+),(\d+)/.exec(hex);
  if (rgb) return `#${rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
  return NOMI_COLORE[hex] || hex;
}

/** Il numero di una misura CSS, o NaN. PURA. */
function misura(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Questo elemento è nascosto da quello che ha scritto addosso? PURA.
 *
 * Quello che l'utente non vede non è contenuto della pagina: su una pagina
 * scritta per chi legge con un agente è l'esca (#553). Il testo dipinto col
 * proprio sfondo resta: è il titolo sfumato, e si vede benissimo. Quello che
 * sta nel foglio di stile da qui non si vede: lo prende la lettura dalla
 * scheda aperta, che guarda la pagina resa.
 */
function nascostoInline(style) {
  const d = dichiarazioni(style);
  if (!d.size) return false;
  if (d.get('display') === 'none' || d.get('visibility') === 'hidden') return true;
  if (misura(d.get('opacity')) === 0) return true;
  const corpo = d.get('font-size');
  if (corpo !== undefined && (misura(corpo) === 0 || (misura(corpo) < 1 && /px|pt|%/.test(corpo)))) return true;
  for (const lato of ['left', 'right', 'top', 'bottom', 'text-indent']) {
    if (misura(d.get(lato)) <= -100) return true;
  }
  // Il ritaglio con cui le librerie di stili tolgono dagli occhi il testo
  // riservato ai lettori di schermo: metà o più del riquadro tagliata via.
  const ritaglio = /inset\(\s*(\d+(?:\.\d+)?)%/.exec(d.get('clip-path') || '');
  if (ritaglio && Number(ritaglio[1]) >= 50) return true;
  if (/rect\(\s*0/.test(d.get('clip') || '')) return true;
  if (/\b(?:scale(?:3d|x|y)?|matrix3?d?)\s*\(\s*0(?:\.0+)?\s*[,)]/.test(d.get('transform') || '')) return true;
  const stretto = ['width', 'height'].some((k) => d.has(k) && misura(d.get(k)) <= 1);
  const taglia = /hidden|clip/.test(`${d.get('overflow') || ''} ${d.get('overflow-x') || ''} ${d.get('overflow-y') || ''}`);
  if (stretto && taglia) return true;
  if (/text/.test(d.get('background-clip') || d.get('-webkit-background-clip') || '')) return false;
  const testo = d.get('color');
  if (testo === 'transparent' || /rgba\s*\([^)]*,\s*0(\.0+)?\s*\)/.test(testo || '')) return true;
  const sfondo = d.get('background-color') ?? d.get('background');
  return !!(testo && sfondo && coloreNormale(testo) === coloreNormale(sfondo));
}

/**
 * Dove finisce il tag aperto in `da`. PURA. Torna -1 se non finisce mai.
 *
 * Un `>` dentro un valore fra virgolette non chiude il tag: prenderlo per la
 * fine spezzava l'elemento e faceva sbucare il resto dei suoi attributi in
 * mezzo al testo consegnato al modello (#553). Come un browser, si entra fra
 * le virgolette solo dove può esserci un valore, cioè dopo un `=`.
 */
function fineTag(src, da) {
  let q = '';
  let valore = false;
  // Una virgoletta che non si chiude mai porterebbe via tutta la pagina: se il
  // tag non finisce, vale il primo `>` incontrato dentro le virgolette.
  let ripiego = -1;
  for (let i = da; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === q) q = '';
      else if (c === '>' && ripiego < 0) ripiego = i;
      continue;
    }
    if (c === '>') return i;
    if (c === '=') { valore = true; continue; }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f') continue;
    if (valore && (c === '"' || c === '\'')) q = c;
    valore = false;
  }
  return ripiego;
}

/**
 * Il prossimo tag a partire da `da`, cercato con due indexOf. PURA.
 *
 * Con una regex un `<` senza il suo `>` costringeva a riscandire fino in fondo
 * a ogni tentativo: una coda di tag mai chiusi faceva crescere il costo col
 * QUADRATO della pagina, e 256 KB scritti così tenevano ferma l'app per quasi
 * un minuto (#553). Qui ogni carattere si guarda una volta sola.
 *
 * `salta` è un commento o una dichiarazione: non è testo e non è un elemento.
 * `troncato` è un tag che non chiude mai: da lì in poi la pagina è dentro di
 * lui, come per un browser, e non va consegnata al modello come se fosse testo.
 */
function prossimoTag(src, da) {
  let i = da;
  for (;;) {
    const apre = src.indexOf('<', i);
    if (apre < 0) return null;
    if (src[apre + 1] === '!' || src[apre + 1] === '?') {
      if (src.startsWith('<!--', apre)) {
        const fine = src.indexOf('-->', apre + 4);
        if (fine < 0) return { inizio: apre, troncato: true };
        i = fine + 3;
        return { inizio: apre, fine: i, salta: true };
      }
      const chiude = src.indexOf('>', apre + 2);
      if (chiude < 0) return { inizio: apre, troncato: true };
      return { inizio: apre, fine: chiude + 1, salta: true };
    }
    const chiusura = src[apre + 1] === '/';
    const primo = src[apre + (chiusura ? 2 : 1)];
    if (!primo || !LETTERA.test(primo)) { i = apre + 1; continue; }
    const chiude = fineTag(src, apre + 1);
    if (chiude < 0) return { inizio: apre, troncato: true };
    const corpo = src.slice(apre + (chiusura ? 2 : 1), chiude);
    const m = /^([a-zA-Z][a-zA-Z0-9:_-]*)([\s\S]*)$/.exec(corpo);
    if (!m) { i = apre + 1; continue; }
    return {
      inizio: apre, fine: chiude + 1, chiusura, nome: m[1].toLowerCase(),
      attrsRaw: m[2], autochiuso: /\/\s*$/.test(m[2]),
    };
  }
}

function attributi(raw) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(String(raw || '')))) {
    out[m[1].toLowerCase()] = (m[3] ?? m[4] ?? m[5] ?? '').trim();
  }
  return out;
}

/**
 * Che cosa è questo elemento? PURA. Torna `'illeggibile'` (codice, o roba che
 * l'utente non vede), `'fuori'` (menu, pubblicità, cookie: mai contenuto),
 * `'cornice'` (contorno che però può contenere il dato chiesto) o `false`.
 *
 * Dentro `main`/`article` e in una tabella l'intestazione e la coda sono del
 * PEZZO, non del sito (la data, la firma, i nomi delle colonne): restano al
 * loro posto. Fuori diventano contorno, mai cestino: il nome del riquadro non
 * basta a decidere che il dato chiesto non è lì dentro (#553).
 */
function daScartare(nome, attrs, { inZona = false, primoLivello = false, soloIlleggibile = false } = {}) {
  if (TAG_ILLEGGIBILI.has(nome)) return 'illeggibile';
  if ('hidden' in attrs) return 'illeggibile';
  if (String(attrs['aria-hidden'] || '').toLowerCase() === 'true') return 'illeggibile';
  if (nascostoInline(attrs.style)) return 'illeggibile';
  if (soloIlleggibile) return false;
  if (TAG_FUORI.has(nome)) return 'fuori';
  if (attrs.role && ROLE_RUMORE.test(attrs.role)) return 'fuori';
  const token = `${attrs.class || ''} ${attrs.id || ''}`.split(/[\s]+/).filter(Boolean);
  if (token.some((t) => TOKEN_RUMORE.test(t))) return 'fuori';
  if (inZona || TAG_TABELLA.has(nome)) return false;
  // Un `header` attaccato al corpo della pagina è del sito; più in dentro è
  // l'intestazione del pezzo, e lì stanno il titolo, la data e la firma.
  const cornice = (TAG_CORNICE.has(nome) && primoLivello)
    || (attrs.role && ROLE_CORNICE.test(attrs.role))
    || token.some((t) => TOKEN_CORNICE.test(t));
  return cornice ? 'cornice' : false;
}

// I nomi delle entità dei caratteri 160-255, in ordine di codice. Senza questi
// una pagina che scrive gli accenti in questa forma, e sono tante, arrivava al
// modello con «Fran&ccedil;ois» al posto di «François» (#553).
const LATIN1 = ('nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr '
  + 'deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest '
  + 'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml '
  + 'Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times '
  + 'Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig '
  + 'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml '
  + 'igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide '
  + 'oslash ugrave uacute ucirc uuml yacute thorn yuml').split(' ');

const ENTITA = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'',
  ndash: '–', mdash: '—', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  sbquo: '‚', bdquo: '„', hellip: '…', bull: '•', dagger: '†', Dagger: '‡',
  permil: '‰', lsaquo: '‹', rsaquo: '›', OElig: 'Œ', oelig: 'œ', Scaron: 'Š',
  scaron: 'š', circ: 'ˆ', tilde: '˜', trade: '™', prime: '′', Prime: '″',
  minus: '−', ne: '≠', le: '≤', ge: '≥', infin: '∞', rarr: '→', larr: '←',
  euro: '€', ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '', zwj: '', shy: '',
};
LATIN1.forEach((nome, i) => { ENTITA[nome] = String.fromCharCode(160 + i); });
// Lo spazio unificatore e il trattino morbido: nel testo valgono uno spazio e niente.
ENTITA.nbsp = ' ';
ENTITA.shy = '';

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
    // Prima esatto: `&Eacute;` e `&eacute;` sono due lettere diverse.
    const v = ENTITA[corpo] ?? ENTITA[corpo.toLowerCase()];
    return v === undefined ? tutto : v;
  });
}

/**
 * HTML → testo leggibile: salta gli elementi di cornice con tutto il loro
 * contenuto, tiene i confini fra blocchi e trasforma le voci di elenco in
 * righe. PURA.
 */
function htmlATesto(html, dentroZona = false) {
  const potato = passaggio(html, 'tutto', dentroZona).testo;
  // SE POTARE NON LASCIA NIENTE, SI RINUNCIA ALLA SOLA CORNICE: l'HTML vero è
  // pieno di tag mai chiusi, e un `<nav>` che non chiude si porta via tutto
  // quello che viene dopo. Senza testo la pagina si dichiara vuota.
  return potato || passaggio(html, 'minimo', dentroZona).testo;
}

function passaggio(html, modo, dentroZona = false) {
  const soloIlleggibile = modo === 'minimo';
  // Nel passaggio della coda il contorno non si butta: si raccoglie a parte, in
  // un giro solo, perché ripassare l'HTML raddoppia il tempo su una pagina enorme.
  const tieniCornice = modo === 'cornice';
  const src = String(html == null ? '' : html);
  const fuori = []; // pila degli elementi di cornice ancora aperti
  const zone = []; // pila delle zone di contenuto (article/main) ancora aperte
  const contorno = []; // pila dei blocchi di contorno che finiscono in coda
  const pila = [];
  // Dove sta, nella pila, ogni nome ancora aperto. Cercare a ritroso dentro la
  // pila costava quanto la pila è alta, a ogni chiusura: una fila di aperture
  // e una di chiusure che non si corrispondono faceva crescere il tempo col
  // QUADRATO della pagina, e la lettura gira nel processo delle finestre (#553).
  const indici = new Map();
  const pezzi = [];
  const pezziCornice = [];
  let i = 0;
  const spingi = (s2) => { (contorno.length ? pezziCornice : pezzi).push(s2); };
  const testo = (s2) => { if (!fuori.length && s2) spingi(decodeEntita(s2)); };
  for (;;) {
    const t = prossimoTag(src, i);
    if (!t) { testo(src.slice(i)); break; }
    testo(src.slice(i, t.inizio));
    if (t.troncato) break;
    i = t.fine;
    if (t.salta) continue;
    const chiusura = t.chiusura;
    const nome = t.nome;
    const autochiuso = t.autochiuso || VUOTI.has(nome);
    if (!chiusura) {
      if (autochiuso) {
        if (fuori.length) continue;
        if (nome === 'br' || nome === 'hr') { spingi('\n'); continue; }
        // Quello che sta scritto dentro un campo o sotto un'immagine l'utente lo
        // legge: l'orario già scelto, il totale, il prezzo disegnato (#553).
        if (nome !== 'input' && nome !== 'img') continue;
        const a = attributi(t.attrsRaw);
        const tipo = String(a.type || '').toLowerCase();
        if (daScartare(nome, a, { soloIlleggibile: true })) continue;
        if (nome === 'input' && (tipo === 'hidden' || tipo === 'password')) continue;
        const v = decodeEntita(nome === 'img' ? (a.alt || '') : (a.value || '')).trim();
        if (v) spingi(`\n${v}\n`);
        continue;
      }
      pila.push(nome);
      if (!indici.has(nome)) indici.set(nome, []);
      indici.get(nome).push(pila.length - 1);
      const attrs = attributi(t.attrsRaw);
      const dove = { inZona: dentroZona || zone.length > 0, primoLivello: pila.length === 1, soloIlleggibile };
      const verdetto = daScartare(nome, attrs, dove);
      const contornoQui = tieniCornice && verdetto === 'cornice';
      if (!fuori.length && verdetto && !contornoQui) { fuori.push(pila.length); continue; }
      if (!fuori.length && contornoQui) contorno.push(pila.length);
      if (!fuori.length && (TAG_ZONA.has(nome) || attrs.role === 'main')) zone.push(pila.length);
      if (fuori.length) continue;
      if (nome === 'li') spingi('\n• ');
      else if (BLOCCHI.has(nome)) spingi('\n');
      else if (nome === 'td' || nome === 'th') spingi('\t');
      continue;
    }
    // Chiusura: risale alla corrispondente aperta, se c'è (l'HTML vero è pieno
    // di tag non chiusi, e una pila che non si svuota manderebbe via il resto).
    const dove = pila.lastIndexOf(nome);
    if (dove >= 0) {
      pila.length = dove;
      while (fuori.length && fuori[fuori.length - 1] > pila.length) fuori.pop();
      while (zone.length && zone[zone.length - 1] > pila.length) zone.pop();
      while (contorno.length && contorno[contorno.length - 1] > pila.length) contorno.pop();
    }
    if (fuori.length) continue;
    if (BLOCCHI.has(nome)) spingi('\n');
  }
  return { testo: normalizzaTesto(pezzi.join('')), cornice: normalizzaTesto(pezziCornice.join('')) };
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
  let i = 0;
  for (;;) {
    const t = prossimoTag(src, i);
    if (!t || t.troncato) return null;
    i = t.fine;
    if (t.salta || t.chiusura || t.autochiuso) continue;
    if (VUOTI.has(t.nome) || !vale(t.nome, attributi(t.attrsRaw))) continue;
    // Trovato: cerca la chiusura corrispondente contando gli annidati.
    let livello = 1;
    let j = t.fine;
    for (;;) {
      const d = prossimoTag(src, j);
      if (!d || d.troncato) return src.slice(t.fine);
      j = d.fine;
      if (d.salta || d.autochiuso || d.nome !== t.nome) continue;
      livello += d.chiusura ? -1 : 1;
      if (livello === 0) return src.slice(t.fine, d.inizio);
    }
  }
}

/** Il titolo della pagina: <title>, poi og:title, poi il primo <h1>. PURA. */
function titoloDa(html) {
  const src = String(html == null ? '' : html);
  let og = '';
  let i = 0;
  for (;;) {
    const t = prossimoTag(src, i);
    if (!t || t.troncato || (!t.salta && t.nome === 'body')) break;
    i = t.fine;
    if (t.salta || t.chiusura || t.nome !== 'meta') continue;
    const a = attributi(t.attrsRaw);
    if (/^og:title$/i.test(a.property || a.name || '') && a.content) { og = a.content; break; }
  }
  return normalizzaTesto(
    decodeEntita(sottoalbero(src, (n) => n === 'title') || '').trim()
    || decodeEntita(og).trim()
    || htmlATesto(sottoalbero(src, (n) => n === 'h1') || ''),
  ).split('\n')[0].slice(0, 300);
}

/**
 * Da una pagina HTML al suo CONTENUTO PRINCIPALE. PURA.
 *
 * La zona principale (`<main>`, `role="main"`) vince sul corpo intero, ma solo
 * se ci si trova davvero del testo: su un sito che marca `<main>` attorno a un
 * guscio la regola rigida darebbe una pagina vuota proprio quando il contenuto
 * c'è.
 *
 * `<article>` NON è una zona: una pagina ne ha quanti ne vuole (un messaggio
 * per ciascuno in una discussione, una scheda per ciascuno in un listino), e
 * tenere il primo buttava via la risposta, che sta sempre in uno degli altri
 * (#553). La cornice la toglie già la potatura.
 */
function estraiContenuto(html) {
  const src = String(html == null ? '' : html);
  const titolo = titoloDa(src);
  const corpo = sottoalbero(src, (n) => n === 'body') ?? src;
  const zona = sottoalbero(corpo, (n, a) => n === 'main' || a.role === 'main');
  // Dentro la zona di contenuto già isolata l'intestazione è dell'articolo:
  // il tag che la racchiudeva non c'è più, e senza questo il filtro la
  // scambierebbe per quella del sito.
  // Un giro solo sul corpo: da qui escono sia il contenuto sia il contorno.
  const pieno = passaggio(corpo, 'cornice');
  let testo = zona != null ? htmlATesto(zona, true) : (pieno.testo || passaggio(corpo, 'minimo').testo);
  // Sotto una ventina di caratteri la zona principale non è contenuto: è un
  // guscio che il JavaScript del sito riempirà. Il corpo intero contiene
  // comunque la zona, quindi ripiegare non perde niente: aggiunge rumore.
  if (zona != null && testo.length < 20 && pieno.testo.length > testo.length) testo = pieno.testo;
  const avanzi = zona != null ? `${pieno.testo}\n${pieno.cornice}` : pieno.cornice;
  const coda = testoDiCornice(avanzi, testo);
  return { titolo, testo: coda ? `${testo}\n\n${coda}`.trim() : testo };
}

/**
 * Il testo del CONTORNO che non è già nel contenuto principale. PURA.
 *
 * Il piè di pagina di una trattoria porta l'orario, il telefono e l'indirizzo,
 * e «a che ora apre?» è una delle domande per cui questa lettura esiste. Qui
 * non si decide più a nome: quello che è contorno va in fondo invece che nel
 * cestino, con un tetto perché un elenco di link non mangi tutta la lettura.
 * Menu, pubblicità e banner dei cookie restano fuori anche da qui.
 */
function testoDiCornice(avanzi, principale) {
  if (!avanzi) return '';
  const gia = new Set(String(principale || '').split('\n').map((r) => r.trim()).filter(Boolean));
  const righe = [];
  let lunghezza = 0;
  for (const riga of String(avanzi).split('\n')) {
    const t = riga.trim();
    if (!t || gia.has(t)) continue;
    // Si SALTA la riga che non ci sta, non ci si ferma: l'informativa sui
    // cookie sta in cima al piè di pagina e si portava via l'orario (#553).
    if (lunghezza + t.length + 1 > MAX_CODA_CHARS) continue;
    righe.push(t);
    lunghezza += t.length + 1;
  }
  return righe.join('\n');
}

/** Taglia al tetto dichiarando il troncamento. PURA. */
function tronca(testo, max = MAX_TEXT_CHARS) {
  const s = String(testo == null ? '' : testo);
  if (s.length <= max) return { text: s, truncated: false };
  return { text: s.slice(0, max), truncated: true };
}

/** È un PDF, comunque il sito lo abbia etichettato? PURA. */
function sembraPdf(buffer) {
  if (!buffer || buffer.length < 5) return false;
  try {
    return /^[\s\0]*%PDF-/.test(Buffer.from(buffer).subarray(0, 1024).toString('latin1'));
  } catch (_) { return false; }
}

function tipoDaContentType(ct) {
  const t = String(ct || '').toLowerCase().split(';')[0].trim();
  if (!t || t === 'text/html' || t === 'application/xhtml+xml') return 'html';
  if (t === 'application/pdf') return 'pdf';
  if (t.startsWith('text/') || t === 'application/json' || t === 'application/xml'
    || t === 'application/ld+json' || t.endsWith('+json') || t.endsWith('+xml')) return 'testo';
  return null;
}

// Non «formato non supportato»: chi legge è il modello, e deve poterlo dire
// all'utente in italiano senza inventarselo.
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
  ok: false, url: '', title: '', text: '', truncated: false, partial: false, bytes: 0,
  source: '', kind: '', empty: false, error: null, detail: '',
};

/**
 * Converte quello che è arrivato dalla rete in testo. Separata da `readPage`
 * perché è qui che sta tutta la logica: gli unit test la esercitano per intero
 * senza aprire una connessione.
 */
async function daContenuto({ url = '', contentType = '', buffer = null, status = 200, partial = false } = {}) {
  const base = { ...BASE, url, source: 'rete', bytes: buffer ? buffer.length : 0, partial: !!partial };
  if (status >= 400) {
    return { ...base, error: 'http_error', detail: `il sito ha risposto ${status}` };
  }
  // I primi byte valgono più dell'etichetta: moltissimi siti servono un PDF
  // come file generico da scaricare, e lì Filo rispondeva che quell'indirizzo
  // non è una pagina di testo invece di leggerlo (#553).
  const tipo = sembraPdf(buffer) ? 'pdf' : tipoDaContentType(contentType);
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
      if (partial) {
        return {
          ...base, kind: 'pdf', error: 'too_large',
          detail: `quel documento supera i ${Math.round(MAX_BYTES / (1024 * 1024))} MB e ne è arrivata solo una parte, troppo poco per leggerlo`,
        };
      }
      return { ...base, kind: 'pdf', error: 'pdf_failed', detail: 'il PDF è danneggiato o protetto da password' };
    }
  }
  const intero = decodifica(buffer, contentType);
  // Oltre il tetto non si attraversa: si taglia e il troncamento viaggia con
  // l'esito, come per i byte scaricati.
  const mozzo = intero.length > MAX_HTML_CHARS;
  const grezzo = mozzo ? intero.slice(0, MAX_HTML_CHARS) : intero;
  const parziale = !!partial || mozzo;
  if (tipo === 'testo') {
    const capped = tronca(normalizzaTesto(grezzo));
    return {
      ...base, ok: true, kind: 'text', text: capped.text, truncated: capped.truncated,
      empty: !capped.text, partial: parziale,
    };
  }
  const { titolo, testo } = estraiContenuto(grezzo);
  const capped = tronca(testo);
  return {
    ...base, ok: true, kind: 'html', title: titolo, text: capped.text,
    truncated: capped.truncated, empty: !capped.text, partial: parziale,
  };
}

/**
 * La codifica dichiarata DENTRO la pagina. PURA. I siti più vecchi la scrivono
 * solo lì, e leggerli come se fossero UTF-8 riempie di rombi accenti, virgolette
 * e il simbolo dell'euro: il prezzo arriva al modello storpiato (#553).
 */
function charsetDaHtml(buffer) {
  const testa = Buffer.from(buffer).subarray(0, 4096).toString('latin1');
  const m = testa.match(/<meta[^>]{0,400}?charset\s*=\s*["']?\s*([\w-]+)/i);
  return m ? m[1] : '';
}

// I 32 caratteri che windows-1252 mette dove ISO-8859-1 ha dei comandi di
// controllo: l'euro, le virgolette curve, il trattino lungo.
const C1_1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ'
  + '\u008DŽ\u008F\u0090‘’“”•–—˜™š'
  + '›œ\u009DžŸ';

/** Byte → stringa, rispettando il charset dichiarato quando lo sappiamo fare. */
function decodifica(buffer, contentType) {
  if (!buffer || !buffer.length) return '';
  const b = Buffer.from(buffer);
  const bom = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 'utf-8'
    : (b[0] === 0xff && b[1] === 0xfe ? 'utf-16le' : (b[0] === 0xfe && b[1] === 0xff ? 'utf-16be' : ''));
  const m = String(contentType || '').match(/charset\s*=\s*["']?([\w-]+)/i);
  const enc = (bom || (m ? m[1] : '') || charsetDaHtml(b) || 'utf-8').toLowerCase();
  // Chi dichiara «iso-8859-1» quasi sempre spedisce windows-1252, e i browser
  // lo leggono così. Il decoditore di Electron non lo fa, e senza questa
  // tabella il simbolo dell'euro e le virgolette curve sparivano dal prezzo.
  const latino = /^(iso[-_]?8859-1|latin1|ascii|us-ascii|windows-1252|cp1252)$/.test(enc);
  try {
    const s = new TextDecoder(enc, { fatal: false }).decode(b);
    return latino ? s.replace(/[\u0080-\u009f]/g, (c) => C1_1252[c.charCodeAt(0) - 0x80]) : s;
  } catch (_) {}
  try { return new TextDecoder('utf-8', { fatal: false }).decode(b); } catch (_) {}
  return b.toString('utf8');
}

// I motivi di safe-fetch si traducono qui: il modello deve dire all'utente cosa
// non è andato, e «blocked-private-address» non è una frase.
const MOTIVI_RETE = {
  'blocked-private-address': 'quell\'indirizzo non è un sito pubblico: è il tuo computer o la tua rete locale, e Filo non ci va a leggere',
  'blocked-scheme': 'non è un indirizzo web (http o https)',
  'bad-url': 'l\'indirizzo non è scritto in un modo valido',
  'too-many-redirects': 'il sito continua a rimandare altrove senza mai arrivare a una pagina',
  'dns-empty': 'quel dominio non esiste',
  'blocked-dangerous': 'quel sito è segnalato come pericoloso: Filo non lo legge',
};

/** Il giudizio che protegge una scheda protegge anche una lettura. */
function pericoloso(url) {
  try {
    const SB = globalThis.SN_SAFEBROWSE;
    const v = SB && SB.analyze(url, {});
    return !!(v && v.level === 'pericoloso');
  } catch (_) { return false; }
}

// Con che faccia Filo bussa. Senza, parte il nome di serie di node, che i
// filtri anti-bot riconoscono per primo e bloccano: Filo È un browser e nelle
// sue schede si presenta già così (#553).
function nomeBrowser() {
  try {
    const { session, app } = require('electron');
    return String(session.defaultSession.getUserAgent() || app.userAgentFallback || '');
  } catch (_) { return ''; }
}

async function scarica(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  // Dove si è arrivati DAVVERO: un accorciatore rimanda altrove, e col nome di
  // partenza Filo cita all'utente la fonte sbagliata (#553).
  let arrivo = url;
  try {
    const ua = nomeBrowser();
    const headers = {
      Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
      'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
      ...(ua ? { 'User-Agent': ua } : {}),
    };
    const r = await safeFetch(url, {
      signal: ac.signal,
      headers,
      controllaHop: (u) => { arrivo = u; if (pericoloso(u)) throw new Error('blocked-dangerous'); },
    });
    const contentType = r.headers.get('content-type') || '';
    const pezzi = [];
    let totale = 0;
    let tagliato = false;
    const reader = r.body?.getReader?.();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        pezzi.push(Buffer.from(value));
        totale += value.byteLength;
        if (totale >= MAX_BYTES) { tagliato = true; try { await reader.cancel(); } catch (_) {} break; }
      }
    } else {
      const ab = await r.arrayBuffer();
      pezzi.push(Buffer.from(ab));
      totale = pezzi[0].length;
      tagliato = totale > MAX_BYTES;
    }
    // `partial` viaggia con i byte: chi legge non ha altro modo di sapere che
    // la pagina finisce perché è finito il tetto, non perché è finita lei.
    return {
      status: r.status, contentType, partial: tagliato,
      buffer: Buffer.concat(pezzi).subarray(0, MAX_BYTES),
      arrivo: normalizzaUrl(r.url || arrivo) || url,
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Legge una pagina web e ne restituisce il TESTO.
 *
 * `leggiScheda(url)` è la strada preferita: se la pagina è già aperta in una
 * scheda di Filo deve tornare l'HTML RESO (`{ html, title }`), che passa dalla
 * stessa estrazione dell'HTML scaricato — così la cornice del sito resta fuori
 * per tutte e due le strade. Esito sempre nella stessa forma, anche in caso di
 * rifiuto: chi formatta l'osservazione per il modello non deve indovinare
 * niente.
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
  if (pericoloso(url)) {
    return { ...BASE, url, error: 'blocked_dangerous', detail: MOTIVI_RETE['blocked-dangerous'] };
  }

  if (typeof leggiScheda === 'function') {
    try {
      const reso = await leggiScheda(url);
      // Anche qui il tetto, e dichiarato: una scheda può contenere una pagina
      // enorme quanto un file scaricato.
      const grezzo = String((reso && reso.html) || '');
      const mozzo = grezzo.length > MAX_HTML_CHARS;
      const estratto = grezzo ? estraiContenuto(mozzo ? grezzo.slice(0, MAX_HTML_CHARS) : grezzo) : null;
      const testo = estratto ? estratto.testo : normalizzaTesto(reso && reso.text);
      if (testo) {
        const capped = tronca(testo);
        const parziale = mozzo || !!(reso && reso.partial);
        return {
          ...BASE, ok: true, url, source: 'scheda', kind: 'html',
          title: String((reso && reso.title) || (estratto && estratto.titolo) || '').trim(),
          text: capped.text, truncated: capped.truncated, partial: parziale,
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
  const arrivo = r.arrivo || url;
  return { ...(await daContenuto({ url: arrivo, ...r })), url: arrivo, source: 'rete' };
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
  MAX_HTML_CHARS,
  MAX_CODA_CHARS,
  MAX_ATTESA_SCHEDA_MS,
};
