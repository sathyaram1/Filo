// Le fonti della ricerca di un segnaposto del correttore (#1448): Wikipedia e Wikidata, gratis, poi il web di Filo.
// Non decide se cercare né cosa: lo fa handlers/ai.js. La lingua di Wikipedia passa da una lista, mai un indirizzo
// scritto dal modello. Prove: tests/unit/fontiSegnaposto.test.mjs.
'use strict';

const TIMEOUT_MS = 6000;
const LINGUE = /^[a-z]{2,3}$/;
const TESTO_MAX = 6000;
const DATI_MAX = 40;
const AGENTE = 'Filo-correttore/1.0';

const radiceWikipedia = (lingua) => `https://${lingua}.wikipedia.org`;
const WIKIDATA = 'https://www.wikidata.org';

async function leggiJson(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': AGENTE, 'Api-User-Agent': AGENTE } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

const parole = (s) => String(s || '').toLowerCase().match(/[\p{L}\p{N}]{3,}|\d+/gu) || [];

// I paragrafi che parlano della domanda, nell'ordine della pagina, con l'inizio sempre dentro: il dato che serve sta
// di rado nella prima riga di una voce lunga.
function passaggi(testo, domanda, max = TESTO_MAX) {
  const blocchi = String(testo || '').split(/\n+/).map((b) => b.trim()).filter((b) => b && !/^=+.*=+$/.test(b));
  if (!blocchi.length) return '';
  const cercate = new Set(parole(domanda));
  const punti = blocchi.map((b, i) => {
    const qui = new Set(parole(b));
    let n = 0;
    for (const p of cercate) if (qui.has(p)) n++;
    return { i, n: n + (/\d/.test(b) ? 0.5 : 0) };
  });
  const scelti = new Set([0]);
  let lunghezza = blocchi[0].length;
  for (const { i, n } of punti.slice(1).sort((a, b) => b.n - a.n || a.i - b.i)) {
    if (n < 1 || lunghezza + blocchi[i].length > max) continue;
    scelti.add(i);
    lunghezza += blocchi[i].length;
  }
  return [...scelti].sort((a, b) => a - b).map((i) => blocchi[i]).join('\n').slice(0, max);
}

// Un valore di Wikidata come si legge: quantità con l'unità, date alla loro precisione.
function valoreWikidata(dv, etichette) {
  if (!dv || typeof dv !== 'object') return '';
  if (dv.type === 'quantity' && dv.value) {
    const n = String(dv.value.amount || '').replace(/^\+/, '');
    const u = /\/(Q\d+)$/.exec(String(dv.value.unit || ''));
    return u && etichette[u[1]] ? `${n} ${etichette[u[1]]}` : n;
  }
  if (dv.type === 'time' && dv.value) return dataWikidata(dv.value);
  return '';
}
function dataWikidata(v) {
  const m = /^([+-]?\d+)-(\d\d)-(\d\d)/.exec(String((v && v.time) || ''));
  if (!m) return '';
  const anno = String(Number(m[1]));
  const p = Number(v.precision);
  if (p >= 11) return `${anno}-${m[2]}-${m[3]}`;
  if (p === 10) return `${anno}-${m[2]}`;
  return anno;
}

// Le dichiarazioni numeriche e di data di un elemento: per ogni proprietà la preferita, o la più recente.
function datiWikidata(claims) {
  const out = [];
  for (const [prop, lista] of Object.entries(claims || {})) {
    if (!/^P\d+$/.test(prop) || !Array.isArray(lista)) continue;
    const buone = lista.filter((c) => c && c.rank !== 'deprecated' && c.mainsnak && c.mainsnak.datavalue
      && ['quantity', 'time'].includes(c.mainsnak.datavalue.type));
    if (!buone.length) continue;
    const quando = (c) => dataWikidata(c.qualifiers?.P585?.[0]?.datavalue?.value);
    const scelta = buone.find((c) => c.rank === 'preferred')
      || [...buone].sort((a, b) => quando(b).localeCompare(quando(a)))[0];
    out.push({ prop, dv: scelta.mainsnak.datavalue, al: quando(scelta) });
    if (out.length >= DATI_MAX) break;
  }
  return out;
}

function righeWikidata(dati, etichette) {
  return dati.map((d) => {
    const v = valoreWikidata(d.dv, etichette);
    return v ? `${etichette[d.prop] || d.prop}: ${v}${d.al ? ` (al ${d.al})` : ''}` : '';
  }).filter(Boolean).join('\n');
}

async function wikidata(q, lingua) {
  if (!/^Q\d+$/.test(String(q || ''))) return null;
  const e = (await leggiJson(`${WIKIDATA}/wiki/Special:EntityData/${q}.json`))?.entities?.[q];
  const dati = datiWikidata(e && e.claims);
  if (!dati.length) return null;
  const unita = dati.map((d) => /\/(Q\d+)$/.exec(String(d.dv?.value?.unit || ''))?.[1]).filter(Boolean);
  const ids = [...new Set([...dati.map((d) => d.prop), ...unita])].slice(0, 50);
  const etichette = {};
  try {
    const l = await leggiJson(`${WIKIDATA}/w/api.php?action=wbgetentities&format=json&props=labels&ids=${ids.join('|')}&languages=${lingua}|en`);
    for (const [id, x] of Object.entries(l?.entities || {})) etichette[id] = x?.labels?.[lingua]?.value || x?.labels?.en?.value || '';
  } catch (_) {}
  const nome = e?.labels?.[lingua]?.value || e?.labels?.en?.value || q;
  const testo = righeWikidata(dati, etichette);
  return testo ? { titolo: `Wikidata: ${nome}`, sito: new URL(WIKIDATA).hostname, url: `${WIKIDATA}/wiki/${q}`, data: '', testo } : null;
}

// Le due voci più vicine alla domanda, coi paragrafi che ne parlano, più i numeri di Wikidata della prima.
async function wikipedia(domanda, lingua = 'en') {
  const l = LINGUE.test(String(lingua)) ? lingua : 'en';
  const q = String(domanda || '').trim().slice(0, 200);
  if (!q) return [];
  const base = radiceWikipedia(l);
  const cerca = await leggiJson(`${base}/w/api.php?action=query&list=search&format=json&formatversion=2&srlimit=2&srprop=&srsearch=${encodeURIComponent(q)}`);
  const titoli = (cerca?.query?.search || []).map((s) => s && s.title).filter((x) => typeof x === 'string').slice(0, 2);
  const voci = await Promise.all(titoli.map(async (titolo) => {
    try {
      const d = await leggiJson(`${base}/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=extracts|pageprops|revisions&explaintext=1&ppprop=wikibase_item&rvprop=timestamp&titles=${encodeURIComponent(titolo)}`);
      const p = d?.query?.pages?.[0];
      if (!p || !p.extract) return null;
      return {
        titolo: `Wikipedia: ${p.title}`, sito: `${l}.wikipedia.org`,
        url: `${base}/wiki/${encodeURIComponent(String(p.title).replace(/ /g, '_'))}`,
        data: String(p.revisions?.[0]?.timestamp || '').slice(0, 10),
        testo: passaggi(p.extract, q), q: p.pageprops?.wikibase_item,
      };
    } catch (_) { return null; }
  }));
  const fonti = voci.filter(Boolean);
  if (fonti[0]) {
    try { const w = await wikidata(fonti[0].q, l); if (w) fonti.push(w); } catch (_) {}
  }
  return fonti.map(({ q: _q, ...f }) => f);
}

// I risultati della ricerca web di Filo (Tavily, o DuckDuckGo senza chiave) come fonti.
async function web(domanda, tavilyKey) {
  const WS = globalThis.SN_WEB_SEARCH;
  if (!WS) return [];
  const q = String(domanda || '').trim().slice(0, 200);
  if (!q) return [];
  // Una ricerca non riuscita non è «nessun risultato»: chi chiama la dice fallita e lascia riprovare.
  const r = await WS.search({ query: q, tavilyKey, maxResults: 5 });
  if (!r || !r.ok) throw new Error(`ricerca web non riuscita: ${(r && r.reason) || 'nessuna risposta'}`);
  return (r.results || []).filter((x) => x && /^https:\/\//i.test(String(x.url || '')) && (x.snippet || x.title)).map((x) => {
    let sito = '';
    try { sito = new URL(x.url).hostname.replace(/^www\./, ''); } catch (_) {}
    return { titolo: String(x.title || sito), sito, url: String(x.url), data: '', testo: String(x.snippet || '') };
  });
}

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
function giorno(d) {
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? '' : `${d.getDate()} ${MESI[d.getMonth()]} ${d.getFullYear()}`;
  const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(d || ''));
  return m ? `${Number(m[3])} ${MESI[Number(m[2]) - 1]} ${m[1]}` : '';
}

// La riga del modello [valore][motivo][numero della fonte][data] ricomposta con la fonte vera: il nome e l'indirizzo
// li mette il codice, così il motivo non cita una fonte che non c'era. Senza la data del dato vale quella della voce,
// o per il web il giorno della ricerca. Vuota se il dato non si è trovato.
function ricomponi(raw, fonti, oggi = new Date()) {
  for (const riga of String(raw || '').split(/\r?\n/)) {
    const r = riga.trim();
    if (!r.startsWith('[') || !r.endsWith(']')) continue;
    const [valore = '', motivo = '', numero = '', data = ''] = r.slice(1, -1).split(/\]\s*\[/).map((x) => x.replace(/[[\]]/g, '').trim());
    if (!valore || /^nessuno$/i.test(data) || /xx/i.test(valore)) return '';
    const f = fonti[Number.parseInt(numero, 10) - 1];
    if (!f) return '';
    const nome = /^Wiki(?:pedia|data):/.test(f.titolo) ? f.titolo : (f.sito || f.titolo);
    const quando = data || (f.data ? `voce del ${giorno(f.data)}` : `cercato il ${giorno(oggi)}`);
    return `[${valore}][${motivo}][${nome}][${quando}][${f.url}]`;
  }
  return '';
}

// Dove si cerca, in ordine: prima le fonti gratuite, il web (che costa) solo se è acceso e quelle non bastano. Un dato di
// adesso va dritto al web; col web spento si prova lo stesso Wikipedia.
function giri(dove, webAcceso) {
  const wiki = /^wiki:[a-z]{2,3}$/.test(String(dove)) ? dove : 'wiki:en';
  if (dove === 'web') return [webAcceso ? 'web' : 'wiki:en'];
  return webAcceso ? [wiki, 'web'] : [wiki];
}

const API = { wikipedia, web, passaggi, datiWikidata, righeWikidata, dataWikidata, ricomponi, giorno, giri, LINGUE };
globalThis.SN_FONTI_SEGNAPOSTO = API;
module.exports = API;
