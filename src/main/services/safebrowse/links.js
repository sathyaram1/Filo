// Esame dei link di una pagina coi soli controlli che non escono dal computer (#965): al clic il verdetto è pronto.
// Non chiama la rete: Safe Browsing, registri, modello e finestra isolata restano ad analyze(), a pagina aperta.
// Prove: tests/unit/safebrowseLinkLotto.test.mjs, tests/safebrowse-link-prima-del-clic.spec.mjs.

'use strict';

// Link per messaggio dalla pagina: oltre, il main rifiuta col numero e la pagina spezza.
const LOTTO_MAX = 500;
// Quanto il main resta occupato per giro prima di cedere il passo al resto di Filo.
const FETTA_MS = 8;

const LIVELLI = new Set(['pericoloso', 'sospetto']);

// I parametri che portano un file per nome. Il testo cercato (q, search, keywords…) non è un file: una ricerca di
// «fattura.pdf.exe» apre dei risultati, non un programma.
const PARAMETRI_FILE = /^(file|files|filename|fname|fn|f|name|nome|nomefile|attachment|allegato|download|dl|doc|document|documento)$/i;

// Una doppia estensione sta nel percorso, in un parametro che porta un file o in un indirizzo passato come parametro
// (un rimando), scritta com'è letta: «%20» è uno spazio. `nome`: il nome con cui il file arriva, se lo si sa già.
function percorsoDi(u, nome = '') {
  const leggi = (s) => { try { return decodeURIComponent(s); } catch (_) { return s; } };
  let out = leggi(u.pathname);
  for (const [k, val] of u.searchParams) {
    let dentro = null;
    try { dentro = /^https?:\/\//i.test(val) ? new URL(val) : null; } catch (_) { dentro = null; }
    if (dentro) out += '?' + k + '=' + leggi(dentro.pathname);
    else if (PARAMETRI_FILE.test(k)) out += '?' + k + '=' + val;
  }
  if (nome) out += '?nome=' + nome;
  return out;
}

// Un link solo: null se non è un indirizzo web o se non c'è niente da dire.
function esaminaLink(url, checkSync, nome = '') {
  let u;
  try { u = new URL(String(url)); } catch (_) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const v = checkSync(u.href, { urlPath: percorsoDi(u, nome) });
  if (!v || !LIVELLI.has(v.level)) return null;
  return { url: u.href, level: v.level, message: v.message || null, scope: v.scope || (v.norm && v.norm.registrable) || null, diPagina: !!v.diPagina };
}

// Un lotto da `da` in poi, finché `scaduto()` lo permette (almeno un link a giro, così si va sempre avanti).
function esaminaLotto(urls, { checkSync, da = 0, scaduto = () => false } = {}) {
  const segnalati = [];
  let i = da;
  while (i < urls.length) {
    if (i > da && scaduto()) break;
    const s = esaminaLink(urls[i], checkSync);
    if (s) segnalati.push(s);
    i++;
  }
  return { fatti: i - da, segnalati };
}

const cediIlPasso = () => new Promise((ok) => setImmediate(ok));

// Tutto il lotto, a fette di `fettaMs`, cedendo il passo fra una e l'altra; `vivo()` falso ferma (scheda chiusa).
async function esaminaAFette(urls, { checkSync, fettaMs = FETTA_MS, ora = () => Date.now(), cedi = cediIlPasso, vivo = () => true } = {}) {
  const segnalati = [];
  let da = 0;
  let fette = 0;
  while (da < urls.length && vivo()) {
    if (fette) await cedi();
    if (!vivo()) break;
    const fine = ora() + fettaMs;
    const r = esaminaLotto(urls, { checkSync, da, scaduto: () => ora() >= fine });
    da += r.fatti;
    fette++;
    segnalati.push(...r.segnalati);
  }
  return { esaminati: da, fette, segnalati };
}

module.exports = { LOTTO_MAX, FETTA_MS, esaminaLink, esaminaLotto, esaminaAFette, percorsoDi };
