// I contatori anonimi (#969, #1461, #1464): misura usi e chiamate dei modelli, azioni e gli altri gesti di elenco chiuso,
// li tiene per ora sul disco e spedisce ogni ora le ore chiuse. In incognito e a contatori spenti non conta e non
// spedisce; spenti, butta quello che aveva, senza un ultimo segnale. Cosa esce: src/shared/contatoriGiornalieri.js.

const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');

const CHIAVE = 'contatoriGiornalieri';
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

const MUTO = Object.freeze({ visto() {}, errore() {}, fine() {}, chiamata() {}, tardiva() {} });
const AZIONE_MUTA = Object.freeze({ visto() {}, fine() {}, scheda() {} });

function valoreFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(valoreFs) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, valoreFs(x)])) } };
}

function statoVuoto() {
  return { ore: {}, giorni: {}, pseudonimi: {}, mesi: {}, primi: {}, presenza: '', fallitoIl: '', rifiutati: {}, ultimo: null, errore: '', intervista: null };
}

const oggetto = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

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
  };
}

function crea(dip = {}) {
  const C = dip.contatori || globalThis.SN_CONTATORI;
  const disco = () => require('../shim/storage');
  const storage = dip.storage || globalThis.SN_STORAGE;
  const impostazioni = dip.impostazioni || (() => storage.getSettings());
  const inIncognito = dip.inIncognito || (() => disco().inIncognito());
  const runNormale = dip.runNormale || ((fn) => disco().runNormale(fn));
  const fetchFn = dip.fetch || ((...a) => fetch(...a));
  const adesso = dip.adesso || (() => Date.now());
  const versione = dip.versione || (() => require('electron').app.getVersion());
  const piattaforma = dip.piattaforma || process.platform;
  // Gli identificativi che lo pseudonimo non deve mai ripetere: il codice dei feedback e lo pseudonimo dei crediti.
  const esclusi = dip.esclusi || (async () => []);
  const casuale = dip.casuale || (() => crypto.randomBytes(10).toString('hex'));
  const rest = dip.rest || (() => (globalThis.SN_FEEDBACK && globalThis.SN_FEEDBACK.rest) || {});
  const log = dip.log || ((...a) => console.warn('[contatori]', ...a));
  // L'ora conta come «Filo aperto» solo con una finestra normale: chi usa solo l'incognito non lascia traccia.
  const finestraNormale = dip.finestraNormale || (() => {
    try {
      const { BrowserWindow } = require('electron');
      return BrowserWindow.getAllWindows().some((w) => w && !w.isDestroyed() && w._filoTabs && !w._filoIncognito);
    } catch (_) { return false; }
  });

  const usoCorrente = new AsyncLocalStorage();
  let stato = null;
  let carico = null;
  let timerSalva = null;
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

  function carica() {
    if (!carico) {
      carico = (async () => {
        let s = null;
        try { s = await runNormale(() => storage.getRaw(CHIAVE, null)); } catch (_) { s = null; }
        stato = normale(s);
      })();
    }
    return carico;
  }

  async function salva() {
    if (timerSalva) { clearTimeout(timerSalva); timerSalva = null; }
    if (!stato) return;
    try { await runNormale(() => storage.setRaw(CHIAVE, stato)); } catch (e) { log('stato non salvato', String((e && e.message) || e)); }
  }

  function salvaPresto() {
    if (timerSalva) return;
    timerSalva = setTimeout(() => { timerSalva = null; salva().catch(() => {}); }, SALVA_DOPO_MS);
    if (timerSalva && typeof timerSalva.unref === 'function') timerSalva.unref();
  }

  const spentiIn = (s) => Boolean(s && s.contatori && s.contatori.attivi === false);
  // Nel dubbio spenti: un'impostazione che non si legge non vale come un sì.
  async function accesi() {
    try {
      const s = await impostazioni();
      return Boolean(s) && !spentiIn(s);
    } catch (_) { return false; }
  }

  async function azzera() {
    generazione += 1;
    ultimeVolte.clear();
    confermeAperte.clear();
    confermeScadute.clear();
    azioniDiFilo.length = 0;
    await carica();
    const c = stato;
    const vuoto = !Object.keys(c.ore).length && !Object.keys(c.giorni).length && !Object.keys(c.pseudonimi).length
      && !Object.keys(c.mesi).length && !c.ultimo && !c.fallitoIl && !c.presenza && !c.intervista;
    if (vuoto) return false;
    stato = statoVuoto();
    await salva();
    return true;
  }

  function oraCorrente() {
    const k = C.oraDi(adesso());
    if (!stato.ore[k]) stato.ore[k] = { ...C.oraVuota(), app: C.versioneApp(versione()) };
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
    const fatto = scrivi(ora);
    salvaPresto();
    return fatto !== false;
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

  // Un'attività di Filo (#1467): una sessione dell'Aiuto, una ricerca web, una dettatura, una lettura, una lezione, una
  // riga di memoria corretta, un giro di pulizia, una scheda riaperta, la home. `info` passa solo per gli elenchi chiusi.
  function attivita(misura, info, { incognito = null } = {}) {
    try {
      if (!C.chiaveAttivita(misura, info) || (incognito == null ? inIncognito() : incognito)) return false;
      conta((ora) => C.registraAttivita(ora, misura, info), { incognito }).catch(() => {});
      return true;
    } catch (_) { return false; }
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
  // chiuderla la ritrova `giro`, un giorno dopo.
  async function intervistaToccata(passo, chiusa) {
    if (inIncognito() || !(await accesi())) return;
    await carica();
    const prima = stato.intervista;
    stato.intervista = chiusa ? null : { passo: String(passo || ''), t: adesso(), contato: Boolean(prima && prima.contato) };
    salvaPresto();
  }
  // Chiusa a metà con «Salta», una frase di stop o il tetto: l'abbandono, se non l'ha già contato un giorno di fermo.
  function intervistaAbbandonata(passo) {
    if (stato && stato.intervista && stato.intervista.contato) return false;
    return intervista(passo, 'abbandono');
  }
  function abbandonoPerFermo() {
    const iv = stato.intervista;
    if (!oggetto(iv) || iv.contato || !C.passiIntervista().includes(iv.passo) || !(adesso() - Number(iv.t) >= INTERVISTA_FERMA_MS)) return;
    C.registraIntervista(oraCorrente(), iv.passo, 'abbandono');
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

  // ── La spedizione ────────────────────────────────────────────────────────
  async function spedisci(doc, collezione = C.COLLEZIONE) {
    const { FIRESTORE_BASE, API_KEY } = rest();
    if (!FIRESTORE_BASE || !API_KEY) return { ok: false, motivo: 'server non configurato' };
    const url = `${FIRESTORE_BASE}/${collezione}?documentId=${encodeURIComponent(C.idDocumento(doc))}&key=${API_KEY}`;
    const fields = Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, valoreFs(v)]));
    let res;
    try {
      res = await fetchFn(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }),
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
    segnaPresenza();
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
      const chiamate = giorno ? null : documentoAccanto(k, C.documentoChiamate({ ...base, chiave: k }), C.senzaChiamate, C.validaChiamate);
      const attivita = giorno ? null : documentoAccanto(k, C.documentoAttivita({ ...base, chiave: k }), C.senzaAttivita, C.validaAttivita);
      let r = await spedisci(doc);
      if (mia !== generazione) return 'spenti';
      // L'ora è arrivata: il suo segno di primo documento vale anche se i documenti accanto partono al giro dopo, e
      // allora l'ora (e quello già arrivato accanto) rispedita risponde 409.
      if (r.ok && primo) { stato.primi[g] = true; stato.primi[C.meseDi(g)] = true; }
      for (const [accanto, collezione] of [[chiamate, C.COLLEZIONE_CHIAMATE], [attivita, C.COLLEZIONE_ATTIVITA]]) {
        if (!r.ok || !accanto) continue;
        r = await spedisci(accanto, collezione);
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

  // Le chiamate ai modelli (#1464) e le attività (#1467) di un'ora, se ne ha: un documento che non passa la validazione
  // non ferma l'ora.
  function documentoAccanto(k, d, vuoto, valida) {
    if (vuoto(d)) return null;
    const v = valida(d);
    if (v.ok) return d;
    log(`${d.v && d.contesto ? 'le chiamate' : 'i documenti accanto'} di ${k} non partono: ${v.motivo}`);
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
  }

  // Spenti dalle Preferenze, dall'intervista o a parole: quello che c'era non parte più.
  function seguiImpostazioni(s) {
    if (spentiIn(s)) azzera().catch(() => {});
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

  async function letto() { await carica(); return JSON.parse(JSON.stringify(stato)); }

  return {
    apri, unUso, parteDiUnUso, servitaDaCache, usoDallaPagina, azione, azioneMisurata, impostazioniCambiate, ricerca,
    proposta, anticipoPronto, anticipoAperto, chiesto, adattamento, erroreVisto, intervista, intervistaToccata, intervistaAbbandonata, confermaDecisa, confermaChiesta, confermaRisposta,
    azioneDiFilo, cambioAnnullato, tastoAnnulla, annullatoInPagina,
    controlla, avvia, seguiImpostazioni, installazioni, accesi, letto, salva,
  };
}

module.exports = { crea, CHIAVE, MUTO };
