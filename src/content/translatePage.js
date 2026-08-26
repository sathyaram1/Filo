// Traduzione dell'intera pagina (voce globale del menu) + ripristino del
// testo originale. Lo stato "sta traducendo / ha una traduzione attiva" vive
// qui; il menu lo legge via hasTranslation() per decidere icona ed etichetta.
// Estratto da content.js — viene caricato prima di lui dai preload.
//
// Le unità da tradurre arrivano da Extract.extractTranslatableBlocks(): TUTTO
// il testo visibile della pagina (titoli, sommari, didascalie, riquadri
// laterali, voci di menu, link), non solo i paragrafi dell'articolo.
//
// Ricostruzione: i figli di un'unità diventano segnaposto [[Lk]] nel testo
// mandato al modello e vengono rimessi al loro posto come NODI VIVI (non come
// HTML ri-parsato), così link, immagini e componenti interattivi conservano
// listener e stato. Il testo tradotto entra come text node: nessun HTML del
// modello finisce mai nella pagina.

(function (global) {
  'use strict';

  const { ACTIONS } = global.SN_CONST;
  const { MSG } = global.SN_MSG;
  const I18n = global.SN_I18N;
  const Popup = global.SN_POPUP;
  const Extract = global.SN_EXTRACT;

  const CHUNK_SIZE = 3000;      // caratteri per richiesta
  const CONCURRENCY = 3;        // richieste in parallelo (l'attesa è attrito)
  // Giri di lavoro in un colpo solo. Sulle pagine che si allungano mentre le
  // scorri il testo nuovo arriva PROPRIO mentre traduciamo: fermarsi al primo
  // giro vuol dire lasciarlo in lingua originale sotto un avviso che dichiara
  // finito (#407). Il tetto esiste perché su un sito che carica all'infinito
  // rincorrerlo non finirebbe mai: dopo, se ne è arrivato dell'altro, lo dice e
  // il menu offre di prenderlo.
  const MAX_PASSES = 3;
  const MAX_SPLIT_DEPTH = 4;    // bisezione massima quando il modello sballa i separatori
  const SEPARATOR = '\n@@@SN_SEP@@@\n';
  const SEP_RE = /\n?@@@\s*SN_SEP\s*@@@\n?/;
  const PLACEHOLDER_RE = /\[\[\s*L\s*(\d+)\s*\]\]/g;

  const HAS_LETTER = /\p{L}/u;

  // Riquadri incorporati (#407). Sotto queste misure non c'è un post
  // incorporato né un blocco commenti: c'è un pixel di tracciamento o uno
  // spaziatore. Non si traducono e non entrano nel conto di ciò che è rimasto
  // fuori — un avviso "una parte è rimasta in lingua originale" che scatta per
  // un iframe da 1×1 manda l'utente a cercare del testo che non esiste.
  const FRAME_MIN_W = 120;
  const FRAME_MIN_H = 40;
  // Tempo dato a un riquadro per farsi vivo. Chi non risponde entro questo
  // momento non ha script (sandbox chiuso): è esattamente il caso in cui
  // l'avviso deve dire che una parte è rimasta fuori.
  const FRAME_ACK_GRACE = 2500;
  // Tetto all'attesa di chi si è fatto vivo e sta lavorando. Non è un timer da
  // consumare: si esce appena tutti hanno finito.
  const FRAME_WORK_CAP = 60000;

  // Errore "vuoto": il modello ha risposto, ma senza testo. Non è un guasto —
  // la richiesta è partita e la risposta è tornata — e non va raccontato come
  // tale: "Qualcosa è andato storto. Riprova" non dice niente e contraddice la
  // riga che segue, che invita a riprendere. La frase giusta esiste già e parla
  // di blocchi tornati vuoti dal modello.
  const EMPTY_ANSWER = { emptyAnswer: true };

  let pageTranslating = false;
  let pageHasTranslation = false;
  // Traduzione arrivata in fondo? Distinguere "completa" da "a metà" è ciò che
  // permette al menu di offrire "Riprendi traduzione" invece di far ricominciare
  // tutto da capo (#408). Vale solo se pageHasTranslation è vero.
  let pageComplete = false;
  // Quanti blocchi mancano all'ultimo tentativo e quanti erano in tutto: serve
  // a dire all'utente *quanto* ne manca, non solo che si è interrotta.
  let missingCount = 0;
  let totalCount = 0;
  // Unità tradotte in questa sessione, con i NODI originali (non l'HTML): è ciò
  // che "Mostra originale" rimette al suo posto.
  let translatedUnits = [];
  // Etichette tradotte (attributi), con il valore di prima — e se l'attributo
  // prima non c'era affatto, per poterlo togliere invece di lasciarne uno finto.
  let translatedAttrs = [];
  // Testo arrivato DOPO che la traduzione si era dichiarata finita (#407): sui
  // siti che allungano la pagina mentre si scorre, o che cambiano schermata
  // senza ricaricare, è la normalità. Senza accorgersene, l'unico modo di
  // averlo in italiano era tornare all'originale e ripagare tutta la pagina.
  let newContentSeen = false;
  let contentObserver = null;
  // Sottoalberi che al momento della traduzione erano nascosti (fisarmoniche
  // chiuse, schede in secondo piano, "leggi tutto" ripiegati). Non sono stati
  // tradotti — l'utente non li vede — ma se li apre il menu deve offrire di
  // tradurli: scoprire del testo e riceverlo dal sito, per chi guarda lo
  // schermo, sono la stessa cosa (#407).
  let hiddenSkipped = [];
  // Numero d'ordine del lavoro in corso. Chi chiede l'originale lo fa avanzare:
  // le richieste rimaste in volo si accorgono di non essere più quelle buone e
  // si buttano via, invece di scaricarsi addosso a una pagina che l'utente ha
  // appena riportato indietro (#407).
  let runSeq = 0;
  // L'avviso "sto traducendo" del giro in corso. Serve a chi lo FERMA: le
  // richieste già spedite tornano quando vogliono, e finché non tornano il
  // riquadro "Traduzione pagina in corso…" resterebbe sullo schermo accanto a
  // "Traduzione annullata". Una cosa che si ferma deve sembrare ferma subito.
  let progressToast = null;

  function closeProgressToast() {
    if (!progressToast) return;
    try { progressToast.close(); } catch (_) {}
    progressToast = null;
  }

  async function translatePage() {
    // Riclic mentre traduce: l'avviso "in corso" è già sullo schermo (dura
    // quanto il lavoro), un secondo riquadro identico sopra sarebbe solo rumore.
    if (pageTranslating) return;
    pageTranslating = true;
    const myRun = ++runSeq;
    const aborted = () => myRun !== runSeq;
    // L'avviso "sto traducendo" dura quanto la traduzione e viene SOSTITUITO
    // dall'esito: due riquadri sovrapposti nell'angolo sono illeggibili.
    const progress = Popup.showToast(I18n.t('toast_translating_page'), { duration: 0 });
    progressToast = progress;
    // Sorveglianza accesa PRIMA di cominciare: scorrere mentre si aspetta è il
    // comportamento normale, e il testo che il sito carica in quei secondi è
    // testo che l'utente vede restare in lingua originale. Le nostre
    // sostituzioni non la ingannano: nascono già marcate come tradotte.
    newContentSeen = false;
    startWatchingNewContent();

    let result = null;
    try {
      for (let pass = 0; pass < MAX_PASSES; pass++) {
        // Da qui in poi, quel che compare è arrivato DOPO l'inizio del giro.
        newContentSeen = false;
        result = await runPass(progress, myRun);
        if (aborted()) return;
        // Il sito ha allungato la pagina mentre lavoravamo: la finiamo adesso,
        // senza far ricliccare e senza rimandare al modello ciò che è già
        // fatto. Vale anche quando il primo giro non aveva trovato niente: su
        // una schermata che si disegna in ritardo, "non ho trovato testo" mentre
        // il testo sta comparendo è la stessa bugia. Se invece il giro si è
        // interrotto, l'avviso lo dice già e sarà la ripresa a prendere il resto.
        if (!newContentSeen || (result.kind !== 'done' && result.kind !== 'none')) break;
      }
      if (aborted()) return;
      progress.close();
      showResultToast(result, newContentSeen);
    } finally {
      progress.close();
      if (progressToast === progress) progressToast = null;
      // Se nel frattempo l'utente ha annullato (o ha già fatto ripartire un
      // altro giro), lo stato non è più nostro: toccarlo vorrebbe dire spegnere
      // il lavoro di qualcun altro.
      if (myRun === runSeq) {
        pageTranslating = false;
        // Nessuna traduzione in piedi: niente da continuare, e nessun motivo di
        // tenere una sentinella addosso alla pagina.
        if (!pageHasTranslation) {
          stopWatchingNewContent();
          newContentSeen = false;
          hiddenSkipped = [];
        }
      }
    }
  }

  // Un giro di lavoro: rilegge la pagina, manda al modello solo ciò che non è
  // già tradotto, applica. Ritorna com'è andata; l'avviso lo scrive chi chiama,
  // che è l'unico a sapere se nel frattempo è arrivato dell'altro.
  async function runPass(progress, myRun) {
    const blocks = Extract.extractTranslatableBlocks();
    // I componenti aperti del sito sono alberi a parte: una sentinella sul solo
    // documento non vede il contenuto che cambia lì dentro.
    addWatchRoots(blocks.shadowRoots);
    hiddenSkipped = blocks.hidden || [];
    // Pezzi di pagina che nessuno script può leggere (#439): non entrano nel
    // lavoro, ma cambiano l'avviso finale — "Pagina tradotta" sarebbe falso.
    const unreachable = Number(blocks.unreachable || 0);
    // Blocchi oltre il tetto di un giro solo: non sono persi, si prendono
    // alla ripresa. Entrano nei totali perché è l'unico modo perché l'avviso
    // finale non menta su una pagina enorme.
    const truncated = Number(blocks.truncated || 0);

    // Per ogni unità: i figli (link, img, span, …) diventano segnaposto [[Lk]],
    // così il modello traduce solo il testo e la struttura resta intatta.
    // Blocchi già tradotti da un giro precedente interrotto a metà: NON
    // tornano dall'estrazione (vengono saltati alla fonte) e non vanno
    // rimandati al modello — sarebbe testo pagato due volte. Qui servono solo
    // a dare i totali giusti a chi legge l'avviso (#408).
    const doneBefore = Extract.findTranslatedElements();
    const already = doneBefore.length + Number(doneBefore.attrCount || 0);
    const units = [];
    for (const b of blocks) {
      if (b.el && b.el.dataset && b.el.dataset.snTranslated) continue;
      const { templated, refs } = templateizeBlock(b.el);
      // Se tolti i segnaposto non resta testo, non c'è nulla da tradurre.
      if (!hasTranslatableText(templated)) continue;
      units.push({ el: b.el, templated, refs, run: myRun });
    }
    // Etichette (placeholder, suggerimenti, descrizioni delle immagini, voci
    // dei menu a tendina, scritte sui bottoni): stessa coda di lavoro, si
    // applicano scrivendo l'attributo invece di sostituire i figli.
    for (const a of (blocks.attrs || [])) {
      if (!a.el || !hasTranslatableText(a.text)) continue;
      units.push({ el: a.el, attr: a.attr, templated: a.text, refs: [], run: myRun });
    }

    if (!units.length) {
      if (truncated) {
        // Niente di nuovo da mandare in questo giro, ma la coda della pagina
        // esiste: non è finita, e va detto.
        pageHasTranslation = already > 0;
        pageComplete = false;
        totalCount = already + truncated;
        missingCount = truncated;
        return { kind: 'batch', applied: already, total: totalCount };
      }
      if (already) {
        // Ripresa su una pagina che nel frattempo è già tutta tradotta.
        pageHasTranslation = true;
        pageComplete = true;
        missingCount = 0;
        totalCount = already;
        return { kind: 'done', unreachable };
      }
      if (unreachable) {
        // Pagina fatta solo di componenti chiusi: non è "niente da tradurre",
        // è testo che non riusciamo a leggere. Dire l'una per l'altra
        // manderebbe l'utente a riprovare all'infinito.
        return { kind: 'onlyClosed' };
      }
      return { kind: 'none' };
    }

    // Chunking: aggrega unità fino a ~3000 caratteri per richiesta.
    const chunks = [];
    let cur = [];
    let curLen = 0;
    for (const u of units) {
      const len = u.templated.length + SEPARATOR.length;
      if (curLen + len > CHUNK_SIZE && cur.length) {
        chunks.push(cur);
        cur = [];
        curLen = 0;
      }
      cur.push(u);
      curLen += len;
    }
    if (cur.length) chunks.push(cur);

    // Avanzamento REALE mentre lavora: i blocchi hanno un totale noto, quindi
    // l'attesa può essere misurata invece che raccontata ("l'attesa è attrito":
    // se ci sono dati di progresso si mostrano).
    const grandTotal = already + units.length + truncated;
    const tick = () => {
      const applied = already + units.filter((u) => u.applied).length;
      try { progress.el.textContent = I18n.t('toast_translating_page_progress', applied, grandTotal); } catch (_) {}
    };
    tick();

    // Le richieste partono a gruppi e i risultati vengono applicati appena
    // arrivano: la pagina si traduce progressivamente sotto gli occhi.
    let lastError = null;
    let next = 0;
    const worker = async () => {
      // Se l'utente ha chiesto l'originale, quel che resta non parte nemmeno:
      // non si continua a lavorare (e a far pagare) contro la sua ultima parola.
      while (next < chunks.length && myRun === runSeq) {
        const chunk = chunks[next++];
        const err = await translateGroup(chunk, 0);
        if (err) lastError = err;
        tick();
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker),
    );
    if (myRun !== runSeq) return { kind: 'aborted' };

    const done = units.filter((u) => u.applied).length;
    const applied = already + done;
    totalCount = grandTotal;
    missingCount = grandTotal - applied;

    if (!applied) {
      // Niente tradotto: né prima né adesso. Nessuno stato da conservare.
      pageHasTranslation = false;
      pageComplete = false;
      return { kind: 'failed', reason: reasonFor(lastError) };
    }

    pageHasTranslation = true;
    // NB: i componenti chiusi non rendono la traduzione "riprendibile" —
    // riprovare non li aprirà mai. Lo stato resta quindi completo (il menu
    // offre "Mostra originale", non "Riprendi": riprendere non farebbe
    // nulla), ed è l'AVVISO a dire che una parte è rimasta fuori.
    pageComplete = missingCount === 0;
    if (pageComplete) return { kind: 'done', unreachable };
    // Nessun guasto: la pagina è semplicemente più lunga di un giro solo.
    // "Interrotta" suonerebbe come un errore che non c'è stato.
    if (!lastError && truncated) return { kind: 'batch', applied, total: grandTotal };
    // MAI "Pagina tradotta" quando non lo è: si dice che si è interrotta,
    // quanto manca e come riprendere (il motivo tecnico grezzo resta fuori).
    return { kind: 'stopped', applied, total: grandTotal, reason: reasonFor(lastError) };
  }

  // L'esito, detto all'utente. `moreArrived` è l'unica cosa che chi ha fatto il
  // lavoro non può sapere: il sito ha continuato ad aggiungere testo anche
  // durante l'ultimo giro, e noi abbiamo smesso di rincorrerlo.
  function showResultToast(result, moreArrived) {
    if (!result) return;
    switch (result.kind) {
      case 'batch':
        Popup.showToast(I18n.t('toast_page_translate_batch', result.applied, result.total), { duration: 7000 });
        return;
      case 'onlyClosed':
        Popup.showToast(I18n.t('toast_only_closed_components'), { duration: 7000 });
        return;
      case 'none':
        Popup.showToast(I18n.t('toast_nothing_to_translate'));
        return;
      case 'failed':
        Popup.showToast(I18n.t('toast_page_translate_failed', result.reason), { duration: 7000 });
        return;
      case 'stopped':
        Popup.showToast(
          I18n.t('toast_page_translate_stopped', result.applied, result.total, result.reason),
          { duration: 7000 },
        );
        return;
      case 'done':
        if (moreArrived) {
          // "Pagina tradotta" sarebbe di nuovo la bugia della segnalazione: il
          // testo arrivato per ultimo è lì, in lingua originale, sotto gli occhi.
          Popup.showToast(I18n.t('toast_page_translated_new_arrived'), { duration: 7000 });
          return;
        }
        Popup.showToast(...doneToast(result.unreachable));
        return;
      default:
    }
  }

  // Sentinella del testo che il sito aggiunge DOPO (scorrimento infinito,
  // schermate che cambiano senza ricaricare). Non estrae niente: segna soltanto
  // che c'è qualcosa di nuovo da guardare, così l'apertura del menu resta
  // istantanea. Il conto vero lo fa la traduzione, che rilegge la pagina e
  // salta ciò che è già tradotto (nessun blocco pagato due volte).
  function startWatchingNewContent(extraRoots) {
    if (contentObserver) { addWatchRoots(extraRoots); return; }
    if (typeof MutationObserver !== 'function') return;
    try {
      contentObserver = new MutationObserver((muts) => {
        if (newContentSeen) return;
        for (const m of muts) {
          for (const n of m.addedNodes) {
            if (looksLikeNewText(n)) { newContentSeen = true; return; }
          }
        }
      });
      contentObserver.observe(document.documentElement || document, { childList: true, subtree: true });
      addWatchRoots(extraRoots);
    } catch (_) { contentObserver = null; }
  }

  // I componenti aperti del sito sono alberi a parte: vanno sorvegliati uno per
  // uno, o il testo che cambia lì dentro resterebbe invisibile.
  function addWatchRoots(roots) {
    if (!contentObserver) return;
    for (const r of (roots || [])) {
      try { contentObserver.observe(r, { childList: true, subtree: true }); } catch (_) {}
    }
  }

  function stopWatchingNewContent() {
    if (!contentObserver) return;
    try { contentObserver.disconnect(); } catch (_) {}
    contentObserver = null;
  }

  // Nodo appena comparso che vale la pena offrire in traduzione: ha del testo
  // con almeno una lettera, non è la UI di Filo (i nostri avvisi e menu vivono
  // nella pagina) e non sta dentro un blocco che abbiamo già tradotto.
  function looksLikeNewText(node) {
    try {
      if (!node) return false;
      const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
      const text = node.nodeType === Node.TEXT_NODE ? (node.nodeValue || '') : (node.textContent || '');
      if (text.trim().length < 2 || !HAS_LETTER.test(text)) return false;
      if (isInsideFiloUi(el)) return false;
      if (el.closest && el.closest('[data-sn-translated]')) return false;
      return true;
    } catch (_) { return false; }
  }

  function isInsideFiloUi(el) {
    const own = Extract && typeof Extract.isFiloOwnUi === 'function' ? Extract.isFiloOwnUi : null;
    if (!own) return false;
    let cur = el;
    for (let i = 0; cur && i < 8; i++) {
      if (own(cur)) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  // Avviso di fine lavoro: "Pagina tradotta" solo se non è rimasto fuori niente.
  // Con dei componenti chiusi (#439) la stessa frase sarebbe una bugia, e la
  // versione onesta resta in vista più a lungo perché dice qualcosa di nuovo.
  function doneToast(unreachable) {
    return unreachable
      ? [I18n.t('toast_page_translated_partial'), { duration: 7000 }]
      : [I18n.t('toast_page_translated')];
  }

  // Errore tecnico → frase per l'utente (stessa traduzione delle chat: mai il
  // messaggio grezzo del provider, sempre cosa non ha funzionato e cosa fare).
  function reasonFor(err) {
    // Nessun guasto: qualche blocco è semplicemente tornato vuoto dal modello.
    // Dirlo così è più onesto che inventare un errore che non c'è stato.
    if (!err) return I18n.t('reason_translate_incomplete');
    const CE = global.SN_CHAT_ERRORS;
    if (CE && typeof CE.sentence === 'function') return CE.sentence(err);
    return I18n.t('err_provider_failed');
  }

  // Traduce un gruppo di unità con UNA richiesta. Se il modello restituisce un
  // numero di pezzi diverso dal numero di unità, i testi finirebbero nei blocchi
  // sbagliati: in quel caso si dimezza il gruppo e si riprova (fino a una unità
  // sola, dove il rischio non esiste). Ritorna null se ok, altrimenti l'errore
  // (oggetto con message/code/status, non una stringa: serve a SN_CHAT_ERRORS
  // per scegliere la frase giusta da mostrare all'utente).
  async function translateGroup(units, depth) {
    if (!units.length) return null;
    // Lavoro di un giro che l'utente ha già annullato: non si spedisce.
    if (units[0].run !== runSeq) return null;
    const joined = units.map((u) => u.templated).join(SEPARATOR);
    const res = await requestTranslation(joined);
    if (!res.ok) return res.error;

    const parts = String(res.text || '').split(SEP_RE);
    if (units.length === 1) {
      // Separatori spuri nell'output di una singola unità: si ricuce tutto.
      applyTranslation(units[0], parts.join(' ').trim());
      return null;
    }
    if (parts.length === units.length) {
      for (let i = 0; i < units.length; i++) applyTranslation(units[i], (parts[i] || '').trim());
      return null;
    }
    if (depth >= MAX_SPLIT_DEPTH) {
      // Ripiego: applica quel che si può, in ordine, senza sfasare oltre.
      const n = Math.min(parts.length, units.length);
      for (let i = 0; i < n; i++) applyTranslation(units[i], (parts[i] || '').trim());
      return null;
    }
    const mid = Math.ceil(units.length / 2);
    const a = await translateGroup(units.slice(0, mid), depth + 1);
    const b = await translateGroup(units.slice(mid), depth + 1);
    return a || b;
  }

  // Una richiesta al modello, con un ritentativo dopo un attimo: un errore
  // singolo (rete, rate limit) non deve lasciare mezza pagina non tradotta.
  async function requestTranslation(chunk) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1200));
      let res = null;
      try {
        res = await chrome.runtime.sendMessage({
          type: MSG.AI_REQUEST,
          action: ACTIONS.TRANSLATE_PAGE,
          payload: { chunk },
        });
      } catch (e) {
        res = { ok: false, error: (e && e.message) || '', code: (e && e.code) || '' };
      }
      if (res?.ok && String(res.text || '').trim()) return { ok: true, text: res.text };
      if (attempt) return { ok: false, error: errFrom(res) };
    }
    return { ok: false, error: errFrom(null) };
  }

  // La risposta d'errore che arriva dal main è un oggetto piatto
  // ({ error, code }): lo ricompone nella forma che SN_CHAT_ERRORS sa leggere
  // (message/code/status), così "chiave rifiutata", "servizio sovraccarico" e
  // "rete caduta" diventano frasi diverse invece di un unico messaggio generico.
  function errFrom(res) {
    const e = new Error(String((res && res.error) || 'translate_failed'));
    if (res && res.code && res.code !== 'UNKNOWN') e.code = res.code;
    if (res && Number(res.status) > 0) e.status = Number(res.status);
    return e;
  }

  // Sostituisce il contenuto dell'unità con la traduzione, rimettendo i figli
  // originali (nodi vivi) al posto dei segnaposto. Niente contenuto perso: i
  // figli che il modello non ha richiamato tornano comunque in fondo.
  function applyTranslation(unit, text) {
    // Traduzione che arriva quando l'utente ha già chiesto l'originale: si
    // butta via. Se ha detto di tornare indietro, ci deve tornare e restarci —
    // una pagina che si ritraduce da sola qualche secondo dopo non l'ha chiesta
    // nessuno (#407).
    if (!unit || unit.run !== runSeq) return;
    if (unit.attr) return applyAttrTranslation(unit, text);
    const el = unit.el;
    if (!el || unit.applied || !text) return;
    if (el.dataset.snTranslated) return;
    try {
      const original = Array.from(el.childNodes);
      const refs = unit.refs || [];
      const used = new Set();
      const frag = document.createDocumentFragment();
      let last = 0;
      let m;
      PLACEHOLDER_RE.lastIndex = 0;
      while ((m = PLACEHOLDER_RE.exec(text))) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const k = Number(m[1]);
        if (refs[k] && !used.has(k)) {
          frag.appendChild(refs[k]);
          used.add(k);
        }
        last = PLACEHOLDER_RE.lastIndex;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      for (let k = 0; k < refs.length; k++) {
        if (!used.has(k) && refs[k]) frag.appendChild(refs[k]);
      }
      while (el.firstChild) el.removeChild(el.firstChild);
      el.appendChild(frag);
      el.dataset.snTranslated = '1';
      unit.applied = true;
      translatedUnits.push({ el, original });
    } catch (_) {}
  }

  // Etichetta negli attributi: si scrive l'attributo e si tiene da parte com'era
  // (e SE c'era: su una <option> senza etichetta esplicita l'attributo lo
  // aggiungiamo noi, e il ritorno all'originale deve toglierlo, non lasciarne
  // uno vuoto). Il testo del modello non viene mai interpretato come HTML:
  // setAttribute scrive una stringa e basta.
  function applyAttrTranslation(unit, text) {
    const el = unit.el;
    if (!el || unit.applied || !text) return;
    try {
      const attr = unit.attr;
      const had = el.hasAttribute(attr);
      const original = had ? el.getAttribute(attr) : null;
      el.setAttribute(attr, text);
      const marks = String(el.dataset.snTranslatedAttrs || '').split(',').filter(Boolean);
      if (marks.indexOf(attr) < 0) marks.push(attr);
      el.dataset.snTranslatedAttrs = marks.join(',');
      unit.applied = true;
      translatedAttrs.push({ el, attr, had, original });
    } catch (_) {}
  }

  // Trasforma i figli del blocco in segnaposto [[Lk]] preservandoli per il
  // rimontaggio. Restituisce { templated, refs } dove refs sono i NODI veri.
  function templateizeBlock(el) {
    const refs = [];
    let out = '';
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.nodeValue;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const idx = refs.length;
        refs.push(child);
        out += `[[L${idx}]]`;
      }
    }
    return { templated: out.replace(/\s+/g, ' ').trim(), refs };
  }

  // C'è testo vero oltre ai segnaposto?
  function hasTranslatableText(templated) {
    const bare = templated.replace(PLACEHOLDER_RE, ' ').trim();
    PLACEHOLDER_RE.lastIndex = 0;
    return bare.length >= 2 && /\p{L}/u.test(bare);
  }

  // Ripristina il testo originale annullando la traduzione di pagina.
  function restoreOriginal() {
    // Prima di tutto il resto: l'avviso "sto traducendo" sparisce nell'istante
    // in cui l'utente ferma il lavoro, non quando le richieste già spedite si
    // decidono a tornare.
    closeProgressToast();
    stopWatchingNewContent();
    newContentSeen = false;
    hiddenSkipped = [];
    // Il lavoro ancora in volo smette di essere quello buono: quando le
    // risposte arriveranno si butteranno via da sole, invece di ritradurre a
    // metà una pagina che l'utente ha appena riportato indietro.
    runSeq++;
    const wasWorking = pageTranslating;
    // Il giro in corso è finito qui: l'utente deve poter far ripartire una
    // traduzione subito, senza aspettare che le richieste già spedite tornino.
    pageTranslating = false;
    const restoredAny = translatedUnits.length > 0 || translatedAttrs.length > 0;
    // Etichette: rimettere il valore di prima, o togliere l'attributo se prima
    // non c'era (le voci dei menu a tendina tornano a mostrare il loro testo).
    for (let i = translatedAttrs.length - 1; i >= 0; i--) {
      const { el, attr, had, original } = translatedAttrs[i];
      try {
        if (had) el.setAttribute(attr, original);
        else el.removeAttribute(attr);
        delete el.dataset.snTranslatedAttrs;
      } catch (_) {}
    }
    translatedAttrs = [];
    // A ritroso: le unità annidate (es. un link dentro un paragrafo) tornano
    // originali prima del contenitore che le ospita.
    for (let i = translatedUnits.length - 1; i >= 0; i--) {
      const { el, original } = translatedUnits[i];
      try {
        while (el.firstChild) el.removeChild(el.firstChild);
        for (const n of original) el.appendChild(n);
        delete el.dataset.snTranslated;
      } catch (_) {}
    }
    translatedUnits = [];
    // Traduzioni di formati precedenti (HTML/testo salvato negli attributi).
    // La ricerca attraversa anche i componenti isolati (#439): lì dentro ora
    // finisce del testo tradotto, e ciò che si può tradurre si deve poter
    // rimettere com'era.
    Extract.findTranslatedElements().forEach((el) => {
      if (el.dataset.snOriginalHtml !== undefined) {
        el.innerHTML = el.dataset.snOriginalHtml;
        delete el.dataset.snOriginalHtml;
      } else if (el.dataset.snOriginal !== undefined) {
        el.textContent = el.dataset.snOriginal;
        delete el.dataset.snOriginal;
      }
      delete el.dataset.snTranslated;
    });
    // Rimuovi eventuali note di traduzione (vecchio formato, retrocompatibilità)
    document.querySelectorAll('[data-sn-translation="1"]').forEach((n) => n.remove());
    pageHasTranslation = false;
    pageComplete = false;
    missingCount = 0;
    totalCount = 0;
    // Fermare una traduzione appena partita non è "ripristinare": sullo schermo
    // non era ancora cambiato niente, e dire il contrario è già una piccola
    // bugia. Ferma restando che la richiesta è stata ascoltata, e va detto.
    if (!restoredAny && wasWorking) Popup.showToast(I18n.t('toast_translation_cancelled'));
    else Popup.showToast(I18n.t('toast_original_restored'));
  }

  function hasTranslation() { return pageHasTranslation; }
  // Traduzione presente ma incompleta: il menu deve offrire "Riprendi", non
  // "Mostra originale" (che butterebbe via anche la parte già tradotta e
  // pagata).
  function isPartial() { return pageHasTranslation && !pageComplete; }
  // Traduzione completa, ma sullo schermo c'è del testo in lingua originale che
  // il lavoro non ha toccato. Due strade diverse, per l'utente identiche: il
  // sito l'ha AGGIUNTO (scorrimento infinito, schermate che cambiano senza
  // ricaricare), oppure era già lì e lui l'ha SCOPERTO aprendo una fisarmonica,
  // una scheda, un "leggi tutto". In entrambi i casi il menu deve offrire di
  // tradurlo: senza, l'unica strada era tornare all'originale e ripagare
  // l'intera pagina per avere in italiano tre righe.
  function hasNewContent() {
    if (!pageHasTranslation || !pageComplete) return false;
    if (newContentSeen) return true;
    return !!(Extract && typeof Extract.hasRevealedText === 'function'
      && Extract.hasRevealedText(hiddenSkipped));
  }
  // C'è dell'altro da tradurre, per un motivo o per l'altro: nei due casi
  // l'icona del menu serve a CONTINUARE, non a tornare all'originale.
  function canContinue() { return isPartial() || hasNewContent(); }
  // L'icona del menu è il ritorno all'originale? Sì a traduzione completa e
  // ferma, e sì anche MENTRE traduce: una cosa che parte si deve poter fermare,
  // e a metà lavoro fermarsi vuol dire tornare indietro. Prima, aprendo il menu
  // durante il lavoro, l'unica voce era "Traduci la pagina" — che non faceva
  // niente. Fonte unica: la usano sia l'icona sia la voce etichettata, che
  // compare solo quando l'icona serve ad altro.
  function showsRestore() { return pageTranslating || (pageHasTranslation && !canContinue()); }
  function missing() { return missingCount; }
  function total() { return totalCount; }

  // Voce etichettata "Mostra originale" da mostrare SOLO quando c'è ancora del
  // lavoro da fare (traduzione a metà, o testo comparso dopo): lì l'icona del
  // menu serve per continuare, ma chi vuole rinunciare deve comunque poter
  // tornare indietro (se puoi aggiungere, devi poter togliere). A traduzione
  // completa e ferma la voce non serve: la offre già l'icona.
  function buildRestoreOriginalItem() {
    const Icons = global.SN_ICONS;
    const icon = (Icons && typeof Icons.showOriginal === 'function') ? Icons.showOriginal(18) : undefined;
    return { type: 'item', icon, label: I18n.t('menu_show_original'), onClick: () => restoreOriginal() };
  }

  global.SN_TRANSLATE_PAGE = {
    translatePage, restoreOriginal, hasTranslation,
    isPartial, hasNewContent, canContinue, showsRestore, missing, total, buildRestoreOriginalItem,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
