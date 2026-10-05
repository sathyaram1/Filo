// Aggiornamento automatico via electron-updater: solo nelle build installate (in dev si aggiorna col `git pull`).
// Con «Installa gli aggiornamenti da solo» spento non scarica né installa niente senza il suo «Installa».
// Fuori da Windows l'installazione può fermarsi: patterns/mac-e-linux-si-rompono-in-silenzio.md.

const { app } = require('electron');

const TIPO_DISPONIBILE = 'aggiornamento-disponibile';

// Lo stato di questa sessione: lo legge la home per disegnare la carta della versione nuova.
const stato = nuovoStato();
function nuovoStato() {
  return {
    aggiornatore: null,
    automatici: true,
    chiesto: false,       // l'utente ha premuto «Installa»: si installa alla chiusura anche da spento
    chiesta: null,        // la versione di quel «Installa», ricordata fra un avvio e l'altro
    versioneTrovata: null,
    scaricamento: null,   // { versione, percento } finché scarica
    pronta: null,         // la versione scaricata
    agganciata: false,    // electron-updater la installerà alla chiusura (vedi regola)
    errore: null,
    annuncia: () => {},
  };
}

function automaticiDa(settings) {
  return !(settings && settings.aggiornamenti && settings.aggiornamenti.automatici === false);
}

function annunciaAlleHome() {
  try { require('./services/handlers').broadcastLiveUpdate(); } catch (_) {}
}

function initAutoUpdater() {
  if (!app.isPackaged) return;
  // Non interferire con gli scenari di test/smoke headless.
  if (process.env.FILO_SMOKE || process.env.FILO_USER_DATA) return;

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (_) {
    return;
  }
  (async () => {
    let settings = null;
    try { settings = await globalThis.SN_STORAGE.getSettings(); } catch (_) {}
    await togliAvvisiSuperati(app.getVersion());
    const chiesta = await richiestaValida(app.getVersion());
    await avviaAggiornatore(autoUpdater, { automatici: automaticiDa(settings), chiesta, annuncia: annunciaAlleHome });
  })().catch((e) => console.error('[updater] avvio fallito:', e?.message || e));
}

// La decisione, separata da Electron perché la prova la fa girare su un aggiornatore finto. Senza `chiesta` vale
// quella di questo processo: un aggiornatore riavviato non scorda l'«Installa» dell'utente.
function avviaAggiornatore(aggiornatore, { automatici = true, chiesta = stato.chiesta, annuncia = () => {} } = {}) {
  Object.assign(stato, nuovoStato(), { aggiornatore, automatici, chiesta, annuncia });
  regola(aggiornatore);

  aggiornatore.on('error', (err) => {
    console.error('[updater] errore', err ? (err.stack || err).toString() : 'sconosciuto');
    // Dove l'installazione si ferma da sé l'avviso di Mac e Linux, che dice cosa fare, prende il posto della carta.
    if (AGGIORNAMENTO_BLOCCATO[process.platform] && stato.versioneTrovata) {
      stato.scaricamento = null;
      dimenticaRichiesta();
      togliCarte(() => true);
    } else scaricamentoFallito();
    avvisaSeAggiornamentoBloccato(stato.versioneTrovata);
  });
  aggiornatore.on('update-available', (info) => {
    stato.versioneTrovata = info?.version || null;
    console.log('[updater] update disponibile:', info?.version);
    if (stato.chiesta && stato.chiesta !== stato.versioneTrovata) dimenticaRichiesta();
    // Un «Installa» di un avvio precedente, interrotto dalla chiusura, riprende da solo: l'utente l'aveva già chiesto.
    else if (stato.chiesta && !stato.automatici && !stato.chiesto) {
      stato.chiesto = true;
      regola(aggiornatore);
      Promise.resolve().then(scarica);
    }
    if (!stato.automatici) avvisaVersioneNuova(stato.versioneTrovata);
    else togliCarte((n) => n.action.versione !== stato.versioneTrovata);
  });
  aggiornatore.on('update-not-available', () => {
    console.log('[updater] già aggiornato');
    if (stato.chiesta) dimenticaRichiesta();
  });
  aggiornatore.on('download-progress', (p) => {
    const percento = Math.max(0, Math.min(100, Math.floor(Number(p?.percent) || 0)));
    const prima = stato.scaricamento;
    stato.scaricamento = { versione: stato.versioneTrovata, percento };
    if (!prima || prima.percento !== percento) stato.annuncia();
  });
  aggiornatore.on('update-downloaded', (info) => {
    // electron-updater aggancia l'installazione alla chiusura subito dopo questo evento, solo se è accesa adesso.
    if (aggiornatore.autoInstallOnAppQuit) stato.agganciata = true;
    stato.scaricamento = null;
    stato.pronta = info?.version || stato.versioneTrovata;
    console.log('[updater] update scaricato:', stato.pronta, stato.aggiornatore.autoInstallOnAppQuit ? '— sarà applicato alla chiusura' : '— aspetta «Installa»');
    stato.annuncia();
  });

  return aggiornatore.checkForUpdatesAndNotify().catch((e) => {
    console.error('[updater] controllo update fallito:', e?.message || e);
    avvisaSeAggiornamentoBloccato(stato.versioneTrovata);
  });
}

// Da spento nessuna strada scarica o installa: né il controllo dell'avvio né la chiusura, finché non c'è «Installa».
function regola(aggiornatore) {
  aggiornatore.autoDownload = stato.automatici;
  aggiornatore.autoInstallOnAppQuit = stato.automatici || stato.chiesto;
  // electron-updater aggancia l'installazione alla chiusura solo a scaricamento finito: una versione già pronta
  // quando l'installazione si riaccende (spenta a metà scaricamento, poi «Installa» o riaccesa) va riagganciata.
  // Richiedere lo scaricamento di una versione già scaricata la ritrova in cache e rifà l'aggancio, senza rete.
  if (aggiornatore.autoInstallOnAppQuit && stato.pronta && !stato.agganciata) {
    stato.agganciata = true;
    Promise.resolve().then(() => aggiornatore.downloadUpdate()).catch((e) => {
      stato.agganciata = false;
      console.error('[updater] aggancio alla chiusura fallito:', e?.message || e);
    });
  }
}

// Una preferenza cambiata a sessione aperta vale subito: chi spegne dopo lo scaricamento dell'avvio non se lo
// ritrova installato alla chiusura, e chi riaccende scarica come all'avvio.
function seguiImpostazioni(settings) {
  const u = stato.aggiornatore;
  if (!u) return;
  const automatici = automaticiDa(settings);
  if (automatici === stato.automatici) return;
  stato.automatici = automatici;
  regola(u);
  if (!stato.versioneTrovata) return;
  if (automatici) scarica();
  else if (!stato.chiesto) avvisaVersioneNuova(stato.versioneTrovata);
  stato.annuncia();
}

// La carta e la chat passano di qui: l'esito dice cosa succede alla versione nuova, lo scaricamento non lo aspetta.
async function installaAggiornamento() {
  if (!stato.aggiornatore) {
    return { ok: false, error: 'Questa copia di Filo non si aggiorna da sé: la versione nuova si scarica da filo.red.' };
  }
  stato.chiesto = true;
  stato.errore = null;
  regola(stato.aggiornatore);
  const trovata = await trova();
  if (trovata) {
    ricordaRichiesta(stato.versioneTrovata);
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
  return { ok: true, versione, stato: stato.pronta ? 'pronta' : 'scarica' };
}

// Dopo un riavvio la carta c'è ancora ma il controllo di questa sessione può non essere finito.
async function trova() {
  const u = stato.aggiornatore;
  if (stato.versioneTrovata || stato.pronta) return true;
  try { await u.checkForUpdates(); } catch (e) {
    console.error('[updater] controllo update fallito:', e?.message || e);
    stato.errore = 'Adesso non riesco a controllare se c\'è una versione nuova. Riprova fra poco.';
    stato.annuncia();
    return false;
  }
  return !!stato.versioneTrovata;
}

async function scarica() {
  const u = stato.aggiornatore;
  if (!u || stato.scaricamento || stato.pronta) return;
  try {
    if (!stato.versioneTrovata) await u.checkForUpdates();
    if (!stato.versioneTrovata) {
      stato.errore = 'Adesso non trovo la versione nuova. Riprova fra poco.';
      stato.annuncia();
      return;
    }
    stato.scaricamento = { versione: stato.versioneTrovata, percento: 0 };
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
async function richiestaValida(versioneInUso) {
  const S = globalThis.SN_STORAGE;
  if (!S?.getRaw || !chiaveRichiesta()) return null;
  let r = null;
  try { r = await S.getRaw(chiaveRichiesta(), null); } catch (_) { return null; }
  if (!r || !r.versione) return null;
  if (nonPiuNuova(r.versione, versioneInUso)) {
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

// La home disegna la carta con quello che sta succedendo alla sua versione: lo stato vive qui, non nell'avviso.
function conStatoAggiornamento(lista) {
  return (lista || []).map((n) => {
    if (!n || !n.action || n.action.tipo !== TIPO_DISPONIBILE) return n;
    const v = n.action.versione;
    // Spenta a metà di uno scaricamento partito da solo, la versione non si installa: la carta chiede «Installa».
    const siInstalla = stato.automatici || stato.chiesto;
    let aggiornamento = null;
    if (siInstalla && stato.scaricamento && stato.scaricamento.versione === v) aggiornamento = { percento: stato.scaricamento.percento };
    else if (siInstalla && stato.pronta === v) aggiornamento = { pronta: true };
    else if (stato.errore) aggiornamento = { errore: stato.errore };
    return aggiornamento ? { ...n, aggiornamento } : n;
  });
}

// Le scritture degli avvisi passano in fila: leggere e poi aggiungere, in due, scriverebbe due carte uguali.
let fila = Promise.resolve();
function inFila(fn) {
  const passo = () => Promise.resolve().then(fn).catch((e) => console.error('[updater] avviso non scritto:', e?.message || e));
  fila = fila.then(passo, passo);
  return fila;
}

function testoDisponibile(v) {
  return `C'è la versione ${v} di Filo.\nCon «Installa» la scarico, e si installa quando chiudi Filo.`;
}

// Una carta per versione, come l'avviso di Mac e Linux: chi l'ha chiusa non se la ritrova. Una versione più
// nuova prende il posto di quella prima, perché «Installa» scarica comunque l'ultima.
function avvisaVersioneNuova(versione) {
  if (!versione) return Promise.resolve();
  togliCarte((n) => n.action.versione !== versione);
  return inFila(async () => {
    const FiloMem = globalThis.SN_FILO_MEMORY;
    if (!FiloMem?.addNotification) return;
    const gia = await FiloMem.listNotifications({ includeDismissed: true });
    if (gia.some((n) => n.action?.tipo === TIPO_DISPONIBILE && n.action.versione === versione)) return;
    await FiloMem.addNotification({
      kind: 'info',
      action: { tipo: TIPO_DISPONIBILE, versione },
      text: testoDisponibile(versione),
    });
    stato.annuncia();
  });
}

// Chiude le carte della versione nuova ancora in home che `via` indica.
function togliCarte(via, { acted = false } = {}) {
  return inFila(async () => {
    const FiloMem = globalThis.SN_FILO_MEMORY;
    if (!FiloMem?.dismissNotification) return;
    let tolte = 0;
    for (const n of await FiloMem.listNotifications()) {
      if (n.action?.tipo !== TIPO_DISPONIBILE || !via(n)) continue;
      await FiloMem.dismissNotification(n.id, { acted });
      tolte += 1;
    }
    if (tolte) stato.annuncia();
  });
}

function numeri(v) {
  return String(v || '').split(/[-+]/)[0].split('.').map((x) => parseInt(x, 10) || 0);
}
function nonPiuNuova(v, inUso) {
  const a = numeri(v);
  const b = numeri(inUso);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0);
  }
  return true;
}

// Una versione già installata (da «Installa», o riaccendendo l'opzione) non resta in home a chiedere «Installa».
function togliAvvisiSuperati(versioneInUso) {
  return togliCarte((n) => nonPiuNuova(n.action.versione, versioneInUso), { acted: true });
}

// I sistemi dove l'installazione automatica può fermarsi, col marcatore che riconosce l'avviso già scritto.
// Il marcatore resta diverso per sistema: cambiarlo farebbe ricomparire a chi l'aveva scartato lo stesso avviso.
const AGGIORNAMENTO_BLOCCATO = {
  darwin: {
    tipo: 'aggiornamento-mac',
    testo: (v) => `C'è la versione ${v} di Filo, ma su Mac non riesce a installarsi da sola.\n`
      + 'Scaricala da filo.red e sostituisci l\'app. Ci vuole un minuto.',
  },
  linux: {
    tipo: 'aggiornamento-linux',
    // Il file nuovo arriva dal browser senza il permesso di essere eseguito, come il primo: va detto.
    testo: (v) => `C'è la versione ${v} di Filo, ma su Linux non riesce a installarsi da sola.\n`
      + 'Scaricala da filo.red, sostituisci il file di Filo con quello nuovo e ridagli il permesso '
      + 'di esecuzione (tasto destro, Proprietà, «Consenti l\'esecuzione»). Ci vuole un minuto.',
  },
};

// Solo dove l'installazione può fermarsi, e solo se una versione nuova esiste davvero: senza, l'errore è del
// controllo (rete assente) e per l'utente non cambia niente. Una notifica per versione, anche se scartata.
async function avvisaSeAggiornamentoBloccato(versione) {
  const caso = AGGIORNAMENTO_BLOCCATO[process.platform];
  if (!caso || !versione) return;
  try {
    const FiloMem = globalThis.SN_FILO_MEMORY;
    if (!FiloMem?.addNotification) return;
    // Il riconoscimento passa da `action`, che la scheda non mostra: un marcatore nel testo lo leggerebbe l'utente.
    const gia = await FiloMem.listNotifications({ includeDismissed: true });
    if (gia.some((n) => n.action?.tipo === caso.tipo && n.action?.versione === versione)) return;
    await FiloMem.addNotification({
      kind: 'alert',
      action: { tipo: caso.tipo, versione },
      text: caso.testo(versione),
    });
    stato.annuncia();
  } catch (e) {
    console.error('[updater] avviso aggiornamento non scritto:', e?.message || e);
  }
}

module.exports = {
  initAutoUpdater, avviaAggiornatore, seguiImpostazioni, installaAggiornamento, conStatoAggiornamento,
  avvisaVersioneNuova, togliAvvisiSuperati, richiestaValida, avvisaSeAggiornamentoBloccato, TIPO_DISPONIBILE,
};
