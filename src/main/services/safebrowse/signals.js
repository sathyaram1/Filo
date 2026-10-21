// Stage 3: segnali deterministici locali (sincroni, istantanei).
//
// Calcola, dal solo dominio normalizzato (+ opzionali indizi di pagina), i segnali su cui poggia il giudizio. I segnali
// nel CONTENUTO della pagina (password, modulo in chiaro) sono solo RINFORZO: arrivano dal chiamante via `ctx` e non
// sono mai l'unica base di un avviso ad alta gravità. L'imitazione di un marchio la giudica imitazioni.js:
//   strict    — travestimento (omoglifi, cifre, rn/vv) o refuso a una lettera su un marchio lungo: «Pericoloso».
//   weak_typo — refuso su un marchio corto, o a due lettere: da solo vale «Sospetto».
//   broad     — il nome del marchio dove non è suo (con altre parole, su un altro dominio, davanti a un altro sito).

'use strict';

const { giudica } = require('./imitazioni');

// Il confronto coi marchi è la parte cara del verdetto, e dipende solo dal nome: una pagina con migliaia di link ne ha
// pochi siti (#965). Tetto largo, il più vecchio esce per primo.
const MEMO_MAX = 20000;
const memo = new Map();
function matchBrands(norm, esca = []) {
  const k = [norm.hostUnicode || norm.host, norm.registrable, norm.sldUnicode || norm.sld, norm.ospitato ? 1 : 0, esca.join('.')].join('|');
  const noto = memo.get(k);
  if (noto) return noto;
  const r = cercaMarchi(norm, esca);
  memo.set(k, r);
  if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value);
  return r;
}

// Ritorna { strict, weak, broad }: al più uno non nullo, { brand, reason: tipo del verdetto, sld, distance, punteggio }.
function cercaMarchi(norm, esca) {
  const v = giudica(norm, { esca });
  const vuoto = { strict: null, weak: null, broad: null };
  if (!v) return vuoto;
  const hit = { brand: v.brand, reason: v.tipo, sld: v.nome, zona: v.zona, segue: v.segue, distance: v.distanza, punteggio: v.punteggio };
  if (v.forte) return { ...vuoto, strict: hit };
  // #728 — un nome che solo somiglia avvisa e non blocca: accusare un sito vero di essere un falso è peggio del rischio.
  if (v.tipo !== 'nome') return { ...vuoto, weak: hit };
  return { ...vuoto, broad: hit };
}

// Un programma con il nome di un documento (fattura.pdf.exe): conta l'ultima estensione, decisa dalla stessa lista che
// mette la domanda sugli scaricamenti (#588), e quella prima deve essere di un file che si apre per leggerlo.
const ESE = globalThis.SN_ESEGUIBILI || (require('../../../shared/eseguibili.js'), globalThis.SN_ESEGUIBILI);
// Le estensioni dei file che si aprono per guardarli (documenti, immagini, audio, video, archivi): un elenco largo, perché
// il travestimento usa quella che ispira fiducia; i pezzi di versione (setup.2.1.exe, x64) non ci sono.
const DOCUMENTO = new Set((
  'pdf doc docx docm dot dotx xls xlsx xlsm xlsb ppt pptx pptm pps ppsx odt ods odp odg rtf txt csv tsv md xml json ' +
  'htm html xps oxps epub mobi pages numbers key eml msg ics vcf ' +
  'jpg jpeg jpe png gif bmp tif tiff webp heic heif avif svg ico psd raw cr2 nef ' +
  'mp3 wav flac aac ogg oga m4a wma opus aif aiff mid midi ' +
  'mp4 m4v mkv avi mov wmv flv webm mpg mpeg 3gp vob m2ts srt ' +
  'zip rar 7z tar gz tgz bz2 xz'
).split(' '));

function doppiaEstensione(nome) {
  const pulito = ESE.nomeVisibile(nome).replace(/[.\s\u00a0]+$/, '');
  if (!ESE.eEseguibile(pulito)) return false;
  // Spazi e punti in più prima dell'estensione vera (fattura.pdf      .exe, fattura.pdf..exe) non la nascondono qui.
  const parti = pulito.split('.').map((p) => p.replace(/[\s\u00a0]+/g, ''));
  const prima = parti.slice(0, -1).filter(Boolean);
  return prima.length >= 2 && DOCUMENTO.has(prima[prima.length - 1].toLowerCase());
}

// Il percorso può portare anche i parametri che nominano un file (`/dl?file=fattura.pdf.exe`, links.js): conta il nome
// che chiude ogni pezzo.
function nomiNelPercorso(percorso) {
  let p = String(percorso || '');
  try { p = decodeURIComponent(p); } catch (_) {}
  return p.split(/[?#&]/).map((x) => x.split(/[/=]/).pop() || '');
}

// Calcola i segnali deterministici locali. `norm` = output di normalize(). `ctx` = indizi della pagina e della scheda:
// { hasPassword, hasPayment, insecureForm, autoDownload (nome del programma partito da solo), downloadName (un file
// che la pagina ha fatto scaricare), urlPath, esca (le parole prima della chiocciola) }.
function localSignals(norm, ctx = {}) {
  const out = [];
  if (!norm || !norm.ok) return out;

  if (!norm.single && !norm.suffixOnly) {
    const { strict, weak, broad } = matchBrands(norm, ctx.esca || []);
    if (strict) out.push({ kind: 'strict_impersonation', ...strict });
    else if (weak) out.push({ kind: 'weak_typo', ...weak });
    else if (broad) out.push({ kind: 'broad_impersonation', ...broad });
  }

  // Trasporto non sicuro (rinforzo). Gli IP locali/loopback non contano.
  if (!norm.secure && norm.protocol === 'http') {
    out.push({ kind: 'insecure_transport' });
  }

  const nell = nomiNelPercorso(ctx.urlPath).find(doppiaEstensione);
  if (nell) out.push({ kind: 'double_extension', name: nell, where: 'url' });
  else {
    const scaricato = [ctx.downloadName, ctx.autoDownload].find((n) => typeof n === 'string' && doppiaEstensione(n));
    if (scaricato) out.push({ kind: 'double_extension', name: scaricato, where: 'download' });
  }
  if (ctx.autoDownload) out.push({ kind: 'auto_download', name: typeof ctx.autoDownload === 'string' ? ctx.autoDownload : '' });

  // Indizi di pagina (solo rinforzo).
  if (ctx.hasPassword) out.push({ kind: 'sensitive_input', field: 'password' });
  else if (ctx.hasPayment) out.push({ kind: 'sensitive_input', field: 'payment' });
  if (ctx.insecureForm) out.push({ kind: 'insecure_form' });

  return out;
}

module.exports = { localSignals, matchBrands, doppiaEstensione };
