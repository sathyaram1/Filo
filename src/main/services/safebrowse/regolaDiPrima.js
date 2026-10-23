// Il giudizio sui marchi delle regole di prima del classificatore, sui marchi che quelle regole conoscevano: dice solo
// quale marchio vedevano nel nome. Il verdetto lo dà imitazioni.js, che su questo marchio scagiona il nome solo se il
// modello è sicuro che il sito è vero (#1375). Non si ritocca: è il pavimento, le forme nuove si insegnano al modello.

'use strict';

const { BRANDS, LEGIT_DOMAINS, MARCHI_PAROLA, soloTruffa } = require('./brands');
const { skeleton } = require('./confusables');

const MARCHI_DI_PRIMA = new Set(('paypal stripe venmo wise revolut chase wellsfargo bankofamerica unicredit intesa ' +
  'intesasanpaolo poste nexi coinbase binance metamask kraken ledger google gmail microsoft outlook office365 apple ' +
  'icloud dropbox yahoo proton facebook instagram whatsapp twitter linkedin tiktok telegram discord netflix steam ' +
  'amazon ebay aliexpress shopify github gitlab').split(' '));
const MARCHI = BRANDS.filter((b) => MARCHI_DI_PRIMA.has(b.token));

function osa(a, b) {
  const al = a.length, bl = b.length;
  if (!al || !bl) return al || bl;
  const d = [];
  for (let i = 0; i <= al; i++) { d[i] = new Array(bl + 1).fill(0); d[i][0] = i; }
  for (let j = 0; j <= bl; j++) d[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[al][bl];
}

function soglia(n) {
  if (n < 5) return 0;
  return n >= 8 ? 2 : 1;
}

// Un marchio-parola di quattro lettere conta solo davanti a parole da truffa; gli altri con parole da truffa attorno.
function attaccatoATruffa(pezzo, tok) {
  const parola = (x) => !/^\d*$/.test(x);
  if (tok.length < 5) {
    const dopo = pezzo.slice(tok.length);
    return pezzo.startsWith(tok) && parola(dopo) && soloTruffa(dopo, true);
  }
  for (let i = pezzo.indexOf(tok); i >= 0; i = pezzo.indexOf(tok, i + 1)) {
    const prima = pezzo.slice(0, i);
    const dopo = pezzo.slice(i + tok.length);
    if ((parola(prima) || parola(dopo)) && soloTruffa(prima) && soloTruffa(dopo)) return true;
  }
  return false;
}

const SOMIGLIANTI = new Set(['il', 'li', 'ij', 'ji', 'lj', 'jl', 'iy', 'yi', 'vw', 'wv', 'uv', 'vu', 'mn', 'nm']);
function distanzaErrori(p, f) {
  const costo = (j, c) => (SOMIGLIANTI.has(f[j] + c) || f[j - 1] === c || f[j + 1] === c ? 1 : 2);
  const d = Array.from({ length: p.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= f.length; j++) d[0][j] = j;
  for (let i = 1; i <= p.length; i++) {
    for (let j = 1; j <= f.length; j++) {
      const sub = p[i - 1] === f[j - 1] ? 0 : costo(j - 1, p[i - 1]);
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + sub);
      if (i > 1 && j > 1 && p[i - 1] === f[j - 2] && p[i - 2] === f[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[p.length][f.length];
}

function formaIntera(pezzo, forma) {
  for (let i = pezzo.indexOf(forma); i >= 0; i = pezzo.indexOf(forma, i + 1)) {
    if (soloTruffa(pezzo.slice(0, i))) return true;
  }
  return false;
}

// La forma tipica con un errore e il marchio intero (posteitalia), con attorno solo parole da truffa.
function formaConErrore(pezzo, forma, token) {
  const oltre = forma.length - token.length;
  const max = oltre >= 8 ? 2 : oltre >= 2 ? 1 : 0;
  if (!max || !pezzo.includes(token)) return false;
  const inizi = [];
  const fini = [];
  for (let k = 0; k <= pezzo.length; k++) {
    if (soloTruffa(pezzo.slice(0, k))) inizi.push(k);
    if (soloTruffa(pezzo.slice(k))) fini.push(k);
  }
  for (const a of inizi) {
    for (const b of fini) {
      const parte = pezzo.slice(a, b);
      if (parte === forma || !parte.includes(token) || Math.abs(parte.length - forma.length) > max) continue;
      if (oltre === 2 && parte.length !== forma.length) continue;
      if (distanzaErrori(parte, forma) <= max) return true;
    }
  }
  return false;
}

function nominaMarchio(nome, token) {
  if (!nome || token.length < 3) return false;
  const tok = skeleton(token);
  const forme = MARCHI_PAROLA.get(token);
  if (forme) {
    const letture = nome.split(/[.-]/).filter(Boolean).flatMap((p) => [p, skeleton(p)]);
    return letture.some((p) => p === token || attaccatoATruffa(p, token))
      || forme.some((f) => letture.some((p) => formaIntera(p, f) || formaConErrore(p, f, token)));
  }
  return nome.split('.').some((l) => { const unito = l.replace(/-/g, ''); return unito.includes(token) || skeleton(unito).includes(tok); });
}

// Il token del marchio che le regole di prima vedevano nel nome, o ''.
function marchioDiPrima(norm) {
  if (!norm || !norm.ok || norm.isIp || norm.single || norm.suffixOnly) return '';
  if (LEGIT_DOMAINS.has(norm.registrable)) return '';
  const sld = (norm.sldUnicode || norm.sld || '').toLowerCase();
  const sldSkel = skeleton(sld);
  const etichette = (norm.hostUnicode || norm.host || '').split('.');
  const n = norm.registrable ? norm.registrable.split('.').length : 1;
  const sotto = etichette.slice(0, Math.max(0, etichette.length - n));
  let largo = '';
  for (const b of MARCHI) {
    const t = b.token;
    if (sld !== t && sldSkel && sldSkel === skeleton(t)) return t;
    if (sld !== t && !norm.ospitato) {
      const th = soglia(t.length);
      if (th > 0 && Math.abs(sld.length - t.length) <= th) {
        const d = osa(sld, t);
        if (d > 0 && d <= th) return t;
      }
    }
    if (largo) continue;
    if (sld === t || (sld.length > t.length && nominaMarchio(sld, t))) largo = t;
    else if (sotto.some((l) => l === t || skeleton(l) === skeleton(t))) largo = t;
  }
  return largo;
}

module.exports = { marchioDiPrima, MARCHI_DI_PRIMA };
