// I contatori anonimi (#969, #1461, #1463, #1464, #1465, #1466, #1467, #1469, #1471, #1473, #1474): misura usi e chiamate dei modelli, azioni,
// chat, attività, navigazione, riquadri, gesti, sicurezza, home e automatismi e guasti di elenco chiuso, li tiene per ora sul disco e spedisce ogni ora le ore chiuse. In incognito
// e a contatori spenti non conta e non spedisce; spenti, butta quello che aveva, senza un ultimo segnale. Cosa esce: src/shared/contatoriGiornalieri.js.

const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Somme = require('./contatoriSomme');

const CHIAVE = 'contatoriGiornalieri';
// Il segno dell'uscita (#1466): «aperta» all'avvio, «chiusa» con la durata della chiusura all'ultimo istante, letto
// dall'avvio dopo. Un file suo e sincrono: a quel punto lo storage ha già scritto, e un crash non lascia altro.
const FILE_SEGNO = 'contatori-uscita.json';
// Il ciclo del main: campioni ogni 50 ms (bastano per soglie da 200 ms in su, e il main non si sveglia di più), letti
// una volta al secondo. Ogni lettura vale un blocco al più.
const RISOLUZIONE_FERMO_MS = 50;
const LETTURA_FERMO_MS = 1000;
// Una sessione riaperta si misura fino alla scheda in vista e alla fine della coda, o al più per dieci minuti.
const ATTESA_SESSIONE_MS = 10 * 60 * 1000;
const PRIMO_CONTROLLO_MS = 60 * 1000;
const CONTROLLO_OGNI_MS = 60 * 60 * 1000;
const SALVA_DOPO_MS = 3000;
const ATTESA_RETE_MS = 20000;
// Un'azione che aspetta una pagina smette di aspettare dopo un minuto: conta, senza fascia per quello che non è arrivato.
const ATTESA_AZIONE_MS = 60 * 1000;
// Una conferma senza risposta dopo dieci minuti è una conferma lasciata lì.
const CONFERMA_SCADE_MS = 10 * 60 * 1000;
// Un'intervista di benvenuto ferma da un giorno senza essere chiusa è abbandonata al passo dove si è fermata.
const INTERVISTA_FERMA_MS = 24 * 60 * 60 * 1000;
// La lettura dell'owner: mille pseudonimi a pagina, e duecento pagine prima di dire «almeno».
const PAGINA_LETTURA = 1000;
const TETTO_PAGINE = 200;
// Le ore nuove arrivano ogni ora: la stessa richiesta delle somme vale dieci minuti, «Rileggi» la rifà subito.
const LETTURA_VALE_MS = 10 * 60 * 1000;
const LETTURE_TENUTE = 4;

// Una chat chiusa aspetta il suo tipo al più due giorni (la classificazione ritenta all'avvio dopo): poi esce senza.
const CHIUSA_ASPETTA_MS = 2 * 24 * 60 * 60 * 1000;
const TETTO_CHIUSE_IN_ATTESA = 500;

const MUTO = Object.freeze({ visto() {}, errore() {}, fine() {}, chiamata() {}, tardiva() {} });
const AZIONE_MUTA = Object.freeze({ visto() {}, fine() {}, scheda() {} });
const TURNO_MUTO = Object.freeze({ giro() {}, azioni() {}, strumento() {}, recupero() {}, fine() {} });

function valoreFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(valoreFs) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, valoreFs(x)])) } };
}

function statoVuoto() {
  return { ore: {}, giorni: {}, pseudonimi: {}, mesi: {}, primi: {}, presenza: '', fallitoIl: '', rifiutati: {}, ultimo: null, errore: '', intervista: null, chiuse: {}, uscite: {} };
}

const oggetto = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
// Lo stato va e viene dallo storage per copia: lo stesso oggetto cambiato fra due salvataggi lo storage lo conterebbe
// fra i valori cambiati senza set (#1466), e quel conto deve dire degli altri.
const copia = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

function normale(s) {
  const o = oggetto(s) ? s : {};
  return {
    ore: oggetto(o.ore) ? o.ore : {},
    // I giorni contati prima dell'invio ogni ora: partono come allora, poi la mappa resta vuota.
    giorni: oggetto(o.giorni) ? o.giorni : {},
    pseudonimi: oggetto(o.pseudonimi) ? o.pseudonimi : {},
    mesi: oggetto(o.mesi) ? o.mesi : {},
    // I giorni e i mesi di cui è già arrivato il primo documento.
    primi: oggetto(o.primi) ? o.primi : {},
    presenza: typeof o.presenza === 'string' ? o.presenza : '',
    fallitoIl: typeof o.fallitoIl === 'string' ? o.fallitoIl : '',
    rifiutati: oggetto(o.rifiutati) ? o.rifiutati : {},
    ultimo: oggetto(o.ultimo) ? o.ultimo : null,
    errore: typeof o.errore === 'string' ? o.errore : '',
    // L'intervista aperta: il passo dove è, quando è stata toccata l'ultima volta, e se il suo abbandono è già contato.
    intervista: oggetto(o.intervista) ? o.intervista : null,
    // Le chat chiuse che aspettano il tipo dal classificatore, per id: restano sul disco, non partono mai così.
    chiuse: oggetto(o.chiuse) ? o.chiuse : {},
    // Le chat la cui scheda se n'è andata e che non si sono ancora contate: all'avvio dopo escono come «uscita».
    uscite: oggetto(o.uscite) ? o.uscite : {},
  };
}

function crea(dip = {}) {
  const C = dip.contatori || globalThis.SN_CONTATORI;
  const F = dip.contatoriFinestra || globalThis.SN_CONTATORI_FINESTRA || null;
  const S = dip.contatoriSicurezza || globalThis.SN_CONTATORI_SICUREZZA || null;
  const H = dip.contatoriHomePagina || globalThis.SN_CONTATORI_HOME_PAGINA || null;
  const disco = () => require('../shim/storage');
  const storage = dip.storage || globalThis.SN_STORAGE;
  const impostazioni = dip.impostazioni || (() => storage.getSettings());
  const inIncognito = dip.inIncognito || (() => disco().inIncognito());
  const runNormale = dip.runNormale || ((fn) => disco().runNormale(fn));
  const scriviSubito = dip.scriviSubito || ((k, v) => disco().setSync({ [k]: v }));
  const fetchFn = dip.fetch || ((...a) => fetch(...a));
  const adesso = dip.adesso || (() => Date.now());
  const versione = dip.versione || (() => require('electron').app.getVersion());
  const piattaforma = dip.piattaforma || process.platform;
  // Gli identificativi che lo pseudonimo non deve mai ripetere: il codice dei feedback e lo pseudonimo dei crediti.
  const esclusi = dip.esclusi || (async () => []);
  const casuale = dip.casuale || (() => crypto.randomBytes(10).toString('hex'));
  const rest = dip.rest || (() => (globalThis.SN_FEEDBACK && globalThis.SN_FEEDBACK.rest) || {});
  // L'identità anonima dell'installazione, la stessa dei crediti: le regole non accettano un'ora senza (#1547). Si chiede
  // solo spedendo, quindi a contatori accesi; il documento non la porta.
  const idToken = dip.idToken || (() => require('../auth/anon-auth').getIdToken());
  const log = dip.log || ((...a) => console.warn('[contatori]', ...a));
  // L'ora conta come «Filo aperto» solo con una finestra normale: chi usa solo l'incognito non lascia traccia.
  const finestreDiFilo = () => {
    try {
      const { BrowserWindow } = require('electron');
      return BrowserWindow.getAllWindows().filter((w) => w && !w.isDestroyed() && w._filoTabs);
    } catch (_) { return []; }
  };
  const finestraNormale = dip.finestraNormale || (() => finestreDiFilo().some((w) => !w._filoIncognito));
  // Un guasto di tutta l'app (un'eccezione, un processo comune) con aperte solo finestre incognito non si conta; prima
  // che ci sia una finestra, all'avvio, sì.
  const soloIncognito = dip.soloIncognito || (() => { const f = finestreDiFilo(); return f.length > 0 && f.every((w) => w._filoIncognito); });
  // Il sistema (#1466): la cartella del segno, gli eventi del disco, la memoria dei processi e le schede delle finestre normali.
  const cartella = dip.cartella || (() => process.env.FILO_USER_DATA || require('electron').app.getPath('userData'));
  const contiDisco = dip.contiDisco || (() => require('../shim/storage').contiDisco());
  const dimensioneDisco = dip.dimensioneDisco || (() => require('../shim/storage').dimensioneDisco());
  const metriche = dip.metriche || (() => require('electron').app.getAppMetrics());
  const schede = dip.schede || (() => {
    const tutte = finestreDiFilo().filter((w) => !w._filoIncognito).flatMap((w) => (Array.isArray(w._filoTabs.tabs) ? w._filoTabs.tabs : []));
    const attesa = tutte.filter((t) => t && t._rinviata).length;
    return { vive: tutte.length - attesa, attesa };
  });
  const istogramma = dip.istogramma || ((o) => require('node:perf_hooks').monitorEventLoopDelay(o));

  const usoCorrente = new AsyncLocalStorage();
  let stato = null;
  let carico = null;
  let timerSalva = null;
  // Da quando Filo esce ogni salvataggio è sincrono: un timer non arriverebbe più.
  let inUscita = false;
  let giroInVolo = null;
  // Spegnere a metà di una registrazione la butta: quella partita prima non rientra dopo lo spegnimento.
  let generazione = 0;
  // In memoria soltanto: l'ultima volta di ogni funzione o azione (per le richieste ripetute), le conferme aperte e
  // le ultime azioni di Filo (per gli annulli).
  const ultimeVolte = new Map();
  const confermeAperte = new Map();
  // Le conferme già contate «senza risposta»: una risposta tardiva non le conta una seconda volta.
  const confermeScadute = new Map();
  const azioniDiFilo = [];
  // Chi tiene uno stato da fotografare nell'ora a ogni scrittura (la finestra, #1470): sincrono, non lancia mai.
  const primaDiScrivere = [];
  // L'ultima risposta dell'interruttore, per chi non può aspettarla (un campione al secondo, la chiusura). null: non
  // ancora letta, e quello che arriva intanto aspetta la prima lettura.
  let ultimoAccesi = null;
  // Il sistema (#1466) si raccoglie qui, fuori dall'ora e senza scrivere: entra nell'ora alla prima scrittura che c'è
  // comunque (un conto, il giro dell'ora, la chiusura). Un campione al secondo o una chiamata sincrona per pagina non
  // diventano così una scrittura dello storage ciascuno.
  let sospesa = C.oraVuota();

  function carica() {
    if (!carico) {
      carico = (async () => {
        let s = null;
        try { s = await runNormale(() => storage.getRaw(CHIAVE, null)); } catch (_) { s = null; }
        stato = normale(copia(s));
      })();
    }
    return carico;
  }

  async function salva() {
    if (timerSalva) { clearTimeout(timerSalva); timerSalva = null; }
    if (!stato) return;
    try { await runNormale(() => storage.setRaw(CHIAVE, copia(stato))); } catch (e) { log('stato non salvato', String((e && e.message) || e)); }
  }

  function salvaPresto() {
    if (inUscita) { scriviOra(); return; }
    if (timerSalva) return;
    timerSalva = setTimeout(() => { timerSalva = null; salva().catch(() => {}); }, SALVA_DOPO_MS);
    if (timerSalva && typeof timerSalva.unref === 'function') timerSalva.unref();
  }

  function scriviOra() {
    if (timerSalva) { clearTimeout(timerSalva); timerSalva = null; }
    if (!stato) return;
    try { scriviSubito(CHIAVE, stato); } catch (e) { log('stato non salvato alla chiusura', String((e && e.message) || e)); }
  }

  // Alla chiusura di Filo (before-quit e will-quit): quello che aspettava il timer va sul disco adesso.
  function alChiudere() {
    inUscita = true;
    scriviOra();
  }

  const spentiIn = (s) => Boolean(s && s.contatori && s.contatori.attivi === false);
  // Nel dubbio spenti: un'impostazione che non si legge non vale come un sì.
  async function accesi() {
    try {
      const s = await impostazioni();
      ultimoAccesi = Boolean(s) && !spentiIn(s);
    } catch (_) { ultimoAccesi = false; }
    return ultimoAccesi;
  }

  async function azzera() {
    generazione += 1;
    ultimeVolte.clear();
    confermeAperte.clear();
    confermeScadute.clear();
    azioniDiFilo.length = 0;
    scartaSospesa();
    if (segnoForse) togliSegno();
    await carica();
    const c = stato;
    const vuoto = !Object.keys(c.ore).length && !Object.keys(c.giorni).length && !Object.keys(c.pseudonimi).length
      && !Object.keys(c.mesi).length && !c.ultimo && !c.fallitoIl && !c.presenza && !c.intervista && !Object.keys(c.chiuse).length
      && !Object.keys(c.uscite).length;
    if (vuoto) return false;
    stato = statoVuoto();
    await salva();
    return true;
  }

  // Per zona, se le icone sono disposte come di serie (#1471): l'ora in corso la prende da qui, com'è adesso.
  let disposizione = null;

  function oraCorrente() {
    const k = C.oraDi(adesso());
    if (!stato.ore[k]) stato.ore[k] = { ...C.oraVuota(), app: C.versioneApp(versione()) };
    if (disposizione) C.segnaDisposizione(stato.ore[k], disposizione);
    return stato.ore[k];
  }

  // Il primo giorno di Filo aperto senza usare niente parte lo stesso, vuoto: serve a sapere quante copie sono in uso.
  function segnaPresenza() {
    let aperta = false;
    try { aperta = Boolean(finestraNormale()); } catch (_) { aperta = false; }
    const oggi = C.giornoDi(adesso());
    if (aperta && stato.presenza !== oggi) {
      oraCorrente();
      stato.presenza = oggi;
    }
  }

  // La sola porta da cui un conto entra nell'ora: controlla incognito e interruttore, e scrive dopo il caricamento.
  async function conta(scrivi, { incognito = null } = {}) {
    const inc = incognito == null ? inIncognito() : incognito;
    if (inc) return false;
    const mia = generazione;
    if (!(await accesi())) { await azzera(); return false; }
    await carica();
    if (mia !== generazione) return false;
    scaduteLeConferme();
    const ora = oraCorrente();
    stato.presenza = C.giornoDi(adesso());
    raccogli();
    for (const fn of primaDiScrivere) { try { fn(ora); } catch (_) {} }
    const fatto = scrivi(ora);
    salvaPresto();
    return fatto !== false;
  }

  // ── Il sistema (#1466): avvio, processi, blocchi, eccezioni, memoria, chiamate sincrone, chiusura, disco, sessione,
  // aggiornamenti. Ogni porta passa un nome o un codice; l'elenco chiuso lo riduce, e il resto non esce.
  function sistema(scrivi, { incognito = false } = {}) {
    try {
      if (incognito || ultimoAccesi === false) return false;
      return scrivi(sospesa) !== false;
    } catch (_) { return false; }
  }

  // Sincrono: chi lo chiama ha già saputo che i contatori sono accesi e ha caricato lo stato.
  function raccogli() {
    try {
      const d = contiDisco();
      if (oggetto(d)) for (const [evento, n] of Object.entries(d)) C.registraStorage(sospesa, evento, n);
    } catch (_) {}
    if (!stato || C.sistemaVuoto(sospesa)) return;
    C.unisciSistema(oraCorrente(), sospesa);
    sospesa = C.oraVuota();
  }

  function scartaSospesa() {
    sospesa = C.oraVuota();
    try { contiDisco(); } catch (_) {}
  }

  function passoAvvio(passo, ms) { return sistema((o) => C.registraPassoAvvio(o, passo, ms)); }

  // Un passo che finisce quando la pagina `wc` arriva al primo evento fra `eventi`; senza, in un minuto non conta.
  function passoAvvioFino(passo, t0, wc, eventi = ['dom-ready', 'did-stop-loading']) {
    try {
      if (!wc || typeof wc.once !== 'function' || (wc.isDestroyed && wc.isDestroyed())) return false;
      if (typeof wc.isLoading === 'function' && !wc.isLoading()) return passoAvvio(passo, Math.max(0, adesso() - t0));
      let fatto = false;
      let timer = null;
      const fine = (ok) => {
        if (fatto) return;
        fatto = true;
        if (timer) clearTimeout(timer);
        if (ok) passoAvvio(passo, Math.max(0, adesso() - t0));
      };
      timer = setTimeout(() => fine(false), ATTESA_AZIONE_MS);
      if (timer && typeof timer.unref === 'function') timer.unref();
      for (const e of eventi) wc.once(e, () => fine(true));
      wc.once('destroyed', () => fine(false));
      return true;
    } catch (_) { return false; }
  }

  function processoMorto(tipo, motivo, { incognito = null } = {}) {
    return sistema((o) => C.registraProcessoMorto(o, tipo, motivo), { incognito: incognito == null ? soloIncognito() : incognito });
  }

  function eccezione(origine, err) {
    let fuori = false;
    try { fuori = soloIncognito() || inIncognito(); } catch (_) { fuori = false; }
    return sistema((o) => C.registraEccezione(o, origine, err), { incognito: fuori });
  }

  function ipcSincrono(canale, ms, { incognito = false } = {}) {
    return sistema((o) => C.registraIpcSincrono(o, canale, ms), { incognito });
  }

  function aggiornamento(evento) { return sistema((o) => C.registraAggiornamento(o, evento)); }

  // La finestra principale che smette di rispondere: quante volte, e quanto dura fino a quando torna o la si chiude.
  // Durante l'uscita non si conta: una finestra che si chiude può non rispondere, e non è un blocco.
  function seguiFinestra(win) {
    if (!win || typeof win.on !== 'function') return false;
    let dal = 0;
    const finita = (cosa) => {
      if (!dal) return;
      const ms = Math.max(0, adesso() - dal);
      dal = 0;
      sistema((o) => C.registraFinestraBloccata(o, cosa, ms));
    };
    win.on('unresponsive', () => {
      if (dal || chiusuraDal) return;
      dal = adesso();
      sistema((o) => C.registraFinestraBloccata(o, 'volte'));
    });
    win.on('responsive', () => finita('tornata'));
    win.on('close', () => finita('chiusa_da_utente'));
    win.on('closed', () => finita('chiusa_da_utente'));
    return true;
  }

  // La sessione riaperta all'avvio: l'esito, quante schede, e quanto fino alla scheda in vista caricata e alla fine
  // della coda. Il conto parte quando sono arrivate tutte e due, o dopo dieci minuti con quello che c'è.
  function sessione({ esito, schede: n = 0, t0 = adesso() } = {}) {
    const muto = { vista() {}, coda() {} };
    try {
      if (!C.ESITI_SESSIONE.includes(esito)) return muto;
      if (esito !== 'ripristinata') { sistema((o) => C.registraSessione(o, { esito })); return muto; }
      const m = { vistaMs: null, codaMs: null, vista: false, coda: false, fatta: false };
      const chiudi = () => {
        if (m.fatta) return;
        m.fatta = true;
        clearTimeout(timer);
        sistema((o) => C.registraSessione(o, { esito, schede: n, vistaMs: m.vistaMs, codaMs: m.codaMs }));
      };
      const timer = setTimeout(chiudi, ATTESA_SESSIONE_MS);
      if (timer && typeof timer.unref === 'function') timer.unref();
      const arrivata = (campo) => () => {
        if (m.fatta || m[campo]) return;
        m[campo] = true;
        m[`${campo}Ms`] = Math.max(0, adesso() - t0);
        if (m.vista && m.coda) chiudi();
      };
      return { vista: arrivata('vista'), coda: arrivata('coda') };
    } catch (_) { return muto; }
  }

  // Memoria di tutti i processi di Filo, schede delle finestre normali e grandezza del file dei dati: una volta l'ora.
  function campionaSistema() {
    try {
      const m = metriche();
      if (Array.isArray(m) && m.length) {
        const kb = m.reduce((a, p) => a + (Number(p && p.memory && p.memory.workingSetSize) || 0), 0);
        const { vive, attesa } = schede();
        sistema((o) => C.registraMemoria(o, { mb: kb / 1024, vive, attesa }));
      }
    } catch (_) {}
    try {
      const ev = C.eventoDimensione(dimensioneDisco());
      if (ev) sistema((o) => C.registraStorage(o, ev));
    } catch (_) {}
  }

  // ── Il ciclo del main ──
  let fermo = null;
  function avviaFermo() {
    if (fermo) return;
    try {
      const h = istogramma({ resolution: RISOLUZIONE_FERMO_MS });
      h.enable();
      const t = setInterval(leggiFermo, LETTURA_FERMO_MS);
      if (t && typeof t.unref === 'function') t.unref();
      fermo = { h, t, salta: 0 };
    } catch (_) { fermo = null; }
  }
  function fermaFermo() {
    if (!fermo) return;
    clearInterval(fermo.t);
    try { fermo.h.disable(); } catch (_) {}
    fermo = null;
  }
  // I valori dell'istogramma sono intervalli interi fra due campioni: il ritardo è quello che supera la risoluzione.
  function leggiFermo() {
    if (!fermo) return;
    let ritardo = NaN;
    try { ritardo = Number(fermo.h.max) / 1e6 - RISOLUZIONE_FERMO_MS; fermo.h.reset(); } catch (_) {}
    if (fermo.salta > 0) { fermo.salta -= 1; return; }
    if (!Number.isFinite(ritardo) || ritardo < 0 || !finestraNormale()) return;
    sistema((o) => C.registraMainFermo(o, ritardo));
  }
  // Un computer che dorme non è un ciclo fermo: le letture a cavallo del sonno si buttano.
  function sonno() {
    if (!fermo) return;
    try { fermo.h.reset(); } catch (_) {}
    fermo.salta = 2;
  }

  // ── Il segno dell'uscita ──
  let segnoMio = false;
  // All'inizio non si sa se ce n'è uno di quando i contatori erano accesi: il primo spegnimento lo toglie.
  let segnoForse = true;
  let avvioLetto = false;
  let chiusuraDal = 0;
  let tettoCookie = false;
  const percorsoSegno = () => path.join(cartella(), FILE_SEGNO);
  function leggiSegno() {
    try { const o = JSON.parse(fs.readFileSync(percorsoSegno(), 'utf8')); return oggetto(o) ? o : null; } catch (_) { return null; }
  }
  function scriviSegno(o) {
    try { fs.writeFileSync(percorsoSegno(), JSON.stringify(o)); return true; } catch (_) { return false; }
  }
  function togliSegno() {
    segnoMio = false;
    segnoForse = false;
    try { fs.rmSync(percorsoSegno(), { force: true }); } catch (_) {}
  }

  // All'avvio: com'era finita la volta prima, se è il primo dopo un aggiornamento, e il segno «aperta» per la prossima.
  async function avvioProcesso() {
    if (avvioLetto) return false;
    avvioLetto = true;
    if (!(await accesi())) { togliSegno(); return false; }
    const prima = leggiSegno();
    const v = C.versioneApp(versione());
    segnoMio = scriviSegno({ stato: 'aperta', versione: v });
    segnoForse = segnoMio;
    const primaV = prima && C.APP_RE.test(String(prima.versione)) ? String(prima.versione) : '';
    sistema((o) => {
      C.registraTipoAvvio(o, primaV && primaV !== v ? 'dopo_aggiornamento' : 'freddo');
      if (!prima) return;
      C.registraUscita(o, prima.stato === 'chiusa' ? 'pulita' : 'non_pulita');
      if (prima.stato === 'chiusa') C.registraChiusura(o, { ms: prima.ms, tetto: prima.tetto === true });
    });
    return true;
  }

  function secondaIstanza() { return sistema((o) => C.registraTipoAvvio(o, 'seconda_istanza')); }
  function inizioChiusura() { if (!chiusuraDal) chiusuraDal = adesso(); }
  function tettoChiusura() { tettoCookie = true; }
  // L'ultimo istante dell'uscita, sincrono. `sistema`: chiude il sistema (spegnimento, fine sessione), e non c'è una
  // durata da misurare; non è un crash.
  function fineChiusura({ sistema: dalSistema = false } = {}) {
    if (!segnoMio || ultimoAccesi === false) return false;
    const ms = !dalSistema && chiusuraDal ? Math.max(0, adesso() - chiusuraDal) : null;
    return scriviSegno({ stato: 'chiusa', versione: C.versioneApp(versione()), ms, tetto: tettoCookie });
  }

  // Per la scrittura sincrona della chiusura: lo stato con dentro quello che aspettava. Spenti o mai letti, niente.
  function perLaChiusura() {
    try {
      if (!stato || ultimoAccesi !== true) return {};
      raccogli();
      return { [CHIAVE]: copia(stato) };
    } catch (_) { return {}; }
  }

  // Prima di un'uscita che non passa dalla chiusura (l'installatore lanciato all'avvio): l'ora va nello storage adesso.
  async function salvaSubito() {
    if (!(await accesi())) return false;
    await carica();
    raccogli();
    await salva();
    return true;
  }

  function ripetuta(chiave, t) {
    const prima = ultimeVolte.get(chiave);
    ultimeVolte.set(chiave, t);
    if (ultimeVolte.size > 500) ultimeVolte.delete(ultimeVolte.keys().next().value);
    return prima != null && t - prima >= 0 && t - prima <= C.RIPETUTA_MS;
  }

  function primaVolta(ora, id) {
    const mese = C.meseDi(C.giornoDi(adesso()));
    const visti = Array.isArray(stato.mesi[mese]) ? stato.mesi[mese] : [];
    if (visti.includes(id)) return;
    visti.push(id);
    stato.mesi[mese] = visti;
    for (const k of Object.keys(stato.mesi).sort().slice(0, -2)) delete stato.mesi[k];
    C.registraPrimaVolta(ora, id);
  }

  // `chiamate`: quante volte l'uso è andato al modello (le risposte dalla cache no).
  function registraUso(funzione, attese, errori, { uso = true, t0 = adesso(), chiamate = 0 } = {}) {
    if (!uso && !errori.length) return Promise.resolve(false);
    const rip = uso ? ripetuta(`f:${funzione}`, t0) : false;
    return conta((ora) => {
      if (uso && C.registraUso(ora, funzione, { ...attese, ripetuta: rip })) primaVolta(ora, funzione);
      if (uso && chiamate > 0) C.registraChiamate(ora, funzione, chiamate);
      for (const e of errori) C.registraErrore(ora, funzione, e);
    });
  }

  // I numeri della risposta che ha servito, e il costo arrivato dopo (#1464): contano subito, anche dentro un uso.
  function chiamataServita(funzione, info) {
    const lista = (Array.isArray(info) ? info : [info]).filter((x) => oggetto(x));
    if (!lista.length) return;
    conta((ora) => { for (const c of lista) C.registraChiamata(ora, funzione, c); }).catch(() => {});
  }
  function spesaTardiva(funzione, modello, usd) {
    conta((ora) => C.registraSpesa(ora, funzione, modello, 'tardiva', usd)).catch(() => {});
  }

  function errorePer(lista) {
    return (err, { modello = '', host = '' } = {}) => {
      const tipo = C.tipoErrore(err);
      if (tipo) lista.push({ modello, host, tipo });
    };
  }

  // Un uso che raccoglie più chiamate della stessa funzione: un messaggio di chat con i suoi giri di strumenti, una
  // dettatura coi suoi ripieghi. L'attesa parte da quando è partito l'uso, non dall'ultima chiamata.
  async function unUso(action, fn, { soloGuasti = false } = {}) {
    const funzione = C.funzioneDi(action);
    const fuori = usoCorrente.getStore();
    if (!funzione || inIncognito() || (fuori && !fuori.chiuso && fuori.funzione === funzione)) return fn();
    // `chiamate` conta anche le risposte dalla cache (l'uso c'è stato); `alModello` solo quelle andate al modello.
    const uso = { funzione, t0: adesso(), visto: null, errori: [], chiamate: 0, alModello: 0, chiuso: false, soloGuasti, ok: false };
    try {
      const r = await usoCorrente.run(uso, fn);
      uso.ok = true;
      return r;
    } finally {
      uso.chiuso = true;
      const fine = uso.ok ? adesso() - uso.t0 : null;
      if (uso.chiamate > 0) {
        registraUso(funzione, { visto: uso.visto, fine }, uso.errori, { uso: !soloGuasti, t0: uso.t0, chiamate: uso.alModello }).catch(() => {});
      }
    }
  }

  // Una chiamata che non è la richiesta di chi usa Filo: un anticipo (la spiegazione preparata alla selezione) o un
  // pezzo di un uso già contato (un blocco della traduzione, un passo dell'Aiuto). Conta i guasti, non un uso: l'uso
  // lo conta chi vede la risposta (`usoDallaPagina`) o la prima chiamata della richiesta.
  function parteDiUnUso(action, fn) { return unUso(action, fn, { soloGuasti: true }); }

  // Una risposta data dalla cache è un uso come un altro, senza attesa: il cancello delle chiamate non la vede.
  function servitaDaCache(action) {
    try {
      const funzione = C.funzioneDi(action);
      if (!funzione || inIncognito()) return;
      const uso = usoCorrente.getStore();
      if (uso && !uso.chiuso && uso.funzione === funzione) {
        uso.chiamate += 1;
        if (uso.visto == null) uso.visto = adesso() - uso.t0;
        return;
      }
      registraUso(funzione, { visto: 0, fine: 0 }, []).catch(() => {});
    } catch (_) {}
  }

  // L'uso che conta la superficie dove la persona chiede e vede: una spiegazione preparata e poi aperta, la correzione
  // di una parola già pronta. `attesaMs` va dal gesto alla risposta a schermo; null se non ne è arrivata una. È anche
  // l'anticipo aperto: quello preparato lo conta `anticipoPronto`.
  const DALLA_PAGINA = new Set(dip.dallaPagina || []);
  const ATTESA_MAX_MS = 60 * 60 * 1000;
  const attesaPulita = (ms) => {
    const n = Number(ms);
    return ms == null || !Number.isFinite(n) || n < 0 ? null : Math.min(n, ATTESA_MAX_MS);
  };
  function usoDallaPagina(action, attesaMs, { anticipata = false } = {}) {
    const funzione = C.funzioneDi(action);
    if (!funzione || (DALLA_PAGINA.size && !DALLA_PAGINA.has(action)) || inIncognito()) return false;
    const attesa = attesaPulita(attesaMs);
    const rip = ripetuta(`f:${funzione}`, adesso());
    conta((ora) => {
      if (C.registraUso(ora, funzione, { visto: attesa, fine: attesa, ripetuta: rip })) primaVolta(ora, funzione);
      if (anticipata) C.registraAnticipo(ora, funzione, 'aperto');
    }).catch(() => {});
    return true;
  }

  // Il cancello chiama `apri` a ogni chiamata; `visto` alla prima cosa che arriva a schermo, `errore` a ogni tentativo
  // fallito, `fine` una volta. Non lancia mai: un contatore rotto non ferma una risposta.
  function apri(action) {
    try {
      const funzione = C.funzioneDi(action);
      if (!funzione || inIncognito()) return MUTO;
      // Un lavoro partito dentro un uso e arrivato dopo la sua fine conta da sé.
      const chiamata = (info) => chiamataServita(funzione, info);
      const tardiva = (modello, usd) => spesaTardiva(funzione, modello, usd);
      const uso = usoCorrente.getStore();
      if (uso && !uso.chiuso && uso.funzione === funzione) {
        uso.chiamate += 1;
        uso.alModello += 1;
        return {
          visto() { if (uso.visto == null) uso.visto = adesso() - uso.t0; },
          errore: errorePer(uso.errori),
          fine(ok) { if (ok && uso.visto == null) uso.visto = adesso() - uso.t0; },
          chiamata,
          tardiva,
        };
      }
      const t0 = adesso();
      const errori = [];
      let visto = null;
      let chiuso = false;
      return {
        visto() { if (visto == null) visto = adesso() - t0; },
        errore: errorePer(errori),
        fine(ok) {
          if (chiuso) return;
          chiuso = true;
          const fine = ok ? adesso() - t0 : null;
          if (ok && visto == null) visto = fine;
          registraUso(funzione, { visto, fine }, errori, { t0, chiamate: 1 }).catch(() => {});
        },
        chiamata,
        tardiva,
      };
    } catch (_) { return MUTO; }
  }

  // ── Le azioni (#1461): dal gesto alla prima cosa visibile e alla fine ──────────────────────────────────────────
  function registraAzione(id, attese, t0) {
    const rip = ripetuta(`a:${id}`, t0);
    return conta((ora) => { if (C.registraAzione(ora, id, { ...attese, ripetuta: rip })) primaVolta(ora, id); });
  }

  // `scheda(wc)`: l'azione finisce in una pagina, visibile al primo DOM pronto e finita quando smette di caricare.
  function azione(id, { t0 = null, incognito = null } = {}) {
    try {
      if (!C.azioni().includes(id) || (incognito == null ? inIncognito() : incognito)) return AZIONE_MUTA;
      const inizio = Number.isFinite(Number(t0)) && t0 != null ? Number(t0) : adesso();
      let visto = null;
      let chiuso = false;
      let timer = null;
      const h = {
        visto() { if (!chiuso && visto == null) visto = Math.max(0, adesso() - inizio); },
        fine(ok = true) {
          if (chiuso) return;
          chiuso = true;
          if (timer) clearTimeout(timer);
          const fine = ok ? Math.max(0, adesso() - inizio) : null;
          if (ok && visto == null) visto = fine;
          registraAzione(id, { visto, fine }, inizio).catch(() => {});
        },
        scheda(wc) {
          if (!wc || typeof wc.once !== 'function' || (wc.isDestroyed && wc.isDestroyed())) { h.fine(); return; }
          wc.once('dom-ready', () => h.visto());
          wc.once('did-stop-loading', () => h.fine(true));
          wc.once('destroyed', () => h.fine(false));
          timer = setTimeout(() => h.fine(false), ATTESA_AZIONE_MS);
          if (timer && typeof timer.unref === 'function') timer.unref();
        },
      };
      return h;
    } catch (_) { return AZIONE_MUTA; }
  }

  // Un'azione misurata nella pagina che l'ha vista: le attese arrivano già fatte, e si fidano solo del loro tetto.
  function azioneMisurata(id, { vistoMs = null, fineMs = null } = {}) {
    if (!C.azioni().includes(id) || inIncognito()) return false;
    const fine = attesaPulita(fineMs);
    const visto = attesaPulita(vistoMs);
    registraAzione(id, { visto: visto == null ? fine : Math.min(visto, fine == null ? visto : fine), fine }, adesso()).catch(() => {});
    return true;
  }

  // ── Le impostazioni cambiate ─────────────────────────────────────────────
  // Gira dentro la scrittura, prima che avvenga: vede i valori vecchi e nuovi e chi l'ha chiesta. Una scrittura che
  // spegne i contatori non conta niente, nemmeno gli altri cambi che porta.
  function impostazioniCambiate(prima, dopo, { via = 'auto', incognito = false, normalizza = null } = {}) {
    try {
      if (incognito || !oggetto(dopo) || spentiIn(dopo) || !C.VIE.includes(via)) return 0;
      const K = globalThis.SN_CAMBI;
      if (!K) return 0;
      const cambi = foglie(prima, dopo, normalizza);
      if (!cambi.length) return 0;
      conta((ora) => { for (const c of cambi) C.registraImpostazione(ora, c.chiave, c.dopo, via); }, { incognito }).catch(() => {});
      return cambi.length;
    } catch (_) { return 0; }
  }

  // Le foglie cambiate, comprese quelle che il registro dei cambi non mette nel filo (autonomia): la voce, non il valore,
  // decide se è contata.
  function foglie(prima, dopo, normalizza) {
    const n = typeof normalizza === 'function' ? normalizza : (x) => x || {};
    const a = n(prima);
    const b = n(dopo);
    const out = [];
    const K = globalThis.SN_CAMBI;
    // Le scritture che il registro esclude perché non le ha scelte nessuno (prezzi, ultimo paese) non sono cambi;
    // quanto Filo fa da solo sì, anche se il registro non lo annulla.
    const esclusa = (p) => !p.startsWith('autonomia.') && typeof K.esclusa === 'function' && K.esclusa(p);
    const giu = (x, y, base) => {
      const chiavi = new Set([...(oggetto(x) ? Object.keys(x) : []), ...(oggetto(y) ? Object.keys(y) : [])]);
      for (const k of chiavi) {
        const p = base ? `${base}.${k}` : k;
        const vx = oggetto(x) ? x[k] : undefined;
        const vy = oggetto(y) ? y[k] : undefined;
        const jolly = C.chiaveImpostazione(p) !== p && C.chiaveImpostazione(p) !== 'altro';
        if (!jolly && (oggetto(vx) || oggetto(vy)) && !Array.isArray(vx) && !Array.isArray(vy)) giu(vx, vy, p);
        else if (!K.uguale(vx, vy) && C.chiaveImpostazione(p) && !esclusa(p)) out.push({ chiave: p, dopo: vy });
      }
    };
    giu(a, b, '');
    // Una jolly (themeTokens.*) cambiata in dieci foglie in un colpo è un cambio solo.
    const visti = new Set();
    return out.filter((c) => { const k = C.chiaveImpostazione(c.chiave); if (k !== c.chiave && visti.has(k)) return false; visti.add(k); return true; });
  }

  // ── Ricerche, correttore, anticipi, richieste, errori visti, intervista ─────────────────────────────────────────
  function ricerca(pannello, { esito, attesaMs = null, posizione = null } = {}, { incognito = null } = {}) {
    if (!C.PANNELLI.includes(pannello)) return false;
    conta((ora) => C.registraRicerca(ora, pannello, { esito, attesaMs: attesaPulita(attesaMs), posizione }), { incognito }).catch(() => {});
    return true;
  }

  function proposta(tipo, modello, esito) {
    if (!C.TIPI_PROPOSTA.includes(tipo) || !C.ESITI_PROPOSTA.includes(esito)) return false;
    conta((ora) => C.registraProposta(ora, tipo, modello, esito)).catch(() => {});
    return true;
  }

  function anticipoPronto(action) {
    const f = C.funzioneDi(action);
    if (!f) return false;
    conta((ora) => C.registraAnticipo(ora, f, 'preparato')).catch(() => {});
    return true;
  }

  // Una risposta preparata in anticipo e aperta quando la richiesta l'ha già contata la chiamata vera (il contesto è
  // cambiato e si richiede, ma a schermo va quella pronta).
  function anticipoAperto(action) {
    const f = C.funzioneDi(action);
    if (!f || inIncognito()) return false;
    conta((ora) => C.registraAnticipo(ora, f, 'aperto')).catch(() => {});
    return true;
  }

  // La navigazione (#1469): `voce` la costruisce C.NAV coi suoi elenchi chiusi; una voce che non lo è non conta.
  function navigazione(voce, { incognito = null } = {}) {
    if (!oggetto(voce)) return false;
    conta((ora) => C.registraNavigazione(ora, voce.misura, voce.chiave, voce.voci), { incognito }).catch(() => {});
    return true;
  }

  // I riquadri AI e l'Editor (#1465): `voce` la costruisce C.voceRiquadro dal messaggio della pagina, o è null.
  function riquadro(voce, { incognito = null } = {}) {
    if (!oggetto(voce)) return false;
    conta((ora) => C.registraRiquadro(ora, voce.misura, voce.chiave, voce.voci), { incognito }).catch(() => {});
    return true;
  }

  // All'uscita il salvataggio non aspetta i suoi tre secondi, o l'ultima voce (la pulizia dei cookie) non arriverebbe
  // sul disco: il main lo scrive tutto prima di chiudere.
  async function allUscita(voce = null) {
    if (oggetto(voce)) await conta((ora) => C.registraNavigazione(ora, voce.misura, voce.chiave, voce.voci), { incognito: false }).catch(() => false);
    await salva();
  }

  // Un'attività di Filo (#1467): una sessione dell'Aiuto, una ricerca web, una dettatura, una lettura, una lezione, una
  // riga di memoria corretta, un giro di pulizia, una scheda riaperta, la home. `info` passa solo per gli elenchi chiusi.
  function attivita(misura, info, { incognito = null } = {}) {
    try {
      if (!C.chiaveAttivita(misura, info) || (incognito == null ? inIncognito() : incognito)) return false;
      const p = conta((ora) => C.registraAttivita(ora, misura, info), { incognito }).catch(() => {});
      inVolo.add(p);
      p.finally(() => inVolo.delete(p));
      return true;
    } catch (_) { return false; }
  }

  // Le attività ancora aperte in una pagina (una sessione dell'Aiuto, una lettura, una dettatura in attesa d'invio),
  // con quello che conterebbero se finissero adesso: chiudere una scheda, una finestra o Filo non dà alla pagina
  // nessun evento, e allora le conta il main (`chiudiInCorso`, `congeda`). Chiave: «pagina|cosa|id».
  const inCorso = new Map();
  const inVolo = new Set();
  const TETTO_IN_CORSO = 500;
  function apertaInCorso(chiave, misura, info) {
    if (!C.chiaveAttivita(misura, info) || inIncognito()) { inCorso.delete(chiave); return false; }
    if (!inCorso.has(chiave) && inCorso.size >= TETTO_IN_CORSO) inCorso.delete(inCorso.keys().next().value);
    inCorso.set(chiave, { misura, info });
    return true;
  }
  // Un conto di un'altra famiglia ancora aperto in una pagina (#1473: i «risali» di fila, il sito non trovato): `fine` lo
  // conta, e rende la scrittura perché l'uscita la aspetti.
  function sospesaInCorso(chiave, fine) {
    if (typeof fine !== 'function' || inIncognito()) { inCorso.delete(chiave); return false; }
    if (!inCorso.has(chiave) && inCorso.size >= TETTO_IN_CORSO) inCorso.delete(inCorso.keys().next().value);
    inCorso.set(chiave, { fine });
    return true;
  }
  function haInCorso(chiave) { return inCorso.has(chiave); }
  // La pagina l'ha chiusa lei, e conta da sé: quella in attesa non vale più.
  function finitaInCorso(chiave) { inCorso.delete(chiave); }
  function contaInCorso(v) {
    if (typeof v.fine !== 'function') { attivita(v.misura, v.info, { incognito: false }); return; }
    let p = null;
    try { p = v.fine(); } catch (_) { p = null; }
    if (!p || typeof p.then !== 'function') return;
    const q = Promise.resolve(p).catch(() => {});
    inVolo.add(q);
    q.finally(() => inVolo.delete(q));
  }
  // La pagina dice che è finita: si conta adesso, una volta. Falso se non c'era niente in attesa.
  function chiudiUnaInCorso(chiave) {
    const v = inCorso.get(chiave);
    if (!v) return false;
    inCorso.delete(chiave);
    contaInCorso(v);
    return true;
  }
  // La pagina se n'è andata senza dirlo: si contano le sue, com'erano all'ultimo aggiornamento.
  function chiudiInCorso(prefisso) {
    for (const [k, v] of [...inCorso]) {
      if (!k.startsWith(prefisso)) continue;
      inCorso.delete(k);
      contaInCorso(v);
    }
  }
  // Filo che si chiude: le attività aperte si contano, e lo stato va sul disco prima dell'uscita. Null: niente da fare.
  function congeda() {
    chiudiInCorso('');
    if (!inVolo.size && !timerSalva) return null;
    return Promise.all([...inVolo]).then(() => salva(), () => salva());
  }

  // Una scheda chiusa riaperta (`voce` d'archivio): chi l'aveva chiusa e da quanto. Da ogni strada che la riapre, perché
  // una chiusa dalla pulizia e riaperta subito è un suo errore.
  function riaperta(voce, { incognito = null } = {}) {
    if (!voce) return false;
    const chiusa = Date.parse(voce.closedAt);
    return attivita('riaperte', {
      chiusaDa: C.chiusaDa(voce.reason, voce.chiusaDaSola),
      etaMs: Number.isFinite(chiusa) ? Math.max(0, adesso() - chiusa) : null,
    }, { incognito });
  }

  // Una riga di memoria corretta dalla persona: `riga` è quella di SN_FILO_MEMORY.descriviRiga, col modulo e la data.
  function memoriaCorretta(via, operazione, riga) {
    if (!riga && operazione !== 'svuota') return false;
    const nata = riga && riga.nata ? Date.parse(riga.nata) : NaN;
    return attivita('memoria', {
      via, operazione, riga: operazione === 'svuota' ? 'tutte' : C.rigaMemoria(riga),
      etaMs: Number.isFinite(nata) ? Math.max(0, adesso() - nata) : null,
    });
  }

  // La chat che cambia la richiesta per stare nella finestra del modello (#1464): `tipo` dall'elenco chiuso.
  function adattamento(action, modello, tipo) {
    const f = C.funzioneDi(action);
    if (!f || !C.ADATTAMENTI.includes(tipo) || inIncognito()) return false;
    conta((ora) => C.registraAdattamento(ora, f, modello, tipo)).catch(() => {});
    return true;
  }

  function chiesto(action) {
    const f = C.funzioneDi(action);
    if (!f) return false;
    conta((ora) => C.registraChiesto(ora, f)).catch(() => {});
    return true;
  }

  function erroreVisto(tipo, { incognito = null } = {}) {
    if (!C.erroreVisto(tipo)) return false;
    conta((ora) => C.registraErroreVisto(ora, tipo), { incognito }).catch(() => {});
    return true;
  }

  function intervista(passo, scelta) {
    if (!C.passiIntervista().includes(passo) || !C.SCELTE_INTERVISTA.includes(scelta)) return false;
    conta((ora) => C.registraIntervista(ora, passo, scelta)).catch(() => {});
    return true;
  }

  // Ogni scrittura dell'intervista: aperta resta col passo dove si trova; chiusa si dimentica. Chi la lascia lì senza
  // chiuderla la ritrova `giro`, un giorno dopo. `daCapo`: rifatta dalle Preferenze, che si conta a parte (#1473);
  // `inizio`: quando è cominciata, perché l'abbandono già contato di quella di prima non valga per la nuova.
  async function intervistaToccata(passo, chiusa, { daCapo = false, inizio = '' } = {}) {
    if (inIncognito() || !(await accesi())) return;
    await carica();
    const prima = stato.intervista;
    const stessa = !prima || !prima.inizio || !inizio || prima.inizio === String(inizio);
    stato.intervista = chiusa ? null : {
      passo: String(passo || ''), t: adesso(), contato: Boolean(prima && prima.contato && stessa),
      ...(inizio ? { inizio: String(inizio) } : {}), ...(daCapo ? { daCapo: true } : {}),
    };
    salvaPresto();
  }
  // Chiusa a metà con «Salta», una frase di stop o il tetto: l'abbandono, se non l'ha già contato un giorno di fermo.
  function intervistaAbbandonata(passo, { daCapo = false } = {}) {
    if (stato && stato.intervista && stato.intervista.contato) return false;
    if (!daCapo) return intervista(passo, 'abbandono');
    if (!H || !H.passi().includes(passo)) return false;
    conta((ora) => H.registraIntervistaFine(ora, passo)).catch(() => {});
    return true;
  }
  function abbandonoPerFermo() {
    const iv = stato.intervista;
    if (!oggetto(iv) || iv.contato || !C.passiIntervista().includes(iv.passo) || !(adesso() - Number(iv.t) >= INTERVISTA_FERMA_MS)) return;
    if (iv.daCapo) { if (H) H.registraIntervistaFine(oraCorrente(), iv.passo); } else C.registraIntervista(oraCorrente(), iv.passo, 'abbandono');
    iv.contato = true;
  }

  // ── Le conferme di Filo (#1461) ──────────────────────────────────────────
  // `info`: i cinque ingressi della tabella dei permessi e la risposta calcolata. Una conferma mostrata aspetta la
  // risposta dell'utente sotto la sua chiave; chi non risponde entro dieci minuti l'ha lasciata lì.
  function confermaDecisa(tipo, info, esito) {
    if (!C.tipiAzione().includes(tipo)) return false;
    conta((ora) => C.registraConferma(ora, tipo, { ...info, esito })).catch(() => {});
    return true;
  }
  function confermaChiesta(chiave, tipo, info) {
    if (!chiave || !C.tipiAzione().includes(tipo) || inIncognito()) return false;
    confermeAperte.set(String(chiave), { tipo, info: { ...info }, t: adesso() });
    if (confermeAperte.size > 200) confermeAperte.delete(confermeAperte.keys().next().value);
    return true;
  }
  function confermaRisposta(chiave, esito, ripiego = null) {
    if (confermeScadute.delete(String(chiave || ''))) return false;
    const aperta = confermeAperte.get(String(chiave || ''));
    if (aperta) confermeAperte.delete(String(chiave));
    const c = aperta || ripiego;
    if (!c || !['approvata', 'rifiutata'].includes(esito)) return false;
    return confermaDecisa(c.tipo, c.info, esito);
  }
  function scaduteLeConferme() {
    const ora = adesso();
    for (const [k, c] of confermeAperte) {
      if (ora - c.t < CONFERMA_SCADE_MS) continue;
      confermeAperte.delete(k);
      confermeScadute.set(k, ora);
      if (confermeScadute.size > 200) confermeScadute.delete(confermeScadute.keys().next().value);
      if (stato && stato.ore) C.registraConferma(oraCorrente(), c.tipo, { ...c.info, esito: 'senza-risposta' });
    }
  }

  // ── Gli annulli subito dopo un'azione di Filo ───────────────────────────
  // `eventi`: gli id dei cambi che l'azione ha scritto nel registro; un «annulla» di uno di quelli, o Ctrl/Cmd+Z
  // subito dopo, disfa l'azione.
  function azioneDiFilo(tipo, eventi = []) {
    if (!C.tipiAzione().includes(tipo) || inIncognito()) return;
    azioniDiFilo.push({ tipo, eventi: (eventi || []).map(String), t: adesso() });
    while (azioniDiFilo.length > 50) azioniDiFilo.shift();
  }
  function annullato(tipo) {
    conta((ora) => C.registraAnnullato(ora, tipo)).catch(() => {});
  }
  function recenti() {
    const t = adesso();
    while (azioniDiFilo.length && t - azioniDiFilo[0].t > C.ANNULLO_MS) azioniDiFilo.shift();
    return azioniDiFilo;
  }
  function cambioAnnullato(eventi) {
    const ids = (Array.isArray(eventi) ? eventi : [eventi]).map(String);
    const a = recenti().find((x) => x.eventi.some((e) => ids.includes(e)));
    if (!a) return false;
    a.eventi = a.eventi.filter((e) => !ids.includes(e));
    annullato(a.tipo);
    return true;
  }
  // Ctrl/Cmd+Z fuori da un campo: disfa l'ultima azione di Filo se è di pochi secondi fa. Da una finestra in
  // incognito non si conta: l'azione di Filo era altrove.
  function tastoAnnulla({ incognito = null } = {}) {
    if (incognito == null ? inIncognito() : incognito) return false;
    const l = recenti();
    const a = l[l.length - 1];
    if (!a) return false;
    l.pop();
    annullato(a.tipo);
    return true;
  }
  // `msDopo`: quanto dopo la modifica di Filo è arrivato Ctrl/Cmd+Z; oltre ANNULLO_MS è un'altra cosa.
  function annullatoInPagina(tipo, msDopo = 0) {
    const ms = Number(msDopo);
    if (!C.ANNULLABILI_IN_PAGINA.includes(tipo) || inIncognito() || !Number.isFinite(ms) || ms < 0 || ms > C.ANNULLO_MS) return false;
    annullato(tipo);
    return true;
  }

  // ── La finestra (#1470): le sue misure entrano nell'ora dalla stessa porta, con interruttore e incognito ───────
  function finestra(scrivi, { incognito = null } = {}) {
    return conta(scrivi, { incognito }).catch(() => false);
  }
  function primaDiOgniScrittura(fn) { if (typeof fn === 'function') primaDiScrivere.push(fn); }
  // La sicurezza (#1474), la home e gli automatismi sulla pagina (#1473) entrano dalla stessa porta.
  const sicurezza = finestra;
  const homePagina = finestra;

  // ── I gesti della personalizzazione (#1471) ─────────────────────────────
  // `dati` può venire da una pagina: ne passano solo le chiavi e le voci dei suoi elenchi.
  function gesto(misura, dati, { incognito = null } = {}) {
    try {
      if (!C.MISURE_GESTI.includes(misura) || misura === 'disposizione_di_serie') return false;
      if (misura === 'barra_aperta' ? !C.gestoBarraValido(dati) : !C.voceGesto(misura, dati)) return false;
      const d = misura === 'barra_aperta' ? { motivo: dati.motivo, esito: dati.esito, apertaMs: attesaPulita(dati.apertaMs) } : dati;
      conta((ora) => C.registraGesto(ora, misura, d), { incognito }).catch(() => {});
      return true;
    } catch (_) { return false; }
  }

  // La disposizione delle icone di una finestra normale, letta o appena cambiata: l'ora in corso la tiene com'è ora.
  function disposizioneIcone(layout) {
    const d = C.disposizioneDiSerie(layout);
    if (!d) return false;
    disposizione = d;
    const k = C.oraDi(adesso());
    if (stato && stato.ore && stato.ore[k]) { C.segnaDisposizione(stato.ore[k], d); salvaPresto(); }
    return true;
  }

  // L'«annulla» sul segno di un cambio del registro, con la via del cambio e quanto tempo dopo.
  function cambioRitirato(evento, { incognito = null } = {}) {
    try {
      const voci = C.annullaCambio(evento, adesso());
      if (!voci.length) return false;
      conta((ora) => { for (const v of voci) C.registraGesto(ora, 'annulla_cambio', v); }, { incognito }).catch(() => {});
      return true;
    } catch (_) { return false; }
  }

  // ── La chat e l'agente (#1463) ───────────────────────────────────────────
  // Un turno raccoglie giri, strumenti e strade di riserva mentre lavora, e li conta alla fine, col suo esito, in una
  // scrittura sola. Un turno partito in incognito non conta niente.
  function turnoChat(action) {
    try {
      const funzione = C.funzioneDi(action);
      if (!C.AGENTI.includes(funzione) || inIncognito()) return TURNO_MUTO;
      let giri = 0;
      let chiuso = false;
      const azioni = new Map();
      const usati = new Map();
      const recuperi = new Set();
      const piu = (m, k) => m.set(k, (m.get(k) || 0) + 1);
      return {
        giro() { giri += 1; },
        azioni(n) { if (Number.isInteger(n) && n > 0) piu(azioni, n); },
        strumento(nome, esito) { if (C.ESITI_STRUMENTO.includes(esito)) piu(usati, `${C.nomeStrumento(nome)}|${esito}`); },
        recupero(voce) { if (C.RECUPERI.includes(voce)) recuperi.add(voce); },
        fine(esito) {
          if (chiuso || !C.ESITI_TURNO.includes(esito)) return;
          chiuso = true;
          conta((ora) => {
            C.registraTurno(ora, funzione, { esito, giri });
            for (const [n, volte] of azioni) C.registraAzioniDelGiro(ora, funzione, n, volte);
            for (const [k, volte] of usati) { const [nome, e] = k.split('|'); C.registraStrumento(ora, funzione, nome, e, volte); }
            for (const v of recuperi) C.registraRecupero(ora, v);
          }, { incognito: false }).catch(() => {});
        },
      };
    } catch (_) { return TURNO_MUTO; }
  }

  function reazione(voce) {
    if (!C.REAZIONI.includes(voce)) return false;
    conta((ora) => C.registraReazione(ora, voce)).catch(() => {});
    return true;
  }

  // Non «copia»: il nome è già del clone dello stato, qui sopra.
  function copiaDaBolla(ruolo) {
    if (!C.RUOLI_COPIA.includes(ruolo)) return false;
    conta((ora) => C.registraCopia(ora, ruolo)).catch(() => {});
    return true;
  }

  // Una chat chiusa si conta col tipo che le dà il classificatore, dopo: fino ad allora aspetta sul disco, così una
  // chiusa all'uscita di Filo si conta quando la classificazione riesce, al giro dopo.
  async function chatChiusa(id, { via, messaggi, durataMs } = {}) {
    try {
      const k = String(id || '');
      if (!k || inIncognito() || !C.VIE_CHIUSURA.includes(via) || !(Number(messaggi) >= 1)) return false;
      const mia = generazione;
      if (!(await accesi())) { await azzera(); return false; }
      await carica();
      if (mia !== generazione) return false;
      stato.chiuse[k] = { via, messaggi: Number(messaggi), durataMs: Math.max(0, Number(durataMs) || 0), t: adesso() };
      delete stato.uscite[k];
      const ids = Object.keys(stato.chiuse);
      if (ids.length > TETTO_CHIUSE_IN_ATTESA) {
        ids.sort((a, b) => Number(stato.chiuse[a].t) - Number(stato.chiuse[b].t));
        for (const vecchia of ids.slice(0, ids.length - TETTO_CHIUSE_IN_ATTESA)) chiusaContata(vecchia, C.SENZA_TIPO);
      }
      await salva();
      return true;
    } catch (_) { return false; }
  }

  // La scheda della chat se n'è andata: la chiusura vera è asincrona e, se Filo sta uscendo, non arriva in fondo. Il
  // segno è sincrono, va sul disco con l'uscita, e all'avvio dopo la chat si conta come «uscita» (#1463).
  function chatInUscita(id) {
    const k = String(id || '');
    if (!k || !stato || inIncognito()) return false;
    stato.uscite[k] = adesso();
    salvaPresto();
    return true;
  }

  // La chiusura è arrivata in fondo senza contarla (chat vuota, di un'app, già chiusa, contatori spenti): il segno va via.
  function uscitaFinita(id) {
    const k = String(id || '');
    if (!stato || !k || !Object.prototype.hasOwnProperty.call(stato.uscite, k)) return false;
    delete stato.uscite[k];
    salvaPresto();
    return true;
  }

  async function usciteInSospeso() {
    try { await carica(); return Object.keys(stato.uscite); } catch (_) { return []; }
  }

  function chiusaContata(id, tipo) {
    const c = stato.chiuse[id];
    delete stato.chiuse[id];
    if (oggetto(c)) C.registraChatChiusa(oraCorrente(), { ...c, tipo: C.TIPI_CHAT.includes(tipo) ? tipo : C.SENZA_TIPO });
  }

  async function chatClassificata(id, tipo) {
    try {
      const k = String(id || '');
      if (!k || inIncognito()) return false;
      await carica();
      if (!oggetto(stato.chiuse[k])) return false;
      const fatto = await conta(() => { if (!oggetto(stato.chiuse[k])) return false; chiusaContata(k, tipo); return true; });
      // Subito sul disco, insieme all'ora: un'uscita di Filo qui non la lascia in attesa da contare una seconda volta.
      if (fatto) await salva();
      return fatto;
    } catch (_) { return false; }
  }

  function chiuseScadute() {
    for (const [id, c] of Object.entries(stato.chiuse)) {
      if (!oggetto(c) || !(adesso() - Number(c.t) < CHIUSA_ASPETTA_MS)) chiusaContata(id, C.SENZA_TIPO);
    }
  }

  // ── La spedizione ────────────────────────────────────────────────────────
  async function spedisci(doc, collezione = C.COLLEZIONE) {
    const { FIRESTORE_BASE, API_KEY } = rest();
    if (!FIRESTORE_BASE || !API_KEY) return { ok: false, motivo: 'server non configurato' };
    const url = `${FIRESTORE_BASE}/${collezione}?documentId=${encodeURIComponent(C.idDocumento(doc))}&key=${API_KEY}`;
    const fields = Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, valoreFs(v)]));
    // Senza identità (offline, persa, illeggibile) l'ora resta in attesa come per un server giù: niente avvisi.
    let token = '';
    try { token = await idToken(); } catch (_) { token = ''; }
    if (!token) return { ok: false, motivo: 'identità dell\'installazione non pronta' };
    let res;
    try {
      res = await fetchFn(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ fields }),
        signal: AbortSignal.timeout(ATTESA_RETE_MS),
      });
    } catch (e) {
      return { ok: false, motivo: `rete: ${String((e && e.message) || e).slice(0, 120)}` };
    }
    // 409: l'ora è già sul server (la risposta di un invio riuscito si era persa).
    if (res.ok || res.status === 409) return { ok: true };
    // 400 e 403: è QUEST'ora che il server non accetta (una funzione che le regole pubblicate non conoscono
    // ancora), non il server che è giù.
    return { ok: false, motivo: `il server ha risposto ${res.status}`, soloQuesto: res.status === 400 || res.status === 403 };
  }

  // Le ore chiuse (e i giorni di prima) dalla più vecchia: un server che non risponde ferma il giro fino all'ora dopo;
  // un'ora rifiutata si riprova il giorno dopo e non ferma le altre. Restano in attesa al più due mesi di ore.
  async function giro() {
    if (!(await accesi())) { await azzera(); return 'spenti'; }
    await carica();
    const mia = generazione;
    const adessoOra = C.oraDi(adesso());
    const oggi = C.giornoDi(adesso());
    scaduteLeConferme();
    abbandonoPerFermo();
    chiuseScadute();
    segnaPresenza();
    // Ogni ora con una finestra normale aperta entrano il campione del sistema e quello che aspettava; con sole
    // finestre incognito, o nessuna, non entra niente.
    let aperta = false;
    try { aperta = Boolean(finestraNormale()); } catch (_) { aperta = false; }
    if (aperta) { campionaSistema(); raccogli(); } else scartaSospesa();
    for (const [mappa, pota] of [[stato.ore, C.potaOre], [stato.giorni, C.potaGiorni]]) {
      const persi = pota(mappa);
      if (persi.length) log(`${persi.length} periodi mai partiti lasciati andare (dal ${persi[0]} al ${persi[persi.length - 1]})`);
    }
    if (stato.fallitoIl === adessoOra) { await salva(); return 'rimandato'; }
    for (const k of Object.keys(stato.rifiutati)) if (!stato.ore[k] && !stato.giorni[k]) delete stato.rifiutati[k];
    potaPrimi(oggi);
    // Le rifiutate oggi si tolgono prima del tetto: tante ore ferme non tengono indietro quelle buone.
    const fuoriRifiuto = (k) => stato.rifiutati[k] !== oggi;
    const lavoro = [
      ...C.daInviare(stato.giorni, oggi, Infinity).filter(fuoriRifiuto).map((k) => ({ k, giorno: true })),
      ...C.oreDaInviare(stato.ore, adessoOra, Infinity).filter(fuoriRifiuto).map((k) => ({ k, giorno: false })),
    ].slice(0, C.TETTO_INVII_PER_GIRO);
    let esito = 'niente';
    let vietati = null;
    // Spenti a metà giro (anche durante un'attesa qui sotto): non parte più niente, e niente torna nello stato vuoto.
    const spentiNelFrattempo = async () => mia !== generazione || !(await accesi());
    for (const { k, giorno } of lavoro) {
      if (await spentiNelFrattempo()) { if (mia === generazione) await azzera(); return 'spenti'; }
      if (!vietati) {
        vietati = await esclusi();
        if (await spentiNelFrattempo()) { if (mia === generazione) await azzera(); return 'spenti'; }
      }
      const mappa = giorno ? stato.giorni : stato.ore;
      const g = giorno ? k : k.split('T')[0];
      let id;
      try {
        const scelto = C.pseudonimoDelMese(stato.pseudonimi, C.meseDi(g), { casuale, esclusi: vietati });
        stato.pseudonimi = scelto.pseudonimi;
        id = scelto.id;
      } catch (e) { log(String((e && e.message) || e)); esito = 'fallito'; break; }
      const dati = mappa[k];
      const base = { pseudonimo: id, app: (dati && dati.app) || versione(), os: C.famigliaOs(piattaforma), dati };
      // Il primo documento arrivato di un giorno e di un mese lo dice: l'owner conta le copie leggendo solo quelli.
      const primo = giorno ? '' : !stato.primi[C.meseDi(g)] ? 'mese' : !stato.primi[g] ? 'giorno' : '';
      const doc = giorno ? C.documentoGiorno({ ...base, giorno: k }) : C.documento({ ...base, chiave: k, primo });
      const v = C.valida(doc);
      if (!v.ok) {
        log(`${k} non parte: ${v.motivo}`);
        delete mappa[k];
        continue;
      }
      const accanto = giorno ? [] : documentiAccanto(k, { ...base, chiave: k });
      const diFinestra = giorno ? null : documentoFinestra(k, { ...base, chiave: k });
      const diSicurezza = giorno ? null : documentoSicurezza(k, { ...base, chiave: k });
      const diHomePagina = giorno ? null : documentoHomePagina(k, { ...base, chiave: k });
      const gesti = giorno ? null : documentoGesti(k, { ...base, chiave: k });
      const riquadri = giorno ? null : documentoRiquadri(k, { ...base, chiave: k });
      // La chat della stessa ora parte nel suo documento, dopo l'ora (#1463). Rifiutata, l'ora resta: rispedita, quella
      // già arrivata risponde 409 e la chat riparte con lei.
      let chat = giorno ? null : C.documentoChat({ ...base, chiave: k });
      if (chat && !C.haChat(chat)) chat = null;
      if (chat && !C.valida(chat).ok) { log(`la chat di ${k} non parte: ${C.valida(chat).motivo}`); chat = null; }
      let r = await spedisci(doc);
      if (mia !== generazione) return 'spenti';
      // L'ora è arrivata: il suo segno di primo documento vale anche se i documenti accanto (gesti compresi) partono al giro
      // dopo, e allora l'ora (e quelli già arrivati) rispediti rispondono 409.
      if (r.ok && primo) { stato.primi[g] = true; stato.primi[C.meseDi(g)] = true; }
      if (r.ok && chat) {
        r = await spedisci(chat);
        if (mia !== generazione) return 'spenti';
      }
      for (const [d, collezione] of gesti ? [...accanto, [gesti, C.COLLEZIONE_GESTI]] : accanto) {
        if (!r.ok) break;
        r = await spedisci(d, collezione);
        if (mia !== generazione) return 'spenti';
      }
      if (r.ok && diFinestra) {
        r = await spedisci(diFinestra, F.COLLEZIONE);
        if (mia !== generazione) return 'spenti';
      }
      if (r.ok && diSicurezza) {
        r = await spedisci(diSicurezza, S.COLLEZIONE);
        if (mia !== generazione) return 'spenti';
      }
      // Per ultimi: finché le regole pubblicate non conoscono la loro collezione, il rifiuto non tiene indietro gli altri.
      if (r.ok && diHomePagina) {
        r = await spedisci(diHomePagina, H.COLLEZIONE);
        if (mia !== generazione) return 'spenti';
      }
      if (r.ok && riquadri) {
        r = await spedisci(riquadri, C.COLLEZIONE_RIQUADRI);
        if (mia !== generazione) return 'spenti';
      }
      if (!r.ok && r.soloQuesto) {
        stato.rifiutati[k] = oggi;
        stato.errore = r.motivo;
        log(`${k} è stato rifiutato (${r.motivo}): si riprova domani, gli altri partono`);
        esito = 'fallito';
        continue;
      }
      if (!r.ok) {
        stato.fallitoIl = adessoOra;
        stato.errore = r.motivo;
        log(`invio di ${k} non riuscito (${r.motivo}): si riprova fra un'ora`);
        esito = 'fallito';
        break;
      }
      delete mappa[k];
      delete stato.rifiutati[k];
      stato.ultimo = { periodo: k, at: adesso() };
      stato.errore = '';
      if (esito !== 'fallito') esito = 'inviati';
    }
    await salva();
    return esito;
  }

  // Le chiamate ai modelli (#1464), la navigazione (#1469) e le attività (#1467) di un'ora, se ne ha: un documento che
  // non passa la validazione non ferma l'ora.
  function documentiAccanto(k, base) {
    const out = [];
    for (const [costruisci, vuoto, valida, collezione, cosa] of [
      [C.documentoChiamate, C.senzaChiamate, C.validaChiamate, C.COLLEZIONE_CHIAMATE, 'le chiamate'],
      [C.documentoNavigazione, C.senzaNavigazione, C.validaNavigazione, C.COLLEZIONE_NAVIGAZIONE, 'la navigazione'],
      [C.documentoAttivita, C.senzaAttivita, C.validaAttivita, C.COLLEZIONE_ATTIVITA, 'le attività'],
    ]) {
      const d = costruisci(base);
      if (vuoto(d)) continue;
      const v = valida(d);
      if (v.ok) out.push([d, collezione]);
      else log(`${cosa} di ${k} non partono: ${v.motivo}`);
    }
    return out;
  }

  // La finestra di un'ora (#1470), se ne ha: come le chiamate, un documento fuori forma non ferma l'ora.
  function documentoFinestra(k, base) {
    if (!F) return null;
    const d = F.documento(base);
    if (F.senzaDati(d)) return null;
    const v = F.valida(d);
    if (v.ok) return d;
    log(`la finestra di ${k} non parte: ${v.motivo}`);
    return null;
  }

  // La sicurezza di un'ora (#1474), se ne ha: come la finestra.
  function documentoSicurezza(k, base) {
    if (!S) return null;
    const d = S.documento(base);
    if (S.senzaDati(d)) return null;
    const v = S.valida(d);
    if (v.ok) return d;
    log(`la sicurezza di ${k} non parte: ${v.motivo}`);
    return null;
  }

  // I riquadri di un'ora (#1465), se ne ha: come i gesti.
  function documentoRiquadri(k, base) {
    const d = C.documentoRiquadri(base);
    if (C.senzaRiquadri(d)) return null;
    const v = C.validaRiquadri(d);
    if (v.ok) return d;
    log(`i riquadri di ${k} non partono: ${v.motivo}`);
    return null;
  }

  // La home e gli automatismi di un'ora (#1473), se ne ha: come la finestra.
  function documentoHomePagina(k, base) {
    if (!H) return null;
    const d = H.documento(base);
    if (H.senzaDati(d)) return null;
    const v = H.valida(d);
    if (v.ok) return d;
    log(`la home e gli automatismi di ${k} non partono: ${v.motivo}`);
    return null;
  }

  // I gesti di un'ora (#1471), se ne ha: come le chiamate, un documento storto non ferma l'ora.
  function documentoGesti(k, base) {
    const d = C.documentoGesti(base);
    if (C.senzaGesti(d)) return null;
    const v = C.validaGesti(d);
    if (v.ok) return d;
    log(`i gesti di ${k} non partono: ${v.motivo}`);
    return null;
  }

  // Si ricordano i giorni che possono ancora partire (le ore restano in attesa al più due mesi) e tre mesi.
  function potaPrimi(oggi) {
    const giorniTenuti = Math.ceil(C.TETTO_ORE_IN_ATTESA / 24) + 1;
    let limite = oggi;
    for (let i = 0; i < giorniTenuti; i++) limite = C.giornoPrima(limite);
    const mesi = Object.keys(stato.primi).filter((k) => k.length === 7).sort();
    for (const k of Object.keys(stato.primi)) {
      if (k.length === 10 ? k < limite : k.length !== 7 || mesi.indexOf(k) < mesi.length - 3) delete stato.primi[k];
    }
  }

  function controlla() {
    if (!giroInVolo) {
      giroInVolo = giro().catch((e) => { log('giro non riuscito', String((e && e.message) || e)); return 'errore'; })
        .finally(() => { giroInVolo = null; });
    }
    return giroInVolo;
  }

  let avviato = false;
  function avvia() {
    if (avviato) return;
    avviato = true;
    const t = setTimeout(() => { controlla(); }, PRIMO_CONTROLLO_MS);
    if (t && typeof t.unref === 'function') t.unref();
    const i = setInterval(() => { controlla(); }, CONTROLLO_OGNI_MS);
    if (i && typeof i.unref === 'function') i.unref();
    // Da app pronta: prima, lo storage letto non decifrerebbe le chiavi; e il sonno del computer si sente solo da lì.
    try {
      const E = dip.electron || require('electron');
      if (E && E.app && typeof E.app.whenReady === 'function') {
        E.app.whenReady().then(() => {
          accesi().then((si) => { if (si) avviaFermo(); }).catch(() => {});
          const pm = E.powerMonitor;
          if (!pm || typeof pm.on !== 'function') return;
          pm.on('suspend', sonno);
          pm.on('resume', sonno);
          pm.on('shutdown', () => { fineChiusura({ sistema: true }); });
        }).catch(() => {});
      }
    } catch (_) {}
  }

  // Spenti dalle Preferenze, dall'intervista o a parole: quello che c'era non parte più, il segno dell'uscita se ne va
  // e il ciclo del main non si misura più. Riaccesi, si misura di nuovo; il segno torna all'avvio dopo.
  function seguiImpostazioni(s) {
    if (spentiIn(s)) {
      ultimoAccesi = false;
      fermaFermo();
      togliSegno();
      azzera().catch(() => {});
      return;
    }
    if (s && typeof s === 'object') ultimoAccesi = true;
    if (avviato) avviaFermo();
  }

  // ── La lettura dell'owner ───────────────────────────────────────────────
  // Quante copie di Filo hanno spedito i contatori di un giorno o di un mese: pseudonimi distinti. Uno pseudonimo
  // vale un mese, quindi nel mese una copia conta una volta. Si leggono solo i documenti segnati come primi (più quelli
  // di un giorno intero, d'allora): una copia costa una lettura, non una per ora. Chiede solo il campo dello pseudonimo.
  async function distinti(idToken, filtri, visti) {
    const { FIRESTORE_BASE, API_KEY } = rest();
    if (!FIRESTORE_BASE || !API_KEY) throw new Error('server non configurato');
    const condizioni = filtri.map(([campo, valore]) => ({ fieldFilter: { field: { fieldPath: campo }, op: 'EQUAL', value: valoreFs(valore) } }));
    const where = condizioni.length === 1 ? condizioni[0] : { compositeFilter: { op: 'AND', filters: condizioni } };
    let dopo = null;
    for (let pagina = 0; pagina < TETTO_PAGINE; pagina++) {
      const structuredQuery = {
        from: [{ collectionId: C.COLLEZIONE }],
        where,
        select: { fields: [{ fieldPath: 'pseudonimo' }] },
        orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
        limit: PAGINA_LETTURA,
        ...(dopo ? { startAt: { values: [{ referenceValue: dopo }], before: false } } : {}),
      };
      const res = await fetchFn(`${FIRESTORE_BASE}:runQuery?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ structuredQuery }),
        signal: AbortSignal.timeout(ATTESA_RETE_MS),
      });
      if (!res.ok) {
        let det = '';
        try { const j = await res.json(); det = (Array.isArray(j) ? j[0] : j)?.error?.status || ''; } catch (_) {}
        throw new Error(`contatori ${res.status}${det ? ` ${det}` : ''}`);
      }
      const righe = (await res.json()) || [];
      const docs = righe.filter((r) => r && r.document);
      for (const r of docs) {
        const p = r.document.fields && r.document.fields.pseudonimo && r.document.fields.pseudonimo.stringValue;
        if (p) visti.add(p);
      }
      if (docs.length < PAGINA_LETTURA) return true;
      dopo = docs[docs.length - 1].document.name;
    }
    return false;
  }

  async function contaCopie(idToken, letture) {
    const visti = new Set();
    const complete = await Promise.all(letture.map((filtri) => distinti(idToken, filtri, visti)));
    return { n: visti.size, completo: complete.every(Boolean) };
  }

  async function installazioni({ idToken } = {}) {
    if (!idToken) throw new Error('Sessione scaduta: rifai l’accesso.');
    const oggi = C.giornoDi(adesso());
    const ieri = C.giornoPrima(oggi);
    const mese = C.meseDi(oggi);
    const [a, b] = await Promise.all([
      contaCopie(idToken, [[['giorno', ieri], ['primo', 'giorno']], [['giorno', ieri], ['primo', 'mese']], [['giorno', ieri], ['v', C.VERSIONE_GIORNO]]]),
      contaCopie(idToken, [[['mese', mese], ['primo', 'mese']], [['mese', mese], ['v', C.VERSIONE_GIORNO]]]),
    ]);
    return { ieri: { giorno: ieri, ...a }, mese: { mese, ...b } };
  }

  // Le somme della scheda Contatori (#1462): i documenti di un intervallo, a pagine e coi soli campi che si sommano,
  // tenuti qualche minuto per la stessa richiesta. Alla pagina escono solo le somme di src/main/services/contatoriSomme.js.
  const letture = new Map();

  async function documentiFra(idToken, dal, al) {
    const { FIRESTORE_BASE, API_KEY } = rest();
    if (!FIRESTORE_BASE || !API_KEY) throw new Error('server non configurato');
    const docs = [];
    let dopo = null;
    let letti = 0;
    for (let pagina = 0; pagina < TETTO_PAGINE; pagina++) {
      const structuredQuery = {
        from: [{ collectionId: C.COLLEZIONE }],
        where: { compositeFilter: { op: 'AND', filters: [
          { fieldFilter: { field: { fieldPath: 'giorno' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: dal } } },
          { fieldFilter: { field: { fieldPath: 'giorno' }, op: 'LESS_THAN_OR_EQUAL', value: { stringValue: al } } },
        ] } },
        select: { fields: Somme.CAMPI_LETTI.map((f) => ({ fieldPath: f })) },
        orderBy: [{ field: { fieldPath: 'giorno' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
        limit: PAGINA_LETTURA,
        ...(dopo ? { startAt: { values: [{ stringValue: dopo.giorno }, { referenceValue: dopo.nome }], before: false } } : {}),
      };
      const res = await fetchFn(`${FIRESTORE_BASE}:runQuery?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ structuredQuery }),
        signal: AbortSignal.timeout(ATTESA_RETE_MS),
      });
      if (!res.ok) {
        let det = '';
        try { const j = await res.json(); det = (Array.isArray(j) ? j[0] : j)?.error?.status || ''; } catch (_) {}
        throw new Error(`contatori ${res.status}${det ? ` ${det}` : ''}`);
      }
      const righe = ((await res.json()) || []).filter((r) => r && r.document);
      letti += righe.length;
      for (const r of righe) {
        const d = Somme.documentoDa(r.document.fields || {}, C);
        if (d) docs.push(d);
      }
      // Quanti documenti ci sono è quante ore le copie erano aperte: resta qui, nel registro, e non va alla pagina.
      if (righe.length < PAGINA_LETTURA) { log(`somme: ${letti} documenti letti dal ${dal} al ${al}`); return { docs, completo: true }; }
      const ultimo = righe[righe.length - 1].document;
      dopo = { nome: ultimo.name, giorno: String(Somme.daFs(ultimo.fields && ultimo.fields.giorno) || '') };
    }
    log(`somme: ${letti} documenti letti dal ${dal} al ${al}, tetto raggiunto: lettura parziale`);
    return { docs, completo: false };
  }

  function lettura(idToken, dal, al, forza) {
    const chiave = `${dal}|${al}`;
    const tenuta = letture.get(chiave);
    if (tenuta && !forza && (tenuta.promessa || adesso() - tenuta.at < LETTURA_VALE_MS)) return tenuta.promessa || Promise.resolve(tenuta);
    const voce = { at: 0, docs: [], completo: true };
    voce.promessa = documentiFra(idToken, dal, al).then((r) => {
      Object.assign(voce, r, { at: adesso() });
      delete voce.promessa;
      return voce;
    }, (e) => {
      if (letture.get(chiave) === voce) letture.delete(chiave);
      throw e;
    });
    letture.delete(chiave);
    letture.set(chiave, voce);
    while (letture.size > LETTURE_TENUTE) letture.delete(letture.keys().next().value);
    return voce.promessa;
  }

  async function somme({ idToken, dal, al, app = '', os = '', forza = false } = {}) {
    const storta = Somme.richiestaStorta({ dal, al, app, os }, C);
    if (storta) throw new Error(storta);
    if (!idToken) throw new Error('Sessione scaduta: rifai l’accesso.');
    const l = await lettura(idToken, dal, al, forza === true);
    return Somme.somma(l.docs, { dal, al, app: app || '', os: os || '', completo: l.completo, lettoAlle: l.at, C });
  }

  async function letto() { await carica(); return JSON.parse(JSON.stringify(stato)); }

  return {
    apri, unUso, parteDiUnUso, servitaDaCache, usoDallaPagina, azione, azioneMisurata, impostazioniCambiate, ricerca,
    proposta, anticipoPronto, anticipoAperto, chiesto, adattamento, attivita, apertaInCorso, finitaInCorso, chiudiInCorso,
    sospesaInCorso, haInCorso, chiudiUnaInCorso,
    congeda, riaperta, memoriaCorretta, erroreVisto, intervista, intervistaToccata, intervistaAbbandonata, confermaDecisa,
    confermaChiesta, confermaRisposta,
    navigazione, riquadro, allUscita,
    azioneDiFilo, cambioAnnullato, tastoAnnulla, annullatoInPagina, finestra, sicurezza, homePagina, primaDiOgniScrittura, gesto, disposizioneIcone, cambioRitirato,
    turnoChat, reazione, copia: copiaDaBolla, chatChiusa, chatClassificata, chatInUscita, uscitaFinita, usciteInSospeso,
    controlla, avvia, seguiImpostazioni, installazioni, somme, accesi, letto, salva, alChiudere,
    passoAvvio, passoAvvioFino, processoMorto, eccezione, ipcSincrono, aggiornamento, seguiFinestra, sessione,
    avvioProcesso, secondaIstanza, inizioChiusura, tettoChiusura, fineChiusura, perLaChiusura, salvaSubito,
    leggiFermo, sonno, avviaFermo, fermaFermo,
  };
}

module.exports = { crea, CHIAVE, MUTO, FILE_SEGNO, TURNO_MUTO };
