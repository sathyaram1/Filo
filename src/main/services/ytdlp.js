// Logica pura del salvataggio dei video in streaming (#1488): quale programma scaricare, con quali argomenti
// lanciarlo, come leggerne avanzamento ed errori. Niente Electron né disco: chi esegue sta in salvaVideoStreaming.js.
// Prove: tests/unit/ytdlp.test.mjs.

'use strict';

const RILASCIO_YTDLP = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';

// ffmpeg cambia di rado e serve solo a unire video e audio: una versione fissata, coi suoi hash scritti qui, vale
// più di un controllo contro un elenco scaricato dalla stessa origine del file.
const FFMPEG_VERSIONE = 'b6.1.1';
const RILASCIO_FFMPEG = `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_VERSIONE}/`;
const FFMPEG_SHA256 = Object.freeze({
  'ffmpeg-win32-x64.gz': '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77',
  'ffmpeg-darwin-x64.gz': '929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106',
  'ffmpeg-darwin-arm64.gz': '8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa',
  'ffmpeg-linux-x64.gz': 'bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa',
  'ffmpeg-linux-arm64.gz': '754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac0',
});

function assetYtdlp(platform, arch) {
  if (platform === 'win32') return { x64: 'yt-dlp.exe', arm64: 'yt-dlp_arm64.exe', ia32: 'yt-dlp_x86.exe' }[arch] || null;
  if (platform === 'darwin') return 'yt-dlp_macos';
  if (platform === 'linux') return { x64: 'yt-dlp_linux', arm64: 'yt-dlp_linux_aarch64' }[arch] || null;
  return null;
}

// Windows su ARM esegue la build x64 in emulazione: meglio quella che nessuna.
function assetFfmpeg(platform, arch) {
  if (platform === 'win32') return (arch === 'x64' || arch === 'arm64') ? 'ffmpeg-win32-x64.gz' : null;
  if (platform === 'darwin') return arch === 'arm64' ? 'ffmpeg-darwin-arm64.gz' : 'ffmpeg-darwin-x64.gz';
  if (platform === 'linux') return { x64: 'ffmpeg-linux-x64.gz', arm64: 'ffmpeg-linux-arm64.gz' }[arch] || null;
  return null;
}

// «hash  nome» per riga, come in SHA2-256SUMS. Un nome ripetuto con hash diversi non vale niente.
function leggiSomme(testo) {
  const out = new Map();
  const doppi = new Set();
  for (const riga of String(testo || '').split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)\s*$/i.exec(riga.trim());
    if (!m) continue;
    const [, h, nome] = m;
    if (out.has(nome) && out.get(nome) !== h.toLowerCase()) doppi.add(nome);
    out.set(nome, h.toLowerCase());
  }
  for (const n of doppi) out.delete(n);
  return out;
}

const SEP = '\t';
const MARCA = 'FILO-DL';
const MARCA_PP = 'FILO-PP';

// `cartella` è dove yt-dlp lavora: i suoi file escono come «video.<ext>», il nome vero lo dà Filo spostandolo.
function argomenti({ url, cartella, audio = false, ffmpeg = '', nodo = '' }) {
  const a = [
    // Una configurazione dell'utente (per esempio coi cookie del browser) o un plugin non entrano mai:
    // il programma fa solo quello che chiede Filo, e senza l'account Google (decisione dell'owner, #1488).
    '--ignore-config', '--no-plugin-dirs',
    '--no-playlist', '--newline', '--no-colors', '--no-mtime',
    // Una diretta non finisce mai: si dice, invece di scaricare per ore.
    '--match-filter', '!is_live',
  ];
  if (nodo) a.push('--js-runtimes', `node:${nodo}`);
  if (ffmpeg) a.push('--ffmpeg-location', ffmpeg);
  if (audio) {
    a.push('-f', 'ba[ext=m4a]/ba/b');
  } else if (ffmpeg) {
    // Fino a 1080p in H.264 e AAC dentro un MP4: il file si apre con qualunque lettore, anche sul telefono.
    a.push('-f', 'bv*+ba/b', '-S', 'res:1080,vcodec:h264,acodec:aac', '--merge-output-format', 'mp4');
  } else {
    a.push('-f', 'b[ext=mp4]/b');
  }
  // Un «%» nel percorso della cartella è testo, non un campo del modello del nome.
  a.push('-o', require('node:path').join(String(cartella || '').replace(/%/g, '%%'), 'video.%(ext)s'));
  // Video e audio scendono uno dopo l'altro, ognuno col suo formato: l'elenco dei pezzi dice quanti aspettarne.
  a.push('--progress-template', `download:${[MARCA, '%(progress.status)s', '%(progress.downloaded_bytes)s',
    '%(progress.total_bytes)s', '%(progress.total_bytes_estimate)s', '%(info.format_id)s',
    '%(info.requested_formats.:.format_id)j', '%(info.requested_formats.:.filesize)j',
    '%(info.requested_formats.:.filesize_approx)j', '%(info.title)s'].join(SEP)}`);
  a.push('--progress-template', `postprocess:${[MARCA_PP, '%(progress.status)s', '%(progress.postprocessor)s'].join(SEP)}`);
  // Dopo `--` l'indirizzo è solo un indirizzo, anche se comincia con un trattino.
  a.push('--', String(url));
  return a;
}

const numero = (s) => { const n = Number(s); return Number.isFinite(n) && n >= 0 ? n : 0; };

function leggiRiga(riga) {
  const r = String(riga || '').replace(/\r$/, '');
  if (r.startsWith(MARCA + SEP)) {
    const [, stato, scaricati, totale, stima, formato, parti, pesi, stime, ...titolo] = r.split(SEP);
    const lista = (x) => { try { const v = JSON.parse(x); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
    const ids = lista(parti);
    const esatti = lista(pesi);
    const circa = lista(stime);
    // Il peso di tutti i pezzi si sa prima che scendano solo se ognuno ne ha uno.
    const pesiPezzi = ids.map((_, i) => numero(esatti[i]) || numero(circa[i]));
    return {
      tipo: 'avanza', stato, scaricati: numero(scaricati), totale: numero(totale) || numero(stima),
      pezzi: ids.length || 1, pesoTutti: pesiPezzi.length && pesiPezzi.every((n) => n > 0) ? pesiPezzi.reduce((a, b) => a + b, 0) : 0,
      formato: formato === 'NA' ? '' : formato, titolo: titolo.join(SEP) === 'NA' ? '' : titolo.join(SEP),
    };
  }
  if (r.startsWith(MARCA_PP + SEP)) {
    const [, stato, chi] = r.split(SEP);
    return { tipo: 'post', stato, chi: chi || '' };
  }
  if (/^\[Merger\]/.test(r)) return { tipo: 'post', stato: 'started', chi: 'Merger' };
  // Il filtro sulle dirette non è un errore per yt-dlp: salta il video ed esce con 0.
  if (/does not pass filter/i.test(r) && /is_live/.test(r)) return { tipo: 'errore', motivo: 'diretta', testo: r };
  if (/^ERROR:/.test(r)) return { tipo: 'errore', motivo: motivoErrore(r), testo: r };
  return null;
}

// Il «perché» di un errore, per dirlo all'utente con parole sue. `aggiornare` è quello che un programma più
// nuovo di solito risolve: chi esegue controlla se c'è e riprova una volta.
function motivoErrore(testo) {
  const t = String(testo || '');
  if (/confirm your age|age[- ]restricted|inappropriate for some users/i.test(t)) return 'eta';
  if (/not a bot/i.test(t)) return 'robot';
  if (/private video|members[- ]only|join this channel|requires? (?:authentication|login|sign[- ]?in)|login required|sign in to|--cookies/i.test(t)) return 'accesso';
  if (/\bDRM\b/.test(t)) return 'protetto';
  if (/no space left|disk full|ENOSPC/i.test(t)) return 'spazio';
  if (/is_live|live event|is live|premieres? in/i.test(t)) return 'diretta';
  if (/unsupported url/i.test(t)) return 'sito';
  if (/video unavailable|not available in your country|geo.?restrict|has been removed|no longer available|does not exist|HTTP Error 404/i.test(t)) return 'non_disponibile';
  if (/getaddrinfo|timed out|connection (?:refused|reset)|network is unreachable|name resolution|unable to connect|ECONN/i.test(t)) return 'rete';
  if (/unable to extract|nsig|signature|requested format is not available|HTTP Error 403|precondition|player|please report this issue|update/i.test(t)) return 'aggiornare';
  return 'generico';
}

// L'avanzamento complessivo di un salvataggio a più pezzi (video e audio arrivano separati): per pezzo si tiene
// l'ultimo dato, e il totale è la somma dei pezzi visti, più una stima per quelli che devono ancora cominciare.
function creaAvanzamento() {
  const pezzi = new Map();
  let attesi = 1;
  let pesoTutti = 0;
  let titolo = '';
  return {
    leggi(ev) {
      if (!ev || ev.tipo !== 'avanza') return;
      if (ev.titolo) titolo = ev.titolo;
      const id = ev.formato || '?';
      attesi = Math.max(attesi, Number(ev.pezzi) || 1);
      if (ev.pesoTutti > 0) pesoTutti = ev.pesoTutti;
      const p = pezzi.get(id) || { scaricati: 0, totale: 0, finito: false };
      p.scaricati = Math.max(p.scaricati, ev.scaricati);
      if (ev.totale) p.totale = ev.totale;
      if (ev.stato === 'finished') { p.finito = true; if (!p.totale) p.totale = p.scaricati; p.scaricati = p.totale || p.scaricati; }
      pezzi.set(id, p);
    },
    titolo: () => titolo,
    stato() {
      let ricevuti = 0; let totale = 0; let noti = 0;
      for (const p of pezzi.values()) { ricevuti += p.scaricati; totale += p.totale; if (p.totale) noti++; }
      if (pesoTutti) return { ricevuti, totale: Math.max(pesoTutti, ricevuti) };
      // Un pezzo che non ha ancora un peso rende la percentuale una promessa falsa: meglio la barra senza numero.
      if (noti < pezzi.size || !pezzi.size) return { ricevuti, totale: 0 };
      if (pezzi.size < attesi) return { ricevuti, totale: 0 };
      return { ricevuti, totale: Math.max(totale, ricevuti) };
    },
  };
}

// Il nome proposto: il titolo del video, ripulito. YouTube mette «(3) » davanti per le notifiche e « - YouTube» dopo.
function titoloDaPagina(titolo) {
  return String(titolo || '').replace(/^\(\d+\+?\)\s*/, '').replace(/\s+[-–|]\s+YouTube$/i, '').trim();
}

module.exports = {
  RILASCIO_YTDLP, RILASCIO_FFMPEG, FFMPEG_VERSIONE, FFMPEG_SHA256,
  assetYtdlp, assetFfmpeg, leggiSomme, argomenti, leggiRiga, motivoErrore, creaAvanzamento, titoloDaPagina,
};
