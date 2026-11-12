// I pezzi vecchi del filo (#868): ogni scambio più vecchio della finestra ha un vettore, fatto una volta sola dal
// modello d'indicizzazione della Cronologia (ARCHIVE_EMBED, stessa politica sui modelli). Una domanda ripesca i più
// vicini. I vettori stanno in un file accanto al filo e se ne vanno con la loro chat; l'incognito non ne fa.

'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const Disco = require('../shim/storage');

const FC = () => globalThis.SN_FILO_CONTESTO;
const FILE = 'ricordi.jsonl';
const BLOCCO = 32;
const IN_PARALLELO = 3;
// Quanto la domanda aspetta l'indice degli scambi appena usciti dalla finestra; il resto continua dietro.
const ATTESA_INDICE_MS = 1500;

// Quello che serve dal resto dell'app (handlers.js): i vettori passano dal router come per la Cronologia.
const app = { vettori: null, quantizza: null, coseno: null };
function collega(f) { Object.assign(app, f || {}); }

function file() {
  const F = globalThis.SN_IL_FILO;
  if (F && typeof F.percorso === 'function') return path.join(path.dirname(F.percorso()), FILE);
  const root = process.env.FILO_USER_DATA || require('electron').app.getPath('userData');
  return path.join(root, 'filo', FILE);
}

let indice = null;
let caricando = null;
function carica() {
  if (indice) return Promise.resolve(indice);
  if (!caricando) {
    caricando = (async () => {
      const m = new Map();
      let testo = '';
      try { testo = await fsp.readFile(file(), 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      for (const r of testo.split('\n')) {
        if (!r.trim()) continue;
        try {
          const v = JSON.parse(r);
          if (v && typeof v.k === 'string' && typeof v.c === 'string' && typeof v.m === 'string' && Array.isArray(v.v)) m.set(v.k, v);
        } catch (_) {}
      }
      indice = m;
      return m;
    })();
    caricando.catch(() => { caricando = null; });
  }
  return caricando;
}

let coda = Promise.resolve();
function inCoda(fn) {
  const r = coda.then(fn, fn);
  coda = r.then(() => {}, () => {});
  return r;
}

function aggiungi(voci) {
  return inCoda(async () => {
    await fsp.mkdir(path.dirname(file()), { recursive: true });
    await fsp.appendFile(file(), voci.map((v) => JSON.stringify(v) + '\n').join(''), 'utf8');
  });
}

function riscrivi() {
  return inCoda(async () => {
    const righe = [...indice.values()].map((v) => JSON.stringify(v) + '\n').join('');
    await fsp.mkdir(path.dirname(file()), { recursive: true });
    const tmp = file() + '.tmp';
    await fsp.writeFile(tmp, righe, 'utf8');
    await fsp.rename(tmp, file());
  });
}

// Le cancellazioni arrivate mentre un giro d'indicizzazione ha già in mano i testi: quel giro non li manda più al
// modello e non ne scrive i vettori (privacy: cancellare una chat cancella anche il suo indice).
const tolte = new Set();
let epoca = 0;

// Una chat cancellata porta via anche i suoi vettori; senza id, tutti.
async function dimentica(chat) {
  if (Disco.inIncognito()) return;
  if (chat) tolte.add(chat); else epoca++;
  await carica().catch(() => null);
  if (!indice) return;
  let tolti = 0;
  for (const [k, v] of [...indice]) if (!chat || v.c === chat) { indice.delete(k); tolti++; }
  if (tolti) await riscrivi();
}

let corsa = null;
// Un solo giro d'indicizzazione alla volta: chi arriva mentre gira aspetta quello.
// `e0`: l'epoca in cui i testi sono stati letti dal filo, così una pulizia arrivata dopo vale anche per loro.
function indicizza(tratti, modello, e0 = epoca) {
  if (corsa) return corsa;
  corsa = (async () => {
    const vivo = (t) => epoca === e0 && !tolte.has(t.chat);
    const blocchi = [];
    for (let i = 0; i < tratti.length; i += BLOCCO) blocchi.push(tratti.slice(i, i + BLOCCO));
    let prossimo = 0;
    const lavora = async () => {
      while (prossimo < blocchi.length) {
        const b = blocchi[prossimo++].filter(vivo);
        if (!b.length) continue;
        let emb = null;
        try { emb = await app.vettori(b.map((t) => FC().testoPerIndice(t))); } catch (_) { return; }
        if (!emb || emb.model !== modello || !Array.isArray(emb.vectors)) return;
        const nuove = [];
        b.forEach((t, i) => {
          const v = emb.vectors[i];
          if (!Array.isArray(v) || !v.length || !vivo(t)) return;
          const voce = { k: t.chiave, c: t.chat, m: modello, v: app.quantizza(v) };
          indice.set(t.chiave, voce);
          nuove.push(voce);
        });
        if (nuove.length) await aggiungi(nuove);
      }
    };
    await Promise.all(Array.from({ length: Math.min(IN_PARALLELO, blocchi.length) }, lavora));
  })().finally(() => { corsa = null; });
  return corsa;
}

// Senza un modello d'indicizzazione vale per parole (regola in src/shared/filoContesto.js).
function perParole(domanda, tratti) {
  return FC().ricordiPerParole(domanda, tratti);
}

// `vecchi`: i messaggi del filo più vecchi della finestra. `davanti`: quelli che il modello ha già, che non si ripescano;
// `esiti`: le azioni i cui esiti ha davanti, con i pezzi già ripescati e le conversazioni rilette intere (#868.1).
async function cerca(domanda, { vecchi = [], davanti = [], esiti = [] } = {}) {
  const q = String(domanda || '').trim();
  const e0 = epoca;
  if (!q || Disco.inIncognito() || !vecchi.length) return [];
  const gia = new Set(davanti.map((m) => `${m.chat}|${m.ts}`));
  const giaRipescati = FC().giaDavanti(esiti);
  const tratti = FC().tratti(vecchi).filter((t) => !gia.has(t.chiave) && !giaRipescati.chiavi.has(t.chiave) && !giaRipescati.chat.has(t.chat));
  if (!tratti.length) return [];
  let emb = null;
  try { emb = app.vettori ? await app.vettori([q]) : null; } catch (_) { emb = null; }
  const qv = emb && emb.vectors && emb.vectors[0];
  if (!Array.isArray(qv) || !qv.length) return perParole(q, tratti);
  await carica();
  const modello = emb.model;
  const mancano = tratti.filter((t) => { const v = indice.get(t.chiave); return !v || v.m !== modello; });
  if (mancano.length) {
    let timer = null;
    await Promise.race([
      indicizza(mancano, modello, e0).catch(() => {}),
      new Promise((ok) => { timer = setTimeout(ok, ATTESA_INDICE_MS); }),
    ]);
    clearTimeout(timer);
  }
  const vq = app.quantizza(qv);
  const punteggi = [];
  for (const t of tratti) {
    const v = indice.get(t.chiave);
    if (v && v.m === modello) punteggi.push({ tratto: t, score: app.coseno(vq, v.v) });
  }
  return FC().scegliRicordi(punteggi);
}

// Per le prove: il file e la memoria ripartono da zero.
function azzera() {
  indice = null;
  caricando = null;
}

module.exports = { collega, cerca, dimentica, indicizza, carica, azzera, file };
globalThis.SN_RICORDI_FILO = module.exports;
