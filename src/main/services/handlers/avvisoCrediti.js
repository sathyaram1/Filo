// Handler di dominio: l'avviso prima che i crediti finiscano (#818), coi rimedi da un clic e il loro «com'era».
// Proiezione, soglie e rimedi stanno in shared/creditiAvviso.js; saldo e quota li dà SN_WALLET_MAIN, qui si tiene il
// diario dei consumi. Un avviso per calo: si riarma solo quando il saldo risale, mai a calendario.

const { AsyncLocalStorage } = require('node:async_hooks');
const ContatoriServizio = require('../contatoriServizio');

module.exports = function register(on, ctx) {
  const { MSG, broadcastToFiloPages } = ctx;
  const CA = globalThis.SN_CREDITI_AVVISO;
  const C = globalThis.SN_CONST;
  const S = () => globalThis.SN_STORAGE;
  const WM = () => globalThis.SN_WALLET_MAIN;

  const DIARIO_KEY = 'walletConsumo';
  const STATO_KEY = 'avvisoCreditiStato';
  const RIMEDI_KEY = 'avvisoCreditiRimedi';
  const INGRESSO_KEY = 'walletIngresso';
  // Prima di dire «finiscono dopodomani» il saldo si rilegge, se l'ultima lettura ha più di un minuto.
  const LETTURA_VALIDA_MS = 60 * 1000;
  // Dopo un avviso il saldo si rilegge ogni tanto anche senza nessuno che lo chieda: solo così si vede che è risalito
  // (la quota della notte, un regalo) con Filo aperto per giorni.
  const RILETTURA_DOPO_AVVISO_MS = 30 * 60 * 1000;
  // Quanto la home con una conversazione aperta ha per prenderlo, prima che diventi una notifica.
  const ATTESA_CHAT_MS = 3000;
  const ATTESA_VALUTAZIONE_MS = 4000;
  const CREDITI_URL = 'filo://credits/credits.html#avviso';

  const isFilo = (origin) => String(origin || '').startsWith('filo://');
  const filoOnly = (fn) => async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    return fn(msg, sender, origin);
  };

  // Una valutazione o un rimedio alla volta: due valutazioni insieme vedrebbero tutte e due l'avviso ancora da dire.
  let fila = Promise.resolve();
  function inFila(fn) {
    const turno = fila.then(fn);
    fila = turno.catch(() => {});
    return turno;
  }

  // ── Il diario dei consumi ─────────────────────────────────────────────────
  // Solo le chiamate pagate coi crediti di Filo (lo decide il registro d'uso): sono quelle che fanno scendere il saldo.
  let diario = {};
  let caricamento = null;
  function carica() {
    if (!caricamento) {
      caricamento = (async () => {
        try { const d = await S().getRaw(DIARIO_KEY, null); diario = d && typeof d === 'object' ? d : {}; } catch (_) { diario = {}; }
      })();
    }
    return caricamento;
  }
  let salvataggio = null;
  function salvaPresto() {
    if (salvataggio) return;
    salvataggio = setTimeout(() => {
      salvataggio = null;
      Promise.resolve(S().setRaw(DIARIO_KEY, diario)).catch(() => {});
    }, 3000);
  }

  // La spiegazione che parte da sola alla selezione si conta a parte: è quella che si spegne per risparmiare.
  const anticipata = new AsyncLocalStorage();
  function comeAnticipata(fn) { return anticipata.run(CA.ANTICIPATA, fn); }

  // Il saldo letto dal server meno quello che si è speso dopo: fra due letture il saldo si muove anche qui.
  let consumoDopoLettura = 0;
  async function registraConsumo({ action, credits, usage } = {}) {
    await carica();
    const u = usage || {};
    diario = CA.aggiungi(diario, {
      azione: action, tag: anticipata.getStore() || '', crediti: credits,
      prompt: u.promptTokens, completion: u.completionTokens,
    });
    consumoDopoLettura += Math.max(0, Number(credits) || 0);
    salvaPresto();
    valutaPresto();
  }

  async function ricordaIngresso(n) {
    const v = Number(n);
    if (!(v > 0)) return;
    try { await S().setRaw(INGRESSO_KEY, v); } catch (_) {}
  }
  // I crediti d'ingresso: il movimento dell'invito, se è ancora fra quelli che il server manda, o quelli del riscatto.
  async function ingresso(server) {
    const g = (Array.isArray(server && server.grants) ? server.grants : []).find((x) => x && x.why === 'entry' && Number(x.credits) > 0);
    if (g) { ricordaIngresso(g.credits); return Number(g.credits); }
    try { return Number(await S().getRaw(INGRESSO_KEY, 0)) || 0; } catch (_) { return 0; }
  }

  function dopoLettura(state) {
    const sv = state && state.server;
    if (sv && sv.hasWallet && !sv.cached && !sv.stale) consumoDopoLettura = 0;
    valutaPresto();
  }

  // ── La situazione di adesso ───────────────────────────────────────────────
  // null = niente da dire: senza portafoglio, con la chiave propria, senza la chiave personale o senza un saldo noto.
  async function situazione() {
    const W = WM();
    if (!W || !W.haPortafoglio || !W.haPortafoglio()) return null;
    const ul = W.ultimaLettura ? W.ultimaLettura() : null;
    const st = ul && ul.state;
    const sv = st && st.server;
    if (!sv || !sv.hasWallet) return null;
    if (st.usingOwnKey || !st.hasPersonalKey || (st.identity && st.identity.lost)) return null;
    const b = sv.balance || {};
    if (b.credits == null || !Number.isFinite(Number(b.credits))) return null;
    await carica();
    const settings = await S().getSettings();
    const saldo = Math.max(0, Number(b.credits) - consumoDopoLettura);
    const quota = Math.max(0, Number(sv.dailyCredits) || 0);
    const ritmo = CA.ritmo(diario);
    const soglie = CA.soglieDa(settings.avvisoCrediti);
    const ing = await ingresso(sv);
    const v = CA.valuta({ saldo, perGiorno: ritmo.perGiorno, quota, ingresso: ing, soglie });
    return { saldo, quota, ritmo, soglie, ingresso: ing, v, grants: sv.grants || [], letturaAt: ul.at, settings };
  }

  async function leggiStato() {
    try { const s = await S().getRaw(STATO_KEY, null); return s && typeof s === 'object' ? s : {}; } catch (_) { return {}; }
  }
  async function scriviStato(s) {
    try { await S().setRaw(STATO_KEY, s); } catch (_) {}
  }
  async function leggiApplicati() {
    try { const r = await S().getRaw(RIMEDI_KEY, null); return r && typeof r === 'object' ? r : {}; } catch (_) { return {}; }
  }
  async function scriviApplicati(r) {
    try { await S().setRaw(RIMEDI_KEY, Object.keys(r).length ? r : null); } catch (_) {}
  }

  // ── I rimedi ──────────────────────────────────────────────────────────────
  function nomeFunzione(azione) {
    const U = globalThis.SN_MODEL_USAGE;
    const e = U && U.ENTRIES ? U.ENTRIES.find((x) => x.ref === azione) : null;
    return (e && e.label) || (C.actionLabel ? C.actionLabel(azione) : azione);
  }

  async function calcolaRimedi(sit) {
    await carica();
    const eff = await ctx.getEffectiveSettings();
    const settings = sit ? sit.settings : await S().getSettings();
    const U = globalThis.SN_MODEL_USAGE;
    const W = WM();
    const ul = W && W.ultimaLettura ? W.ultimaLettura() : null;
    const sv = ul && ul.state && ul.state.server;
    const quota = sit ? sit.quota : Math.max(0, Number(sv && sv.dailyCredits) || 0);
    return CA.rimedi({
      diario,
      perGiorno: sit ? sit.ritmo.perGiorno : CA.ritmo(diario).perGiorno,
      quota,
      prossima: CA.prossimaQuota(sit ? sit.grants : (sv && sv.grants) || []),
      chiavePropria: Boolean(ul && ul.state && ul.state.usingOwnKey),
      impostazioni: settings,
      config: {
        models: eff.models || {},
        registry: eff.modelRegistry || {},
        soloPesiAperti: eff.openWeightsOnly === true,
        prezzoDi: (id) => (eff.pricing && eff.pricing[id]) || (C.notionalPricingFor ? C.notionalPricingFor(id) : null),
      },
      etichetta: nomeFunzione,
      funzioni: U && U.userActions ? U.userActions() : undefined,
    });
  }

  // Come la vede chi la mostra: testo, cifra, e cosa fa il pulsante.
  function vista(r) {
    const base = { id: r.id, testo: r.testo, frase: r.frase || '', dettagli: r.dettagli || [], applicato: false };
    if (r.id === 'modello') return { ...base, azione: 'applica', etichetta: 'Usa i più economici' };
    if (r.id === 'automatiche') return { ...base, azione: 'applica', etichetta: (r.cambi || []).length > 1 ? 'Spegnile' : 'Spegni' };
    if (r.id === 'chiave') return { ...base, azione: 'chiave', etichetta: 'Metti la chiave' };
    return { ...base, azione: null, etichetta: '' };
  }
  function vistaApplicata(id, rec) {
    return {
      id, testo: rec.fatto || rec.testo || '', frase: '', dettagli: rec.dettagli || [], applicato: true, azione: 'annulla',
      etichetta: id === 'modello' ? 'Rimetti i modelli di prima' : 'Riaccendi',
    };
  }

  async function rimediDaMostrare(sit) {
    const lista = await calcolaRimedi(sit);
    const applicati = await leggiApplicati();
    const out = [];
    for (const id of ['modello', 'automatiche']) if (applicati[id]) out.push(vistaApplicata(id, applicati[id]));
    for (const r of lista) if (!applicati[r.id]) out.push(vista(r));
    return out;
  }

  async function componi(sit) {
    const testo = CA.frase({ saldo: sit.saldo, giorni: sit.v.giorni, motivi: sit.v.motivi, percento: sit.soglie.percento });
    const rimedi = await rimediDaMostrare(sit);
    return {
      id: `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      testo, saldo: sit.saldo, rimedi, perFilo: CA.perFilo(testo, rimedi),
    };
  }

  // ── La valutazione ────────────────────────────────────────────────────────
  let valutazioneTimer = null;
  function valutaPresto() {
    if (valutazioneTimer) return;
    valutazioneTimer = setTimeout(() => {
      valutazioneTimer = null;
      valutaOra().catch(() => {});
    }, ATTESA_VALUTAZIONE_MS);
  }

  function valutaOra() { return inFila(() => valuta({ rileggi: true })); }

  async function valuta({ rileggi }) {
    const W = WM();
    if (!W || !W.haPortafoglio || !W.haPortafoglio()) return { esito: 'senza-portafoglio' };
    const sit = await situazione();
    if (!sit) {
      if (rileggi && !(W.ultimaLettura && W.ultimaLettura())) {
        await W.readState().catch(() => null);
        return valuta({ rileggi: false });
      }
      return { esito: 'niente' };
    }
    let stato = await leggiStato();
    if (stato.armato === false && rileggi && Date.now() - sit.letturaAt > RILETTURA_DOPO_AVVISO_MS) {
      await W.readState().catch(() => null);
      return valuta({ rileggi: false });
    }
    if (stato.armato === false && CA.riarmato(stato, sit.saldo)) {
      stato = { armato: true };
      await scriviStato(stato);
    }
    if (!sit.v.scatta) return { esito: 'sopra' };
    if (stato.armato === false) return { esito: 'gia-detto' };
    if (rileggi && Date.now() - sit.letturaAt > LETTURA_VALIDA_MS) {
      await W.readState().catch(() => null);
      return valuta({ rileggi: false });
    }
    const avviso = await componi(sit);
    await scriviStato({
      armato: false, id: avviso.id, at: new Date().toISOString(),
      sogliaRiarmo: CA.sogliaRiarmo({ sogliaSaldo: sit.v.sogliaSaldo, quota: sit.quota }),
    });
    consegna(avviso);
    for (const m of (sit.v && sit.v.motivi) || []) ContatoriServizio.misura('avviso', 'scattato', m);
    return { esito: 'avvisato', avviso };
  }

  // ── La consegna ───────────────────────────────────────────────────────────
  // In chat se una home ha una conversazione aperta (la prende la prima che lo chiede), altrimenti una notifica
  // nella cornice della finestra che porta alla pagina Crediti.
  let inAttesa = null; // { avviso, preso, timer }
  function consegna(avviso) {
    if (inAttesa && inAttesa.timer) clearTimeout(inAttesa.timer);
    inAttesa = { avviso, preso: false, timer: setTimeout(() => notifica(avviso), ATTESA_CHAT_MS) };
    try { broadcastToFiloPages({ type: MSG.CREDITS_WARNING, id: avviso.id }); } catch (_) {}
  }

  function notifica(avviso) {
    if (!inAttesa || inAttesa.avviso.id !== avviso.id || inAttesa.preso) return;
    inAttesa.preso = true;
    inAttesa.timer = null;
    try {
      const { BrowserWindow } = require('electron');
      // Una finestra sola, quella davanti: la cornice, non le pagine.
      const win = [BrowserWindow.getFocusedWindow(), ...BrowserWindow.getAllWindows()]
        .filter(Boolean)
        .filter((w) => w._filoTabs)
        .find((w) => !w.isDestroyed?.() && w.webContents && !w.webContents.isDestroyed?.());
      if (!win) return;
      win.webContents.send('shell:toast', {
        text: avviso.testo,
        opts: { durationSec: 0, key: 'avviso-crediti', tipo: 'avviso_crediti', actions: [{ label: 'Come farli durare', openUrl: CREDITI_URL }] },
      });
    } catch (_) {}
  }

  on(MSG.CREDITS_WARNING_CLAIM, filoOnly(async (msg, sender) => {
    const id = String((msg && msg.id) || '');
    if (!inAttesa || inAttesa.preso || inAttesa.avviso.id !== id) return { ok: false };
    // Una home in una scheda dietro le altre non lo prende: lo direbbe a nessuno, e la notifica non partirebbe più.
    // Lo decide il main: in una scheda di Filo `document.hidden` resta falso anche dietro.
    const tabs = ctx.winOf(sender)?._filoTabs;
    if (tabs && sender?.tab?.id && tabs.activeId !== sender.tab.id) return { ok: false };
    inAttesa.preso = true;
    if (inAttesa.timer) clearTimeout(inAttesa.timer);
    inAttesa.timer = null;
    return { ok: true, avviso: inAttesa.avviso };
  }));

  // La pagina Crediti: l'avviso se le soglie dicono così adesso, e i rimedi applicati finché si possono annullare.
  async function perLaPagina() {
    const sit = await situazione();
    const rimedi = await rimediDaMostrare(sit);
    const applicati = rimedi.some((r) => r.applicato);
    const scatta = Boolean(sit && sit.v.scatta);
    if (!scatta && !applicati) return { ok: true, mostra: false, avviso: null };
    return {
      ok: true, mostra: true,
      avviso: {
        testo: scatta ? CA.frase({ saldo: sit.saldo, giorni: sit.v.giorni, motivi: sit.v.motivi, percento: sit.soglie.percento }) : '',
        rimedi: scatta ? rimedi : rimedi.filter((r) => r.applicato),
      },
    };
  }
  on(MSG.CREDITS_WARNING_STATE, filoOnly(async () => perLaPagina()));

  // ── Applicare e rimettere com'era ─────────────────────────────────────────
  // Dalla pagina arriva solo l'id: cosa cambiare lo ricalcola il main, e il «com'era» è quello che c'era prima del clic.
  async function applica(id) {
    const applicati = await leggiApplicati();
    if (applicati[id]) return { ok: true, gia: true };
    const sit = await situazione();
    const r = (await calcolaRimedi(sit)).find((x) => x.id === id);
    if (!r || !Array.isArray(r.cambi) || !r.cambi.length) return { ok: false, frase: 'Adesso qui non c\'è niente da cambiare.' };
    const settings = await S().getSettings();
    let rec;
    let pezzo;
    if (id === 'modello') {
      // Coi modelli predefiniti la scelta sta sopra di loro, per quella funzione sola: il resto resta dell'owner.
      const dove = settings.useDefaultModels !== false ? 'modelliScelti' : 'models';
      const cambi = r.cambi.map((c) => ({ azione: c.azione, dove, prima: String(((settings[dove] || {})[c.azione]) || ''), dopo: c.catena }));
      pezzo = { [dove]: Object.fromEntries(cambi.map((c) => [c.azione, c.dopo])) };
      rec = { at: new Date().toISOString(), testo: r.testo, fatto: r.fatto, dettagli: r.dettagli || [], cambi };
    } else {
      const cambi = r.cambi.map((c) => ({ percorso: c.percorso, prima: CA.leggiPercorso(settings, c.percorso), dopo: c.valore }));
      pezzo = {};
      for (const c of cambi) deepAssign(pezzo, CA.pezzoPer(c.percorso, c.dopo));
      rec = { at: new Date().toISOString(), testo: r.testo, fatto: r.fatto, cambi };
    }
    // Prima il «com'era», poi il cambio: un cambio senza il suo «com'era» non si potrebbe più annullare.
    await S().setRaw(RIMEDI_KEY, { ...applicati, [id]: rec });
    try {
      await ctx.applySettingsUpdate(pezzo);
    } catch (e) {
      await scriviApplicati(applicati);
      throw e;
    }
    // Il rimedio scelto, e per «automatiche» quali ha spento davvero: lo contano i contatori del servizio (#1472).
    ContatoriServizio.misura('avviso', 'rimedio', id);
    const perPercorso = new Map(CA.automatiche().map((x) => [x.percorso, x.id]));
    for (const c of rec.cambi) if (perPercorso.has(c.percorso)) ContatoriServizio.misura('avviso', 'spenta', perPercorso.get(c.percorso));
    return { ok: true, frase: id === 'modello' ? 'Fatto: le funzioni usano i modelli più economici.' : 'Fatto: spente.' };
  }

  // Si rimette solo quello che è ancora come l'ha lasciato il clic: un cambio fatto dopo, a mano, resta.
  async function annulla(id) {
    const applicati = await leggiApplicati();
    const rec = applicati[id];
    if (!rec) return { ok: true, gia: true };
    const settings = await S().getSettings();
    const pezzo = {};
    let rimessi = 0;
    let lasciati = 0;
    for (const c of rec.cambi || []) {
      if (c.azione) {
        const ora = String(((settings[c.dove] || {})[c.azione]) || '');
        if (ora !== c.dopo) { lasciati++; continue; }
        deepAssign(pezzo, { [c.dove]: { [c.azione]: c.prima } });
      } else {
        if (CA.leggiPercorso(settings, c.percorso) !== c.dopo) { lasciati++; continue; }
        deepAssign(pezzo, CA.pezzoPer(c.percorso, c.prima));
      }
      rimessi++;
    }
    if (rimessi) await ctx.applySettingsUpdate(pezzo);
    const resto = { ...applicati };
    delete resto[id];
    await scriviApplicati(resto);
    const frase = rimessi && !lasciati ? 'Rimesso com\'era.'
      : rimessi ? 'Rimesso com\'era, tranne quello che avevi già cambiato tu.'
        : 'L\'avevi già cambiato tu: resta com\'è.';
    return { ok: true, frase };
  }

  function deepAssign(dst, src) {
    for (const [k, v] of Object.entries(src)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (!dst[k] || typeof dst[k] !== 'object') dst[k] = {};
        deepAssign(dst[k], v);
      } else dst[k] = v;
    }
    return dst;
  }

  const RIMEDI_CON_CLIC = new Set(['modello', 'automatiche']);
  const NON_RIUSCITO = { ok: false, frase: 'Non ci sono riuscito: riprova.' };

  // La chat (RIMEDIO_CREDITI): la stessa porta dei pulsanti, e senza rimedio l'elenco di adesso coi suoi id.
  async function rimedioDaChat({ rimedio, operazione } = {}) {
    const id = String(rimedio || '').trim().toLowerCase();
    const op = String(operazione || '').trim().toLowerCase();
    if (op === 'applica' || op === 'annulla') {
      if (!RIMEDI_CON_CLIC.has(id)) return { ok: false, error: 'rimedio', frase: 'Si applicano e si rimettono solo «modello» e «automatiche».' };
      const r = await inFila(() => (op === 'applica' ? applica(id) : annulla(id))).catch(() => NON_RIUSCITO);
      try { broadcastToFiloPages({ type: MSG.CREDITS_CHANGED, avvisoCrediti: true }); } catch (_) {}
      const fatti = (await rimediDaMostrare(await situazione())).find((x) => x.id === id);
      return {
        ...r, rimedio: id, operazione: op,
        frase: r.frase || (r.gia ? (op === 'applica' ? 'Era già applicato.' : 'Era già com\'era.') : ''),
        dettagli: fatti ? fatti.dettagli || [] : [],
      };
    }
    const sit = await situazione();
    const lista = await rimediDaMostrare(sit);
    const testo = sit ? CA.frase({ saldo: sit.saldo, giorni: sit.v.giorni, motivi: sit.v.motivi, percento: sit.soglie.percento }) : '';
    return {
      ok: true, operazione: 'elenca', testo: CA.perFilo(testo, lista),
      rimedi: lista.filter((x) => x.azione === 'applica' || x.azione === 'annulla')
        .map((x) => ({ id: x.id, applicato: x.applicato, testo: x.testo })),
    };
  }
  on(MSG.CREDITS_REMEDY_APPLY, filoOnly(async (msg) => {
    const id = String((msg && msg.id) || '');
    if (!RIMEDI_CON_CLIC.has(id)) return { ok: false, error: 'bad_id' };
    const r = await inFila(() => applica(id)).catch(() => NON_RIUSCITO);
    try { broadcastToFiloPages({ type: MSG.CREDITS_CHANGED, avvisoCrediti: true }); } catch (_) {}
    return { ...r, avviso: (await perLaPagina()).avviso };
  }));
  on(MSG.CREDITS_REMEDY_UNDO, filoOnly(async (msg) => {
    const id = String((msg && msg.id) || '');
    if (!RIMEDI_CON_CLIC.has(id)) return { ok: false, error: 'bad_id' };
    const r = await inFila(() => annulla(id)).catch(() => NON_RIUSCITO);
    try { broadcastToFiloPages({ type: MSG.CREDITS_CHANGED, avvisoCrediti: true }); } catch (_) {}
    return { ...r, avviso: (await perLaPagina()).avviso };
  }));

  // Una spiegazione preparata alla selezione e poi aperta col tasto destro. Arriva anche dai siti, dal content script:
  // il peggio che un mittente può fare è abbassare la cifra di risparmio di un rimedio.
  on(MSG.SPIEGAZIONE_ANTICIPATA_USATA, async () => {
    await carica();
    diario = CA.aggiungiUso(diario, { azione: C.ACTIONS.EXPLAIN });
    salvaPresto();
    return { ok: true };
  });

  globalThis.SN_AVVISO_CREDITI_MAIN = {
    registraConsumo, ricordaIngresso, dopoLettura, comeAnticipata, valutaOra, rimedioDaChat,
    // Solo per i test (NODE_ENV=test): il diario di giorni passati, e la valutazione senza aspettare.
    impostaDiarioPerTest: async (d) => {
      if (process.env.NODE_ENV !== 'test') return;
      await carica();
      diario = d && typeof d === 'object' ? d : {};
      consumoDopoLettura = 0;
      await S().setRaw(DIARIO_KEY, diario);
    },
    diarioPerTest: () => (process.env.NODE_ENV === 'test' ? diario : null),
  };

  setTimeout(() => { carica().catch(() => {}); }, 2000);
};
