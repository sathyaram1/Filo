// La coda del filo che la home mostra (#869): legge il filo e il registro dei cambi, ne fa le righe e le dà a pezzi.
// Non scrive niente: le righe le decide src/shared/filoCoda.js. Regole: patterns/la-home-e-la-coda-del-filo.md.

const F = () => globalThis.SN_IL_FILO;
const C = () => globalThis.SN_FILO_CODA;

let memo = null;

// Con migliaia di eventi rifare le righe a ogni pezzo costerebbe: si rifanno solo quando il filo o i cambi cambiano.
async function tutte(opts) {
  const dati = await F().perLaCoda(opts);
  let cambi = [];
  try { cambi = await globalThis.SN_REGISTRO_CAMBI.tutti(); } catch (_) { cambi = []; }
  let incog = !!(opts && opts.incognito);
  try { if (!opts || opts.incognito == null) incog = require('../shim/storage').inIncognito(); } catch (_) {}
  // Un ritocco fuso nel cambio di prima non ne cambia né il numero né l'id: lo dice la sua ora (`agg`).
  const firma = `${incog ? 'i' : 'n'}|${dati.pos}|${cambi.length}|${cambi.map((c) => `${c.id}${c.agg || ''}${c.annullatoDa ? '~' : ''}`).join(',').slice(-4000)}`;
  if (memo && memo.firma === firma) return memo;
  const elementi = C().elementi({ chats: dati.chats, pagine: dati.pagine, cambi, qui: dati.qui });
  memo = { firma, dati, cambi, elementi, ultimo: piuRecente(elementi) };
  return memo;
}

// Il più recente non è sempre l'ultimo: un cambio ritoccato sta all'ora del primo ritocco.
function piuRecente(elementi) {
  let ultimo = null;
  let t0 = -Infinity;
  for (const e of elementi) {
    const t = Date.parse(e.fine || e.ts);
    if (t > t0) { t0 = t; ultimo = e.fine || e.ts; }
  }
  return ultimo;
}

// Le foto mandate in chat restano in memoria finché Filo è aperto (#1166): tornano anche nella coda.
function conFoto(elementi, chats) {
  const CF = globalThis.SN_CONTESTO_FILO;
  if (!CF || typeof CF.conFotoInMemoria !== 'function') return elementi;
  const viste = new Map();
  return elementi.map((e) => {
    if (e.k !== 'msg' || e.role !== 'user') return e;
    if (!viste.has(e.chat)) {
      let c = null;
      try { c = CF.conFotoInMemoria(chats.find((x) => x.id === e.chat) || null); } catch (_) { c = null; }
      viste.set(e.chat, c);
    }
    const c = viste.get(e.chat);
    const m = c && c.messages && c.messages[e.i];
    return m && Array.isArray(m.fotoInMemoria) && m.fotoInMemoria.length ? { ...e, fotoInMemoria: m.fotoInMemoria } : e;
  });
}

async function pezzo({ prima = null, fino = null, dopo = null, quanti } = {}, opts) {
  const { dati, elementi, ultimo } = await tutte(opts);
  const r = C().pezzo(elementi, { prima, fino, dopo, quanti });
  const out = {
    elementi: conFoto(r.elementi, dati.chats),
    inizio: r.inizio,
    ultimo,
  };
  if (prima == null && dopo == null && fino == null) {
    const c = C().chatCorrente(dati.chats);
    out.chatCorrente = c ? c.id : null;
  }
  return out;
}

async function chatCorrente(opts) {
  const { dati } = await tutte(opts);
  return C().chatCorrente(dati.chats);
}

async function siFonde(chat, opts) {
  const { dati, cambi } = await tutte(opts);
  return C().siFonde({ chats: dati.chats, pagine: dati.pagine, cambi }, chat);
}

async function serveGiornata(opts) {
  const { dati } = await tutte(opts);
  return C().serveGiornata(dati.chats);
}

// Una frase intera («la discussione di ieri sulla coscienza») non trova niente se pretende ogni parola: allora si cerca
// con le parole che distinguono, come faceva la Cronologia, e la risposta lo dice (`allargata`).
function cercaIn(fonti, q) {
  const r = C().cerca(fonti, q);
  if (r.messaggi.length || r.pagine.length) return r;
  const CA = globalThis.SN_CHAT_ARCHIVE;
  const forti = CA && CA.terminiCheDistinguono ? CA.terminiCheDistinguono(r.termini, q) : [];
  if (!forti.length || forti.length >= r.termini.length) return r;
  const largo = C().cerca(fonti, forti.join(' '), { largo: true });
  if (largo.messaggi.length || largo.pagine.length) return { ...largo, allargata: true };
  // Ultimo passo: almeno una parola che distingue, prima chi ne ha di più.
  const conti = new Map();
  for (const w of forti) {
    const uno = C().cerca(fonti, w, { largo: true });
    for (const v of [...uno.messaggi, ...uno.pagine]) {
      const k = v.k === 'msg' ? `m|${v.chat}|${v.i}` : `p|${v.url}`;
      const c = conti.get(k);
      if (c) c.n += 1; else conti.set(k, { v, n: 1 });
    }
  }
  if (!conti.size) return r;
  const ordine = [...conti.values()].sort((a, b) => b.n - a.n || (Date.parse(b.v.ts) || 0) - (Date.parse(a.v.ts) || 0)).map((x) => x.v);
  const messaggi = ordine.filter((v) => v.k === 'msg');
  const pagine = ordine.filter((v) => v.k !== 'msg');
  return { messaggi: messaggi.slice(0, 40), pagine: pagine.slice(0, 40), termini: forti, tanti: ordine.length, allargata: true };
}

// Le conversazioni nascoste (#1295) non stanno fra i risultati: a parte, una riga per conversazione, per rimetterle.
async function cerca(q, opts) {
  const { dati } = await tutte(opts);
  let schede = [];
  try { schede = await globalThis.SN_ARCHIVED_TABS.list(); } catch (_) { schede = []; }
  const r = cercaIn({ chats: dati.chats, pagine: dati.pagine, schede }, q);
  let nascoste = [];
  try { nascoste = await F().chats({ ...(opts || {}), nascoste: 'solo' }); } catch (_) { nascoste = []; }
  if (!nascoste.length) return r;
  const viste = new Set();
  const trovate = [];
  for (const m of cercaIn({ chats: nascoste }, q).messaggi) {
    if (viste.has(m.chat)) continue;
    viste.add(m.chat);
    const c = nascoste.find((x) => x.id === m.chat);
    trovate.push({ ...m, k: 'nascosta', titolo: (c && c.title) || globalThis.SN_CHAT_ARCHIVE.fallbackTitle((c && c.messages) || []) });
  }
  return trovate.length ? { ...r, nascoste: trovate.slice(0, 20) } : r;
}

// Tutte le conversazioni nascoste, dalla più recente: chi ne ha tolta una e non ricorda di cosa parlava la ritrova qui.
async function nascoste(opts) {
  let tutte = [];
  try { tutte = await F().chats({ ...(opts || {}), nascoste: 'solo' }); } catch (_) { tutte = []; }
  const CA = globalThis.SN_CHAT_ARCHIVE;
  return tutte
    .filter((c) => c && Array.isArray(c.messages) && c.messages.length)
    .map((c) => {
      const i = Math.max(0, c.messages.findIndex((m) => m && String(m.text || '').trim()));
      const m = c.messages[i] || {};
      return { k: 'nascosta', chat: c.id, i, ts: c.closedAt || c.updatedAt || m.ts, role: m.role === 'user' ? 'user' : 'filo', testo: String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 140), titolo: c.title || CA.fallbackTitle(c.messages) };
    })
    .sort((a, b) => (Date.parse(b.ts) || 0) - (Date.parse(a.ts) || 0));
}

// Una pagina tolta dal filo: si cerca per id fra quelle che il filo ha, mai con ora e indirizzo mandati dalla pagina.
// La cancellazione copre la sua ora esatta e il suo sito, quindi porta via lei e il titolo che si era data dopo.
async function togliPagine(ids, opts) {
  const voluti = new Set((Array.isArray(ids) ? ids : []).map(String));
  if (!voluti.size) return 0;
  const visite = (await F().pagine(null, opts)).filter((p) => voluti.has(String(p.id)));
  return visite.length ? F().cancellaVisite(visite.map((p) => ({ ts: p.ts, sito: C().sito(p.url), url: p.url })), opts) : 0;
}

// Una scheda chiusa eliminata dalla Cronologia porta via le sue visite: lo stesso indirizzo, mentre era aperta.
async function togliSchedeChiuse(schede, opts) {
  const perUrl = new Map();
  for (const s of Array.isArray(schede) ? schede : []) {
    if (!s || typeof s.url !== 'string' || !s.url) continue;
    const da = Date.parse(s.openedAt);
    const a = Date.parse(s.closedAt);
    if (!perUrl.has(s.url)) perUrl.set(s.url, []);
    perUrl.get(s.url).push({ da: Number.isFinite(da) ? da : -Infinity, a: Number.isFinite(a) ? a : Infinity });
  }
  if (!perUrl.size) return 0;
  const tutte = await F().pagine(null, opts);
  const via = new Set(tutte.filter((p) => {
    const t = Date.parse(p.ts);
    return (perUrl.get(p.url) || []).some((r) => t >= r.da && t <= r.a);
  }).map((p) => p.id));
  if (!via.size) return 0;
  return F().cancellaVisite(file(tutte, via), opts, { schedeChiuse: false });
}

// Ogni cancellazione resta nel filo per sempre e si ripassa a ogni avvio: «Svuota archivio» non ne scrive una per visita.
// Per sito, una sola per ogni fila di visite da togliere senza in mezzo una da tenere dello stesso sito.
function file(tutte, via) {
  const host = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { return ''; } };
  const delHost = (h, s) => (s.includes('.') ? h === s || h.endsWith(`.${s}`) : h.split('.').includes(s));
  const ordinate = tutte.map((p) => ({ p, h: host(p.url), t: Date.parse(p.ts) }))
    .filter((x) => x.h && Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
  const out = [];
  for (const s of new Set(ordinate.filter((x) => via.has(x.p.id)).map((x) => x.h))) {
    let fila = null;
    for (const x of ordinate) {
      if (!delHost(x.h, s)) continue;
      if (!via.has(x.p.id)) { if (fila) out.push(fila); fila = null; } else if (fila) fila.a = x.p.ts;
      else fila = { ts: x.p.ts, da: x.p.ts, a: x.p.ts, sito: s };
    }
    if (fila) out.push(fila);
  }
  return out;
}

// Dalla ricerca si toglie una pagina, non una visita: tutte le sue visite e le schede chiuse con quell'indirizzo.
async function togliIndirizzo(url, opts) {
  const u = String(url || '');
  if (!u) return 0;
  const ids = (await F().pagine(null, opts)).filter((p) => p.url === u).map((p) => p.id);
  let tolte = ids.length ? await togliPagine(ids, opts) : 0;
  try { tolte += await globalThis.SN_ARCHIVED_TABS.dimenticaPagine({ url: u }); } catch (_) {}
  return tolte;
}

module.exports = { pezzo, chatCorrente, siFonde, serveGiornata, cerca, nascoste, togliPagine, togliIndirizzo, togliSchedeChiuse };
globalThis.SN_CODA_FILO = module.exports;
