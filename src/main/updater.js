// Aggiornamenti di Filo: controllo, scaricamento, «Installa» (#786), «Riavvia e aggiorna» e installazione all'avvio (#1039).
// Le decisioni stanno in aggiornamentoRegole.js; qui il disco, l'installatore e la finestra. Gira solo nelle build
// installate (in sviluppo si aggiorna col `git pull` del prestart); nelle prove lo guida `__filoUpdater`.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const R = require('./aggiornamentoRegole');

const PAGINA_DOWNLOAD = 'https://filo.red';
const FILE_RICORDO = 'aggiornamento-pronto.json';
const CHIAVE_AVVISO = 'aggiornamento-pronto';
const ETICHETTA_PULSANTE = 'Riavvia e aggiorna';
// Non silenzioso: la barra di avanzamento si vede, e alla fine l'installatore riapre Filo.
const ARGOMENTI_INSTALLATORE = ['--updated', '--force-run'];
// La carta della versione nuova che aspetta «Installa», con «Installa gli aggiornamenti da solo» spento (#786).
const TIPO_DISPONIBILE = 'aggiornamento-disponibile';

function electronApp() { return require('electron').app; }

const dip = {
  piattaforma: () => process.platform,
  versioneInUso: () => electronApp().getVersion(),
  cartella: () => electronApp().getPath('userData'),
  appImage: () => process.env.APPIMAGE || null,
  argv: () => process.argv,
  avvia: avviaProcesso,
  // L'avvio non ha aperto niente: si esce subito, prima che l'installatore cerchi Filo.exe acceso.
  esci: () => { try { require('./shim/storage').flushSync(); } catch (_) {} electronApp().exit(0); },
  chiudi: () => electronApp().quit(),
  riapri: (execPath) => electronApp().relaunch({ execPath, args: [] }),
  avviso: mandaAvviso,
};

// La chat (scrivere e leggere la preferenza) chiede qui se la scelta apertura/chiusura vale sul sistema di Filo.
globalThis.SN_AGGIORNAMENTI = { sceltaNonVale: () => R.sceltaNonVale(dip.piattaforma()) };

function annunciaHome() {
  try { require('./services/handlers').broadcastLiveUpdate(); } catch (_) {}
}

// Lo stato di questa sessione: lo leggono le carte della home, la chat e il pulsante.
const stato = nuovoStato();
function nuovoStato() {
  return {
    attivo: false,
    // 'fermo' | 'controllo' | 'scarica' | 'pronto' | 'aggiornato' | 'errore'
    fase: 'fermo',
    versione: null,
    percentuale: null,
    pronto: null,         // il ricordo della versione scaricata, con l'installatore verificato
    modo: R.MODO_PREDEFINITO,
    automatici: true,
    chiesto: false,       // l'utente ha premuto «Installa»: si installa anche da spento
    chiesta: null,        // la versione di quel «Installa», ricordata fra un avvio e l'altro
    versioneTrovata: null,
    scaricamento: null,   // { versione, percento } finché scarica
    pronta: null,         // la versione scaricata
    agganciata: false,    // electron-updater la installerà alla chiusura (vedi regola)
    errore: null,
    annuncia: () => {},
  };
}
let updater = null;
let percorsoAppImageNuovo = null;
// Il pulsante e la chat insieme lancerebbero due installatori.
let riavvioInCorso = false;

function automaticiDa(settings) {
  return !(settings && settings.aggiornamenti && settings.aggiornamenti.automatici === false);
}

// Da spento si installa solo quello che l'utente ha chiesto.
function siInstalla() {
  return stato.automatici || stato.chiesto;
}

// ── Il ricordo della versione scaricata: update-info.json di electron-updater non dice quale versione è ──

function percorsoRicordo() {
  try { return path.join(dip.cartella(), FILE_RICORDO); } catch (_) { return null; }
}

function leggiRicordo(file = percorsoRicordo()) {
  if (!file) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

// Sincrona: il tentativo va contato PRIMA di lanciare l'installatore, o un fallimento si ripeterebbe a ogni avvio.
function scriviRicordo(r, file = percorsoRicordo()) {
  if (!file) return false;
  try {
    if (!r) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, JSON.stringify(r));
    return true;
  } catch (e) {
    console.error('[updater] ricordo non scritto:', e?.message || e);
    return false;
  }
}

function sha512(file) {
  return new Promise((resolve) => {
    const h = crypto.createHash('sha512');
    fs.createReadStream(file, { highWaterMark: 1024 * 1024 })
      .on('error', () => resolve(null))
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('base64')));
  });
}

// L'installatore è quello che electron-updater ha verificato: stesso nome e stessa impronta nella sua cache.
async function installatoreValido(p) {
  try {
    if (!p || !p.file || !fs.statSync(p.file).isFile()) return false;
    const info = JSON.parse(fs.readFileSync(path.join(path.dirname(p.file), 'update-info.json'), 'utf8'));
    if (!info || info.fileName !== path.basename(p.file) || info.sha512 !== p.sha512) return false;
    return (await sha512(p.file)) === p.sha512;
  } catch (_) {
    return false;
  }
}

function avviaProcesso(cmd, argv) {
  return new Promise((resolve) => {
    try {
      const figlio = spawn(cmd, argv, { detached: true, stdio: 'ignore' });
      figlio.once('spawn', () => { try { figlio.unref(); } catch (_) {} resolve(true); });
      figlio.once('error', (e) => { console.error('[updater] installatore non avviato:', e?.message || e); resolve(false); });
    } catch (e) {
      console.error('[updater] installatore non avviato:', e?.message || e);
      resolve(false);
    }
  });
}

function lanciaInstallatore(p) {
  if (p.amministratore) {
    return dip.avvia(path.join(process.resourcesPath || '', 'elevate.exe'), [p.file, ...ARGOMENTI_INSTALLATORE]);
  }
  return dip.avvia(p.file, ARGOMENTI_INSTALLATORE.slice());
}

function versioneInUso() {
  try { return dip.versioneInUso(); } catch (_) { return null; }
}

function appImageScrivibile() {
  const f = dip.appImage();
  if (!f) return false;
  try { fs.accessSync(path.dirname(f), fs.constants.W_OK); return true; } catch (_) { return false; }
}

function puoInstallare() {
  return R.haPulsante(dip.piattaforma(), { appImageScrivibile: appImageScrivibile() });
}

function attivabile() {
  try {
    if (!electronApp().isPackaged) return false;
  } catch (_) { return false; }
  return !(process.env.FILO_SMOKE || process.env.FILO_USER_DATA);
}

// ── All'avvio, prima che si apra qualsiasi finestra ──

// true se l'installatore è partito e Filo sta uscendo.
async function installaAllAvvioSeServe(impostazioni, { forza = false } = {}) {
  if (!forza && !attivabile()) return false;
  try {
    const app = forza ? null : electronApp();
    // Una seconda apertura mentre Filo è acceso non lancia niente: l'installatore chiuderebbe la prima.
    if (app && typeof app.hasSingleInstanceLock === 'function' && !app.hasSingleInstanceLock()) return false;
  } catch (_) {}
  const tolti = togliAvvisiSuperati(versioneInUso());
  // Chi apre Filo da un collegamento d'invito lo vuole adesso: l'installatore riaprirebbe Filo senza il collegamento.
  if ((dip.argv() || []).some((a) => /^filo:\/\//i.test(String(a)))) return false;
  const base = {
    piattaforma: dip.piattaforma(),
    versioneInUso: versioneInUso(),
    modo: R.modoScelto(impostazioni),
    automatici: automaticiDa(impostazioni),
    chiesta: await richiestaValida(versioneInUso()),
    pronto: leggiRicordo(),
  };
  let d = R.decidiAllAvvio({ ...base, installatoreValido: true });
  if (d.azione === 'installa' && !(await installatoreValido(d.pronto))) {
    d = R.decidiAllAvvio({ ...base, installatoreValido: false });
  }
  if (JSON.stringify(d.pronto) !== JSON.stringify(base.pronto)) {
    if (!scriviRicordo(d.pronto) && d.azione === 'installa') return false;
  }
  if (d.azione !== 'installa') {
    // In fila: ognuna riscrive l'elenco intero degli avvisi, e due insieme si cancellerebbero a vicenda.
    await tolti;
    if (d.avvisa) await avvisaInstallazioneFallita(d.pronto.versione);
    await riscriviCartaPronto({ modo: base.modo, daSolo: base.automatici || base.chiesta === (base.pronto && base.pronto.versione) });
    return false;
  }
  if (!(await lanciaInstallatore(d.pronto))) return false;
  dip.esci();
  return true;
}

// ── Durante la sessione ──

// Da spento nessuna strada scarica o installa da sola finché non c'è «Installa». Su Windows alla chiusura si
// installa solo se l'utente l'ha scelto in Preferenze (#1039).
function regola() {
  const u = updater;
  if (!u) return;
  try {
    u.autoDownload = stato.automatici;
    u.autoInstallOnAppQuit = siInstalla() && R.piano(dip.piattaforma(), stato.modo).allaChiusura;
    // electron-updater aggancia l'installazione alla chiusura solo a scaricamento finito: una versione già pronta
    // quando l'installazione si riaccende va riagganciata. Richiedere lo scaricamento di una versione già scaricata
    // la ritrova in cache e rifà l'aggancio, senza rete.
    if (u.autoInstallOnAppQuit && stato.pronta && !stato.agganciata && typeof u.downloadUpdate === 'function') {
      stato.agganciata = true;
      Promise.resolve().then(() => u.downloadUpdate()).catch((e) => {
        stato.agganciata = false;
        console.error('[updater] aggancio alla chiusura fallito:', e?.message || e);
      });
    }
  } catch (_) {}
}

// Una preferenza cambiata a sessione aperta vale subito: chi spegne dopo lo scaricamento dell'avvio non se lo
// ritrova installato, chi riaccende scarica come all'avvio, e la carta pronta segue la scelta di quando installare.
function seguiImpostazioni(settings) {
  const automatici = automaticiDa(settings);
  const modo = R.modoScelto(settings);
  if (automatici === stato.automatici && modo === stato.modo) return;
  const cambiaAutomatici = automatici !== stato.automatici;
  stato.automatici = automatici;
  stato.modo = modo;
  regola();
  riscriviCartaPronto();
  if (!updater || !cambiaAutomatici) return;
  if (stato.versioneTrovata) {
    if (automatici) scarica();
    else if (!stato.chiesto) avvisaVersioneNuova(stato.versioneTrovata);
  }
  if (automatici && stato.pronto) segnalaPronto();
  stato.annuncia();
}

function shaDalFeed(info, file) {
  const nome = path.basename(String(file || ''));
  const voce = Array.isArray(info?.files) ? info.files.find((f) => path.basename(String(f?.url || '')) === nome) : null;
  return voce?.sha512 || info?.sha512 || null;
}

function quandoScaricato(info) {
  const versione = info?.version || stato.versioneTrovata || null;
  const file = info?.downloadedFile || null;
  // electron-updater aggancia l'installazione alla chiusura subito dopo questo evento, solo se è accesa adesso.
  if (updater && updater.autoInstallOnAppQuit) stato.agganciata = true;
  stato.scaricamento = null;
  stato.pronta = versione;
  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'update-info.json'), 'utf8')); } catch (_) {}
  const r = R.ricordaScaricato(leggiRicordo(), {
    versione,
    file,
    sha512: meta?.sha512 || shaDalFeed(info, file),
    amministratore: meta?.isAdminRightsRequired === true,
  });
  if (r && r.versione === versione) scriviRicordo(r);
  stato.fase = 'pronto';
  stato.versione = versione;
  stato.percentuale = 100;
  stato.pronto = r && r.versione === versione ? r : null;
  console.log('[updater] update scaricato:', versione, updater && updater.autoInstallOnAppQuit ? '— sarà applicato alla chiusura' : '');
  segnalaPronto();
  stato.annuncia();
}

// La versione pronta con «Riavvia e aggiorna»: la carta sempre, l'avviso a tempo solo se si installa da sola.
function segnalaPronto() {
  if (!stato.pronto) return;
  const versione = stato.pronto.versione;
  const testo = R.fraseScaricato({
    versione,
    piattaforma: dip.piattaforma(),
    modo: stato.modo,
    pronto: stato.pronto,
    appImageScrivibile: appImageScrivibile(),
    daSolo: siInstalla(),
  });
  if (!testo) return;
  if (siInstalla()) dip.avviso(testo);
  avvisaPronto(testo, versione);
}

function collega(au, { automatici = true, chiesta = stato.chiesta, annuncia = () => {}, modo = R.MODO_PREDEFINITO } = {}) {
  updater = au;
  Object.assign(stato, nuovoStato(), { attivo: true, automatici, chiesta, annuncia, modo });
  regola();
  au.on('checking-for-update', () => { if (stato.fase !== 'pronto') stato.fase = 'controllo'; });
  au.on('update-available', (info) => {
    stato.versione = info?.version || null;
    stato.versioneTrovata = info?.version || null;
    console.log('[updater] update disponibile:', info?.version);
    if (stato.chiesta && stato.chiesta !== stato.versioneTrovata) dimenticaRichiesta();
    // Un «Installa» di un avvio precedente, interrotto dalla chiusura, riprende da solo: l'utente l'aveva già chiesto.
    else if (stato.chiesta && !stato.automatici && !stato.chiesto) {
      stato.chiesto = true;
      regola();
      Promise.resolve().then(scarica);
    }
    if (stato.fase !== 'pronto' && siInstalla()) { stato.fase = 'scarica'; stato.percentuale = 0; }
    if (!stato.automatici) avvisaVersioneNuova(stato.versioneTrovata);
    else togliCarte((n) => n.action.versione !== stato.versioneTrovata);
  });
  au.on('download-progress', (p) => {
    const n = Number(p?.percent);
    if (stato.fase === 'scarica' && Number.isFinite(n)) stato.percentuale = Math.max(0, Math.min(99, Math.floor(n)));
    const percento = Math.max(0, Math.min(100, Math.floor(n) || 0));
    const prima = stato.scaricamento;
    stato.scaricamento = { versione: stato.versioneTrovata, percento };
    if (!prima || prima.percento !== percento) stato.annuncia();
  });
  au.on('update-not-available', () => {
    if (stato.fase !== 'pronto') stato.fase = 'aggiornato';
    console.log('[updater] già aggiornato');
    if (stato.chiesta) dimenticaRichiesta();
  });
  au.on('update-downloaded', quandoScaricato);
  au.on('appimage-filename-updated', (p) => { percorsoAppImageNuovo = p || null; });
  // Un errore PRIMA di aver trovato un aggiornamento (rete assente) non riguarda l'utente: lo filtra l'avviso.
  au.on('error', (err) => {
    console.error('[updater] errore', err ? (err.stack || err).toString() : 'sconosciuto');
    if (stato.fase !== 'pronto') stato.fase = 'errore';
    // Dove l'installazione si ferma da sé l'avviso di Mac e Linux, che dice cosa fare, prende il posto della carta.
    if (AGGIORNAMENTO_BLOCCATO[dip.piattaforma()] && stato.versioneTrovata) {
      stato.scaricamento = null;
      dimenticaRichiesta();
      togliCarte(() => true);
    } else scaricamentoFallito();
    avvisaSeAggiornamentoBloccato(stato.versioneTrovata);
  });
}

// Separata da initAutoUpdater perché la prova la fa girare su un aggiornatore finto. Senza `chiesta` vale quella di
// questo processo: un aggiornatore riavviato non scorda l'«Installa» dell'utente.
function avviaAggiornatore(au, opzioni = {}) {
  collega(au, opzioni);
  // Non checkForUpdatesAndNotify: la sua notifica di sistema promette un'installazione alla chiusura.
  return Promise.resolve().then(() => au.checkForUpdates()).catch((e) => {
    console.error('[updater] controllo update fallito:', e?.message || e);
    avvisaSeAggiornamentoBloccato(stato.versioneTrovata);
  });
}

function initAutoUpdater(impostazioni) {
  if (!attivabile()) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (_) {
    return;
  }
  (async () => {
    let settings = impostazioni || null;
    if (!settings) { try { settings = await globalThis.SN_STORAGE.getSettings(); } catch (_) {} }
    await togliAvvisiSuperati(versioneInUso());
    const chiesta = await richiestaValida(versioneInUso());
    await avviaAggiornatore(autoUpdater, {
      automatici: automaticiDa(settings), chiesta, annuncia: annunciaHome, modo: R.modoScelto(settings),
    });
  })().catch((e) => console.error('[updater] avvio fallito:', e?.message || e));
}

// ── «Installa» sulla carta della versione nuova (#786): l'esito dice cosa succede, lo scaricamento non lo aspetta ──

async function installaAggiornamento() {
  if (!updater) {
    return { ok: false, error: 'Questa copia di Filo non si aggiorna da sé: la versione nuova si scarica da filo.red.' };
  }
  stato.chiesto = true;
  stato.errore = null;
  regola();
  const trovata = await trova();
  if (trovata) {
    ricordaRichiesta(stato.versioneTrovata || stato.pronta);
    scarica();
  }
  const versione = stato.pronta || stato.versioneTrovata;
  if (!trovata) {
    if (stato.errore) return { ok: true, versione: null, stato: 'errore', errore: stato.errore };
    // La carta di una versione che il controllo non trova più dice perché «Installa» non parte.
    stato.errore = 'Adesso non trovo la versione nuova. Riprova fra poco.';
    stato.annuncia();
    return { ok: true, versione: null, stato: 'aggiornato' };
  }
  // Già scaricata da spento: adesso che l'utente l'ha chiesta la carta pronta promette l'installazione.
  if (stato.pronto) segnalaPronto();
  return { ok: true, versione, stato: stato.pronta ? 'pronta' : 'scarica' };
}

// Dopo un riavvio la carta c'è ancora ma il controllo di questa sessione può non essere finito.
async function trova() {
  if (stato.versioneTrovata || stato.pronta) return true;
  try { await updater.checkForUpdates(); } catch (e) {
    console.error('[updater] controllo update fallito:', e?.message || e);
    stato.errore = 'Adesso non riesco a controllare se c\'è una versione nuova. Riprova fra poco.';
    stato.annuncia();
    return false;
  }
  return !!stato.versioneTrovata;
}

async function scarica() {
  const u = updater;
  if (!u || stato.scaricamento || stato.pronta) return;
  try {
    if (!stato.versioneTrovata) await u.checkForUpdates();
    if (!stato.versioneTrovata) {
      stato.errore = 'Adesso non trovo la versione nuova. Riprova fra poco.';
      stato.annuncia();
      return;
    }
    stato.scaricamento = { versione: stato.versioneTrovata, percento: 0 };
    if (stato.fase !== 'pronto') { stato.fase = 'scarica'; stato.percentuale = 0; }
    stato.annuncia();
    await u.downloadUpdate();
  } catch (e) {
    console.error('[updater] scaricamento fallito:', e?.message || e);
    scaricamentoFallito();
  }
}

// La richiesta vive fra gli avvii finché quella versione non è installata o il feed non ne offre un'altra.
const chiaveRichiesta = () => globalThis.SN_CONST?.STORAGE_KEYS?.AGGIORNAMENTO_CHIESTO;
function scriviRichiesta(valore) {
  const S = globalThis.SN_STORAGE;
  if (!S?.setRaw || !chiaveRichiesta()) return Promise.resolve();
  return Promise.resolve().then(() => S.setRaw(chiaveRichiesta(), valore))
    .catch((e) => console.error('[updater] richiesta non salvata:', e?.message || e));
}
function ricordaRichiesta(versione) {
  if (!versione || stato.chiesta === versione) return Promise.resolve();
  stato.chiesta = versione;
  return scriviRichiesta({ versione });
}
function dimenticaRichiesta() {
  stato.chiesta = null;
  return scriviRichiesta(null);
}
async function richiestaValida(inUso) {
  const S = globalThis.SN_STORAGE;
  if (!S?.getRaw || !chiaveRichiesta()) return null;
  let r = null;
  try { r = await S.getRaw(chiaveRichiesta(), null); } catch (_) { return null; }
  if (!r || !r.versione) return null;
  const cmp = R.confrontaVersioni(r.versione, inUso);
  if (cmp == null || cmp <= 0) {
    await scriviRichiesta(null);
    return null;
  }
  return String(r.versione);
}

function scaricamentoFallito() {
  if (!stato.scaricamento && !stato.chiesto) return;
  if (stato.pronta) return;
  stato.scaricamento = null;
  stato.errore = 'Lo scaricamento non è riuscito. Riprova fra poco.';
  stato.annuncia();
}

// La home disegna la carta «Installa» con quello che sta succedendo alla sua versione: lo stato vive qui.
function conStatoAggiornamento(lista) {
  const allApertura = R.piano(dip.piattaforma(), stato.modo).allAvvio;
  return (lista || []).map((n) => {
    if (!n || !n.action || n.action.tipo !== TIPO_DISPONIBILE) return n;
    const v = n.action.versione;
    // Spenta a metà di uno scaricamento partito da solo, la versione non si installa: la carta chiede «Installa».
    let aggiornamento = null;
    if (siInstalla() && stato.scaricamento && stato.scaricamento.versione === v) {
      aggiornamento = { percento: stato.scaricamento.percento, ...(allApertura ? { allApertura: true } : {}) };
    } else if (siInstalla() && stato.pronta === v) aggiornamento = { pronta: true, ...(allApertura ? { allApertura: true } : {}) };
    else if (stato.errore) aggiornamento = { errore: stato.errore };
    return aggiornamento ? { ...n, aggiornamento } : n;
  });
}

// ── «Riavvia e aggiorna»: dall'avviso, dalla carta, dalla chat ──

const FRASE_NON_RIUSCITO = 'Non sono riuscito ad avviare l\'installazione: Filo resta aperto com\'era. '
  + `Puoi scaricarlo da ${PAGINA_DOWNLOAD.replace('https://', '')} e installarlo sopra.`;

async function riavviaEAggiorna() {
  if (riavvioInCorso) return { ok: true };
  riavvioInCorso = true;
  const r = await riavvia();
  if (!r.ok) riavvioInCorso = false;
  return r;
}

// L'unica risposta a «c'è una versione da installare adesso?» per carta, avviso e chat. Dopo un riavvio, finché
// electron-updater non ridice «scaricato» (o senza rete non lo ridice affatto), vale il ricordo con l'installatore verificato.
async function prontoDaInstallare() {
  if (stato.fase === 'pronto' && stato.pronto) return stato.pronto;
  if (dip.piattaforma() !== 'win32') return null;
  const r = leggiRicordo();
  const cmp = r ? R.confrontaVersioni(r.versione, versioneInUso()) : null;
  if (cmp == null || cmp <= 0 || !(await installatoreValido(r))) return null;
  return r;
}

async function riavvia() {
  const p = stato.attivo ? await prontoDaInstallare() : null;
  if (!p) return { ok: false, frase: 'Non c\'è un aggiornamento pronto da installare.' };
  const sis = dip.piattaforma();
  if (!puoInstallare()) return { ok: false, frase: fraseSoloAMano(sis, p.versione) };
  if (sis === 'win32') {
    const conto = R.contaTentativo(p);
    if (!scriviRicordo(conto)) return { ok: false, frase: FRASE_NON_RIUSCITO };
    // L'installazione silenziosa alla chiusura non deve partire anche lei.
    try { updater.autoInstallOnAppQuit = false; } catch (_) {}
    if (!(await lanciaInstallatore(conto))) {
      scriviRicordo(p);
      regola();
      return { ok: false, frase: FRASE_NON_RIUSCITO };
    }
    stato.pronto = conto;
    dip.chiudi();
    return { ok: true };
  }
  // Linux: l'AppImage si riscrive adesso; si riapre a processo chiuso, o la seconda istanza perderebbe il lucchetto.
  let fatto = false;
  try { fatto = updater.install(true, false) === true; } catch (e) {
    console.error('[updater] installazione non riuscita:', e?.message || e);
  }
  if (!fatto) return { ok: false, frase: fraseSoloAMano(sis, p.versione) };
  try { dip.riapri(percorsoAppImageNuovo || dip.appImage()); } catch (_) {}
  dip.chiudi();
  return { ok: true };
}

function fraseSoloAMano(sis, v) {
  const dove = PAGINA_DOWNLOAD.replace('https://', '');
  if (sis === 'darwin') return `C'è Filo ${v}, ma su Mac non riesce a installarsi da solo: scaricalo da ${dove} e sostituisci l'app.`;
  if (sis === 'linux') return `C'è Filo ${v}, ma qui non riesce a installarsi da solo: scaricalo da ${dove} e sostituisci il file di Filo.`;
  return `C'è Filo ${v}: scaricalo da ${dove}.`;
}

// Dopo un controllo chiesto a voce l'esito arriva per evento: si aspetta quello, con un tetto.
function controllaAdesso(tettoMs = 20000) {
  return new Promise((resolve) => {
    let finito = false;
    const fine = (esito) => {
      if (finito) return;
      finito = true;
      clearTimeout(timer);
      for (const [ev, fn] of ascolti) { try { updater.removeListener(ev, fn); } catch (_) {} }
      resolve(esito);
    };
    const ascolti = [
      ['update-available', (info) => fine({ esito: 'nuova', versione: info?.version || null })],
      ['update-not-available', () => fine({ esito: 'nessuna' })],
      ['error', (e) => fine({ esito: 'errore', messaggio: e?.message || String(e || '') })],
    ];
    for (const [ev, fn] of ascolti) updater.on(ev, fn);
    const timer = setTimeout(() => fine({ esito: 'tempo' }), tettoMs);
    // null: l'updater non gira (un AppImage estratto, uno snap) e nessun evento arriverà.
    Promise.resolve().then(() => updater.checkForUpdates())
      .then((r) => { if (r == null) fine({ esito: 'inattivo' }); })
      .catch((e) => fine({ esito: 'errore', messaggio: e?.message || String(e || '') }));
  });
}

// Dove il pulsante non c'è (Mac, un Linux che non riscrive il file) l'avviso con «Riavvia e aggiorna» non arriverà.
function esitoScarica(versione, { gia = false } = {}) {
  if (!puoInstallare()) return { eseguito: true, esito: 'a-mano', versione, frase: fraseSoloAMano(dip.piattaforma(), versione) };
  const pct = gia && Number.isFinite(stato.percentuale) ? ` (${stato.percentuale}%)` : '';
  return {
    eseguito: true,
    esito: 'scarica',
    versione,
    frase: gia
      ? `Sto già scaricando Filo ${versione}${pct}: quando è pronto compare un avviso con «${ETICHETTA_PULSANTE}».`
      : `C'è Filo ${versione}: lo sto scaricando. Quando è pronto compare un avviso con «${ETICHETTA_PULSANTE}».`,
  };
}

// L'azione della chat («aggiornati»): riavvia se c'è una versione pronta, altrimenti la chiede come «Installa» e dice
// com'è. `riavvio`: l'utente ha confermato il riavvio; una versione arrivata dopo la conferma non riavvia senza chiedere.
async function aggiornaDaChat({ riavvio = true } = {}) {
  const inUso = versioneInUso() || '?';
  const aggiornato = { eseguito: true, esito: 'aggiornato', frase: `Filo è aggiornato: la ${inUso} è l'ultima versione.` };
  const senzaRete = { eseguito: false, esito: 'errore', frase: `Non sono riuscito a controllare se c'è una versione nuova (ora hai la ${inUso}): forse manca la rete. Riprova fra poco.` };
  if (!stato.attivo) {
    return { eseguito: false, esito: 'spento', frase: `Questa copia di Filo (${inUso}) non si aggiorna da qui: è una versione di sviluppo o di prova. L'ultima versione si scarica da filo.red.` };
  }
  const p = await prontoDaInstallare();
  if (p) {
    if (!puoInstallare()) return { eseguito: true, esito: 'a-mano', versione: p.versione, frase: fraseSoloAMano(dip.piattaforma(), p.versione) };
    if (!riavvio) {
      return { eseguito: true, esito: 'pronto', versione: p.versione, frase: `Filo ${p.versione} è appena arrivato: chiedimelo di nuovo e riavvio per installarlo.` };
    }
    const r = await riavviaEAggiorna();
    return r.ok
      ? { eseguito: true, esito: 'riavvio', versione: p.versione, frase: `Riavvio Filo per installare la ${p.versione}.` }
      : { eseguito: false, esito: 'errore', frase: r.frase };
  }
  // Da spento «aggiornati» vale «Installa» (#786): la versione nuova si scarica e poi si installa.
  if (!siInstalla()) {
    const r = await installaAggiornamento();
    if (r.stato === 'errore') return senzaRete;
    if (r.stato === 'aggiornato') return aggiornato;
    return { ...esitoScarica(r.versione), aggiornamento: r.stato };
  }
  if (stato.fase === 'scarica' && stato.versione) return esitoScarica(stato.versione, { gia: true });
  const c = await controllaAdesso();
  if (c.esito === 'nuova' && c.versione) return esitoScarica(c.versione);
  if (c.esito === 'nessuna') return aggiornato;
  if (c.esito === 'inattivo') {
    return { eseguito: false, esito: 'a-mano', frase: `Qui Filo non riesce ad aggiornarsi da solo: l'ultima versione si scarica da ${PAGINA_DOWNLOAD.replace('https://', '')}.` };
  }
  return senzaRete;
}

// Quello che la chat deve sapere prima di chiedere conferma: se «aggiornati» riavvierà Filo.
async function statoAggiornamento() {
  const p = stato.attivo ? await prontoDaInstallare() : null;
  return {
    attivo: stato.attivo,
    fase: stato.fase,
    versione: p ? p.versione : stato.versione,
    percentuale: stato.percentuale,
    versioneInUso: versioneInUso(),
    piattaforma: dip.piattaforma(),
    modo: stato.modo,
    automatici: stato.automatici,
    riavvio: !!p && puoInstallare(),
  };
}

function mandaAvviso(testo, { pulsante = true, tentativi = 10 } = {}) {
  let dette = 0;
  try {
    const { BrowserWindow } = require('electron');
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win || win.isDestroyed?.() || !win._filoTabs) continue;
      const wc = win.webContents;
      if (!wc || wc.isDestroyed?.() || wc.isLoading?.()) continue;
      try {
        wc.send('shell:toast', {
          text: testo,
          opts: pulsante ? { unica: CHIAVE_AVVISO, actions: [{ label: ETICHETTA_PULSANTE, aggiornaFilo: true }] } : {},
        });
        dette++;
      } catch (_) {}
    }
  } catch (_) {}
  if (!dette && tentativi > 0) setTimeout(() => mandaAvviso(testo, { pulsante, tentativi: tentativi - 1 }), 3000);
}

// Il pulsante della home non ha un avviso suo che dica il fallimento: lo dice la barra.
async function riavviaDallaHome() {
  const r = await riavviaEAggiorna();
  if (r && r.ok === false && r.frase) mandaAvviso(r.frase, { pulsante: false, tentativi: 0 });
  return r;
}

// ── Gli avvisi fra le notifiche ──

// Le scritture degli avvisi passano in fila: leggere e poi aggiungere, in due, scriverebbe due carte uguali.
let fila = Promise.resolve();
function inFila(fn) {
  const passo = () => Promise.resolve().then(fn).catch((e) => console.error('[updater] avviso non scritto:', e?.message || e));
  fila = fila.then(passo, passo);
  return fila;
}

function testoDisponibile(v) {
  const quando = R.piano(dip.piattaforma(), stato.modo).allAvvio ? 'la prossima volta che apri Filo' : 'quando chiudi Filo';
  return `C'è la versione ${v} di Filo.\nCon «Installa» la scarico, e si installa ${quando}.`;
}

// Una carta per versione, come l'avviso di Mac e Linux: chi l'ha chiusa non se la ritrova. Una versione più
// nuova prende il posto di quella prima, perché «Installa» scarica comunque l'ultima. Una versione già pronta,
// con la sua carta «Riavvia e aggiorna», non ne vuole una seconda.
function avvisaVersioneNuova(versione) {
  if (!versione) return Promise.resolve();
  togliCarte((n) => n.action.versione !== versione);
  return inFila(async () => {
    const FiloMem = globalThis.SN_FILO_MEMORY;
    if (!FiloMem?.addNotification) return;
    const gia = await FiloMem.listNotifications({ includeDismissed: true });
    const coperta = (n) => n.action?.versione === versione
      && (n.action.tipo === TIPO_DISPONIBILE || (n.action.tipo === PRONTO.tipo && !n.dismissed));
    if (gia.some(coperta)) return;
    await FiloMem.addNotification({
      kind: 'info',
      action: { tipo: TIPO_DISPONIBILE, versione },
      text: testoDisponibile(versione),
    });
    stato.annuncia();
  });
}

// Chiude le carte dei `tipi` che `via` indica (di serie quella della versione nuova che aspetta «Installa»).
function togliCarte(via, { acted = false, tipi = [TIPO_DISPONIBILE] } = {}) {
  return inFila(async () => {
    const FiloMem = globalThis.SN_FILO_MEMORY;
    if (!FiloMem?.dismissNotification) return;
    let tolte = 0;
    for (const n of await FiloMem.listNotifications()) {
      if (!tipi.includes(n.action?.tipo) || !via(n)) continue;
      await FiloMem.dismissNotification(n.id, { acted });
      tolte += 1;
    }
    if (tolte) stato.annuncia();
  });
}

// Il marcatore resta diverso per sistema: unificarlo farebbe ricomparire un avviso già scartato.
const AGGIORNAMENTO_BLOCCATO = {
  darwin: {
    tipo: 'aggiornamento-mac',
    testo: (v) => `C'è la versione ${v} di Filo, ma su Mac non riesce a installarsi da sola.\n`
      + 'Scaricala da filo.red e sostituisci l\'app. Ci vuole un minuto.',
  },
  linux: {
    tipo: 'aggiornamento-linux',
    // Il file nuovo arriva senza il permesso di esecuzione, come il primo: se l'avviso non lo dice, il doppio clic non parte.
    testo: (v) => `C'è la versione ${v} di Filo, ma su Linux non riesce a installarsi da sola.\n`
      + 'Scaricala da filo.red, sostituisci il file di Filo con quello nuovo e ridagli il permesso '
      + 'di esecuzione (tasto destro, Proprietà, «Consenti l\'esecuzione»). Ci vuole un minuto.',
  },
};
const INSTALLAZIONE_FALLITA = {
  tipo: 'aggiornamento-windows',
  testo: (v) => `La versione ${v} di Filo non è riuscita a installarsi, per due volte.\n`
    + 'Scaricala da filo.red e aprila: si installa sopra quella che hai, e le tue cose restano.',
};
// La carta della home con «Riavvia e aggiorna»: l'avviso a tempo se ne va in cinque secondi, lei finché serve.
const PRONTO = { tipo: 'aggiornamento-pronto', kind: 'info' };
const TIPI_AVVISO = [AGGIORNAMENTO_BLOCCATO.darwin.tipo, AGGIORNAMENTO_BLOCCATO.linux.tipo, INSTALLAZIONE_FALLITA.tipo, PRONTO.tipo, TIPO_DISPONIBILE];

// Una scheda per versione, e chi l'ha già scartata non se la ritrova. Il riconoscimento passa da `action`, che la
// scheda non mostra.
async function scriviAvviso(caso, versione) {
  try {
    const FiloMem = globalThis.SN_FILO_MEMORY;
    if (!FiloMem?.addNotification) return;
    const gia = await FiloMem.listNotifications({ includeDismissed: true });
    if (gia.some((n) => n.action?.tipo === caso.tipo && n.action?.versione === versione)) return;
    await FiloMem.addNotification({ kind: caso.kind || 'alert', action: { tipo: caso.tipo, versione }, text: caso.testo(versione) });
    annunciaHome();
  } catch (e) {
    console.error('[updater] avviso aggiornamento non scritto:', e?.message || e);
  }
}

// Solo dove l'installazione automatica può fermarsi (Mac e Linux), e solo se una versione nuova esiste davvero.
async function avvisaSeAggiornamentoBloccato(versione) {
  const caso = AGGIORNAMENTO_BLOCCATO[dip.piattaforma()];
  if (!caso || !versione) return;
  await scriviAvviso(caso, versione);
}

// Una versione più nuova prende il posto della carta di quella prima, e la carta pronta quello della carta «Installa».
function avvisaPronto(testo, versione) {
  if (!versione) return Promise.resolve();
  return inFila(async () => {
    try {
      const FiloMem = globalThis.SN_FILO_MEMORY;
      for (const n of (await FiloMem?.listNotifications?.()) || []) {
        const tipo = n.action?.tipo;
        if (tipo === PRONTO.tipo && n.action?.versione !== versione) await FiloMem.dismissNotification(n.id);
        else if (tipo === TIPO_DISPONIBILE && R.confrontaVersioni(n.action?.versione, versione) <= 0) {
          await FiloMem.dismissNotification(n.id, { acted: true });
        }
      }
    } catch (_) {}
    await scriviAvviso({ ...PRONTO, testo: () => testo }, versione);
    await scriviCartaPronto();
  });
}

// La carta resta per giorni: la sua frase segue le scelte in Preferenze e i tentativi falliti, o prometterebbe
// un'installazione che non avverrà.
function riscriviCartaPronto(opzioni) {
  return inFila(() => scriviCartaPronto(opzioni));
}
async function scriviCartaPronto({ modo = stato.modo, daSolo = siInstalla() } = {}) {
  try {
    const FiloMem = globalThis.SN_FILO_MEMORY;
    if (!FiloMem?.setNotificationText) return;
    let cambiate = 0;
    for (const n of (await FiloMem.listNotifications()) || []) {
      if (n.action?.tipo !== PRONTO.tipo) continue;
      const testo = R.fraseScaricato({
        versione: n.action.versione,
        piattaforma: dip.piattaforma(),
        modo,
        pronto: leggiRicordo(),
        appImageScrivibile: appImageScrivibile(),
        daSolo,
      });
      if (testo && await FiloMem.setNotificationText(n.id, testo)) cambiate++;
    }
    if (cambiate) annunciaHome();
  } catch (_) {}
}

async function avvisaInstallazioneFallita(versione) {
  if (!versione) return;
  await scriviAvviso(INSTALLAZIONE_FALLITA, versione);
}

// Un avviso che manda a scaricare (o a installare) una versione che l'utente ha già è falso: se ne va da solo.
function togliAvvisiSuperati(inUso) {
  if (!inUso) return Promise.resolve();
  return togliCarte((n) => {
    const cmp = R.confrontaVersioni(n.action?.versione, inUso);
    return cmp != null && cmp <= 0;
  }, { acted: true, tipi: TIPI_AVVISO });
}

// Solo nelle prove: un autoUpdater finto guidato dallo spec, e lancio/uscita registrati invece di eseguiti.
function perProva({ piattaforma = 'win32', versione = '0.2.233', appImage = null, cartella = null, avvisoVero = true } = {}) {
  const { EventEmitter } = require('node:events');
  const registro = { lanciati: [], chiusure: 0, uscite: 0, riaperture: [], installazioni: 0, controlli: 0, risposta: null, avvisi: [] };
  const finto = new EventEmitter();
  finto.install = () => { registro.installazioni++; return true; };
  finto.checkForUpdates = async () => {
    registro.controlli++;
    const r = registro.risposta;
    if (r) setTimeout(() => finto.emit(r.evento, r.dati), 10);
    return registro.inattivo ? null : {};
  };
  dip.piattaforma = () => piattaforma;
  dip.versioneInUso = () => versione;
  if (cartella) dip.cartella = () => cartella;
  dip.appImage = () => appImage;
  dip.avvia = async (cmd, argv) => { registro.lanciati.push({ cmd, argv }); return registro.lanciaFallisce !== true; };
  dip.esci = () => { registro.uscite++; };
  dip.chiudi = () => { registro.chiusure++; };
  dip.riapri = (p) => { registro.riaperture.push(p); };
  dip.avviso = avvisoVero ? (t) => { registro.avvisi.push(t); mandaAvviso(t); } : (t) => { registro.avvisi.push(t); };
  dip.argv = () => registro.argv || [];
  riavvioInCorso = false;
  collega(finto, { chiesta: null, annuncia: annunciaHome });
  return { finto, registro };
}

module.exports = {
  initAutoUpdater,
  avviaAggiornatore,
  installaAllAvvioSeServe,
  seguiImpostazioni,
  installaAggiornamento,
  conStatoAggiornamento,
  avvisaVersioneNuova,
  togliAvvisiSuperati,
  richiestaValida,
  riavviaEAggiorna,
  riavviaDallaHome,
  aggiornaDaChat,
  statoAggiornamento,
  avvisaSeAggiornamentoBloccato,
  avvisaInstallazioneFallita,
  installatoreValido,
  perProva,
  PAGINA_DOWNLOAD,
  TIPI_AVVISO,
  TIPO_DISPONIBILE,
};
