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
  { file: 'src/main/services/providers/openrouter.js', url: 'https://filo.local', perche: 'intestazione HTTP-Referer' },
  { file: 'src/main/services/scryfall.js', url: 'https://singolarita.com', perche: 'recapito nello User-Agent' },
];

// Chiamate di rete che non escono dal computer.
const CHIAMATE_LOCALI = {
  'src/main/protocol.js': 'net.fetch sui file delle pagine filo://',
  'src/main/test-servizi-chiusi.js': 'la fetch finta delle prove',
};

const ESTENSIONI = ['.js', '.mjs', '.cjs', '.html', '.css', '.json'];
const URL_RE = /\b(?:https?|wss?):\/\/[^\s'"`<>()\\]*/gi;
// safeFetch e fetchList sono gli involucri del progetto che fanno rete per conto di un altro file.
const CHIAMATA_RE = /\bfetch\s*\(|\bnet\s*\.\s*(?:request|fetch|connect|createConnection)\b|\bglobalThis\s*\.\s*fetch\b|\bnew\s+(?:WebSocket|EventSource|XMLHttpRequest)\b|\bsendBeacon\s*\(|\b(?:safeFetch|fetchList)\s*\(/;
const MODULO_RETE_RE = /\brequire\(\s*['"](?:node:)?(?:https?|http2|tls|dgram)['"]\s*\)|\bfrom\s+['"](?:node:)?(?:https?|http2|tls|dgram)['"]/;

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
  let prima = null, primaTesto = '';
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
    if (LETTERALI.has(k)) {
      frammenti.push({ valore: sc.getTokenValue(), riga: riga(da), segue: k === K.TemplateHead || k === K.TemplateMiddle });
      letterali.push([da + 1, sc.getTextPos() - 1]);
    } else if (k === K.RegularExpressionLiteral) {
      letterali.push([da + 1, sc.getTextPos() - 1]);
    }
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

// Un indirizzo è dinamico quando il suo host lo completa un'espressione: `https://${dominio}/llms.txt`, 'https://' + host.
function indirizziDi(frammenti) {
  const out = [];
  for (const fr of frammenti) {
    for (const m of fr.valore.matchAll(URL_RE)) {
      const url = m[0];
      const resto = url.slice(url.indexOf('://') + 3);
      const host = resto.split(/[/?#]/)[0].toLowerCase();
      const finoAllaFine = m.index + url.length === fr.valore.length;
      const dinamico = !host || (fr.segue && finoAllaFine && !/[/?#]/.test(resto));
      out.push({ url, host, riga: fr.riga, dinamico });
    }
  }
  return out;
}

function analizza(sorgenti) {
  const indirizzi = [];
  const chiamate = new Set();
  const testi = new Map();
  for (const [file, testo] of Object.entries(sorgenti)) {
    const l = leggi(file, testo);
    testi.set(file, l);
    for (const u of indirizziDi(l.frammenti)) indirizzi.push({ file, ...u });
    if (CHIAMATA_RE.test(l.codice) || MODULO_RETE_RE.test(l.senzaCommenti)) chiamate.add(file);
  }
  return { indirizzi, chiamate, testi };
}

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

function chiamateScoperte(analisi) {
  return [...analisi.chiamate].filter((f) => !CHIAMATE_LOCALI[f] && !SE.SERVIZI.some((v) => v.dove.includes(f))).sort();
}

function vociMorte(analisi) {
  const out = [];
  const fissi = analisi.indirizzi.filter((u) => !u.dinamico);
  for (const v of VOCI) {
    const servizio = SE.SERVIZI.includes(v);
    for (const f of v.dove) {
      const l = analisi.testi.get(f);
      if (!l) { out.push(`${v.id}: «${f}» non esiste fra i sorgenti guardati`); continue; }
      const suo = fissi.some((u) => u.file === f && v.base.some((b) => SE.copre(b, u.url)));
      const chiama = servizio && analisi.chiamate.has(f);
      const prova = v.prova && l.senzaCommenti.includes(v.prova);
      if (!suo && !chiama && !prova) out.push(`${v.id}: in «${f}» non c'è più niente che lo usi`);
    }
    if (v.prova) {
      if (!v.dove.some((f) => analisi.testi.get(f)?.senzaCommenti.includes(v.prova))) out.push(`${v.id}: «${v.prova}» non compare più in ${v.dove.join(', ')}`);
    } else {
      for (const b of v.base) if (!fissi.some((u) => SE.copre(b, u.url))) out.push(`${v.id}: nessun indirizzo del codice sta più sotto ${b}`);
    }
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

test('ogni file che fa chiamate di rete è nel «dove» di un servizio dell’elenco', () => {
  const scoperte = chiamateScoperte(ANALISI);
  assert.deepEqual(scoperte, [], `File con chiamate di rete che nessuna voce nomina:\n  ${scoperte.join('\n  ')}\n${COME_SI_CORREGGE}`);
});

test('ogni voce dell’elenco è ancora usata dal codice', () => {
  const morte = vociMorte(ANALISI);
  assert.deepEqual(morte, [], `Voci che il codice non usa più:\n  ${morte.join('\n  ')}\nToglile da src/shared/serviziEsterni.js, o correggi «base», «dove» o «prova».`);
});

test('le esclusioni dichiarate qui servono ancora', () => {
  for (const f of Object.keys(FILE_ESCLUSI)) assert.ok(existsSync(join(ROOT, f)), `${f} escluso ma non esiste più`);
  assert.ok(existsSync(join(ROOT, DATI_DI_TERZI.cartella)), `${DATI_DI_TERZI.cartella} esclusa ma non esiste più`);
  for (const e of ESEMPI) {
    assert.ok(ANALISI.indirizzi.some((u) => u.file === e.file && SE.copre(e.url, u.url)), `l’esempio ${e.url} non è più in ${e.file}: togli l’esclusione`);
  }
  for (const f of Object.keys(CHIAMATE_LOCALI)) {
    assert.ok(ANALISI.chiamate.has(f), `${f} non fa più chiamate: togli l’esclusione`);
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
});

test('l’elenco nomina ogni servizio della richiesta #849', () => {
  const copre = (url) => SE.SERVIZI.some((v) => v.base.some((b) => SE.copre(b, url)));
  for (const url of [
    'https://rdap.org/domain/esempio.it', 'https://crt.sh/?q=esempio.it', 'https://www.google.com/s2/favicons?domain=esempio.it',
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

test('i dizionari del correttore arrivano dal CDN di Chromium finché nessuno cambia l’indirizzo', () => {
  const cambia = Object.keys(SORGENTI).filter((f) => /setSpellCheckerDictionaryDownloadURL/.test(ANALISI.testi.get(f).codice));
  assert.deepEqual(cambia, [], 'un indirizzo nuovo per i dizionari va scritto nella voce «dizionari-correttore»');
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

test('prova: un servizio che sparisce dal codice rende rossa la sua voce', () => {
  const f = 'src/main/services/fxRates.js';
  const senza = {
    indirizzi: ANALISI.indirizzi.filter((u) => u.file !== f),
    chiamate: new Set([...ANALISI.chiamate].filter((x) => x !== f)),
    testi: new Map([...ANALISI.testi, [f, leggi(f, '')]]),
  };
  assert.ok(vociMorte(senza).some((m) => m.startsWith('cambi-valuta:')), 'la voce dei cambi resta verde senza il suo codice');
});
