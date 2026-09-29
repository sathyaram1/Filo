// Deposito a sole aggiunte: record con `id`, una riga JSON ciascuno, in un file per mese dentro una cartella propria.
// Aggiungere e aggiornare accodano una riga senza riscrivere niente; togliere riscrive solo i mesi toccati, così il dato sparisce davvero dal disco.
// Regole: patterns/un-archivio-che-cresce-sta-in-file-suoi-a-sole-aggiunte.md (prove: tests/unit/depositoAggiunte.test.mjs).

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const MESE = /^\d{4}-\d{2}$/;
const EST = '.jsonl';

const meseCorrente = () => new Date().toISOString().slice(0, 7);

// Una riga per record: { s: ordine, r: record } alla nascita, { u: id, p: modifica } dopo.
// L'ordine `s` cresce a ogni aggiunta; chi arriva «in coda» (migrazione, importazione) scende sotto il più vecchio.
function creaDeposito({ cartella, meseDi }) {
  const record = new Map(); // id → { r, seq, mese }
  const mesi = new Map();   // mese → { righe }
  let maxSeq = 0;
  let minSeq = 1;
  let elenco = null;

  const fileDi = (mese) => path.join(cartella, mese + EST);

  function meseDelRecord(r) {
    let m = null;
    try { m = meseDi(r); } catch (_) { m = null; }
    return typeof m === 'string' && MESE.test(m) ? m : meseCorrente();
  }

  function accoda(mese, testo) {
    try {
      fs.appendFileSync(fileDi(mese), testo, 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      fs.mkdirSync(cartella, { recursive: true });
      fs.appendFileSync(fileDi(mese), testo, 'utf8');
    }
    const s = mesi.get(mese) || { righe: 0 };
    s.righe += testo.split('\n').length - 1;
    mesi.set(mese, s);
  }

  function viviDel(mese) {
    const out = [];
    for (const [id, v] of record) if (v.mese === mese) out.push([id, v]);
    return out.sort((a, b) => a[1].seq - b[1].seq);
  }

  // Riscrive un mese coi soli record che `scegli` tiene (null = via). Prima il disco, poi la memoria.
  function riscriviMese(mese, scegli) {
    const tenuti = [];
    const via = [];
    for (const [id, v] of viviDel(mese)) {
      const r = scegli(id, v);
      if (r) tenuti.push([v, r]); else via.push(id);
    }
    const file = fileDi(mese);
    if (!tenuti.length) {
      try { fs.unlinkSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      mesi.delete(mese);
    } else {
      const testo = tenuti.map(([v, r]) => JSON.stringify({ s: v.seq, r })).join('\n') + '\n';
      fs.mkdirSync(cartella, { recursive: true });
      fs.writeFileSync(file + '.tmp', testo, 'utf8');
      fs.renameSync(file + '.tmp', file);
      mesi.set(mese, { righe: tenuti.length });
    }
    for (const id of via) record.delete(id);
    for (const [v, r] of tenuti) v.r = r;
    elenco = null;
  }

  // Gli aggiornamenti accodano righe: quando un mese ne ha il doppio dei suoi record lo si ricompatta.
  function compattaSeServe(mese) {
    const s = mesi.get(mese);
    if (!s) return;
    let vivi = 0;
    for (const v of record.values()) if (v.mese === mese) vivi++;
    if (s.righe <= 2 * vivi + 64) return;
    try { riscriviMese(mese, (id, v) => v.r); } catch (e) {
      console.warn('[Filo deposito] compattazione fallita:', e.message || e);
    }
  }

  function leggiMese(mese, testo) {
    const s = mesi.get(mese) || { righe: 0 };
    mesi.set(mese, s);
    for (const riga of testo.replace(/^﻿/, '').split('\n')) {
      if (!riga.trim()) continue;
      s.righe++;
      let o;
      try { o = JSON.parse(riga); } catch (_) { continue; }
      if (!o || typeof o !== 'object') continue;
      if (o.r && typeof o.r === 'object' && typeof o.r.id === 'string' && o.r.id) {
        const seq = Number.isFinite(o.s) ? o.s : maxSeq + 1;
        record.set(o.r.id, { r: o.r, seq, mese });
        if (seq > maxSeq) maxSeq = seq;
        if (seq < minSeq) minSeq = seq;
      } else if (typeof o.u === 'string' && o.p && typeof o.p === 'object') {
        const v = record.get(o.u);
        if (v && v.mese === mese) v.r = { ...v.r, ...o.p };
      }
    }
  }

  async function carica() {
    let nomi;
    try { nomi = await fsp.readdir(cartella); } catch (e) {
      if (e.code === 'ENOENT') return;
      throw e;
    }
    for (const nome of nomi.sort()) {
      // Un .tmp è una riscrittura interrotta prima del rename: fa fede il file intero accanto.
      if (nome.endsWith(EST + '.tmp')) {
        try { fs.unlinkSync(path.join(cartella, nome)); } catch (_) {}
        continue;
      }
      if (!nome.endsWith(EST)) continue;
      const mese = nome.slice(0, -EST.length);
      if (!MESE.test(mese)) continue;
      const testo = await fsp.readFile(fileDi(mese), 'utf8');
      leggiMese(mese, testo);
      // Una riga troncata da un arresto non deve incollarsi alla prossima aggiunta.
      if (testo && !testo.endsWith('\n')) fs.appendFileSync(fileDi(mese), '\n', 'utf8');
    }
    for (const mese of [...mesi.keys()]) compattaSeServe(mese);
    elenco = null;
  }

  function tutti() {
    if (!elenco) elenco = [...record.values()].sort((a, b) => b.seq - a.seq).map((v) => v.r);
    return elenco.slice();
  }

  function prendi(id) {
    const v = record.get(id);
    return v ? v.r : null;
  }

  // Ritorna i record davvero aggiunti: un id già presente non si duplica.
  function aggiungiMolti(lista, { inCoda = false } = {}) {
    const perMese = new Map();
    const visti = new Set();
    for (const r of Array.isArray(lista) ? lista : []) {
      if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) continue;
      if (record.has(r.id) || visti.has(r.id)) continue;
      visti.add(r.id);
      const seq = inCoda ? --minSeq : ++maxSeq;
      if (seq > maxSeq) maxSeq = seq;
      const mese = meseDelRecord(r);
      if (!perMese.has(mese)) perMese.set(mese, []);
      perMese.get(mese).push({ r, seq });
    }
    const aggiunti = [];
    for (const [mese, voci] of perMese) {
      accoda(mese, voci.map((x) => JSON.stringify({ s: x.seq, r: x.r })).join('\n') + '\n');
      for (const x of voci) { record.set(x.r.id, { r: x.r, seq: x.seq, mese }); aggiunti.push(x.r); }
      elenco = null;
    }
    return aggiunti;
  }

  function aggiungi(r, opzioni) {
    return aggiungiMolti([r], opzioni)[0] || null;
  }

  function aggiorna(id, patch) {
    const v = record.get(id);
    if (!v || !patch || typeof patch !== 'object') return null;
    // undefined non sopravvive a JSON: diventa null, così memoria e disco dicono la stessa cosa.
    const p = {};
    for (const k of Object.keys(patch)) if (k !== 'id') p[k] = patch[k] === undefined ? null : patch[k];
    if (!Object.keys(p).length) return v.r;
    accoda(v.mese, JSON.stringify({ u: id, p }) + '\n');
    v.r = { ...v.r, ...p };
    elenco = null;
    compattaSeServe(v.mese);
    return v.r;
  }

  // `ripulisci(record)` può restituire una copia corretta dei record che restano: i loro mesi si riscrivono insieme.
  function togli(ids, ripulisci) {
    const via = new Set((Array.isArray(ids) ? ids : []).filter((id) => record.has(id)));
    if (!via.size) return 0;
    const toccati = new Set([...via].map((id) => record.get(id).mese));
    const sostituti = new Map();
    if (typeof ripulisci === 'function') {
      for (const [id, v] of record) {
        if (via.has(id)) continue;
        const nuovo = ripulisci(v.r);
        if (nuovo && nuovo !== v.r) { sostituti.set(id, nuovo); toccati.add(v.mese); }
      }
    }
    for (const mese of toccati) {
      riscriviMese(mese, (id, v) => (via.has(id) ? null : (sostituti.get(id) || v.r)));
    }
    return via.size;
  }

  function svuota() {
    let nomi = [];
    try { nomi = fs.readdirSync(cartella); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    for (const nome of nomi) {
      if (nome.endsWith(EST) || nome.endsWith(EST + '.tmp')) fs.unlinkSync(path.join(cartella, nome));
    }
    record.clear();
    mesi.clear();
    elenco = null;
  }

  return {
    carica, tutti, prendi, aggiungi, aggiungiMolti, aggiorna, togli, svuota,
    numero: () => record.size,
    cartella: () => cartella,
  };
}

module.exports = { creaDeposito };
