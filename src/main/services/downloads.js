// Gestore degli scaricamenti "nativi" della navigazione (#410.1).
//
// Cosa intercetta: i download che partono cliccando un link a un file (PDF,
// ZIP, allegato) o quando un server risponde con Content-Disposition:attachment.
// Electron emette `will-download` sulla sessione che ha originato la richiesta:
// qui ascoltiamo la sessione di navigazione predefinita e quelle per-scheda
// (privacy, proxy, incognito) e SEGUIAMO ogni download —
// nome, dimensione, byte ricevuti, stato — così le superfici di Filo possono
// mostrarne l'avanzamento fedele invece di lasciarlo "al buio".
//
// Intercetta il download che il browser fa partire da solo. "Salva
// immagine/video come…" (handlers/misc.js) NON passa di qui — deve scaricare i
// byte a mano per presentare il Referer della pagina — ma dal #436 si iscrive
// allo STESSO registro via beginManual(): per l'utente i due cammini sono la
// stessa cosa, quindi devono avere la stessa barra, lo stesso pannello, la
// stessa cronologia e la stessa domanda sui programmi (#1311).
//
// Filosofia: "l'attrito è negativo" + "non salvare mai [a mano]". Per questo NON
// apriamo un dialogo "Salva come" a ogni file: salviamo direttamente nella
// cartella Download di sistema (risolvendo le collisioni di nome con un suffisso
// " (2)", " (3)"…) e mostriamo il file a fine scaricamento con "Apri file" /
// "Apri cartella". L'utente non deve decidere dove mettere ogni cosa.
//
// Persistenza: la cronologia (nome, dimensione, stato, data, percorso) vive in
// chrome.storage.local sotto STORAGE_KEYS.DOWNLOADS e sopravvive al riavvio: la
// pagina elenco (#410.3) la leggerà da lì. Schema di una voce (`publicRecord`):
//   { id, filename, url, mime, totalBytes, receivedBytes, state, savePath,
//     startedAt, endedAt, paused, canResume, canPause }
//   state ∈ 'progressing' | 'paused' | 'completed' | 'interrupted' | 'cancelled'
//
// Incognito (#588.2): stesso controllo, ma la voce ha l'ambito della sua
// finestra (`_scope`): non va su disco, la vede solo quella finestra e sparisce
// quando si chiude. Il file scaricato resta nella cartella, come in ogni browser.

const path = require('node:path');
const fs = require('node:fs');
const { spingiAllaScheda } = require('./impostazioniPerOrigine');
const { vistePerAnnunci } = require('../tabs/riservaNuovaScheda');

// Tetto della cronologia: 200 è ampio per l'uso reale e non gonfia storage.json.
const HISTORY_LIMIT = 200;

// Stati non terminali: se li ritroviamo all'avvio (record salvato mentre un
// download era in corso, poi l'app si è chiusa) il DownloadItem non esiste più,
// quindi la voce va normalizzata a 'interrupted'.
const NON_TERMINAL = new Set(['progressing', 'paused', 'pending']);

// #588 — un file che il sistema ESEGUE non entra nella cartella Download senza
// una risposta: scende in una cartella riservata (`quarantena` dentro i dati
// dell'app), e da lì si sposta solo se l'utente dice di sì. Stato 'pending'.
// La lista delle estensioni e le frasi stanno in src/shared/eseguibili.js.
function ESE() { return globalThis.SN_ESEGUIBILI; }

// Config letta dalle impostazioni (security.downloads). Il default CHIEDE:
// finché le impostazioni non sono arrivate, un programma si ferma comunque.
let chiediEseguibili = true;
let sitiFidati = [];
// #950 — un nome sensato da solo agli scaricamenti che arrivano con un nome che non dice niente. Spento di
// serie: il contenuto del file va a un modello senza che l'utente l'abbia chiesto per quel file.
let nomeDaSolo = false;
// Senza modello l'avviso arriva una volta, non a ogni scaricamento; riacceso l'interruttore, di nuovo.
let avvisatoSenzaNome = false;

function configureFromSettings(settings) {
  const d = (settings && settings.security && settings.security.downloads) || {};
  chiediEseguibili = d.confirmExecutables !== false;
  sitiFidati = Array.isArray(d.trustedSites) ? d.trustedSites.slice() : [];
  const prima = nomeDaSolo;
  nomeDaSolo = !!(settings && settings.nomiSensati && settings.nomiSensati.scaricamenti === true);
  if (nomeDaSolo && !prima) avvisatoSenzaNome = false;
}

// Un programma da un sito che l'utente ha dichiarato fidato scende come un PDF.
// La fiducia vale solo per un sito CERTO: un file che può venire da un
// riquadro di altri non prende quella della pagina che lo ospita (#588).
// Dopo un rimando valgono il sito cliccato E quello che ha servito i byte,
// che il browser garantisce: fidarsi di chi serve il file non presta fiducia a nessuno (#588.3).
function chiedeConferma(sito, incerto, servito) {
  if (!chiediEseguibili) return false;
  try { if (servito && ESE().fidato(servito, sitiFidati)) return false; } catch (_) {}
  if (incerto) return true;
  try { return !ESE().fidato(sito, sitiFidati); } catch (_) { return true; }
}

// Da quale sito arriva il programma, deciso qui una volta per tutte le
// superfici. Regola unica: vale solo un'origine che il browser garantisce.
// L'indirizzo del file la porta quasi sempre; un `data:` o un `blob:null` no,
// e allora vale la pagina solo se TUTTI i suoi riquadri sono di quel sito: con
// un riquadro di altri (una pubblicità) il file può venire da lui, e il sito
// resta nominato ma incerto (#588).
function sitoDi(url, webContents) {
  const leggi = (x) => { try { return ESE().sito(x); } catch (_) { return ''; } };
  const dalFile = leggi(url);
  if (dalFile) return { sito: dalFile, incerto: false };
  let pagina = '';
  let incerto = true;
  try {
    if (webContents && !webContents.isDestroyed?.()) {
      pagina = leggi(webContents.getURL() || '');
      const riquadri = webContents.mainFrame ? webContents.mainFrame.framesInSubtree : [];
      incerto = !pagina || ESE().riquadriDiAltri(pagina, riquadri.map((f) => f.origin));
    }
  } catch (_) { incerto = true; }
  return { sito: pagina, incerto };
}

// Fonte di verità in memoria: scaricamenti in corso più la cronologia caricata da storage.
const records = new Map();
// I DownloadItem di Electron non sono serializzabili: non finiscono mai nello storage.
const liveItems = new Map();
// Scaricamenti a mano: niente DownloadItem, i byte li muove handlers/misc.js (beginManual).
const liveManual = new Map();
// Sessioni già agganciate (evita doppioni se una session torna più volte).
const attached = new WeakSet();

// Ambito di chi guarda: '' per le finestre normali, la partizione per una
// finestra incognito. Una voce si vede e si comanda solo dal suo ambito.
function scopeOfWindow(win) {
  if (!win || !win._filoIncognito) return '';
  return String((win._filoTabs && win._filoTabs.partition) || 'incognito');
}
const scopeOf = (rec) => (rec && rec._scope) || '';
function recordIn(id, scope) {
  const rec = records.get(id);
  return rec && scopeOf(rec) === String(scope || '') ? rec : null;
}
function windowsOf(scope) {
  try {
    return electron().BrowserWindow.getAllWindows()
      .filter((w) => w && !w.isDestroyed?.() && scopeOfWindow(w) === String(scope || ''));
  } catch (_) { return []; }
}

let loaded = false;

function electron() {
  return require('electron');
}

function uuid() {
  try { return require('node:crypto').randomUUID(); }
  catch (_) { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
}

function storageKey() {
  return (globalThis.SN_CONST && globalThis.SN_CONST.STORAGE_KEYS.DOWNLOADS) || 'downloads';
}

// Nome file sicuro: niente separatori, caratteri di controllo o traversal. Chromium ha già
// cambiato le barre in `_`, quindi ogni fila di due o più punti si comprime a uno, ovunque.
// Regola unica per i due cammini: anche «Salva immagine come…» propone nel dialogo questo nome (#1510).
function safeName(name, ripiego = 'download') {
  // I caratteri di direzione (U+202E & co.) non cambiano l'estensione vera ma
  // capovolgono come si LEGGE il nome: «fattura<RLO>txt.exe» si mostra come
  // «fatturaexe.txt». Il file su disco non deve poterlo fare (#588).
  let s = String(name || '');
  try { s = ESE().nomeVisibile(s); } catch (_) {}
  s = s.trim().replace(/[\x00-\x1f]/g, '');
  s = s.split(/[\\/]/).pop() || '';
  s = s.replace(/[<>:"|?*]/g, '_').replace(/\.{2,}/g, '.').replace(/^\.+/, '').trim();
  if (!s || s === '.' || s === '..') s = ripiego;
  return s.slice(0, 180);
}

// ─── marca d'origine (#1510) ─────────────────────────────────────────────
// Senza, un file aperto da Esplora risorse o dal Finder salta SmartScreen e Gatekeeper, e Office non lo apre in
// Visualizzazione protetta. Si scrive sempre, senza contare su Electron: un volume che non la regge (FAT, exFAT)
// o un xattr che manca lasciano valido lo scaricamento.

// Solo http(s), senza credenziali né frammento: nella marca va l'indirizzo, non le chiavi per entrarci.
function indirizzoPerMarca(u) {
  try {
    const x = new URL(String(u || ''));
    if (x.protocol !== 'http:' && x.protocol !== 'https:') return '';
    x.username = ''; x.password = ''; x.hash = '';
    return x.href;
  } catch (_) { return ''; }
}

// In incognito gli indirizzi sarebbero cronologia che sopravvive alla finestra: la zona basta ad armare gli avvisi.
// Da un altro sito la pagina vale solo per la sua origine, come il Referer che i browser presentano.
function testoZoneIdentifier({ hostUrl, referrerUrl, incognito } = {}) {
  const host = incognito ? '' : indirizzoPerMarca(hostUrl);
  let ref = incognito ? '' : indirizzoPerMarca(referrerUrl);
  if (ref && host && new URL(ref).origin !== new URL(host).origin) ref = `${new URL(ref).origin}/`;
  const righe = ['[ZoneTransfer]', 'ZoneId=3'];
  if (ref) righe.push(`ReferrerUrl=${ref}`);
  righe.push(`HostUrl=${host || 'about:internet'}`);
  return righe.join('\r\n') + '\r\n';
}

// 0081: messo in quarantena da chi ha scaricato, mai aperto: Gatekeeper chiede alla prima apertura.
function valoreQuarantena(ora = Date.now()) {
  return `0081;${Math.floor(ora / 1000).toString(16)};Filo;`;
}

// `sistema` ({ platform, execFile }) esiste per provare i rami degli altri sistemi da uno solo. Risolve true se la
// marca è scritta, false altrimenti; non rigetta mai.
function marcaOrigine(file, { hostUrl, referrerUrl, incognito } = {}, sistema = {}) {
  if (!file) return Promise.resolve(false);
  const piattaforma = sistema.platform || process.platform;
  if (piattaforma === 'win32') {
    // Sincrona: «Apri file» subito dopo lo scaricamento deve già trovarla.
    try {
      fs.writeFileSync(`${file}:Zone.Identifier`, testoZoneIdentifier({ hostUrl, referrerUrl, incognito }));
      return Promise.resolve(true);
    } catch (_) { return Promise.resolve(false); }
  }
  if (piattaforma === 'darwin') {
    return new Promise((resolve) => {
      try {
        const esegui = sistema.execFile || require('node:child_process').execFile;
        esegui('/usr/bin/xattr', ['-w', 'com.apple.quarantine', valoreQuarantena(), file], (err) => resolve(!err));
      } catch (_) { resolve(false); }
    });
  }
  // Linux e gli altri: nessuna marca che il sistema guardi prima di aprire un file.
  return Promise.resolve(false);
}

// HostUrl è chi ha servito i byte (dopo i rimandi), ReferrerUrl la pagina da cui è partito lo scaricamento.
function marcaDi(rec) {
  if (!rec || !rec.savePath) return Promise.resolve(false);
  return marcaOrigine(rec.savePath, { hostUrl: rec._servito || rec.url, referrerUrl: rec._pagina, incognito: !!scopeOf(rec) });
}

function paginaDi(webContents) {
  try { return webContents && !webContents.isDestroyed?.() ? String(webContents.getURL() || '') : ''; } catch (_) { return ''; }
}

// Un nome lunghissimo farebbe dell'avviso un riquadro enorme: si taglia in MEZZO, così
// restano leggibili sia l'inizio sia l'estensione.
function shortName(name, max = 44) {
  const s = String(name || '');
  if (s.length <= max) return s;
  const ext = path.extname(s).slice(0, 12);
  const head = s.slice(0, Math.max(4, max - ext.length - 4));
  return `${head}…${ext}`;
}

// Cartella Download di sistema (ripiego: home). Nei test un hook d'ambiente la porta sotto
// lo userData isolato, così uno spec fa un download vero senza il dialogo nativo.
function downloadsDir() {
  const test = process.env.FILO_DOWNLOAD_DIR;
  if (test) { try { fs.mkdirSync(test, { recursive: true }); } catch (_) {} return test; }
  try { return electron().app.getPath('downloads'); } catch (_) {}
  try { return electron().app.getPath('home'); } catch (_) { return process.cwd(); }
}

// Il percorso di uno scaricamento ancora vivo è preso anche se sul disco non c'è ancora: tre copie dello stesso file
// avviate insieme si scrivevano una sull'altra e ne restava una (#440).
function percorsoPreso(p) {
  for (const id of liveItems.keys()) {
    const r = records.get(id);
    if (r && r.savePath && stessoPercorso(r.savePath, p)) return true;
  }
  return false;
}

// Non si sovrascrive in silenzio uno scaricamento omonimo: «file.pdf» → «file (2).pdf».
function uniquePath(dir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(dir, filename);
  let n = 2;
  while (fs.existsSync(candidate) || percorsoPreso(candidate)) {
    candidate = path.join(dir, `${base} (${n})${ext}`);
    n++;
  }
  return candidate;
}

// Cartella di quarantena: dentro i dati dell'app, MAI dentro Download. Un
// programma in attesa di risposta sta qui, dove nessun gestore file lo mostra e
// nessun doppio clic lo trova.
function percorsoQuarantena() {
  let base = '';
  try { base = electron().app.getPath('userData'); } catch (_) { base = downloadsDir(); }
  return path.join(base, 'quarantena');
}
function quarantineDir() {
  const dir = percorsoQuarantena();
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return dir;
}

// Sposta il file approvato dalla quarantena alla cartella Download. La rinomina
// fallisce fra volumi diversi (userData e Download possono stare su dischi
// diversi): in quel caso si copia e si cancella. Ritorna false se non ce l'ha
// fatta — chi chiama lo DICE, non finge che il file sia arrivato.
function spostaFile(src, dst) {
  try { fs.renameSync(src, dst); return true; } catch (_) {}
  try { fs.copyFileSync(src, dst); } catch (_) { return false; }
  try { fs.unlinkSync(src); } catch (_) { /* copiato: il doppione in quarantena non è un guasto */ }
  return true;
}

// Il file in quarantena non serve più (rifiutato, rimosso, o app riavviata).
// Solo dentro la quarantena: un percorso letto dal disco può venire da un backup, e non si cancella niente fuori.
function rimuoviQuarantena(rec) {
  const p = rec && rec._quarantena && rec.savePath;
  if (!p) return;
  const dentro = path.relative(percorsoQuarantena(), path.resolve(String(p)));
  if (dentro && !dentro.startsWith('..') && !path.isAbsolute(dentro)) { try { fs.unlinkSync(p); } catch (_) {} }
  forgetExists(p);
  rec._quarantena = false;
}

// ─── il file può sparire DOPO lo scaricamento ───────────────────────────
// Uno scaricamento finito è una voce che punta a un percorso su disco, ma quel
// percorso è dell'utente: può spostare il file, rinominarlo, cestinarlo. Da quel
// momento "Apri file" non ha più niente da aprire, e va detto invece di fingere.
//
// Non ci si fida dell'esito dell'apertura: su Windows il sistema segnala il
// fallimento, su Linux `shell.openPath` risponde "riuscito" anche su un percorso
// inesistente. L'unica risposta uguale ovunque è guardare il disco PRIMA.
//
// La presenza passa da una cache a scadenza breve: la lista viene ri-lette a
// ogni avanzamento (fino a ~8 volte al secondo, fino a 200 voci), e senza cache
// ogni tacca di una barra di avanzamento costerebbe centinaia di stat.
const EXIST_TTL_MS = 1500;
const existCache = new Map();   // savePath → { at, ok }

function fileExists(p) {
  if (!p) return false;
  const now = Date.now();
  const hit = existCache.get(p);
  if (hit && now - hit.at < EXIST_TTL_MS) return hit.ok;
  let ok = false;
  try { ok = fs.existsSync(p); } catch (_) { ok = false; }
  if (existCache.size > 512) existCache.clear();   // tetto: è solo una cache
  existCache.set(p, { at: now, ok });
  return ok;
}

// Prima di un'azione dell'utente la cache non vale: può averlo spostato un istante fa,
// e su un'azione singola lo stat costa zero.
function forgetExists(p) { if (p) existCache.delete(p); }

// Solo per gli scaricamenti COMPLETATI: per uno interrotto il file non è mai esistito,
// e marcarlo «sparito» direbbe una cosa falsa.
function isMissing(r) {
  if (!r || r.state !== 'completed') return false;
  return !r.savePath || !fileExists(r.savePath);
}

// La sola forma che esce verso la shell e lo storage (niente riferimenti nativi).
function publicRecord(r) {
  return {
    id: r.id,
    filename: r.filename,
    url: r.url,
    mime: r.mime || '',
    totalBytes: r.totalBytes || 0,
    receivedBytes: r.receivedBytes || 0,
    state: r.state,
    // Finché il file è in quarantena il percorso NON esce: è una cartella
    // interna di Filo, e mostrarla (o lasciarla copiare) inviterebbe ad andarci.
    savePath: r.state === 'pending' ? '' : (r.savePath || ''),
    startedAt: r.startedAt || null,
    endedAt: r.endedAt || null,
    paused: !!r.paused,
    canResume: !!r.canResume,
    // Gli scaricamenti a mano non si mettono in pausa: la richiesta http resterebbe appesa e
    // il server la chiuderebbe. Il pannello nasconde il pulsante invece di offrirlo inerte.
    canPause: r.canPause !== false,
    // Il file non è più al suo posto: le superfici lo attenuano e tolgono «Apri file».
    missing: isMissing(r),
    // #588 — è un file che il sistema ESEGUE: le superfici lo marcano a vista e
    // "Apri file" chiede conferma. `site` è il sito da cui arriva, che è la
    // cosa da guardare prima di decidere.
    exe: !!r.exe,
    site: r.site || '',
    siteUncertain: !!r.siteUncertain,
    servedBy: r.servedBy || '',
    // #950 — il nome con cui il file era arrivato, finché Filo l'ha cambiato: le superfici offrono di rimetterlo.
    nomeOriginale: r.nomeOriginale || '',
    // #1287 — byte al secondo e secondi che restano, solo mentre scende (0 e null altrimenti).
    ...velocitaDi(r),
  };
}

function AV() { return globalThis.SN_SCARICAMENTI_AVANZAMENTO; }
function velocitaDi(r) {
  if (!r || r.state !== 'progressing' || !AV()) return { velocita: 0, restano: null };
  const v = AV().velocita(r._campioni, Date.now());
  return { velocita: Math.round(v), restano: AV().restano(r.receivedBytes, r.totalBytes, v) };
}
function campiona(r) {
  if (!r || !AV()) return;
  r._campioni = AV().campiona(r._campioni, Date.now(), r.receivedBytes);
}

// Ordina per inizio decrescente (più recente prima) — così la shell e la
// cronologia mostrano subito l'ultimo scaricamento.
function listRecords(scope = '') {
  return Array.from(records.values())
    .filter((r) => scopeOf(r) === String(scope || ''))
    .map(publicRecord)
    .sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
}

// ─── persistenza ─────────────────────────────────────────────────────────
// Una voce letta dal disco, che può venire anche da un backup importato: niente di vivo sopravvive al riavvio.
function daDisco(raw) {
  const rec = { ...raw };
  // I campi col trattino basso sono stato vivo di questa sessione: dal disco non arrivano, da un backup non si prendono.
  for (const k of Object.keys(rec)) if (k.startsWith('_')) delete rec[k];
  // Una conferma non sopravvive al riavvio: chi l'avrebbe data non è più
  // davanti a quell'avviso. Il programma resta fuori dalla cartella e la
  // voce dice che non è stato scaricato (#588).
  // La marca si ricalcola a ogni lettura perché l'elenco dei tipi cresce:
  // un .iso scaricato prima che ci entrasse si aprirebbe senza conferma
  // (#588.1). Solo in aggiunta: una marca già data non si toglie. Conta anche il
  // file su disco, che in una voce di un backup può chiamarsi altrimenti.
  if (rec.exe !== true) {
    try { rec.exe = ESE().eEseguibile(rec.filename) || (!!rec.savePath && ESE().eEseguibile(path.basename(String(rec.savePath)))); } catch (_) { rec.exe = false; }
    if (!rec.site) { try { rec.site = ESE().sito(rec.url); } catch (_) {} }
  }
  if (rec.state === 'pending') {
    rec._quarantena = true;
    rimuoviQuarantena(rec);
    rec.state = 'cancelled'; rec.savePath = ''; rec.paused = false; rec.canResume = false;
  } else if (NON_TERMINAL.has(rec.state)) {
    // Un download che risultava "in corso" alla chiusura non può più
    // proseguire: il suo DownloadItem è morto. Lo marchiamo interrotto.
    rec.state = 'interrupted'; rec.paused = false; rec.canResume = false;
  }
  return rec;
}

async function loadHistory() {
  if (loaded) return;
  loaded = true;
  try {
    const res = await chrome.storage.local.get(storageKey());
    const arr = res[storageKey()];
    for (const raw of Array.isArray(arr) ? arr : []) if (raw && raw.id) records.set(raw.id, daDisco(raw));
  } catch (_) { /* best-effort: senza cronologia si riparte da zero */ }
}

// L'elenco unito dall'importazione (#1256) entra da qui, non dal disco: questa mappa è la fonte di verità, e un
// salvataggio da qui avrebbe cancellato le voci del backup. Quelle di qui restano com'erano; oltre il tetto escono le
// più vecchie, come la conferma ha già detto.
function importa(lista) {
  if (!Array.isArray(lista)) return 0;
  let nuove = 0;
  for (const raw of lista) {
    if (!raw || !raw.id || records.has(raw.id)) continue;
    records.set(raw.id, daDisco(raw));
    nuove++;
  }
  const oltre = listRecords('').filter((r) => !NON_TERMINAL.has(r.state) && r.state !== 'pending').slice(HISTORY_LIMIT);
  for (const r of oltre) records.delete(r.id);
  if (nuove || oltre.length) { persist(); notifyTabs(); }
  return nuove;
}

function persist() {
  try {
    // Le voci incognito non toccano mai il disco.
    const arr = listRecords('').slice(0, HISTORY_LIMIT).map(({ velocita, restano, ...r }) => r);
    chrome.storage.local.set({ [storageKey()]: arr });
  } catch (_) { /* best-effort */ }
}

// ─── avanzamento sull'icona di Filo nella barra delle applicazioni ─────────
// Nella fila di tab non c'è un tasto dei download (#941): fuori dalla home l'avanzamento lo dice l'icona, come
// nei browser. Un programma in attesa di risposta non sta scaricando (#588); solo pause = barra ferma.
function avanzamentoBarra(voci) {
  let inCorso = 0; let inPausa = 0; let ricevuti = 0; let totali = 0;
  for (const r of voci) {
    if (!r || (r.state !== 'progressing' && r.state !== 'paused')) continue;
    if (r.state === 'progressing') inCorso++; else inPausa++;
    if (r.totalBytes > 0) { ricevuti += Math.min(r.receivedBytes || 0, r.totalBytes); totali += r.totalBytes; }
  }
  if (!inCorso && !inPausa) return { value: -1, mode: 'none' };
  const frazione = totali > 0 ? ricevuti / totali : null;
  if (!inCorso) return { value: frazione ?? 0, mode: 'paused' };
  if (frazione === null) return { value: 2, mode: 'indeterminate' };
  return { value: frazione, mode: 'normal' };
}

function aggiornaBarra(scope = '') {
  try {
    const voci = [];
    for (const r of records.values()) if (scopeOf(r) === scope) voci.push(r);
    const { value, mode } = avanzamentoBarra(voci);
    const firma = `${mode}:${value.toFixed(3)}`;
    for (const win of windowsOf(scope)) {
      if (!win._filoTabs || win._filoBarraDownload === firma) continue;
      try { win.setProgressBar(value, { mode }); win._filoBarraDownload = firma; } catch (_) {}
    }
  } catch (_) {}
}

// L'inizio e ogni esito diverso dal precedente (interrotto, poi ripreso e finito) entrano nel filo una volta (#1561).
function nelFilo(kind, rec, scope) {
  if (!rec) return;
  let quale = null;
  if (kind === 'start' && !rec._filoInizio) { rec._filoInizio = true; quale = rec; }
  else if ((kind === 'done' || kind === 'error') && rec._filoEsito !== rec.state) { rec._filoEsito = rec.state; quale = rec; }
  if (!quale) return;
  try { require('./accaduti').download(quale, { incognito: !!scope }); } catch (_) {}
}

// ─── broadcast verso la shell ───────────────────────────────────────────
function broadcast(kind, rec) {
  // Una voce tolta dall'elenco non torna nella barra con l'esito tardivo del
  // suo annullamento.
  if (kind !== 'removed' && rec && !records.has(rec.id)) { notifyTabs(); aggiornaBarra(scopeOf(rec)); return; }
  const scope = scopeOf(rec);
  aggiornaBarra(scope);
  nelFilo(kind, rec, scope);
  try {
    const payload = { kind, item: publicRecord(rec) };
    // Solo le finestre di Filo: un popup di accesso è la pagina di un sito, e il
    // record porta il percorso su disco.
    for (const win of windowsOf(scope)) {
      if (!win._filoTabs) continue;
      try { win.webContents.send('shell:download', payload); } catch (_) {}
    }
  } catch (_) {}
  notifyTabs(scope);
}

// Segnale senza contenuto alla pagina filo://downloads, che rilegge la lista dal
// canale DOWNLOADS_LIST. Ai siti non arriva: passa dalla lista delle spinte.
function notifyTabs(scope = '') {
  try {
    const type = (globalThis.SN_MSG && globalThis.SN_MSG.MSG.DOWNLOADS_UPDATED) || 'downloads_updated';
    const msg = { type };
    for (const win of windowsOf(scope)) {
      for (const { wc, inVista } of vistePerAnnunci(win._filoTabs)) spingiAllaScheda(wc, msg, { inVista });
    }
  } catch (_) {}
}

// Lo scaricamento non riuscito è un errore visto (#1461): si conta il tipo, mai il nome del file.
function contaNonRiuscito(rec) {
  try { globalThis.SN_CONTATORI_MAIN && globalThis.SN_CONTATORI_MAIN.erroreVisto('avviso:download_failed', { incognito: !!scopeOf(rec) }); } catch (_) {}
}

// I contatori (#1469): come è finito, quanto pesava e quanto è durato, in fasce; dei programmi solo la classe.
// Mai il nome, l'estensione o il sito.
function contaNav(rec, scegli) {
  try {
    const N = globalThis.SN_CONTATORI && globalThis.SN_CONTATORI.NAV;
    const M = globalThis.SN_CONTATORI_MAIN;
    if (N && M) M.navigazione(scegli(N), { incognito: !!scopeOf(rec) });
  } catch (_) {}
}
function contaFine(rec) {
  const ms = Date.parse(rec.endedAt || '') - Date.parse(rec.startedAt || '');
  const byte = Math.max(Number(rec.totalBytes) || 0, Number(rec.receivedBytes) || 0);
  contaNav(rec, (N) => N.scaricamento(rec.state, byte, ms));
}
function contaProgramma(rec, evento) {
  let classe = 'programma';
  try { if (ESE().eImmagineDisco(rec.filename)) classe = 'immagine_disco'; } catch (_) {}
  contaNav(rec, (N) => N.programma(classe, evento));
}

function shellToast(text, opts, scope = '') {
  try {
    for (const win of windowsOf(scope)) {
      if (!win._filoTabs) continue;
      try { win.webContents.send('shell:toast', { text, opts }); } catch (_) {}
    }
  } catch (_) {}
}

// #412 — dopo aver preso in carico un download, avvisa il gestore schede della
// finestra che possiede la webContents che l'ha originato. Serve a chiudere una
// scheda rimasta VUOTA quando un link "Scarica" con target=_blank apre una nuova
// scheda che si trasforma subito in scaricamento (nessuna pagina si committa
// mai). Best-effort e non bloccante: se non c'è una scheda da chiudere è un no-op.
// `info` ({ url, chain, filename, exe }) serve al giudizio sul sito della scheda (tabs/tabSafebrowse.js).
function notifyDownloadStarted(webContents, info = null) {
  if (!webContents) return;
  try {
    const { BrowserWindow } = electron();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win || win.isDestroyed?.()) continue;
      const tm = win._filoTabs;
      if (tm && typeof tm.handleDownloadStarted === 'function') {
        try { tm.handleDownloadStarted(webContents, info); } catch (_) {}
      }
    }
  } catch (_) {}
}

// #588 — la domanda «scaricarlo?» è la riga in attesa del pannello scaricamenti,
// che la barra apre sopra la pagina: un avviso della barra nell'area pagina
// resterebbe sotto la vista nativa, invisibile. Solo la finestra da cui parte.
function chiediNellaFinestra(webContents, rec) {
  contaProgramma(rec, 'domanda');
  try {
    const finestre = windowsOf(scopeOf(rec)).filter((w) => w._filoTabs);
    const tiene = (w) => (w._filoTabs.tabs || []).some((t) => {
      try { return t.view.webContents === webContents; } catch (_) { return false; }
    });
    const win = finestre.find(tiene) || finestre.find((w) => w.isFocused?.()) || finestre[0];
    if (win && !win.isDestroyed?.()) win.webContents.send('shell:download', { kind: 'ask', item: publicRecord(rec) });
  } catch (_) {}
}

// Chiude uno scaricamento arrivato in fondo: se veniva dalla quarantena (#588)
// il file entra ORA nella cartella Download, e solo se ci entra davvero la voce
// dice "completato".
function completa(rec) {
  if (rec._quarantena) {
    const dest = uniquePath(downloadsDir(), rec.filename);
    if (spostaFile(rec.savePath, dest)) {
      forgetExists(rec.savePath);
      rec.savePath = dest;
      rec.filename = path.basename(dest);
      rec._quarantena = false;
    } else {
      // Il file non è arrivato dove l'utente lo cercherà: dirlo è l'unica
      // risposta onesta (e la quarantena si svuota, così non resta un programma
      // in un posto che nessuno guarda).
      rimuoviQuarantena(rec);
      rec.state = 'interrupted';
      rec.savePath = '';
      persist();
      broadcast('error', rec);
      contaNonRiuscito(rec);
      contaFine(rec);
      shellToast(`Scaricamento non riuscito: ${shortName(rec.filename)}`, { durationSec: 8, tipo: 'download_failed', indirizzo: rec.url }, scopeOf(rec));
      return;
    }
  }
  marcaDi(rec);
  rec.state = 'completed';
  if (!rec.endedAt) rec.endedAt = new Date().toISOString();
  persist();
  broadcast('done', rec);
  contaFine(rec);
  if (!scopeOf(rec)) { try { globalThis.SN_FILO_PARLA?.segnala({ tipo: 'download', testo: rec.filename }); } catch (_) {} }
  // Toast di conferma con azioni: le azioni dichiarative sono tradotte dalla
  // shell in api.downloads.openFile / openFolder (vedi shell.js onToast).
  shellToast(`Scaricato: ${shortName(rec.filename)}`, {
    durationSec: 8,
    tipo: 'download_finito',
    indirizzo: rec.url,
    actions: [
      { label: 'Apri file', openDownloadId: rec.id },
      { label: 'Apri cartella', revealDownloadId: rec.id },
    ],
  }, scopeOf(rec));
  if (nomeDaSolo) nominaDaSolo(rec);
}

// #950 — solo i nomi che non dicono niente («scan_00231.pdf»): un nome scelto da qualcuno resta. L'incognito
// no: lì il contenuto di un file non parte verso un modello senza che l'utente lo chieda.
async function nominaDaSolo(rec) {
  const NF = globalThis.SN_NOMI_FILE;
  if (!NF || scopeOf(rec) || rec.exe || !rec.savePath) return;
  if (!NF.tipoDi(rec.filename) || !NF.nomeSenzaSenso(rec.filename)) return;
  const Nomi = require('./nomiFile');
  const letto = rec.savePath;
  const p = await Nomi.proponi(letto);
  if (!records.has(rec.id) || rec.state !== 'completed') return;
  // Un nome dato dall'utente mentre il modello leggeva vince sempre su quello automatico.
  if (rec.savePath !== letto) return;
  if (!p.ok) {
    // Senza modello, o col modello che non risponde, l'utente che ha acceso la funzione deve saperlo.
    if (p.errore === 'modello' && !avvisatoSenzaNome) {
      avvisatoSenzaNome = true;
      shellToast(`Nessun nome dato a ${shortName(rec.filename)}. ${p.frase}`, { durationSec: 10, tipo: 'download_senza_nome', indirizzo: rec.url }, '');
    }
    return;
  }
  const r = await Nomi.rinomina(letto, p.proposta, { daSola: 'automazione' });
  if (!r.ok || r.invariato) return;
  require('./contatoriFinestra').misura('rinominato');
  shellToast(`Nome dato: ${shortName(r.nome)}`, {
    durationSec: 10,
    tipo: 'download_nome_dato',
    indirizzo: rec.url,
    actions: [
      { label: 'Annulla', rimettiNomeDownloadId: rec.id },
      { label: 'Apri file', openDownloadId: rec.id },
    ],
  }, '');
}

const stessoPercorso = (a, b) => (process.platform === 'win32' || process.platform === 'darwin'
  ? String(a).toLowerCase() === String(b).toLowerCase()
  : String(a) === String(b));

// #950 — un file dell'elenco cambiato di nome da Filo (da qualunque strada): la voce lo segue, invece di
// dichiararlo sparito, e ricorda il nome di arrivo per poterlo rimettere.
function rinominato(da, a) {
  let toccati = 0;
  for (const rec of records.values()) {
    if (!rec.savePath || !stessoPercorso(rec.savePath, da)) continue;
    if (!rec.nomeOriginale) rec.nomeOriginale = rec.filename;
    forgetExists(rec.savePath);
    rec.savePath = a;
    rec.filename = path.basename(a);
    if (rec.filename === rec.nomeOriginale) rec.nomeOriginale = '';
    forgetExists(a);
    toccati += 1;
    broadcast('renamed', rec);
  }
  if (toccati) persist();
  return toccati;
}

function percorsoDi(id, scope = '') {
  const rec = recordIn(id, scope);
  return rec && rec.state === 'completed' ? (rec.savePath || '') : '';
}

// Il sito da cui è arrivato un file scaricato (per id o per percorso), '' se non è uno scaricamento: le azioni sul file
// se ne vanno con le pagine di quel sito (#1561).
function indirizzoDi({ id, percorso } = {}) {
  let rec = id != null ? records.get(String(id)) : null;
  if (!rec && typeof percorso === 'string' && percorso) {
    const p = path.resolve(percorso);
    for (const r of records.values()) if (r.savePath && stessoPercorso(r.savePath, p)) { rec = r; break; }
  }
  return rec && /^https?:\/\//i.test(String(rec.url || '')) ? rec.url : '';
}

async function rimettiNome(id, scope = '') {
  const rec = recordIn(id, scope);
  if (!rec) return { ok: false, frase: 'Questo scaricamento non è più nell’elenco' };
  if (!rec.nomeOriginale) return { ok: false, frase: 'Ha già il nome con cui era arrivato' };
  const r = await require('./nomiFile').rinomina(rec.savePath, rec.nomeOriginale, { esatto: true });
  if (!r.ok) return { ok: false, frase: r.frase };
  return { ok: true, nome: r.nome, cambiato: !!r.cambiato };
}

// ─── intercettazione ────────────────────────────────────────────────────
function onWillDownload(item, webContents, scope = '', ses = null) {
  const filename = safeName(item.getFilename() || (function () {
    try { return decodeURIComponent(new URL(item.getURL()).pathname.split('/').pop() || ''); }
    catch (_) { return ''; }
  })() || 'download');

  const url = item.getURL();
  // La fiducia si lega al PRIMO indirizzo della catena di rimandi, quello
  // cliccato; chi ha servito il file davvero va comunque nominato (#588.3).
  let primo = url;
  try { const c = item.getURLChain(); if (Array.isArray(c) && c[0]) primo = c[0]; } catch (_) {}
  // «Riprova» riempie la stessa voce: avvisi, righe e carte che la nominano seguono il nuovo tentativo.
  const ripresa = prendiRiprova(scope, primo);
  const id = ripresa ? ripresa.id : uuid();
  const { sito, incerto } = sitoDi(primo, webContents);
  let servito = '';
  try { servito = ESE().servitoDa(sito, url); } catch (_) {}
  let exe = false;
  try { exe = ESE().eEseguibile(filename); } catch (_) {}
  // Un programma si ferma PRIMA della cartella Download: i byte scendono in
  // quarantena e ci restano finché l'utente non risponde (#588). Il resto dei
  // file non cambia di una virgola: l'attrito va solo dove serve.
  let finale = '';
  try { finale = ESE().sito(url); } catch (_) {}
  const attesa = exe && chiedeConferma(sito, incerto, finale);

  // Salvataggio diretto nella cartella Download (niente dialogo "Salva come":
  // vedi nota di filosofia in testa al file). setSavePath disattiva il dialogo
  // nativo — indispensabile anche per i test headless.
  let savePath = '';
  try {
    savePath = uniquePath(attesa ? quarantineDir() : downloadsDir(), filename);
    item.setSavePath(savePath);
  } catch (_) { /* se fallisce, Electron mostrerà comunque il suo dialogo */ }

  const rec = {
    id,
    filename: path.basename(savePath || filename),
    url,
    mime: item.getMimeType() || '',
    totalBytes: item.getTotalBytes() || 0,
    receivedBytes: item.getReceivedBytes() || 0,
    state: attesa ? 'pending' : 'progressing',
    savePath,
    startedAt: new Date().toISOString(),
    endedAt: null,
    paused: false,
    canResume: false,
    exe,
    site: sito,
    siteUncertain: incerto,
    servedBy: servito,
    _pagina: paginaDi(webContents) || (ripresa ? ripresa._pagina || '' : ''),
    _quarantena: attesa,
    _scope: scope || '',
    _sessione: ses || (webContents && !webContents.isDestroyed?.() ? webContents.session : null),
  };
  campiona(rec);
  records.set(id, rec);
  liveItems.set(id, item);
  persist();
  broadcast('start', rec);
  if (attesa) chiediNellaFinestra(webContents, rec);
  // #412 — chiudi la scheda "vuota" aperta apposta da un link Scarica
  // target=_blank. Deferito così il ciclo di vita del download (già preso in
  // carico qui sopra) è completamente cablato prima di toccare l'albero delle view.
  let chain = [];
  try { chain = item.getURLChain(); } catch (_) {}
  setImmediate(() => notifyDownloadStarted(webContents, { url, chain, filename, exe }));

  // Il segnale non è il TEMPO senza byte (un server lento veniva ucciso con un errore falso)
  // ma la caduta dichiarata da Chromium: grazia alla ripresa, poi fallisce se non avanza.
  const STALL_MS = 3 * 60 * 1000;
  const INTERRUPT_GRACE_MS = 20_000;
  let maxRecv = 0;

  function armWatchdog() {
    if (rec._stallTimer) clearTimeout(rec._stallTimer);
    rec._stallTimer = setTimeout(() => {
      rec._stallTimer = null;
      if (rec._final || rec.paused) return;
      // Rete di sicurezza: si mette in PAUSA invece di annullare, perché pause() lascia su disco
      // il pezzo già scaricato mentre cancel() lo butta. E un avviso arriva comunque.
      finalize('interrupted');
      try { if (!item.isPaused()) item.pause(); } catch (_) {}
    }, STALL_MS);
  }

  // Chromium ha segnalato una caduta: si aspetta che si riprenda da solo.
  function armInterruptGrace() {
    if (rec._resumeTimer) return;   // finestra già aperta: non riavviarla
    rec._resumeTimer = setTimeout(() => {
      rec._resumeTimer = null;
      if (rec._final || rec.paused) return;
      // Passata la grazia è un guasto, non lentezza: annullare ferma il ciclo di ritentativi.
      // finalize PRIMA di cancel(): 'done' arriva sincrono e l'esito diventerebbe «annullato».
      finalize('interrupted');
      try { item.cancel(); } catch (_) {}
    }, INTERRUPT_GRACE_MS);
  }

  function clearInterruptGrace() {
    if (rec._resumeTimer) { clearTimeout(rec._resumeTimer); rec._resumeTimer = null; }
  }

  // Chiude UNA volta sola il ciclo di vita del download, successo o fallimento.
  function finalize(state) {
    if (rec._final) return;
    rec._final = true;
    if (rec._stallTimer) { clearTimeout(rec._stallTimer); rec._stallTimer = null; }
    clearInterruptGrace();
    liveItems.delete(id);
    rec.endedAt = new Date().toISOString();
    rec.paused = false;
    rec.canResume = false;
    try { rec.savePath = item.getSavePath() || rec.savePath; } catch (_) {}
    rec.filename = rec.savePath ? path.basename(rec.savePath) : rec.filename;

    if (state === 'completed') {
      // I byte sono arrivati ma il programma aspetta ancora una risposta: resta
      // in quarantena, e nessun avviso dice "scaricato" per un file che non è
      // nella cartella Download (#588). Ci pensa confirm(), quando l'utente
      // risponde.
      if (rec.state === 'pending') { rec._arrivato = true; persist(); broadcast('progress', rec); return; }
      completa(rec);
    } else {
      // Rifiutato, caduto o annullato: il pezzo in quarantena non deve restare.
      rimuoviQuarantena(rec);
      // 'cancelled' (annullato dall'utente) o 'interrupted' (rete caduta, 4xx/5xx,
      // spazio finito): niente silenzio.
      rec.state = state === 'cancelled' ? 'cancelled' : 'interrupted';
      persist();
      broadcast('error', rec);
      contaFine(rec);
      if (rec.state !== 'cancelled') {
        contaNonRiuscito(rec);
        shellToast(`Scaricamento non riuscito: ${shortName(rec.filename)}`, { durationSec: 8, tipo: 'download_failed', indirizzo: rec.url }, scopeOf(rec));
      }
    }
  }

  armWatchdog();
  item.on('updated', (_e, state) => {
    if (rec._final) return;
    const recv = item.getReceivedBytes() || 0;
    rec.receivedBytes = recv;
    if (!rec.totalBytes) rec.totalBytes = item.getTotalBytes() || 0;
    rec.paused = item.isPaused();
    rec.canResume = item.canResume();

    // Terreno guadagnato: una ripresa produttiva perdona le cadute precedenti (rete ballerina),
    // quindi si ricarica il cronometro e si chiude la finestra di grazia.
    if (recv > maxRecv) { maxRecv = recv; clearInterruptGrace(); armWatchdog(); }

    // In attesa di risposta (#588): i byte scendono in quarantena, ma la voce
    // NON diventa "in corso" — non lo è, finché non c'è un sì. Gli argini
    // contro il silenzio restano attivi: un trasferimento morto va dichiarato
    // anche mentre l'avviso è a schermo.
    const inAttesa = rec.state === 'pending';

    if (rec.paused && !inAttesa) {
      // Pausa volontaria dell'utente: non è un guasto, sospendi ogni timer.
      rec.state = 'paused';
      // Alla ripresa la velocità riparte da lì, non dalla media col tempo fermo.
      rec._campioni = [];
      clearInterruptGrace();
      if (rec._stallTimer) { clearTimeout(rec._stallTimer); rec._stallTimer = null; }
    } else if (state === 'interrupted') {
      // Chromium dichiara caduto il trasferimento: gli concediamo la finestra di
      // grazia per riprendersi da solo. Per l'utente resta "in corso" — se
      // riparte davvero non deve vedere allarmi inutili.
      if (!inAttesa) rec.state = 'progressing';
      armInterruptGrace();
    } else {
      if (!inAttesa) rec.state = 'progressing';
      if (!rec._stallTimer) armWatchdog();   // ripreso dopo una pausa
    }
    if (!rec.paused) campiona(rec);
    broadcast('progress', rec);
  });

  item.once('done', (_e, state) => {
    rec.receivedBytes = item.getReceivedBytes() || rec.receivedBytes;
    if (!rec.totalBytes) rec.totalBytes = item.getTotalBytes() || rec.receivedBytes;
    finalize(state);
  });
}

// Scaricamenti a mano (#436): «Salva immagine come…» muove i byte da sé, unico modo di
// presentare il Referer; senza questo registro quel cammino resterebbe muto per l'utente.
// Risolve quando la marca d'origine è sul file finale (o non si è potuta scrivere).
function finalizeManual(rec, state, savePath) {
  if (rec._final) return Promise.resolve(false);
  rec._final = true;
  liveManual.delete(rec.id);
  // Una voce chiusa non aspetta più risposte: chi attendeva la domanda prosegue con un no.
  if (rec._sblocca) rec._sblocca(false);
  rec.endedAt = new Date().toISOString();
  rec.paused = false;
  rec.canResume = false;
  if (savePath) {
    rec.savePath = savePath;
    rec.filename = path.basename(savePath);
    // Il nome definitivo lo sceglie l'utente nel dialogo di salvataggio: la
    // marca "è un programma" si rifà su QUELLO, non sul nome proposto.
    try { rec.exe = ESE().eEseguibile(rec.filename); } catch (_) {}
  }
  const marca = state === 'completed' ? marcaDi(rec) : Promise.resolve(false);
  rec.state = state;
  persist();
  broadcast(state === 'completed' ? 'done' : 'error', rec);
  contaFine(rec);
  // Nessun avviso a fine corsa: chi salva dal menu ha già la conferma nella pagina.
  return marca;
}

// `webContents`: la scheda da cui parte, per aprire la domanda nella sua finestra.
function beginManual({ url, filename, totalBytes, scope, servedFrom, webContents } = {}) {
  const id = uuid();
  const nome = safeName(filename || 'download');
  const indirizzo = String(url || '');
  const marca = (fn, ripiego) => { try { return fn(); } catch (_) { return ripiego; } };
  const rec = {
    id,
    filename: nome,
    url: indirizzo,
    // Anche "Salva immagine/video come…" può depositare un programma: la voce
    // lo dichiara e "Apri file" chiede conferma come per ogni altro (#588).
    exe: marca(() => ESE().eEseguibile(nome), false),
    site: marca(() => ESE().sito(indirizzo), ''),
    servedBy: marca(() => ESE().servitoDa(indirizzo, servedFrom), ''),
    _servito: String(servedFrom || indirizzo),
    _pagina: paginaDi(webContents),
    mime: '',
    totalBytes: Number(totalBytes) > 0 ? Number(totalBytes) : 0,
    receivedBytes: 0,
    state: 'progressing',
    savePath: '',
    startedAt: new Date().toISOString(),
    endedAt: null,
    paused: false,
    canResume: false,
    canPause: false,
    _scope: scope || '',
    _sessione: webContents && !webContents.isDestroyed?.() ? webContents.session : null,
  };
  campiona(rec);
  records.set(id, rec);
  const attese = [];
  rec._sblocca = (si) => { for (const r of attese.splice(0)) r(si); };
  const requestCancel = () => { rec._cancelled = true; finalizeManual(rec, 'cancelled'); };
  // La risposta alla domanda «scaricarlo?», da confirmDownload: un no chiude la voce come «Annulla».
  const rispondi = (si) => {
    if (!si) { requestCancel(); return; }
    rec._consenso = true;
    rec.state = 'progressing';
    persist();
    broadcast('progress', rec);
    rec._sblocca(true);
  };
  liveManual.set(id, { cancel: requestCancel, rispondi });
  persist();
  broadcast('start', rec);

  // #1311 — un programma non arriva dove l'ha scelto l'utente senza la domanda dei download da link: la regola è
  // quella di chiedeConferma, sul nome FINALE; un sì vale per la voce intera, anche se nel dialogo il nome cambia.
  const permesso = (nome) => {
    if (rec._final) return Promise.resolve(false);
    const n = safeName(nome || rec.filename);
    const exe = marca(() => ESE().eEseguibile(n), true);
    if (!exe || rec._consenso || !chiedeConferma(rec.site, false, servedFrom)) return Promise.resolve(true);
    return new Promise((resolve) => {
      attese.push(resolve);
      if (rec.state === 'pending') return;
      rec.filename = n;
      rec.exe = true;
      rec.state = 'pending';
      persist();
      broadcast('progress', rec);
      chiediNellaFinestra(webContents, rec);
    });
  };

  // Su rete veloce l'evento 'data' arriva migliaia di volte al secondo e ogni
  // broadcast attraversa l'IPC verso ogni finestra: senza freno l'avanzamento
  // costerebbe più del download. ~8 aggiornamenti al secondo bastano all'occhio.
  const MIN_PUSH_MS = 120;
  let lastPush = 0;

  return {
    id,
    cancelled: () => !!rec._cancelled,
    permesso,
    // Dove far crescere il file parziale: in quarantena finché il programma aspetta la risposta (#588).
    cartella: () => (rec.state === 'pending' ? quarantineDir() : downloadsDir()),
    progress(received, total) {
      if (rec._final) return;
      rec.receivedBytes = Number(received) || 0;
      if (Number(total) > 0) rec.totalBytes = Number(total);
      const now = Date.now();
      if (now - lastPush < MIN_PUSH_MS) return;
      lastPush = now;
      campiona(rec);
      broadcast('progress', rec);
    },
    done(savePath) {
      // L'ultimo progress() può essere caduto nel freno: a file completo i byte ricevuti SONO
      // il totale, e la riga non deve restare ferma al 95% a scaricamento finito.
      if (rec.totalBytes > 0) rec.receivedBytes = rec.totalBytes;
      return finalizeManual(rec, 'completed', savePath);
    },
    fail() { finalizeManual(rec, 'interrupted'); },
    cancel: requestCancel,
  };
}

// Aggancia will-download a una sessione (idempotente). `scope` è la partizione
// di una finestra incognito, '' per il resto (vedi scopeOfWindow).
function attachSession(ses, { scope = '' } = {}) {
  if (!ses || attached.has(ses)) return;
  attached.add(ses);
  try {
    ses.on('will-download', (e, item, webContents) => {
      // #965 — un file da avviso chiesto da una pagina (link con «download», nome dato dal sito) si ferma all'avviso
      // della sua scheda prima di scendere, come il clic sul link: confermato, riparte da capo.
      let fermo = false;
      try { fermo = typeof globalThis.SN_SB_SCARICAMENTO === 'function' && globalThis.SN_SB_SCARICAMENTO(item, webContents) === true; } catch (_) {}
      if (fermo) { e.preventDefault(); return; }
      onWillDownload(item, webContents, scope);
    });
  } catch (_) {}
}

// Una finestra incognito si è chiusa: le sue voci spariscono con lei. Un
// programma ancora in attesa non ha più nessuno che risponda, e la quarantena
// si svuota; uno scaricamento in corso arriva in fondo senza più una riga.
function forgetScope(scope) {
  if (!scope) return;
  for (const [id, rec] of Array.from(records)) {
    if (scopeOf(rec) !== scope) continue;
    if (rec.state === 'pending') confirmDownload(id, false, scope);
    records.delete(id);
    liveManual.delete(id);
  }
}

async function init() {
  await loadHistory();
  // Nessuna attesa sopravvive a un riavvio (loadHistory le chiude): quello che
  // resta in quarantena è orfano, e un programma orfano non deve restare su
  // disco. Si svuota all'avvio, quando non può esserci niente di vivo dentro.
  try {
    const dir = quarantineDir();
    for (const nome of fs.readdirSync(dir)) {
      try { fs.rmSync(path.join(dir, nome), { recursive: true, force: true }); } catch (_) {}
    }
  } catch (_) {}
  try { attachSession(electron().session.defaultSession); } catch (_) {}
}

// ─── API per gli handler IPC (comandi dalla shell) ─────────────────────────
function list(scope = '') { return listRecords(scope); }

function clearCompleted(scope = '') {
  for (const [id, rec] of records) {
    if (scopeOf(rec) === scope && !NON_TERMINAL.has(rec.state)) records.delete(id);
  }
  persist();
  return listRecords(scope);
}

function remove(id, scope = '') {
  if (!recordIn(id, scope)) return listRecords(scope);
  // Un download in corso non si "rimuove" dalla lista: prima lo si annulla.
  // Vale per entrambi i cammini, nativo e "a mano".
  if (liveItems.has(id)) { try { liveItems.get(id).cancel(); } catch (_) {} }
  if (liveManual.has(id)) { try { liveManual.get(id).cancel(); } catch (_) {} }
  // Togliere dall'elenco una voce in attesa È una risposta: il programma in
  // quarantena se ne va con lei, invece di restare su disco senza più nessuno
  // che possa deciderne la sorte (#588).
  const rec = records.get(id);
  if (rec) rimuoviQuarantena(rec);
  records.delete(id);
  liveItems.delete(id);
  liveManual.delete(id);
  persist();
  // La barra in alto deve saperlo: una domanda «scaricarlo?» ancora a schermo
  // per questa voce si ritira (#588).
  if (rec) broadcast('removed', rec);
  return listRecords(scope);
}

// Messaggio unico: barra in alto e pagina elenco devono dirlo con le stesse parole.
const MISSING_TEXT = 'Il file non c’è più: forse è stato spostato o cancellato';
const MISSING_FOLDER_TEXT = 'La cartella non c’è più: forse è stata spostata o cancellata';

// #588 — risposta alla domanda "questo programma lo scarico?". `allow` viene da
// un clic dell'utente: un no cancella il file dalla quarantena, un sì lo fa
// proseguire (o lo sposta subito, se i byte sono già tutti arrivati).
function confirmDownload(id, allow, scope = '') {
  const rec = recordIn(id, scope);
  if (!rec || rec.state !== 'pending') {
    return { ok: false, error: 'Questo scaricamento non aspetta più una risposta', items: listRecords(scope) };
  }
  contaProgramma(rec, allow ? 'scaricato' : 'rifiutato');
  // «Salva immagine come»: i byte e il file li muove chi l'ha chiesto, che aspetta questa risposta (#1311).
  const manual = liveManual.get(id);
  if (manual && manual.rispondi) { manual.rispondi(!!allow); return { ok: true, items: listRecords(scope) }; }
  if (!allow) {
    const item = liveItems.get(id);
    rec._final = true;   // il 'done' che segue cancel() non deve riscrivere l'esito
    if (rec._stallTimer) { clearTimeout(rec._stallTimer); rec._stallTimer = null; }
    if (rec._resumeTimer) { clearTimeout(rec._resumeTimer); rec._resumeTimer = null; }
    if (item) { try { item.cancel(); } catch (_) {} }
    liveItems.delete(id);
    rimuoviQuarantena(rec);
    rec.state = 'cancelled';
    rec.savePath = '';
    rec.paused = false;
    rec.canResume = false;
    rec.endedAt = new Date().toISOString();
    persist();
    broadcast('error', rec);
    contaFine(rec);
    return { ok: true, items: listRecords(scope) };
  }
  if (rec._arrivato) { completa(rec); return { ok: true, items: listRecords(scope) }; }
  // Ancora in corso: prosegue come un download qualsiasi, e il file esce dalla
  // quarantena quando arriva in fondo (completa()).
  rec.state = 'progressing';
  persist();
  broadcast('progress', rec);
  return { ok: true, items: listRecords(scope) };
}

// Chi ha servito i byte: in un record nativo `url` è già l'ultimo indirizzo,
// in uno «a mano» è il primo e l'ultimo sta in `servedBy`.
function servitoDi(rec) {
  if (rec.servedBy) return rec.servedBy;
  try { return ESE().sito(rec.url); } catch (_) { return ''; }
}

// Da qualunque superficie (avviso, carta della home, pagina), l'apertura entra nel filo com'è andata (#1561).
function openFile(id, opts, scope = '') {
  const rec = recordIn(id, scope);
  const r = apriScaricato(rec, opts);
  if (!rec) return r;
  const segna = (x) => {
    try { require('./accaduti').fileAperto({ scaricamento: String(rec.id), file: String(rec.filename || '') }, x, { incognito: !!scope }); } catch (_) {}
    return x;
  };
  return r && typeof r.then === 'function' ? r.then(segna) : segna(r);
}
function apriScaricato(rec, opts) {
  if (!rec) return { ok: false, error: 'Questo scaricamento non è più nell’elenco' };
  if (rec.state === 'pending') {
    return { ok: false, error: 'Questo programma non è ancora sul computer. Rispondi prima all’avviso' };
  }
  // Guarda il disco PRIMA di tentare (vedi nota su fileExists): l'esito
  // dell'apertura non è affidabile su tutte le piattaforme.
  forgetExists(rec.savePath);
  if (!rec.savePath || !fileExists(rec.savePath)) {
    // La voce è appena diventata «sparita»: le superfici aperte la attenuano senza ricaricare.
    broadcast('missing', rec);
    return { ok: false, missing: true, error: MISSING_TEXT };
  }
  // #588 — l'UNICA porta verso shell.openPath: aprire un programma è eseguirlo,
  // e qui non si passa senza una seconda risposta. Il gate sta nel main perché
  // le superfici che offrono "Apri file" sono tre (avviso, barra, pagina) e una
  // regola per porta sarebbe una porta dimenticata.
  if (rec.exe && !(opts && opts.confirmed) && chiedeConferma(rec.site, rec.siteUncertain, servitoDi(rec))) {
    let text = `«${rec.filename}» è un programma: aprirlo vuol dire eseguirlo.`;
    let title = 'Aprire un programma?';
    let parti = null;
    try {
      text = ESE().testoApri(rec.filename, rec.site, rec.siteUncertain, rec.servedBy);
      parti = ESE().partiApri(rec.filename, rec.site, rec.siteUncertain, rec.servedBy);
      title = ESE().titoloApri(rec.filename);
    } catch (_) {}
    contaProgramma(rec, 'conferma');
    return { ok: false, needsConfirm: true, exe: true, title, text, parti };
  }
  // Aperto col sì alla domanda di prima: un «no» non arriva fin qui (si chiude, o si apre la cartella).
  if (rec.exe && opts && opts.confirmed && chiedeConferma(rec.site, rec.siteUncertain, servitoDi(rec))) contaProgramma(rec, 'aperto');
  try {
    const r = electron().shell.openPath(rec.savePath);
    // openPath ritorna una stringa d'errore (non vuota) se non riesce.
    if (r && typeof r.then === 'function') {
      return r.then((msg) => (msg ? { ok: false, error: msg } : { ok: true }));
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e?.message || 'apertura fallita' }; }
}

function openFolder(id, scope = '') {
  const rec = recordIn(id, scope);
  if (!rec) return { ok: false, error: 'Questo scaricamento non è più nell’elenco' };
  if (!rec.savePath) return { ok: false, missing: true, error: MISSING_TEXT };
  forgetExists(rec.savePath);
  const here = fileExists(rec.savePath);
  if (!here) broadcast('missing', rec);
  try {
    if (here) { electron().shell.showItemInFolder(rec.savePath); return { ok: true }; }
    // Il file non c'è più ma la cartella spesso sì: aprirla è comunque il passo avanti che
    // l'utente cercava. Solo se manca anche quella non resta niente da aprire.
    const dir = path.dirname(rec.savePath);
    let dirThere = false;
    try { dirThere = fs.existsSync(dir); } catch (_) {}
    if (!dirThere) return { ok: false, missing: true, missingFolder: true, error: MISSING_FOLDER_TEXT };
    const r = electron().shell.openPath(dir);
    // ok:true + missing:true = «cartella aperta, ma il file dentro non c'è più».
    // Se la cartella c'è e il sistema non l'ha aperta è un'altra storia, e va detta com'è.
    const done = (msg) => (msg
      ? { ok: false, missing: true, error: 'Non è stato possibile aprire la cartella' }
      : { ok: true, missing: true });
    if (r && typeof r.then === 'function') return r.then(done);
    return { ok: true, missing: true };
  } catch (e) { return { ok: false, error: e?.message || 'apertura cartella fallita' }; }
}

function cancel(id, scope = '') {
  if (!recordIn(id, scope)) return { ok: true };
  const item = liveItems.get(id);
  if (item) { try { item.cancel(); } catch (_) {} }
  const manual = liveManual.get(id);
  if (manual) { try { manual.cancel(); } catch (_) {} }
  return { ok: true };
}
function pause(id, scope = '') {
  if (!recordIn(id, scope)) return { ok: true };
  const item = liveItems.get(id);
  if (item && !item.isPaused()) { try { item.pause(); } catch (_) {} }
  return { ok: true };
}
function resume(id, scope = '') {
  if (!recordIn(id, scope)) return { ok: true };
  const item = liveItems.get(id);
  if (item && item.canResume()) { try { item.resume(); } catch (_) {} }
  return { ok: true };
}

module.exports = {
  init,
  importa,
  HISTORY_LIMIT,
  rinominato,
  percorsoDi,
  indirizzoDi,
  rimettiNome,
  attachSession,
  forgetScope,
  scopeOfWindow,
  beginManual,
  // Per chi scarica i byte da sé: il file parziale va nella stessa cartella del download
  // nativo, così la rinomina finale è istantanea invece di una copia fra volumi.
  downloadsDir,
  uniquePath,
  safeName,
  marcaOrigine,
  list,
  clearCompleted,
  remove,
  confirmDownload,
  configureFromSettings,
  openFile,
  openFolder,
  cancel,
  pause,
  resume,
  // per i test
  _records: records,
  _isMissing: isMissing,
  _avanzamentoBarra: avanzamentoBarra,
  _forgetExists: forgetExists,
  MISSING_TEXT,
  _shortName: shortName,
  _publicRecord: publicRecord,
  _testoZoneIdentifier: testoZoneIdentifier,
  _valoreQuarantena: valoreQuarantena,
};
