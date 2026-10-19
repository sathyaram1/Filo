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
  const firma = `${incog ? 'i' : 'n'}|${dati.pos}|${cambi.length}|${cambi.map((c) => `${c.id}${c.annullatoDa ? '~' : ''}`).join(',').slice(-4000)}`;
  if (memo && memo.firma === firma) return memo;
  memo = { firma, dati, cambi, elementi: C().elementi({ chats: dati.chats, pagine: dati.pagine, cambi, qui: dati.qui }) };
  return memo;
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
  const { dati, elementi } = await tutte(opts);
  const r = C().pezzo(elementi, { prima, fino, dopo, quanti });
  const ultimo = elementi.length ? elementi[elementi.length - 1] : null;
  const out = {
    elementi: conFoto(r.elementi, dati.chats),
    inizio: r.inizio,
    ultimo: ultimo ? (ultimo.fine || ultimo.ts) : null,
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

async function cerca(q, opts) {
  const { dati } = await tutte(opts);
  let schede = [];
  try { schede = await globalThis.SN_ARCHIVED_TABS.list(); } catch (_) { schede = []; }
  return C().cerca({ chats: dati.chats, pagine: dati.pagine, schede }, q);
}

// Una pagina tolta dal filo: si cerca per id fra quelle che il filo ha, mai con ora e indirizzo mandati dalla pagina.
// La cancellazione copre la sua ora esatta e il suo sito, quindi porta via lei e il titolo che si era data dopo.
async function togliPagine(ids, opts) {
  const voluti = new Set((Array.isArray(ids) ? ids : []).map(String));
  if (!voluti.size) return 0;
  const tutte0 = await F().pagine(null, opts);
  let tolte = 0;
  for (const p of tutte0) {
    if (!voluti.has(String(p.id))) continue;
    tolte += await F().cancellaPagine({ da: p.ts, a: p.ts, sito: C().sito(p.url), url: p.url }, opts);
  }
  return tolte;
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

module.exports = { pezzo, chatCorrente, siFonde, serveGiornata, cerca, togliPagine, togliIndirizzo };
globalThis.SN_CODA_FILO = module.exports;
