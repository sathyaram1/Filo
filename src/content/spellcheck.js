// Il correttore mentre si scrive (#1446): due segni, errori e suggerimenti, disegnati da Filo sopra il campo, la
// correzione automatica a fine parola (#1447) e i valori dei segnaposti (#1448). Le regole senza DOM stanno in
// correttoreRegole.js, correttoreAutomatica.js e coerenza.js, il menu del tasto destro in content.js.

(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;
  const { ACTIONS, STORAGE_KEYS } = global.SN_CONST;
  const R = () => global.SN_CORRETTORE;
  const A = () => global.SN_CORRETTORE_AUTO;
  const Coerenza = () => global.SN_COERENZA;
  const t = (k, ...a) => (global.SN_I18N ? global.SN_I18N.t(k, ...a) : k);

  // Il testo della pagina intorno al campo: tetto largo, e oltre si tiene la parte più vicina al campo.
  const CONTESTO_MAX = 12000;
  const CONTESTO_DOPO_MAX = 3000;
  const CONTESTO_NODI_MAX = 20000;
  // Il testo prima del pezzo nuovo del controllo rapido: il paragrafo in corso e quello prima, come sul banco del 19/10
  // (#1580); un paragrafo lunghissimo si accorcia alla parte vicina. Il ragionato rilegge il campo intero.
  const PRIMA_MAX = 4000;
  // Il testo sopra il campo che resta al main, dove si cerca chi chiede una password (correttoreRiservati.js).
  const CONVERSAZIONE_MAX = 1500;
  // Conferma e scarto si vedono come un passaggio breve, non come uno scatto.
  const PASSAGGIO_MS = 320;
  // Il lampo sul valore che Filo ha appena messo al posto delle x: si vede dove è cambiato il testo, poi sfuma.
  const LAMPO_MS = 900;
  // Oltre, i candidati del codice si ricalcolano a una pausa breve invece che a ogni tasto.
  const LUNGO = 20000;
  const RICALCOLO_LUNGO_MS = 300;
  const ESITI_MAX = 40;
  const GIUDICATI_MAX = 12;
  const DIZIONARIO_MAX = 20000;
  const MIN_TESTO = 8;

  // Ogni casella ha il suo stato per tutta la vita della pagina: chi esce e rientra ritrova segni e giudizi già pagati
  // (#1097.5), e un ascoltatore solo, che guarda lo stato vivo (#1070).
  const monitored = new WeakMap();
  const ascoltate = new WeakSet();
  let activeEl = null;
  let personalDict = new Set();
  // Le parole del dizionario personale nella forma in cui sono scritte: «Zanzottera» corregge «zanzottera» (#1447).
  let formeDizionario = new Map();
  let autocorrectMap = {}; // { lowercased misspelled: correction }
  let settings = null;
  // L'applyFix dell'autocorrect dispatcha un input che rientrerebbe nel listener: questa flag salta una passata.
  let suppressAutocorrect = false;
  // Quello che Filo impara dai rifiuti (#1447), com'è salvato: conti e parole da non correggere più da sé.
  let imparato = null;
  // Come si scrive in questo sito: gli inizi di frase dei testi già mandati e le maiuscole annullate. Il main lo tiene per
  // sito, così riaperta la chat Filo lo sa già.
  const stilePagina = { minuscoli: 0, maiuscoli: 0 };
  const AUTOMATICHE_MAX = 200;
  let progressivo = 0;

  // Suggerimenti del correttore NATIVO per l'ultima parola su cui è stato chiesto il menu: il main li spinge al tasto
  // destro (`_spell:native`, tabs.js). Servono alle caselle di una riga e ai blocchi sigillati (#438).
  let lastNative = { word: '', suggestions: [], ts: 0 };
  const nativeWaiters = new Set();

  // ============================================================================
  // Impostazioni
  // ============================================================================
  const spentoQui = () => !settings || settings.sitoSpento === true;
  function erroriAttivi() { return !spentoQui() && settings.featureFlags?.spellcheck !== false; }
  function suggerimentiAttivi() { return !spentoQui() && settings.featureFlags?.spellcheckContext !== false && !!Coerenza(); }
  function modelloErrori() { return erroriAttivi() && settings.correttore?.modelloErrori !== false; }
  function ripetizioniAttive() { return settings?.correttore?.ripetizioni !== false; }
  // I segnaposti (#1448) hanno il loro interruttore: con i suggerimenti spenti il controllo ragionato parte lo stesso, solo
  // dove ci sono delle x da riempire.
  function segnapostiAttivi() { return !spentoQui() && settings.correttore?.segnaposti !== false && !!Coerenza(); }
  const ragionatoAttivo = () => suggerimentiAttivi() || segnapostiAttivi();
  function automaticaAttiva() { return !spentoQui() && !!A() && settings.correttore?.automatica !== false; }
  function tempi() {
    const C = global.SN_CONST;
    return C.tempiCorrettore ? C.tempiCorrettore(settings) : { pausaRapidoMs: 500, ogniRapidoMs: 5000, pausaRagionatoMs: 3500 };
  }
  const attivo = () => erroriAttivi() || suggerimentiAttivi() || segnapostiAttivi() || automaticaAttiva();

  // Lo zigzag del browser si spegne dove i segni li disegna Filo (spellcheck.css); con «Errori» spento anche nelle
  // caselle di una riga. Sul sito dove Filo è spento il browser fa da sé.
  function segnaRadice() {
    const r = document.documentElement;
    if (!r || !r.dataset) return;
    if (spentoQui()) { delete r.dataset.snCorrettore; return; }
    r.dataset.snCorrettore = erroriAttivi() ? 'errori' : 'senza-errori';
  }

  // ============================================================================
  // Init
  // ============================================================================
  function init(s) {
    settings = s;
    segnaRadice();
    loadDictionary();
    loadAutocorrect();
    caricaImparato();
    caricaStile();
    // In cattura, per i campi dentro i componenti (per quanto possibile).
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    window.addEventListener('keydown', annullaColTasto, true);
    window.addEventListener('scroll', queueSync, true);
    window.addEventListener('resize', queueSync, true);
    document.addEventListener('visibilitychange', riprendiRimandati);
    document.addEventListener('pointermove', svegliaValori, { capture: true, passive: true });
    document.addEventListener('pointerdown', svegliaValori, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) rileggiMemorie(); });
    adottaIlFuoco();

    // Le memorie cambiate altrove (la pagina del correttore, un'altra scheda) arrivano spinte dal main (#1447).
    try {
      chrome.runtime.onMessage.addListener((m) => {
        if (m?.type !== MSG.CORRETTORE_MEMORIE || !m.memorie || typeof m.memorie !== 'object') return;
        usaMemorie(m.memorie);
      });
    } catch (_) {}

    try {
      chrome.runtime.onMessage.addListener((m) => {
        if (m?.type !== '_spell:native') return;
        lastNative = {
          word: String(m.word || ''),
          suggestions: Array.isArray(m.suggestions) ? m.suggestions : [],
          ts: Date.now(),
        };
        // Per i test: la parola di cui sono arrivati i suggerimenti nativi, invece di un'attesa fissa.
        try { document.documentElement.dataset.filoNativeWord = lastNative.word; } catch (_) {}
        for (const fn of [...nativeWaiters]) { try { fn(lastNative); } catch (_) {} }
      });
    } catch (_) {}
  }

  function updateSettings(s) {
    settings = s;
    segnaRadice();
    if (!attivo()) { detachAll(); return; }
    const state = activeEl && monitored.get(activeEl);
    if (!state) { adottaIlFuoco(); return; }
    // Ogni parte si spegne da sola, e le altre restano.
    if (!modelloErrori()) fermaTimer(state, ['timerRapido', 'timerFine']);
    if (!ragionatoAttivo()) fermaTimer(state, ['timerRagionato']);
    aggiornaCodice(state);
    // Anche il tema può essere cambiato: i colori dei segni lo leggono dall'overlay.
    syncOverlay(state);
  }

  function fermaTimer(state, nomi) {
    for (const k of nomi) if (state[k]) { clearTimeout(state[k]); state[k] = null; }
    if (nomi.includes('timerRapido')) state.cambioDa = 0;
  }

  // ============================================================================
  // Dizionari
  // ============================================================================
  function usaDizionario(parole) {
    const lista = Array.isArray(parole) ? parole.map(String) : [];
    personalDict = new Set(lista.map((w) => w.toLowerCase()));
    formeDizionario = new Map();
    for (const w of lista) if (!formeDizionario.has(w.toLowerCase())) formeDizionario.set(w.toLowerCase(), w);
  }

  async function loadDictionary() {
    try {
      const d = await chrome.storage.local.get(STORAGE_KEYS.PERSONAL_DICT);
      usaDizionario(d?.[STORAGE_KEYS.PERSONAL_DICT] || []);
    } catch (_) {}
  }

  async function addToDictionary(word) {
    const w = String(word || '').trim();
    if (!w) return;
    const wLower = w.toLowerCase();
    if (personalDict.has(wLower)) return;
    personalDict.add(wLower);
    formeDizionario.set(wLower, w);
    // Lo scrive la fila del main, la stessa della pagina del correttore (#1447): la parola resta come l'ha scritta
    // l'utente («iPhone»), il confronto è senza maiuscole.
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.CORRETTORE_IMPARA, passo: 'aggiungiParola', parola: w });
      if (r && r.ok && Array.isArray(r.parole)) usaDizionario(r.parole);
    } catch (_) {}
  }

  function isInDictionary(word) {
    return personalDict.has(String(word || '').trim().toLowerCase());
  }

  // Il dizionario del browser, ricordato per pagina. Finché non ha caricato le sue lingue ogni parola risulta giusta:
  // quella risposta non si ricorda, se no una parola sbagliata scritta nel primo secondo resterebbe giusta per sempre.
  const parereDizionario = new Map();
  let dizionarioPronto = false;
  function ricorda(k, v) {
    if (parereDizionario.size >= DIZIONARIO_MAX) parereDizionario.clear();
    parereDizionario.set(k, v);
  }
  function sbagliataPerIlBrowser(parola) {
    const D = global.SN_DIZIONARIO;
    if (!D) return false;
    const k = String(parola || '');
    if (parereDizionario.has(k)) return parereDizionario.get(k);
    if (!dizionarioPronto) dizionarioPronto = D.sbagliata('qzxwvkjh');
    const v = D.sbagliata(k);
    if (dizionarioPronto) ricorda(k, v);
    return v;
  }

  // Le parole nuove di un testo si chiedono insieme: il dizionario sta nel processo principale, e una domanda per parola
  // costerebbe un viaggio ciascuna (#1585). I pareri valgono per questo testo anche oltre il tetto della memoria.
  const PARERI_PER_DOMANDA = 5000;
  function pareriDelTesto(testo) {
    const D = global.SN_DIZIONARIO;
    const pareri = new Map();
    if (!D || typeof D.sbagliate !== 'function') return pareri;
    const nuove = [];
    for (const { parola } of R().parole(testo)) {
      const k = parola.replace(/’/g, "'");
      if (pareri.has(k)) continue;
      if (parereDizionario.has(k)) pareri.set(k, parereDizionario.get(k));
      else { pareri.set(k, false); nuove.push(k); }
    }
    if (!nuove.length) return pareri;
    if (!dizionarioPronto) dizionarioPronto = D.sbagliata('qzxwvkjh');
    for (let i = 0; i < nuove.length; i += PARERI_PER_DOMANDA) {
      const pezzo = nuove.slice(i, i + PARERI_PER_DOMANDA);
      const v = D.sbagliate(pezzo);
      pezzo.forEach((k, j) => {
        pareri.set(k, v[j] === true);
        if (dizionarioPronto) ricorda(k, v[j] === true);
      });
    }
    return pareri;
  }

  // Una parola che il dizionario dice giusta, solo a dizionario carico: prima ogni parola risulta giusta.
  function giustaPerIlBrowser(parola) {
    const v = sbagliataPerIlBrowser(parola);
    return dizionarioPronto && !v;
  }

  function proposteDelBrowser(parola) {
    const D = global.SN_DIZIONARIO;
    try { return D ? D.proposte(String(parola || '')).filter((p) => p && p !== parola) : []; } catch (_) { return []; }
  }

  // ============================================================================
  // Autocorrect
  // ============================================================================
  async function loadAutocorrect() {
    try {
      const d = await chrome.storage.local.get(STORAGE_KEYS.AUTOCORRECT);
      const m = d?.[STORAGE_KEYS.AUTOCORRECT] || {};
      autocorrectMap = (m && typeof m === 'object') ? m : {};
    } catch (_) {}
  }

  async function setAutocorrect(misspelled, correction) {
    const w = String(misspelled || '').trim().toLowerCase();
    const c = String(correction || '').trim();
    if (!w || !c) return;
    autocorrectMap = { ...autocorrectMap, [w]: c };
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.AUTOCORRECT]: autocorrectMap });
    } catch (_) {}
  }

  function isWordCharLocal(c) { return !!c && /[\p{L}\p{N}'’\-]/u.test(c); }

  // ============================================================================
  // La correzione automatica a fine parola (#1447)
  // ============================================================================
  // Dalla memoria alla scheda arrivano solo le parole da non correggere: i conti a metà restano nel main.
  async function caricaImparato() {
    if (!A()) return;
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.CORRETTORE_IMPARA, passo: 'leggi' });
      imparato = A().memoria({ rifiutate: r && r.ok ? r.rifiutate : [] });
    } catch (_) { imparato = A().memoria(null); }
  }

  // Un passo di quello che Filo impara lo fa il main, in una fila sola per tutte le schede e la pagina del correttore
  // (src/main/services/correttoreImpara.js). `poi(esito)` agisce su quello che il passo ha deciso.
  function impara(passo, poi) {
    Promise.resolve(chrome.runtime.sendMessage({ type: MSG.CORRETTORE_IMPARA, ...passo })).then(async (esito) => {
      if (!esito || !esito.ok) return;
      if (Array.isArray(esito.rifiutate) && A()) imparato = { ...(imparato || A().memoria(null)), rifiutate: esito.rifiutate };
      if (poi) await poi(esito);
    }).catch(() => {});
  }

  function nomeDi(parola) {
    return A().formaDelNome(parola, { personali: formeDizionario, sbagliata: sbagliataPerIlBrowser });
  }
  // Un nome scritto minuscolo, o nella sua forma, non è mai un errore: o si corregge da sé o si lascia stare.
  function nomeNoto(parola) {
    if (!A()) return false;
    const forma = nomeDi(parola);
    return !!forma && (parola === parola.toLowerCase() || parola === forma);
  }

  // Si impara una parola fuori dizionario che non è il refuso di una parola vera («ciuruglio» sì, «propio» no).
  function parolaImparabile(parola) {
    const p = String(parola || '').replace(/’/g, "'");
    return !!p && !/\s/.test(p) && sbagliataPerIlBrowser(p) && A().imparabile(p, proposteDelBrowser(p));
  }
  // La forma da imparare: a inizio frase la maiuscola non dice niente.
  function formaDaImparare(parola, inizioFrase) {
    const p = String(parola || '');
    const basso = p.toLowerCase();
    return inizioFrase && p === basso.charAt(0).toUpperCase() + basso.slice(1) ? basso : p;
  }
  async function aggiungiImparata(parola) {
    await addToDictionary(parola);
    const state = activeEl && monitored.get(activeEl);
    if (state) aggiornaCodice(state);
  }

  // Si scrive tutto minuscolo apposta, qui? Il campo prima della parola (senza le correzioni di Filo) e i testi già
  // mandati dalla pagina.
  function minuscoloQui(state, finoA) {
    const testo = getEditableText(state.el);
    const da = Math.max(0, finoA - 3000);
    const esclusi = state.automatiche.map((x) => ({ start: x.start - da, end: x.end - da }));
    return A().scriveMinuscoloQui(A().stileDi(testo.slice(da, finoA), null, esclusi), stilePagina);
  }
  function ricordaStile(state, testo) {
    const esclusi = state.automatiche;
    aggiungiStile(A().stileDi(testo.slice(-3000), null, testo.length > 3000 ? [] : esclusi));
  }
  function aggiungiStile(s) {
    if (!s || (!s.minuscoli && !s.maiuscoli)) return;
    Object.assign(stilePagina, A().sommaStile(stilePagina, s));
    impara({ passo: 'stile', minuscoli: s.minuscoli || 0, maiuscoli: s.maiuscoli || 0 });
  }
  async function caricaStile() {
    if (!A()) return;
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.CORRETTORE_IMPARA, passo: 'leggiStile' });
      if (r && r.ok && r.stile) Object.assign(stilePagina, A().sommaStile(stilePagina, r.stile));
    } catch (_) {}
  }

  // Una parola chiusa da un tasto vero in questa casella: si corregge da sé, o si conta per quello che Filo impara. Mai
  // dopo: il testo già superato non cambia da solo, e un testo messo da uno script non si tocca.
  function fineParolaBattuta(state, evento) {
    if (suppressAutocorrect || !A()) return;
    const tipo = evento && evento.inputType;
    if (tipo !== 'insertText' && tipo !== 'insertLineBreak' && tipo !== 'insertParagraph') return;
    const G = global.SN_GESTO;
    const el = state.el;
    // In un riquadro chiuso di Filo il sito non arriva, e i tasti non escono dall'ombra (SN_FILO_UI): lì scrive solo
    // l'utente. Altrove serve un tasto vero che chiude la parola, dentro questa casella.
    if (radiceDi(el) ? !evento.isTrusted : !(G && G.prendi('automatica', G.CHIUDE, G.dentro(el)))) return;
    const testo = getEditableText(el);
    const pos = cursoreNelCampo(el);
    const fine = A().fineDellaParola(testo, pos);
    if (fine < 0) return;
    seguiIlTesto(state);
    if (automaticaAttiva() && !state.rifiutateQui.some((x) => x.end === fine && testo.slice(x.start, x.end) === x.segment)) {
      const c = A().correzioneAFineParola(testo, fine, {
        personali: autocorrectMap,
        rifiutate: new Set(imparato ? imparato.rifiutate : []),
        nomeDi,
        accento: giustaPerIlBrowser,
        minuscolo: () => minuscoloQui(state, A().parolaPrima(testo, fine)?.start ?? fine),
      });
      if (c && correggiDaSe(state, c)) return;
    }
    const w = A().parolaPrima(testo, fine);
    if (w && erroriAttivi() && !A().dentroCodice(testo, fine)) contaRiscritta(state, w, testo);
  }

  function correggiDaSe(state, c) {
    const el = state.el;
    const testoPrima = getEditableText(el);
    const cursorePrima = cursoreNelCampo(el);
    suppressAutocorrect = true;
    try {
      sostituisciParola(el, c.start, c.end, c.originale, c.corretta);
    } finally {
      // Dopo il flush degli eventi sincroni e dell'input riemesso da setRangeText.
      setTimeout(() => { suppressAutocorrect = false; }, 0);
    }
    const testo = getEditableText(el);
    const end = c.start + c.corretta.length;
    if (testo.slice(c.start, end) !== c.corretta) return false;
    seguiIlTesto(state);
    const voce = { id: ++progressivo, start: c.start, end, segment: c.corretta, originale: c.originale, fonte: c.fonte };
    state.automatiche = [...state.automatiche.filter((x) => !(x.start < end && x.end > c.start)), voce].slice(-AUTOMATICHE_MAX);
    state.ultimaAutomatica = { voce, testo, testoPrima, cursorePrima };
    lampo(state, c.start, end);
    return true;
  }

  // Dal tasto destro, anche dopo aver scritto altro: la parola corretta da sé torna com'era scritta. Vero se è tornata.
  function annullaAutomatica(el, voce) {
    const state = el && monitored.get(el);
    if (!state || !voce) return false;
    seguiIlTesto(state);
    const v = state.automatiche.find((x) => x.id === voce.id);
    if (!v || getEditableText(el).slice(v.start, v.end) !== v.segment) return false;
    suppressAutocorrect = true;
    try {
      sostituisciParola(el, v.start, v.end, v.segment, v.originale);
    } finally {
      setTimeout(() => { suppressAutocorrect = false; }, 0);
    }
    if (getEditableText(el).slice(v.start, v.start + v.originale.length) !== v.originale) return false;
    seguiIlTesto(state);
    rifiutata(state, v);
    return true;
  }

  // La parola [start, end) diventa `nuova`. Col cursore subito dopo la parola e quel che l'ha chiusa (spazio, virgola)
  // si riscrivono insieme, così il cursore resta lì anche negli editor che lo rimettono da sé dal loro modello (Lexical).
  const CODA_MAX = 20;
  function sostituisciParola(el, start, end, attesa, nuova) {
    const testo = getEditableText(el);
    const pos = cursoreNelCampo(el);
    const coda = pos >= end ? testo.slice(end, pos) : null;
    if (coda !== null && coda.length <= CODA_MAX && !/[\n\r]/.test(coda) && testo.slice(start, end) === attesa) {
      const scritta = campoDiTesto(el) ? coda : coda.replace(/ /g, ' ');
      applyFix(el, { start, end: pos }, nuova + scritta, { cursor: 'end', expectedSegment: attesa + coda, automatica: true });
      return;
    }
    applyFix(el, { start, end }, nuova, { cursor: 'preserve', expectedSegment: attesa, automatica: true });
  }

  // Gli editor di testo ricco (ProseMirror, Lexical) tengono un loro annulla e la scorciatoia non arriva al browser:
  // subito dopo una correzione automatica la prende Filo, prima della pagina. Prima l'annulla del browser, che toglie
  // proprio la correzione (e quello dopo toglie quel che si era scritto); se non la riporta, la riscrive Filo.
  function annullaColTasto(e) {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || String(e.key || '').toLowerCase() !== 'z') return;
    const el = editabileDellEvento(e);
    const state = el && monitored.get(el);
    if (!state || campoDiTesto(el)) return;
    const u = state.ultimaAutomatica;
    if (!u || getEditableText(el) !== u.testo) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    state.annullando = u;
    try { document.execCommand('undo'); } catch (_) {}
    const ora = getEditableText(el);
    if (ora === u.testoPrima) { if (state.annullando) dopoLAnnulla(state); return; }
    state.annullando = null;
    if (ora !== u.testo) { try { document.execCommand('redo'); } catch (_) {} }
    if (getEditableText(el) === u.testo) annullaAutomatica(el, u.voce);
  }

  // L'annulla subito dopo una correzione automatica (Ctrl/Cmd+Z, e «Annulla» della barra del Mac, che arriva come lo
  // stesso comando) lo fa il browser, che toglie proprio la correzione: così l'annulla dopo toglie quello che si era
  // scritto. Il browser però riseleziona la parola, e il tasto dopo la cancellerebbe: il cursore torna dov'era.
  function primaDellAnnulla(state, e) {
    if (!e || e.inputType !== 'historyUndo') return;
    const u = state.ultimaAutomatica;
    state.annullando = u && getEditableText(state.el) === u.testo ? u : null;
  }
  function dopoLAnnulla(state) {
    const u = state.annullando;
    state.annullando = null;
    const el = state.el;
    if (getEditableText(el) !== u.testoPrima) return;
    mettiCursore(el, u.cursorePrima);
    // Un editor che rimette la selezione dal suo modello (Lexical) lo fa dopo: lì il cursore si rimette una volta ancora.
    setTimeout(() => {
      if (getEditableText(el) === u.testoPrima && cursoreNelCampo(el) !== u.cursorePrima) mettiCursore(el, u.cursorePrima);
    }, 0);
    seguiIlTesto(state);
    rifiutata(state, u.voce);
  }
  function mettiCursore(el, pos) {
    try {
      if (campoDiTesto(el)) { el.setSelectionRange(pos, pos); return; }
      const sel = window.getSelection();
      const r = document.createRange();
      placeCaretAtOffset(el, pos, r);
      sel.removeAllRanges();
      sel.addRange(r);
    } catch (_) {}
  }

  // Una correzione automatica riportata indietro è un rifiuto: quell'occorrenza non si ricorregge, e alla soglia la
  // parola non si corregge più da sé (e, se è una parola che Filo può imparare, non si segna più).
  function rifiutata(state, v) {
    const el = state.el;
    const end = v.start + v.originale.length;
    state.automatiche = state.automatiche.filter((x) => x.id !== v.id);
    state.ultimaAutomatica = null;
    state.rifiutateQui = [...state.rifiutateQui, { id: ++progressivo, start: v.start, end, segment: v.originale }].slice(-AUTOMATICHE_MAX);
    if (A().soloMaiuscole(v.originale, v.segment)) aggiungiStile({ minuscoli: 2, maiuscoli: 0 });
    const parola = v.originale;
    impara({ passo: 'annullata', parola }, (r) => {
      if (r && r.rifiuta && erroriAttivi() && parolaImparabile(parola)) return aggiungiImparata(formaDaImparare(parola, A().inizioDiFrase(getEditableText(el), v.start)));
      return null;
    });
  }

  // La parola corretta da sé sotto il tasto destro, finché è ancora come l'ha messa Filo.
  function automaticaSotto(el, clientX, clientY) {
    const state = el && monitored.get(el);
    if (!state || !state.automatiche.length) return null;
    seguiIlTesto(state);
    const pos = caretCharOffsetFromPoint(el, clientX, clientY);
    if (pos < 0) return null;
    const testo = getEditableText(el);
    const v = state.automatiche.find((x) => pos >= x.start && pos <= x.end && testo.slice(x.start, x.end) === x.segment);
    return v ? { id: v.id, originale: v.originale, corretta: v.segment } : null;
  }

  // Una parola fuori dizionario lasciata com'era: alla soglia Filo la impara e smette di segnarla. Un'occorrenza si conta
  // una volta, e se poi si corregge il conto torna indietro (seguiIlTesto).
  function contaRiscritta(state, w, testo) {
    const parola = w.parola;
    if (parola.replace(/['’-]/g, '').length < 2 || isInDictionary(parola) || nomeNoto(parola)) return;
    if (state.contate.some((x) => x.start === w.start && x.end === w.end)) return;
    if (!parolaImparabile(parola)) return;
    state.contate = [...state.contate, { id: ++progressivo, start: w.start, end: w.end, segment: parola }].slice(-AUTOMATICHE_MAX);
    const inizioFrase = A().inizioDiFrase(testo, w.start);
    impara({ passo: 'riscritta', parola, inizioFrase }, (r) => {
      if (!r || !r.impara) return null;
      state.contate = state.contate.filter((x) => x.segment.toLowerCase() !== parola.toLowerCase());
      return aggiungiImparata(r.impara);
    });
  }

  // Una correzione scelta dall'utente (menu, «Correggi tutti»): alla soglia diventa una sua correzione automatica. Solo
  // per una parola che il dizionario non conosce: «a» → «ha» è giusta lì, e da sé cambierebbe ogni «a» (#1447).
  function accettata(parola, correzione) {
    if (!A() || !sbagliataPerIlBrowser(String(parola || '').replace(/’/g, "'"))) return;
    impara({ passo: 'accettata', parola, correzione }, (r) => {
      if (r && r.impara) return setAutocorrect(r.impara.parola, r.impara.correzione);
      return null;
    });
  }

  // Il lampo caldo sulla parola corretta da sé, che sfuma (token correttore.lampo.*). Sta fuori dallo specchio, dove
  // ogni sfondo è spento.
  function lampo(state, start, end) {
    const el = state.el;
    let righe = [];
    try { righe = [...rangeDelTesto(state, start, end).getClientRects()]; } catch (_) { return; }
    const r = el.getBoundingClientRect();
    const radice = radiceDi(el) || document.body;
    const tema = document.documentElement.dataset.snTheme || '';
    for (const q of righe) {
      const left = Math.max(q.left, r.left);
      const right = Math.min(q.right, r.right);
      const top = Math.max(q.top, r.top);
      const bottom = Math.min(q.bottom, r.bottom);
      if (right - left < 1 || bottom - top < 1) continue;
      const d = document.createElement('div');
      d.className = 'sn-spell-lampo';
      global.SN_FILO_UI?.mark(d);
      d.setAttribute('aria-hidden', 'true');
      d.dataset.snTheme = tema;
      d.style.left = `${left}px`;
      d.style.top = `${top}px`;
      d.style.width = `${right - left}px`;
      d.style.height = `${bottom - top}px`;
      radice.appendChild(d);
      const via = () => d.remove();
      d.addEventListener('animationend', via, { once: true });
      setTimeout(via, 11000);
    }
  }

  // Un Range sul pezzo [start, end) del testo del campo: nella casella sullo specchio, che ne ripete il testo; nel campo
  // modificabile sul testo vero.
  function rangeDelTesto(state, start, end) {
    const el = state.el;
    let radice = el;
    if (campoDiTesto(el)) {
      ensureOverlay(state);
      if (!state.overlay.firstChild || state.overlay.textContent.replace(/\u200b$/, '') !== getEditableText(el)) syncOverlay(state);
      radice = state.overlay;
    }
    const range = document.createRange();
    const w = document.createTreeWalker(radice, NodeFilter.SHOW_TEXT);
    let tot = 0;
    let fatto = 0;
    for (let n = w.nextNode(); n && fatto < 2; n = w.nextNode()) {
      const len = n.nodeValue.length;
      if (!fatto && start < tot + len) { range.setStart(n, start - tot); fatto = 1; }
      if (fatto === 1 && end <= tot + len) { range.setEnd(n, end - tot); fatto = 2; }
      tot += len;
    }
    if (fatto < 2) throw new Error('pezzo fuori dal testo');
    return range;
  }

  // Il Range passato messo al carattere `target` del campo modificabile (non lo aggiunge alla selezione).
  function placeCaretAtOffset(el, target, range) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let cur = 0, n;
    while ((n = walker.nextNode())) {
      const len = n.nodeValue.length;
      if (cur + len >= target) {
        range.setStart(n, Math.max(0, target - cur));
        range.collapse(true);
        return;
      }
      cur += len;
    }
    range.selectNodeContents(el);
    range.collapse(false);
  }

  function contenteditableCaretOffset(el) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return -1;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.endContainer)) return -1;
    let offset = 0;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n === range.endContainer) return offset + range.endOffset;
      offset += n.nodeValue.length;
    }
    return -1;
  }

  // Dove sta il cursore nel testo del campo, solo se non c'è una selezione: -1 altrimenti.
  function cursoreNelCampo(el) {
    try {
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        return el.selectionStart === el.selectionEnd ? (el.selectionStart ?? -1) : -1;
      }
      const sel = window.getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed) return -1;
      return contenteditableCaretOffset(el);
    } catch (_) { return -1; }
  }

  // ============================================================================
  // Quali campi
  // ============================================================================
  // Textarea e campi modificabili, mai <input> (ricerche, password). Del campo modificabile si prende la radice, quella
  // con l'attributo: un figlio (lo <span> di un editor di chat) sballa allineamento e misure.
  function isSupportedEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === 'TEXTAREA') return !el.disabled && !el.readOnly;
    if (typeof el.getAttribute !== 'function') return false;
    const ce = el.getAttribute('contenteditable');
    return ce === '' || ce === 'true' || ce === 'plaintext-only';
  }

  // Dove il sito chiede di non correggere: spellcheck="false" (anche da un antenato), il segno per Grammarly e simili,
  // e gli editor di codice. Niente elenchi di siti.
  const NON_CORREGGERE = '[data-gramm="false"], [data-gramm_editor="false"], [data-enable-grammarly="false"]';
  const EDITOR_DI_CODICE = '.CodeMirror, .cm-editor, .monaco-editor, .ace_editor, .ace_text-input, pre, code';
  function campoEscluso(el) {
    try {
      if (el.spellcheck === false) return true;
      for (let e = el; e && e.nodeType === 1;) {
        if (e.closest(NON_CORREGGERE) || e.closest(EDITOR_DI_CODICE)) return true;
        const r = e.getRootNode();
        e = r && r.host ? r.host : null;
      }
    } catch (_) {}
    return false;
  }

  // Il campo può essere un antenato del bersaglio.
  function findSupportedEditable(el) {
    while (el && el.nodeType === 1) {
      if (isSupportedEditable(el)) return campoEscluso(el) ? null : el;
      el = el.parentElement;
    }
    return null;
  }

  // Da un riquadro chiuso di Filo (feedback, spiegazione) il focus arriva all'host: il campo vero lo sa SN_FILO_UI,
  // e l'overlay sta dentro lo stesso riquadro, perché ripete il testo e nel documento del sito lo leggerebbe (#1071).
  // Dentro il componente aperto di un sito il fuoco arriva all'host: il campo vero è il primo del cammino dell'evento.
  function editabileDellEvento(e) {
    const UI = global.SN_FILO_UI;
    const tg = e && e.target;
    const riquadro = !!(UI && UI.bersaglio && tg && tg.hasAttribute && tg.hasAttribute(UI.RIQUADRO));
    if (riquadro) return findSupportedEditable(UI.bersaglio(e));
    let vero = tg;
    try { const via = typeof e.composedPath === 'function' ? e.composedPath() : null; if (via && via[0] && via[0].nodeType === 1) vero = via[0]; } catch (_) {}
    return findSupportedEditable(vero);
  }
  function radiceDi(el) {
    try {
      const r = el.getRootNode();
      const UI = global.SN_FILO_UI;
      if (r && r !== document && r.host && UI && r.host.hasAttribute(UI.RIQUADRO)) return r;
    } catch (_) {}
    return null;
  }

  // ============================================================================
  // Fuoco
  // ============================================================================
  function onFocusIn(e) {
    if (!attivo()) return;
    const el = editabileDellEvento(e);
    if (!el) return;
    attach(el);
    rileggiMemorie();
  }

  // Dizionario, correzioni e quello che Filo ha imparato si rileggono anche tornando a scrivere: una spinta persa (la
  // scheda nata dopo il cambio, un riquadro) non lascia la pagina indietro.
  let rilettaAlle = 0;
  async function rileggiMemorie() {
    const ora = Date.now();
    if (ora - rilettaAlle < 500) return;
    rilettaAlle = ora;
    await Promise.all([loadDictionary(), loadAutocorrect(), caricaImparato()]);
    const state = activeEl && monitored.get(activeEl);
    if (state && state.attivo) aggiornaCodice(state);
  }

  function usaMemorie(m) {
    if (Array.isArray(m.sn_personal_dict)) usaDizionario(m.sn_personal_dict);
    if (m.sn_autocorrect && typeof m.sn_autocorrect === 'object' && !Array.isArray(m.sn_autocorrect)) autocorrectMap = m.sn_autocorrect;
    if (Array.isArray(m.rifiutate) && A()) imparato = { ...(imparato || A().memoria(null)), rifiutate: m.rifiutate.map(String) };
    const state = activeEl && monitored.get(activeEl);
    if (state && state.attivo) aggiornaCodice(state);
  }

  // Il campo che ha già il fuoco quando il correttore parte o si accende (autofocus, la chat di casa): il suo focusin
  // è passato prima che ci fosse chi lo ascolta.
  function adottaIlFuoco() {
    if (!attivo()) return;
    let el = document.activeElement;
    try { while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement; } catch (_) {}
    const campo = findSupportedEditable(el);
    if (!campo || campo === activeEl) return;
    attach(campo);
    rileggiMemorie();
  }

  function onFocusOut(e) {
    const el = editabileDellEvento(e);
    if (!el) return;
    // L'overlay resta mentre si usa il menu del tasto destro, che col clic sposterebbe il fuoco.
    setTimeout(() => {
      if ((radiceDi(el) || document).activeElement === el) return;
      detach(el);
    }, 200);
  }

  function statoDi(el) {
    let state = monitored.get(el);
    if (state) return state;
    state = {
      el, overlay: null, ro: null, attivo: false, riquadro: null,
      // I segni del modello, sulle posizioni di `testo` (il testo del campo); quelli del codice si ricalcolano.
      testo: '', modello: [], codice: [], codiceT2: [], codiceTesto: null,
      // Il testo già giudicato da ciascun controllo, senza le parti ancora da giudicare (correttoreRegole.daGiudicare).
      baseRapido: '', baseRagionato: '',
      verdetti: new Map(), ignorate: new Map(), richiesti: new Set(), inViaggio: [], ascoltatori: new Set(),
      timerRapido: null, timerFine: null, timerRagionato: null, timerCodice: null, timerPassaggio: null,
      cambioDa: 0, ultimoTasto: 0, inviatiRapido: 0, inviatiRagionato: 0, restaParola: false,
      rimandati: new Set(), inVista: [],
      // I valori dei segnaposti sopra le x e i lampi dei valori appena messi (#1448), in uno strato che riceve il mouse.
      valori: null, badge: new Map(), lampi: [],
      // I testi giudicati per intero, coi segni che ne erano usciti: un annulla che ci torna non ripaga (#1097.5).
      giudicati: { rapido: new Map(), ragionato: new Map() },
      // La correzione automatica (#1447), sulle posizioni del testo come i segni: le parole corrette da sé, l'ultima
      // (che l'annulla subito dopo riporta indietro), quelle riportate indietro e le parole contate per impararle.
      automatiche: [], ultimaAutomatica: null, annullando: null, rifiutateQui: [], contate: [],
    };
    monitored.set(el, state);
    return state;
  }

  function attach(el) {
    const state = statoDi(el);
    if (!ascoltate.has(el)) {
      ascoltate.add(el);
      el.addEventListener('input', (e) => { const vivo = monitored.get(el); if (vivo && vivo.attivo) suInput(vivo, e); });
      // Prima del tasto si vede la casella che la chat ha svuotato da sé all'invio, senza un input: il messaggio partito
      // dice come si scrive qui (seguiIlTesto).
      el.addEventListener('beforeinput', (e) => {
        const vivo = monitored.get(el);
        if (!vivo) return;
        if (vivo.attivo) seguiIlTesto(vivo);
        primaDellAnnulla(vivo, e);
      }, true);
      el.addEventListener('scroll', () => { const vivo = monitored.get(el); if (vivo && vivo.attivo) syncOverlay(vivo); });
    }
    if (!state.ro) {
      try {
        state.ro = new ResizeObserver(() => syncOverlay(state));
        state.ro.observe(el);
      } catch (_) {}
    }
    state.attivo = true;
    activeEl = el;
    ensureOverlay(state);
    seguiIlTesto(state);
    aggiornaCodice(state, { senzaDisegno: true });
    syncOverlay(state);
    // Il fuoco lo dà anche un focus() di script: il testo che c'è già si controlla solo se ci è entrato l'utente, col
    // mouse sulla casella o con Tab (che cade sul campo di prima: la casella la riceve solo al rilascio).
    const tab = (l) => l.tasto === 'Tab';
    if (prendeGesto(state, tab)) programmaRapido(state, { gesto: true });
    if (prendeGesto(state, tab, 'coerenza')) programmaRagionato(state, { gesto: true });
  }

  function detach(el) {
    const state = monitored.get(el);
    if (!state) return;
    fermaTimer(state, ['timerRapido', 'timerFine', 'timerRagionato', 'timerCodice', 'timerPassaggio']);
    state.rimandati.clear();
    if (state.overlay) { state.overlay.remove(); state.overlay = null; }
    if (state.valori) { state.valori.remove(); state.valori = null; state.badge.clear(); }
    if (state.ro) { try { state.ro.disconnect(); } catch (_) {} state.ro = null; }
    state.attivo = false;
    if (activeEl === el) activeEl = null;
    lasciaProposte(el);
  }

  function detachAll() {
    if (activeEl) detach(activeEl);
  }

  function suInput(state, evento) {
    if (state.annullando && evento && evento.inputType === 'historyUndo') dopoLAnnulla(state);
    fineParolaBattuta(state, evento);
    state.ultimoTasto = Date.now();
    seguiIlTesto(state);
    // Il testo l'ha cambiato uno script, non l'utente (#1070): niente chiamate al modello. Quella già chiesta da un
    // gesto (un tasto tenuto premuto) si sposta soltanto: resta una, sul testo finale.
    const gesto = prendeGesto(state);
    const nuovo = aggiornaCodice(state);
    // Il controllo che non aspetta la pausa lo paga solo il tasto che chiude una parola, come una volta quello della
    // parola: una pagina che a ogni lettera scrive una parola sbagliata ne otterrebbe uno per tasto (#1070).
    const G = global.SN_GESTO;
    const chiude = nuovo && !!G && G.prendi('parola', G.CHIUDE, G.dentro(state.el));
    programmaRapido(state, { gesto: gesto || chiude, subito: chiude });
    programmaRagionato(state, { gesto: prendeGesto(state, null, 'coerenza'), fineFrase: chiudeFrase(state, evento) });
    programmaFine(state);
  }

  // Solo un gesto vero caduto dentro la casella apre una chiamata al modello, e una volta sola: `input` e `focus` li
  // fabbrica anche la pagina (#1070). I due controlli prendono il gesto ognuno per sé (`chi`).
  function prendeGesto(state, oppure, chi = 'correttore') {
    const G = global.SN_GESTO;
    if (!G) return false;
    const qui = G.dentro(state.el);
    return G.prendi(chi, undefined, oppure ? (l) => qui(l) || oppure(l) : qui);
  }

  // Un tasto che chiude una frase: punto, punto esclamativo o interrogativo, Invio (che in un campo modificabile apre un
  // paragrafo invece di scrivere un a capo).
  function chiudeFrase(state, evento) {
    const tipo = evento && evento.inputType;
    if (tipo === 'insertParagraph' || tipo === 'insertLineBreak') return true;
    const testo = getEditableText(state.el);
    const pos = cursoreNelCampo(state.el);
    return pos > 0 && /[.!?…\n]/.test(testo[pos - 1] || '');
  }

  // ============================================================================
  // Lo strato dei segni
  // ============================================================================
  // Stili copiati dall'editabile per allineare il testo invisibile dell'overlay.
  const COPIED_STYLE_PROPS = [
    'font-family', 'font-size', 'font-weight', 'font-style',
    'letter-spacing', 'word-spacing', 'text-transform', 'text-indent',
    'text-align', 'line-height', 'white-space', 'word-break', 'overflow-wrap',
    'tab-size', 'direction',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'box-sizing',
  ];

  function ensureOverlay(state) {
    if (state.overlay && state.overlay.isConnected) return;
    const o = document.createElement('div');
    o.className = 'sn-spell-overlay';
    global.SN_FILO_UI?.mark(o);
    o.setAttribute('aria-hidden', 'true');
    (radiceDi(state.el) || document.body).appendChild(o);
    state.overlay = o;
  }

  const SPORGENZA_SEGNI = 8;

  function syncOverlay(state) {
    const o = state.overlay;
    const el = state.el;
    if (!o || !el || !el.isConnected) return;

    const cs = window.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    state.riquadro = { left: r.left, top: r.top, width: r.width, height: r.height };

    o.style.position = 'fixed';
    o.style.left = r.left + 'px';
    o.style.top = r.top + 'px';
    o.style.width = r.width + 'px';
    o.style.height = r.height + 'px';
    o.style.zIndex = '2147483646';
    o.style.pointerEvents = 'none';
    o.style.overflow = 'hidden';
    o.style.color = 'transparent';
    o.style.background = 'transparent';
    o.style.margin = '0';
    o.style.borderColor = 'transparent';
    o.style.borderStyle = cs.borderStyle || 'solid';
    o.dataset.snTheme = document.documentElement.dataset.snTheme || '';

    for (const p of COPIED_STYLE_PROPS) {
      o.style.setProperty(p, cs.getPropertyValue(p));
    }
    // Lo specchio deve andare a capo come la casella: larghezza e altezza qui sopra sono del bordo esterno, e la barra
    // di scorrimento della casella toglie spazio al testo che lo specchio (senza barra) avrebbe in più.
    o.style.boxSizing = 'border-box';
    const px = (p) => parseFloat(cs.getPropertyValue(p)) || 0;
    const barraV = Math.max(0, el.offsetWidth - el.clientWidth - px('border-left-width') - px('border-right-width'));
    const barraO = Math.max(0, el.offsetHeight - el.clientHeight - px('border-top-width') - px('border-bottom-width'));
    const latoBarra = cs.direction === 'rtl' ? 'padding-left' : 'padding-right';
    if (barraV) o.style.setProperty(latoBarra, `${px(latoBarra) + barraV}px`);
    // Sotto l'ultima riga di una casella piena c'è solo il suo margine interno: i segni stanno qualche pixel più giù del
    // testo, e lo specchio li lascia sporgere sotto il bordo invece di tagliarli (altezza e margine crescono insieme).
    o.style.height = (r.height + SPORGENZA_SEGNI) + 'px';
    o.style.setProperty('padding-bottom', `${px('padding-bottom') + barraO + SPORGENZA_SEGNI}px`);

    renderOverlayContent(state);
  }

  // Svuotare e riempire lo specchio lo riporta in cima: ogni disegno riprende lo scorrimento della casella. Sul campo
  // modificabile i segni sono già dove si vedono le parole: lo specchio non scorre.
  function allineaScorrimento(state) {
    const o = state.overlay;
    if (!o || !state.el) return;
    const scorre = campoDiTesto(state.el);
    o.scrollTop = scorre ? state.el.scrollTop : 0;
    o.scrollLeft = scorre ? state.el.scrollLeft : 0;
  }

  const campoDiTesto = (el) => el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';

  let syncQueued = false;
  function queueSync() {
    if (syncQueued || !activeEl) return;
    syncQueued = true;
    requestAnimationFrame(() => {
      syncQueued = false;
      const state = monitored.get(activeEl);
      if (state) syncOverlay(state);
    });
  }

  function getEditableText(el) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value;
    return el.textContent || '';
  }

  // Il testo che va ai controlli: in un campo modificabile le righe sono paragrafi, <div> e <br>, che textContent
  // attacca («Ciao Marcosì»). Qui hanno il loro a capo; `riporta` rimette i segni sulle posizioni di getEditableText,
  // su cui si disegna e si corregge, e `verso` porta una posizione del campo in quel testo.
  function testoDaControllare(el) {
    if (campoDiTesto(el)) return { testo: getEditableText(el), riporta: (lista) => lista, verso: (p) => p };
    let testo = '';
    let pos = 0;
    let serveACapo = false;
    const bordi = [0];
    const aCapo = () => { testo += '\n'; bordi.push(pos); serveACapo = false; };
    const visita = (n) => {
      if (n.nodeType === 3) {
        const v = n.nodeValue;
        if (!v) return;
        if (serveACapo && testo && !testo.endsWith('\n')) aCapo();
        serveACapo = false;
        for (let i = 0; i < v.length; i++) { pos++; bordi.push(pos); }
        testo += v;
        return;
      }
      if (n.nodeType !== 1) return;
      if (n.tagName === 'BR') {
        if (serveACapo && testo && !testo.endsWith('\n')) aCapo();
        aCapo();
        return;
      }
      const blocco = !/^inline/.test((n.ownerDocument.defaultView || window).getComputedStyle(n).display);
      if (blocco) serveACapo = true;
      for (const c of n.childNodes) visita(c);
      if (blocco) serveACapo = true;
    };
    for (const c of el.childNodes) visita(c);
    const campo = getEditableText(el);
    const riporta = (lista) => lista.map((it) => {
      const start = bordi[it.start];
      const end = bordi[it.end];
      return 'segment' in it ? { ...it, start, end, segment: campo.slice(start, end) } : { ...it, start, end };
    }).filter((it) => it.end > it.start);
    const verso = (p) => {
      if (typeof p !== 'number' || p < 0) return -1;
      let lo = 0;
      let hi = bordi.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (bordi[mid] <= p) lo = mid; else hi = mid - 1;
      }
      return lo;
    };
    return { testo, riporta, verso };
  }

  function renderOverlayContent(state) {
    state.inVista = segniInVista(state);
    disegnaSpecchio(state);
    allineaScorrimento(state);
    disegnaValori(state);
    seguiIlCampo();
    passaggiInCorso(state);
    allineaProposte(state);
  }

  // Un segno che si conferma o sparisce, o un lampo, è a metà del suo passaggio: alla fine lo strato si ridisegna senza.
  function passaggiInCorso(state) {
    if (state.timerPassaggio) return;
    const ora = Date.now();
    const resto = [...state.inVista, ...state.lampi].reduce((m, s) => {
      const durata = s.lampo ? LAMPO_MS : PASSAGGIO_MS;
      const da = s.svanisce || s.confermatoAlle || s.lampo || 0;
      return da && ora - da < durata ? Math.max(m, durata - (ora - da)) : m;
    }, 0);
    if (!resto) return;
    state.timerPassaggio = setTimeout(() => {
      state.timerPassaggio = null;
      if (state.attivo) renderOverlayContent(state);
    }, resto + 20);
  }

  // ── I contatori del correttore (#1461) ──────────────────────────────────────
  // Ogni proposta mostrata finisce una volta accettata, rifiutata o ignorata. Escono tipo, modello ed esito; la parola
  // e la frase restano qui, nelle chiavi locali. Un candidato sbiadito diventa una proposta quando è giudicato.
  const proposte = new WeakMap(); // el → Map(chiave → { tipo, modello, segno })
  function contaProposta(tipo, modello, esito) {
    try { global.SN_POPUP && global.SN_POPUP.conta({ misura: 'proposta', tipo, modello: String(modello || ''), esito }); } catch (_) {}
  }
  function aperteDi(el) {
    let m = proposte.get(el);
    if (!m) { m = new Map(); proposte.set(el, m); }
    return m;
  }
  const tipoDelSegno = (s) => (s.segno === 'suggerimento' ? 'suggerimento' : (/\s/.test(String(s.segment || '').trim()) ? 'frase' : 'ortografia'));
  function chiaveSegno(s) { return `${(s && s.segno) || ''}|${(s && s.segment) || ''}`; }
  function modelloDelSegno(state, s) {
    const da = s.fonte === 'rapido' || s.fonte === 'ragionato' ? s.fonte : s.giudicatoDa;
    if (da === 'rapido') return state.modelloRapido || '';
    if (da === 'ragionato') return state.modelloRagionato || '';
    return 'locale';
  }
  const propostaVera = (s) => !s.svanisce && (!s.dubbio || (s.segno === 'errore' && !modelloErrori()));
  function propostaMostrata(el, tipo, chiave, modello) {
    if (!el) return;
    const m = aperteDi(el);
    const k = `${tipo}|${chiave}`;
    if (m.has(k)) { if (modello) m.get(k).modello = modello; return; }
    m.set(k, { tipo, modello });
    contaProposta(tipo, modello, 'mostrata');
  }
  function esitoProposta(el, tipo, chiave, esito) {
    const m = el && proposte.get(el);
    const k = `${tipo}|${chiave}`;
    const p = m && m.get(k);
    if (!p) return false;
    m.delete(k);
    contaProposta(p.tipo, p.modello, esito);
    return true;
  }
  function esitoSegno(el, segno, esito) { return !!segno && esitoProposta(el, tipoDelSegno(segno), chiaveSegno(segno), esito); }
  // I segni in vista adesso: i nuovi sono mostrati, quelli spariti senza una scelta ignorati. Uno nascosto solo perché
  // il cursore sta sulla sua parola (un tasto destro appena dopo aver scritto) c'è ancora.
  function allineaProposte(state) {
    if (!state || !state.el || !R()) return;
    const vive = new Map();
    for (const s of segniInVista(state, { ignoraScrittura: true })) {
      if (!propostaVera(s)) continue;
      const tipo = tipoDelSegno(s);
      vive.set(`${tipo}|${chiaveSegno(s)}`, { tipo, modello: modelloDelSegno(state, s), segno: true });
    }
    const m = aperteDi(state.el);
    for (const [k, p] of m) {
      if (p.segno && !vive.has(k)) { m.delete(k); contaProposta(p.tipo, p.modello, 'ignorata'); }
    }
    for (const [k, p] of vive) if (!m.has(k)) { m.set(k, p); contaProposta(p.tipo, p.modello, 'mostrata'); }
  }
  function lasciaProposte(el) {
    const m = proposte.get(el);
    if (!m) return;
    for (const p of m.values()) contaProposta(p.tipo, p.modello, 'ignorata');
    proposte.delete(el);
  }

  // La pagina può spostare il campo senza scorrere né ridimensionare (un avviso che compare sopra, un riquadro che si
  // apre): finché il campo attivo ha segni, a ogni fotogramma il suo riquadro si confronta con quello dell'ultimo disegno.
  // Anche il testo: una chat che svuota la casella da script all'invio non manda input, e lo strato terrebbe il vecchio.
  const SEGUI_TESTO_DOPO_TASTO_MS = 10000;
  let seguendo = false;
  function seguiIlCampo() {
    if (seguendo) return;
    seguendo = true;
    const giro = () => {
      const state = activeEl && monitored.get(activeEl);
      const specchioPieno = !!(state && state.overlay && state.overlay.textContent)
        && Date.now() - state.ultimoTasto < SEGUI_TESTO_DOPO_TASTO_MS;
      if (!state || !state.overlay || !state.el.isConnected || (!state.inVista.length && !specchioPieno)) {
        seguendo = false;
        return;
      }
      if (getEditableText(state.el) !== state.testo) {
        seguiIlTesto(state);
        aggiornaCodice(state);
        requestAnimationFrame(giro);
        return;
      }
      const r = state.el.getBoundingClientRect();
      const u = state.riquadro;
      if (!u || r.left !== u.left || r.top !== u.top || r.width !== u.width || r.height !== u.height) syncOverlay(state);
      requestAnimationFrame(giro);
    };
    requestAnimationFrame(giro);
  }

  // Le classi di un segno: il suo tipo, il dubbio sbiadito, e il passaggio breve di una conferma o di uno scarto.
  function classiDi(s, ora) {
    const k = [s.segno === 'errore' ? 'sn-errore' : 'sn-suggerimento'];
    if (s.dubbio) k.push('sn-dubbio');
    if (s.svanisce) k.push('sn-svanisce');
    else if (s.confermatoAlle && ora - s.confermatoAlle < PASSAGGIO_MS) k.push('sn-conferma');
    return k.join(' ');
  }
  function ritardoDi(s, ora) {
    const da = s.svanisce || (s.confermatoAlle && ora - s.confermatoAlle < PASSAGGIO_MS ? s.confermatoAlle : 0);
    return da ? -(ora - da) : 0;
  }

  // Un pezzo di testo coi segni che lo coprono: fuori i puntini del suggerimento, dentro l'onda dell'errore, così sulla
  // stessa parola convivono. `nodo` è il testo (o lo span con il font della pagina) da avvolgere.
  function avvolgi(nodo, coprono, ora) {
    for (const k of ['errore', 'suggerimento']) {
      const s = coprono.find((x) => x.segno === k);
      if (!s) continue;
      const span = document.createElement('span');
      span.className = classiDi(s, ora);
      const ritardo = ritardoDi(s, ora);
      if (ritardo) span.style.animationDelay = `${ritardo}ms`;
      span.appendChild(nodo);
      nodo = span;
    }
    return nodo;
  }

  // Il tratto da disegnare di un segno: senza gli spazi ai bordi (« il» ripetuto si sottolinea sotto «il»).
  function tratto(testo, s) {
    let a = s.start;
    let b = s.end;
    while (a < b && /\s/.test(testo[a])) a++;
    while (b > a && /\s/.test(testo[b - 1])) b--;
    return b > a ? { a, b } : null;
  }

  function disegnaSpecchio(state) {
    const o = state.overlay;
    if (!o) return;
    const text = getEditableText(state.el);
    if (!text) { o.textContent = ''; return; }
    const ora = Date.now();
    const segni = state.inVista.map((s) => ({ s, t: tratto(text, s) })).filter((x) => x.t)
      .map(({ s, t: tr }) => ({ ...s, da: tr.a, a: tr.b }));
    if (!campoDiTesto(state.el)) { disegnaSulCampo(state, segni, ora); return; }

    // Un a capo in fondo è una riga nella casella ma non nello specchio: senza, lo specchio è più basso e lo scorrimento
    // si ferma una riga prima.
    const coda = /\n$/.test(text) && (state.el.tagName === 'TEXTAREA') ? '​' : '';
    if (!segni.length) { o.textContent = text + coda; return; }

    const bordi = [...new Set([0, text.length, ...segni.flatMap((s) => [s.da, s.a])])].sort((x, y) => x - y);
    const frag = document.createDocumentFragment();
    for (let k = 0; k + 1 < bordi.length; k++) {
      const a = bordi[k];
      const b = bordi[k + 1];
      const pezzo = text.slice(a, b);
      const coprono = segni.filter((s) => s.da <= a && s.a >= b);
      frag.appendChild(coprono.length ? avvolgi(document.createTextNode(pezzo), coprono, ora) : document.createTextNode(pezzo));
    }
    if (coda) frag.appendChild(document.createTextNode(coda));
    o.innerHTML = '';
    o.appendChild(frag);
  }

  // Un campo modificabile si impagina con lo stile della pagina (margini e interlinea dei paragrafi, righe nuove,
  // scorrimento): una copia lo rincorre una proprietà alla volta. I segni si misurano sulle parole vere del campo, un
  // riquadro per riga, col font del loro testo; si ridisegnano a ogni scorrimento e ridimensionamento (syncOverlay).
  const FONT_DEL_TESTO = ['font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variant',
    'font-feature-settings', 'font-variation-settings', 'font-kerning', 'letter-spacing', 'word-spacing', 'text-transform',
    'direction'];

  function disegnaSulCampo(state, segni, ora) {
    const o = state.overlay;
    o.innerHTML = '';
    if (!segni.length) return;
    const nodi = [];
    const w = document.createTreeWalker(state.el, NodeFilter.SHOW_TEXT);
    let tot = 0;
    for (let n = w.nextNode(); n; n = w.nextNode()) { nodi.push({ n, da: tot }); tot += n.nodeValue.length; }
    const base = o.getBoundingClientRect();
    const ox = base.left + o.clientLeft;
    const oy = base.top + o.clientTop;
    const range = document.createRange();
    const frag = document.createDocumentFragment();
    const bordi = [...new Set(segni.flatMap((s) => [s.da, s.a]))].sort((x, y) => x - y);
    for (let k = 0; k + 1 < bordi.length; k++) {
      const a = bordi[k];
      const b = bordi[k + 1];
      const coprono = segni.filter((s) => s.da <= a && s.a >= b);
      if (!coprono.length) continue;
      for (const { n, da } of nodi) {
        const fine = da + n.nodeValue.length;
        if (fine <= a || da >= b) continue;
        for (const riga of righeDelPezzo(range, n, Math.max(a, da) - da, Math.min(b, fine) - da)) {
          frag.appendChild(riquadroDelSegno(n, riga, coprono, ox, oy, ora));
        }
      }
    }
    o.appendChild(frag);
  }

  // Le righe su cui il pezzo [s, e) del nodo di testo va a capo, carattere per carattere: { s, e, left, top, height }.
  function righeDelPezzo(range, n, s, e) {
    const v = n.nodeValue;
    const righe = [];
    let cur = null;
    for (let i = s; i < e;) {
      const j = Math.min(e, i + (/[\uD800-\uDBFF]/.test(v[i]) ? 2 : 1));
      range.setStart(n, i);
      range.setEnd(n, j);
      const q = range.getBoundingClientRect();
      if (q.width || q.height) {
        if (!cur || Math.abs(q.top - cur.top) > q.height / 2) {
          cur = { s: i, e: j, left: q.left, top: q.top, height: q.height };
          righe.push(cur);
        } else {
          cur.e = j;
          cur.left = Math.min(cur.left, q.left);
        }
      }
      i = j;
    }
    return righe;
  }

  function riquadroDelSegno(n, riga, coprono, ox, oy, ora) {
    const cs = window.getComputedStyle(n.parentElement);
    const box = document.createElement('div');
    // L'interlinea alta quanto il testo: il pezzo sta dove sta la parola, senza mezza interlinea sopra.
    box.style.cssText = `position:absolute;left:${riga.left - ox}px;top:${riga.top - oy}px;margin:0;padding:0;border:0;`
      + `white-space:pre;text-indent:0;text-align:left;line-height:${riga.height}px;`;
    const testo = document.createElement('span');
    // Anche sul pezzo: una regola della pagina sugli span non deve cambiargli il font.
    for (const p of FONT_DEL_TESTO) for (const e of [box, testo]) e.style.setProperty(p, cs.getPropertyValue(p));
    testo.textContent = n.nodeValue.slice(riga.s, riga.e).replace(/\s+$/, '');
    box.appendChild(avvolgi(testo, coprono, ora));
    return box;
  }

  // ============================================================================
  // I segni
  // ============================================================================
  // Chi cambia il testo perde i segni del modello che il cambio tocca: gli altri restano dov'erano finché un controllo
  // non li rinnova (#1111), sugli offset giusti per «Correggi».
  function seguiIlTesto(state) {
    const ora = getEditableText(state.el);
    if (ora === state.testo) return;
    const prima = state.testo;
    state.testo = ora;
    // La casella svuotata (il messaggio è partito) chiude il testo a cui valevano gli «Ignora», e dice come si scrive
    // in questa pagina.
    if (!ora.trim()) {
      state.ignorate.clear();
      if (prima.trim() && A()) ricordaStile(state, prima);
      state.automatiche = [];
      state.rifiutateQui = [];
      state.contate = [];
      state.ultimaAutomatica = null;
    }
    if (state.modello.length) state.modello = riallineaIssues(state.modello, prima, ora).issues;
    if (state.lampi.length) state.lampi = riallineaIssues(state.lampi, prima, ora).issues;
    if (state.automatiche.length) state.automatiche = riallineaIssues(state.automatiche, prima, ora).issues;
    if (state.rifiutateQui.length) state.rifiutateQui = riallineaIssues(state.rifiutateQui, prima, ora).issues;
    // Una parola contata che cambia è stata corretta: il suo conto torna indietro.
    if (state.contate.length) {
      const restano = riallineaIssues(state.contate, prima, ora).issues;
      const vive = new Set(restano.map((x) => x.id));
      for (const x of state.contate) if (!vive.has(x.id)) impara({ passo: 'corretta', parola: x.segment });
      state.contate = restano;
    }
    // Il pezzo di un controllo in viaggio segue il testo come un segno: la risposta rinnova i segni di quel pezzo. Anche
    // il suo testo nuovo, se è più stretto del pezzo (il ragionato rilegge tutto).
    if (state.inViaggio.length) {
      const vivi = new Map(riallineaIssues(state.inViaggio, prima, ora).issues.map((v) => [v.id, v]));
      for (const v of state.inViaggio) {
        const n = vivi.get(v.id);
        if (n) { v.start = n.start; v.end = n.end; } else v.perso = true;
        if (v.nuovo) v.nuovo = riallineaIssues([v.nuovo], prima, ora).issues[0] || null;
      }
    }
  }

  // Prima del cambio resta, dopo scorre; chi tocca il cambio, o la cui parola il cambio allunga o fonde con un'altra
  // (un bordo che passa da separatore a lettera), si perde.
  function riallineaIssues(issues, vecchio, nuovo) {
    const lista = Array.isArray(issues) ? issues : [];
    vecchio = String(vecchio ?? '');
    nuovo = String(nuovo ?? '');
    if (!lista.length || vecchio === nuovo) return { issues: lista, perse: false };
    const corto = Math.min(vecchio.length, nuovo.length);
    let p = 0;
    while (p < corto && vecchio[p] === nuovo[p]) p++;
    let s = 0;
    while (s < corto - p && vecchio[vecchio.length - 1 - s] === nuovo[nuovo.length - 1 - s]) s++;
    const fineCambio = vecchio.length - s;
    const delta = nuovo.length - vecchio.length;
    const out = [];
    for (const it of lista) {
      let da;
      if (it.end <= p) da = it.start;
      else if (it.start >= fineCambio) da = it.start + delta;
      else continue;
      const a = da + (it.end - it.start);
      if (isWordCharLocal(vecchio[it.start - 1]) !== isWordCharLocal(nuovo[da - 1])) continue;
      if (isWordCharLocal(vecchio[it.end]) !== isWordCharLocal(nuovo[a])) continue;
      out.push(da === it.start ? it : { ...it, start: da, end: a });
    }
    return { issues: out, perse: out.length !== lista.length };
  }

  // Una data impossibile è sbagliata comunque, come un errore fisso (correttoreRegole.CERTO).
  const segnoDaData = (d) => ({
    ...d, segno: 'suggerimento', ...R().CERTO, fonte: 'data', tipo: 'data', motivo: d.spiegazione || '',
    correzioni: Array.isArray(d.correzioni) ? d.correzioni : [], citazione: '',
  });

  // I candidati del codice sul testo di adesso: subito e gratis; quelli in dubbio aspettano un controllo che li giudichi.
  // Vero se ce n'è uno nuovo da far giudicare: il controllo rapido parte senza aspettare la pausa.
  function aggiornaCodice(state, { senzaDisegno = false } = {}) {
    const el = state.el;
    if (!senzaDisegno && getEditableText(el).length > LUNGO) {
      if (!state.timerCodice) {
        state.timerCodice = setTimeout(() => {
          state.timerCodice = null;
          if (!state.attivo) return;
          if (calcolaCodice(state) && state.timerRapido) programmaRapido(state, { subito: true });
          renderOverlayContent(state);
        }, RICALCOLO_LUNGO_MS);
      }
      renderOverlayContent(state);
      return false;
    }
    const nuovo = calcolaCodice(state);
    if (!senzaDisegno) renderOverlayContent(state);
    return nuovo;
  }

  function calcolaCodice(state) {
    const d = testoDaControllare(state.el);
    const Rg = R();
    if (!Rg) { state.codice = []; return false; }
    // Le x di un segnaposto non sono una parola sbagliata: il dizionario non le propone al controllo rapido.
    const segnaposti = segnapostiAttivi() ? Rg.segnaposti(d.testo) : [];
    const libero = (c) => !segnaposti.some((s) => c.start < s.end && c.end > s.start);
    const pareri = erroriAttivi() ? pareriDelTesto(d.testo) : null;
    const errori = pareri ? Rg.senzaSovrapposti([
      ...Rg.erroriFissi(d.testo),
      ...(ripetizioniAttive() ? Rg.ripetizioni(d.testo) : []),
      ...Rg.candidatiDizionario(d.testo, {
        sbagliata: (p) => (pareri.has(p) ? pareri.get(p) : sbagliataPerIlBrowser(p)),
        nota: (p) => isInDictionary(p) || nomeNoto(p) || verdetto(state, { fonte: 'dizionario', segment: p })?.stato === 'scartato',
      }),
    ]).filter(libero) : [];
    const date = suggerimentiAttivi() ? Coerenza().dateDi(d.testo, new Date()).map(segnoDaData) : [];
    state.codiceTesto = d.testo;
    state.codiceT2 = [...errori, ...date, ...segnaposti];
    state.codice = d.riporta(state.codiceT2);
    const scrive = inScritturaNelCampo(state);
    return state.codice.some((c) => c.segno === 'errore' && c.dubbio && !verdetto(state, c) && !state.richiesti.has(Rg.chiaveVerdetto(c))
      && !(scrive && c.start < scrive.end && c.end > scrive.start));
  }

  function verdetto(state, c) {
    const v = state.verdetti.get(R().chiaveVerdetto(c));
    // Spenta la parte del modello degli errori, i suoi giudizi tornano dubbi: resta il solo codice.
    if (!v || (v.da === 'rapido' && !modelloErrori())) return null;
    return v;
  }

  // La parola su cui si sta scrivendo: non si segna e non si manda, finché la pausa non dice che è finita.
  function inScritturaNelCampo(state) {
    if (!state.attivo || Date.now() - state.ultimoTasto >= tempi().pausaRagionatoMs) return null;
    const testo = getEditableText(state.el);
    return R().parolaAlCursore(testo, cursoreNelCampo(state.el));
  }
  function inScritturaNelTesto(state, d) {
    const w = inScritturaNelCampo(state);
    if (!w) return null;
    return { start: d.verso(w.start), end: d.verso(w.end) };
  }

  const chiaveIgnora = (s) => ({ fonte: s.segno, tipo: s.segno, segment: s.segment });
  function ignorato(state, s, testo) {
    if (!state.ignorate.size) return false;
    const C = Coerenza();
    const lista = [...state.ignorate.values()];
    if (C) return C.ignorato({ ...s, fonte: s.segno, tipo: s.segno }, lista, testo);
    return lista.some((ig) => ig.fonte === s.segno && ig.segment === s.segment);
  }

  // I segni da disegnare: errori e suggerimenti, del modello e del codice coi loro giudizi. Fra due che si coprono vince
  // quello del modello, poi un candidato sicuro o confermato, poi uno ancora in dubbio. Un candidato che `attende` non
  // si vede finché il modello non lo conferma; spenta la parte del modello non c'è niente da aspettare, e si vede sbiadito.
  function segniInVista(state, { ignoraScrittura = false } = {}) {
    const el = state.el;
    const testo = getEditableText(el);
    const ora = Date.now();
    const scrive = ignoraScrittura ? null : inScritturaNelCampo(state);
    const Rg = R();
    if (!Rg) return [];
    const nascosto = (c) => c.attende && modelloErrori();
    const codice = [];
    for (const c of state.codice) {
      if (c.fonte === 'segnaposto' && !segnapostiAttivi()) continue;
      const v = verdetto(state, c);
      if (!v) { if (!nascosto(c)) codice.push(c); continue; }
      if (v.stato === 'scartato') {
        if (ora - v.alle < PASSAGGIO_MS && !nascosto(c)) codice.push({ ...c, svanisce: v.alle });
        continue;
      }
      codice.push({
        ...c, dubbio: false, confermatoAlle: v.alle, giudicatoDa: v.da, motivo: v.motivo || c.motivo,
        correzioni: v.correzioni && v.correzioni.length ? v.correzioni : c.correzioni, citazione: v.citazione || c.citazione,
      });
    }
    const delModello = state.modello
      .filter((m) => (m.fonte === 'rapido' ? modelloErrori() : (m.tipo === 'segnaposto' ? segnapostiAttivi() : suggerimentiAttivi())))
      .map(conRicerca);
    const valido = (x) => x.start >= 0 && x.end <= testo.length && x.end > x.start && testo.slice(x.start, x.end) === x.segment;
    // Le x di un segnaposto sono volute: un errore che ci cade sopra (rapido, ragionato, giudicato rimesso) non si vede né si
    // corregge, a prescindere dal verdetto del candidato. Il testo del rapido è misurato sul banco e non lo dice (#1448.9).
    const xVolute = segnapostiAttivi() ? state.codice.filter((c) => c.fonte === 'segnaposto') : [];
    const sulleX = (x) => x.segno === 'errore' && xVolute.some((s) => x.start < s.end && x.end > s.start);
    const tieni = (x) => valido(x) && !sulleX(x) && !ignorato(state, x, testo)
      && !(x.segno === 'errore' && !/\s/.test(x.segment.trim()) && (isInDictionary(x.segment) || nomeNoto(x.segment)))
      && !(scrive && x.start < scrive.end && x.end > scrive.start);
    const ordina = (k) => [
      ...delModello.filter((m) => m.segno === k),
      ...codice.filter((c) => c.segno === k && !c.dubbio && !c.svanisce),
      ...codice.filter((c) => c.segno === k && (c.dubbio || c.svanisce)),
    ].filter(tieni);
    return [
      ...(erroriAttivi() ? Rg.senzaSovrapposti(ordina('errore')) : []),
      ...Rg.senzaSovrapposti(ordina('suggerimento').filter((x) => (x.tipo === 'segnaposto' ? segnapostiAttivi() : suggerimentiAttivi()))),
    ];
  }

  function avvisaAscoltatori(state) {
    for (const f of [...state.ascoltatori]) { try { f(); } catch (_) {} }
  }

  // ============================================================================
  // I due controlli del modello
  // ============================================================================
  // Il rapido: dopo la pausa breve, al più ogni `ogniRapidoMs` mentre si continua a scrivere, e subito a ogni candidato
  // nuovo. Senza un gesto (#1070) quello già chiesto si sposta soltanto.
  function programmaRapido(state, { gesto = false, subito = false } = {}) {
    if (!modelloErrori()) return;
    if (!gesto && !state.timerRapido) return;
    const T = tempi();
    if (state.timerRapido) clearTimeout(state.timerRapido);
    const ora = Date.now();
    if (!state.cambioDa) state.cambioDa = ora;
    const resto = Math.max(0, T.ogniRapidoMs - (ora - state.cambioDa));
    const attesa = subito ? 0 : Math.min(T.pausaRapidoMs, resto);
    state.timerRapido = setTimeout(() => {
      state.timerRapido = null;
      state.cambioDa = 0;
      controlloRapido(state);
    }, attesa);
  }

  // La parola lasciata fuori perché si stava scrivendo si giudica alla pausa lunga: fa parte del gesto che l'ha scritta.
  function programmaFine(state) {
    if (state.timerFine) clearTimeout(state.timerFine);
    state.timerFine = setTimeout(() => {
      state.timerFine = null;
      if (!state.attivo) return;
      aggiornaCodice(state);
      if (state.restaParola && modelloErrori() && !state.timerRapido) controlloRapido(state);
    }, tempi().pausaRagionatoMs + 30);
  }

  // Il ragionato: a fine frase, sulle frasi chiuse, e dopo la pausa lunga su quello che è cambiato.
  function programmaRagionato(state, { gesto = false, fineFrase = false } = {}) {
    if (!ragionatoAttivo()) return;
    if (!gesto && !state.timerRagionato) return;
    if (state.timerRagionato) clearTimeout(state.timerRagionato);
    state.timerRagionato = setTimeout(() => {
      state.timerRagionato = null;
      controlloRagionato(state);
    }, tempi().pausaRagionatoMs);
    if (fineFrase && gesto) setTimeout(() => controlloRagionato(state, { fineFrase: true }), 0);
  }

  // A scheda nascosta non si spende: il controllo chiesto parte quando la scheda torna davanti.
  function riprendiRimandati() {
    if (document.hidden || !activeEl) return;
    const state = monitored.get(activeEl);
    if (!state || !state.rimandati.size) return;
    const quali = [...state.rimandati];
    state.rimandati.clear();
    if (quali.includes('rapido')) controlloRapido(state);
    if (quali.includes('ragionato')) controlloRagionato(state);
  }

  // Gli esiti già pagati, per domanda (#1097.5): un campo lasciato e ripreso, o un annulla che torna a un testo già
  // controllato, non ripagano. Le domande in viaggio si aspettano invece di rifarle.
  // `ripeti`: la risposta di prima era illeggibile (correttoreRegole.senzaRighe), e non va riletta né qui né nella cache
  // del main.
  const esiti = new Map();
  const domandeInViaggio = new Map();
  function chiedi(action, payload, { suRichiesta = false, giorno = '', ripeti = false } = {}) {
    const chiave = `${action}\u0000${giorno}\u0000${JSON.stringify({ ...payload, campo: undefined, sopra: undefined })}`;
    if (esiti.has(chiave) && !ripeti) {
      const r = esiti.get(chiave);
      esiti.delete(chiave);
      esiti.set(chiave, r);
      return Promise.resolve(r);
    }
    let p = ripeti ? null : domandeInViaggio.get(chiave);
    if (!p) {
      p = Promise.resolve(chrome.runtime.sendMessage({
        type: MSG.AI_REQUEST, action, payload,
        // Senza il tasto destro è un lavoro automatico: l'uso lo conta il menu che mostra la correzione (#969).
        ...(suRichiesta ? { suRichiesta: true } : { parteDiUnUso: true }),
        ...(ripeti ? { riprova: true } : {}),
      })).then((res) => {
        if (res && res.ok && typeof res.text === 'string') {
          esiti.set(chiave, { ok: true, text: res.text, senzaContesto: !!res.senzaContesto });
          while (esiti.size > ESITI_MAX) esiti.delete(esiti.keys().next().value);
        }
        return res;
      });
      domandeInViaggio.set(chiave, p);
      const via = () => { if (domandeInViaggio.get(chiave) === p) domandeInViaggio.delete(chiave); };
      p.then(via, via);
    }
    return p;
  }

  function inizioPrima(testo, start) {
    const inizioParagrafo = (pos) => (pos <= 0 ? 0 : testo.lastIndexOf('\n', pos - 1) + 1);
    let da = inizioParagrafo(start);
    let fine = da;
    while (fine > 0 && /\s/.test(testo[fine - 1])) fine--;
    if (fine > 0) da = inizioParagrafo(fine);
    if (start - da > PRIMA_MAX) {
      da = start - PRIMA_MAX;
      while (da < start && isWordCharLocal(testo[da - 1]) && isWordCharLocal(testo[da])) da++;
    }
    return da;
  }

  // I due pezzi che partono, più campo intero e testo sopra (letto a ogni richiesta), che restano al main: chi presenta
  // una password può stare fuori dal pezzo, o essere la domanda a cui si risponde (correttoreRiservati.js).
  function pezziDa(testo, start, end, sopra = '') {
    const da = inizioPrima(testo, start);
    return { prima: testo.slice(da, start), nuovo: testo.slice(start, end), campo: testo, campoDa: da, sopra };
  }

  const sopraIlCampo = (el) => contestoDelCampo(el, { soloPrima: CONVERSAZIONE_MAX }).prima;

  // Il sito dove si scrive, per il ragionato: il main lo rimette comunque col suo.
  function sitoDellaPagina() {
    try { return location.protocol === 'filo:' ? 'Filo' : (location.hostname || ''); } catch (_) { return ''; }
  }

  const perche = (c) => (c.fonte === 'segnaposto' ? 'segnaposto' : c.motivo || (c.fonte === 'dizionario' ? t('spell_perche_dizionario') : ''));

  // Una risposta senza righe leggibili che non dice «nessuno» si chiede una volta ancora (#1580, D8).
  async function chiediERipeti(action, payload, opz = {}) {
    const res = await chiedi(action, payload, opz);
    if (!res || !res.ok || typeof res.text !== 'string' || !R().senzaRighe(res.text)) return res;
    const ancora = await chiedi(action, payload, { ...opz, ripeti: true });
    return ancora && ancora.ok && typeof ancora.text === 'string' ? ancora : res;
  }

  async function controlloRapido(state, { suRichiesta = false, ignoraScrittura = false } = {}) {
    if (!modelloErrori() || !state.el || !state.el.isConnected) return;
    if (document.hidden && !suRichiesta) { state.rimandati.add('rapido'); return; }
    const Rg = R();
    seguiIlTesto(state);
    const d = testoDaControllare(state.el);
    if (d.testo.trim().length < 2) return;
    if (tornaAGiudicato(state, 'rapido', d)) return;
    const scrive = ignoraScrittura ? null : inScritturaNelTesto(state, d);
    const regione = Rg.regioneNuova(state.baseRapido, d.testo);
    state.restaParola = !!(scrive && regione && scrive.start < regione.end && scrive.end > regione.start);
    const g = Rg.daGiudicare(state.baseRapido, d.testo, { inScrittura: scrive, regione });
    if (!g) return;
    const baseDiPrima = state.baseRapido;
    state.baseRapido = g.base;
    const numero = ++state.inviatiRapido;
    if (state.codiceTesto !== d.testo) calcolaCodice(state);
    const candidati = state.codiceT2.filter((c) => c.segno === 'errore' && c.dubbio && c.start >= g.start && c.end <= g.end && !verdetto(state, c));
    for (const c of candidati) state.richiesti.add(Rg.chiaveVerdetto(c));
    const payload = {
      ...pezziDa(d.testo, g.start, g.end, sopraIlCampo(state.el)),
      candidati: candidati.slice(0, 40).map((c) => ({ pezzo: c.segment, perche: perche(c) })),
    };
    const [regioneCampo] = d.riporta([{ start: g.start, end: g.end }]);
    const viaggio = {
      id: `r${numero}`, start: regioneCampo ? regioneCampo.start : 0, end: regioneCampo ? regioneCampo.end : 0,
      candidati: candidati.slice(0, 40).map((c) => Rg.chiaveVerdetto(c)),
    };
    state.inViaggio.push(viaggio);
    let res = null;
    try {
      res = await chiediERipeti(ACTIONS.SPELLCHECK_SEMANTIC, payload, { suRichiesta });
    } catch (err) {
      console.warn('[SN] correttore, controllo rapido:', err);
    } finally {
      state.inViaggio = state.inViaggio.filter((v) => v !== viaggio);
    }
    if (!res || !res.ok || typeof res.text !== 'string') {
      // Il pezzo torna da giudicare al prossimo giro, se nel frattempo non ne è partito un altro.
      if (state.inviatiRapido === numero) state.baseRapido = baseDiPrima;
      if (res && !res.ok) console.warn('[SN] correttore, controllo rapido:', res.code, res.error);
      return;
    }
    if (res.model) state.modelloRapido = String(res.model);
    applicaRisposta(state, res.text, { fonte: 'rapido', viaggio });
  }

  async function controlloRagionato(state, { fineFrase = false } = {}) {
    if (!ragionatoAttivo() || !state.el || !state.el.isConnected) return;
    if (document.hidden) { state.rimandati.add('ragionato'); return; }
    const Rg = R();
    seguiIlTesto(state);
    const d = testoDaControllare(state.el);
    if (d.testo.trim().length < MIN_TESTO) return;
    if (tornaAGiudicato(state, 'ragionato', d)) return;
    let finoA = null;
    if (fineFrase) {
      const pos = d.verso(cursoreNelCampo(state.el));
      if (pos < 0) return;
      finoA = Rg.ultimaFineFrase(d.testo, pos);
    }
    // Il campo intero, non le sole frasi cambiate (#1580, D3): contraddizioni e ripetizioni stanno anche fra una frase e
    // l'altra. Il campo parte intero anche verso il main, che ci cerca i dati riservati (correttoreRiservati.js).
    const g = Rg.testoDaRileggere(state.baseRagionato, d.testo, { finoA });
    if (!g) return;
    const baseDiPrima = state.baseRagionato;
    state.baseRagionato = g.base;
    const numero = ++state.inviatiRagionato;
    if (state.codiceTesto !== d.testo) calcolaCodice(state);
    const candidati = state.codiceT2.filter((c) => c.segno === 'suggerimento' && c.dubbio && c.start >= g.start && c.end <= g.end && !verdetto(state, c));
    // Coi suggerimenti spenti il pezzo si manda solo se ha delle x, e la domanda è soltanto sui segnaposti.
    const soloSegnaposti = !suggerimentiAttivi();
    if (soloSegnaposti && !candidati.some((c) => c.fonte === 'segnaposto')) { state.baseRagionato = baseDiPrima; return; }
    const contesto = contestoDelCampo(state.el);
    const payload = {
      prima: '', nuovo: d.testo.slice(g.start, g.end), dopo: '', campo: d.testo, campoDa: g.start, sopra: contesto.prima.slice(-CONVERSAZIONE_MAX),
      candidati: candidati.slice(0, 20).map((c) => ({ pezzo: c.segment, perche: perche(c) })),
      contesto,
      ripetizioni: ripetizioniAttive(),
      segnaposti: segnapostiAttivi(),
      ...(soloSegnaposti ? { soloSegnaposti: true } : {}),
      luogo: { sito: sitoDellaPagina() },
    };
    const [regioneCampo, nuovoCampo] = d.riporta([{ start: g.start, end: g.end }, g.nuovo]);
    const viaggio = {
      id: `g${numero}`, start: regioneCampo ? regioneCampo.start : 0, end: regioneCampo ? regioneCampo.end : 0,
      nuovo: nuovoCampo || null,
    };
    state.inViaggio.push(viaggio);
    let res = null;
    try {
      // Le date relative cambiano a mezzanotte: il giorno è parte della domanda.
      res = await chiediERipeti(ACTIONS.SPELLCHECK_CONTEXT, payload, { giorno: new Date().toDateString() });
    } catch (err) {
      console.warn('[SN] correttore, controllo ragionato:', err);
    } finally {
      state.inViaggio = state.inViaggio.filter((v) => v !== viaggio);
    }
    if (!res || !res.ok || typeof res.text !== 'string') {
      if (state.inviatiRagionato === numero) state.baseRagionato = baseDiPrima;
      if (res && !res.ok) console.warn('[SN] correttore, controllo ragionato:', res.code, res.error);
      return;
    }
    if (res.model) state.modelloRagionato = String(res.model);
    applicaRisposta(state, res.text, { fonte: 'ragionato', viaggio, contesto: res.senzaContesto ? {} : contesto });
  }

  // La risposta si posa sul testo di ADESSO (correttoreRegole.segniDaRisposta): un pezzo cambiato nel frattempo non si
  // ritrova e cade. Un candidato del codice nello stesso punto prende il giudizio; il resto sono segni del modello, che
  // sostituiscono quelli dello stesso controllo nel pezzo giudicato.
  function applicaRisposta(state, raw, { fonte, viaggio = null, contesto = null }) {
    const Rg = R();
    seguiIlTesto(state);
    const d = testoDaControllare(state.el);
    const rapido = fonte === 'rapido';
    const zona = viaggio && !viaggio.perso ? (viaggio.nuovo === undefined ? viaggio : viaggio.nuovo) : null;
    const nuovo = zona ? { start: d.verso(zona.start), end: d.verso(zona.end) } : null;
    const { segni, giusti } = Rg.segniDaRisposta(raw, d.testo, {
      tipi: rapido ? ['errore'] : [
        ...(suggerimentiAttivi() ? ['errore', 'suggerimento', 'contraddizione'] : []), ...(segnapostiAttivi() ? ['segnaposto', 'cerca'] : []),
      ],
      // Una riga che ha perso il tipo: nel ragionato vale il segno che decide l'utente, non un errore.
      senzaTipo: rapido ? 'errore' : 'suggerimento',
      citata: (c) => !!contesto && !!Coerenza() && Coerenza().citazioneNelContesto(c, contesto),
      fonte,
      nuovo: nuovo && nuovo.start >= 0 && nuovo.end > nuovo.start ? nuovo : null,
    });
    // Ogni segnaposto ha il suo valore («p/e di soli xx» e «p/e di xx»): non diventa il giudizio di un candidato, che
    // varrebbe per tutte le stesse x del campo. Porta la frase in cui il suo dato è stato deciso (correttoreRegole.stessaFrase).
    for (const s of segni) {
      if (s.tipo !== 'segnaposto') continue;
      const f = Rg.aFrasiIntere(d.testo, s.start, s.end);
      s.frase = d.testo.slice(f.start, f.end).slice(0, 2000);
      if (s.cerca) s.cerca = { ...s.cerca, frase: s.frase, chiave: Rg.chiaveRicerca(s.segment, s.cerca) };
    }
    if (state.codiceTesto !== d.testo) calcolaCodice(state);
    const ora = Date.now();
    const suo = rapido ? 'errore' : 'suggerimento';
    const tocca = (a, b) => a.start < b.end && a.end > b.start;
    const candidati = state.codiceT2.filter((c) => c.segno === suo);
    for (const g of giusti) {
      for (const c of candidati) if (!c.certo && tocca(c, g)) state.verdetti.set(Rg.chiaveVerdetto(c), { stato: 'scartato', alle: ora, da: fonte });
    }
    const nuovi = [];
    const confermati = new Set();
    for (const s of segni) {
      const c = s.tipo === 'segnaposto' ? null : candidati.find((x) => x.start === s.start && x.end === s.end)
        || (!rapido && s.segno === 'suggerimento' ? candidati.find((x) => tocca(x, s)) : null);
      if (!c) { nuovi.push({ ...s, confermatoAlle: ora }); continue; }
      confermati.add(Rg.chiaveVerdetto(c));
      state.verdetti.set(Rg.chiaveVerdetto(c), {
        stato: 'confermato', alle: ora, da: fonte,
        motivo: rapido ? (s.motivo || c.motivo) : (c.motivo || s.motivo),
        correzioni: rapido ? (s.correzioni.length ? s.correzioni : c.correzioni) : (c.correzioni.length ? c.correzioni : s.correzioni),
        citazione: s.citazione,
      });
    }
    // Il rapido tace sui candidati giusti (prompt del banco, #1580): uno mandato e non confermato è scartato, se la
    // risposta è leggibile.
    if (rapido && viaggio && Array.isArray(viaggio.candidati) && !Rg.senzaRighe(raw)) {
      for (const k of viaggio.candidati) {
        const v = state.verdetti.get(k);
        if (!confermati.has(k) && !(v && v.stato === 'confermato')) state.verdetti.set(k, { stato: 'scartato', alle: ora, da: fonte });
      }
    }
    const giudicato = viaggio && !viaggio.perso ? viaggio : null;
    // Un segnaposto già deciso: se la rilettura chiede un dato, decide la sua domanda (la stessa lo tiene, un'altra lo
    // rifà partendo dalle fonti già lette, così parole diverse per lo stesso dato non ripagano la ricerca); se tace, resta
    // finché la frase è ancora quella (correttoreRegole.stessaFrase). Un «giusto» lo toglie sempre.
    const fraseDiAdesso = (m) => {
      const a = d.verso(m.start);
      const b = d.verso(m.end);
      if (!(a >= 0 && b > a) || d.testo.slice(a, b) !== m.segment) return null;
      const f = Rg.aFrasiIntere(d.testo, a, b);
      return d.testo.slice(f.start, f.end);
    };
    const restaSegnaposto = (m) => {
      if (m.tipo !== 'segnaposto' || !m.frase) return false;
      const ora = fraseDiAdesso(m);
      return ora != null && Rg.stessaFrase(m.frase, ora);
    };
    const tenuti = new Set();
    const delCampo = d.riporta(nuovi).filter((n) => {
      if (n.tipo !== 'segnaposto') return true;
      const chiesto = n.cerca && state.modello.find((m) => m.fonte === fonte && m.tipo === 'segnaposto' && m.cerca && tocca(m, n));
      if (chiesto && chiesto.cerca.chiave !== n.cerca.chiave) {
        const trovato = ricerche.get(chiesto.cerca.chiave)?.stato === 'trovato';
        n.cerca = { ...n.cerca, prima: trovato || !chiesto.cerca.prima ? { chiave: chiesto.cerca.chiave, domanda: chiesto.cerca.domanda, dove: chiesto.cerca.dove } : chiesto.cerca.prima };
        return true;
      }
      const prima = chiesto || state.modello.find((m) => m.fonte === fonte && m.tipo === 'segnaposto' && tocca(m, n) && restaSegnaposto(m));
      if (!prima) return true;
      tenuti.add(prima);
      return false;
    });
    const giustiCampo = d.riporta(giusti);
    const rinnovato = (m) => giustiCampo.some((n) => tocca(m, n)) || (!tenuti.has(m) && delCampo.some((n) => tocca(m, n)));
    state.modello = state.modello.filter((m) => m.fonte !== fonte
      || (!rinnovato(m) && (tenuti.has(m) || !(giudicato && tocca(m, giudicato)) || restaSegnaposto(m))));
    state.modello.push(...delCampo);
    avviaRicerche(state);
    const base = rapido ? state.baseRapido : state.baseRagionato;
    const sigla = rapido ? 'r' : 'g';
    if (base === d.testo && !state.inViaggio.some((v) => v.id[0] === sigla)) ricordaGiudicato(state, fonte);
    renderOverlayContent(state);
    avvisaAscoltatori(state);
  }

  // Il testo di adesso giudicato per intero, coi segni del modello che ne erano usciti. Si ritrova a meno di spazi e
  // punteggiatura, che non cambiano il giudizio.
  function ricordaGiudicato(state, fonte) {
    const m = state.giudicati[fonte];
    const testo = getEditableText(state.el);
    const k = R().ossatura(testo);
    m.delete(k);
    m.set(k, { testo, segni: state.modello.filter((x) => x.fonte === fonte).map((x) => ({ ...x })) });
    while (m.size > GIUDICATI_MAX) m.delete(m.keys().next().value);
  }

  // Un annulla, o una correzione tolta, riporta a un testo già giudicato per intero: tornano i suoi segni, senza
  // chiamata. Vero se ha fatto così.
  function tornaAGiudicato(state, fonte, d) {
    const testo = getEditableText(state.el);
    const g = state.giudicati[fonte].get(R().ossatura(testo));
    if (!g) return false;
    if (fonte === 'rapido') state.baseRapido = d.testo; else state.baseRagionato = d.testo;
    const segni = riallineaIssues(g.segni.map((x) => ({ ...x })), g.testo, testo).issues;
    state.modello = [...state.modello.filter((x) => x.fonte !== fonte), ...segni];
    state.testo = testo;
    avviaRicerche(state);
    renderOverlayContent(state);
    return true;
  }

  // ============================================================================
  // I segnaposti (#1448)
  // ============================================================================
  // Il valore di un segnaposto da cercare, per segnaposto e domanda: lo stesso segnaposto in un campo ripreso, o in un
  // testo tornato indietro, non ricerca. Una ricerca fallita non resta: «Cerca di nuovo» la rifà.
  const RICERCHE_MAX = 200;
  const ricerche = new Map();

  function avviaRicerche(state) {
    if (!segnapostiAttivi()) return;
    for (const m of state.modello) if (m.cerca && m.cerca.chiave && !ricerche.has(m.cerca.chiave)) cercaValore(state, m.cerca, m.segment);
  }

  // Perché una ricerca non è partita, dal main: non è un dato che non c'è.
  const NON_PARTITA = { PAGINA_DELICATA: 'delicata', RICERCA_BLOCCATA: 'bloccata' };

  async function cercaValore(state, cerca, pezzo, { suRichiesta = false } = {}) {
    const k = cerca.chiave;
    ricerche.set(k, { stato: 'cerca' });
    while (ricerche.size > RICERCHE_MAX) ricerche.delete(ricerche.keys().next().value);
    let res = null;
    try {
      res = await chiedi(ACTIONS.SPELLCHECK_CONTEXT, {
        segnaposto: {
          pezzo, frase: cerca.frase, domanda: cerca.domanda, dove: cerca.dove, ...(suRichiesta ? { suRichiesta: true } : {}),
          ...(cerca.prima ? { giaLette: { domanda: cerca.prima.domanda, dove: cerca.prima.dove } } : {}),
        },
      }, { giorno: new Date().toDateString() });
    } catch (err) {
      console.warn('[SN] correttore, segnaposto:', err);
    }
    const ok = !!(res && res.ok && typeof res.text === 'string');
    const v = ok ? R().valoreTrovato(res.text) : null;
    ricerche.set(k, v ? { stato: 'trovato', ...v } : { stato: ok ? 'nessuno' : (NON_PARTITA[res && res.code] || 'errore') });
    if (res && !res.ok) console.warn('[SN] correttore, segnaposto:', res.code, res.error);
    if (state.attivo) renderOverlayContent(state);
    avvisaAscoltatori(state);
  }

  // Un segno da cercare col suo stato: in ricerca, col valore e la fonte, o senza.
  function conRicerca(m) {
    if (!m.cerca) return m;
    const r = ricerche.get(m.cerca.chiave);
    if (!r || r.stato === 'cerca') {
      // Rifatta con un'altra domanda: finché non risponde resta il valore di prima, non i puntini.
      const p = m.cerca.prima && ricerche.get(m.cerca.prima.chiave);
      if (p && p.stato === 'trovato') {
        return { ...m, aggiornando: true, correzioni: [p.valore], motivo: p.motivo, fonteDato: { nome: p.fonte, data: p.data, url: p.url } };
      }
      return { ...m, cercando: true };
    }
    if (r.stato === 'trovato') {
      return { ...m, correzioni: [r.valore], motivo: r.motivo, fonteDato: { nome: r.fonte, data: r.data, url: r.url } };
    }
    const motivo = { errore: 'spell_segnaposto_errore', delicata: 'spell_segnaposto_delicata', bloccata: 'spell_segnaposto_bloccata' }[r.stato];
    return {
      ...m, motivo: t(motivo || 'spell_segnaposto_nessuno'),
      ricercaFallita: r.stato === 'errore' || r.stato === 'delicata',
      vocePerCercare: r.stato === 'delicata' ? 'spell_segnaposto_cerca' : 'spell_segnaposto_riprova',
    };
  }

  // Col clic di chi scrive: è una richiesta, quindi parte anche da una pagina delicata.
  function cercaDiNuovo(el, segno) {
    const state = el && monitored.get(el);
    if (!state || !segno || !segno.cerca || !segnapostiAttivi()) return;
    ricerche.delete(segno.cerca.chiave);
    cercaValore(state, segno.cerca, segno.segment, { suRichiesta: true });
    renderOverlayContent(state);
  }

  // Il valore al posto delle x, col lampo che dice dove il testo è cambiato; il cursore resta dove si stava scrivendo,
  // perché il clic è caduto sul valore, non nel testo. Vero se l'ha messo.
  function riempi(el, segno) {
    const state = el && monitored.get(el);
    const valore = segno && segno.tipo === 'segnaposto' && !segno.cercando && segno.correzioni && segno.correzioni[0];
    if (!state || !valore) return false;
    const prima = getEditableText(el);
    const cursore = cursoreNelCampo(el);
    applyFix(el, { start: segno.start, end: segno.end }, valore, { expectedSegment: segno.segment, cursor: 'preserve' });
    if (getEditableText(el) === prima) return false;
    if (cursore >= 0 && !campoDiTesto(el)) {
      const dove = cursore >= segno.end ? cursore + valore.length - (segno.end - segno.start) : cursore;
      try {
        const r = document.createRange();
        placeCaretAtOffset(el, dove, r);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      } catch (_) {}
    }
    seguiIlTesto(state);
    state.lampi.push({ start: segno.start, end: segno.start + valore.length, lampo: Date.now() });
    renderOverlayContent(state);
    return true;
  }

  // Lo strato dei valori: sopra le x, in piccolo, il valore trovato (o i puntini della ricerca), che si mette con un
  // clic; e i lampi. Sta fuori dallo specchio, che taglia ai bordi del campo e lascia passare il mouse.
  function strato(state) {
    if (state.valori && state.valori.isConnected) return state.valori;
    const v = document.createElement('div');
    v.className = 'sn-spell-valori';
    global.SN_FILO_UI?.mark(v);
    (radiceDi(state.el) || document.body).appendChild(v);
    state.valori = v;
    state.badge.clear();
    return v;
  }

  // I riquadri delle righe di [da, a): nello specchio per una casella, sulle parole vere per un campo modificabile.
  function rettangoliDi(state, da, a) {
    const radice = campoDiTesto(state.el) ? state.overlay : state.el;
    if (!radice || a <= da) return [];
    const w = document.createTreeWalker(radice, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let tot = 0;
    let iniziato = false;
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const len = n.nodeValue.length;
      if (!iniziato && da < tot + len) { range.setStart(n, da - tot); iniziato = true; }
      if (iniziato && a <= tot + len) { range.setEnd(n, a - tot); return [...range.getClientRects()].filter((r) => r.width || r.height); }
      tot += len;
    }
    return [];
  }

  const dentroAlCampo = (state, r) => {
    const q = state.riquadro;
    if (!q) return false;
    const y = r.top + r.height / 2;
    const x = r.left + r.width / 2;
    return y >= q.top && y <= q.top + q.height && x >= q.left && x <= q.left + q.width;
  };

  function disegnaValori(state) {
    if (!state.attivo || !state.overlay) {
      if (state.valori) { state.valori.remove(); state.valori = null; state.badge.clear(); }
      return;
    }
    const ora = Date.now();
    state.lampi = state.lampi.filter((l) => ora - l.lampo < LAMPO_MS);
    const testo = getEditableText(state.el);
    const valori = state.inVista.filter((s) => s.tipo === 'segnaposto' && !s.dubbio && !s.svanisce
      && (s.cercando || (s.correzioni && s.correzioni[0])));
    if (!valori.length && !state.lampi.length) {
      if (state.valori) { state.valori.textContent = ''; state.badge.clear(); }
      return;
    }
    const v = strato(state);
    v.dataset.snTheme = document.documentElement.dataset.snTheme || '';
    const corpo = parseFloat(window.getComputedStyle(state.el).fontSize) || 16;
    v.style.setProperty('--sn-valore-corpo', `${corpo}px`);
    const usati = new Set();
    for (const s of valori) {
      const tr = tratto(testo, s);
      const r = tr && rettangoliDi(state, tr.a, tr.b)[0];
      if (!r || !dentroAlCampo(state, r)) continue;
      const k = `${s.start}:${s.end}`;
      usati.add(k);
      let b = state.badge.get(k);
      if (!b) {
        b = document.createElement('span');
        b.className = 'sn-spell-valore';
        b.setAttribute('role', 'button');
        // Il clic non toglie il fuoco al campo, che altrimenti si staccherebbe col suo strato.
        b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!e.isTrusted) return;
          const vivo = b._snSegno;
          if (!vivo) return;
          if (!riempi(state.el, vivo)) { renderOverlayContent(state); return; }
          // Il valore usato col clic è un uso del correttore, come la correzione scelta dal menu (#969).
          try { Promise.resolve(chrome.runtime.sendMessage({ type: MSG.CONTATORI_USO, action: ACTIONS.SPELLCHECK_CONTEXT, attesaMs: 0 })).catch(() => {}); } catch (_) {}
        });
        state.badge.set(k, b);
        v.appendChild(b);
      }
      b._snSegno = s;
      b.classList.toggle('sn-cercando', !!s.cercando);
      const scritto = s.cercando ? '' : s.correzioni[0];
      if (b.textContent !== scritto) b.textContent = scritto;
      b.title = s.cercando ? t('spell_segnaposto_cerco') : t('spell_segnaposto_metti', s.correzioni[0]);
      b.style.left = `${r.left + r.width / 2}px`;
      b._snX = r;
      b.style.top = `${r.top}px`;
      b.classList.toggle('sn-sopra-testo', copreIlTesto(state, b, r, tr.a));
    }
    for (const [k, b] of state.badge) if (!usati.has(k)) { b.remove(); state.badge.delete(k); }
    for (const l of v.querySelectorAll('.sn-spell-lampo')) l.remove();
    for (const l of state.lampi) {
      for (const r of rettangoliDi(state, l.start, l.end)) {
        if (!dentroAlCampo(state, r)) continue;
        const d = document.createElement('span');
        d.className = 'sn-spell-lampo';
        d.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;animation-delay:${-(ora - l.lampo)}ms`;
        v.appendChild(d);
      }
    }
  }

  // Sopra le x di una riga che non è la prima il valore cadrebbe sulle parole della riga prima (#1448): lì resta velato,
  // lascia il clic al testo e si sveglia (pieno, cliccabile) col puntatore sulle x, finché resta su x o valore.
  function copreIlTesto(state, b, x, da) {
    const w = b.offsetWidth;
    const h = b.offsetHeight;
    if (!w || !h) return false;
    const cx = x.left + x.width / 2;
    const top = x.top - 1 - h;
    return rettangoliDi(state, Math.max(0, da - 1000), da).some((r) => {
      const mezzo = r.top + r.height / 2;
      if (mezzo >= x.top && mezzo <= x.bottom) return false;
      return r.bottom > top + 1 && r.top < top + h - 1 && r.right > cx - w / 2 && r.left < cx + w / 2;
    });
  }

  function svegliaValori(e) {
    const state = activeEl && monitored.get(activeEl);
    if (!state || !state.valori) return;
    const x = e.clientX;
    const y = e.clientY;
    const dentro = (r, m) => r && x >= r.left - m && x <= r.right + m && y >= r.top - m && y <= r.bottom + m;
    for (const b of state.badge.values()) {
      if (!b.classList.contains('sn-sopra-testo')) continue;
      const sveglio = dentro(b._snX, 2) || (b.classList.contains('sn-sveglio') && (dentro(b._snX, 4) || dentro(b.getBoundingClientRect(), 4)));
      b.classList.toggle('sn-sveglio', sveglio);
    }
  }

  // Il valore sotto il tasto destro: il menu è quello del suo segnaposto.
  function valoreSotto(target) {
    const b = target && target.closest && target.closest('.sn-spell-valore');
    if (!b || !b._snSegno) return null;
    const el = activeEl;
    const state = el && monitored.get(el);
    if (!state || !state.valori || !state.valori.contains(b)) return null;
    return { el, segno: b._snSegno };
  }

  // ============================================================================
  // Per il tasto destro (content.js)
  // ============================================================================
  // I segni sotto il punto, uno per tipo. Il tasto destro dice che non si sta scrivendo: anche la parola appena scritta
  // ha il suo segno.
  function segniSotto(el, clientX, clientY) {
    const vuoto = { errore: null, suggerimento: null };
    const state = el && monitored.get(el);
    if (!state) return vuoto;
    const pos = caretCharOffsetFromPoint(el, clientX, clientY);
    if (pos < 0) return vuoto;
    seguiIlTesto(state);
    if (state.codiceTesto !== testoDaControllare(el).testo) calcolaCodice(state);
    const vista = segniInVista(state, { ignoraScrittura: true }).filter((s) => !s.svanisce);
    const su = (k) => vista.find((s) => s.segno === k && pos >= s.start && pos < s.end) || null;
    return { errore: su('errore'), suggerimento: su('suggerimento') };
  }

  // Un candidato ancora da giudicare sotto il tasto destro: il controllo rapido parte adesso, e il menu aperto si
  // aggiorna quando risponde (seguiSegno). Dice se un controllo era già in volo ('in_volo') o parte ora ('partito').
  function giudicaOra(el, segno) {
    const state = el && monitored.get(el);
    if (!state || !segno || !segno.dubbio || segno.segno !== 'errore' || !modelloErrori()) return false;
    const k = R().chiaveVerdetto(segno);
    if (state.inViaggio.some((v) => v.start < segno.end && v.end > segno.start)) return 'in_volo';
    state.richiesti.add(k);
    // Fuori dalla base, così il pezzo torna nuovo anche se era già stato mandato; ciò che era da giudicare resta.
    const d = testoDaControllare(el);
    const a = d.verso(segno.start);
    const b = d.verso(segno.end);
    const r = R().regioneNuova(state.baseRapido, d.testo);
    if (a >= 0 && b > a && !(r && r.start <= a && r.end >= b)) {
      const da = r ? Math.min(a, r.start) : a;
      const fino = r ? Math.max(b, r.end) : b;
      state.baseRapido = d.testo.slice(0, da) + d.testo.slice(fino);
    }
    controlloRapido(state, { suRichiesta: true, ignoraScrittura: true });
    return 'partito';
  }

  function seguiSegno(el, segno, cb) {
    const state = el && monitored.get(el);
    if (!state || !segno) return () => {};
    const f = () => {
      const ora = segniInVista(state, { ignoraScrittura: true })
        .find((s) => s.segno === segno.segno && s.start < segno.end && s.end > segno.start && !s.svanisce);
      cb(ora || null);
    };
    state.ascoltatori.add(f);
    return () => state.ascoltatori.delete(f);
  }

  function correggi(el, segno, correzione) {
    if (!el || !segno) return;
    esitoSegno(el, segno, 'accettata');
    applyFix(el, { start: segno.start, end: segno.end }, correzione, { expectedSegment: segno.segment });
  }

  // «Ignora» vale per quel testo; su una parola fuori dizionario che non è il refuso di una parola vera è anche un
  // rifiuto da cui Filo impara, e la parola non si segna più da nessuna parte (#1447).
  function ignora(el, segno) {
    const state = el && monitored.get(el);
    if (!state || !segno) return;
    esitoSegno(el, segno, 'rifiutata');
    const ig = chiaveIgnora(segno);
    // Le x di un segnaposto si ignorano con le parole che le precedono: «di soli xx» non spegne «un p/e di xx».
    if (segno.tipo === 'segnaposto') {
      const prima = getEditableText(el).slice(Math.max(0, segno.start - 40), segno.start);
      ig.segment = (/(?:\S+[^\S\n]+){0,2}$/.exec(prima) || [''])[0] + segno.segment;
    }
    state.ignorate.set(`${ig.fonte}\u0001${String(ig.segment).toLowerCase()}`, ig);
    renderOverlayContent(state);
    const parola = String(segno.segment || '').trim();
    if (segno.segno === 'errore' && A() && parolaImparabile(parola)) {
      aggiungiImparata(formaDaImparare(parola, A().inizioDiFrase(getEditableText(el), segno.start)));
    }
  }

  // Una parola che Filo sa giusta in quel campo: nel dizionario personale, scartata dal modello o ignorata. Lì la
  // proposta del browser (che la segna comunque) non va in cima al menu.
  function parolaGiusta(el, parola) {
    const w = String(parola || '').trim();
    if (!w) return false;
    if (isInDictionary(w)) return true;
    const state = el && monitored.get(el);
    if (!state) return false;
    if (verdetto(state, { fonte: 'dizionario', segment: w })?.stato === 'scartato') return true;
    return ignorato(state, { segno: 'errore', segment: w, start: 0, end: w.length }, w);
  }

  // A inizio frase la maiuscola non dice niente: la parola si aggiunge minuscola, se no Filo la metterebbe ovunque.
  async function aggiungiAlDizionario(el, segno) {
    if (!segno) return;
    esitoSegno(el, segno, 'rifiutata');
    await addToDictionary(A() ? formaDaImparare(segno.segment, A().inizioDiFrase(getEditableText(el), segno.start)) : segno.segment);
    const state = el && monitored.get(el);
    if (state) aggiornaCodice(state);
  }

  // Gli errori confermati che hanno una correzione, e i segnaposti che hanno un valore (#1448): «Correggi tutti gli
  // errori» non tocca i candidati né gli altri suggerimenti.
  function erroriDaCorreggere(el) {
    const state = el && monitored.get(el);
    if (!state) return [];
    seguiIlTesto(state);
    return segniInVista(state, { ignoraScrittura: true })
      .filter((s) => (s.segno === 'errore' || (s.tipo === 'segnaposto' && !s.cercando && !s.aggiornando)) && !s.dubbio && !s.svanisce
        && Array.isArray(s.correzioni) && s.correzioni.length);
  }

  // Dal fondo all'inizio: ogni correzione lascia al loro posto quelle prima. Quante ne ha fatte.
  function correggiTutti(el) {
    const lista = erroriDaCorreggere(el).sort((a, b) => b.start - a.start);
    let fatte = 0;
    for (const s of lista) {
      const prima = getEditableText(el);
      if (s.tipo === 'segnaposto') riempi(el, s);
      else correggi(el, s, s.correzioni[0]);
      if (getEditableText(el) !== prima) fatte++;
    }
    return fatte;
  }

  // Il controllo rapido chiesto col tasto destro su una parola di una casella di una riga: { errore, correzione, motivo }
  // per quella parola, o null se il controllo non ha risposto.
  async function controlloSuRichiesta(el, wordCtx) {
    if (!modelloErrori() || !el || !wordCtx) return null;
    const testo = campoDiTesto(el) ? String(el.value || '') : getEditableText(el);
    if (testo.slice(wordCtx.start, wordCtx.end) !== wordCtx.word) return null;
    const payload = {
      ...pezziDa(testo, wordCtx.start, wordCtx.end, sopraIlCampo(el)),
      candidati: [{ pezzo: wordCtx.word, perche: t('spell_perche_chiesta') }],
    };
    let res;
    try { res = await chiediERipeti(ACTIONS.SPELLCHECK_SEMANTIC, payload, { suRichiesta: true }); } catch (_) { return null; }
    if (!res || !res.ok || typeof res.text !== 'string') return null;
    const { segni } = R().segniDaRisposta(res.text, testo, { fonte: 'rapido', nuovo: { start: wordCtx.start, end: wordCtx.end } });
    const e = segni.find((s) => s.start < wordCtx.end && s.end > wordCtx.start);
    if (!e) return { errore: false };
    // Il modello va ai contatori del correttore, con la proposta che ne esce (#1461).
    return { errore: true, start: e.start, end: e.end, segment: e.segment, correzione: e.correzioni[0] ?? '', motivo: e.motivo, modello: String(res.model || '') };
  }

  // Cerca di estrarre frase precedente e successiva al campo editabile, per la parola sotto il tasto destro.
  function extractContext(el) {
    let prev = '';
    let next = '';
    try {
      const parent = el.parentElement;
      if (!parent) return { prev, next };
      const siblings = Array.from(parent.childNodes);
      const idx = siblings.indexOf(el);
      for (let i = idx - 1; idx > 0 && i >= 0; i--) {
        const tx = (siblings[i].textContent || '').trim();
        if (tx) { prev = tx; break; }
      }
      for (let i = idx + 1; idx >= 0 && i < siblings.length; i++) {
        const tx = (siblings[i].textContent || '').trim();
        if (tx) { next = tx; break; }
      }
    } catch (_) {}
    return { prev: prev.slice(0, 300), next: next.slice(0, 300) };
  }

  // ============================================================================
  // La parola sotto il tasto destro
  // ============================================================================
  // Trova la parola sotto al click in un editabile, restituisce
  // { word, start, end, sentence, prev, next } o null.
  function getWordAt(el, clientX, clientY) {
    const text = getEditableText(el);
    if (!text) return null;
    const pos = caretCharOffsetFromPoint(el, clientX, clientY);
    if (pos < 0 || pos > text.length) return null;
    const idx = Math.min(pos, text.length - 1);
    const { start, end } = expandToWord(text, idx);
    if (end <= start) return null;
    const word = text.slice(start, end);
    if (!/[\p{L}]/u.test(word)) return null;
    const sentence = sentenceAround(text, start, end);
    const ctx = extractContext(el);
    return { word, start, end, sentence, prev: ctx.prev, next: ctx.next };
  }

  // Anche su <input>: niente overlay blu, ma il suggerimento nel menu ci deve essere, perché
  // i soli nativi non arrivano sempre. Stesso shape di getWordAt.
  function getInputWordAt(el, clientX) {
    if (!el || el.tagName !== 'INPUT') return null;
    const text = el.value || '';
    if (!text) return null;
    let pos = inputCharOffset(el, clientX);
    if (pos < 0) return null;
    const idx = Math.min(pos, text.length - 1);
    const { start, end } = expandToWord(text, idx);
    if (end <= start) return null;
    const word = text.slice(start, end);
    if (!/[\p{L}]/u.test(word)) return null;
    const sentence = text.trim() || word;
    const ctx = extractContext(el);
    return { word, start, end, sentence, prev: ctx.prev, next: ctx.next };
  }

  // Offset di carattere in un <input> da una X del viewport, misurato col canvas imitando
  // il font dell'elemento.
  function inputCharOffset(el, clientX) {
    const text = el.value || '';
    if (!text) return 0;
    const cs = window.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const px = clientX - r.left + (el.scrollLeft || 0)
      - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.borderLeftWidth || 0);
    const canvas = inputCharOffset._canvas || (inputCharOffset._canvas = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    let lo = 0, hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const w = ctx.measureText(text.slice(0, mid)).width;
      if (w < px) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(0, Math.min(text.length, lo));
  }

  function expandToWord(text, idx) {
    const isWordChar = (c) => !!c && /[\p{L}\p{N}'’\-]/u.test(c);
    let s = idx, e = idx;
    if (!isWordChar(text[s])) {
      // Se siamo sopra uno spazio/punteggiatura, prova a guardare il carattere precedente.
      if (isWordChar(text[s - 1])) { s = s - 1; e = s; }
      else return { start: 0, end: 0 };
    }
    while (s > 0 && isWordChar(text[s - 1])) s--;
    while (e < text.length && isWordChar(text[e])) e++;
    return { start: s, end: e };
  }

  function sentenceAround(text, start, end) {
    let s = start;
    while (s > 0 && !/[.!?\n]/.test(text[s - 1])) s--;
    let e = end;
    while (e < text.length && !/[.!?\n]/.test(text[e])) e++;
    return text.slice(s, Math.min(e + 1, text.length)).trim();
  }

  // Calcola l'offset di carattere (0-based) nel TESTO COMPLETO dell'editabile
  // a partire da coordinate viewport. Funziona sia per textarea che per contenteditable.
  function caretCharOffsetFromPoint(el, clientX, clientY) {
    if (el.tagName === 'TEXTAREA') {
      // Per la textarea caretPositionFromPoint non serve: offsetNode non è la textarea.
      return textareaCharOffset(el, clientX, clientY);
    }
    const doc = el.ownerDocument || document;
    let node = null, offset = 0;
    if (doc.caretPositionFromPoint) {
      const cp = doc.caretPositionFromPoint(clientX, clientY);
      if (cp) { node = cp.offsetNode; offset = cp.offset; }
    } else if (doc.caretRangeFromPoint) {
      const r = doc.caretRangeFromPoint(clientX, clientY);
      if (r) { node = r.startContainer; offset = r.startOffset; }
    }
    if (node && el.contains(node)) {
      let total = 0;
      const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        if (n === node) return total + offset;
        total += n.nodeValue.length;
      }
    }
    // «Che carattere c'è in questo punto» si ferma al confine dei componenti web: dentro uno
    // shadow root la risposta è inutilizzabile, e lì misuriamo noi l'elemento (#438).
    return caretCharOffsetByRects(el, clientX, clientY);
  }

  // Quanti caratteri misurare uno per uno prima della ricerca binaria: su un nodo di testo
  // enorme un rettangolo per carattere costerebbe troppo.
  const RECT_SCAN_MAX = 400;
  const RECT_SCAN_WINDOW = 64;

  // Offset ricavato dalla sola geometria, confrontando i rettangoli dei caratteri col punto:
  // non chiede niente al documento, quindi vale anche nei componenti web. -1 se non cade lì.
  function caretCharOffsetByRects(el, clientX, clientY) {
    const doc = el.ownerDocument || document;
    let range;
    try { range = doc.createRange(); } catch (_) { return -1; }
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let total = 0, best = -1, bestDist = Infinity, n;
    while ((n = walker.nextNode())) {
      const len = n.nodeValue.length;
      if (!len) continue;
      let box = null;
      try { range.selectNodeContents(n); box = range.getBoundingClientRect(); } catch (_) {}
      // Solo i nodi la cui banda verticale contiene il punto: senza il filtro misureremmo tutto
      // il testo dell'editabile.
      if (box && (box.width || box.height)
          && clientY >= box.top - 2 && clientY <= box.bottom + 2) {
        const hit = charOffsetInTextNode(range, n, clientX, clientY);
        if (hit.exact) return total + hit.index;
        if (hit.index >= 0 && hit.dist < bestDist) { bestDist = hit.dist; best = total + hit.index; }
      }
      total += len;
    }
    return best;
  }

  function charOffsetInTextNode(range, node, clientX, clientY) {
    const len = node.nodeValue.length;
    const rectOf = (i) => {
      try {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        let fallback = null;
        for (const r of range.getClientRects()) {
          if (!r.width && !r.height) continue;
          if (clientY >= r.top && clientY <= r.bottom) return r;
          if (!fallback) fallback = r;
        }
        return fallback;
      } catch (_) { return null; }
    };
    // Posizione del carattere rispetto al punto nell'ordine di lettura:
    // -1 = prima (riga sopra o più a sinistra), +1 = dopo, 0 = lo contiene.
    const side = (r) => {
      if (clientY > r.bottom) return -1;
      if (clientY < r.top) return 1;
      if (clientX > r.right) return -1;
      if (clientX < r.left) return 1;
      return 0;
    };

    let lo = 0, hi = len;
    if (len > RECT_SCAN_MAX) {
      let a = 0, b = len - 1;
      while (a < b) {
        const mid = (a + b) >> 1;
        const r = rectOf(mid);
        const s = r ? side(r) : 0;
        if (s < 0) a = mid + 1;
        else if (s > 0) b = mid;
        else { a = mid; break; }
      }
      lo = Math.max(0, a - RECT_SCAN_WINDOW);
      hi = Math.min(len, a + RECT_SCAN_WINDOW);
    }

    let best = -1, bestDist = Infinity;
    for (let i = lo; i < hi; i++) {
      const r = rectOf(i);
      if (!r) continue;
      if (side(r) === 0) return { exact: true, index: i, dist: 0 };
      const dx = clientX < r.left ? r.left - clientX : (clientX > r.right ? clientX - r.right : 0);
      const dy = clientY < r.top ? r.top - clientY : (clientY > r.bottom ? clientY - r.bottom : 0);
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return { exact: false, index: best, dist: bestDist };
  }

  // Posizione di carattere in una textarea, ricostruendo il word-wrap con un canvas che
  // imita lo stile dell'elemento: costoso ma corretto.
  function textareaCharOffset(el, clientX, clientY) {
    const text = el.value;
    if (!text) return 0;
    const cs = window.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const px = clientX - r.left + el.scrollLeft - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.borderLeftWidth || 0);
    const py = clientY - r.top + el.scrollTop - parseFloat(cs.paddingTop || 0) - parseFloat(cs.borderTopWidth || 0);

    const lineHeight = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) * 1.2);
    const innerWidth = el.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);

    const canvas = textareaCharOffset._canvas || (textareaCharOffset._canvas = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;

    const wrap = cs.whiteSpace !== 'pre' && cs.whiteSpace !== 'nowrap';
    const lines = [];
    const paragraphs = text.split('\n');
    function lineStartOffset(idx) {
      let off = 0;
      for (let i = 0; i < idx; i++) off += paragraphs[i].length + 1;
      return off;
    }
    for (let p = 0; p < paragraphs.length; p++) {
      const para = paragraphs[p];
      if (!wrap) { lines.push({ text: para, startOffset: lineStartOffset(p) }); continue; }
      let cursor = 0;
      while (cursor <= para.length) {
        let lineEnd = cursor;
        let lastSpace = -1;
        let widthAcc = 0;
        for (let i = cursor; i <= para.length; i++) {
          if (i < para.length) {
            const ch = para[i];
            const w = ctx.measureText(ch).width;
            if (widthAcc + w > innerWidth && lastSpace > cursor) {
              lineEnd = lastSpace + 1;
              break;
            }
            if (ch === ' ') lastSpace = i;
            widthAcc += w;
          } else {
            lineEnd = para.length + 1;
            break;
          }
        }
        if (lineEnd === cursor) lineEnd = cursor + 1;
        const startOffset = lineStartOffset(p) + cursor;
        lines.push({ text: para.slice(cursor, Math.min(lineEnd, para.length)), startOffset });
        if (lineEnd > para.length) break;
        cursor = lineEnd;
      }
      if (para === '' && p < paragraphs.length - 1) {
        lines.push({ text: '', startOffset: lineStartOffset(p) });
      }
    }

    const lineIdx = Math.max(0, Math.min(lines.length - 1, Math.floor(py / lineHeight)));
    const line = lines[lineIdx];
    if (!line) return 0;

    let lo = 0, hi = line.text.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const w = ctx.measureText(line.text.slice(0, mid)).width;
      if (w < px) lo = mid + 1;
      else hi = mid;
    }
    return line.startOffset + Math.max(0, Math.min(line.text.length, lo));
  }


  // ============================================================================
  // La pagina intorno al campo
  // ============================================================================
  // Il testo della pagina intorno al campo, dal più vicino: in una chat la conversazione (gli ultimi messaggi stanno
  // subito sopra la casella), altrove il contenuto principale. Niente di nascosto, niente UI di Filo, niente altri campi.
  const RADICI_CONTESTO = 'main, [role="main"], #main, article, [role="dialog"], dialog';
  const TAG_SALTATI = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
    'DATALIST', 'BUTTON', 'SVG', 'svg', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'VIDEO', 'AUDIO', 'NAV', 'ASIDE', 'HEAD']);
  const RUOLI_SALTATI = new Set(['navigation', 'complementary', 'menu', 'menubar', 'listbox', 'tooltip', 'button', 'search']);
  const TAG_IN_RIGA = new Set(['A', 'ABBR', 'B', 'BDI', 'BDO', 'CITE', 'CODE', 'DATA', 'DFN', 'EM', 'FONT', 'I', 'KBD',
    'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR', 'LABEL']);

  function radiceContesto(el) {
    let r = el.parentElement && el.parentElement.closest(RADICI_CONTESTO);
    // Un riquadro piccolo (la scheda di un post) non basta: si sale al contenitore successivo.
    while (r) {
      const su = r.parentElement && r.parentElement.closest(RADICI_CONTESTO);
      const proprio = el.isContentEditable ? (el.textContent || '').length : 0;
      if (!su || (r.textContent || '').length - proprio >= 600) break;
      r = su;
    }
    if (r) return r;
    const root = el.getRootNode();
    if (root && root.nodeType === 11) return root;
    return el.ownerDocument.body || el.ownerDocument.documentElement;
  }

  function contestoDelCampo(el, { soloPrima = 0 } = {}) {
    const vuoto = { prima: '', dopo: '', troncato: false };
    // Nei riquadri di Filo intorno c'è Filo, non la pagina.
    if (!el || radiceDi(el)) return vuoto;
    try {
      const radice = radiceContesto(el);
      const UI = global.SN_FILO_UI;
      const doc = el.ownerDocument;
      const filtro = {
        acceptNode(n) {
          if (n === el || el.contains(n)) return NodeFilter.FILTER_REJECT;
          if (n.nodeType === 3) return /\S/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
          if (n.contains(el)) return NodeFilter.FILTER_SKIP;
          if (TAG_SALTATI.has(n.tagName) || (UI && UI.is(n))) return NodeFilter.FILTER_REJECT;
          const ruolo = n.getAttribute('role');
          if (ruolo && RUOLI_SALTATI.has(ruolo)) return NodeFilter.FILTER_REJECT;
          if (n.getAttribute('aria-hidden') === 'true') return NodeFilter.FILTER_REJECT;
          const ce = n.getAttribute('contenteditable');
          if (ce === '' || ce === 'true' || ce === 'plaintext-only') return NodeFilter.FILTER_REJECT;
          if (typeof n.checkVisibility === 'function' && !n.checkVisibility({ visibilityProperty: true })) return NodeFilter.FILTER_REJECT;
          return n.tagName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        },
      };
      const blocco = (n) => {
        let e = n.nodeType === 3 ? n.parentElement : n;
        while (e && e !== radice && TAG_IN_RIGA.has(e.tagName)) e = e.parentElement;
        return e;
      };
      const raccogli = (avanti, tetto) => {
        const w = doc.createTreeWalker(radice, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, filtro);
        w.currentNode = el;
        const pezzi = [];
        let lunghezza = 0;
        let visti = 0;
        let n;
        while ((n = avanti ? w.nextNode() : w.previousNode())) {
          if (++visti > CONTESTO_NODI_MAX) return { pezzi, pieno: true };
          const t = n.nodeType === 3 ? n.nodeValue.replace(/\s+/g, ' ') : '\n';
          pezzi.push({ t, b: n.nodeType === 3 ? blocco(n) : n });
          lunghezza += t.length;
          if (lunghezza > tetto) return { pezzi, pieno: true };
        }
        return { pezzi, pieno: false };
      };
      const cuci = (pezzi) => {
        let s = '';
        let prima = null;
        for (const p of pezzi) {
          if (prima && p.b !== prima) s += '\n';
          s += p.t;
          prima = p.b;
        }
        return s.replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{2,}/g, '\n').trim();
      };
      const dopo = soloPrima ? { pezzi: [], pieno: false } : raccogli(true, CONTESTO_DOPO_MAX);
      let testoDopo = cuci(dopo.pezzi);
      if (testoDopo.length > CONTESTO_DOPO_MAX) testoDopo = testoDopo.slice(0, CONTESTO_DOPO_MAX);
      const tettoPrima = soloPrima || CONTESTO_MAX - testoDopo.length;
      const prima = raccogli(false, tettoPrima);
      let testoPrima = cuci(prima.pezzi.reverse());
      if (testoPrima.length > tettoPrima) testoPrima = testoPrima.slice(-tettoPrima);
      return { prima: testoPrima, dopo: testoDopo, troncato: prima.pieno || dopo.pieno };
    } catch (e) {
      console.warn('[SN] coerenza — contesto non letto:', e);
      return vuoto;
    }
  }

  // ============================================================================
  // Applicazione correzioni
  // ============================================================================
  // Come una battuta, dall'editing del browser: il correttore nativo sposta i segni delle altre parole invece di
  // perderli (riscrivere il valore cancella tutto lo zigzag rosso del campo, #1111), e Ctrl+Z annulla la correzione.
  // Falso se il campo è rimasto com'era: allora lo si riscrive.
  function sostituisciComeBattuta(el, range, testo, cursorMode) {
    testo = String(testo ?? '');
    const prima = el.value;
    const caret = el.selectionEnd;
    // Una battuta rispetta maxlength e taglierebbe la correzione a metà.
    if (el.maxLength >= 0 && prima.length - (range.end - range.start) + testo.length > el.maxLength) return false;
    try {
      const radice = el.getRootNode();
      if (radice.activeElement !== el) el.focus({ preventScroll: true });
      if (radice.activeElement !== el) return false;
      el.setSelectionRange(range.start, range.end);
      // Il documento del campo: quello di un riquadro, quando lo corregge la pagina («Valuta», #1449).
      const doc = el.ownerDocument || document;
      if (testo) doc.execCommand('insertText', false, testo);
      else if (range.end > range.start) doc.execCommand('delete', false);
    } catch (_) {}
    if (el.value === prima) return false;
    if (cursorMode === 'preserve' && typeof caret === 'number') {
      const dove = caret >= range.end ? caret + testo.length - (range.end - range.start) : caret;
      try { el.setSelectionRange(dove, dove); } catch (_) {}
    }
    return true;
  }

  // Una correzione applicata da Filo: Ctrl/Cmd+Z subito dopo la disfa, e i contatori lo sanno (#1461).
  function applyFix(el, range, replacement, opts = {}) {
    const prima = getEditableText(el);
    const r = applicaCorrezione(el, range, replacement, opts);
    try {
      if (getEditableText(el) !== prima) global.SN_POPUP?.modificaDiFilo?.(el, opts.automatica ? 'correzione-automatica' : 'correzione');
    } catch (_) {}
    return r;
  }

  function applicaCorrezione(el, range, replacement, opts = {}) {
    const safeReplacement = String(replacement == null ? '' : replacement);
    // 'end' = caret a fine inserzione (popup del correttore). 'preserve' = caret dov'era:
    // nell'autocorrect si è appena digitato lo spazio e il caret deve restare dopo di esso.
    const cursorMode = opts.cursor || 'end';
    // Se il testo atteso a [start, end) non corrisponde più si abortisce: è la guardia contro
    // «Risolvi cancella tutta la frase» con offset vecchi.
    const expected = typeof opts.expectedSegment === 'string' ? opts.expectedSegment : null;
    const currentText = getEditableText(el);
    if (expected !== null) {
      const actual = currentText.slice(range.start, range.end);
      if (actual !== expected) {
        console.warn('[SN] applyFix: testo cambiato fra scan e fix, skip', { expected, actual });
        return;
      }
    }
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const v = el.value;
      // Range fuori dai limiti o inizio ≥ fine: si esce. Senza, lo slice oltre la lunghezza
      // torna vuoto e il salvataggio cancella tutto il testo dopo range.start.
      if (typeof range.start !== 'number' || typeof range.end !== 'number' ||
          range.start < 0 || range.end > v.length || range.end <= range.start) {
        console.warn('[SN] applyFix: range fuori bounds, skip', { range, length: v.length });
        return;
      }
      if (!sostituisciComeBattuta(el, range, safeReplacement, cursorMode)) {
        try {
          el.setRangeText(safeReplacement, range.start, range.end, cursorMode === 'preserve' ? 'preserve' : 'end');
        } catch (_) {
          const before = v.slice(0, range.start);
          const after = v.slice(range.end);
          el.value = before + safeReplacement + after;
          const caret = before.length + safeReplacement.length;
          try { el.setSelectionRange(caret, caret); } catch (_) {}
        }
        // Segnato come nostro: un campo di un riquadro di Filo, chiuso ai finti, deve sentire la correzione.
        el.dispatchEvent(global.SN_FILO_UI?.nostro ? global.SN_FILO_UI.nostro(new Event('input', { bubbles: true })) : new Event('input', { bubbles: true }));
      }
    } else {
      const text = el.textContent || '';
      if (range.start < 0 || range.end > text.length || range.end <= range.start) {
        console.warn('[SN] applyFix CE: range fuori bounds, skip', { range, length: text.length });
        return;
      }
      // Salva l'offset originale del caret, per ripristinarlo in modalità 'preserve'.
      const caretBefore = cursorMode === 'preserve' ? contenteditableCaretOffset(el) : -1;
      const doc = el.ownerDocument || document;
      const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let cur = 0, startNode = null, startOff = 0, endNode = null, endOff = 0, n;
      while ((n = walker.nextNode())) {
        const len = n.nodeValue.length;
        // Un pezzo che comincia dove finisce un nodo comincia nel nodo dopo: preso dalla fine di quello prima, la
        // selezione si porterebbe dietro l'a capo fra i due e la battuta lo cancellerebbe (#1447).
        if (!startNode && cur + len > range.start) {
          startNode = n; startOff = range.start - cur;
        }
        if (!endNode && cur + len >= range.end) {
          endNode = n; endOff = range.end - cur;
          break;
        }
        cur += len;
      }
      if (!startNode || !endNode) return;

      const sel = (doc.defaultView || window).getSelection();
      const r = doc.createRange();
      try {
        r.setStart(startNode, startOff);
        r.setEnd(endNode, endOff);
      } catch (e) {
        console.warn('[SN] applyFix CE: range inválido', e);
        return;
      }
      sel.removeAllRanges();
      sel.addRange(r);

      // Prima execCommand('insertText'): passa dal pipeline beforeinput/input nativo, così gli
      // editor controllati (Slate, Lexical) aggiornano il modello invece di resettare il DOM.
      let ok = false;
      try {
        if (safeReplacement.length > 0) {
          ok = doc.execCommand('insertText', false, safeReplacement);
        } else {
          ok = doc.execCommand('delete', false);
        }
      } catch (_) {}
      // La battuta lascia il cursore dopo la parola inserita: la correzione a fine parola lo rimette dopo lo spazio, se
      // no il tasto dopo scriverebbe attaccato alla parola.
      if (ok && cursorMode === 'preserve' && caretBefore >= 0) {
        const delta = safeReplacement.length - (range.end - range.start);
        const cr = document.createRange();
        placeCaretAtOffset(el, caretBefore >= range.end ? caretBefore + delta : caretBefore, cr);
        sel.removeAllRanges();
        sel.addRange(cr);
      }

      if (!ok) {
        try {
          // Riapplica la selezione se execCommand l'ha alterata, poi DOM-mutation.
          sel.removeAllRanges();
          sel.addRange(r);
          r.deleteContents();
          let newNode = null;
          if (safeReplacement.length > 0) {
            newNode = doc.createTextNode(safeReplacement);
            r.insertNode(newNode);
          }
          const cr = doc.createRange();
          if (cursorMode === 'preserve' && caretBefore >= 0) {
            const delta = safeReplacement.length - (range.end - range.start);
            const target = caretBefore >= range.end ? caretBefore + delta : caretBefore;
            placeCaretAtOffset(el, target, cr);
          } else if (newNode) {
            cr.setStartAfter(newNode);
            cr.collapse(true);
          } else {
            cr.setStart(startNode, startOff);
            cr.collapse(true);
          }
          sel.removeAllRanges();
          sel.addRange(cr);
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: safeReplacement }));
        } catch (e) {
          console.warn('[SN] applyFix CE fallback failed:', e);
        }
      }
    }
    // Una correzione scelta dall'utente, di una parola sola, insegna (#1447); quelle che Filo fa da sé no.
    if (expected !== null && !opts.automatica && safeReplacement && !/\s/.test(expected.trim())
      && getEditableText(el).slice(range.start, range.start + safeReplacement.length) === safeReplacement) {
      accettata(expected, safeReplacement);
    }
    // Il segno corretto cade col testo che cambia (anche se l'input non è arrivato). Una correzione scelta dal menu è un
    // gesto: i controlli rileggono il pezzo. L'autocorrezione (`preserve`) arriva battendo, e lì li programma il tasto.
    const state = monitored.get(el);
    if (state) {
      seguiIlTesto(state);
      if (getEditableText(el) === currentText) {
        state.modello = state.modello.filter((i) => !(i.start === range.start && i.end === range.end));
      }
      aggiornaCodice(state);
      if (cursorMode !== 'preserve' && state.attivo) {
        programmaRapido(state, { gesto: true });
        programmaRagionato(state, { gesto: true });
      }
    }
  }

  // ============================================================================
  // Le correzioni di «Valuta» (#1449)
  // ============================================================================
  // Il testo del campo come lo legge il modello, con le sue righe; una correzione è un pezzo scritto su quel testo.
  function testoDelCampo(el) {
    try { return el && el.isConnected ? testoDaControllare(el).testo : ''; } catch (_) { return ''; }
  }

  // Un modello riscrive apostrofi, virgolette, lineette e spazi: se il pezzo esatto non c'è, si cerca con quei segni
  // resi uguali. `da[k]` è la posizione nel testo vero del carattere k del testo piegato.
  const PIEGA = {
    '‘': "'", '’': "'", '‚': "'", 'ʼ': "'", '′': "'",
    '“': '"', '”': '"', '„': '"', '«': '"', '»': '"',
    '–': '-', '—': '-', '…': '...',
  };
  function piega(s) {
    let out = '';
    const da = [];
    let spazio = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (/[­​-‏⁠﻿]/.test(c)) continue;
      if (/\s/.test(c)) {
        if (!spazio) { out += ' '; da.push(i); }
        spazio = true;
        continue;
      }
      spazio = false;
      for (const ch of PIEGA[c] || c) { out += ch; da.push(i); }
    }
    return { out, da };
  }

  // Fra due pezzi uguali vince quello più vicino a `vicinoA`: lì l'aveva visto il modello, o lì era stato scritto.
  function cercaPezzo(testo, pezzo, vicinoA) {
    const tutte = (h, n) => {
      const r = [];
      for (let i = n ? h.indexOf(n) : -1; i >= 0; i = h.indexOf(n, i + 1)) r.push(i);
      return r;
    };
    const vicina = (lista) => lista.reduce((m, r) => (Math.abs(r.start - vicinoA) < Math.abs(m.start - vicinoA) ? r : m));
    const esatte = tutte(testo, pezzo).map((i) => ({ start: i, end: i + pezzo.length }));
    if (esatte.length) return vicina(esatte);
    const t = piega(testo);
    const p = piega(pezzo).out;
    const piegate = tutte(t.out, p).map((j) => ({ start: t.da[j], end: t.da[j + p.length - 1] + 1 }));
    return piegate.length ? vicina(piegate) : null;
  }

  // Scrive `dopo` al posto di `prima` come la correzione del menu (Ctrl+Z la annulla). `{ dove }` è l'inizio del pezzo
  // nuovo nel testo del campo; `{ manca }` se `prima` non c'è più, `{ fermo }` se il campo non si è lasciato scrivere.
  function sostituisciNelCampo(el, prima, dopo, vicinoA = 0) {
    if (!el || !el.isConnected) return { manca: true };
    const pezzo = String(prima || '');
    if (!pezzo) return { manca: true };
    const { testo, riporta } = testoDaControllare(el);
    const trovato = cercaPezzo(testo, pezzo, Number(vicinoA) || 0);
    const r = trovato ? riporta([trovato])[0] : null;
    if (!r) return { manca: true };
    const campo = getEditableText(el);
    // Il fuoco sta nell'Aiuto: la selezione di un campo modificabile vale per il browser solo nel campo a fuoco.
    if (!campoDiTesto(el)) { try { el.focus({ preventScroll: true }); } catch (_) {} }
    applyFix(el, r, String(dopo == null ? '' : dopo), { expectedSegment: campo.slice(r.start, r.end) });
    return getEditableText(el) !== campo ? { dove: trovato.start } : { fermo: true };
  }

  // ============================================================================
  // Suggerimenti correttore nativo (Electron)
  // ============================================================================
  // Ritorna i suggerimenti nativi per `word` se sono recenti e riferiti a quella
  // parola; altrimenti []. Usato dal menu di correzione (content.js) come fonte
  // immediata e affidabile, in parallelo al suggerimento contestuale dell'LLM.
  function getNativeSuggestions(word) {
    if (!word || !lastNative.word) return [];
    if (lastNative.word.toLowerCase() !== String(word).toLowerCase()) return [];
    if (Date.now() - lastNative.ts > 4000) return [];
    return lastNative.suggestions.slice();
  }

  // Callback una-tantum per la prossima notifica nativa, qualunque sia la parola: su un
  // <input> quale sia lo dice Electron. `opts.since` recupera il broadcast arrivato in mezzo.
  function onNextNativeSuggestion(cb, opts = {}) {
    const timeoutMs = typeof opts === 'number' ? opts : (opts.timeoutMs || 600);
    const since = (typeof opts === 'object' && opts.since) || 0;
    let done = false;
    let timer = null;
    const finish = () => { done = true; nativeWaiters.delete(waiter); clearTimeout(timer); };
    const waiter = (n) => {
      if (done) return;
      finish();
      cb({ word: n.word, suggestions: (n.suggestions || []).slice() });
    };
    if (since && lastNative.ts >= since && lastNative.word) {
      // Già arrivato durante l'await: consegna sincrona al prossimo tick.
      const snapshot = lastNative;
      setTimeout(() => waiter(snapshot), 0);
      timer = setTimeout(finish, timeoutMs);
      return finish;
    }
    nativeWaiters.add(waiter);
    timer = setTimeout(finish, timeoutMs);
    return finish;
  }

  // Callback una-tantum per i suggerimenti nativi di `word` quando non ci sono già: il
  // broadcast dal main può ritardare di qualche ms. Ritorna la funzione per annullare.
  function onNativeSuggestions(word, cb, timeoutMs = 800) {
    const have = getNativeSuggestions(word);
    if (have.length) { setTimeout(() => cb(have), 0); return () => {}; }
    let done = false;
    const finish = () => { done = true; nativeWaiters.delete(waiter); clearTimeout(timer); };
    const waiter = (n) => {
      if (done || !word) return;
      if (n.word && n.word.toLowerCase() === String(word).toLowerCase()) {
        finish();
        cb((n.suggestions || []).slice());
      }
    };
    nativeWaiters.add(waiter);
    const timer = setTimeout(finish, timeoutMs);
    return finish;
  }


  // ============================================================================
  // API pubblica
  // ============================================================================
  global.SN_SPELLCHECK = {
    init,
    updateSettings,
    erroriAttivi,
    suggerimentiAttivi,
    segnapostiAttivi,
    modelloErrori,
    isSupportedEditable,
    findSupportedEditable,
    campoEscluso,
    segniSotto,
    giudicaOra,
    seguiSegno,
    correggi,
    ignora,
    aggiungiAlDizionario,
    parolaGiusta,
    erroriDaCorreggere,
    correggiTutti,
    riempi,
    cercaDiNuovo,
    valoreSotto,
    controlloSuRichiesta,
    proposteDelBrowser,
    sbagliataPerIlBrowser,
    contestoDelCampo,
    getWordAt,
    getInputWordAt,
    applyFix,
    propostaMostrata,
    esitoProposta,
    esitoSegno,
    chiaveSegno,
    testoDelCampo,
    sostituisciNelCampo,
    sostituisciComeBattuta,
    riallineaIssues,
    addToDictionary,
    isInDictionary,
    setAutocorrect,
    automaticaAttiva,
    automaticaSotto,
    annullaAutomatica,
    accettata,
    getNativeSuggestions,
    onNativeSuggestions,
    onNextNativeSuggestion,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
