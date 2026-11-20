// Le immagini che la chat mette nelle risposte (#2272): trovate sul web (Tavily, Wikimedia Commons) o create da un
// modello. Le scarica e le copia il main, così la pagina mostra solo copie locali e nessun indirizzo scelto dal modello.
// Regole del disegno: src/shared/immaginiRisposta.js. Prove: tests/unit/immaginiDelleRisposte.test.mjs, tests/chat-immagini.spec.mjs.

'use strict';

const { safeFetch } = require('./safe-fetch');
const { tipoImmagine } = require('./iconaScheda');
const Copie = require('./copieIcone');

const TAVILY_URL = 'https://api.tavily.com/search';
const COMMONS_URL = 'https://commons.wikimedia.org/w/api.php';
const ATTESA_RICERCA_MS = 8000;
const ATTESA_IMMAGINE_MS = 10000;
const MAX_QUERY = 300;
// Un carosello pieno senza far aspettare: oltre, le immagini non si guardano.
const QUANTE = 10;
const IN_PARALLELO = 5;
// Una foto vera del web sta sotto qualche MB; una creata da un modello può essere più grossa.
const TETTO_WEB = 6 * 1024 * 1024;
const TETTO_CREATA = 16 * 1024 * 1024;
// Oltre questa larghezza una foto si rimpicciolisce prima di copiarla: in chat non si vede più grande.
const LARGHEZZA_MAX = 1280;
const RASTER = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);
const UA = 'Mozilla/5.0 (compatible; Filo)';

let contatore = 0;
const nuovoId = (p) => `${p}${++contatore}`;

const unaRiga = (s, max) => {
  const t = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; } };

async function conTempo(ms, fn) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fn(ac.signal); } finally { clearTimeout(t); }
}

async function cercaTavily(query, chiave) {
  return conTempo(ATTESA_RICERCA_MS, async (signal) => {
    const data = await globalThis.SN_WEB_SEARCH.richiestaTavily({
      query, apiKey: chiave, maxResults: 5, signal, extra: { include_images: true, include_image_descriptions: true },
    });
    return (Array.isArray(data && data.images) ? data.images : []).map((i) => {
      const url = typeof i === 'string' ? i : (i && i.url) || '';
      return { immagine: url, titolo: unaRiga(i && i.description, 200), sito: host(url) };
    }).filter((v) => /^https?:\/\//i.test(v.immagine));
  });
}

async function cercaCommons(query) {
  const p = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', generator: 'search', gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: '6', gsrlimit: String(QUANTE), prop: 'imageinfo', iiprop: 'url|size|mime', iiurlwidth: '800', origin: '*',
  });
  return conTempo(ATTESA_RICERCA_MS, async (signal) => {
    const r = await fetch(`${COMMONS_URL}?${p}`, { signal, headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
    if (!r.ok) throw new Error(`commons ${r.status}`);
    const data = await r.json();
    const pagine = (data && data.query && Array.isArray(data.query.pages)) ? data.query.pages : [];
    return pagine.sort((a, b) => (a.index || 0) - (b.index || 0)).map((pg) => {
      const ii = Array.isArray(pg.imageinfo) ? pg.imageinfo[0] || {} : {};
      const titolo = String(pg.title || '').replace(/^File:/i, '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' ');
      return {
        immagine: ii.thumburl || ii.url || '', titolo: unaRiga(titolo, 200), sito: 'commons.wikimedia.org',
        pagina: ii.descriptionurl || '', larghezza: ii.thumbwidth || ii.width, altezza: ii.thumbheight || ii.height,
      };
    }).filter((v) => /^https:\/\//i.test(v.immagine));
  });
}

// I byte di un'immagine del web, se lo è davvero: niente reti di casa (safe-fetch), niente oltre il tetto.
async function scaricaByte(url, tetto) {
  return conTempo(ATTESA_IMMAGINE_MS, async (signal) => {
    const res = await dip.scarica(url, { signal, headers: { 'User-Agent': UA, Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' } });
    if (!res || !res.ok || !res.body) return null;
    if (Number(res.headers.get('content-length')) > tetto) return null;
    const lettore = res.body.getReader();
    const pezzi = [];
    let tot = 0;
    for (;;) {
      const { done, value } = await lettore.read();
      if (done) break;
      tot += value.byteLength;
      if (tot > tetto) { try { await lettore.cancel(); } catch (_) {} return null; }
      pezzi.push(Buffer.from(value));
    }
    return Buffer.concat(pezzi);
  });
}

// Una foto troppo larga diventa una JPEG più piccola; se Electron non c'è (le prove) o non la sa leggere, resta com'è.
function rimpicciolita(buf, tipo) {
  if (!(tipo === 'image/jpeg' || tipo === 'image/png') || buf.length < 400 * 1024) return { buf, tipo };
  try {
    const { nativeImage } = require('electron');
    const img = nativeImage.createFromBuffer(buf);
    const { width } = img.getSize();
    if (!width || width <= LARGHEZZA_MAX) return { buf, tipo };
    return { buf: img.resize({ width: LARGHEZZA_MAX, quality: 'good' }).toJPEG(85), tipo: 'image/jpeg' };
  } catch (_) { return { buf, tipo }; }
}

async function copiaDa(buf, tetto) {
  const tipo = buf ? tipoImmagine(buf) : '';
  if (!RASTER.has(tipo)) return '';
  const r = rimpicciolita(buf, tipo);
  return Copie.conserva(r.buf, { tetto });
}

// Quante cose alla volta, nell'ordine dato: l'ordine dei risultati è quello del motore.
async function inFila(voci, n, fn) {
  const out = new Array(voci.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, voci.length) }, async () => {
    while (i < voci.length) { const k = i++; out[k] = await fn(voci[k]).catch(() => null); }
  }));
  return out;
}

// → { ok, provider, immagini: [{ id, src, titolo, sito, pagina?, larghezza?, altezza? }], reason? }
async function cerca(query, { tavilyKey = '' } = {}) {
  const WS = globalThis.SN_WEB_SEARCH;
  const q = String(query || '').trim().slice(0, MAX_QUERY);
  if (!q) return { ok: false, immagini: [], reason: 'ricerca vuota' };
  const pavimento = WS ? WS.riservata(query) : 'ricerca non disponibile';
  if (pavimento) return { ok: false, immagini: [], reason: pavimento, pavimento: true };
  const [daTavily, daCommons] = await Promise.all([
    tavilyKey ? dip.tavily(q, tavilyKey).catch(() => []) : Promise.resolve([]),
    dip.commons(q).catch(() => []),
  ]);
  const candidate = [...daTavily.slice(0, 6), ...daCommons].slice(0, QUANTE + 4);
  const provider = [daTavily.length ? 'tavily' : '', daCommons.length ? 'commons' : ''].filter(Boolean).join('+');
  const copiate = await inFila(candidate, IN_PARALLELO, async (v) => {
    const src = await copiaDa(await scaricaByte(v.immagine, TETTO_WEB), TETTO_WEB);
    return src ? { ...v, src } : null;
  });
  const immagini = copiate.filter(Boolean).slice(0, QUANTE).map((v) => ({
    id: nuovoId('i'), src: v.src, titolo: v.titolo, sito: v.sito,
    ...(v.pagina ? { pagina: v.pagina } : {}),
    ...(v.larghezza ? { larghezza: Number(v.larghezza) } : {}), ...(v.altezza ? { altezza: Number(v.altezza) } : {}),
  }));
  WS.annota(q, provider || 'immagini', immagini.length);
  return { ok: immagini.length > 0, provider, immagini, ...(immagini.length ? {} : { reason: candidate.length ? 'immagini non scaricabili' : 'nessuna immagine trovata' }) };
}

// → { ok, immagini: [{ id, src, titolo, generata: true }], testo?, reason?, costEur? }
async function genera(descrizione, { settings, gate } = {}) {
  const prompt = String(descrizione || '').trim().slice(0, 4000);
  if (!prompt) return { ok: false, immagini: [], reason: 'descrizione vuota' };
  const C = globalThis.SN_CONST;
  if (!C.canServeAction(settings || {}, C.ACTIONS.IMAGE_GEN)) {
    return { ok: false, immagini: [], senzaModello: true, reason: 'nessun modello che crea immagini è impostato' };
  }
  let r;
  try {
    r = await gate.complete({ action: C.ACTIONS.IMAGE_GEN, messages: [{ role: 'user', content: prompt }], modalities: ['image', 'text'] });
  } catch (e) {
    return { ok: false, immagini: [], reason: unaRiga((e && e.message) || e, 400) };
  }
  const srcs = [];
  for (const u of (r && Array.isArray(r.images)) ? r.images.slice(0, 4) : []) {
    const buf = Buffer.from(String(u).replace(/^data:[^,]*;base64,/i, ''), 'base64');
    const src = await copiaDa(buf, TETTO_CREATA).catch(() => '');
    if (src) srcs.push(src);
  }
  const titolo = unaRiga(prompt, 200);
  const immagini = srcs.map((src) => ({ id: nuovoId('g'), src, titolo, generata: true }));
  return {
    ok: immagini.length > 0, immagini, costEur: Number(r && r.costEur) || 0,
    ...(immagini.length ? {} : { reason: 'il modello non ha restituito immagini' }),
    ...(r && r.text ? { testo: unaRiga(r.text, 600) } : {}),
  };
}

// Le prove sostituiscono rete e motori: qui sotto ci sono quelli veri.
const dip = { scarica: safeFetch, tavily: cercaTavily, commons: cercaCommons };

// Le copie che le chat nominano restano; quelle di una chat cancellata se ne vanno.
function registraCopie() {
  Copie.usaCopie('immagini-chat', async () => {
    const FC = globalThis.SN_FILO_CHATS;
    const I = globalThis.SN_IMMAGINI_RISPOSTA;
    if (!FC || !I) throw new Error('chat non pronte');
    const chats = await FC.list({ nascoste: true });
    return chats.flatMap((c) => I.copieDi(c && c.messages));
  });
}
registraCopie();

module.exports = { cerca, genera, _dip: dip, TETTO_WEB, TETTO_CREATA, QUANTE };
if (process.env.NODE_ENV === 'test') globalThis.__filoImmaginiDelleRisposte = module.exports;
