// «Salva video come…» su un video in streaming (#1488): yt-dlp lo scarica dalla pagina dentro una voce dei Download,
// con avanzamento, «Annulla» e «Riprova». Mai l'account dell'utente: niente cookie al programma (decisione dell'owner).
// Logica pura in ytdlp.js, programmi in strumentiVideo.js. Prove: tests/salva-video-streaming.spec.mjs.

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');
const Y = require('./ytdlp');

const t = (k, ...a) => { try { return globalThis.SN_I18N.t(k, ...a); } catch (_) { return k; } };

// Le frasi dei motivi stanno in i18n.js come `streaming_<motivo>`; le pagine le mostrano tali e quali.
const MOTIVI = Object.freeze(['eta', 'accesso', 'robot', 'protetto', 'spazio', 'diretta', 'sito', 'elenco',
  'non_disponibile', 'rete', 'aggiornare', 'programma', 'firma', 'piattaforma', 'proxy', 'generico']);
const frase = (motivo) => t(`streaming_${MOTIVI.includes(motivo) ? motivo : 'generico'}`);
// Quelli che ripetere non cambia: il video resta com'è.
const DEFINITIVI = Object.freeze(['eta', 'accesso', 'protetto', 'sito', 'elenco', 'piattaforma']);

// Il video cliccato può avere un indirizzo suo (l'anteprima di una home, il post di una bacheca): vale quello se è
// dello stesso sito della pagina, perché il programma parla solo col sito che l'utente sta guardando.
function indirizzoDaSalvare(pagina, delVideo) {
  const sito = (h) => {
    const p = String(h || '').toLowerCase().replace(/\.+$/, '').split('.');
    // «bbc.co.uk», «abc.com.au»: il nome del sito è il terzo pezzo da destra.
    const n = p.length >= 3 && p[p.length - 1].length === 2 && p[p.length - 2].length <= 3 ? 3 : 2;
    return p.slice(-n).join('.');
  };
  if (!delVideo) return pagina;
  try {
    const da = new URL(pagina);
    const v = new URL(delVideo, pagina);
    if (/^https?:$/.test(v.protocol) && sito(v.hostname) === sito(da.hostname)) return v.href;
  } catch (_) {}
  return pagina;
}

// Una cartella di lavoro sta fra i Download dell'utente col video a metà: non sopravvive al salvataggio. Uscendo da
// Filo si ferma il programma e la si toglie; quelle di un'uscita brusca le toglie l'avvio dopo, dall'elenco su disco.
const lavori = new Map();
function fileLavori() {
  try { return path.join(require('electron').app.getPath('userData'), 'programmi-video', 'lavori.json'); } catch (_) {}
  return process.env.FILO_USER_DATA ? path.join(process.env.FILO_USER_DATA, 'programmi-video', 'lavori.json') : '';
}
function scriviLavori() {
  const f = fileLavori();
  if (!f) return;
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify([...lavori.keys()]));
  } catch (_) {}
}
const togli = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (_) {} };

// All'avvio nessun salvataggio è vivo: quello che l'elenco ricorda è rimasto da un'uscita che non ha pulito.
function pulisciAvanzi() {
  const f = fileLavori();
  if (!f) return;
  let rimasti = [];
  try { rimasti = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return; }
  for (const dir of Array.isArray(rimasti) ? rimasti : []) {
    // Solo una cartella di lavoro di Filo: l'elenco sta su disco, e un nome qualunque non si cancella.
    if (typeof dir === 'string' && path.isAbsolute(dir) && /^\.filo-video-[A-Za-z0-9]+$/.test(path.basename(dir)) && !lavori.has(dir)) togli(dir);
  }
  scriviLavori();
}

let uscitaAgganciata = false;
function agganciaUscita() {
  if (uscitaAgganciata) return;
  uscitaAgganciata = true;
  try {
    require('electron').app.on('will-quit', () => {
      for (const [dir, figlio] of lavori) { fermaAlbero(figlio, { subito: true }); togli(dir); }
      lavori.clear();
      scriviLavori();
    });
  } catch (_) {}
}

// In prova il programma è uno finto: `FILO_YTDLP_COMANDO` è il comando come JSON, `FILO_FFMPEG` il percorso.
function comandoDiProva() {
  const c = process.env.FILO_YTDLP_COMANDO;
  if (!c) return null;
  try { const a = JSON.parse(c); return Array.isArray(a) && a.length ? a.map(String) : null; } catch (_) { return null; }
}

// yt-dlp per Windows e macOS è un lanciatore che apre un secondo processo: si ferma tutto l'albero, ffmpeg compreso.
// `subito`: Filo sta uscendo, e la cartella si toglie appena il comando torna.
function fermaAlbero(figlio, { subito = false } = {}) {
  if (!figlio || figlio.exitCode !== null || figlio.signalCode) return;
  if (process.platform === 'win32') {
    const a = ['/pid', String(figlio.pid), '/T', '/F'];
    try { (subito ? spawnSync : spawn)('taskkill', a, { windowsHide: true, stdio: 'ignore' }); } catch (_) {}
  } else {
    const segnale = subito ? 'SIGKILL' : 'SIGTERM';
    try { process.kill(-figlio.pid, segnale); } catch (_) { try { figlio.kill(segnale); } catch (_) {} }
  }
}

function eseguiYtdlp(comando, argomenti, { suEvento, fermato, cartella, proxy = '' }) {
  return new Promise((risolvi) => {
    let figlio;
    try {
      figlio = spawn(comando[0], [...comando.slice(1), ...argomenti], {
        // L'Electron di Filo fa da runtime JavaScript per le sfide di YouTube: nessun Node o Deno da installare.
        env: Y.ambiente({ ...process.env, ELECTRON_RUN_AS_NODE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }, proxy),
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      risolvi({ codice: -1, avvio: e });
      return;
    }
    if (cartella && lavori.has(cartella)) lavori.set(cartella, figlio);
    const leggi = (flusso) => {
      let resto = '';
      flusso.setEncoding('utf8');
      flusso.on('data', (pezzo) => {
        const righe = (resto + pezzo).split(/\r?\n/);
        resto = righe.pop();
        for (const r of righe) { const ev = Y.leggiRiga(r); if (ev) suEvento(ev, r); }
      });
      flusso.on('end', () => { if (resto) { const ev = Y.leggiRiga(resto); if (ev) suEvento(ev, resto); } });
    };
    leggi(figlio.stdout);
    leggi(figlio.stderr);
    const controlla = setInterval(() => { if (fermato()) fermaAlbero(figlio); }, 300);
    figlio.on('error', (e) => { clearInterval(controlla); risolvi({ codice: -1, avvio: e }); });
    figlio.on('close', (codice) => { clearInterval(controlla); risolvi({ codice }); });
  });
}

// Il file prodotto: l'unico «video.*» che non è un pezzo a metà.
function fileUscito(cartella) {
  let migliore = null;
  for (const nome of fs.readdirSync(cartella)) {
    if (!/^video\./.test(nome) || /\.(part|ytdl|temp|tmp)$|\.part-Frag|\.f\d+\./i.test(nome)) continue;
    const p = path.join(cartella, nome);
    const peso = fs.statSync(p).size;
    if (peso > 0 && (!migliore || peso > migliore.peso)) migliore = { p, peso, ext: path.extname(nome) };
  }
  return migliore;
}

// Il titolo è del sito: niente separatori né caratteri vietati da Windows, e al massimo 180 byte, perché Linux e
// macOS fermano un nome a 255 byte e un titolo giapponese ne usa tre per lettera.
function nomeSicuro(titolo, ext) {
  let pulito = String(titolo || '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^\.+/, '');
  while (Buffer.byteLength(pulito, 'utf8') > 180) pulito = Array.from(pulito).slice(0, -1).join('');
  pulito = pulito.replace(/[\s.]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(pulito)) pulito = `video ${pulito}`;
  return `${pulito || 'video'}${ext}`;
}

// `scegli(nome)` → { filePath } | { cancelled } | { error }: la domanda su dove salvare, come per gli altri file.
// `sposta(da, a)`: la consegna nel posto scelto. `sessione` e `paese`: quelli del lavoro da rifare, per «Riprova».
async function salva({ url, titolo = '', audio = false, scope = '', webContents = null, sessione = null, paese = null,
  riusa = '', scegli, sposta, downloads = require('./downloads'), strumenti = () => require('./strumentiVideo').strumenti(),
  uscita = (o) => require('./proxyTab').uscitaPerProgramma(o) }) {
  const ext = audio ? '.m4a' : '.mp4';
  const proposto = nomeSicuro(Y.titoloDaPagina(titolo), ext);
  const voce = downloads.beginManual({ url, filename: proposto, totalBytes: 0, scope, webContents, via: 'streaming', riusa });
  let ses = sessione;
  try { if (!ses && webContents && !webContents.isDestroyed?.()) ses = webContents.session; } catch (_) {}
  const fallisci = (motivo, dettaglio) => {
    if (dettaglio) console.warn('[Filo video] salvataggio non riuscito:', motivo, String(dettaglio).slice(0, 400));
    if (voce.cancelled()) return { ok: false, cancelled: true };
    voce.fail(frase(motivo), { riprovabile: !DEFINITIVI.includes(motivo) });
    // `annunciato`: l'avviso con il perché l'ha già dato la finestra (downloads.js), la pagina non lo ripete.
    return { ok: false, motivo, frase: frase(motivo), annunciato: true };
  };

  // La pagina esce da un proxy (la scheda, o la regola del sito): il programma esce dallo stesso, o non parte (#2301).
  let rete;
  try { rete = await uscita({ ses, url, paese }); } catch (_) { rete = { rifiuto: true, paese }; }
  voce.paese(rete && rete.paese);
  if (!rete || rete.rifiuto) return fallisci('proxy');
  if (voce.cancelled()) return { ok: false, cancelled: true };

  let programmi;
  const prendi = async (forza) => {
    const prova = comandoDiProva();
    if (prova) return { comando: prova, ffmpeg: process.env.FILO_FFMPEG || '' };
    const p = await strumenti().pronti({
      forza,
      avanza: ({ ricevuti, totale }) => {
        if (voce.cancelled()) return;
        if (!prendi.annunciato) { prendi.annunciato = true; voce.nota(t('streaming_fase_programma'), { azzera: true }); }
        voce.progress(ricevuti, totale);
      },
    });
    return { comando: [p.ytdlp], ffmpeg: p.ffmpeg };
  };
  try {
    programmi = await prendi(false);
  } catch (e) {
    return fallisci(e && e.motivo ? e.motivo : 'programma', e && e.message);
  }
  if (voce.cancelled()) return { ok: false, cancelled: true };

  // La cartella di lavoro sta accanto a dove finirà il file: la consegna è una rinomina, non la copia di un film.
  let lavoro;
  try {
    lavoro = fs.mkdtempSync(path.join(voce.cartella(), '.filo-video-'));
  } catch (e) {
    return fallisci(Y.motivoErrore(e && e.message) === 'spazio' ? 'spazio' : 'generico', e && e.message);
  }
  agganciaUscita();
  lavori.set(lavoro, null);
  scriviLavori();
  const pulisci = () => { togli(lavoro); lavori.delete(lavoro); scriviLavori(); };

  let destinazione = null;
  let noAlDialogo = false;
  let titoloVero = '';
  const chiedi = () => {
    if (!destinazione) destinazione = scegli(nomeSicuro(titoloVero || Y.titoloDaPagina(titolo), ext));
    return destinazione;
  };

  const tentativo = async () => {
    const avanzamento = Y.creaAvanzamento();
    let pezziLetti = false;
    let motivo = '';
    let dettaglio = '';
    voce.nota(t('streaming_fase_leggo'), { azzera: true });
    const esito = await eseguiYtdlp(programmi.comando, Y.argomenti({
      url, cartella: lavoro, audio, ffmpeg: programmi.ffmpeg, nodo: comandoDiProva() ? '' : process.execPath,
    }), {
      proxy: rete.proxy || '',
      cartella: lavoro,
      fermato: () => voce.cancelled() || noAlDialogo,
      suEvento: (ev, riga) => {
        if (ev.tipo === 'errore') {
          if (!motivo || motivo === 'generico') { motivo = ev.motivo; dettaglio = riga; }
          return;
        }
        if (ev.tipo === 'post') {
          if (ev.stato === 'started' && /Merger/i.test(ev.chi)) voce.nota(t('streaming_fase_unisco'));
          return;
        }
        // Il programma scrive i pezzi prima del primo byte: alla prima riga d'avanzamento ci sono già.
        if (!pezziLetti) {
          pezziLetti = true;
          try { avanzamento.pezzi(Y.leggiPezzi(fs.readFileSync(path.join(lavoro, Y.FILE_PEZZI), 'utf8'))); } catch (_) {}
        }
        avanzamento.leggi(ev);
        if (ev.titolo && ev.titolo !== titoloVero) { titoloVero = ev.titolo; voce.nomina(nomeSicuro(titoloVero, ext)); }
        // I primi byte vogliono dire che il video c'è: da qui si chiede dove salvarlo, intanto continua a scendere.
        if (!destinazione) {
          voce.nota('');
          chiedi().then((d) => { if (d && (d.cancelled || d.error)) { noAlDialogo = true; voce.cancel(); } });
        }
        const s = avanzamento.stato();
        voce.progress(s.ricevuti, s.totale);
      },
    });
    if (esito.avvio) return { motivo: 'programma', dettaglio: esito.avvio.message };
    if (voce.cancelled()) return { annullato: true };
    const uscito = fileUscito(lavoro);
    if (esito.codice === 0 && uscito && !motivo) return { uscito };
    return { motivo: motivo || 'generico', dettaglio: dettaglio || `codice ${esito.codice}` };
  };

  try {
    let r = await tentativo();
    // Un errore da programma vecchio: se ne cerca uno nuovo, e se c'è si riprova una volta sola.
    if (r.motivo === 'aggiornare' && !comandoDiProva()) {
      const prima = programmi.comando[0];
      try { programmi = await prendi(true); } catch (_) {}
      if (programmi.comando[0] !== prima && !voce.cancelled()) {
        for (const n of fs.readdirSync(lavoro)) { try { fs.rmSync(path.join(lavoro, n), { force: true, recursive: true }); } catch (_) {} }
        r = await tentativo();
      }
    }
    if (r.annullato || voce.cancelled()) return { ok: false, cancelled: true };
    if (!r.uscito) return fallisci(r.motivo, r.dettaglio);

    const d = await chiedi();
    if (!d || d.cancelled || voce.cancelled()) { if (!voce.cancelled()) voce.cancel(); return { ok: false, cancelled: true }; }
    if (d.error || !d.filePath) return fallisci('generico', d.error || 'destinazione non disponibile');
    // Il contenitore lo decide il sito (un audio può essere .webm): l'estensione segue il file vero.
    let finale = d.filePath;
    if (path.extname(finale).toLowerCase() !== r.uscito.ext.toLowerCase()) {
      finale = downloads.uniquePath(path.dirname(finale), `${path.basename(finale, path.extname(finale))}${r.uscito.ext}`);
    }
    if (!(await voce.permesso(path.basename(finale)))) return { ok: false, cancelled: true };
    try {
      await sposta(r.uscito.p, finale);
    } catch (e) {
      return fallisci(Y.motivoErrore(e && e.message) === 'spazio' ? 'spazio' : 'generico', e && e.message);
    }
    voce.done(finale);
    return { ok: true, path: finale, filename: path.basename(finale), annunciato: true };
  } finally {
    pulisci();
  }
}

module.exports = { salva, MOTIVI, frase, nomeSicuro, fileUscito, pulisciAvanzi, indirizzoDaSalvare };
