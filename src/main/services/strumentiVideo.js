// I programmi che salvano i video in streaming (#1488): yt-dlp e ffmpeg, presi al primo salvataggio nella cartella
// dati di Filo e tenuti aggiornati. Nessun file entra senza il suo controllo: la firma degli autori per yt-dlp,
// l'hash fissato in ytdlp.js per ffmpeg. Prove: tests/unit/strumentiVideo.test.mjs.

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const Y = require('./ytdlp');
const Firma = require('./firmaPgp');

// Quando YouTube cambia, un yt-dlp vecchio smette di funzionare: si guarda se ce n'è uno nuovo una volta al giorno,
// e subito quando un errore lo fa pensare.
const CONTROLLO_MS = 24 * 3600 * 1000;

function errore(motivo, messaggio) {
  const e = new Error(messaggio || motivo);
  e.motivo = motivo;
  return e;
}

// `scarica(url)` → { totale, corpo: AsyncIterable<Uint8Array> }; in Electron la dà netFetch qui sotto.
// `verificaFirma` e `hashFfmpeg` si cambiano solo nelle prove, che non hanno la chiave privata degli autori.
function crea({ cartella, scarica, platform = process.platform, arch = process.arch, ora = Date.now,
  verificaFirma = Firma.verifica, hashFfmpeg = Y.FFMPEG_SHA256 }) {
  const fileStato = path.join(cartella, 'stato.json');
  const exe = platform === 'win32' ? '.exe' : '';
  let inCorso = null;

  const leggiStato = () => { try { return JSON.parse(fs.readFileSync(fileStato, 'utf8')) || {}; } catch (_) { return {}; } };
  const scriviStato = (s) => {
    const tmp = `${fileStato}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
    fs.renameSync(tmp, fileStato);
  };
  const esiste = (p) => { try { return !!p && fs.statSync(p).isFile(); } catch (_) { return false; } };
  const dentro = (nome) => path.join(cartella, path.basename(String(nome || '')));

  async function piccolo(url) {
    const r = await scarica(url);
    const parti = [];
    let n = 0;
    for await (const c of r.corpo) {
      n += c.length;
      // SHA2-256SUMS e la sua firma pesano pochi KB: oltre il mega è un'altra cosa.
      if (n > 1024 * 1024) throw errore('programma', `risposta troppo grande da ${url}`);
      parti.push(Buffer.from(c));
    }
    return Buffer.concat(parti);
  }

  // Scrive il file a pezzi accanto alla destinazione e lo sposta al suo posto solo se l'hash torna.
  async function grande(url, dest, atteso, { gzip = false, avanza }) {
    const r = await scarica(url);
    avanza(0, r.totale || 0);
    const tmp = `${dest}.${process.pid}.parziale`;
    const h = crypto.createHash('sha256');
    const out = fs.createWriteStream(tmp, { mode: 0o755 });
    const gz = gzip ? zlib.createGunzip() : null;
    if (gz) gz.pipe(out);
    const scrivi = gz || out;
    const finito = new Promise((ok, ko) => { out.on('finish', ok); out.on('error', ko); if (gz) gz.on('error', ko); });
    let ricevuti = 0;
    try {
      for await (const c of r.corpo) {
        const b = Buffer.from(c);
        h.update(b);
        ricevuti += b.length;
        avanza(ricevuti, r.totale || 0);
        if (!scrivi.write(b)) await new Promise((ok) => scrivi.once('drain', ok));
      }
      scrivi.end();
      await finito;
      if (h.digest('hex') !== atteso) throw errore('firma', `hash diverso da quello atteso per ${path.basename(dest)}`);
      if (platform !== 'win32') fs.chmodSync(tmp, 0o755);
      fs.renameSync(tmp, dest);
    } catch (e) {
      try { scrivi.destroy(); } catch (_) {}
      try { fs.unlinkSync(tmp); } catch (_) {}
      throw e;
    }
  }

  async function sommeFirmate() {
    const [somme, firma] = await Promise.all([
      piccolo(`${Y.RILASCIO_YTDLP}SHA2-256SUMS`), piccolo(`${Y.RILASCIO_YTDLP}SHA2-256SUMS.sig`),
    ]);
    if (!verificaFirma(somme, firma)) throw errore('firma', 'SHA2-256SUMS di yt-dlp senza una firma valida');
    return Y.leggiSomme(somme.toString('utf8'));
  }

  async function ytdlp(stato, forza, avanza) {
    const asset = Y.assetYtdlp(platform, arch);
    if (!asset) throw errore('piattaforma', `nessun yt-dlp per ${platform}-${arch}`);
    const attuale = stato.ytdlp && esiste(dentro(stato.ytdlp.file)) ? dentro(stato.ytdlp.file) : '';
    if (attuale && !forza && ora() - (Number(stato.ytdlp.controllatoIl) || 0) < CONTROLLO_MS) return attuale;
    let somme;
    try {
      somme = await sommeFirmate();
    } catch (e) {
      // Senza rete quello che c'è basta; una firma che non torna invece non si scavalca, ma il vecchio resta buono.
      if (attuale) return attuale;
      throw e.motivo ? e : errore('programma', e.message);
    }
    const hash = somme.get(asset);
    if (!hash) throw errore('programma', `${asset} manca da SHA2-256SUMS`);
    if (attuale && stato.ytdlp.sha256 === hash) {
      stato.ytdlp.controllatoIl = ora();
      return attuale;
    }
    // Un nome per versione: su Windows un salvataggio in corso tiene aperto il vecchio, che non si sovrascrive.
    const file = `yt-dlp-${hash.slice(0, 12)}${exe}`;
    await grande(`${Y.RILASCIO_YTDLP}${asset}`, dentro(file), hash, { avanza });
    const vecchio = stato.ytdlp && stato.ytdlp.file;
    stato.ytdlp = { file, sha256: hash, controllatoIl: ora() };
    if (vecchio && vecchio !== file) { try { fs.unlinkSync(dentro(vecchio)); } catch (_) {} }
    return dentro(file);
  }

  async function ffmpeg(stato, avanza) {
    const asset = Y.assetFfmpeg(platform, arch);
    if (!asset) return '';
    const hash = hashFfmpeg[asset];
    if (!hash) return '';
    const file = `ffmpeg-${Y.FFMPEG_VERSIONE}${exe}`;
    if (stato.ffmpeg && stato.ffmpeg.sha256 === hash && esiste(dentro(file))) return dentro(file);
    await grande(`${Y.RILASCIO_FFMPEG}${asset}`, dentro(file), hash, { gzip: true, avanza });
    stato.ffmpeg = { file, sha256: hash };
    return dentro(file);
  }

  // → { ytdlp, ffmpeg } (ffmpeg '' dove non c'è una build). `avanza({ ricevuti, totale })` solo se scende qualcosa.
  // Due salvataggi insieme aspettano lo stesso scaricamento, e lo vedono avanzare tutti e due.
  const ascolta = new Set();
  async function pronti({ forza = false, avanza = null } = {}) {
    if (avanza) ascolta.add(avanza);
    try {
      if (!inCorso) {
        inCorso = (async () => {
          fs.mkdirSync(cartella, { recursive: true });
          const stato = leggiStato();
          const pezzi = new Map();
          const somma = (k) => (r, t) => {
            pezzi.set(k, [r, t]);
            const v = [...pezzi.values()];
            const ricevuti = v.reduce((s, p) => s + p[0], 0);
            // Un peso ignoto rende falsa la percentuale: la barra gira senza numero.
            const totale = v.every((p) => p[1] > 0) ? v.reduce((s, p) => s + p[1], 0) : 0;
            for (const f of ascolta) { try { f({ ricevuti, totale }); } catch (_) {} }
          };
          try {
            const [y, f] = await Promise.all([ytdlp(stato, forza, somma('y')), ffmpeg(stato, somma('f'))]);
            return { ytdlp: y, ffmpeg: f };
          } catch (e) {
            // Una rete che cade a metà non ha un motivo suo: per l'utente è il programma che non è arrivato.
            throw e && e.motivo ? e : errore('programma', e && e.message);
          } finally {
            try { scriviStato(stato); } catch (_) {}
          }
        })().finally(() => { inCorso = null; });
      }
      return await inCorso;
    } finally {
      if (avanza) ascolta.delete(avanza);
    }
  }

  return { pronti };
}

// Lo scaricamento passa dalla rete di Chromium: proxy e certificati del sistema valgono come per le pagine.
async function netFetch(url) {
  const { net } = require('electron');
  const r = await net.fetch(url, { redirect: 'follow', cache: 'no-store' });
  if (!r.ok || !r.body) throw errore('programma', `HTTP ${r.status} da ${url}`);
  const totale = Number(r.headers.get('content-length')) || 0;
  const reader = r.body.getReader();
  const corpo = {
    async* [Symbol.asyncIterator]() {
      for (;;) { const { done, value } = await reader.read(); if (done) return; yield value; }
    },
  };
  return { totale, corpo };
}

let predefinito = null;
function strumenti() {
  if (!predefinito) {
    const { app } = require('electron');
    predefinito = crea({ cartella: path.join(app.getPath('userData'), 'programmi-video'), scarica: netFetch });
  }
  return predefinito;
}

module.exports = { crea, strumenti, CONTROLLO_MS };
