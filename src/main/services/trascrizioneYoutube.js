// La trascrizione di un video di YouTube (quella di «Mostra trascrizione») per la lettura della pagina e per l'Aiuto
// (#1977), presa appena la pagina del video è pronta. Non trascrive l'audio e non legge i video di altri siti.
// Prove: tests/unit/trascrizioneYoutube.test.mjs e tests/trascrizione-youtube.spec.mjs.

// Un video di tre ore (~30.000 parole, coi tempi ~200.000 caratteri) sta intero; oltre si tengono testa e coda.
const TETTO_CARATTERI = 300000;
const TEMPO_RICHIESTA_MS = 15000;
const TEMPO_TOTALE_MS = 40000;
const MAX_RISPOSTA = 30 * 1024 * 1024;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 30;
const MONDO_ISOLATO = 1837;
const HOST_VIDEO = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com']);
const ORIGINE = 'https://www.youtube.com';

function idVideo(indirizzo) {
  let u;
  try { u = new URL(String(indirizzo || '')); } catch (_) { return ''; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
  const host = u.hostname.toLowerCase();
  let id = '';
  if (host === 'youtu.be') id = u.pathname.split('/')[1] || '';
  else if (HOST_VIDEO.has(host)) {
    if (u.pathname === '/watch') id = u.searchParams.get('v') || '';
    else {
      const m = /^\/(?:shorts|live)\/([^/]+)/.exec(u.pathname);
      if (m) id = m[1];
    }
  }
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
}

// Il JSON che segue `marcatore` nell'HTML, contando le graffe fuori dalle stringhe: dopo l'oggetto la pagina
// continua con altro codice, e una regex si fermerebbe al primo `};` scritto dentro una descrizione.
function estraiJson(html, marcatore) {
  const testo = String(html || '');
  let i = testo.indexOf(marcatore);
  while (i >= 0) {
    const inizio = testo.indexOf('{', i + marcatore.length);
    if (inizio < 0) return null;
    const tra = testo.slice(i + marcatore.length, inizio);
    if (/^[\s=:]*$/.test(tra)) {
      let prof = 0;
      let inStringa = false;
      for (let k = inizio; k < testo.length; k++) {
        const c = testo[k];
        if (inStringa) {
          if (c === '\\') k++;
          else if (c === '"') inStringa = false;
        } else if (c === '"') inStringa = true;
        else if (c === '{') prof++;
        else if (c === '}' && --prof === 0) {
          try { return JSON.parse(testo.slice(inizio, k + 1)); } catch (_) { return null; }
        }
      }
      return null;
    }
    i = testo.indexOf(marcatore, i + marcatore.length);
  }
  return null;
}

const linguaBase = (c) => String(c || '').toLowerCase().split('-')[0];

// La lingua del video la dice la traccia automatica (il parlato); se c'è anche una caricata a mano in quella lingua,
// vince lei. Senza traccia automatica, quella che YouTube mostrerebbe di suo.
function scegliTraccia(renderer) {
  const lista = renderer && Array.isArray(renderer.captionTracks) ? renderer.captionTracks : [];
  const tracce = lista.filter((t) => t && typeof t.baseUrl === 'string' && t.baseUrl);
  if (!tracce.length) return null;
  const auto = tracce.find((t) => t.kind === 'asr');
  if (auto) return tracce.find((t) => t.kind !== 'asr' && linguaBase(t.languageCode) === linguaBase(auto.languageCode)) || auto;
  const audio = Array.isArray(renderer.audioTracks) ? renderer.audioTracks[0] : null;
  const n = audio && Number.isInteger(audio.defaultCaptionTrackIndex) ? audio.defaultCaptionTrackIndex : -1;
  return (n >= 0 && lista[n] && lista[n].baseUrl) ? lista[n] : tracce[0];
}

// Solo un indirizzo di YouTube: la traccia la scrive la pagina, e la richiesta parte dalla pagina o dal main.
function urlDiYoutube(grezzo) {
  let u;
  try { u = new URL(String(grezzo || ''), ORIGINE); } catch (_) { return null; }
  if (u.protocol !== 'https:' || !HOST_VIDEO.has(u.hostname.toLowerCase())) return null;
  return u;
}

function decodificaEntita(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_m, n) => { const c = Number(n); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ''; })
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => { const c = parseInt(n, 16); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ''; })
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// I segmenti `{ ms, t }` dalla risposta della traccia: json3 (quella chiesta), oppure l'XML che YouTube manda
// quando il formato chiesto non lo onora (srv1 coi secondi, srv3 coi millesimi).
function segmentiDaTraccia(testo) {
  const s = String(testo || '').trim();
  if (!s) return [];
  if (s[0] === '{') {
    let j;
    try { j = JSON.parse(s); } catch (_) { return []; }
    const eventi = Array.isArray(j && j.events) ? j.events : [];
    return eventi
      .filter((e) => e && Array.isArray(e.segs))
      .map((e) => ({ ms: Number(e.tStartMs) || 0, t: e.segs.map((g) => (g && typeof g.utf8 === 'string' ? g.utf8 : '')).join('') }));
  }
  const out = [];
  const re = /<text\b[^>]*\bstart="([\d.]+)"[^>]*>([\s\S]*?)<\/text>|<p\b[^>]*\bt="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(s))) {
    const ms = m[1] !== undefined ? Math.round(Number(m[1]) * 1000) : Number(m[3]);
    const corpo = m[1] !== undefined ? m[2] : m[4];
    out.push({ ms: Number.isFinite(ms) ? ms : 0, t: decodificaEntita(corpo.replace(/<[^>]*>/g, '')) });
  }
  return out;
}

// La risposta del pannello «Mostra trascrizione»: i segmenti stanno annidati in profondità, e la forma cambia.
function segmentiDaPannello(j) {
  const out = [];
  const visti = new Set();
  const visita = (o, prof) => {
    if (!o || typeof o !== 'object' || prof > 40 || visti.has(o)) return;
    visti.add(o);
    const seg = o.transcriptSegmentRenderer;
    if (seg && typeof seg === 'object') {
      const sn = seg.snippet || {};
      const t = Array.isArray(sn.runs) ? sn.runs.map((r) => (r && typeof r.text === 'string' ? r.text : '')).join('')
        : (typeof sn.simpleText === 'string' ? sn.simpleText : (typeof sn.content === 'string' ? sn.content : ''));
      out.push({ ms: Number(seg.startMs) || 0, t });
      return;
    }
    for (const v of Array.isArray(o) ? o : Object.values(o)) visita(v, prof + 1);
  };
  visita(j, 0);
  return out;
}

function tempo(ms) {
  const s = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// Una riga ogni venti secondi circa, col suo tempo: i segmenti di YouTube durano un paio di secondi, e un tempo
// per ognuno raddoppierebbe la lunghezza senza dire niente in più.
function righeDa(segmenti) {
  const righe = [];
  let cur = null;
  for (const s of segmenti) {
    const t = String(s.t || '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (!cur || cur.testo.length >= 200 || s.ms - cur.ms >= 20000) {
      cur = { ms: s.ms, testo: t };
      righe.push(cur);
    } else cur.testo += ` ${t}`;
  }
  return righe;
}

// Oltre il tetto si tengono la testa e la coda, e nel mezzo una riga dice cosa manca: mai un taglio muto.
function componi(righe, tetto = TETTO_CARATTERI) {
  const linee = righe.map((r) => `[${tempo(r.ms)}] ${r.testo}`);
  const totale = linee.reduce((n, l) => n + l.length + 1, 0);
  if (totale <= tetto) return { testo: linee.join('\n'), salto: null };
  const meta = Math.floor(tetto / 2);
  let a = 0;
  let usati = 0;
  while (a < linee.length && usati + linee[a].length + 1 <= meta) usati += linee[a++].length + 1;
  let b = linee.length;
  usati = 0;
  while (b > a && usati + linee[b - 1].length + 1 <= meta) usati += linee[--b].length + 1;
  const mancano = linee.slice(a, b).reduce((n, l) => n + l.length + 1, 0);
  const salto = { da: tempo(righe[a].ms), a: b < righe.length ? tempo(righe[b].ms) : 'la fine', righe: b - a, caratteri: mancano };
  const nota = `[… qui mancano ${salto.righe} righe della trascrizione (${mancano} caratteri), da ${salto.da} a ${salto.a} …]`;
  return { testo: [...linee.slice(0, a), nota, ...linee.slice(b)].join('\n'), salto };
}

function nomeLingua(codice) {
  const c = String(codice || '');
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(c)) return '';
  try { return new Intl.DisplayNames(['it'], { type: 'language' }).of(c) || c; } catch (_) { return c; }
}

/**
 * La trascrizione del video `id`. `scarica(url, { metodo, corpo })` → `{ ok, stato, testo }`: dalla pagina (coi suoi
 * accessi) o dal main. Esito `{ stato: 'ok', testo, lingua, automatica, salto }`, `{ stato: 'assente' }` (YouTube non
 * ne ha una) o `{ stato: 'errore', motivo }`.
 */
async function prendi(scarica, id) {
  const pagina = await scarica(`${ORIGINE}/watch?v=${id}`, {});
  if (!pagina || !pagina.ok) return { stato: 'errore', motivo: 'la pagina del video non si è caricata' };
  const html = String(pagina.testo || '');
  const lettore = estraiJson(html, 'ytInitialPlayerResponse');
  const renderer = lettore && lettore.captions && lettore.captions.playerCaptionsTracklistRenderer;
  const traccia = scegliTraccia(renderer);
  const m = /"getTranscriptEndpoint"\s*:\s*\{\s*"params"\s*:\s*"([^"]+)"/.exec(html);
  const parametri = m ? m[1] : '';
  let segmenti = [];
  const u = traccia && urlDiYoutube(traccia.baseUrl);
  if (u) {
    u.searchParams.set('fmt', 'json3');
    const r = await scarica(u.href, {});
    if (r && r.ok) segmenti = segmentiDaTraccia(r.testo);
  }
  // YouTube a volte consegna la traccia vuota senza un gettone che solo il suo lettore sa fare: il pannello no.
  if (!righeDa(segmenti).length && parametri) {
    const chiave = (/"INNERTUBE_API_KEY"\s*:\s*"([A-Za-z0-9_-]+)"/.exec(html) || [])[1] || '';
    const versione = (/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([0-9.]+)"/.exec(html) || [])[1] || '2.20240101.00.00';
    const contesto = estraiJson(html, '"INNERTUBE_CONTEXT"') || { client: { clientName: 'WEB', clientVersion: versione } };
    const r = await scarica(`${ORIGINE}/youtubei/v1/get_transcript?prettyPrint=false${chiave ? `&key=${chiave}` : ''}`,
      { metodo: 'POST', corpo: JSON.stringify({ context: contesto, params: parametri }) });
    if (r && r.ok) {
      try { segmenti = segmentiDaPannello(JSON.parse(r.testo)); } catch (_) { segmenti = []; }
    }
  }
  const righe = righeDa(segmenti);
  if (righe.length) {
    return { stato: 'ok', ...componi(righe), lingua: nomeLingua(traccia && traccia.languageCode), automatica: !!(traccia && traccia.kind === 'asr') };
  }
  if (!lettore) return { stato: 'errore', motivo: 'YouTube ha mandato una pagina senza i dati del video' };
  const stato = lettore.playabilityStatus && lettore.playabilityStatus.status;
  if (!traccia && !parametri) {
    if (stato && stato !== 'OK') return { stato: 'errore', motivo: 'YouTube non mostra questo video da qui (serve l\'accesso, o non è disponibile)' };
    return { stato: 'assente' };
  }
  return { stato: 'errore', motivo: 'YouTube non ha consegnato la trascrizione' };
}

const cache = new Map();
function inCorso(id, avvia) {
  const c = cache.get(id);
  if (c && Date.now() - c.t <= CACHE_TTL_MS) return c.promessa;
  const promessa = conScadenza(Promise.resolve().then(avvia), TEMPO_TOTALE_MS)
    .catch(() => ({ stato: 'errore', motivo: 'YouTube non ha risposto in tempo' }));
  cache.delete(id);
  cache.set(id, { t: Date.now(), promessa });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  // Un errore si riprova alla prossima domanda: la rete o la pagina possono essere tornate.
  promessa.then((e) => { const v = cache.get(id); if (e.stato === 'errore' && v && v.promessa === promessa) cache.delete(id); });
  return promessa;
}

function conScadenza(promessa, ms) {
  let t;
  const scade = new Promise((_r, no) => { t = setTimeout(() => no(new Error('scaduto')), ms); if (t.unref) t.unref(); });
  return Promise.race([promessa, scade]).finally(() => clearTimeout(t));
}

// Gira nella pagina del video, nel mondo isolato: la richiesta parte dalla sua origine coi suoi accessi, come quella
// del pannello di YouTube.
function richiestaNellaPagina(o) {
  const ferma = new AbortController();
  const t = setTimeout(() => ferma.abort(), o.tempo);
  const init = { method: o.metodo, credentials: 'same-origin', signal: ferma.signal };
  if (o.corpo) { init.body = o.corpo; init.headers = { 'content-type': 'application/json' }; }
  return fetch(o.percorso, init)
    .then((r) => r.text().then((testo) => (testo.length > o.max
      ? { ok: false, stato: r.status, testo: '' }
      : { ok: r.ok, stato: r.status, testo })))
    .catch(() => ({ ok: false, stato: 0, testo: '' }))
    .finally(() => clearTimeout(t));
}

function sullaPaginaDiYoutube(wc) {
  try {
    if (!wc || wc.isDestroyed()) return false;
    return HOST_VIDEO.has(new URL(wc.getURL()).hostname.toLowerCase());
  } catch (_) { return false; }
}

function scaricaDallaPagina(wc) {
  return async (url, { metodo = 'GET', corpo = '' } = {}) => {
    const u = urlDiYoutube(url);
    if (!u || !sullaPaginaDiYoutube(wc)) return { ok: false, stato: 0, testo: '' };
    const o = { percorso: u.pathname + u.search, metodo, corpo, tempo: TEMPO_RICHIESTA_MS, max: MAX_RISPOSTA };
    const codice = `(${richiestaNellaPagina.toString()})(${JSON.stringify(o)})`;
    try {
      const r = await conScadenza(wc.executeJavaScriptInIsolatedWorld(MONDO_ISOLATO, [{ code: codice }]), TEMPO_RICHIESTA_MS + 2000);
      return r && typeof r.testo === 'string' ? r : { ok: false, stato: 0, testo: '' };
    } catch (_) { return { ok: false, stato: 0, testo: '' }; }
  };
}

// La scheda aperta sul video: le richieste partono dalla pagina. Se intanto ha lasciato YouTube, dalla rete.
function perScheda(wc, indirizzo, { scaricaRete = null } = {}) {
  const id = idVideo(indirizzo);
  if (!id) return Promise.resolve(null);
  if (!sullaPaginaDiYoutube(wc)) return scaricaRete ? dallaRete(indirizzo, scaricaRete) : Promise.resolve(null);
  return inCorso(id, () => prendi(scaricaDallaPagina(wc), id));
}

// Senza scheda, dal main: solo GET, senza gli accessi dell'utente. `scaricaGet(url)` → `{ ok, stato, testo }`.
function dallaRete(indirizzo, scaricaGet) {
  const id = idVideo(indirizzo);
  if (!id || typeof scaricaGet !== 'function') return Promise.resolve(null);
  return inCorso(id, () => prendi(async (url, { metodo = 'GET' } = {}) => {
    const u = urlDiYoutube(url);
    if (!u || metodo !== 'GET') return { ok: false, stato: 0, testo: '' };
    try { return await scaricaGet(u.href); } catch (_) { return { ok: false, stato: 0, testo: '' }; }
  }, id));
}

// Appena la pagina di un video è pronta (#1977: l'attesa è attrito). Una pagina che non è un video non costa niente.
function precarica(wc, indirizzo) {
  if (!idVideo(indirizzo)) return;
  perScheda(wc, indirizzo).catch(() => {});
}

function comeTrascrizione(e) {
  const fonte = e.automatica ? 'sottotitoli generati da YouTube' : 'sottotitoli del video';
  return e.lingua ? `${e.lingua}, ${fonte}` : fonte;
}

function frasiDelSalto(e) {
  return e.salto
    ? ` È lunghissima: Filo ne tiene l'inizio e la fine, e manca il tratto da ${e.salto.da} a ${e.salto.a} (una riga nel mezzo lo `
      + 'segna); se ti chiedono di quel tratto, di\' che non lo hai.'
    : '';
}

// La nota di Filo accanto al testo, fuori dalla busta: la scrive Filo con dati suoi, mai con testo della pagina.
// `conPagina`: il testo della pagina comincia con la trascrizione (lettura della chat); senza, è a parte (Aiuto).
function notaPerModello(e, { conPagina = false, fino = 0 } = {}) {
  if (!e) return '';
  if (e.stato === 'ok') {
    const dove = conPagina
      ? `il testo della pagina comincia con la trascrizione del video (${comeTrascrizione(e)}), coi tempi fra quadre, fino al `
        + `carattere ${fino}; dopo c'è il resto della pagina.`
      : `qui sotto c'è la trascrizione del video (${comeTrascrizione(e)}), coi tempi fra quadre: per dire di cosa parla il video `
        + 'usa lei, non il titolo.';
    return `[È la pagina di un video di YouTube: ${dove}${frasiDelSalto(e)}]`;
  }
  if (e.stato === 'assente') {
    return '[È la pagina di un video di YouTube che non ha trascrizione (né sottotitoli caricati né generati da YouTube): del video '
      + 'hai solo titolo, descrizione e il resto della pagina. Se ti chiedono di cosa parla, di\' all\'utente che il video non '
      + 'ha trascrizione e non rispondere come se l\'avessi ascoltato.]';
  }
  return `[È la pagina di un video di YouTube, ma Filo non è riuscito a leggerne la trascrizione (${e.motivo || 'motivo ignoto'}). `
    + 'Se ti chiedono di cosa parla, dillo all\'utente e non rispondere come se l\'avessi letta.]';
}

// Per la lettura della pagina: il testo comincia con la trascrizione, così la prima porzione letta la contiene.
function unisciAllaPagina(letto, e) {
  if (!letto || !e) return letto;
  if (e.stato !== 'ok') return { ...letto, video: { stato: e.stato, nota: notaPerModello(e) } };
  const testa = `Trascrizione del video:\n${e.testo}\n\nResto della pagina:\n`;
  return {
    ...letto,
    testo: `${testa}${String(letto.testo || '')}`,
    video: { stato: 'ok', nota: notaPerModello(e, { conPagina: true, fino: testa.length }) },
  };
}

// Per l'Aiuto: la nota e la trascrizione imbustata come contenuto della pagina (la scrive chi carica il video).
async function perLAiuto(wc) {
  let indirizzo = '';
  try { indirizzo = wc && !wc.isDestroyed() ? wc.getURL() : ''; } catch (_) {}
  if (!idVideo(indirizzo)) return '';
  const e = await perScheda(wc, indirizzo);
  if (!e) return '';
  const nota = notaPerModello(e);
  if (e.stato !== 'ok') return nota;
  const E = globalThis.SN_ESTERNO;
  return `${nota}\n${E.imbustaCampi({
    tipo: 'PAGINA_WEB', campi: { Indirizzo: indirizzo }, corpo: `Trascrizione del video:\n${e.testo}`, max: TETTO_CARATTERI + 4000,
  })}`;
}

module.exports = {
  idVideo, estraiJson, scegliTraccia, segmentiDaTraccia, segmentiDaPannello, righeDa, componi, tempo, prendi,
  perScheda, dallaRete, precarica, notaPerModello, unisciAllaPagina, perLAiuto,
  TETTO_CARATTERI, _cache: cache,
};
