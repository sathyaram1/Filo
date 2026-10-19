// Reed-Solomon sistematico su GF(2^8) per i gruppi del profilo segreto: k blocchi di dati e k di parità (k ≤ 10), e ne
// bastano k qualsiasi per ricostruire il gruppo. Puro: niente disco, niente chiavi.
// Prove in tests/unit/profiloSegreto.test.mjs.

'use strict';

const MAX_K = 10;

const ESP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    ESP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) ESP[i] = ESP[i - 255];
})();

const per = (a, b) => (a && b ? ESP[LOG[a] + LOG[b]] : 0);
const inverso = (a) => ESP[255 - LOG[a]];

// Una riga di prodotti per coefficiente: il ciclo interno diventa una lettura di tabella e uno XOR.
const RIGHE = Array.from({ length: 256 }, (_, a) => {
  const r = new Uint8Array(256);
  for (let b = 0; b < 256; b++) r[b] = per(a, b);
  return r;
});

// Cauchy con x_i = i e y_j = 10 + j, insiemi disgiunti: ogni sua sottomatrice quadrata è invertibile, quindi
// qualunque scelta di k blocchi fra dati e parità ricostruisce il gruppo.
const CAUCHY = Array.from({ length: MAX_K }, (_, i) => Array.from({ length: MAX_K }, (_, j) => inverso(i ^ (MAX_K + j))));

function accumula(dest, coeff, src) {
  if (!coeff) return;
  const r = RIGHE[coeff];
  for (let b = 0; b < dest.length; b++) dest[b] ^= r[src[b]];
}

function controllaK(k) {
  if (!Number.isInteger(k) || k < 1 || k > MAX_K) throw new RangeError(`un gruppo ha da 1 a ${MAX_K} blocchi di dati, non ${k}`);
}

// `righe`: solo le parità che servono (le altre restano null), per chi deve rifarne poche.
function parita(dati, righe = null) {
  const k = dati.length;
  controllaK(k);
  const len = dati[0].length;
  if (dati.some((d) => d.length !== len)) throw new RangeError('i blocchi di un gruppo hanno tutti la stessa lunghezza');
  return Array.from({ length: k }, (_, i) => {
    if (righe && !righe.includes(i)) return null;
    const p = new Uint8Array(len);
    for (let j = 0; j < k; j++) accumula(p, CAUCHY[i][j], dati[j]);
    return p;
  });
}

function inverti(m) {
  const n = m.length;
  const a = m.map((riga, i) => [...riga, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    while (p < n && !a[p][c]) p++;
    if (p === n) throw new Error('matrice non invertibile');
    [a[c], a[p]] = [a[p], a[c]];
    const f = inverso(a[c][c]);
    for (let j = 0; j < 2 * n; j++) a[c][j] = per(a[c][j], f);
    for (let r = 0; r < n; r++) {
      const g = a[r][c];
      if (r === c || !g) continue;
      for (let j = 0; j < 2 * n; j++) a[r][j] ^= per(g, a[c][j]);
    }
  }
  return a.map((riga) => riga.slice(n));
}

// `presenti`: indice → blocco, con 0..k-1 i dati e k..2k-1 la parità. Torna i k blocchi di dati, o null se ne restano
// meno di k. I dati presenti si usano per primi: con tutti i dati non c'è nessun conto da fare.
function ricostruisci(k, presenti) {
  controllaK(k);
  const scelti = [...presenti.keys()].filter((i) => Number.isInteger(i) && i >= 0 && i < 2 * k).sort((a, b) => a - b).slice(0, k);
  if (scelti.length < k) return null;
  const len = presenti.get(scelti[0]).length;
  const dati = new Array(k).fill(null);
  for (const i of scelti) if (i < k) dati[i] = presenti.get(i);
  const mancanti = [];
  for (let j = 0; j < k; j++) if (!dati[j]) mancanti.push(j);
  if (!mancanti.length) return dati;
  const inv = inverti(scelti.map((i) => (i < k
    ? Array.from({ length: k }, (_, j) => (j === i ? 1 : 0))
    : CAUCHY[i - k].slice(0, k))));
  for (const j of mancanti) {
    const out = new Uint8Array(len);
    scelti.forEach((i, m) => accumula(out, inv[j][m], presenti.get(i)));
    dati[j] = out;
  }
  return dati;
}

module.exports = { MAX_K, parita, ricostruisci };
