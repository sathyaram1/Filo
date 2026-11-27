// La trascrizione di un audio o di un video intero (#1815): dal tasto destro (#1660, in streaming nel riquadro della
// risposta) e dalla chat (#519, TRASCRIVI_MEDIA). Il main non decodifica media che non ha prodotto lui: lo fa una finestra
// nascosta e isolata con SN_TRASCRIVI_MEDIA; ogni pezzo va al modello della dettatura, con la sua politica.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('../../shared/dictationSegmenter.js');
require('../../shared/trascriviMedia.js');
const { safeFetch, leggiTesto } = require('./safe-fetch');

const T = globalThis.SN_TRASCRIVI_MEDIA;
const A = () => globalThis.SN_CONST.ACTIONS;

// Due pezzi insieme dimezzano l'attesa senza costare di più (il modello si paga a secondo d'audio); dopo un «troppe
// richieste» si va avanti uno alla volta.
const PARALLELI = 2;
const RITENTA_429 = 3;
// Il riquadro chiede la sorgente subito dopo il clic: un'ora basta anche a uno strato freddo, e libera la memoria.
const SCADENZA_MS = 60 * 60 * 1000;
const IN_ATTESA_MAX = 4;
const RICORDATE_MAX = 5;
const PARTE_BYTE = 4 * 1024 * 1024;
const HTML_MAX = 2 * 1024 * 1024;
const DECODIFICA_MS = 10 * 60 * 1000;

// I siti che mandano il video a segmenti (o protetto): il file non esiste, e scaricare la pagina non lo dà.
const STREAMING = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|vimeo\.com|twitch\.tv|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|netflix\.com|primevideo\.com|disneyplus\.com|raiplay\.it|mediasetinfinity\.mediaset\.it|spotify\.com|dailymotion\.com|x\.com|twitter\.com)$/i;
const ESTENSIONE_MEDIA = /\.(mp3|wav|wave|ogg|oga|opus|m4a|aac|flac|weba|webm|mp4|m4v|mov|mkv|3gp|amr)(?:$|[?#])/i;

const MEDIA = new Map();
const RICORDATE = new Map();

const errore = (code, message) => T.errore(code, message);
const comeRisposta = (e) => ({ ok: false, code: e.code || 'UNKNOWN', error: e.message || String(e) });

function pulisci() {
  const ora = Date.now();
  for (const [id, v] of MEDIA) if (v.scade < ora) MEDIA.delete(id);
}

// Dal content script: i byte di un blob: letto nella pagina, o l'indirizzo da scaricare per conto della scheda.
function prepara(msg, sender) {
  pulisci();
  const m = msg || {};
  let voce = null;
  if (typeof m.base64 === 'string' && m.base64) {
    const byte = Buffer.from(m.base64, 'base64');
    if (byte.length > T.MAX_BYTE) return comeRisposta(T.troppoGrande(byte.length));
    if (byte.length) voce = { byte };
  } else if (/^https?:\/\//i.test(String(m.url || '').trim()) && sender && sender.wc) {
    voce = { url: String(m.url).trim(), politiche: require('./handlers/misc').politicheDi(m), sender };
  }
  if (!voce) return comeRisposta(errore('MEDIA_ILLEGGIBILE', 'Questo audio non si può leggere: la pagina non dà il file.'));
  const id = crypto.randomBytes(16).toString('hex');
  MEDIA.set(id, { ...voce, scade: Date.now() + SCADENZA_MS });
  while (MEDIA.size > IN_ATTESA_MAX) MEDIA.delete(MEDIA.keys().next().value);
  return { ok: true, id };
}

// Scaricato come «Salva audio come» (sessione della scheda, Referer ridotto), su un file temporaneo e col tetto.
async function byteDallaScheda({ sender, url, politiche }, signal) {
  const { app } = require('electron');
  const { fetchToFile } = require('./handlers/misc');
  const tmp = path.join(app.getPath('temp'), `filo-media-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  let troppo = 0;
  try {
    await fetchToFile({
      sender, url, politiche, kind: 'audio',
      onHeaders: ({ totalBytes }) => { if (totalBytes > T.MAX_BYTE) troppo = totalBytes; return tmp; },
      onProgress: (ricevuti) => { if (ricevuti > T.MAX_BYTE) troppo = ricevuti; },
      shouldStop: () => troppo > 0 || !!(signal && signal.aborted),
    });
    return await fs.promises.readFile(tmp);
  } catch (e) {
    if (troppo) throw T.troppoGrande(troppo);
    throw errore('MEDIA_ILLEGGIBILE', `L'audio non si scarica (${(e && e.message) || 'errore'}): forse è protetto o la pagina non è più aperta.`);
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
}

// Il corpo di una risposta, fermandosi al tetto: chi lo supera riceve il numero, non un file a metà.
async function byteDellaRisposta(res) {
  const dichiarati = parseInt(res.headers.get('content-length'), 10);
  if (dichiarati > T.MAX_BYTE) {
    try { await res.body?.cancel?.(); } catch (_) {}
    throw T.troppoGrande(dichiarati);
  }
  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if (!reader) return Buffer.alloc(0);
  const parti = [];
  let tot = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    tot += value.length;
    if (tot > T.MAX_BYTE) {
      try { await reader.cancel(); } catch (_) {}
      throw T.troppoGrande(tot);
    }
    parti.push(Buffer.from(value));
  }
  return Buffer.concat(parti);
}

function entro(promessa, ms, motivo) {
  let timer;
  const scadenza = new Promise((_, rej) => { timer = setTimeout(() => rej(errore('MEDIA_ILLEGGIBILE', motivo)), ms); });
  return Promise.race([promessa, scadenza]).finally(() => clearTimeout(timer));
}

let fonteDellaPagina = '';
function fonte() {
  if (!fonteDellaPagina) {
    const shared = path.join(__dirname, '..', '..', 'shared');
    fonteDellaPagina = ['dictationSegmenter.js', 'trascriviMedia.js'].map((f) => fs.readFileSync(path.join(shared, f), 'utf8')).join('\n;\n');
  }
  return fonteDellaPagina;
}

// La finestra nascosta riceve i byte a pezzi, decodifica, e tiene i campioni: i WAV dei pezzi li dà uno alla volta.
async function conDecodificatore(byte, lavoro) {
  const { BrowserWindow } = require('electron');
  const win = new BrowserWindow({
    show: false, width: 64, height: 64, skipTaskbar: true, focusable: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'filo-decodifica', backgroundThrottling: false },
  });
  try {
    const wc = win.webContents;
    await entro(win.loadURL('data:text/html;charset=utf-8,'), 15000, 'Il decodificatore audio non è partito.');
    await wc.executeJavaScript(`${fonte()}\n;window.__parti = []; 0`);
    for (let i = 0; i < byte.length; i += PARTE_BYTE) {
      const b64 = byte.subarray(i, i + PARTE_BYTE).toString('base64');
      await wc.executeJavaScript(`(() => { const s = atob(${JSON.stringify(b64)}); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); __parti.push(u); return 0; })()`);
    }
    const info = await entro(wc.executeJavaScript(`(async () => {
      const T = SN_TRASCRIVI_MEDIA;
      const tot = __parti.reduce((s, p) => s + p.length, 0);
      const b = new Uint8Array(tot);
      let o = 0;
      for (const p of __parti) { b.set(p, o); o += p.length; }
      window.__parti = null;
      try { window.__c = await T.decodifica(b); } catch (e) { return { errore: { code: e.code || 'MEDIA_ILLEGGIBILE', message: e.message || '' } }; }
      window.__p = T.pezzi(window.__c, T.RATE);
      return { secondi: window.__c.length / T.RATE, pezzi: window.__p.length };
    })()`), DECODIFICA_MS, 'La decodifica dell\'audio non è finita in tempo.');
    if (!info || info.errore) throw errore((info && info.errore.code) || 'MEDIA_ILLEGGIBILE', (info && info.errore.message) || 'Il file non contiene un audio che si possa leggere.');
    const pezzo = (i) => entro(wc.executeJavaScript(`SN_TRASCRIVI_MEDIA.wavDelPezzo(window.__c, SN_TRASCRIVI_MEDIA.RATE, window.__p[${Number(i)}])`), 60000, 'Un pezzo dell\'audio non si è preparato in tempo.');
    return await lavoro({ ...info, pezzo });
  } finally {
    try { win.destroy(); } catch (_) {}
  }
}

const troppeRichieste = (e) => Number(e && e.status) === 429 || /\b429\b|rate.?limit|too many requests/i.test(String((e && e.message) || ''));
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// I pezzi al modello, al più PARALLELI insieme; il testo esce in ordine. Un errore ferma: quello già uscito resta.
async function trascriviPezzi({ totale, pezzo, origin, signal, onAvanzamento, onTesto }) {
  const Modello = require('./chiamateModello');
  const testi = new Array(totale);
  let prossimo = 0;
  let usciti = 0;
  let fatti = 0;
  let paralleli = PARALLELI;
  let costEur = 0;
  let fermo = null;
  const consegna = () => {
    while (usciti < totale && testi[usciti] !== undefined) {
      try { if (onTesto) onTesto(testi[usciti], usciti); } catch (_) {}
      usciti++;
    }
  };
  const uno = async (i) => {
    const audioBase64 = await pezzo(i);
    for (let tentativo = 0; ; tentativo++) {
      try {
        return await Modello.handleAIRequest({ action: A().TRANSCRIBE_AUDIO, payload: { audioBase64, format: 'wav' }, origin, signal });
      } catch (e) {
        if (!troppeRichieste(e) || tentativo >= RITENTA_429 || (signal && signal.aborted)) throw e;
        paralleli = 1;
        await pausa(2000 * (tentativo + 1));
      }
    }
  };
  const lavoratore = async (k) => {
    while (!fermo && prossimo < totale && k < paralleli) {
      if (signal && signal.aborted) { fermo = errore('ABORTED', 'Trascrizione fermata.'); return; }
      const i = prossimo++;
      try {
        const r = await uno(i);
        testi[i] = String((r && r.text) || '').trim();
        costEur += Number(r && r.costEur) || 0;
        fatti++;
        try { if (onAvanzamento) onAvanzamento(fatti, totale); } catch (_) {}
        consegna();
      } catch (e) {
        fermo = fermo || e;
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLELI }, (_, k) => lavoratore(k)));
  if (fermo) throw fermo;
  return { testo: testi.filter(Boolean).join('\n\n'), costEur };
}

// Il riquadro della risposta: `meta` porta modello e avanzamento, `delta` il testo pezzo dopo pezzo.
async function inStreaming({ payload, origin, signal, onDelta, onMeta }) {
  const voce = MEDIA.get(String((payload && payload.mediaId) || ''));
  if (!voce) throw errore('MEDIA_SCADUTO', 'Questa trascrizione non è più disponibile: chiedi di nuovo «Trascrivi» sull\'audio.');
  MEDIA.delete(payload.mediaId);
  const { model, provider } = await require('./chiamateModello').controllaTrascrizione();
  const meta = (m) => { try { if (onMeta) onMeta(m); } catch (_) {} };
  meta({ model, provider, avanzamento: { fase: 'leggo' } });
  const byte = voce.byte || await byteDallaScheda(voce, signal);
  return conDecodificatore(byte, async ({ secondi, pezzi, pezzo }) => {
    const lunga = durata(secondi);
    meta({ avanzamento: { fatti: 0, totale: pezzi, durata: lunga } });
    let primo = true;
    const r = await trascriviPezzi({
      totale: pezzi, pezzo, origin, signal,
      onAvanzamento: (fatti, totale) => meta({ avanzamento: { fatti, totale, durata: lunga } }),
      onTesto: (t) => {
        if (!t || !onDelta) return;
        onDelta(primo ? t : `\n\n${t}`);
        primo = false;
      },
    });
    return { costEur: r.costEur, model, provider, vuota: !r.testo, secondi };
  });
}

// ── La chat (#519) ───────────────────────────────────────────────────────────

// Iniettabile nelle prove: quello vero rifiuta gli indirizzi della rete locale, compreso il mini server.
const _dip = { scarica: safeFetch };

function durata(s) {
  const t = Math.round(Number(s) || 0);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function suggerimentoStreaming(url) {
  let host = '';
  try { host = new URL(url).hostname; } catch (_) {}
  const yt = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(host);
  return {
    errore: 'streaming',
    frase: `Il video di ${host || 'questa pagina'} arriva a segmenti o protetto: il file non si può scaricare, quindi non lo posso ascoltare.`,
    alternativa: yt
      ? 'Su YouTube la trascrizione della pagina, quando c\'è, la legge LEGGI_PAGINA su questo indirizzo: proponila all\'utente.'
      : 'Se la pagina ha sottotitoli o una trascrizione scritta, LEGGI_PAGINA la può leggere: proponilo all\'utente.',
  };
}

const NON_MEDIA = (url) => ({
  errore: 'non_media',
  frase: `${url} non è un audio o un video, e la pagina non ne contiene uno che si possa scaricare.`,
  alternativa: 'Se l\'utente intendeva il testo della pagina, LEGGI_PAGINA lo legge.',
});

// Il primo audio o video diretto che una pagina dichiara (og:audio/og:video, <audio>, <video>, <source>).
function mediaNellaPagina(html, base) {
  const trovati = [];
  const meta = /<meta\b[^>]*(?:property|name)\s*=\s*["'](?:og:(?:audio|video)(?::(?:url|secure_url))?|twitter:player:stream)["'][^>]*>/gi;
  for (const m of String(html).matchAll(meta)) {
    const c = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(m[0]);
    if (c) trovati.push(c[1]);
  }
  for (const m of String(html).matchAll(/<(?:audio|video|source)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) trovati.push(m[1]);
  for (const t of trovati) {
    try {
      const u = new URL(t.replace(/&amp;/g, '&'), base);
      if (/^https?:$/.test(u.protocol) && !/\.(m3u8|mpd)(?:$|[?#])/i.test(u.pathname)) return u.href;
    } catch (_) {}
  }
  return '';
}

function schedaConIndirizzo(url) {
  const { BrowserWindow } = require('electron');
  const pulito = (u) => String(u || '').replace(/#.*$/, '').replace(/\/$/, '');
  for (const w of BrowserWindow.getAllWindows()) {
    const t = (w._filoTabs?.tabs || []).find((x) => pulito(x.url) === pulito(url));
    if (t && t.view && t.view.webContents && !t.view.webContents.isDestroyed()) return { tab: t, win: w };
  }
  return null;
}

// Il media della scheda: quello che suona, o il più lungo; i byte di un blob: li legge la pagina, un indirizzo il main.
const CODICE_SCHEDA = `(async () => {
  const els = Array.from(document.querySelectorAll('video, audio')).filter((e) => e.currentSrc || e.src || e.querySelector('source[src]'));
  if (!els.length) return { nessuno: true };
  const peso = (e) => (e.paused ? 0 : 1e12) + (isFinite(e.duration) ? e.duration * 1000 : 0) + e.clientWidth * e.clientHeight;
  const el = els.sort((a, b) => peso(b) - peso(a))[0];
  const src = el.currentSrc || el.src || el.querySelector('source[src]').src;
  if (/^https?:/i.test(src)) return { src };
  try {
    const r = await fetch(src);
    const b = new Uint8Array(await r.arrayBuffer());
    if (b.length > ${T.MAX_BYTE}) return { troppo: b.length };
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return { base64: btoa(s) };
  } catch (_) { return { streaming: true }; }
})()`;

async function byteDellIndirizzo(url) {
  const aperta = schedaConIndirizzo(url);
  if (aperta) {
    const wc = aperta.tab.view.webContents;
    let r = null;
    try { r = await entro(wc.executeJavaScriptInIsolatedWorld(1837, [{ code: CODICE_SCHEDA }]), 120000, 'La pagina non ha dato l\'audio in tempo.'); } catch (_) { r = null; }
    if (r && r.base64) return { byte: Buffer.from(r.base64, 'base64'), da: 'scheda' };
    if (r && r.troppo) throw T.troppoGrande(r.troppo);
    if (r && r.streaming) return { esito: suggerimentoStreaming(url) };
    if (r && r.src) return { byte: await byteDallaScheda({ sender: { wc, url: wc.getURL(), win: aperta.win }, url: r.src, politiche: [] }), da: 'scheda' };
    // Una scheda senza media si tratta come l'indirizzo: forse è un file servito da una pagina che lo mostra.
  }
  let host = '';
  try { host = new URL(url).hostname; } catch (_) { return { esito: { errore: 'indirizzo', frase: `«${url}» non è un indirizzo web.` } }; }
  let res;
  try { res = await _dip.scarica(url, { headers: { accept: 'audio/*,video/*,*/*;q=0.8' } }); } catch (e) {
    return { esito: { errore: 'scaricamento', frase: `${url} non si scarica (${(e && e.message) || 'errore di rete'}).` } };
  }
  if (!res.ok) {
    try { await res.body?.cancel?.(); } catch (_) {}
    return { esito: STREAMING.test(host) ? suggerimentoStreaming(url) : { errore: 'scaricamento', frase: `${url} risponde ${res.status}: il file non si scarica.` } };
  }
  const tipo = String(res.headers.get('content-type') || '').toLowerCase();
  const media = /^(audio|video)\//.test(tipo) || /^application\/(ogg|octet-stream)/.test(tipo) || (!tipo && ESTENSIONE_MEDIA.test(url));
  if (media) return { byte: await byteDellaRisposta(res), da: 'indirizzo' };
  if (STREAMING.test(host)) { try { await res.body?.cancel?.(); } catch (_) {} return { esito: suggerimentoStreaming(url) }; }
  if (/html|xml/.test(tipo)) {
    const { testo } = await leggiTesto(res, HTML_MAX);
    const dentro = mediaNellaPagina(testo, res.url || url);
    if (dentro && dentro !== url) {
      let r2;
      try { r2 = await _dip.scarica(dentro, { headers: { accept: 'audio/*,video/*,*/*;q=0.8' } }); } catch (_) { r2 = null; }
      if (r2 && r2.ok) return { byte: await byteDellaRisposta(r2), da: 'pagina', media: dentro };
      try { await r2?.body?.cancel?.(); } catch (_) {}
    }
    return { esito: NON_MEDIA(url) };
  }
  try { await res.body?.cancel?.(); } catch (_) {}
  return { esito: NON_MEDIA(url) };
}

async function trascriviIndirizzo(url, { origin } = {}) {
  await require('./chiamateModello').controllaTrascrizione();
  const preso = await byteDellIndirizzo(url);
  if (preso.esito) return preso.esito;
  return conDecodificatore(preso.byte, async ({ secondi, pezzi, pezzo }) => {
    const r = await trascriviPezzi({ totale: pezzi, pezzo, origin });
    return { testo: r.testo, secondi, pezzi, da: preso.da, ...(preso.media ? { media: preso.media } : {}) };
  });
}

// L'azione TRASCRIVI_MEDIA: { url, da } → l'esito per il modello. Il testo lungo torna a tratti, come una pagina.
async function perLaChat({ url, da = 0, origin = '' }) {
  const indirizzo = String(url || '').trim();
  if (!indirizzo) return { executed: false, kept: true, output: { errore: 'indirizzo', frase: 'Manca l\'indirizzo dell\'audio o del video da trascrivere.' } };
  let r = RICORDATE.get(indirizzo);
  if (!r) {
    try {
      r = await trascriviIndirizzo(indirizzo, { origin });
    } catch (e) {
      return { executed: false, kept: true, output: { errore: (e && e.code) || 'trascrizione', frase: (e && e.message) || 'La trascrizione non è riuscita.' } };
    }
    if (r.errore) return { executed: false, kept: true, output: r };
    RICORDATE.set(indirizzo, r);
    while (RICORDATE.size > RICORDATE_MAX) RICORDATE.delete(RICORDATE.keys().next().value);
  }
  const inizio = Math.max(0, Math.min(r.testo.length, Number(da) || 0));
  const tratto = r.testo.slice(inizio, inizio + TESTO_MAX);
  const seguito = inizio + tratto.length < r.testo.length ? inizio + tratto.length : null;
  const output = {
    trascritto: url, durata: durata(r.secondi), pezzi: r.pezzi, fonte: r.da,
    ...(r.media ? { media: r.media } : {}),
    trascrizione: tratto || '',
    ...(r.testo ? {} : { nota: 'Nell\'audio non si sente parlato.' }),
    ...(seguito !== null ? { seguito, nota: `Il testo continua: richiama con da: ${seguito}.` } : {}),
  };
  return { executed: true, kept: true, output };
}

const API = { prepara, inStreaming, perLaChat, trascriviPezzi, mediaNellaPagina, _dip, _media: MEDIA, _ricordate: RICORDATE };
globalThis.SN_TRASCRIVI_MEDIA_MAIN = API;
module.exports = API;
