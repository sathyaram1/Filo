// Addestra il classificatore delle imitazioni di marchi (src/main/services/safebrowse/imitazioni.js) e lo scrive in
// imitazioni.bin. Impara da elenchi pubblici di truffe e di siti noti e dalle etichette scritte a mano in
// scripts/imitazioni/etichette.tsv, mai dalle risposte di un servizio di terzi. Misura sulle prove di tests/unit/dati.
//
//   node scripts/addestra-imitazioni.mjs --scarica      scarica gli elenchi (in --dati, di base nella cartella temporanea)
//   node scripts/addestra-imitazioni.mjs                addestra con gli elenchi già scaricati
//   node scripts/addestra-imitazioni.mjs --solo-prova   misura il modello attuale sulle prove, senza riaddestrare

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

const arg = (nome, base) => { const i = process.argv.indexOf(nome); return i > 0 ? process.argv[i + 1] : base; };
const DATI = path.resolve(arg('--dati', path.join(os.tmpdir(), 'filo-imitazioni')));
const BIT = Number(arg('--bit', 20));
const EPOCHE = Number(arg('--epoche', 8));
const L2 = Number(arg('--l2', 1e-6));
// Il tetto dei falsi allarmi sui siti noti con cui si sceglie la soglia: uno su duecento.
const FALSI_AMMESSI = Number(arg('--falsi', 0.005));

async function scarica() {
  fs.mkdirSync(DATI, { recursive: true });
  for (const f of FONTI) {
    const r = await fetch(f.url);
    if (!r.ok) throw new Error(`${f.url}: ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (f.zip) {
      const { execFileSync } = await import('node:child_process');
      const zip = path.join(DATI, f.file + '.zip');
      fs.writeFileSync(zip, buf);
      fs.writeFileSync(path.join(DATI, f.file), execFileSync('unzip', ['-p', zip], { maxBuffer: 1 << 30 }));
    } else fs.writeFileSync(path.join(DATI, f.file), buf);
    console.log('scaricato', f.file, buf.length, 'byte');
  }
}

function host(riga) {
  let s = riga.trim();
  if (!s || s.startsWith('#')) return '';
  if (/^\d+,/.test(s)) s = s.slice(s.indexOf(',') + 1);
  if (/^[a-z]+:\/\//i.test(s)) { try { s = new URL(s).hostname; } catch (_) { return ''; } }
  return s.toLowerCase().replace(/\.$/, '');
}

// Le righe dei file tsv: host, marchio imitato ('-' se nessuno), nota.
function leggiTsv(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter((r) => r && !r.startsWith('#')).map((r) => {
    const [h, marchio] = r.split('\t');
    return { h: host(h.includes('/') ? 'https://' + h : h), marchio: marchio && marchio !== '-' ? marchio : null };
  });
}

// Fra i candidati di una truffa, quello che la truffa imita: il marchio scritto a mano se c'è, se no il più evidente.
const ORDINE = ['omografo', 'sosia', 'esatto', 'dentro', 'sosiadentro', 'typo', 'typodentro'];
function principale(es, marchio) {
  if (marchio) return es.find((e) => e.c.mc.token === marchio) || es.find((e) => e.c.mc.brand.display === (es.find((x) => x.c.mc.token === marchio) || {}).display) || null;
  return [...es].sort((a, b) => ORDINE.indexOf(a.c.tipo) - ORDINE.indexOf(b.c.tipo)
    || b.c.mc.token.length - a.c.mc.token.length || (a.c.zona === 'sld' ? -1 : 1))[0];
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

function costruisci() {
  const prova = new Set(leggiTsv(PROVA).map((r) => r.h));
  const scritte = new Map(leggiTsv(ETICHETTE).map((r) => [r.h, r]));
  const etichetta = new Map();
  const conflitto = new Set();
  for (const f of FONTI) {
    const file = path.join(DATI, f.file);
    if (!fs.existsSync(file)) throw new Error(`manca ${file}: lancia prima con --scarica`);
    const visti = new Map();
    for (const riga of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const h = host(riga);
      if (!h) continue;
      if (f.etichetta === 0) {
        // Dei siti noti bastano pochi nomi per dominio: i mille server di un CDN non sono mille siti.
        const reg = h.split('.').slice(-2).join('.');
        const k = visti.get(reg) || 0;
        if (k >= 4) continue;
        visti.set(reg, k + 1);
      }
      const prima = etichetta.get(h);
      if (prima !== undefined && prima !== f.etichetta) conflitto.add(h);
      etichetta.set(h, f.etichetta);
    }
  }
  for (const h of conflitto) etichetta.delete(h);
  const gruppi = [];
  const aggiungi = (h, y, marchio, fonte) => {
    if (prova.has(h)) return;
    const norm = normalize('https://' + h + '/');
    const es = IM.esempi(norm);
    if (!es.length) return;
    const mask = (1 << BIT) - 1;
    if (y === 1) {
      const e = principale(es, marchio);
      if (!e) return;
      gruppi.push({ h, y, fonte, ix: [indici(e.feats, mask)], marchio: e.c.mc.token });
    } else gruppi.push({ h, y, fonte, ix: es.map((e) => indici(e.feats, mask)) });
  };
  for (const [h, y] of etichetta) if (!scritte.has(h)) aggiungi(h, y, null, 'elenco');
  for (const [h, r] of scritte) aggiungi(h, r.marchio ? 1 : 0, r.marchio, 'mano');
  return gruppi;
}

function provaModello() {
  const righe = leggiTsv(PROVA);
  const m = { ok: 0, presi: 0, truffe: 0, falsi: [], noti: 0, marchioSbagliato: [] , persi: [] };
  for (const r of righe) {
    const v = IM.giudica(normalize('https://' + r.h + '/'));
    if (r.marchio) {
      m.truffe++;
      if (v) { m.presi++; if (v.brand.token !== r.marchio && v.brand.display !== (require('./src/main/services/safebrowse/brands.js').BRANDS.find((b) => b.token === r.marchio) || {}).display) m.marchioSbagliato.push(`${r.h} ${r.marchio}→${v.brand.token}`); } else m.persi.push(r.h);
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

async function principale_() {
  if (process.argv.includes('--scarica')) await scarica();
  if (process.argv.includes('--solo-prova')) { provaModello(); return; }
  const t0 = Date.now();
  const gruppi = costruisci();
  console.log(`esempi: ${gruppi.filter((g) => g.y === 1).length} imitazioni, ${gruppi.filter((g) => g.y === 0).length} siti noti (${Date.now() - t0} ms)`);
  // Un decimo da parte per scegliere la soglia su nomi che il modello non ha visto.
  const caso = rng(11);
  const parte = gruppi.map(() => caso() < 0.1);
  const esempiDi = (gg) => gg.flatMap((g) => (g.y === 1 ? [{ ix: g.ix[0], y: 1 }] : g.ix.map((ix) => ({ ix, y: 0 }))));
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
  delete require.cache[require.resolve('./src/main/services/safebrowse/imitazioni.js')];
  provaModello();
}

principale_().catch((e) => { console.error(e); process.exit(1); });
