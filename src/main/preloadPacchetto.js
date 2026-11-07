// Il preload delle pagine web in un file solo: nella sandbox di Chromium `require` conosce solo electron, events,
// timers e url, quindi i moduli che page-preload.js richiede, e i fogli che i content script leggono, viaggiano dentro.
// Regole: patterns/il-preload-delle-pagine-web-gira-in-sandbox.md; sentinella tests/unit/preloadPacchetto.test.mjs.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RADICE = path.join(__dirname, '..', '..');
const INGRESSO = 'src/preload/page-preload.js';
// Il file che il pacchetto di Filo porta con sé: lo scrive beforePack qui sotto prima che nasca l'asar. Fuori da src/,
// perché chi legge i sorgenti (sentinelle, mappe) non trovi tutto due volte.
const NEL_PACCHETTO = path.join(RADICE, 'generato', 'page-preload.js');
// Ogni preload che gira in sandbox e il file che il pacchetto porta per lui: anche lo strato dei riquadri sopra un sito.
const PACCHETTI = Object.freeze({
  [INGRESSO]: NEL_PACCHETTO,
  'src/preload/riquadri-preload.js': path.join(RADICE, 'generato', 'riquadri-preload.js'),
});
// Quelli che la sandbox dà da sé: li chiede il preload vero, a chiamata.
const DELLA_SANDBOX = new Set(['electron', 'events', 'timers', 'url']);
// Quelli di Node che il pacchetto rifà: `path` sui suoi percorsi, `fs` in sola lettura sui testi che porta; `url` lo completa.
const RIFATTI = new Set(['path', 'fs']);
const ESTENSIONI = ['', '.js', '.json', '/index.js'];

const posix = path.posix;

function riga(src, indice) {
  return src.slice(0, indice).split('\n').length;
}

// Fuori dalle righe di commento: «via require()» in un'intestazione non è una dipendenza.
function inCommento(src, indice) {
  const inizio = src.lastIndexOf('\n', indice) + 1;
  return /^\s*(\/\/|\*|\/\*)/.test(src.slice(inizio, indice));
}

// Gli argomenti di un path.join() fatto di __dirname, stringhe e costanti dello stesso file definite allo stesso modo.
function valutaJoin(argomenti, src, cartella, profondita = 0) {
  if (profondita > 4) return null;
  const pezzi = [];
  for (const a of argomenti.split(',').map((s) => s.trim()).filter(Boolean)) {
    const lett = a.match(/^(['"])([^'"]*)\1$/);
    if (lett) { pezzi.push(lett[2]); continue; }
    if (a === '__dirname') { pezzi.push(cartella); continue; }
    if (!/^[A-Za-z_$][\w$]*$/.test(a)) return null;
    const def = src.match(new RegExp(`\\bconst\\s+${a.replace(/\$/g, '\\$')}\\s*=\\s*path\\.join\\(([^()]*)\\)`));
    if (!def) return null;
    const base = valutaJoin(def[1], src, cartella, profondita + 1);
    if (base == null) return null;
    pezzi.push(base);
  }
  return posix.join(...pezzi);
}

function risolviFile(radice, assoluto) {
  for (const e of ESTENSIONI) {
    const p = assoluto + e;
    try { if (fs.statSync(path.join(radice, p)).isFile()) return p; } catch (_) {}
  }
  return null;
}

// I testi che un modulo legge con fs.readFileSync(path.join(__dirname, …, nome)): ogni stringa del file che nomina un
// file di quella cartella. Più del necessario costa qualche KB; uno in meno lascia senza stile un pannello.
function testiLetti(src, cartella, radice) {
  const out = new Set();
  for (const m of src.matchAll(/readFileSync\(\s*path\.join\(([^()]*)\)/g)) {
    const argomenti = m[1].split(',').map((s) => s.trim());
    const fisse = argomenti.slice(0, -1).join(', ');
    const dir = valutaJoin(fisse, src, cartella);
    if (dir == null) continue;
    let nomi = [];
    try { nomi = fs.readdirSync(path.join(radice, dir)); } catch (_) { continue; }
    for (const s of src.matchAll(/(['"])([\w.-]+\.[a-z]+)\1/g)) {
      if (nomi.includes(s[2])) out.add(posix.join(dir, s[2]));
    }
  }
  return out;
}

/**
 * Compone il preload impacchettato. `codice` è il file; `moduli` e `testi` cosa porta; `assenti` i moduli di Node che
 * qualcuno chiede e la sandbox non ha (a chiamata la sandbox li rifiuta, come farebbe senza pacchetto); `dinamici` le
 * require() che non si leggono da ferme; `rotti` i file con un errore di sintassi. PURA a parte la lettura dei sorgenti.
 */
function componi({ radice = RADICE, ingresso = INGRESSO } = {}) {
  const moduli = new Map();
  const testi = new Set();
  const assenti = new Set();
  const dinamici = [];
  const coda = ['/' + ingresso];
  while (coda.length) {
    const chiave = coda.shift();
    if (moduli.has(chiave)) continue;
    const src = fs.readFileSync(path.join(radice, chiave), 'utf8');
    moduli.set(chiave, src);
    if (chiave.endsWith('.json')) continue;
    const cartella = posix.dirname(chiave);
    let usaFs = false;
    for (const m of src.matchAll(/\brequire\(([^()]*(?:\([^()]*\))?[^()]*)\)/g)) {
      if (inCommento(src, m.index)) continue;
      const arg = m[1].trim();
      if (!arg) continue;
      let spec = null;
      const lett = arg.match(/^(['"])([^'"]+)\1$/);
      if (lett) spec = lett[2];
      else {
        const join = arg.match(/^path\.join\(([^()]*)\)$/);
        if (join) spec = valutaJoin(join[1], src, cartella);
      }
      if (spec == null) { dinamici.push(`${chiave.slice(1)}:${riga(src, m.index)} require(${arg})`); continue; }
      if (spec.startsWith('.') || spec.startsWith('/')) {
        const voluto = spec.startsWith('/') ? posix.normalize(spec) : posix.join(cartella, spec);
        const trovato = risolviFile(radice, voluto);
        if (!trovato) throw new Error(`[preload impacchettato] ${chiave.slice(1)}:${riga(src, m.index)} chiede ${spec}, che non esiste`);
        coda.push(trovato);
        continue;
      }
      const nome = spec.replace(/^node:/, '');
      if (RIFATTI.has(nome)) { if (nome === 'fs') usaFs = true; continue; }
      if (!DELLA_SANDBOX.has(nome)) assenti.add(`${chiave.slice(1)} → ${spec}`);
    }
    if (usaFs) for (const t of testiLetti(src, cartella, radice)) testi.add(t);
  }
  const fogli = [...testi].sort().map((t) => [t, fs.readFileSync(path.join(radice, t), 'utf8')]);
  const parti = [
    '// Generato da src/main/preloadPacchetto.js da ' + ingresso + ': non si modifica, si rigenera.',
    '(function (richiestaDellaSandbox) {',
    'const MODULI = {',
  ];
  const rotti = [];
  for (const [chiave, src] of moduli) {
    parti.push(`// ── ${chiave.slice(1)}`);
    const corpo = chiave.endsWith('.json') ? `module.exports = ${src.trim()};` : `\n${src}\n`;
    const testa = 'function (exports, require, module, __filename, __dirname) {';
    // Come da disco: un file che non si legge cade da solo, al suo require, invece di spegnere tutto il pacchetto.
    try {
      new vm.Script(`void ${testa}${corpo}}`, { filename: chiave.slice(1) });
      parti.push(`${JSON.stringify(chiave)}: ${testa}${corpo}},`);
    } catch (e) {
      const motivo = `${chiave.slice(1)}: ${e.message}`;
      rotti.push(motivo);
      console.error('[preload impacchettato] non si legge, resta fuori:', motivo);
      parti.push(`${JSON.stringify(chiave)}: function () { throw new SyntaxError(${JSON.stringify(motivo)}); },`);
    }
  }
  parti.push('};');
  parti.push('const TESTI = {');
  for (const [chiave, src] of fogli) parti.push(`${JSON.stringify(chiave)}: ${JSON.stringify(src)},`);
  parti.push('};');
  parti.push(`(${runtime.toString()})(MODULI, TESTI, richiestaDellaSandbox)(${JSON.stringify('/' + ingresso)});`);
  parti.push('})(require);');
  return {
    codice: parti.join('\n') + '\n',
    moduli: [...moduli.keys()].map((k) => k.slice(1)),
    testi: fogli.map(([k]) => k.slice(1)),
    assenti: [...assenti].sort(),
    dinamici,
    rotti,
  };
}

// Gira DENTRO il preload, nella sandbox: non vede niente di questo file, solo i suoi argomenti.
function runtime(MODULI, TESTI, richiestaDellaSandbox) {
  const normalizza = (p) => {
    const fuori = [];
    for (const pezzo of String(p).split('/')) {
      if (!pezzo || pezzo === '.') continue;
      if (pezzo === '..') fuori.pop();
      else fuori.push(pezzo);
    }
    return '/' + fuori.join('/');
  };
  const percorso = {
    sep: '/',
    join: (...pezzi) => normalizza(pezzi.join('/')),
    normalize: normalizza,
    resolve: (...pezzi) => normalizza(pezzi.join('/')),
    dirname: (p) => { const n = normalizza(p); return n.slice(0, n.lastIndexOf('/')) || '/'; },
    basename: (p, est) => { const b = normalizza(p).split('/').pop(); return est && b.endsWith(est) ? b.slice(0, -est.length) : b; },
    extname: (p) => { const b = normalizza(p).split('/').pop(); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; },
  };
  percorso.posix = percorso;
  const archivio = {
    readFileSync(p) {
      const chiave = normalizza(p);
      if (Object.prototype.hasOwnProperty.call(TESTI, chiave)) return TESTI[chiave];
      const e = new Error(`ENOENT: ${chiave} non è nel preload impacchettato (src/main/preloadPacchetto.js)`);
      e.code = 'ENOENT';
      console.error('[Filo pacchetto]', e.message);
      throw e;
    },
    existsSync(p) {
      const chiave = normalizza(p);
      return Object.prototype.hasOwnProperty.call(TESTI, chiave) || Object.prototype.hasOwnProperty.call(MODULI, chiave);
    },
  };
  // Il `url` della sandbox è quello vecchio (parse, format): domainToASCII e domainToUnicode, che il controllo dei link
  // chiede, li rifà il parser di Chromium, con lo stesso IDNA di Node; il ritorno da xn-- è la RFC 3492.
  const PUNY = { base: 36, tMin: 1, tMax: 26, skew: 38, damp: 700 };
  const adatta = (delta, punti, prima) => {
    let k = 0;
    delta = prima ? Math.floor(delta / PUNY.damp) : delta >> 1;
    delta += Math.floor(delta / punti);
    for (; delta > ((PUNY.base - PUNY.tMin) * PUNY.tMax) >> 1; k += PUNY.base) delta = Math.floor(delta / (PUNY.base - PUNY.tMin));
    return Math.floor(k + ((PUNY.base - PUNY.tMin + 1) * delta) / (delta + PUNY.skew));
  };
  const decodifica = (testo) => {
    const out = [];
    const trattino = Math.max(0, testo.lastIndexOf('-'));
    for (let j = 0; j < trattino; j++) {
      if (testo.charCodeAt(j) >= 0x80) throw new RangeError('punycode');
      out.push(testo.charCodeAt(j));
    }
    let n = 128, bias = 72, i = 0;
    for (let indice = trattino > 0 ? trattino + 1 : 0; indice < testo.length;) {
      const prima = i;
      for (let w = 1, k = PUNY.base; ; k += PUNY.base) {
        if (indice >= testo.length) throw new RangeError('punycode');
        const c = testo.charCodeAt(indice++);
        const cifra = c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : PUNY.base;
        if (cifra >= PUNY.base) throw new RangeError('punycode');
        i += cifra * w;
        const t = k <= bias ? PUNY.tMin : k >= bias + PUNY.tMax ? PUNY.tMax : k - bias;
        if (cifra < t) break;
        w *= PUNY.base - t;
        if (w > 0x7fffffff) throw new RangeError('punycode');
      }
      const lunghezza = out.length + 1;
      bias = adatta(i - prima, lunghezza, prima === 0);
      n += Math.floor(i / lunghezza);
      i %= lunghezza;
      if (n > 0x10ffff) throw new RangeError('punycode');
      out.splice(i++, 0, n);
    }
    return String.fromCodePoint(...out);
  };
  const inAscii = (dominio) => {
    const d = String(dominio);
    // Come Node: spazi, credenziali e porte non fanno un dominio; quello che segue / ? # cade.
    if (!d || /[\s@]/.test(d) || (d.includes(':') && !d.startsWith('['))) return '';
    try { return new URL('http://' + d).hostname; } catch (_) { return ''; }
  };
  const inUnicode = (dominio) => {
    const ascii = inAscii(dominio);
    if (!ascii) return '';
    try {
      return ascii.split('.').map((e) => (/^xn--/i.test(e) ? decodifica(e.slice(4)) : e)).join('.');
    } catch (_) { return ''; }
  };
  let indirizzi = null;
  const moduloUrl = () => {
    if (indirizzi) return indirizzi;
    let della = {};
    try { della = richiestaDellaSandbox('url') || {}; } catch (_) {}
    indirizzi = Object.assign({}, della, {
      URL, URLSearchParams,
      domainToASCII: typeof della.domainToASCII === 'function' ? della.domainToASCII : inAscii,
      domainToUnicode: typeof della.domainToUnicode === 'function' ? della.domainToUnicode : inUnicode,
    });
    return indirizzi;
  };
  const caricati = Object.create(null);
  const risolvi = (spec, cartella) => {
    const base = normalizza(spec.startsWith('/') ? spec : cartella + '/' + spec);
    for (const e of ['', '.js', '.json', '/index.js']) {
      if (Object.prototype.hasOwnProperty.call(MODULI, base + e)) return base + e;
    }
    return null;
  };
  const richiedi = (spec, cartella) => {
    spec = String(spec);
    const nome = spec.replace(/^node:/, '');
    if (nome === 'path') return percorso;
    if (nome === 'fs') return archivio;
    if (nome === 'url') return moduloUrl();
    if (!spec.startsWith('.') && !spec.startsWith('/')) return richiestaDellaSandbox(spec);
    const chiave = risolvi(spec, cartella);
    if (!chiave) {
      const e = new Error(`Cannot find module '${spec}': non è nel preload impacchettato (src/main/preloadPacchetto.js)`);
      e.code = 'MODULE_NOT_FOUND';
      throw e;
    }
    if (caricati[chiave]) return caricati[chiave].exports;
    const module = { id: chiave, filename: chiave, exports: {}, loaded: false };
    caricati[chiave] = module;
    const dir = percorso.dirname(chiave);
    try {
      MODULI[chiave].call(module.exports, module.exports, (s) => richiedi(s, dir), module, chiave, dir);
    } catch (e) {
      // Come Node: un modulo caduto a metà non resta in memoria mezzo fatto.
      delete caricati[chiave];
      throw e;
    }
    module.loaded = true;
    return module.exports;
  };
  return (ingresso) => richiedi(ingresso, '/');
}

// Scrive solo se cambia, e mai a metà: più Filo che partono insieme (i test in parallelo) leggono un file intero.
function scrivi(dest, opzioni) {
  const { codice } = componi(opzioni);
  let uguale = false;
  try { uguale = fs.readFileSync(dest, 'utf8') === codice; } catch (_) {}
  if (uguale) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const prov = `${dest}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(prov, codice);
  try {
    fs.renameSync(prov, dest);
  } catch (e) {
    try { fs.unlinkSync(prov); } catch (_) {}
    let ora = '';
    try { ora = fs.readFileSync(dest, 'utf8'); } catch (_) {}
    if (ora !== codice) throw e;
  }
  return dest;
}

const scelti = new Map();
// Il pacchetto di Filo usa il suo file e basta; senza (npm start, i test) si compone dai sorgenti di adesso.
function percorsoDelPreload(ingresso = INGRESSO) {
  if (scelti.has(ingresso)) return scelti.get(ingresso);
  const nelPacchetto = PACCHETTI[ingresso];
  if (!nelPacchetto) throw new Error(`[preload impacchettato] ${ingresso} non è fra i preload in sandbox`);
  const { app } = require('electron');
  let scelto = null;
  if (app.isPackaged && fs.existsSync(nelPacchetto)) scelto = nelPacchetto;
  else {
    if (app.isPackaged) console.error('[preload impacchettato] manca nel pacchetto:', nelPacchetto, '— lo compongo adesso');
    scelto = scrivi(path.join(app.getPath('userData'), 'preload-pacchetto', path.basename(nelPacchetto)), { ingresso });
  }
  scelti.set(ingresso, scelto);
  return scelto;
}

// build.beforePack di electron-builder, che chiama il `default` di questo modulo: scrive dai sorgenti di adesso, sempre
// uguale a sé stesso (il Mac universale impacchetta due copie che devono coincidere).
async function beforePack() {
  for (const [ingresso, dest] of Object.entries(PACCHETTI)) {
    scrivi(dest, { ingresso });
    console.log(`[preload impacchettato] scritto per il pacchetto: ${dest}`);
  }
}

module.exports = { componi, scrivi, percorsoDelPreload, runtime, beforePack, default: beforePack, NEL_PACCHETTO, INGRESSO, PACCHETTI };
