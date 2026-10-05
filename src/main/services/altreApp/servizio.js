// Il componente con cui Filo usa le altre applicazioni: si scarica quando l'impostazione si accende, lo stato lo
// tiene solo il main e le pagine lo leggono, il driver vive finché serve. Senza componente ogni operazione risponde
// «non disponibile» col motivo. Regole: tests/altre-app.spec.mjs e i test unit di questa cartella.

const path = require('node:path');
const { creaInstallatore, pacchettoPer } = require('./installatore');
const { creaCuaDriver } = require('./cuaDriver');
const { creaComputerDriver } = require('./computerDriver');
const MANIFESTO = require('./cua-driver.json');

// Il driver resta acceso fra un'operazione e l'altra, e si chiude dopo un po' che nessuno lo usa.
const INATTIVO_MS = 5 * 60 * 1000;
const PROVA_MS = 30000;
const ANNUNCIO_MS = 150;

const PANNELLI_MAC = {
  accessibilita: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  schermo: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
};

let manifesto = MANIFESTO;
let comandoProve = null;
let acceso = false;
let fase = { fase: 'spento' };
let lavoro = null;
let impl = null;
let chiusuraVoluta = false;
let timerInattivo = null;
let provatoInSessione = false;
let ultimoAnnuncio = 0;
let annuncioRimandato = null;
let avviato = false;

function electron() { return require('electron'); }
function cartella() { return path.join(electron().app.getPath('userData'), 'componenti', 'cua-driver'); }

function apriFlusso(url, { signal } = {}) {
  const { net } = electron();
  return new Promise((resolve, reject) => {
    let req;
    try { req = net.request({ url, redirect: 'follow', useSessionCookies: false }); } catch (e) { reject(e); return; }
    const annulla = () => { try { req.abort(); } catch (_) {} reject(new Error('annullato')); };
    if (signal) {
      if (signal.aborted) { annulla(); return; }
      signal.addEventListener('abort', annulla, { once: true });
    }
    req.on('response', (res) => resolve({ status: res.statusCode, lunghezza: Number(res.headers['content-length']) || 0, flusso: res }));
    req.on('error', reject);
    req.end();
  });
}

function installatore() {
  return creaInstallatore({ cartella: cartella(), manifesto, apriFlusso });
}

// Su macOS i permessi li dà l'utente a Filo: il driver parte dentro Filo e li eredita. Altrove non se ne chiedono.
function permessiMancanti() {
  if (process.platform !== 'darwin') return [];
  const { systemPreferences } = electron();
  const mancano = [];
  try { if (!systemPreferences.isTrustedAccessibilityClient(false)) mancano.push('accessibilita'); } catch (_) {}
  try { if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') mancano.push('schermo'); } catch (_) {}
  return mancano;
}

async function apriPermesso(quale) {
  if (process.platform !== 'darwin') return { ok: false, motivo: 'Su questo sistema non servono permessi in più.' };
  const url = PANNELLI_MAC[quale];
  if (!url) return { ok: false, motivo: 'Permesso sconosciuto.' };
  const { shell, systemPreferences } = electron();
  // La domanda di sistema mette Filo nell'elenco dell'Accessibilità: l'utente trova già la voce da accendere.
  if (quale === 'accessibilita') { try { systemPreferences.isTrustedAccessibilityClient(true); } catch (_) {} }
  await shell.openExternal(url);
  return { ok: true };
}

function barraFinestre(valore) {
  try {
    for (const w of electron().BrowserWindow.getAllWindows()) {
      if (w._filoTabs && !w.isDestroyed()) w.setProgressBar(valore);
    }
  } catch (_) {}
}

async function statoPerLePagine() {
  const inst = installatore();
  const p = inst.pacchetto;
  const base = {
    acceso,
    ...fase,
    versione: manifesto.versione,
    byteScaricamento: p ? Number(p.byte) || 0 : 0,
    supportato: !!p,
  };
  if (['scarica', 'installa'].includes(fase.fase)) return { ...base, installato: false, occupato: 0 };
  const i = await inst.installato();
  const installato = i.stato === 'ok' || i.stato === 'vecchio' || i.stato === 'mancante';
  return {
    ...base,
    installato,
    occupato: installato ? await inst.spazioOccupato() : 0,
    permessi: fase.fase === 'pronto' ? permessiMancanti() : [],
  };
}

async function annuncia({ subito = true } = {}) {
  const ora = Date.now();
  if (!subito && ora - ultimoAnnuncio < ANNUNCIO_MS) {
    if (!annuncioRimandato) annuncioRimandato = setTimeout(() => { annuncioRimandato = null; annuncia(); }, ANNUNCIO_MS);
    return;
  }
  ultimoAnnuncio = ora;
  const MSG = globalThis.SN_MSG && globalThis.SN_MSG.MSG;
  const manda = globalThis.SN_BROADCAST_FILO;
  if (!MSG || typeof manda !== 'function') return;
  try {
    const stato = await statoPerLePagine();
    manda({ type: MSG.ALTRE_APP_AGGIORNATO, stato });
  } catch (_) {}
}

function imposta(nuova, opzioni) {
  fase = nuova;
  if (nuova.fase === 'scarica') barraFinestre(nuova.totali ? Math.min(1, nuova.ricevuti / nuova.totali) : 2);
  else if (nuova.fase === 'installa' || nuova.fase === 'prova') barraFinestre(2);
  else barraFinestre(-1);
  annuncia(opzioni);
}

function chiudiDriver() {
  clearTimeout(timerInattivo);
  timerInattivo = null;
  if (impl) {
    chiusuraVoluta = true;
    try { impl.chiudi(); } catch (_) {}
  }
  impl = null;
}

function rimandaChiusura() {
  clearTimeout(timerInattivo);
  timerInattivo = setTimeout(chiudiDriver, INATTIVO_MS);
  if (timerInattivo.unref) timerInattivo.unref();
}

function nuovoDriver(eseguibile, cartellaVersione) {
  chiusuraVoluta = false;
  const comando = typeof comandoProve === 'function' ? comandoProve(eseguibile) : null;
  const istanza = creaCuaDriver({
    eseguibile: comando ? comando.eseguibile : eseguibile,
    piattaforma: process.platform,
    casa: installatore().cartellaCasa,
    cwd: cartellaVersione,
    env: comando && comando.env ? { ...process.env, ...comando.env } : process.env,
    versione: (() => { try { return electron().app.getVersion(); } catch (_) { return '0'; } })(),
    avvia: comando && comando.argomenti
      ? (o) => require('./mcpStdio').avviaMcp({ ...o, argomenti: [...comando.argomenti, ...o.argomenti] })
      : undefined,
    onUscita: (info) => {
      if (impl !== istanza) return;
      impl = null;
      if (chiusuraVoluta || !acceso) return;
      console.warn('[Filo altre app] il driver si è chiuso da solo', info && info.messaggio, info && info.stderr ? info.stderr.slice(-800) : '');
      imposta({ fase: 'errore', codice: 'avvio', frase: 'Il componente per le altre applicazioni si è chiuso da solo. Reinstallarlo di solito lo rimette a posto.' });
    },
  });
  return istanza;
}

async function prova(eseguibile, cartellaVersione) {
  imposta({ fase: 'prova' });
  chiudiDriver();
  impl = nuovoDriver(eseguibile, cartellaVersione);
  const istanza = impl;
  let esito;
  try {
    esito = await Promise.race([
      istanza.prova(),
      new Promise((_, rej) => { const t = setTimeout(() => rej(new Error('tempo')), PROVA_MS); if (t.unref) t.unref(); }),
    ]);
  } catch (e) {
    if (impl === istanza) chiudiDriver();
    console.warn('[Filo altre app] prova d\'avvio fallita', e && e.message, e && e.dettaglio && e.dettaglio.stderr ? e.dettaglio.stderr.slice(-800) : '');
    imposta({ fase: 'errore', codice: 'avvio', frase: 'Il componente per le altre applicazioni è installato ma non parte. Reinstallarlo di solito lo rimette a posto.' });
    return false;
  }
  provatoInSessione = true;
  if (esito.mancano.length) {
    chiudiDriver();
    imposta({ fase: 'errore', codice: 'avvio', frase: `Il componente installato non sa fare tutto quello che serve a Filo (mancano: ${esito.mancano.join(', ')}). Reinstallalo.` });
    return false;
  }
  rimandaChiusura();
  imposta({ fase: 'pronto' });
  return true;
}

function annullaLavoro() {
  if (lavoro) { try { lavoro.controller.abort(); } catch (_) {} }
}

async function installa() {
  const controller = new AbortController();
  const promessa = (async () => {
    const inst = installatore();
    if (!inst.pacchetto) {
      imposta({ fase: 'non-supportato', frase: `Il componente per le altre applicazioni non esiste ancora per questo computer (${process.platform} ${process.arch}).` });
      return;
    }
    chiudiDriver();
    imposta({ fase: 'scarica', ricevuti: 0, totali: Number(inst.pacchetto.byte) || 0 });
    try {
      const fatto = await inst.installa({
        signal: controller.signal,
        onAvanzamento: (a) => {
          if (controller.signal.aborted) return;
          if (a.fase === 'scarica') imposta({ fase: 'scarica', ricevuti: a.ricevuti, totali: a.totali }, { subito: false });
          else imposta({ fase: 'installa' });
        },
      });
      if (controller.signal.aborted || !acceso) return;
      await prova(fatto.eseguibile, fatto.cartellaVersione);
    } catch (e) {
      if (e && e.codice === 'annullato') return;
      console.warn('[Filo altre app] installazione non riuscita', e && e.codice, e && e.causa ? (e.causa.message || e.causa) : '');
      if (!acceso) return;
      imposta({ fase: 'errore', codice: (e && e.codice) || 'rete', frase: (e && e.frase) || 'Non sono riuscito a installare il componente.' });
    }
  })();
  lavoro = { controller, promessa };
  try { await promessa; } finally {
    if (lavoro && lavoro.promessa === promessa) lavoro = null;
    if (!acceso && fase.fase !== 'spento') imposta({ fase: 'spento' });
  }
}

// Chiamata da chi vuole il componente pronto: scarica se manca, prova se non l'ha mai fatto in questa sessione.
async function assicura({ forza = false, verifica = false } = {}) {
  if (!acceso) return;
  if (lavoro) return lavoro.promessa;
  const inst = installatore();
  if (!inst.pacchetto) { imposta({ fase: 'non-supportato', frase: `Il componente per le altre applicazioni non esiste ancora per questo computer (${process.platform} ${process.arch}).` }); return; }
  const i = await inst.installato();
  if (forza || i.stato === 'assente' || i.stato === 'vecchio') return installa();
  if (i.stato === 'mancante') {
    imposta({ fase: 'errore', codice: 'mancante', frase: 'Il componente per le altre applicazioni non c\'è più sul computer, o è stato cambiato. Reinstallalo.' });
    return;
  }
  if (verifica && !provatoInSessione && !(impl && impl.vivo())) { await prova(i.eseguibile, i.cartellaVersione); return; }
  if (fase.fase !== 'errore' && fase.fase !== 'pronto') imposta({ fase: 'pronto' });
}

function configura(settings) {
  const vuole = !!(settings && settings.altreApp && settings.altreApp.enabled === true);
  if (vuole === acceso) return;
  acceso = vuole;
  if (vuole) { assicura().catch(() => {}); return; }
  annullaLavoro();
  chiudiDriver();
  imposta({ fase: 'spento' });
}

// L'avvio non aspetta il componente: lo stato si rilegge qualche secondo dopo, con le impostazioni di quel momento.
function avvia() {
  if (avviato) return;
  avviato = true;
  try { electron().app.on('will-quit', ferma); } catch (_) {}
  const t = setTimeout(async () => {
    try { configura(await globalThis.SN_STORAGE.getSettings()); } catch (_) {}
  }, 4000);
  if (t.unref) t.unref();
}

function ferma() {
  annullaLavoro();
  chiudiDriver();
}

async function disinstalla() {
  acceso = false;
  annullaLavoro();
  if (lavoro) { try { await lavoro.promessa; } catch (_) {} }
  chiudiDriver();
  provatoInSessione = false;
  try {
    await installatore().disinstalla();
  } catch (e) {
    console.warn('[Filo altre app] disinstallazione non riuscita', e && e.message);
    imposta({ fase: 'errore', codice: 'disco', frase: 'Non sono riuscito a togliere tutti i file del componente: chiudi i programmi che potrebbero usarli e riprova.' });
    return { ok: false };
  }
  imposta({ fase: 'spento' });
  return { ok: true };
}

async function reinstalla() {
  if (!acceso) return { ok: false, motivo: 'Prima accendi «Filo può usare le altre applicazioni».' };
  annullaLavoro();
  if (lavoro) { try { await lavoro.promessa; } catch (_) {} }
  provatoInSessione = false;
  assicura({ forza: true }).catch(() => {});
  return { ok: true };
}

// Il ComputerDriver per chi verrà dopo (le azioni del modello): stesso componente, stesse regole.
const driver = creaComputerDriver({
  apri: async () => {
    if (!acceso) return { motivo: 'L\'uso delle altre applicazioni è spento: si accende in Preferenze.' };
    if (lavoro) return { motivo: 'Il componente per le altre applicazioni si sta ancora installando.' };
    if (fase.fase === 'errore') return { motivo: fase.frase };
    if (!impl || !impl.vivo()) {
      const i = await installatore().installato();
      if (i.stato !== 'ok') {
        assicura().catch(() => {});
        return { motivo: 'Il componente per le altre applicazioni non è installato.' };
      }
      impl = nuovoDriver(i.eseguibile, i.cartellaVersione);
    }
    rimandaChiusura();
    return { implementazione: impl };
  },
});

const _perProve = {
  manifesto(m) { manifesto = m && typeof m === 'object' ? m : MANIFESTO; },
  // Al posto del programma installato si lancia questo comando, che riceve il percorso del programma.
  comando(fn) { comandoProve = typeof fn === 'function' ? fn : null; },
  fase: () => ({ acceso, ...fase }),
  cartella: () => cartella(),
};

const api = {
  avvia,
  configura,
  assicura,
  stato: statoPerLePagine,
  reinstalla,
  disinstalla,
  apriPermesso,
  driver,
  pacchetto: () => pacchettoPer(manifesto, process.platform, process.arch),
  _perProve,
};
globalThis.SN_ALTRE_APP = api;

module.exports = api;
