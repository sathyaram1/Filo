// Addestra il classificatore delle imitazioni di marchi (src/main/services/safebrowse/imitazioni.js) e scrive imitazioni.bin.
// Impara da elenchi pubblici di truffe e di siti noti e dalle etichette scritte in scripts/imitazioni/etichette.tsv, mai
// dalle risposte di un servizio di terzi; misura sulle prove di tests/unit/dati, che restano fuori dall'addestramento.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(RADICE, 'package.json'));
const { normalize } = require('./src/main/services/safebrowse/normalize.js');
const IM = require('./src/main/services/safebrowse/imitazioni.js');

const ETICHETTE = path.join(RADICE, 'scripts', 'imitazioni', 'etichette.tsv');
const PROVA = path.join(RADICE, 'tests', 'unit', 'dati', 'imitazioni-prova.tsv');

// Truffe: domini attivi segnalati da chiunque, e il feed pubblico di OpenPhish. Siti noti: i più visitati secondo il DNS
// di Cisco Umbrella e due elenchi dei più trafficati.
const FONTI = [
  { file: 'truffe-phishingdb.txt', etichetta: 1, url: 'https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-domains-ACTIVE.txt' },
  { file: 'truffe-openphish.txt', etichetta: 1, url: 'https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt' },
  { file: 'noti-top10k.txt', etichetta: 0, url: 'https://raw.githubusercontent.com/zer0h/top-1000000-domains/master/top-10000-domains' },
  { file: 'noti-opendns.txt', etichetta: 0, url: 'https://raw.githubusercontent.com/opendns/public-domain-lists/master/opendns-top-domains.txt' },
  { file: 'noti-umbrella.csv', etichetta: 0, url: 'https://s3-us-west-1.amazonaws.com/umbrella-static/top-1m.csv.zip', zip: true },
];

// --scarica: prima scarica gli elenchi in --dati (di base nella cartella temporanea); --solo-prova: misura il modello
// che c'è, senza riaddestrare; --dettagli: elenca falsi allarmi e imitazioni perse. Il primo giro dura qualche minuto.
const arg = (nome, base) => { const i = process.argv.indexOf(nome); return i > 0 ? process.argv[i + 1] : base; };
const DATI = path.resolve(arg('--dati', path.join(os.tmpdir(), 'filo-imitazioni')));
const BIT = Number(arg('--bit', 20));
const EPOCHE = Number(arg('--epoche', 8));
const L2 = Number(arg('--l2', 1e-6));
// Il tetto dei falsi allarmi sui siti noti con cui si sceglie la soglia: uno su duecento.
const FALSI_AMMESSI = Number(arg('--falsi', 0.005));
const PESO_MANO = Number(arg('--peso-mano', 6));
// I refusi scritti in automatico pesano meno di un'etichetta a mano: a peso pieno spostavano il modello sui refusi e
// perdeva le imitazioni con altre parole.
const PESO_SINTETICI = Number(arg('--peso-sintetici', 2));

async function scarica() {
  fs.mkdirSync(DATI, { recursive: true });
  for (const f of FONTI) {
    const r = await fetch(f.url);
    if (!r.ok) throw new Error(`${f.url}: ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(path.join(DATI, f.file), f.zip ? primoDelloZip(buf) : buf);
    console.log('scaricato', f.file, buf.length, 'byte');
  }
}

// Il primo file di uno zip, senza programmi esterni (su Windows `unzip` non c'è): la directory centrale dice dove sta.
function primoDelloZip(buf) {
  const fine = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (fine < 0) throw new Error('zip senza directory centrale');
  const centrale = buf.readUInt32LE(fine + 16);
  if (buf.readUInt32LE(centrale) !== 0x02014b50) throw new Error('zip illeggibile');
  const metodo = buf.readUInt16LE(centrale + 10);
  const compresso = buf.readUInt32LE(centrale + 20);
  const locale = buf.readUInt32LE(centrale + 42);
  const dati = locale + 30 + buf.readUInt16LE(locale + 26) + buf.readUInt16LE(locale + 28);
  const pezzo = buf.subarray(dati, dati + compresso);
  return metodo === 8 ? zlib.inflateRawSync(pezzo) : pezzo;
}

function host(riga) {
  let s = riga.trim();
  if (!s || s.startsWith('#')) return '';
  if (/^\d+,/.test(s)) s = s.slice(s.indexOf(',') + 1);
  if (/^[a-z]+:\/\//i.test(s)) { try { s = new URL(s).hostname; } catch (_) { return ''; } }
  return s.toLowerCase().replace(/\.$/, '');
}

// Le righe dei file tsv: host (o indirizzo intero, quando conta quello che sta prima della chiocciola), marchio imitato
// ('-' se nessuno).
function leggiTsv(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter((r) => r && !r.startsWith('#')).map((r) => {
    const [h, marchio] = r.split('\t');
    const url = /^[a-z]+:\/\//i.test(h) ? h : 'https://' + h + '/';
    return { h: /^[a-z]+:\/\//i.test(h) ? h : host(h), url, marchio: marchio && marchio !== '-' ? marchio : null };
  });
}

// Le parole prima della chiocciola non stanno negli elenchi: le imitazioni di quel tipo si scrivono dall'elenco dei
// marchi, col loro dominio vero davanti a uno qualunque.
function sinteticiEsca() {
  const { BRANDS } = require('./src/main/services/safebrowse/brands.js');
  const dove = ['accesso-sicuro.net', 'verifica-conto.com', 'servizi-online.net', 'example.org', 'login-area.info', '203.0.113.7'];
  return BRANDS.flatMap((b, i) => [
    { h: `https://www.${b.domains[0]}@${dove[i % dove.length]}/login`, marchio: b.token },
    { h: `https://${b.domains[0]}:accesso@${dove[(i + 3) % dove.length]}/`, marchio: b.token },
  ]).map((r) => ({ ...r, url: r.h }));
}

// Fra i candidati di una truffa, quello che la truffa imita: il marchio scritto a mano se c'è, se no il più evidente.
const ORDINE = ['omografo', 'sosia', 'esatto', 'omografodentro', 'sosiadentro', 'esattodentro', 'typo', 'typodentro'];
function principale(es, marchio) {
  if (marchio) return es.find((e) => e.c.mc.token === marchio) || es.find((e) => e.c.mc.brand.display === displayDi(marchio)) || null;
  return [...es].sort((a, b) => ORDINE.indexOf(a.c.tipo) - ORDINE.indexOf(b.c.tipo)
    || b.c.mc.token.length - a.c.mc.token.length || (a.c.zona === 'sld' ? -1 : 1))[0];
}

// Il tasto accanto sulla tastiera, per i refusi di chi digita.
const ACCANTO = {
  q: 'wa', w: 'qe', e: 'wr', r: 'et', t: 'ry', y: 'tu', u: 'yi', i: 'uo', o: 'ip', p: 'ol', a: 'sq', s: 'ad', d: 'sf',
  f: 'dg', g: 'fh', h: 'gj', j: 'hk', k: 'jl', l: 'kp', z: 'xa', x: 'zc', c: 'xv', v: 'cb', b: 'vn', n: 'bm', m: 'nj',
};

// I refusi di chi digita il dominio vero di un marchio (gooogle.com, micrsoft.com, linkedln.com), come li registra chi
// aspetta l'errore: negli elenchi di truffe sono pochi, perché vivono di traffico sbagliato più che di messaggi. Uno per
// tipo di errore e per marchio; resta fuori un nome che sta fra i siti noti.
function sinteticiRefusi(etichetta) {
  const { BRANDS } = require('./src/main/services/safebrowse/brands.js');
  const SIMILI = [['i', 'l'], ['l', 'i'], ['m', 'rn'], ['w', 'vv'], ['g', 'q'], ['n', 'm'], ['o', 'a']];
  const out = [];
  const visti = new Set();
  for (const b of BRANDS) {
    const t = b.token;
    if (t.length < 5 || !/^[a-z]+$/.test(t) || visti.has(t)) continue;
    visti.add(t);
    const dom = b.domains.find((d) => d.startsWith(t + '.')) || '';
    if (!dom) continue;
    const suff = dom.slice(t.length);
    const m = Math.floor(t.length / 2);
    const doppia = [...t].findIndex((c, i) => c === t[i + 1]);
    const varianti = [
      t.slice(0, m) + t[m] + t.slice(m),
      doppia >= 0 ? t.slice(0, doppia) + t.slice(doppia + 1) : t.slice(0, t.length - 2) + t.slice(t.length - 1),
      t.slice(0, t.length - 3) + t[t.length - 2] + t[t.length - 3] + t.slice(t.length - 1),
      t.slice(0, 1) + t.slice(2),
    ];
    const simile = SIMILI.find(([da]) => t.indexOf(da, 1) > 0);
    if (simile) varianti.push(t.replace(new RegExp('(?<=.)' + simile[0]), simile[1]));
    // I refusi in coda e col tasto accanto (paypall, microsofts, amazom): senza, il modello lasciava passare una
    // lettera in più o in meno in fondo al marchio.
    const ultima = t[t.length - 1];
    varianti.push(t + ultima, t + 's', t + (ACCANTO[ultima] || 'e')[0], t.slice(0, -1));
    if (ACCANTO[t[m]]) varianti.push(t.slice(0, m) + ACCANTO[t[m]][1] + t[m] + t.slice(m + 1));
    const nomi = [...new Set(varianti)].filter((v) => v !== t).map((v) => v + suff);
    // E il suffisso sbagliato di una lettera (github.co, paypal.cm), dove il marchio non l'ha preso per sé.
    if (suff === '.com') nomi.push(...['.co', '.cm', '.om'].map((x) => t + x).filter((h) => !b.domains.includes(h)));
    for (const h of nomi) if (!etichetta.has(h) && !etichetta.has('www.' + h)) out.push({ h, url: 'https://' + h + '/', marchio: t, sintetico: true });
  }
  return out;
}

function displayDi(token) {
  const { BRANDS } = require('./src/main/services/safebrowse/brands.js');
  return (BRANDS.find((b) => b.token === token) || {}).display;
}

function evidente(c) {
  if (c.tipo.startsWith('typo')) return false;
  return !(c.tipo.endsWith('dentro') && (c.mc.parola || c.mc.token.length <= 4));
}

function rng(seme) {
  let x = seme >>> 0;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

function indici(feats, maschera) {
  const out = new Int32Array(feats.length);
  for (let i = 0; i < feats.length; i++) {
    const h = IM.impronta(feats[i]);
    out[i] = (h & maschera) * ((h & 0x80000000) ? -1 : 1) - ((h & 0x80000000) ? 1 : 0);
  }
  return out;
}
// Un indice negativo porta il segno meno: -(i+1).
const posto = (x) => (x < 0 ? -x - 1 : x);
const segno = (x) => (x < 0 ? -1 : 1);

function addestra(esempi, { bit = BIT, epoche = EPOCHE, l2 = L2, seme = 7 } = {}) {
  const n = 1 << bit;
  const w = new Float64Array(n);
  const g2 = new Float64Array(n).fill(1e-8);
  let bias = 0, gb = 1e-8;
  const pos = esempi.filter((e) => e.y === 1).length;
  const neg = esempi.length - pos;
  const pesoPos = neg / Math.max(1, pos);
  const ordine = esempi.map((_, i) => i);
  const caso = rng(seme);
  const passo = 0.1;
  for (let ep = 0; ep < epoche; ep++) {
    for (let i = ordine.length - 1; i > 0; i--) { const j = Math.floor(caso() * (i + 1)); [ordine[i], ordine[j]] = [ordine[j], ordine[i]]; }
    for (const k of ordine) {
      const e = esempi[k];
      let s = bias;
      for (const x of e.ix) s += segno(x) * w[posto(x)];
      const p = 1 / (1 + Math.exp(-s));
      const peso = e.y === 1 ? pesoPos : 1;
      const g = (p - e.y) * peso * (e.peso || 1);
      for (const x of e.ix) {
        const j = posto(x);
        const gj = g * segno(x) + l2 * w[j];
        g2[j] += gj * gj;
        w[j] -= passo * gj / Math.sqrt(g2[j]);
      }
      gb += g * g;
      bias -= passo * g / Math.sqrt(gb);
    }
  }
  return { w, bias, bit };
}

function quantizza(m) {
  let max = 0;
  for (const x of m.w) if (Math.abs(x) > max) max = Math.abs(x);
  const scala = max / 127 || 1;
  const q = new Int8Array(m.w.length);
  for (let i = 0; i < q.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(m.w[i] / scala)));
  return { q, scala, bias: m.bias, bit: m.bit };
}

function punteggioQ(ix, mq) {
  let s = mq.bias;
  for (const x of ix) s += segno(x) * mq.q[posto(x)] * mq.scala;
  return 1 / (1 + Math.exp(-s));
}

function scrivi(mq, soglia, sogliaForte, info) {
  const testa = Buffer.from(JSON.stringify({ bit: mq.bit, bias: mq.bias, scala: mq.scala, soglia, sogliaForte, ...info }), 'utf8');
  const capo = Buffer.alloc(8);
  capo.write('FIMI', 0, 'ascii');
  capo.writeUInt32LE(testa.length, 4);
  fs.writeFileSync(IM.FILE_MODELLO, Buffer.concat([capo, testa, Buffer.from(mq.q.buffer)]));
}

// Il punteggio di un host è quello del suo candidato più forte.
function perHost(gruppi, mq) {
  return gruppi.map((g) => ({ ...g, p: Math.max(...g.ix.map((ix) => punteggioQ(ix, mq))) }));
}

function sogliaPer(punti, falsi) {
  const neg = punti.filter((g) => g.y === 0).map((g) => g.p).sort((a, b) => b - a);
  const k = Math.floor(neg.length * falsi);
  return Math.min(0.99, Math.max(0.5, (neg[k] ?? 0.5) + 1e-6));
}

function misura(punti, soglia) {
  const pos = punti.filter((g) => g.y === 1);
  const neg = punti.filter((g) => g.y === 0);
  const presi = pos.filter((g) => g.p >= soglia).length;
  const falsi = neg.filter((g) => g.p >= soglia).length;
  return { presi, truffe: pos.length, falsi, noti: neg.length, richiamo: presi / Math.max(1, pos.length), tassoFalsi: falsi / Math.max(1, neg.length) };
}

// Gli host degli elenchi che portano almeno un marchio: rifarli tutti a ogni prova costa minuti, e dipendono solo
// dall'elenco dei marchi.
function conCandidati(etichetta) {
  const { BRANDS } = require('./src/main/services/safebrowse/brands.js');
  const chiave = IM.impronta(JSON.stringify(BRANDS) + IM.FIRMA_CANDIDATI).toString(16);
  const cache = path.join(DATI, `con-candidati-${chiave}.txt`);
  if (fs.existsSync(cache)) return new Set(fs.readFileSync(cache, 'utf8').split('\n').filter(Boolean));
  const out = new Set();
  for (const h of etichetta.keys()) if (IM.esempi(normalize('https://' + h + '/')).length) out.add(h);
  fs.writeFileSync(cache, [...out].join('\n'));
  return out;
}

let refusiTolti = 0;
function costruisci() {
  const prova = new Set(leggiTsv(PROVA).map((r) => r.h));
  const etichetta = new Map();
  const conflitto = new Set();
  for (const f of FONTI) {
    const file = path.join(DATI, f.file);
    if (!fs.existsSync(file)) throw new Error(`manca ${file}: lancia prima con --scarica`);
    for (const riga of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const h = host(riga);
      if (!h) continue;
      const prima = etichetta.get(h);
      if (prima !== undefined && prima !== f.etichetta) conflitto.add(h);
      etichetta.set(h, f.etichetta);
    }
  }
  for (const h of conflitto) etichetta.delete(h);
  const scritte = new Map([...sinteticiRefusi(etichetta), ...leggiTsv(ETICHETTE), ...sinteticiEsca()].map((r) => [r.h, r]));
  const gruppi = [];
  const perSito = new Map();
  const aggiungi = (h, y, marchio, fonte, url = 'https://' + h + '/') => {
    if (prova.has(h)) return;
    const norm = normalize(url);
    if (fonte === 'elenco' && y === 0) {
      // Dei siti noti bastano pochi nomi per sito: i mille server di un sito non sono mille siti.
      const k = perSito.get(norm.registrable) || 0;
      if (k >= 4) return;
      perSito.set(norm.registrable, k + 1);
    }
    const es = IM.esempi(norm, IM.escaDi(url));
    if (!es.length) return;
    // Un refuso del dominio vero di un marchio (micosoft.com) sta fra i siti più visitati per le visite sbagliate, non
    // perché sia un altro sito: da un elenco non si impara che è innocuo. Un sito vero con quella forma (ilpost.it,
    // a una lettera da inpost.it) lo dice un'etichetta scritta.
    if (fonte === 'elenco' && y === 0 && es.some(({ c }) => c.zona === 'sld' && c.tipo === 'typo'
      && c.mc.brand.domains.includes(c.mc.token + '.' + norm.publicSuffix))) { refusiTolti++; return; }
    const mask = (1 << BIT) - 1;
    if (y === 1) {
      const e = principale(es, marchio);
      // Da un elenco di truffe si impara solo l'imitazione evidente: un refuso o una parola dentro un'altra lì è spesso
      // un caso (mail.dominio-di-truffa non imita Gmail), e lo decide solo un'etichetta scritta.
      if (!e || (!marchio && !evidente(e.c))) return;
      gruppi.push({ h, y, fonte, ix: [indici(e.feats, mask)], marchio: e.c.mc.token });
    } else gruppi.push({ h, y, fonte, ix: es.map((e) => indici(e.feats, mask)) });
    // Un'etichetta scritta vale più di una riga di un elenco, che può sbagliare.
    if (fonte === 'mano') gruppi[gruppi.length - 1].peso = PESO_MANO;
    if (fonte === 'sintetico') gruppi[gruppi.length - 1].peso = PESO_SINTETICI;
  };
  const utili = conCandidati(etichetta);
  for (const [h, y] of etichetta) if (utili.has(h) && !scritte.has(h)) aggiungi(h, y, null, 'elenco');
  for (const [h, r] of scritte) aggiungi(h, r.marchio ? 1 : 0, r.marchio, r.sintetico ? 'sintetico' : 'mano', r.url);
  return gruppi;
}

function provaModello() {
  const righe = leggiTsv(PROVA);
  const m = { presi: 0, truffe: 0, falsi: [], noti: 0, marchioSbagliato: [], persi: [] };
  for (const r of righe) {
    const v = IM.giudica(normalize(r.url), { esca: IM.escaDi(r.url) });
    if (r.marchio) {
      m.truffe++;
      if (v) { m.presi++; if (v.brand.token !== r.marchio && v.brand.display !== displayDi(r.marchio)) m.marchioSbagliato.push(`${r.h} ${r.marchio}→${v.brand.token}`); } else m.persi.push(r.h);
    } else {
      m.noti++;
      if (v) m.falsi.push(`${r.h} (${v.brand.token} ${v.tipo} ${v.punteggio.toFixed(2)})`);
    }
  }
  console.log(`prove: prese ${m.presi}/${m.truffe} imitazioni (${(100 * m.presi / Math.max(1, m.truffe)).toFixed(1)}%), falsi allarmi ${m.falsi.length}/${m.noti} siti veri (${(100 * m.falsi.length / Math.max(1, m.noti)).toFixed(1)}%)`);
  if (process.argv.includes('--dettagli')) {
    console.log('falsi:', m.falsi.join(', '));
    console.log('persi:', m.persi.join(', '));
    console.log('marchio sbagliato:', m.marchioSbagliato.join(', '));
  }
  return m;
}

async function avvia() {
  if (process.argv.includes('--scarica')) await scarica();
  if (process.argv.includes('--solo-prova')) { provaModello(); return; }
  const t0 = Date.now();
  const gruppi = costruisci();
  console.log(`esempi: ${gruppi.filter((g) => g.y === 1).length} imitazioni, ${gruppi.filter((g) => g.y === 0).length} siti noti, ${refusiTolti} refusi di marchi tolti dagli elenchi (${Date.now() - t0} ms)`);
  // Un decimo da parte per scegliere la soglia su nomi che il modello non ha visto.
  const caso = rng(11);
  const parte = gruppi.map(() => caso() < 0.1);
  const esempiDi = (gg) => gg.flatMap((g) => (g.y === 1 ? [{ ix: g.ix[0], y: 1, peso: g.peso }] : g.ix.map((ix) => ({ ix, y: 0, peso: g.peso }))));
  const allena = gruppi.filter((_, i) => !parte[i]);
  const valida = gruppi.filter((_, i) => parte[i]);
  const mq0 = quantizza(addestra(esempiDi(allena)));
  const pv = perHost(valida, mq0);
  const soglia = sogliaPer(pv, FALSI_AMMESSI);
  const mv = misura(pv, soglia);
  console.log(`validazione: soglia ${soglia.toFixed(3)}, prese ${mv.presi}/${mv.truffe} (${(100 * mv.richiamo).toFixed(1)}%), falsi ${mv.falsi}/${mv.noti} (${(100 * mv.tassoFalsi).toFixed(2)}%)`);
  const sogliaForte = Math.max(soglia, sogliaPer(pv, FALSI_AMMESSI / 5));
  const mq = quantizza(addestra(esempiDi(gruppi)));
  scrivi(mq, soglia, sogliaForte, { esempi: { imitazioni: gruppi.filter((g) => g.y === 1).length, noti: gruppi.filter((g) => g.y === 0).length } });
  console.log(`scritto ${path.relative(RADICE, IM.FILE_MODELLO)} (${fs.statSync(IM.FILE_MODELLO).size} byte)`);
  provaModello();
}

avvia().catch((e) => { console.error(e); process.exit(1); });
