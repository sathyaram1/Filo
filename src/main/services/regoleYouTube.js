// Dalle liste di uAssets (#1974) alle sole regole di iniezione («##+js(…)») scritte per YouTube. PURO: niente rete né
// Electron. Non copia codice di uBlock: le liste sono dati scaricati a runtime, il motore è src/preload/youtube-scriptlet.js.
// Regole: tests/unit/regoleYouTube.test.mjs.
'use strict';

// I siti di YouTube, per il blocco e per il clic vero sul «Salta» (services/adSkip.js): un elenco solo. Le regole
// scritte per altri siti, o per tutti, restano fuori.
const BASI = ['youtube.com', 'youtube-nocookie.com', 'youtubekids.com'];
// Quelli che servono solo il lettore incorporato in un altro sito: lì il «Salta» vale dentro il riquadro, mai in scheda.
const SOLO_INCORPORATI = ['youtube-nocookie.com'];

const sotto = (h, basi) => basi.some((b) => h === b || h.endsWith('.' + b));

function hostYouTube(host) {
  return sotto(String(host || '').toLowerCase(), BASI);
}

function hostYouTubeInScheda(host) {
  const h = String(host || '').toLowerCase();
  return sotto(h, BASI) && !sotto(h, SOLO_INCORPORATI);
}

function hostDi(url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.hostname.toLowerCase() : '';
  } catch (_) { return ''; }
}

// Il nome con cui il motore conosce ogni scriptlet; un nome fuori elenco si scarta (e il ripiego copre il resto).
const NOMI = {
  set: 'set', 'set-constant': 'set', 'trusted-set': 'trusted-set', 'trusted-set-constant': 'trusted-set',
  'json-prune': 'json-prune', 'json-prune-fetch-response': 'json-prune-fetch-response',
  'json-prune-xhr-response': 'json-prune-xhr-response',
  'trusted-replace-xhr-response': 'trusted-replace-xhr-response',
  'trusted-rpfr': 'trusted-rpfr', 'trusted-replace-fetch-response': 'trusted-rpfr',
  'json-edit-fetch-response': 'json-edit-fetch-response', 'json-edit-xhr-response': 'json-edit-xhr-response',
  'trusted-edit-inbound-object': 'trusted-edit-inbound-object',
  rpnt: 'rpnt', 'replace-node-text': 'rpnt', 'trusted-rpnt': 'rpnt', 'trusted-replace-node-text': 'rpnt',
  rmnt: 'rmnt', 'remove-node-text': 'rmnt',
  'nano-stb': 'nano-stb', 'nano-setTimeout-booster': 'nano-stb',
  'trusted-prevent-dom-bypass': 'trusted-prevent-dom-bypass',
  nostif: 'nostif', 'no-setTimeout-if': 'nostif', 'prevent-setTimeout': 'nostif',
  aopr: 'aopr', 'abort-on-property-read': 'aopr', aopw: 'aopw', 'abort-on-property-write': 'aopw',
};

function nomeNoto(n) {
  const s = String(n || '').trim().replace(/\.js$/, '');
  return Object.prototype.hasOwnProperty.call(NOMI, s) ? NOMI[s] : null;
}

// ─── preprocessore «!#if» ──────────────────────────────────────────────────
// Filo fa quello che fa uBlock su Chromium con le estensioni classiche, tranne il filtraggio dell'HTML.
const AMBIENTE = { env_chromium: true, ext_ublock: true, cap_user_stylesheet: true };

function valuta(espr) {
  const t = String(espr || '').match(/!|&&|\|\||\(|\)|[A-Za-z_][\w]*/g) || [];
  let i = 0;
  const primario = () => {
    const x = t[i++];
    if (x === '!') return !primario();
    if (x === '(') { const v = o(); i++; return v; }
    return AMBIENTE[x] === true;
  };
  const e = () => { let v = primario(); while (t[i] === '&&') { i++; const w = primario(); v = v && w; } return v; };
  const o = () => { let v = e(); while (t[i] === '||') { i++; const w = e(); v = v || w; } return v; };
  return o();
}

/** Le righe che valgono per Filo, coi blocchi «!#if» risolti. */
function righeAttive(testo) {
  const out = [];
  const pila = [];
  const acceso = () => pila.every((p) => p.vale);
  for (const grezza of String(testo || '').split(/\r?\n/)) {
    const r = grezza.trim();
    if (r.startsWith('!#if ')) { pila.push({ vale: valuta(r.slice(5)) }); continue; }
    if (r === '!#else') { if (pila.length) pila[pila.length - 1].vale = !pila[pila.length - 1].vale; continue; }
    if (r === '!#endif') { pila.pop(); continue; }
    if (acceso()) out.push(r);
  }
  return out;
}

// Solo nomi di file accanto alla lista: un «!#include» non porta a un altro server.
function inclusi(testo) {
  const out = [];
  for (const r of righeAttive(testo)) {
    const m = r.match(/^!#include\s+([A-Za-z0-9_.-]+\.txt)$/);
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

// ─── argomenti ─────────────────────────────────────────────────────────────

/** «nome, a, 'b, c', d\,e» → ['nome', 'a', 'b, c', 'd,e']. */
function argomenti(corpo) {
  const s = String(corpo || '');
  const out = [];
  let i = 0;
  while (i <= s.length) {
    while (i < s.length && s[i] === ' ') i++;
    const q = s[i];
    if (q === '\'' || q === '"' || q === '`') {
      // Fra virgolette la virgola non divide: l'argomento finisce alla virgoletta seguita da una virgola o dalla fine.
      let j = i + 1;
      let fine = -1;
      while (j < s.length) {
        if (s[j] === '\\') { j += 2; continue; }
        if (s[j] === q && /^\s*(,|$)/.test(s.slice(j + 1))) { fine = j; break; }
        j++;
      }
      if (fine >= 0) {
        out.push(s.slice(i + 1, fine).split('\\' + q).join(q));
        i = s.indexOf(',', fine);
        if (i < 0) break;
        i++;
        continue;
      }
    }
    let j = i;
    while (j < s.length && !(s[j] === ',' && s[j - 1] !== '\\')) j++;
    out.push(s.slice(i, j).trim().split('\\,').join(','));
    if (j >= s.length) break;
    i = j + 1;
  }
  return out;
}

// ─── domini ────────────────────────────────────────────────────────────────

function dominio(d, host) {
  if (d.endsWith('.*')) {
    const base = d.slice(0, -2);
    const senzaTld = host.replace(/\.[^.]+$/, '');
    return senzaTld === base || senzaTld.endsWith('.' + base);
  }
  return host === d || host.endsWith('.' + d);
}

function domini(testo) {
  const pos = [];
  const neg = [];
  for (let d of String(testo || '').split(',')) {
    d = d.trim().toLowerCase();
    if (!d) continue;
    if (d[0] === '~') neg.push(d.slice(1)); else pos.push(d);
  }
  return { pos, neg };
}

function valeSu(dom, host) {
  if (dom.neg.some((d) => dominio(d, host))) return false;
  return dom.pos.length === 0 || dom.pos.some((d) => dominio(d, host));
}

// Una regola entra solo se nomina per sé un sito di YouTube: «*» o «~youtube.com» non bastano.
function perYouTube(dom) {
  return dom.pos.some((d) => (d.endsWith('.*') ? /(^|\.)youtube(kids|-nocookie)?$/.test(d.slice(0, -2)) : hostYouTube(d)));
}

// ─── lettura ───────────────────────────────────────────────────────────────

const MAX_REGOLE = 2000;

/**
 * Le regole di YouTube di uno o più testi di lista, già senza doppioni: { regole, eccezioni, ignote }.
 * Ogni regola è { domini, nome, args }; `ignote` sono i nomi di scriptlet che il motore non conosce.
 */
function leggi(...testi) {
  const regole = [];
  const eccezioni = [];
  const ignote = new Set();
  const viste = new Set();
  for (const testo of testi) {
    for (const r of righeAttive(testo)) {
      if (!r || r[0] === '!') continue;
      const m = r.match(/^([^#]*)#(@?)#\+js\((.*)\)$/);
      if (!m) continue;
      const dom = domini(m[1]);
      const eccezione = m[2] === '@';
      const a = argomenti(m[3]);
      if (eccezione) {
        // Un'eccezione senza domini vale per tutti, quindi anche per YouTube.
        if (dom.pos.length && !perYouTube(dom)) continue;
        const nome = a[0] ? nomeNoto(a[0]) : '';
        if (nome === null) continue;
        eccezioni.push({ domini: dom, nome, args: nome ? a.slice(1) : [] });
        continue;
      }
      if (!perYouTube(dom) || !a[0]) continue;
      const nome = nomeNoto(a[0]);
      if (!nome) { ignote.add(String(a[0]).trim()); continue; }
      const regola = { domini: dom, nome, args: a.slice(1) };
      const chiave = JSON.stringify(regola);
      if (viste.has(chiave) || regole.length >= MAX_REGOLE) continue;
      viste.add(chiave);
      regole.push(regola);
    }
  }
  return { regole, eccezioni, ignote: [...ignote].sort() };
}

const stessa = (a, b) => a.nome === b.nome && a.args.length === b.args.length && a.args.every((x, i) => x === b.args[i]);

/** Gli scriptlet da eseguire su quell'host, come [nome, ...argomenti], in ordine di lista e senza ripetizioni. */
function perHost(insieme, host) {
  const h = String(host || '').toLowerCase();
  if (!insieme || !hostYouTube(h)) return [];
  const ecc = (insieme.eccezioni || []).filter((e) => valeSu(e.domini, h));
  if (ecc.some((e) => !e.nome)) return [];
  const out = [];
  const viste = new Set();
  for (const r of insieme.regole || []) {
    if (!valeSu(r.domini, h) || ecc.some((e) => stessa(e, r))) continue;
    const k = JSON.stringify([r.nome, ...r.args]);
    if (viste.has(k)) continue;
    viste.add(k);
    out.push([r.nome, ...r.args]);
  }
  return out;
}

module.exports = { BASI, SOLO_INCORPORATI, hostYouTube, hostYouTubeInScheda, hostDi, nomeNoto, valuta, righeAttive, inclusi, argomenti, domini, valeSu, leggi, perHost };
