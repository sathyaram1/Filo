// Sentinella dell'elenco dei servizi esterni (src/shared/serviziEsterni.js, #849): rossa se src/ usa un indirizzo o una
// chiamata di rete che l'elenco non dichiara, o se l'elenco tiene una voce che il codice non usa più.
// Quello che resta fuori dal controllo è dichiarato qui sotto, ognuno col suo perché.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(ROOT, 'package.json'));
const ts = require('typescript');
require(join(ROOT, 'src', 'shared', 'serviziEsterni.js'));
const SE = globalThis.SN_SERVIZI_ESTERNI;
const VOCI = [...SE.SERVIZI, ...SE.LINK_APERTI];

// Testi da leggere, non chiamate: il link di una fonte o del changelog lo apre solo chi lo segue.
const FILE_ESCLUSI = {
  'src/shared/serviziEsterni.js': 'l’elenco stesso: i suoi indirizzi non provano che il codice li usi',
  'src/shared/transparency.js': 'testi e fonti dei documenti di trasparenza',
  'src/shared/patchNotes.js': 'testo del changelog',
  'src/vendor/public-suffix-list/privata.js': 'dati della Public Suffix List: l’indirizzo è la fonte che scripts/aggiorna-psl.mjs clona',
  'src/shared/sitiComuni.js': 'gli indirizzi che il modello può scrivere a memoria: li contatta solo la lettura o l’apertura di una pagina (voce «pagine-lette»)',
};
const DATI_DI_TERZI = { cartella: 'src/vendor/', perche: 'regole e licenze impacchettate: i loro indirizzi sono selettori di pagina' };

// Indirizzi che non portano in rete, in qualunque file.
const NON_DI_RETE = [
  { host: /^www\.w3\.org$/, perche: 'nome di spazio di SVG e XHTML' },
  { host: /^ns\.adobe\.com$/, perche: 'nome di spazio dei metadati XMP' },
  { host: /^(localhost|127\.0\.0\.1|\[::1\])$/, perche: 'il computer stesso' },
  { host: /\*/, perche: 'filtro di indirizzi di Electron' },
];

// Esempi e identificatori: indirizzi scritti nel codice che nessuno contatta.
const ESEMPI = [
  { file: 'src/shared/actionTools.js', url: 'https://…', perche: 'esempio nel testo per il modello' },
  { file: 'src/main/services/handlers.js', url: 'https://…', perche: 'esempio nel testo per il modello' },
  { file: 'src/main/services/providers/openrouter.js', url: 'https://filo.local', perche: 'intestazione HTTP-Referer' },
  { file: 'src/main/services/scryfall.js', url: 'https://singolarita.com', perche: 'recapito nello User-Agent' },
  { file: 'src/main/services/accessoGoogle.js', url: 'https://accounts.google.com/', perche: 'sceglie la sessione delle schede in cui vivono i cookie di Google' },
];

// Indirizzi con l'host composto da un'espressione: quale servizio contattano, o perché non contattano niente.
// Ognuno si riconosce dal file e da un pezzo della sua riga; uno nuovo fa rosso finché non è qui.
const COMPOSTI = [
  { file: 'src/main/services/llmsTxt.js', testo: '`https://${domain}/llms.txt`', servizio: 'llms-txt' },
  { file: 'src/main/services/fontiSegnaposto.js', testo: '`https://${lingua}.wikipedia.org`', servizio: 'fonti-segnaposti' },
  { file: 'src/main/services/geoBlockClassifier.js', testo: 'SB.ownerOf(url || `https://${host}/`', perche: 'chiave del conto dei giudizi per sito' },
  { file: 'src/main/services/handlers.js', testo: 'url : `https://${url}`', perche: 'chiede al blocco dei siti di un indirizzo scritto senza schema' },
  { file: 'src/main/services/handlers.js', testo: 'sito ? `https://${sito}/`', perche: 'l’indirizzo mostrato al posto di una pagina delicata' },
  { file: 'src/main/services/permessiPagine.js', testo: '`http://${t}`).hostname', perche: 'ne estrae il nome del sito' },
  { file: 'src/main/services/safebrowse/normalize.js', testo: "new URL('http://' + s)", perche: 'normalizza l’indirizzo da controllare' },
  { file: 'src/main/preloadPacchetto.js', testo: "new URL('http://' + d).hostname", perche: 'il domainToASCII del preload in sandbox: ne estrae il nome del sito' },
  { file: 'src/main/services/siteBlock.js', testo: 'new URL(`http://${s}`).hostname', perche: 'ne estrae il nome del sito' },
  { file: 'src/main/tabs.js', testo: '? src : `https://${src}`', perche: 'il nome del sito delle regole del proxy' },
  { file: 'src/pages/dashboard/dashboard-comandi.js', testo: 'raw : `https://${raw}`', perche: 'il sito scritto dall’utente, che si apre in una scheda' },
  { file: 'src/shared/stessoSito.js', testo: '`http://${s}`', perche: 'ne estrae il nome del sito' },
  { file: 'src/shared/nomiSito.js', testo: '`http://${s}`).hostname', perche: 'ne estrae il nome del sito' },
  { file: 'src/shared/tabTriage.js', testo: 's = `https://${s}`', perche: 'ne estrae il nome del sito da tenere sempre aperto' },
  { file: 'src/shared/urlExfil.js', testo: "new URL('https://' + url)", perche: 'analizza un indirizzo che potrebbe portare fuori dati' },
  { file: 'src/shared/urlExfil.js', testo: 'new URL(`https://${url}`)', perche: 'analizza un indirizzo che potrebbe portare fuori dati' },
  { file: 'src/shared/urlExfil.js', testo: 'l : `https://${l}`', perche: 'la chiave di confronto di un link scritto in chat' },
  { file: 'src/main/services/pageRead.js', testo: 's = `http://${s}`', servizio: 'pagine-lette' },
  { file: 'src/main/services/pageRead.js', testo: 's = `https://${s}`', servizio: 'pagine-lette' },
  { file: 'src/main/services/pageRead.js', testo: 'trovati.push(`https://${m[1]}`)', perche: 'la chiave di confronto di un link scritto senza schema' },
  { file: 'src/main/services/pageRead.js', testo: '`https://${m[1]}`;', perche: 'la chiave di un indirizzo scritto dal modello, solo da confrontare' },
];

// Chiamate di rete che non contattano un servizio.
const CHIAMATE_LOCALI = {
  'src/main/services/hostResolve.js': 'net solo per isIP; se un host esiste lo chiede al resolver del sistema',
  'src/main/protocol.js': 'net.fetch sui file delle pagine filo://',
  'src/main/test-servizi-chiusi.js': 'la fetch finta delle prove',
  'src/pages/security/security.js': 'fetch su un data: URL, per rimettere un’immagine negli appunti',
};

// Una pagina di Filo contatta un sito anche senza fetch: un'immagine il cui indirizzo viene dai dati (#849.6, #1273).
// Ognuna si riconosce dal file, dalla funzione che la contiene e da un pezzo della sua riga: o il servizio che contatta,
// o il perché non contatta nessuno. Una nuova fa rosso finché non è qui.
const IMMAGINI_DAI_DATI = [
  { file: 'src/pages/editor/editor.js', funzione: 'inlineToHtml', testo: '<img src="${escapeHtml(String(n.attrs.src).trim())}"', servizio: 'immagini-nei-documenti' },
  { file: 'src/pages/decks/decks.js', funzione: 'manaHtml', testo: 'src="${esc(uri)}"', servizio: 'scryfall' },
  { file: 'src/pages/decks/decks.js', funzione: 'deckCardHtml', testo: "background-image:url('${esc(art)}')", servizio: 'scryfall' },
  { file: 'src/pages/decks/decks.js', funzione: 'preloadImage', testo: 'img.src = url;', servizio: 'scryfall' },
  { file: 'src/pages/decks/decks.js', funzione: 'paintCardImage', testo: 'img.src = (card && card.image)', servizio: 'scryfall' },
  { file: 'src/pages/decks/decks.js', funzione: 'flipCardImage', testo: 'img.src = toBack ? card.backImage : card.image;', servizio: 'scryfall' },
  { file: 'src/pages/home/home.js', funzione: 'renderCard', testo: 'img.src = page.favicon;', perche: 'la copia dell’icona che Filo tiene (filo://icone/), o un data: in incognito: la riga sopra non lascia passare altro' },
  { file: 'src/pages/home/home.js', funzione: 'renderCard', testo: 'url(${JSON.stringify(page.thumbnail)})', perche: 'la miniatura della pagina salvata, un data: fatto dal main (miniature.accettabile)' },
  { file: 'src/pages/home/home.js', funzione: 'renderTile', testo: 'url(${JSON.stringify(t.thumb)})', perche: 'la miniatura della categoria, la stessa della pagina che l’ha creata' },
  { file: 'src/pages/dashboard/dashboard.js', funzione: 'applyAccountProfile', testo: 'img.src = profile.picture;', perche: 'la copia della foto del profilo (filo://icone/), controllata sopra' },
  { file: 'src/renderer/shell.js', funzione: 'renderAccount', testo: 'img.src = authProfile.picture;', perche: 'la copia della foto del profilo (filo://icone/), controllata sopra' },
  { file: 'src/renderer/barra.js', funzione: 'disegnaAccount', testo: 'img.src = a.foto;', perche: 'la copia della foto del profilo (filo://icone/), controllata sopra' },
  { file: 'src/pages/dashboard/dashboard-carte.js', funzione: 'faviconDi', testo: 'img.src = dato', perche: 'l’icona del sito che il main consegna come data: (voce «icone-dei-siti»)' },
  { file: 'src/pages/dashboard/dashboard-attivita.js', funzione: 'iconaSitoEl', testo: 'img.src = dato', perche: 'l’icona del sito che il main consegna come data: (voce «icone-dei-siti»)' },
  { file: 'src/renderer/shell.js', funzione: 'applicaScheda', testo: 'url("${nota.dato}")', perche: 'l’icona della scheda, un data: scaricato dal main con la sessione della scheda' },
  { file: 'src/renderer/shell.js', funzione: 'fontiDelloSchermo', testo: 'img.src = f.anteprima;', perche: 'l’anteprima della fonte, un data: controllato sopra' },
  { file: 'src/renderer/anteprima.js', testo: 'img.src = d.src;', perche: 'un data: controllato sopra' },
  { file: 'src/pages/dashboard/dashboard.js', funzione: 'rendiMessaggi', testo: 'img.src = src;', perche: 'le foto mandate in chat, data: filtrati prima' },
  { file: 'src/pages/dashboard/dashboard.js', funzione: 'bollaUtente', testo: 'img.src = src;', perche: 'le immagini del messaggio appena scritto, data: incollati o trascinati' },
  { file: 'src/pages/dashboard/dashboard.js', funzione: 'renderImagePreviews', testo: 'img.src = dataUrl;', perche: 'le immagini incollate in attesa di partire, data:' },
  { file: 'src/pages/dashboard/dashboard.js', funzione: 'openLightbox', testo: ".src = src;", perche: 'l’ingrandimento di un’immagine della chat già a schermo' },
  { file: 'src/pages/security/security.js', funzione: 'renderClipboard', testo: 'thumb.src = entry.dataUrl;', perche: 'la cronologia degli appunti: le immagini copiate, data:' },
  { file: 'src/pages/feedback/feedback.js', funzione: 'mostraAnteprimaAllegato', testo: 'im.src = locale;', perche: 'l’allegato appena scelto, un blob: del file' },
  { file: 'src/pages/feedback/feedback.js', funzione: 'mostraAnteprimaAllegato', testo: 'im.src = dataUrl;', perche: 'l’allegato decifrato dal main, data:' },
  { file: 'src/pages/feedback/feedback.js', funzione: 'renderThumbs', testo: 'lightboxImg.src = piena;', perche: 'l’ingrandimento di un’anteprima già a schermo' },
  { file: 'src/pages/feedback/feedback.js', funzione: 'render', testo: 'lightboxImg.src = img.dataset.full;', perche: 'l’ingrandimento di un’anteprima già a schermo' },
  { file: 'src/pages/feedback/feedback.js', funzione: 'render', testo: 'img.src = dataUrl;', perche: 'l’allegato decifrato dal main, data:' },
  { file: 'src/pages/manage/manage.js', funzione: 'resolveBubbleImages', testo: 'img.src = dataUrl;', perche: 'l’allegato decifrato dal main, data:' },
  { file: 'src/pages/manage/manage.js', funzione: 'openLightbox', testo: 'mgLightboxImg.src = src;', perche: 'l’ingrandimento di un’anteprima già a schermo' },
];

// In un file che fa rete ogni testo con la forma di un nome di dominio è una destinazione, per qualunque strada arrivi
// alla chiamata (opzioni, join, concat…). Fanno eccezione le costanti qui sotto, nomi che il file confronta e non contatta.
const NOMI_NON_CONTATTATI = [
  { file: 'src/main/services/adblock.js', costante: 'BASE_WHITELIST', perche: 'i siti che il blocco della pubblicità non blocca mai' },
  { file: 'src/shared/feedback.js', costante: 'BUCKET', perche: 'il nome del deposito degli allegati, che sta nel percorso dell’indirizzo' },
  { file: 'src/shared/feedback.js', costante: 'PREFISSI_ALLEGATO', perche: 'riconosce un allegato di Filo anche nella forma storage.googleapis.com; Filo li scrive tutti sotto firebasestorage' },
];
// Un nome di file ha la stessa forma di un dominio: queste estensioni non sono domini di primo livello.
const ESTENSIONI_DI_FILE = new Set(['json', 'html', 'htm', 'js', 'mjs', 'cjs', 'css', 'bin', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'txt', 'log', 'wasm', 'pdf', 'map']);

const CHIAVI_HOST = new Set(['host', 'hostname']);
// Un host già intero seguito da un'espressione (`https://api.x.it${percorso}`) è un indirizzo fisso, non dinamico.
const HOST_INTERO_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?$/;
const eDominio = (s) => HOST_INTERO_RE.test(s) && !ESTENSIONI_DI_FILE.has(s.replace(/:\d+$/, '').split('.').pop());

const ESTENSIONI = ['.js', '.mjs', '.cjs', '.html', '.css', '.json'];
const URL_RE = /\b(?:https?|wss?):\/\/[^\s'"`<>()\\]*/gi;
// safeFetch e fetchList sono gli involucri del progetto che fanno rete per conto di un altro file.
const CHIAMATA_RE = /\bfetch\s*\(|\bnet\s*\.\s*(?:request|fetch|connect|createConnection)\b|\bglobalThis\s*\.\s*fetch\b|\bnew\s+(?:WebSocket|EventSource|XMLHttpRequest)\b|\bsendBeacon\s*\(|\b(?:safeFetch|fetchList)\s*\(/;
// Un file che prende un modulo di rete fa rete, comunque poi chiami le sue funzioni (per nome, destrutturate, al volo).
// Uno che lo prende solo per un aiuto (net.isIP) si dichiara fra le chiamate locali.
const MODULO_RETE_RE = /\brequire\(\s*['"](?:node:)?(?:https?|http2|tls|net|dgram)['"]\s*\)|\bfrom\s+['"](?:node:)?(?:https?|http2|tls|net|dgram)['"]|\brequire\(\s*['"]electron['"]\s*\)\s*\.\s*net\b|\{[^}]*\bnet\b[^}]*\}\s*=\s*require\(\s*['"]electron['"]\s*\)|\bimport\s*\{[^}]*\bnet\b[^}]*\}\s*from\s+['"]electron['"]/;

const K = ts.SyntaxKind;
const PAROLE_PRIMA_DI_REGEX = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'instanceof', 'new', 'delete', 'void', 'throw', 'yield', 'await']);
const PRIMA_DI_DIVISIONE = new Set([K.Identifier, K.NumericLiteral, K.BigIntLiteral, K.StringLiteral, K.NoSubstitutionTemplateLiteral, K.TemplateTail, K.CloseParenToken, K.CloseBracketToken, K.ThisKeyword, K.TrueKeyword, K.FalseKeyword, K.NullKeyword, K.PlusPlusToken, K.MinusMinusToken, K.CloseBraceToken]);
const LETTERALI = new Set([K.StringLiteral, K.NoSubstitutionTemplateLiteral, K.TemplateHead, K.TemplateMiddle, K.TemplateTail]);

// Contatore che avanza soltanto: le posizioni arrivano in ordine, e ricontare da capo costava secondi.
function contaRighe(testo) {
  let pos = 0, n = 1;
  return (fino) => {
    for (; pos < fino; pos++) if (testo.charCodeAt(pos) === 10) n++;
    return n;
  };
}

// Il lexer di TypeScript separa commenti, stringhe, template e regex: una regex sul testo grezzo li confonde.
function leggiJs(testo) {
  const sc = ts.createScanner(ts.ScriptTarget.ESNext, false, ts.LanguageVariant.Standard, testo);
  const frammenti = [];
  const commenti = [];
  const letterali = [];
  const riga = contaRighe(testo);
  const pila = [];
  let prima = null, primaTesto = '', primaPrimaTesto = '', ultimo = null;
  for (;;) {
    let k = sc.scan();
    if (k === K.EndOfFileToken) break;
    const da = sc.getTokenStart();
    if (k === K.SingleLineCommentTrivia || k === K.MultiLineCommentTrivia) {
      commenti.push([da, sc.getTextPos()]);
      continue;
    }
    if (k === K.WhitespaceTrivia || k === K.NewLineTrivia || k === K.ShebangTrivia) continue;
    if ((k === K.SlashToken || k === K.SlashEqualsToken) && (!PRIMA_DI_DIVISIONE.has(prima) || PAROLE_PRIMA_DI_REGEX.has(primaTesto))) {
      k = sc.reScanSlashToken();
    }
    if (k === K.TemplateHead) pila.push('tpl');
    else if (k === K.OpenBraceToken) pila.push('{');
    else if (k === K.CloseBraceToken) {
      if (pila.at(-1) === '{') pila.pop();
      else if (pila.at(-1) === 'tpl') { k = sc.reScanTemplateToken(false); if (k === K.TemplateTail) pila.pop(); }
    }
    if (k === K.PlusToken && ultimo) ultimo.concat = true;
    ultimo = null;
    if (LETTERALI.has(k)) {
      const valore = sc.getTokenValue();
      // `{ hostname: 'x.it' }` di net.request o https.request: l'host senza schema è un indirizzo come gli altri.
      const host = (k === K.StringLiteral || k === K.NoSubstitutionTemplateLiteral) && prima === K.ColonToken
        && CHIAVI_HOST.has(primaPrimaTesto.replace(/^['"]|['"]$/g, '')) && /^[a-z0-9.-]+$/i.test(valore);
      ultimo = { valore: host ? `https://${valore}` : valore, riga: riga(da), segue: k === K.TemplateHead || k === K.TemplateMiddle };
      frammenti.push(ultimo);
      letterali.push([da + 1, sc.getTextPos() - 1]);
    } else if (k === K.RegularExpressionLiteral) {
      letterali.push([da + 1, sc.getTextPos() - 1]);
    }
    primaPrimaTesto = primaTesto;
    prima = k;
    primaTesto = sc.getTokenText();
  }
  const tutti = [...commenti, ...letterali].sort((x, y) => x[0] - y[0]);
  return { frammenti, codice: svuota(testo, tutti), senzaCommenti: svuota(testo, commenti) };
}

// I tratti diventano spazi e le righe restano dove sono, così una posizione vale in tutte e tre le versioni del testo.
function svuota(testo, tratti) {
  let out = '', pos = 0;
  for (const [da, a] of tratti) {
    if (a <= pos) continue;
    const inizio = Math.max(da, pos);
    out += testo.slice(pos, inizio) + testo.slice(inizio, a).replace(/[^\n]/g, ' ');
    pos = a;
  }
  return out + testo.slice(pos);
}

function leggiMarkup(testo, commento) {
  const pulito = testo.replace(commento, (m) => m.replace(/[^\n]/g, ' '));
  const frammenti = pulito.split('\n').map((valore, i) => ({ valore, riga: i + 1, segue: false }));
  return { frammenti, codice: pulito, senzaCommenti: pulito };
}

function leggi(file, testo) {
  if (file.endsWith('.html')) return leggiMarkup(testo, /<!--[\s\S]*?-->/g);
  if (file.endsWith('.css')) return leggiMarkup(testo, /\/\*[\s\S]*?\*\//g);
  if (file.endsWith('.json')) return leggiMarkup(testo, /(?!)/g);
  return leggiJs(testo);
}

// Un indirizzo è dinamico quando il suo host lo completa un'espressione: `https://${dominio}/x`, 'https://' + host.
// È «composto» quando l'espressione lo costruisce davvero; un 'https://' da solo, in un startsWith, non compone niente.
function indirizziDi(frammenti, righe) {
  const out = [];
  for (const fr of frammenti) {
    for (const m of fr.valore.matchAll(URL_RE)) {
      const url = m[0];
      const resto = url.slice(url.indexOf('://') + 3);
      const host = resto.split(/[/?#]/)[0].toLowerCase();
      const finoAllaFine = m.index + url.length === fr.valore.length;
      const continua = finoAllaFine && !!(fr.segue || fr.concat) && !/[/?#]/.test(resto);
      const dinamico = !host || (continua && !HOST_INTERO_RE.test(host));
      const composto = dinamico && continua;
      out.push({ url, host, riga: fr.riga, dinamico, composto, testoRiga: righe[fr.riga - 1] || '' });
    }
  }
  return out;
}

const METODI_RICHIESTA = new Set(['request', 'get', 'connect', 'createConnection']);
const testoDi = (e) => (e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : null);

// Solo per un file che fa rete. I nomi di dominio sono destinazioni (vedi NOMI_NON_CONTATTATI). Nelle opzioni di una
// richiesta (`https.request({ hostname: HOST })`) una costante del file vale come l'host scritto lì; ogni altra
// espressione è un host composto, da dichiarare.
function destinazioniNelCodice(file, testo, righe) {
  const sf = ts.createSourceFile(file, testo, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const esclusi = new Set(NOMI_NON_CONTATTATI.filter((x) => x.file === file).map((x) => x.costante));
  const costanti = new Map();
  const out = [];
  const rigaDi = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  (function giro(n, dentroEscluso) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      if (testoDi(n.initializer) !== null) costanti.set(n.name.text, testoDi(n.initializer));
      if (esclusi.has(n.name.text)) dentroEscluso = true;
    }
    if (!dentroEscluso && testoDi(n) !== null && eDominio(n.text)) {
      const riga = rigaDi(n);
      out.push({ url: `https://${n.text}`, host: n.text, riga, dinamico: false, composto: false, testoRiga: righe[riga - 1] || '' });
    }
    ts.forEachChild(n, (c) => giro(c, dentroEscluso));
  })(sf, false);
  (function giro(n) {
    const callee = ts.isCallExpression(n) ? n.expression : null;
    const metodo = callee && (ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : '');
    for (const arg of (metodo && METODI_RICHIESTA.has(metodo) ? n.arguments : [])) {
      if (!ts.isObjectLiteralExpression(arg)) continue;
      for (const p of arg.properties) {
        if (!p.name || !CHIAVI_HOST.has(p.name.text)) continue;
        const espr = ts.isShorthandPropertyAssignment(p) ? p.name : ts.isPropertyAssignment(p) ? p.initializer : null;
        if (!espr || testoDi(espr) !== null) continue; // il letterale lo legge già il lexer
        const riga = rigaDi(p);
        const testoRiga = righe[riga - 1] || '';
        const host = ts.isIdentifier(espr) ? costanti.get(espr.text) : null;
        if (host && eDominio(host)) continue; // la costante l'ha già presa la regola dei nomi di dominio
        if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host)) out.push({ url: `https://${host}`, host: host.toLowerCase(), riga, dinamico: false, composto: false, testoRiga });
        else out.push({ url: 'https://', host: '', riga, dinamico: true, composto: true, testoRiga });
      }
    }
    ts.forEachChild(n, giro);
  })(sf);
  return out;
}

// Il codice che gira dentro le pagine di Filo: le pagine, la barra, e i moduli condivisi che le pagine caricano
// (finestre di conferma, avvisi, pannelli); quello che caricano parte dalla loro sessione, coi dati dell'utente intorno.
const PAGINE_INTERNE = /^src\/(pages|renderer|shared)\/.+\.[cm]?js$/;
// `background` da solo è quasi sempre un colore: un'immagine lì dentro passa da `url(`, che lo vede la regola dei testi.
const PROPRIETA_IMMAGINE = new Set(['src', 'srcset', 'poster', 'backgroundImage']);
const ATTRIBUTI_IMMAGINE = new Set(['src', 'srcset', 'poster', 'background-image']);
// Un testo che apre un attributo d'immagine o un url() CSS: l'espressione che lo segue è l'indirizzo che si carica.
const APRE_SORGENTE = /(?:\b(?:src|srcset|poster)\s*=\s*["']?|url\(\s*["']?)$/i;
const letterale = (e) => !!e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e));
const ultimoLetterale = (e) => (letterale(e) ? e : e && ts.isBinaryExpression(e) && e.operatorToken.kind === K.PlusToken ? ultimoLetterale(e.right) : null);

function nomeDiFunzione(n) {
  if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n)) && n.name) return n.name.getText();
  if ((ts.isVariableDeclaration(n) || ts.isPropertyAssignment(n)) && n.initializer
    && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) return n.name.getText();
  return '';
}

// Un'immagine che una pagina interna carica da un indirizzo non scritto nel codice: `img.src = voce.favicon`,
// setAttribute('src', …), `<img src="${…}">`, `url(${…})`. Una per riga.
function immaginiDi(file, testo, righe) {
  if (!PAGINE_INTERNE.test(file)) return [];
  const sf = ts.createSourceFile(file, testo, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const trovate = new Map();
  const segna = (n, funzione) => {
    const riga = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    if (!trovate.has(riga)) trovate.set(riga, { file, riga, funzione, testoRiga: righe[riga - 1] || '' });
  };
  (function giro(n, funzione) {
    funzione = nomeDiFunzione(n) || funzione;
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === K.EqualsToken && ts.isPropertyAccessExpression(n.left)
      && PROPRIETA_IMMAGINE.has(n.left.name.text) && !letterale(n.right)) segna(n, funzione);
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && /^(setAttribute|setProperty)$/.test(n.expression.name.text)
      && letterale(n.arguments[0]) && ATTRIBUTI_IMMAGINE.has(n.arguments[0].text) && n.arguments[1] && !letterale(n.arguments[1])) segna(n, funzione);
    if (ts.isTemplateExpression(n)) {
      const prima = [n.head, ...n.templateSpans.map((s) => s.literal)];
      n.templateSpans.forEach((s, i) => { if (APRE_SORGENTE.test(prima[i].text)) segna(s.expression, funzione); });
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === K.PlusToken && !letterale(n.right)) {
      const l = ultimoLetterale(n.left);
      if (l && APRE_SORGENTE.test(l.text)) segna(n.right, funzione);
    }
    ts.forEachChild(n, (c) => giro(c, funzione));
  })(sf, '');
  return [...trovate.values()];
}

function analizza(sorgenti) {
  const indirizzi = [];
  const chiamate = new Set();
  const testi = new Map();
  const immagini = [];
  for (const [file, testo] of Object.entries(sorgenti)) {
    const l = leggi(file, testo);
    testi.set(file, l);
    const righe = testo.split('\n');
    immagini.push(...immaginiDi(file, testo, righe));
    const letti = indirizziDi(l.frammenti, righe);
    for (const u of letti) indirizzi.push({ file, ...u });
    if (CHIAMATA_RE.test(l.codice) || MODULO_RETE_RE.test(l.senzaCommenti)) {
      chiamate.add(file);
      if (!/\.[cm]?js$/.test(file) || CHIAMATE_LOCALI[file]) continue;
      // `{ hostname: 'x.it' }` lo legge già il lexer: lo stesso host sulla stessa riga non si conta due volte.
      for (const u of destinazioniNelCodice(file, testo, righe)) {
        if (!letti.some((x) => x.riga === u.riga && x.url === u.url)) indirizzi.push({ file, ...u });
      }
    }
  }
  return { indirizzi, chiamate, testi, sorgenti, immagini };
}

const immagineDi = (u) => IMMAGINI_DAI_DATI.find((c) => c.file === u.file && (!c.funzione || c.funzione === u.funzione) && u.testoRiga.includes(c.testo));

function immaginiScoperte(analisi) {
  return analisi.immagini.filter((u) => !immagineDi(u)).map((u) => `${u.file}:${u.riga} (${u.funzione || 'fuori da una funzione'}) ${u.testoRiga.trim()}`);
}

const usaConImmagini = (v, f, analisi) => analisi.immagini.some((u) => u.file === f && immagineDi(u)?.servizio === v.id);

const nonDiRete = (host) => NON_DI_RETE.some((r) => r.host.test(host.replace(/:\d*$/, '')));
const esempioDi = (file, url) => ESEMPI.find((e) => e.file === file && SE.copre(e.url, url));

function indirizziScoperti(analisi) {
  const out = [];
  for (const u of analisi.indirizzi) {
    if (u.dinamico || nonDiRete(u.host) || esempioDi(u.file, u.url)) continue;
    if (VOCI.some((v) => v.dove.includes(u.file) && v.base.some((b) => SE.copre(b, u.url)))) continue;
    const di = VOCI.filter((v) => v.base.some((b) => SE.copre(b, u.url))).map((v) => v.id);
    out.push(`${u.file}:${u.riga} ${u.url}` + (di.length ? ` (servizio di «${di.join('», «')}», che non ha questo file nel suo «dove»)` : ''));
  }
  return out;
}

const compostoDi = (u) => COMPOSTI.find((c) => c.file === u.file && u.testoRiga.includes(c.testo));

function compostiScoperti(analisi) {
  return analisi.indirizzi.filter((u) => u.composto && !nonDiRete(u.host) && !compostoDi(u))
    .map((u) => `${u.file}:${u.riga} ${u.testoRiga.trim()}`);
}

function chiamateScoperte(analisi) {
  return [...analisi.chiamate].filter((f) => !CHIAMATE_LOCALI[f] && !SE.SERVIZI.some((v) => v.dove.includes(f))).sort();
}

const proveDi = (v) => [].concat(v.prova || []);

// In un file che serve più servizi la chiamata e l'indirizzo condiviso non dicono quale: vale la «prova» della voce,
// o un indirizzo sotto la sua base che nessun'altra voce di quel file copre.
function vivaNelFile(v, f, analisi, fissi) {
  if (usaConImmagini(v, f, analisi)) return true;
  const l = analisi.testi.get(f);
  const prove = proveDi(v);
  const conProva = prove.some((p) => l.senzaCommenti.includes(p));
  const suoi = fissi.filter((u) => u.file === f && v.base.some((b) => SE.copre(b, u.url)));
  const vicine = SE.SERVIZI.filter((x) => x !== v && x.dove.includes(f));
  if (SE.SERVIZI.includes(v) && vicine.length) {
    if (prove.length) return conProva;
    return suoi.some((u) => !vicine.some((x) => x.base.some((b) => SE.copre(b, u.url))));
  }
  return suoi.length > 0 || (SE.SERVIZI.includes(v) && analisi.chiamate.has(f)) || conProva;
}

function vociMorte(analisi) {
  const out = [];
  const fissi = analisi.indirizzi.filter((u) => !u.dinamico);
  for (const v of VOCI) {
    for (const f of v.dove) {
      if (!analisi.testi.get(f)) { out.push(`${v.id}: «${f}» non esiste fra i sorgenti guardati`); continue; }
      if (!vivaNelFile(v, f, analisi, fissi)) out.push(`${v.id}: in «${f}» non c'è più niente che lo usi`);
    }
    const prove = proveDi(v);
    if (prove.length && !v.dove.some((f) => prove.some((p) => analisi.testi.get(f)?.senzaCommenti.includes(p)))) {
      out.push(`${v.id}: «${prove.join('», «')}» non compare più in ${v.dove.join(', ')}`);
    }
    // Un indirizzo rimasto in una costante non è un uso: senza una chiamata nei suoi file serve la «prova» di come parte.
    if (SE.SERVIZI.includes(v) && !v.nellaLibreria && !prove.length
      && !v.dove.some((f) => analisi.chiamate.has(f) || usaConImmagini(v, f, analisi))) {
      out.push(`${v.id}: nessun file del suo «dove» fa chiamate di rete; se parte in un altro modo (un'immagine, una finestra) scrivilo nella «prova»`);
    }
    if (v.nellaLibreria) continue;
    for (const b of v.base) if (!fissi.some((u) => SE.copre(b, u.url))) out.push(`${v.id}: nessun indirizzo del codice sta più sotto ${b}`);
  }
  return out;
}

function sorgentiDi(dir, acc = {}) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) { sorgentiDi(p, acc); continue; }
    if (!ESTENSIONI.some((x) => nome.endsWith(x))) continue;
    const rel = relative(ROOT, p).replace(/\\/g, '/');
    if (FILE_ESCLUSI[rel] || (rel.endsWith('.json') && rel.startsWith(DATI_DI_TERZI.cartella))) continue;
    acc[rel] = readFileSync(p, 'utf8');
  }
  return acc;
}

const SORGENTI = sorgentiDi(join(ROOT, 'src'));
const ANALISI = analizza(SORGENTI);
const COME_SI_CORREGGE = 'Se Filo contatta un servizio nuovo, aggiungi la voce in src/shared/serviziEsterni.js (o il file al «dove» della sua voce). '
  + 'Se l’indirizzo non viene contattato, dichiaralo fra le esclusioni di tests/unit/serviziEsterni.test.mjs col suo perché.';

test('ogni indirizzo di rete scritto in src/ sta nell’elenco, con il file che lo usa', () => {
  const scoperti = indirizziScoperti(ANALISI);
  assert.deepEqual(scoperti, [], `Indirizzi che l’elenco non dichiara:\n  ${scoperti.join('\n  ')}\n${COME_SI_CORREGGE}`);
});

test('ogni indirizzo con l’host composto dichiara il servizio che contatta, o che non ne contatta nessuno', () => {
  const scoperti = compostiScoperti(ANALISI);
  assert.deepEqual(scoperti, [], `Indirizzi con l’host composto che nessuno dichiara:\n  ${scoperti.join('\n  ')}\n${COME_SI_CORREGGE}`);
});

test('ogni file che fa chiamate di rete è nel «dove» di un servizio dell’elenco', () => {
  const scoperte = chiamateScoperte(ANALISI);
  assert.deepEqual(scoperte, [], `File con chiamate di rete che nessuna voce nomina:\n  ${scoperte.join('\n  ')}\n${COME_SI_CORREGGE}`);
});

test('ogni immagine che una pagina di Filo carica da un indirizzo letto dai dati dice cosa contatta', () => {
  const scoperte = immaginiScoperte(ANALISI);
  assert.deepEqual(scoperte, [], `Immagini con l’indirizzo preso dai dati che nessuno dichiara:\n  ${scoperte.join('\n  ')}\n`
    + 'Se contattano un sito, aggiungi il servizio in src/shared/serviziEsterni.js e la riga in IMMAGINI_DAI_DATI col suo «servizio»; '
    + 'se l’indirizzo è una copia locale (data:, blob:, filo://), la riga col suo perché.');
});

test('ogni voce dell’elenco è ancora usata dal codice', () => {
  const morte = vociMorte(ANALISI);
  assert.deepEqual(morte, [], `Voci che il codice non usa più:\n  ${morte.join('\n  ')}\nToglile da src/shared/serviziEsterni.js, o correggi «base», «dove» o «prova».`);
});

// Un indirizzo costruito da una funzione che altri file ricevono come dipendenza: chi la chiama manda la richiesta.
test('ogni file che chiama la funzione che costruisce l’indirizzo di un servizio è nel suo «dove»', () => {
  for (const v of VOCI.filter((x) => x.via)) {
    const re = new RegExp(`\\b${v.via}\\s*\\(`);
    const usano = Object.keys(SORGENTI).filter((f) => re.test(ANALISI.testi.get(f).codice)).sort();
    assert.ok(usano.length, `${v.id}: nessun file chiama più ${v.via}(): togli «via»`);
    const fuori = usano.filter((f) => !v.dove.includes(f));
    assert.deepEqual(fuori, [], `${v.id}: questi file chiamano ${v.via}() e mandano la richiesta; aggiungili al «dove» e scrivi l’occasione`);
  }
});

test('le esclusioni dichiarate qui servono ancora', () => {
  for (const f of Object.keys(FILE_ESCLUSI)) assert.ok(existsSync(join(ROOT, f)), `${f} escluso ma non esiste più`);
  assert.ok(existsSync(join(ROOT, DATI_DI_TERZI.cartella)), `${DATI_DI_TERZI.cartella} esclusa ma non esiste più`);
  for (const e of ESEMPI) {
    assert.ok(ANALISI.indirizzi.some((u) => u.file === e.file && SE.copre(e.url, u.url)), `l’esempio ${e.url} non è più in ${e.file}: togli l’esclusione`);
  }
  for (const c of COMPOSTI) {
    assert.ok(ANALISI.indirizzi.some((u) => u.composto && compostoDi(u) === c), `l’indirizzo composto «${c.testo}» non è più in ${c.file}: togli l’esclusione`);
    if (c.servizio) {
      const v = SE.SERVIZI.find((x) => x.id === c.servizio);
      assert.ok(v && v.dove.includes(c.file), `«${c.testo}»: il servizio ${c.servizio} non esiste o non ha ${c.file} nel suo «dove»`);
    } else assert.ok(c.perche, `«${c.testo}»: senza servizio serve il perché`);
  }
  for (const f of Object.keys(CHIAMATE_LOCALI)) {
    assert.ok(ANALISI.chiamate.has(f), `${f} non fa più chiamate: togli l’esclusione`);
  }
  for (const c of IMMAGINI_DAI_DATI) {
    assert.ok(ANALISI.immagini.some((u) => immagineDi(u) === c), `l’immagine «${c.testo}» non è più in ${c.file}${c.funzione ? ` (${c.funzione})` : ''}: togli la riga`);
    if (c.servizio) {
      const v = SE.SERVIZI.find((x) => x.id === c.servizio);
      assert.ok(v && v.dove.includes(c.file), `«${c.testo}»: il servizio ${c.servizio} non esiste o non ha ${c.file} nel suo «dove»`);
    } else assert.ok(c.perche, `«${c.testo}»: senza servizio serve il perché`);
  }
  for (const n of NOMI_NON_CONTATTATI) {
    const dichiarata = new RegExp(`\\b(?:const|let|var)\\s+${n.costante}\\b`).test(ANALISI.testi.get(n.file)?.codice || '');
    assert.ok(dichiarata && ANALISI.chiamate.has(n.file), `${n.costante} non è più in ${n.file}, o il file non fa più rete: togli l’esclusione`);
  }
});

test('le voci sono complete e ben formate', () => {
  const ids = VOCI.map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length, 'id duplicati');
  for (const v of VOCI) {
    assert.match(v.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `id non kebab-case: ${v.id}`);
    for (const campo of ['nome', 'occasione', 'riceve']) {
      assert.ok(typeof v[campo] === 'string' && v[campo].trim(), `${v.id}: manca «${campo}»`);
    }
    assert.ok(Array.isArray(v.base), `${v.id}: «base» deve essere un elenco`);
    assert.ok(v.base.length || (typeof v.indirizzo === 'string' && v.indirizzo.trim()), `${v.id}: senza «base» serve «indirizzo»`);
    for (const b of v.base) {
      assert.match(b, /^(https?|wss?):\/\/[^/?#\s]+/, `${v.id}: base non valida ${b}`);
      assert.doesNotThrow(() => new URL(b), `${v.id}: base non valida ${b}`);
    }
    assert.ok(Array.isArray(v.dove) && v.dove.length, `${v.id}: manca «dove»`);
    for (const f of v.dove) assert.ok(existsSync(join(ROOT, f)), `${v.id}: «${f}» non esiste`);
  }
  for (const v of SE.SERVIZI) assert.ok(SE.QUANDO[v.quando], `${v.id}: «quando» sconosciuto: ${v.quando}`);
  for (const v of VOCI.filter((x) => x.nellaLibreria)) assert.ok(proveDi(v).length, `${v.id}: un indirizzo scritto nella libreria vuole la «prova» del suo uso`);
});

test('l’elenco nomina ogni servizio della richiesta #849', () => {
  const copre = (url) => SE.SERVIZI.some((v) => v.base.some((b) => SE.copre(b, url)));
  for (const url of [
    'https://rdap.org/domain/esempio.it', 'https://crt.sh/?q=esempio.it',
    'https://api.frankfurter.dev/v1/latest', 'https://easylist.to/easylist/easylist.txt',
    'https://identitytoolkit.googleapis.com/v1/accounts:signUp', 'https://firestore.googleapis.com/v1/projects/x',
    'https://europe-west1-filo-8b9cb.cloudfunctions.net/x', 'https://firebasestorage.googleapis.com/v0/b/x',
  ]) assert.ok(copre(url), `nessun servizio copre ${url}`);
  for (const id of ['configurazione-condivisa', 'invito-in-attesa']) assert.ok(SE.SERVIZI.some((v) => v.id === id), `manca ${id}`);
  const link = (url) => SE.LINK_APERTI.some((v) => v.base.some((b) => SE.copre(b, url)));
  assert.ok(link('https://www.google.com/search?q=x') && link('https://lens.google.com/uploadbyurl?url=x'), 'ricerca Google e Lens vanno fra i link aperti');
});

test('copre(): stesso prefisso e confine di un pezzo dell’indirizzo', () => {
  assert.ok(SE.copre('https://crt.sh', 'https://crt.sh/?q=x'));
  assert.ok(SE.copre('https://crt.sh', 'https://CRT.sh'));
  assert.ok(SE.copre('https://openrouter.ai/api/v1/', 'https://openrouter.ai/api/v1/models'));
  assert.ok(!SE.copre('https://crt.sh', 'https://crt.sh.esempio.it/'));
  assert.ok(!SE.copre('https://openrouter.ai/api/v1/', 'https://openrouter.ai/keys'));
  assert.ok(!SE.copre('', 'https://x.it'));
});

test('l’aggiornamento chiede proprio al repository scritto nella ricetta dei pacchetti', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const fonti = [];
  (function cerca(o) {
    if (!o || typeof o !== 'object') return;
    if (o.provider) fonti.push(o);
    for (const v of Object.values(o)) cerca(v);
  })(pkg.build);
  assert.ok(fonti.length, 'nessuna fonte degli aggiornamenti in package.json');
  const base = SE.SERVIZI.find((v) => v.id === 'aggiornamenti').base;
  for (const f of fonti) {
    assert.equal(f.provider, 'github', `fonte degli aggiornamenti non dichiarata nell’elenco: ${JSON.stringify(f)}`);
    assert.ok(base.includes(`https://github.com/${f.owner}/${f.repo}/releases`), `l’elenco non nomina ${f.owner}/${f.repo}`);
  }
});

test('prova: un fetch verso un host nuovo fa diventare rossa la sentinella', () => {
  const a = analizza({ 'src/main/services/nuovo.js': "async function x() { return fetch('https://nuovo-servizio.example/api'); }\n" });
  assert.deepEqual(indirizziScoperti(a), ['src/main/services/nuovo.js:1 https://nuovo-servizio.example/api']);
  assert.deepEqual(chiamateScoperte(a), ['src/main/services/nuovo.js']);
});

test('prova: un servizio noto usato da un file che la sua voce non nomina è rosso', () => {
  const a = analizza({ 'src/pages/nuova.js': "fetch('https://api.frankfurter.dev/v1/latest');" });
  const [r] = indirizziScoperti(a);
  assert.match(r, /api\.frankfurter\.dev.*«cambi-valuta»/);
});

test('prova: commenti, host dinamici, regex e markup si leggono per quello che sono', () => {
  const a = analizza({
    'a.js': [
      '// https://commento.example',
      '/* https://blocco.example */',
      'const d = `https://${host}/llms.txt`, e = "https://" + host;',
      "const u = /:\\/\\//.test(s) ? s : 'https://dopo-la-regex.example';",
      "const ns = 'http://www.w3.org/2000/svg';",
    ].join('\n'),
    'b.html': '<!-- https://commento-html.example -->\n<a href="https://link-html.example/">x</a>',
    'c.css': '/* https://commento-css.example */\n.x { background: url(https://sfondo.example/a.png); }',
  });
  assert.deepEqual(indirizziScoperti(a), ['a.js:4 https://dopo-la-regex.example', 'b.html:2 https://link-html.example/', 'c.css:2 https://sfondo.example/a.png']);
  assert.equal(a.indirizzi.filter((u) => u.dinamico).length, 2);
});

// Rianalizza un file con un testo diverso, lasciando il resto della base com'è.
function conFile(f, testo, base) {
  const nuovo = analizza({ [f]: testo });
  const chiamate = new Set([...base.chiamate].filter((x) => x !== f));
  if (nuovo.chiamate.has(f)) chiamate.add(f);
  return {
    indirizzi: [...base.indirizzi.filter((u) => u.file !== f), ...nuovo.indirizzi],
    chiamate,
    testi: new Map([...base.testi, [f, nuovo.testi.get(f)]]),
    sorgenti: { ...base.sorgenti, [f]: testo },
    immagini: [...base.immagini.filter((u) => u.file !== f), ...nuovo.immagini],
  };
}

// Le prove guardano solo quello che il loro cambio aggiunge: un rosso vero altrove in src/ resta del suo test.
const nuovi = (controllo, a, base) => {
  const prima = new Set(controllo(base));
  return controllo(a).filter((x) => !prima.has(x));
};
const senzaRiga = (righe) => righe.map((x) => x.replace(/:\d+ /, ' '));
const aggiungiA = (f, base, testo) => conFile(f, base.sorgenti[f] + testo, base);

const WALLET = 'src/main/services/handlers/wallet.js';
const FX = 'src/main/services/fxRates.js';
const SCRYFALL = 'src/main/services/scryfall.js';

// Ogni prova riceve la base su cui lavorare: girano su src/ di oggi e, più sotto, su un src/ cambiato.
const PROVE = {
  'un servizio che sparisce dal codice rende rossa la sua voce': (base) => {
    const senza = conFile(FX, '', base);
    assert.ok(vociMorte(senza).some((m) => m.startsWith('cambi-valuta:')), 'la voce dei cambi resta verde senza il suo codice');
  },
  'un host nuovo composto da una costante, in un file già nell’elenco, è rosso': (base) => {
    const a = aggiungiA(WALLET, base, "\nconst HOST_NUOVO = 'nuovo.example';\nfetch(`https://${HOST_NUOVO}/api`);\nfetch('https://' + HOST_NUOVO);\n");
    const r = nuovi(compostiScoperti, a, base);
    assert.equal(r.length, 2, r.join('\n'));
    assert.ok(r.every((x) => x.startsWith(WALLET)));
  },
  'una richiesta con l’host in una costante, scritta con le opzioni, in un file già nell’elenco, è rossa': (base) => {
    const a = aggiungiA(FX, base, "\nconst HOST_NUOVO = 'nuovo.example';\nrequire('node:https').request({ hostname: HOST_NUOVO, path: '/api' });\n");
    assert.deepEqual(senzaRiga(nuovi(indirizziScoperti, a, base)), [`${FX} https://nuovo.example`]);
    const b = aggiungiA(FX, base, "\nconst host = 'nuovo.example';\nrequire('https').get({ host, path: '/' });\n");
    assert.deepEqual(senzaRiga(nuovi(indirizziScoperti, b, base)), [`${FX} https://nuovo.example`]);
  },
  'l’host in una costante è rosso per qualunque strada arrivi alla chiamata': (base) => {
    for (const via of [
      "const opzioni = { hostname: HOST_NUOVO, path: '/api' };\nrequire('node:https').request(opzioni);",
      "function opzioni() { return { hostname: HOST_NUOVO, path: '/' }; }\nrequire('electron').net.request(opzioni());",
      "fetch(['https://', HOST_NUOVO, '/api'].join(''));",
      "fetch('https://'.concat(HOST_NUOVO));",
    ]) {
      const a = aggiungiA(SCRYFALL, base, `\nconst HOST_NUOVO = 'nuovo.example';\n${via}\n`);
      assert.deepEqual(senzaRiga(nuovi(indirizziScoperti, a, base)), [`${SCRYFALL} https://nuovo.example`], via);
    }
  },
  'un file nuovo fa rete per qualunque strada prenda il modulo di rete': (base) => {
    const f = 'src/main/services/zzModuloDiRete.js';
    for (const via of [
      "require('node:net').connect(443, HOST);",
      "const { connect } = require('node:net');\nconnect(443, HOST);",
      "const { request } = require('electron').net;\nrequest({ protocol: 'https:', hostname: HOST, path: '/' });",
      "const { shell, net: rete } = require('electron');\nrete.request({ hostname: HOST });",
    ]) {
      const a = conFile(f, `const HOST = 'nuovo.example';\n${via}\n`, base);
      assert.deepEqual(senzaRiga(nuovi(indirizziScoperti, a, base)), [`${f} https://nuovo.example`], via);
      assert.deepEqual(nuovi(chiamateScoperte, a, base), [f], via);
    }
  },
  'una richiesta con l’host calcolato nelle opzioni va dichiarata come indirizzo composto': (base) => {
    const a = aggiungiA(FX, base, "\nrequire('node:tls').connect({ host: scegliHost(), port: 443 });\n");
    const r = nuovi(compostiScoperti, a, base);
    assert.equal(r.length, 1, r.join('\n'));
    assert.ok(r[0].startsWith(FX) && r[0].includes('scegliHost()'));
  },
  'un indirizzo rimasto in una costante senza più chiamate rende rossa la sua voce': (base) => {
    const morte = vociMorte(conFile(FX, "const URL = 'https://api.frankfurter.dev/v1/latest?base=EUR';\nmodule.exports = { URL };\n", base));
    assert.ok(morte.some((m) => m.startsWith('cambi-valuta:')), morte.join('\n'));
  },
  'una richiesta in più verso un servizio già dichiarato non accende niente': (base) => {
    const a = aggiungiA(FX, base, "\nrequire('node:https').get('https://api.frankfurter.dev/v1/currencies');\n");
    for (const c of [indirizziScoperti, compostiScoperti, chiamateScoperte, vociMorte]) assert.deepEqual(nuovi(c, a, base), [], c.name);
  },
  'un nome di dominio fuori da un file che fa rete, un nome di file e un nome da confrontare non sono destinazioni': (base) => {
    const a = conFile('src/shared/zzNomi.js', "const SITI = ['nuovo.example'];\n", base);
    assert.deepEqual(nuovi(indirizziScoperti, a, base), []);
    const b = aggiungiA(FX, base, "\nconst FILE = 'cambi.json';\n");
    assert.deepEqual(nuovi(indirizziScoperti, b, base), []);
    const adblock = 'src/main/services/adblock.js';
    const c = conFile(adblock, base.sorgenti[adblock].replace("'google.com',", "'google.com', 'nuovo.example',"), base);
    assert.notEqual(c.sorgenti[adblock], base.sorgenti[adblock], 'l’elenco dei siti mai bloccati non è più scritto così: aggiorna la prova');
    assert.deepEqual(nuovi(indirizziScoperti, c, base), []);
  },
  'un host intero seguito da un’espressione è un indirizzo fisso, e si confronta con l’elenco': () => {
    const a = analizza({ 'src/main/nuovo.js': "fetch(`https://api.nuovo.example${percorso}`); fetch('https://api.nuovo.example' + p);" });
    assert.equal(indirizziScoperti(a).length, 2);
  },
  'una richiesta con l’host nelle opzioni, in un file già nell’elenco, è rossa': (base) => {
    const a = aggiungiA(WALLET, base, "\nrequire('electron').net.request({ protocol: 'https:', hostname: 'nuovo.example', path: '/' });\n");
    assert.deepEqual(senzaRiga(nuovi(indirizziScoperti, a, base)), [`${WALLET} https://nuovo.example`]);
  },
  'una pagina interna che carica un’immagine da un indirizzo letto dai dati è rossa, per qualunque strada': (base) => {
    const f = 'src/pages/zzNuova/zzNuova.js';
    for (const via of [
      'img.src = voce.favicon;',
      "img.setAttribute('src', voce.favicon);",
      'riga.innerHTML = `<img class="ico" src="${voce.favicon}">`;',
      "riga.innerHTML = '<img src=\"' + voce.favicon + '\">';",
      'el.style.backgroundImage = `url(${voce.favicon})`;',
      "el.style.setProperty('background-image', voce.sfondo);",
    ]) {
      const a = conFile(f, `function riga(voce, img, riga, el) {\n  ${via}\n}\n`, base);
      assert.deepEqual(nuovi(immaginiScoperte, a, base), [`${f}:2 (riga) ${via}`], via);
    }
    // Un indirizzo scritto nel codice lo vede già la regola degli indirizzi; un content script gira nella pagina del sito.
    const fisso = conFile(f, "img.src = 'filo://asset/icons/icon-32.png';\n", base);
    assert.deepEqual(nuovi(immaginiScoperte, fisso, base), []);
    const nelSito = conFile('src/content/zzNuovo.js', 'img.src = voce.favicon;\n', base);
    assert.deepEqual(nuovi(immaginiScoperte, nelSito, base), []);
    // Un modulo condiviso d'interfaccia (una finestra di conferma) gira dentro le pagine di Filo come la pagina stessa.
    const condiviso = 'src/shared/confirmUi.js';
    const nelModulo = conFile(condiviso, `${base.sorgenti[condiviso]}\nfunction icona(voce, img) { img.src = voce.favicon; }\n`, base);
    assert.equal(nuovi(immaginiScoperte, nelModulo, base).length, 1, 'un modulo condiviso che carica un’immagine dai dati resta verde');
  },
  'un’immagine dichiarata locale che cambia funzione o testo torna rossa': (base) => {
    const home = 'src/pages/home/home.js';
    const testo = base.sorgenti[home];
    assert.ok(testo.includes('img.src = page.favicon;'), 'l’icona delle pagine salvate non è più scritta così: aggiorna la prova');
    const a = conFile(home, testo.replace('img.src = page.favicon;', 'img.src = page.faviconDichiarata;'), base);
    assert.equal(nuovi(immaginiScoperte, a, base).length, 1);
  },
  'un servizio tolto da un file che ne serve altri sullo stesso server rende rossa la sua voce': (base) => {
    const testo = base.sorgenti[WALLET];
    const tolto = "callable('walletPendingInvite')";
    assert.ok(testo.includes(tolto), 'la richiesta dell’invito in attesa non è più scritta così: aggiorna la prova');
    const morte = nuovi(vociMorte, conFile(WALLET, testo.replace(tolto, 'null'), base), base);
    assert.ok(morte.some((m) => m.startsWith('invito-in-attesa:')), morte.join('\n'));
    assert.ok(!morte.some((m) => m.startsWith('crediti:')), 'i crediti usano ancora lo stesso server');
  },
};

for (const [nome, prova] of Object.entries(PROVE)) test(`prova: ${nome}`, () => prova(ANALISI));

// Un servizio nuovo scoperto in src/ deve accendere solo i controlli qui sopra, mai le prove (#849, giro 3).
test('le prove reggono su un src/ con un servizio non dichiarato e una richiesta in più a uno dichiarato', () => {
  let cambiata = conFile('src/main/services/zzNonDichiarato.js', "module.exports = () => fetch('https://non-dichiarato.example/v1');\n", ANALISI);
  cambiata = aggiungiA(FX, cambiata, "\nrequire('node:https').get('https://api.frankfurter.dev/v1/currencies');\n");
  assert.equal(nuovi(indirizziScoperti, cambiata, ANALISI).length, 1, 'il cambio non ha aggiunto il servizio non dichiarato');
  const cadute = [];
  for (const [nome, prova] of Object.entries(PROVE)) {
    try { prova(cambiata); } catch (e) { cadute.push(`${nome}: ${e.message.split('\n')[0]}`); }
  }
  assert.deepEqual(cadute, []);
});
