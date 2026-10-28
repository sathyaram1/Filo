// Handler di dominio: cattura schermo, salvataggio immagini su disco, box
// feedback (annotazione/invio) e fetch dei metadati Open Graph di un link.

const siteBlock = require('../siteBlock');
require('../../../shared/linkSospetto.js'); // SN_LINK_SOSPETTO su globalThis: l'avviso sui link, lo stesso del menu
const { perContoDellaScheda } = require('../perContoDellaScheda');
const { avvisoNellaFinestra } = require('../avvisoFinestra');
const { luogoDownload } = require('../contatoriFinestra');
const { campiSegretiFuoriPagina } = require('../campiNeiRiquadri');
const Foto = require('../fotoDellaPagina');
const Mittente = require('../feedbackMittente');
// L'identità da allegare a un invio che il server limita per identità: la
// chiede la coda dei percorsi condivisi, al momento in cui spedisce.
const identitaInvio = require('../../auth/identita-invio');
// Serve ownerize(), per marcare gli invii dell'owner. Idempotente se già caricato.
require('../../../shared/feedbackThread.js');

// ── "Salva immagine/video/audio come…" (#274, #400): byte scaricati nel main ─

// Scarica i byte di un'immagine o di un filmato per conto della scheda: dalla sua sessione (proxy, cache, cookie),
// col Referer che le presenterebbe la pagina ridotto all'origine (#1272). Un download di Electron il Referer lo perde
// sempre, e senza i siti con la protezione dai collegamenti esterni rispondono 403.
// #436: i byte vanno su disco mentre arrivano, mai tutti in memoria; i ricevuti diventano l'avanzamento.
// Risolve { partPath, filename, totalBytes, receivedBytes } o rigetta con un errore leggibile.
const INATTIVITA_MS = 30000;

async function fetchToFile({ sender, url, politiche, kind = 'image', onHeaders, onProgress, shouldStop }) {
  const fs = require('node:fs');
  const { Readable, Transform } = require('node:stream');
  const { pipeline } = require('node:stream/promises');
  const isMedia = kind === 'video' || kind === 'audio';
  // Un file da un'ora è legittimo, mezzo minuto di silenzio assoluto no.
  const ac = new AbortController();
  let fermo = null;
  const riarma = () => { clearTimeout(fermo); fermo = setTimeout(() => ac.abort(), INATTIVITA_MS); };
  riarma();
  try {
    let res;
    try {
      res = await perContoDellaScheda(sender, url, {
        credenziali: 'include', conReferer: true, politiche, lanSeLaPaginaCiSta: true, signal: ac.signal,
        // Un Accept che dichiara solo immagini fa rispondere 406 ad alcuni server quando l'URL è un filmato.
        accetta: isMedia ? `${kind}/*,*/*;q=0.8` : 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      });
    } catch (e) {
      throw new Error(ac.signal.aborted ? 'timeout' : (e && e.message) || 'richiesta fallita');
    }
    if (!res.ok) {
      try { await res.body?.cancel?.(); } catch (_) {}
      throw new Error('HTTP ' + res.status);
    }
    // Content-Length rende l'avanzamento una percentuale; senza (chunked) la barra resta indeterminata.
    const expected = parseInt(res.headers.get('content-length'), 10);
    const total = Number.isFinite(expected) && expected > 0 ? expected : 0;
    const filename = filenameFromHeaders({ 'content-disposition': res.headers.get('content-disposition') || '' }, res.url || url);
    let partPath;
    try {
      partPath = onHeaders({ filename, totalBytes: total, contentType: res.headers.get('content-type') || '', servito: res.url || url });
    } catch (e) {
      try { await res.body?.cancel?.(); } catch (_) {}
      throw e instanceof Error ? e : new Error('destinazione non disponibile');
    }
    if (!res.body) throw new Error('file vuoto');
    let received = 0;
    const conta = new Transform({
      transform(chunk, _enc, cb) {
        riarma();
        received += chunk.length;
        try { if (onProgress) onProgress(received, total); } catch (_) {}
        // "Annulla" nella barra: si chiude la connessione invece di continuare a consumare rete e disco.
        if (shouldStop && shouldStop()) { cb(new Error('annullato')); return; }
        cb(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(res.body), conta, fs.createWriteStream(partPath));
    } catch (e) {
      throw new Error(ac.signal.aborted ? 'timeout' : (e && e.message === 'annullato' ? 'annullato' : 'download interrotto'));
    }
    // Un Content-Length dichiarato e non raggiunto è una risposta troncata, non un file valido.
    if (total && received < total) throw new Error('download interrotto');
    if (!received) throw new Error('file vuoto');
    return { partPath, filename, totalBytes: total || received, receivedBytes: received };
  } finally {
    clearTimeout(fermo);
  }
}

// Stesso volume: rinomina istantanea. Altro disco: copia a blocchi, mai passando dalla
// memoria.
async function moveInto(from, to) {
  const fs = require('node:fs');
  try {
    await fs.promises.rename(from, to);
    return;
  } catch (e) {
    if (!e || (e.code !== 'EXDEV' && e.code !== 'EPERM' && e.code !== 'EACCES')) throw e;
  }
  await fs.promises.copyFile(from, to);
  try { await fs.promises.unlink(from); } catch (_) {}
}

// Nome file dal Content-Disposition se c'è, altrimenti dal path dell'URL.
function filenameFromHeaders(hdrs, url) {
  try {
    const cd = hdrs && hdrs['content-disposition'];
    if (cd) {
      // filename*=UTF-8''… (RFC 5987) ha priorità su filename=…
      let m = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd);
      if (m) { try { return decodeURIComponent(m[1].trim().replace(/^["']|["']$/g, '')); } catch (_) { return m[1]; } }
      m = /filename=("?)([^";]+)\1/i.exec(cd);
      if (m) return m[2].trim();
    }
  } catch (_) {}
  return filenameFromUrl(url);
}

function filenameFromUrl(url) {
  try {
    const u = new URL(url);
    const base = decodeURIComponent((u.pathname || '').split('/').filter(Boolean).pop() || '');
    return base || '';
  } catch (_) { return ''; }
}

// #711 — i byte attraversano il canale e il thread di lettura: il tetto è largo (un PNG
// da 60 megapixel ci sta dentro), e oltre il chiamante riceve un rifiuto col motivo, mai un silenzio.
const MAX_BYTE_PROVENIENZA = 64 * 1024 * 1024;

// Il tipo di un'immagine dai suoi primi byte, o '' se non è un'immagine: il download per
// conto della scheda, coi cookie dell'utente, non restituisce nient'altro (#946).
function tipoImmagine(b) {
  const fourcc = (i) => b.toString('latin1', i, i + 4);
  if (b.length < 4) return '';
  if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (fourcc(0) === 'RIFF' && fourcc(8) === 'WEBP') return 'image/webp';
  if (fourcc(0) === 'GIF8') return 'image/gif';
  if (fourcc(4) === 'ftyp') {
    const marca = fourcc(8);
    if (/^avi[fs]$/.test(marca)) return 'image/avif';
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(marca)) return 'image/heic';
    return '';
  }
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'image/x-icon';
  if ((fourcc(0) === 'II*\u0000') || (fourcc(0) === 'MM\u0000*')) return 'image/tiff';
  if ((b[0] === 0xff && b[1] === 0x0a) || fourcc(4) === 'JXL ') return 'image/jxl';
  if (fourcc(4) === 'jP  ') return 'image/jp2';
  return eSvg(b) ? 'image/svg+xml' : '';
}

// Un SVG comincia con <svg, dopo al più dichiarazione XML, commenti e doctype: una pagina
// HTML con un'icona SVG dentro non lo è.
function eSvg(b) {
  let t = b.toString('utf8', 0, Math.min(b.length, 4096)).replace(/^\uFEFF/, '');
  for (;;) {
    t = t.replace(/^\s+/, '');
    const preambolo = /^(<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)/i.exec(t);
    if (!preambolo) break;
    t = t.slice(preambolo[0].length);
  }
  return /^<svg[\s>]/i.test(t);
}

// Le politiche del Referer che il content script ha letto nella pagina: possono solo stringerlo.
function politicheDi(msg) {
  const p = msg && msg.politiche;
  return (Array.isArray(p) ? p : []).filter((x) => typeof x === 'string').map((x) => x.slice(0, 200)).slice(0, 4);
}

// I byte di un'immagine che la pagina mostra ma che il suo script non può leggere
// (altra origine): stessa strada di «Salva immagine come…», in un file temporaneo.
async function byteImmagineRemota({ sender, url, politiche }) {
  const fs = require('node:fs');
  const path = require('node:path');
  const { app } = require('electron');
  let tmp = '';
  let tipo = '';
  let troppo = false;
  try {
    await fetchToFile({
      sender, url, politiche, kind: 'image',
      onHeaders: ({ totalBytes, contentType }) => {
        if (totalBytes > MAX_BYTE_PROVENIENZA) { troppo = true; throw new Error('troppo grande'); }
        tipo = contentType;
        tmp = path.join(app.getPath('temp'), `filo-immagine-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        return tmp;
      },
      onProgress: (ricevuti) => { if (ricevuti > MAX_BYTE_PROVENIENZA) troppo = true; },
      shouldStop: () => troppo,
    });
    const byte = await fs.promises.readFile(tmp);
    if (byte.length > MAX_BYTE_PROVENIENZA) troppo = true;
    if (troppo) throw new Error('troppo grande');
    const tipoVero = tipoImmagine(byte);
    if (!tipoVero) return { ok: false, notImage: true, error: `non è un’immagine (${String(tipo || 'tipo ignoto').split(';')[0]})` };
    return { ok: true, dataUrl: `data:${tipoVero};base64,${byte.toString('base64')}` };
  } catch (e) {
    if (troppo) return { ok: false, tooBig: true, error: `immagine oltre ${MAX_BYTE_PROVENIENZA / (1024 * 1024)} MB` };
    return { ok: false, error: e?.message || 'immagine non scaricabile' };
  } finally {
    if (tmp) fs.promises.unlink(tmp).catch(() => {});
  }
}

function bytesDaDataUrl(dataUrl) {
  const m = /^data:[^,]*;base64,(.*)$/s.exec(String(dataUrl || ''));
  if (!m) return null;
  try {
    const b = Buffer.from(m[1], 'base64');
    return b.length ? b : null;
  } catch (_) { return null; }
}

// I byte dell'immagine che il sistema tiene negli appunti, PNG prima di tutto; null se non ce n'è.
async function immagineNegliAppunti() {
  const voci = await require('electron').clipboard.read();
  for (const tipo of ['image/png', /^image\//]) {
    for (const v of voci) {
      const t = v.types.find((x) => (typeof tipo === 'string' ? x === tipo : tipo.test(x)));
      if (!t) continue;
      const b = Buffer.from(await (await v.getType(t)).arrayBuffer());
      if (b.length && b.length <= MAX_BYTE_PROVENIENZA) return b;
    }
  }
  return null;
}

module.exports = function register(on, ctx) {
  const { MSG, winOf, modelGate, broadcastToTabs, controllaUscita: portaUscite, apriDaFilo, contattabilePrimaDelClic } = ctx;
  // Ogni blocco della porta si conta fra le uscite fermate (#1474), qualunque porta arrivi da ctx.
  const controllaUscita = require('../contatoriSicurezza').contaUscite(portaUscite);
  const ACTIONS = globalThis.SN_CONST.ACTIONS;

  // Titolo generato da un LLM economico: best-effort, si ripiega sulle prime parole del testo
  // — l'invio non deve MAI fallire per colpa del titolo.
  async function generateFeedbackName(text) {
    const fallback = globalThis.SN_FEEDBACK?.fallbackName?.(text) || '';
    const t = String(text || '').trim();
    if (!t) return fallback;
    try {
      const messages = [{
        role: 'user',
        content: 'Genera un titolo brevissimo (2-6 parole, nella stessa lingua del testo) che riassuma questo feedback su un\'app. Rispondi SOLO col titolo, senza virgolette e senza punto finale.\n\nFeedback:\n' + t.slice(0, 1500),
      }];
      const r = await Promise.race([
        modelGate.text({ action: ACTIONS.FEEDBACK_TITLE, messages }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout titolo (8s)')), 8000)),
      ]);
      const name = String(r || '').trim()
        .split('\n')[0]
        .replace(/^["'«\s]+|["'»\s.]+$/g, '')
        .slice(0, 120);
      return name || fallback;
    } catch (e) {
      console.warn('[Filo feedback] titolo LLM non disponibile:', e?.message || e);
      return fallback;
    }
  }

  on(MSG.CAPTURE_VISIBLE_TAB, async (msg, sender) => {
    const wc = Foto.paginaDaFotografare(sender);
    if (!wc) return { ok: false, code: 'fuori_vista', error: 'la pagina non è in vista' };
    // Per un modello (#810.7): i campi segreti che il content script non vede (riquadri di altri siti, componenti
    // chiusi), e con campi da coprire la foto piena, che diventa leggera dopo la copertura.
    if (msg && msg.campiSegreti) {
      const [img, fuori] = await Promise.all([wc.capturePage(), campiSegretiFuoriPagina(wc)]);
      if (fuori.nonCoperti) return { ok: false, code: 'segreti', error: 'campi segreti che non si riescono a coprire' };
      if (img.isEmpty()) return { ok: false, code: 'vuota', error: 'la foto della pagina è vuota' };
      if (fuori.campi.length || Number(msg.campiNellaPagina) > 0) {
        const leggera = msg.leggera === true
          ? { fattore: Foto.fattoreDiScala(sender, require('electron').screen), qualita: Foto.QUALITA_LEGGERA } : {};
        return { ok: true, dataUrl: img.toDataURL(), campi: fuori.campi, ...leggera };
      }
      if (msg.leggera !== true) return { ok: true, dataUrl: img.toDataURL(), campi: [] };
      const dataUrl = Foto.fotoLeggera(img, Foto.fattoreDiScala(sender, require('electron').screen));
      return dataUrl ? { ok: true, dataUrl, campi: [] } : { ok: false, code: 'vuota', error: 'la foto della pagina è vuota' };
    }
    const img = await wc.capturePage();
    if (!msg || msg.leggera !== true) return { ok: true, dataUrl: img.toDataURL() };
    const dataUrl = Foto.fotoLeggera(img, Foto.fattoreDiScala(sender, require('electron').screen));
    return dataUrl ? { ok: true, dataUrl } : { ok: false, code: 'vuota', error: 'la foto della pagina è vuota' };
  });

  // "Salva immagine/video/audio come…" (#274, #400): i byte li scarica il main per conto della scheda (fetchToFile),
  // perché Chromium ignora `download` su un'altra origine e un download di Electron perde il Referer. Il trasferimento
  // sta nella barra degli scaricamenti come gli altri (#436) e l'utente sceglie dove salvare col dialogo nativo.
  const handleDownload = async (msg, sender) => {
    const url = String(msg.url || '').trim();
    if (!/^https?:/i.test(url)) return { ok: false, error: 'URL non scaricabile' };
    const kind = ['image', 'video', 'audio'].includes(msg.kind) ? msg.kind : 'image';
    const wc = sender && sender.wc;
    if (!wc || wc.isDestroyed?.()) return { ok: false, error: 'no sender' };
    const path = require('node:path');
    const fs = require('node:fs');
    const { dialog, app, BrowserWindow } = require('electron');
    const downloads = require('../downloads');
    const fallbackName = kind === 'video' ? 'video' : (kind === 'audio' ? 'audio' : 'immagine');

    // In test si salva diretto: il dialogo nativo non è automatizzabile. Non rigetta MAI,
    // l'esito sta nel valore.
    const pickDestination = async (filename) => {
      const testDir = process.env.FILO_DOWNLOAD_DIR;
      if (testDir) {
        try { fs.mkdirSync(testDir, { recursive: true }); } catch (_) {}
        return { filePath: path.join(testDir, filename) };
      }
      try {
        // Dopo la domanda sul programma la scheda può essere già chiusa.
        const win = (!wc.isDestroyed() && BrowserWindow.fromWebContents(wc)) || winOf(sender) || null;
        const opts = { defaultPath: path.join(app.getPath('downloads'), filename) };
        const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
        // Annullato dall'utente: non è un errore, nessun toast.
        if (res.canceled || !res.filePath) return { cancelled: true };
        return { filePath: res.filePath };
      } catch (e) {
        return { error: e?.message || 'dialogo non disponibile' };
      }
    };

    let entry = null;        // voce nella barra scaricamenti
    let partPath = '';       // file che cresce mentre i byte arrivano
    let destPromise = null;  // scelta della destinazione (una volta sola)
    let askDest = null;      // come aprirla, quando serve
    let askTimer = null;
    // Il dialogo si apre alla prima delle due: trasferimento finito, o passato un attimo senza
    // che finisca. Così un file grosso non tiene ferma la connessione aspettando una risposta.
    const ASK_AFTER_MS = 1200;
    const ensureDest = () => {
      if (!destPromise && askDest) destPromise = askDest();
      return destPromise;
    };
    const dropPart = async () => {
      if (!partPath) return;
      try { await fs.promises.unlink(partPath); } catch (_) {}
    };

    let result = null;
    let downloadError = null;
    try {
      result = await fetchToFile({
        sender,
        url,
        politiche: politicheDi(msg),
        kind,
        // Arrivati gli header sappiamo nome e peso: da qui in poi il
        // salvataggio non è più cieco.
        onHeaders: ({ filename, totalBytes, servito }) => {
          // Il nome dal server è dato ostile: la regola è quella dei download da link, e dialogo, file
          // parziale e voce nella barra mostrano lo stesso nome (#1510).
          const name = downloads.safeName(filename || filenameFromUrl(url) || fallbackName, fallbackName);
          // La voce nella barra in alto: percentuale, peso e "Annulla", gli
          // stessi di un download partito da un link.
          entry = downloads.beginManual({ url, filename: name, totalBytes, scope: downloads.scopeOfWindow(sender.win), servedFrom: servito, webContents: wc });
          // #1311 — un programma passa dalla domanda di Filo PRIMA del dialogo di sistema, che non dice né cos'è né da dove arriva.
          const via = entry.permesso(name);
          // Il nome da proporre lo sa solo il server (Content-Disposition):
          // per questo la destinazione si chiede da qui in poi, mai prima.
          // Un no l'ha già chiuso la voce; un trasferimento caduto durante la domanda resta un errore, non un annullamento.
          askDest = () => via.then((si) => (si ? pickDestination(name).then((d) => {
            // Chi annulla il dialogo non vuole più il file: ferma anche i byte.
            if (d && (d.cancelled || d.error)) { try { entry.cancel(); } catch (_) {} }
            return d;
          }) : null));
          askTimer = setTimeout(ensureDest, ASK_AFTER_MS);
          // Il file parziale cresce nella cartella dove atterrerebbe un download
          // nativo: se la destinazione è lì (quasi sempre) la consegna finale è
          // una rinomina istantanea invece della copia di un filmato intero.
          partPath = downloads.uniquePath(entry.cartella(), `${name}.filo-part`);
          return partPath;
        },
        onProgress: (received, total) => { if (entry) entry.progress(received, total); },
        shouldStop: () => !!entry && entry.cancelled(),
      });
    } catch (e) {
      downloadError = e;
    }
    if (askTimer) { clearTimeout(askTimer); askTimer = null; }

    // Mai arrivati agli header: nessuna voce aperta, nessun file da ripulire.
    if (!entry) return { ok: false, error: downloadError?.message || 'download fallito' };

    // Se il trasferimento è fallito NON chiediamo dove salvare: sarebbe un
    // dialogo per un file che non c'è. Se invece era già aperto lo si aspetta
    // (non c'è modo di richiuderlo da qui). La voce si chiude subito: una domanda
    // ancora aperta sul programma si ritira invece di aspettare per sempre.
    if (downloadError && !entry.cancelled()) entry.fail();
    if (!downloadError && !entry.cancelled()) ensureDest();
    const dest = destPromise ? await destPromise : null;
    const cancelled = entry.cancelled() || !!(dest && dest.cancelled);

    if (cancelled) { await dropPart(); return { ok: false, cancelled: true }; }
    if (downloadError) { entry.fail(); await dropPart(); return { ok: false, error: downloadError.message || 'download fallito' }; }
    if (!dest || dest.error || !dest.filePath) {
      entry.fail(); await dropPart();
      return { ok: false, error: (dest && dest.error) || 'destinazione non disponibile' };
    }
    // Conta il nome scelto nel dialogo: un nome da programma scritto lì chiede anche lui, e un sì già dato vale.
    if (!(await entry.permesso(path.basename(dest.filePath)))) { await dropPart(); return { ok: false, cancelled: true }; }

    try {
      await moveInto(result.partPath, dest.filePath);
    } catch (e) {
      entry.fail(); await dropPart();
      return { ok: false, error: e?.message || 'scrittura fallita' };
    }
    await entry.done(dest.filePath);
    return { ok: true, path: dest.filePath, filename: path.basename(dest.filePath) };
  };

  on(MSG.DOWNLOAD_IMAGE, handleDownload);
  on(MSG.DOWNLOAD_MEDIA, handleDownload);

  // #711 — le etichette di origine di un'immagine, lette dai suoi byte. Nessun
  // gate d'origine: la risposta parla solo dei byte che il chiamante ha mandato.
  on(MSG.IMAGE_PROVENANCE, async (msg) => {
    const byte = bytesDaDataUrl(msg && msg.dataUrl);
    if (!byte) return { ok: false, error: 'immagine non leggibile' };
    if (byte.length > MAX_BYTE_PROVENIENZA) {
      return { ok: false, error: 'immagine troppo grande per il controllo delle etichette', tooBig: true };
    }
    const P = globalThis.SN_PROVENIENZA;
    if (!P) return { ok: false, error: 'controllo non disponibile' };
    try {
      const res = await require('../firmatariC2pa').analizzaImmagine(byte);
      const forte = res.prova === 'firmata' && (res.firmatario === 'riconosciuto' || res.firmatario === 'provvisorio');
      return { ok: true, frase: P.frase(res), forte, ...res };
    } catch (e) {
      return { ok: false, error: e?.message || 'controllo fallito' };
    }
  });

  on(MSG.IMAGE_COPIED, async (msg) => {
    const originale = bytesDaDataUrl(msg && msg.originale);
    const copia = bytesDaDataUrl(msg && msg.copia);
    if (!originale || !copia) return { ok: false, error: 'immagine non leggibile' };
    if (originale.length > MAX_BYTE_PROVENIENZA || copia.length > MAX_BYTE_PROVENIENZA) {
      return { ok: false, error: 'immagine troppo grande per il controllo delle etichette', tooBig: true };
    }
    let negliAppunti = null;
    try { negliAppunti = await immagineNegliAppunti(); } catch (_) {}
    try {
      const ricordata = await require('../firmatariC2pa').ricordaCopia(originale, [copia, negliAppunti]);
      return { ok: true, ricordata };
    } catch (e) {
      return { ok: false, error: e?.message || 'controllo fallito' };
    }
  });

  on(MSG.IMAGE_BYTES, async (msg, sender) => {
    const url = String((msg && msg.url) || '').trim();
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'URL non scaricabile' };
    const wc = sender && sender.wc;
    if (!wc || wc.isDestroyed?.()) return { ok: false, error: 'no sender' };
    return byteImmagineRemota({ sender, url, politiche: politicheDi(msg) });
  });

  // "Salva file" su un link a un file (#410.2). A differenza di
  // DOWNLOAD_IMAGE/MEDIA (byte scaricati a mano nel main), qui facciamo partire
  // il download NATIVO della scheda: webContents.downloadURL emette
  // will-download sulla sessione della scheda, che services/downloads.js (#410.1)
  // già intercetta e segue. Risultato IDENTICO al clic sul link — avanzamento in
  // barra, salvataggio in cartella Download, toast finale, cronologia — così i
  // due cammini (menu e clic) producono lo stesso effetto visibile. Il nome-file
  // ostile del server è neutralizzato a valle da downloads.js (safeName), come
  // per il salvataggio immagini. Non serve il gate "solo superfici interne": far
  // partire uno scaricamento di un URL è esattamente ciò che il clic sul link fa
  // già, e non espone cronologia né percorsi su disco (quelli restano riservati).
  on(MSG.DOWNLOAD_LINK, async (msg, sender, origin) => {
    const url = String(msg.url || '').trim();
    if (!/^https?:/i.test(url)) return { ok: false, error: 'URL non scaricabile' };
    const wc = sender && sender.wc;
    if (!wc || wc.isDestroyed?.()) return { ok: false, error: 'no sender' };
    const scarica = () => {
      try {
        wc.downloadURL(url);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e?.message || 'download non avviato' };
      }
    };
    // Scaricare un collegamento scritto da un modello lo chiede al suo sito: passa dalla porta delle uscite (#810).
    if (msg.diFilo) {
      const parole = (Array.isArray(msg.parole) ? msg.parole : []).filter((x) => typeof x === 'string').join('\n');
      let esito = { ok: false, error: 'download non avviato' };
      const avvisato = String(origin || '').startsWith('filo://');
      const r = await apriDaFilo(url, {
        wc, parole, avvisa: avvisato, tipo: 'SCARICA_COLLEGAMENTO', confermato: msg.confermato === true,
        proposta: avvisato && msg.proposta === true, apri: () => { esito = scarica(); },
      });
      if (r.aperto) return esito;
      // Un collegamento che al clic chiede l'OK lo chiede anche per scaricarlo: la pagina lo mostra e riprova.
      if (r.conferma) return { ok: false, conferma: r.conferma, parti: r.parti, avvisato };
      return { ok: false, error: 'segreto', frase: r.frase, avvisato };
    }
    return scarica();
  });

  // Senza gate un sito leggerebbe la cronologia degli scaricamenti (URL e percorsi con lo
  // username) o farebbe aprire un file scaricato. Confine: vedi handlers/origine.js.
  const DL = () => require('../downloads');
  const isFilo = (origin) => String(origin || '').startsWith('filo://');
  // `sender.isShell` copre le finestre interne senza URL filo://, fuori da isFilo.
  const internalOnly = (fn) => async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    return fn(msg, sender, origin);
  };
  // #588.2 — ogni finestra vede e comanda solo le voci del suo ambito: una
  // finestra incognito le sue, quella normale la cronologia.
  const ambito = (sender) => DL().scopeOfWindow(sender && sender.win);
  // Ogni azione su uno scaricamento si conta col luogo da cui arriva (#1470), mai col nome del file.
  const contata = (azione, fn) => async (msg, s, o) => {
    require('../contatoriFinestra').misura('download', luogoDownload(msg, s), azione, { incognito: !!ambito(s) });
    return fn(msg, s, o);
  };
  on(MSG.DOWNLOADS_LIST, internalOnly(async (_m, s) => ({ ok: true, items: DL().list(ambito(s)) })));
  on(MSG.DOWNLOADS_CLEAR, internalOnly(contata('svuota', async (_m, s) => ({ ok: true, items: DL().clearCompleted(ambito(s)) }))));
  on(MSG.DOWNLOAD_REMOVE, internalOnly(contata('rimuovi', async (msg, s) => ({ ok: true, items: DL().remove(msg.id, ambito(s)) }))));
  // #588 — `confirmed` viaggia dalla superficie che ha MOSTRATO la conferma:
  // senza, il main risponde needsConfirm e non tocca shell.openPath. Il sì alla conferma è lo stesso gesto: non conta.
  on(MSG.DOWNLOAD_OPEN_FILE, internalOnly(async (msg, s) => {
    if (!msg.confirmed) require('../contatoriFinestra').misura('download', luogoDownload(msg, s), 'apri_file', { incognito: !!ambito(s) });
    return DL().openFile(msg.id, { confirmed: !!msg.confirmed }, ambito(s));
  }));
  on(MSG.DOWNLOAD_CONFIRM, internalOnly(async (msg, s) => DL().confirmDownload(msg.id, !!msg.allow, ambito(s))));
  on(MSG.DOWNLOAD_OPEN_FOLDER, internalOnly(contata('apri_cartella', async (msg, s) => DL().openFolder(msg.id, ambito(s)))));
  on(MSG.DOWNLOAD_CANCEL, internalOnly(contata('annulla', async (msg, s) => DL().cancel(msg.id, ambito(s)))));
  on(MSG.DOWNLOAD_PAUSE, internalOnly(contata('pausa', async (msg, s) => DL().pause(msg.id, ambito(s)))));
  on(MSG.DOWNLOAD_RESUME, internalOnly(contata('riprendi', async (msg, s) => DL().resume(msg.id, ambito(s)))));

  on(MSG.FEEDBACK_ANNOTATE, async (msg, sender) => {
    // Alla shell, così l'ombra dell'annotazione copre tutto Filo e non la sola area pagina.
    const win = winOf(sender);
    try { win?.webContents?.send('shell:feedback-dim', { on: !!msg.on }); } catch (_) {}
    return { ok: true };
  });

  on(MSG.FEEDBACK_CLEAR_DRAW, async (msg, sender) => {
    // I tratti sulla barra vivono nella shell: «Cancella disegno» deve togliere anche quelli.
    const win = winOf(sender);
    try { win?.webContents?.send('shell:feedback-clear-draw'); } catch (_) {}
    return { ok: true };
  });

  on(MSG.CAPTURE_FEEDBACK_TOPBAR, async (msg, sender) => {
    // Scatto annotato della SOLA barra in alto di Filo (shell): il box lo
    // impila sopra lo screenshot della pagina per ottenere un'immagine di
    // tutta l'app col disegno. I tratti sono già parte del DOM della shell
    // (canvas di disegno), quindi vengono catturati direttamente.
    const win = Foto.barraDaFotografare(sender);
    if (!win) return { ok: false, code: 'fuori_vista', error: 'la pagina non è in vista' };
    try {
      const barH = win._filoTabs.topChromeHeight();
      if (barH <= 0) return { ok: false, error: 'no topbar' };
      const [w] = win.getContentSize();
      const img = await win.webContents.capturePage({ x: 0, y: 0, width: w, height: barH });
      return { ok: true, dataUrl: img.toDataURL(), barHeight: barH };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // «Invia» non aspetta la rete: il main consegna in background e ritenta. È idempotente lato
  // server e la coda è persistita: niente duplicati, e riparte al riavvio.
  const Outbox = globalThis.SN_FEEDBACK_OUTBOX;
  if (Outbox?.init) {
    Outbox.init({
      // Titolo breve generato al momento reale dell'invio (offline → fallback).
      prepare: (payload) => generateFeedbackName(payload?.text),
      // Allegato non caricato: si avvisa con un toast, il feedback è comunque partito col resto.
      onDone: (_item, result) => {
        // #678 — l'id resta scritto qui: è così che il popup delle ricompense
        // può chiedere LE PROPRIE schede invece di scaricare la bacheca intera
        // per cercarsi dentro. Best-effort: un registro mancato costa una
        // ricompensa in ritardo, non un feedback perso.
        try { globalThis.SN_FEEDBACK_MINE?.ricordaId?.(result?.id); } catch (_) {}
        try {
          globalThis.SN_SEGNALAZIONI_MIE?.inviata?.(_item?.id, {
            feedbackId: result?.id,
            num: globalThis.SN_FEEDBACK?.formatNum?.(result?.seq, 0) || '',
            titolo: _item?.name || '',
          })?.catch?.(() => {});
        } catch (_) {}
        const failed = Array.isArray(result?.failed) ? result.failed : [];
        if (!failed.length) return;
        const names = failed.map((f) => f?.name || 'allegato').join(', ');
        try {
          broadcastToTabs({
            type: MSG.SHOW_TOAST,
            text: `Feedback inviato, ma non sono riuscito a caricare: ${names}`,
            duration: 6000,
          });
        } catch (_) {}
        try { globalThis.SN_CONTATORI_MAIN?.erroreVisto('avviso:allegati_non_caricati'); } catch (_) {}
      },
      // #602 — la coda rinuncia perché non si può cifrare. Chi ha mandato la
      // segnalazione ha già letto «inviato» e ha già preso i crediti: se non
      // glielo diciamo, quella segnalazione sparisce e non lo sa nessuno. Il
      // motivo arriva già scritto per chi legge (dice cosa manca e che non è
      // partito niente).
      //
      // Non passa dagli avvisi delle pagine: quelli li mostra solo una pagina
      // web che in quel momento è davanti E a fuoco, quindi con Filo in
      // secondo piano, su una pagina interna o appena avviato non li vedeva
      // nessuno, e la segnalazione spariva in silenzio lo stesso. Va nella
      // cornice della finestra, dove resta finché non la si chiude.
      onGiveUp: (item, motivo) => {
        try { globalThis.SN_SEGNALAZIONI_MIE?.nonPartita?.(item?.id)?.catch?.(() => {}); } catch (_) {}
        return avvisoNellaFinestra(String(motivo || 'La tua segnalazione non è partita.'), { errore: 'segnalazione_non_partita' });
      },
      // Dopo un giorno di soli tentativi la coda rinuncia: nell'elenco locale non resta «in partenza».
      onScaduta: (item) => {
        try { globalThis.SN_SEGNALAZIONI_MIE?.nonPartita?.(item?.id)?.catch?.(() => {}); } catch (_) {}
      },
      // Chiesto al momento della spedizione: fra l'accodamento e l'invio
      // possono passare ore (offline), e l'owner può aver chiuso la sessione.
      // '' = l'accesso non c'è; un errore con la sessione ancora aperta è la rete, e la coda riprova senza dire niente.
      tokenOwner: Mittente.tokenOwner,
      onAttesaOwner: (_item, perche) => avvisoNellaFinestra(
        perche === 'rifiutato'
          ? 'Il tuo feedback aspetta la tua firma da owner: il server non accetta il tuo accesso. Riparte quando rientri, o al prossimo avvio di Filo.'
          : 'Il tuo feedback aspetta il tuo accesso da owner: parte con la tua firma appena rientri.',
        { chiave: 'feedback-attesa-accesso-owner', tipo: 'segnalazione_in_attesa' },
      ),
      log: (...a) => { try { console.log('[Filo feedback]', ...a); } catch (_) {} },
    });
  }

  // Coda dei percorsi condivisi dell'Aiuto (#584). Ritarda apposta l'invio
  // perché l'ora in cui Firestore riceve un percorso è pubblica e, se fosse
  // quella della sessione, ricucirebbe i percorsi di una persona su domini
  // diversi. Qui si riprende quello che era rimasto in coda alla chiusura; a
  // raccolta spenta (#897) lo si butta senza spedirlo.
  //
  // L'identità va chiesta AL MOMENTO DELL'INVIO, non quando il percorso viene
  // raccolto: in mezzo passano ore e un token di allora sarebbe scaduto. Chi
  // sia, e perché il mittente resti anonimo lo stesso, sta in
  // src/main/auth/identita-invio.js.
  try {
    globalThis.SN_PATHS_COLLECTOR?.init?.({
      ottieniIdToken: identitaInvio.ottieniIdToken,
    });
  } catch (_) {}

  on(MSG.SUBMIT_FEEDBACK, async (msg) => {
    try {
      if (!globalThis.SN_FEEDBACK?.submit) {
        throw new Error('SN_FEEDBACK non caricato nel main process');
      }
      if (!Outbox?.enqueue) {
        throw new Error('SN_FEEDBACK_OUTBOX non caricato nel main process');
      }
      // #602 — la cifratura si controlla PRIMA di accodare. La coda risponde
      // «ricevuto» appena il feedback è al sicuro sul disco e spedisce dopo:
      // se la cifratura non si potesse fare, chi manda avrebbe già letto
      // «grazie, inviato» e la segnalazione riproverebbe per giorni senza
      // partire mai. Qui invece la risposta è un no, con il motivo.
      const motivoCifratura = globalThis.SN_FEEDBACK.encryptionUnavailable?.() || '';
      if (motivoCifratura) {
        // `cifratura: true` dice al riquadro che questa frase è già la frase
        // per l'utente: non va incorniciata in un «Errore invio:».
        return {
          ok: false,
          cifratura: true,
          error: globalThis.SN_FEEDBACK.encryptionBlockedMessage(motivoCifratura),
        };
      }
      const payload = msg.payload || {};
      // Il mittente lo decide il main, non il payload: il content script non sa di essere dell'owner (#595).
      let dallOwner = false;
      try {
        const firmato = Mittente.firma(payload.clientId);
        payload.clientId = firmato.clientId;
        dallOwner = firmato.dallOwner;
      } catch (_) {}
      console.log('[Filo feedback] submit start', {
        textLen: (payload.text || '').length,
        images: (payload.images || []).length,
        url: payload.url,
      });
      // Accoda e prova a inviare subito, ma NON aspettare la rete: l'ack torna
      // appena il feedback è al sicuro in coda (persistito). Il titolo lo genera
      // la coda al momento dell'invio (anche offline, col fallback).
      const r = await Outbox.enqueue(payload, { dallOwner });
      // #986 — la copia per chi l'ha mandata nasce adesso, «in partenza»; dall'incognito non nasce.
      try {
        const Mie = globalThis.SN_SEGNALAZIONI_MIE;
        if (Mie && r?.id) {
          await Mie.registra({ id: r.id, testo: payload.text, allegati: Mie.nomiAllegati(payload) });
        }
      } catch (e) { console.warn('[Filo feedback] copia locale non scritta:', e?.message || e); }
      return { ok: true, queued: true, id: r?.id };
    } catch (e) {
      console.error('[Filo feedback] submit failed', e);
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // Recap delle versioni saltate: si calcola qui, dove ci sono sia la versione dell'app sia le
  // note.
  function appVersion() {
    try { return require('electron').app.getVersion(); } catch (_) { return '0.0.0'; }
  }

  on(MSG.GET_UPDATE_RECAP, async () => {
    const PN = globalThis.SN_PATCH_NOTES;
    const KEYS = globalThis.SN_CONST.STORAGE_KEYS;
    const current = appVersion();
    if (!PN || !globalThis.SN_STORAGE) return { ok: true, current, lastSeen: current, notes: [] };
    const lastSeen = await globalThis.SN_STORAGE.getRaw(KEYS.LAST_SEEN_VERSION, null);
    // Primo avvio: niente recap a sorpresa, ma la versione corrente si marca come vista, così il
    // prossimo aggiornamento parte pulito.
    if (!lastSeen) {
      await markUpdateSeen(current);
      return { ok: true, current, lastSeen: null, notes: [] };
    }
    const foto = await globalThis.SN_STORAGE.getRaw(KEYS.LAST_SEEN_NOTES, null);
    const notes = PN.recap(lastSeen, current, foto);
    return { ok: true, current, lastSeen, notes };
  });

  // Versione e fotografia si scrivono insieme: recap() usa la fotografia solo se è della versione vista.
  async function markUpdateSeen(version) {
    const KEYS = globalThis.SN_CONST.STORAGE_KEYS;
    try { await globalThis.SN_STORAGE.setRaw(KEYS.LAST_SEEN_NOTES, globalThis.SN_PATCH_NOTES.fotografia(version)); } catch (_) {}
    try { await globalThis.SN_STORAGE.setRaw(KEYS.LAST_SEEN_VERSION, version); } catch (_) {}
  }

  on(MSG.MARK_UPDATE_SEEN, async () => {
    await markUpdateSeen(appVersion());
    return { ok: true };
  });

  // L'anteprima di un link è una visita al suo sito: mai a un indirizzo che l'avviso giudica sospetto, mai a un sito della
  // lista dei bloccati, nemmeno a metà dei rinvii (#1307). Per il bloccato si dice chi lo ferma, e il menu lo scrive.
  function anteprimaFerma(url) {
    const b = siteBlock.shouldBlockNavigation(url);
    if (b.block) return { bloccato: b.reason, host: b.host };
    if (globalThis.SN_LINK_SOSPETTO.analizza(url).length) return { sospetto: true };
    return null;
  }

  on(MSG.LINK_FERMATO, async (msg) => anteprimaFerma(String((msg && msg.url) || '')) || {});

  on('fetch_link_meta', async (msg, sender, origin) => {
    let rinvio = null;
    try {
      const url = String(msg.url || '');
      if (!url) return { ok: false, error: 'url mancante' };
      const ferma = anteprimaFerma(url);
      if (ferma) return { ok: false, ...ferma };
      // Leggere un collegamento per descriverlo lo chiede al suo sito: un segreto nell'indirizzo uscirebbe col solo tasto
      // destro (#810), e un collegamento che al clic chiede l'OK uscirebbe prima dell'OK (#1505). Fermato, la
      // spiegazione parte senza titolo e descrizione.
      const porta = await controllaUscita({ type: 'NAVIGA', url }, { sender });
      if (porta.blocca) return { ok: false, error: 'segreto' };
      const contattabile = await contattabilePrimaDelClic(url, {
        sender, porta, daFilo: isFilo(origin), proposta: msg.proposta === true, delSito: msg.delSito === true,
      });
      if (!contattabile) return { ok: false, error: 'da_confermare' };
      // Il tempo copre anche il corpo: un sito che lo manda a gocce non tiene aperto il menu in attesa.
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 4000);
      let html = '';
      try {
        // Esce come uscirebbe dalla scheda (proxy compreso) e mai verso la rete interna; senza cookie né Referer:
        // chi passa sopra un link non l'ha ancora aperto.
        const r = await perContoDellaScheda(sender, String(url), {
          signal: controller.signal, accetta: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          redirectAmmesso: (_da, prossimo) => !(rinvio = anteprimaFerma(prossimo.href)),
        });
        const reader = r.body?.getReader?.();
        if (reader) {
          const dec = new TextDecoder('utf-8', { fatal: false });
          let total = 0;
          while (total < 65536) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            html += dec.decode(value, { stream: true });
            if (html.includes('</head>')) break;
          }
          try { reader.cancel(); } catch (_) {}
        }
      } finally {
        clearTimeout(t);
      }
      const pick = (re) => { const m = html.match(re); return m ? m[1].trim() : ''; };
      const ogTitle = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
                      pick(/<title[^>]*>([^<]+)<\/title>/i);
      const ogDescription = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
                            pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
      return { ok: true, ogTitle, ogDescription };
    } catch (e) {
      if (rinvio) return { ok: false, ...rinvio };
      return { ok: false, error: e.message || String(e) };
    }
  });
};
