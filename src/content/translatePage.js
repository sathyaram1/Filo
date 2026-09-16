// Traduzione dell'intera pagina e ritorno all'originale; lo stato vive qui, e il menu lo legge con hasTranslation() per scegliere icona ed etichetta.
// Le unità vengono da Extract.extractTranslatableBlocks(), più il nome della scheda (document.title) e i RIQUADRI INCORPORATI, a cui si passa parola.
// I figli di un'unità diventano segnaposto [[Lk]] e tornano come NODI VIVI, non come HTML ri-parsato: link, immagini e componenti conservano listener e stato. Il tradotto entra come text node, nessun HTML del modello finisce nella pagina.

(function (global) {
  'use strict';

  const { ACTIONS } = global.SN_CONST;
  const { MSG } = global.SN_MSG;
  const I18n = global.SN_I18N;
  const Popup = global.SN_POPUP;
  const Extract = global.SN_EXTRACT;

  const CHUNK_SIZE = 3000;      // caratteri per richiesta
  const CONCURRENCY = 3;        // richieste in parallelo (l'attesa è attrito)
  // Sulle pagine che si allungano mentre si scorre, il testo nuovo arriva mentre traduciamo: fermarsi al primo giro lo lascerebbe in lingua originale sotto un avviso che dichiara finito (#407). Il tetto c'è perché rincorrere un sito infinito non finirebbe mai.
  const MAX_PASSES = 3;
  const MAX_SPLIT_DEPTH = 4;    // bisezione massima quando il modello sballa i separatori
  const SEPARATOR = '\n@@@SN_SEP@@@\n';
  const SEP_RE = /\n?@@@\s*SN_SEP\s*@@@\n?/;
  const PLACEHOLDER_RE = /\[\[\s*L\s*(\d+)\s*\]\]/g;

  const HAS_LETTER = /\p{L}/u;

  // Sotto queste misure non c'è un post incorporato ma un pixel di tracciamento o uno spaziatore: non si traduce e non entra nel conto di ciò che è rimasto fuori, o l'avviso manderebbe a cercare testo che non esiste (#407).
  const FRAME_MIN_W = 120;
  const FRAME_MIN_H = 40;
  // Chi non si fa vivo entro questo tempo non ha script (sandbox chiuso): è esattamente il caso in cui l'avviso deve dire che una parte è rimasta fuori.
  const FRAME_ACK_GRACE = 2500;
  // Tetto all'attesa di chi sta lavorando: non è un timer da consumare, si esce appena hanno finito tutti.
  const FRAME_WORK_CAP = 60000;

  // Il modello ha risposto ma senza testo: non è un guasto. La frase giusta parla di blocchi tornati vuoti, non di «qualcosa è andato storto», che contraddice l'invito a riprendere.
  const EMPTY_ANSWER = { emptyAnswer: true };

  let pageTranslating = false;
  let pageHasTranslation = false;
  // Distinguere «completa» da «a metà» è ciò che permette al menu di offrire «Riprendi traduzione» invece di far ricominciare da capo (#408). Vale solo se pageHasTranslation.
  let pageComplete = false;
  // Quanti blocchi mancano e quanti erano in tutto: serve a dire all'utente *quanto* ne manca, non solo che si è interrotta.
  let missingCount = 0;
  let totalCount = 0;
  // Unità tradotte in questa sessione, con i NODI originali (non l'HTML): è ciò
  // che "Mostra originale" rimette al suo posto.
  let translatedUnits = [];
  // Etichette tradotte (attributi), con il valore di prima — e se l'attributo
  // prima non c'era affatto, per poterlo togliere invece di lasciarne uno finto.
  let translatedAttrs = [];
  // Testo arrivato DOPO che la traduzione si era dichiarata finita (#407): sui siti a scorrimento infinito è la normalità, e senza accorgersene l'unico modo di averlo in italiano era ripagare tutta la pagina.
  let newContentSeen = false;
  let contentObserver = null;
  // Sottoalberi nascosti al momento della traduzione (fisarmoniche, schede, «leggi tutto»): non tradotti, ma se l'utente li apre il menu deve offrire di tradurli — scoprire del testo e riceverlo dal sito, per chi guarda, sono la stessa cosa (#407).
  let hiddenSkipped = [];
  // Chi chiede l'originale fa avanzare il numero d'ordine: le richieste rimaste in volo si accorgono di non essere più quelle buone e si buttano via, invece di scaricarsi su una pagina appena riportata indietro (#407).
  let runSeq = 0;
  // Serve a chi FERMA: le richieste già spedite tornano quando vogliono, e fino ad allora «in corso» resterebbe accanto a «annullata». Una cosa che si ferma deve sembrare ferma subito.
  let progressToast = null;
  // Il nome della scheda è l'ultimo pezzo di lingua originale sotto gli occhi a pagina tradotta, e sta nello stesso giro. Solo nel frame principale: il titolo di un riquadro non si vede.
  let translatedTitle = null;
  // Giro in corso, col conto dei riquadri: attesi, fatti vivi, finiti, e quanto è rimasto in lingua originale. La chiave del giro tiene fuori i resoconti di un giro già chiuso.
  const frameRuns = new Map();

  // Un riquadro incorporato non è "la pagina": lì gli avvisi non si mostrano
  // (li mostra chi lo ospita) e il giro non si indice.
  function isTopFrame() {
    try { return window.top === window.self; } catch (_) { return false; }
  }

  function silentToast() {
    return { el: {}, close() {} };
  }

  function closeProgressToast() {
    if (!progressToast) return;
    try { progressToast.close(); } catch (_) {}
    progressToast = null;
  }

  async function translatePage(opts) {
    const quiet = !!(opts && opts.quiet);
    const frameRunId = (opts && opts.runId) || '';
    if (pageTranslating) {
      // Un riquadro già al lavoro non deve restare «mai finito» nel conto di chi lo ospita, o l'avviso direbbe che è rimasto fuori del testo che sta invece arrivando.
      if (quiet) reportToHost(frameRunId, { phase: 'end', applied: 0, left: 0 });
      return;
    }
    pageTranslating = true;
    const myRun = ++runSeq;
    const aborted = () => myRun !== runSeq;
    // L'avviso "sto traducendo" dura quanto la traduzione e viene SOSTITUITO
    // dall'esito: due riquadri sovrapposti nell'angolo sono illeggibili.
    const progress = quiet
      ? silentToast()
      : Popup.showToast(I18n.t('toast_translating_page'), { duration: 0 });
    if (!quiet) progressToast = progress;
    // Sorveglianza accesa PRIMA di cominciare: scorrere mentre si aspetta è normale, e il testo caricato in quei secondi resta in lingua originale sotto gli occhi. Le nostre sostituzioni nascono già marcate e non la ingannano.
    newContentSeen = false;
    startWatchingNewContent();
    // Parola ai riquadri incorporati PRIMA di cominciare: traducono in
    // parallelo alla pagina, non dopo di lei (l'attesa è attrito).
    const framesRunId = quiet ? null : await beginFrames(myRun);

    let result = null;
    try {
      for (let pass = 0; pass < MAX_PASSES; pass++) {
        newContentSeen = false;
        result = await runPass(progress, myRun);
        if (aborted()) return;
        // Il sito ha allungato la pagina mentre lavoravamo: la finiamo adesso, senza far ricliccare e senza rimandare al modello ciò che è già fatto. Vale anche se il primo giro non aveva trovato niente: «non ho trovato testo» mentre il testo compare è la stessa bugia.
        if (!newContentSeen || (result.kind !== 'done' && result.kind !== 'none')) break;
      }
      if (aborted()) return;
      if (quiet) { reportToHost(frameRunId, { phase: 'end', applied: appliedOf(result), left: leftOf(result) }); return; }
      // I riquadri lavorano in parallelo e l'avviso finale li aspetta, perché è lui a dover dire la verità su tutta la pagina. Fino ad allora resta in vista «sto traducendo».
      const frames = await waitForFrames(framesRunId, aborted);
      if (aborted()) return;
      // Il testo cambiato sta tutto dentro i riquadri (una pagina che è poco più di una cornice attorno a un modulo): senza questo il menu offrirebbe di nuovo «Traduci la pagina», e non ci sarebbe modo di tornare indietro.
      if (frames.applied > 0 && !pageHasTranslation) {
        pageHasTranslation = true;
        pageComplete = true;
      }
      progress.close();
      showResultToast(result, newContentSeen, frames);
    } finally {
      progress.close();
      if (framesRunId) frameRuns.delete(framesRunId);
      if (quiet && (result === null || myRun !== runSeq)) reportToHost(frameRunId, { phase: 'end', applied: 0, left: 0 });
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

  // Un giro: rilegge, manda al modello solo ciò che non è già tradotto, applica. L'avviso lo scrive chi chiama, l'unico a sapere se nel frattempo è arrivato dell'altro.
  async function runPass(progress, myRun) {
    const blocks = Extract.extractTranslatableBlocks();
    // I componenti aperti del sito sono alberi a parte: una sentinella sul solo
    // documento non vede il contenuto che cambia lì dentro.
    addWatchRoots(blocks.shadowRoots);
    addWatchRoots(blocks.frameDocs);
    hiddenSkipped = blocks.hidden || [];
    // Pezzi di pagina che nessuno script può leggere (#439): non entrano nel lavoro, ma cambiano l'avviso finale — «Pagina tradotta» sarebbe falso.
    const unreachable = Number(blocks.unreachable || 0);
    // Blocchi oltre il tetto di un giro solo: non sono persi, si prendono alla ripresa. Entrano nei totali perché è l'unico modo perché l'avviso non menta su una pagina enorme.
    const truncated = Number(blocks.truncated || 0);

    // I figli di ogni unità diventano segnaposto [[Lk]]: il modello traduce solo il testo, la struttura resta. I blocchi già tradotti da un giro interrotto non tornano dall'estrazione e non si rimandano al modello — servono solo ai totali dell'avviso (#408).
    const doneBefore = Extract.findTranslatedElements();
    const already = doneBefore.length + Number(doneBefore.attrCount || 0);
    const units = [];
    // Il nome della scheda per primo: è la prima riga di lingua originale che l'utente incontra, e l'ultima che restava in inglese a pagina tradotta.
    const title = titleUnit(myRun);
    if (title) units.push(title);
    for (const b of blocks) {
      if (b.el && b.el.dataset && b.el.dataset.snTranslated) continue;
      const { templated, refs } = templateizeBlock(b.el);
      if (!hasTranslatableText(templated)) continue;
      units.push({ el: b.el, templated, refs, run: myRun });
    }
    // Etichette (placeholder, suggerimenti, descrizioni delle immagini, voci a tendina, scritte sui bottoni): stessa coda di lavoro, ma si applicano scrivendo l'attributo invece di sostituire i figli.
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
        pageHasTranslation = true;
        pageComplete = true;
        missingCount = 0;
        totalCount = already;
        return { kind: 'done', unreachable };
      }
      if (unreachable) {
        // Pagina fatta solo di componenti chiusi: non è «niente da tradurre», è testo che non riusciamo a leggere. Dire l'una per l'altra manderebbe l'utente a riprovare all'infinito.
        return { kind: 'onlyClosed' };
      }
      return { kind: 'none' };
    }

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

    // Avanzamento REALE: i blocchi hanno un totale noto, quindi l'attesa si misura invece di raccontarla.
    const grandTotal = already + units.length + truncated;
    const tick = () => {
      const applied = already + units.filter((u) => u.applied).length;
      try { progress.el.textContent = I18n.t('toast_translating_page_progress', applied, grandTotal); } catch (_) {}
    };
    tick();

    let lastError = null;
    let next = 0;
    const worker = async () => {
      // Se l'utente ha chiesto l'originale, quel che resta non parte nemmeno: non si continua a lavorare, e a far pagare, contro la sua ultima parola.
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

    // Le etichette gemelle si copiano adesso dal testo appena tradotto: per loro non è passata nessuna richiesta al modello.
    applyMirroredAttrs(blocks.mirrors, myRun);

    const done = units.filter((u) => u.applied).length;
    const applied = already + done;
    totalCount = grandTotal;
    missingCount = grandTotal - applied;

    if (!applied) {
      pageHasTranslation = false;
      pageComplete = false;
      return { kind: 'failed', reason: reasonFor(lastError) };
    }

    pageHasTranslation = true;
    // I componenti chiusi non rendono la traduzione riprendibile: riprovare non li aprirà mai. Lo stato resta completo — il menu offre «Mostra originale» — ed è l'AVVISO a dire che una parte è rimasta fuori.
    pageComplete = missingCount === 0;
    if (pageComplete) return { kind: 'done', unreachable };
    // Nessun guasto: la pagina è semplicemente più lunga di un giro solo, e «interrotta» suonerebbe come un errore che non c'è stato.
    if (!lastError && truncated) return { kind: 'batch', applied, total: grandTotal };
    // MAI «Pagina tradotta» quando non lo è: si dice che si è interrotta, quanto manca e come riprendere. Il motivo tecnico grezzo resta fuori.
    return { kind: 'stopped', applied, total: grandTotal, reason: reasonFor(lastError) };
  }

  // `moreArrived` è l'unica cosa che chi ha fatto il lavoro non può sapere: il sito ha continuato ad aggiungere testo anche durante l'ultimo giro, e abbiamo smesso di rincorrerlo.
  function showResultToast(result, moreArrived, frames) {
    if (!result) return;
    const framesLeft = (frames && frames.left) || 0;
    const framesApplied = (frames && frames.applied) || 0;
    switch (result.kind) {
      case 'batch':
        Popup.showToast(I18n.t('toast_page_translate_batch', result.applied, result.total), { duration: 7000 });
        return;
      case 'onlyClosed':
        Popup.showToast(I18n.t('toast_only_closed_components'), { duration: 7000 });
        return;
      case 'none':
        // La pagina che ospita non aveva testo proprio, ma i riquadri sì: «Non ho trovato testo da tradurre» davanti a uno schermo appena cambiato lingua sarebbe falso.
        if (framesApplied) { Popup.showToast(...doneToast(0, framesLeft)); return; }
        if (framesLeft) { Popup.showToast(I18n.t('toast_page_translated_partial_frame'), { duration: 7000 }); return; }
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
          Popup.showToast(I18n.t('toast_page_translated_new_arrived'), { duration: 7000 });
          return;
        }
        Popup.showToast(...doneToast(result.unreachable, framesLeft));
        return;
      default:
    }
  }

  // Riquadri incorporati: pagine dentro la pagina. Il frame principale non ne tocca il testo (quasi sempre è di un'altra origine), ma il content script di Filo gira anche lì e la traduzione gli passa parola: ognuno traduce sé stesso e riferisce com'è andata.
  // Dove nemmeno questo si può — un riquadro senza script, chiuso a chiave dal `sandbox` — lo dice l'avviso finale, invece di dichiarare tradotta una pagina con dentro un rettangolo in inglese (#407).

  // Quanti riquadri guardare: serve alla pagina per sapere quante risposte aspettarsi. Chi non risponde è un riquadro che nessuno script può toccare, e va detto.
  function visibleEmbeddedFrames() {
    let n = 0;
    try {
      for (const f of document.querySelectorAll('iframe, frame')) {
        const r = f.getBoundingClientRect();
        if (r.width < FRAME_MIN_W || r.height < FRAME_MIN_H) continue;
        if (isInsideFiloUi(f)) continue;
        // Riquadro riempito dalla pagina stessa: non c'è nessun Filo che risponda, ma il testo lo prende l'estrazione da qui. Aspettarne una risposta direbbe «rimasto fuori» su un rettangolo che invece è tradotto.
        if (Extract && typeof Extract.inlineFrameBody === 'function' && Extract.inlineFrameBody(f)) continue;
        n++;
      }
    } catch (_) {}
    return n;
  }

  // Un rettangolo grande come un francobollo è un pixel di tracciamento o uno spaziatore: non ha testo che qualcuno legga, e una richiesta al modello per lui è denaro buttato.
  function worthTranslatingHere() {
    try {
      return window.innerWidth >= FRAME_MIN_W && window.innerHeight >= FRAME_MIN_H;
    } catch (_) { return true; }
  }

  function reportToHost(runId, data) {
    if (!runId) return;
    try {
      chrome.runtime.sendMessage(Object.assign(
        { type: MSG.FRAME_TRANSLATE_DONE, runId: String(runId) }, data,
      ));
    } catch (_) {}
  }

  function appliedOf(result) {
    if (!result) return 0;
    // Questi tre non passano dal conteggio di un giro: i totali sarebbero quelli, vecchi, di una traduzione precedente.
    if (result.kind === 'none' || result.kind === 'aborted' || result.kind === 'onlyClosed') return 0;
    return Math.max(0, totalCount - missingCount);
  }

  // Quanto è rimasto in lingua originale qui dentro. Non serve il numero esatto: serve sapere SE è rimasto fuori qualcosa, l'unica cosa che cambia l'avviso finale.
  function leftOf(result) {
    if (!result) return 0;
    if (result.kind === 'none' || result.kind === 'aborted') return 0;
    if (result.kind === 'done') return Number(result.unreachable || 0) > 0 ? 1 : 0;
    // Riquadro fatto di soli componenti chiusi: il testo c'è e resta in lingua originale, ma non è «un blocco mancante» di cui contare il numero.
    if (result.kind === 'onlyClosed') return 1;
    return Math.max(1, missingCount);
  }

  // Indice il giro: conta i riquadri da guardare e passa parola. Se non ce n'è
  // nessuno di visibile, non si spende nemmeno un messaggio.
  async function beginFrames(myRun) {
    if (!isTopFrame()) return null;
    const expected = visibleEmbeddedFrames();
    if (!expected) return null;
    const runId = 'r' + myRun;
    // Chi non si farà vivo resta nel conto: `expected` sono i riquadri che si VEDONO, e un rettangolo visibile che nessuno script raggiunge è ciò che l'avviso finale deve confessare.
    frameRuns.set(runId, { expected, acked: 0, ended: 0, applied: 0, left: 0 });
    try {
      await chrome.runtime.sendMessage({ type: MSG.TRANSLATE_FRAMES, mode: 'translate', runId });
    } catch (_) {}
    return runId;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Due finestre, non un timer unico: chi c'è si fa vivo subito (chi non lo fa non ha script e non lo farà mai), poi si aspetta che chi si è fatto vivo finisca, e si esce appena hanno finito tutti.
  async function waitForFrames(runId, aborted) {
    if (!runId) return { left: 0, applied: 0 };
    const st = frameRuns.get(runId);
    if (!st) return { left: 0, applied: 0 };
    const t0 = Date.now();
    while (st.acked < st.expected && Date.now() - t0 < FRAME_ACK_GRACE) {
      if (aborted && aborted()) break;
      await sleep(80);
    }
    const silent = Math.max(0, st.expected - st.acked);
    while (st.ended < st.acked && Date.now() - t0 < FRAME_WORK_CAP) {
      if (aborted && aborted()) break;
      await sleep(120);
    }
    const unfinished = Math.max(0, st.acked - st.ended);
    frameRuns.delete(runId);
    return { left: silent + unfinished + st.left, applied: st.applied };
  }

  function onFrameReport(msg) {
    const st = frameRuns.get(String((msg && msg.runId) || ''));
    if (!st) return;
    if (msg.phase === 'ack') {
      st.acked++;
      st.expected += Number(msg.frames) || 0;
      return;
    }
    st.ended++;
    st.applied += Number(msg.applied) || 0;
    st.left += Number(msg.left) || 0;
  }

  // Parola arrivata dalla pagina che ci ospita: traduci te stesso, o torna
  // all'originale insieme a lei.
  function onFrameCommand(msg) {
    if (isTopFrame()) return;
    const runId = String((msg && msg.runId) || '');
    if (String(msg && msg.mode) === 'restore') { restoreOriginal({ quiet: true }); return; }
    reportToHost(runId, { phase: 'ack', frames: visibleEmbeddedFrames() });
    if (!worthTranslatingHere()) { reportToHost(runId, { phase: 'end', applied: 0, left: 0 }); return; }
    translatePage({ quiet: true, runId });
  }

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg) return;
      if (msg.type === MSG.FRAME_TRANSLATE) onFrameCommand(msg);
      else if (msg.type === MSG.FRAME_TRANSLATE_REPORT) onFrameReport(msg);
    });
  } catch (_) {}

  // Sentinella del testo che il sito aggiunge DOPO. Non estrae niente, segna solo che c'è del nuovo da guardare, così il menu si apre subito; il conto vero lo fa la traduzione, che rilegge e salta ciò che è già tradotto.
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

  // Nodo appena comparso che vale la pena offrire in traduzione: ha del testo con almeno una lettera, non è la UI di Filo, e non sta dentro un blocco già tradotto.
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

  // Il marchio sta sulla RADICE del pezzo di UI, quindi si cerca fra gli antenati con `closest`: guardandone solo otto, un popup più profondo faceva scambiare il nostro stesso disegno per testo del sito.
  function isInsideFiloUi(el) {
    const UI = global.SN_FILO_UI;
    return !!(UI && UI.inside(el));
  }

  // «Pagina tradotta» solo se non è rimasto fuori niente: coi componenti chiusi (#439) sarebbe una bugia, e la versione onesta resta in vista più a lungo perché dice qualcosa di nuovo.
  // `framesLeft` viene prima: un riquadro in inglese è un rettangolo intero, un componente chiuso di solito un pezzetto — si manda l'utente sulla cosa più grande.
  function doneToast(unreachable, framesLeft) {
    if (framesLeft) return [I18n.t('toast_page_translated_partial_frame'), { duration: 7000 }];
    return unreachable
      ? [I18n.t('toast_page_translated_partial'), { duration: 7000 }]
      : [I18n.t('toast_page_translated')];
  }

  // Errore tecnico → frase per l'utente (stessa traduzione delle chat: mai il
  // messaggio grezzo del provider, sempre cosa non ha funzionato e cosa fare).
  function reasonFor(err) {
    if (!err || err.emptyAnswer) return I18n.t('reason_translate_incomplete');
    const CE = global.SN_CHAT_ERRORS;
    if (CE && typeof CE.sentence === 'function') return CE.sentence(err);
    return I18n.t('err_provider_failed');
  }

  // Un gruppo di unità in UNA richiesta. Se il modello torna un numero di pezzi diverso dalle unità i testi finirebbero nei blocchi sbagliati: si dimezza il gruppo e si riprova, fino a una unità sola.
  // Ritorna null se è andata, altrimenti l'errore come oggetto (message/code/status): serve a SN_CHAT_ERRORS per scegliere la frase.
  async function translateGroup(units, depth) {
    if (!units.length) return null;
    if (units[0].run !== runSeq) return null;
    const joined = units.map((u) => u.templated).join(SEPARATOR);
    const res = await requestTranslation(joined);
    if (!res.ok) return res.error || EMPTY_ANSWER;

    const parts = String(res.text || '').split(SEP_RE);
    if (units.length === 1) {
      applyTranslation(units[0], parts.join(' ').trim());
      return null;
    }
    if (parts.length === units.length) {
      for (let i = 0; i < units.length; i++) applyTranslation(units[i], (parts[i] || '').trim());
      return null;
    }
    if (depth >= MAX_SPLIT_DEPTH) {
      const n = Math.min(parts.length, units.length);
      for (let i = 0; i < n; i++) applyTranslation(units[i], (parts[i] || '').trim());
      return null;
    }
    const mid = Math.ceil(units.length / 2);
    const a = await translateGroup(units.slice(0, mid), depth + 1);
    const b = await translateGroup(units.slice(mid), depth + 1);
    return a || b;
  }

  // Una richiesta con un ritentativo dopo un attimo: un errore singolo (rete, rate limit) non deve lasciare mezza pagina non tradotta.
  async function requestTranslation(chunk) {
    // Risposta senza testo: richiesta partita, risposta tornata, nessun guasto. L'avviso deve dire «alcuni blocchi sono tornati vuoti dal modello», non un «qualcosa è andato storto» che contraddice la riga dopo.
    let answeredEmpty = false;
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
      answeredEmpty = !!(res && res.ok);
      if (attempt) return { ok: false, error: answeredEmpty ? null : errFrom(res) };
    }
    return { ok: false, error: errFrom(null) };
  }

  // L'errore dal main è un oggetto piatto ({ error, code }): ricomposto per SN_CHAT_ERRORS, così «chiave rifiutata», «servizio sovraccarico» e «rete caduta» diventano frasi diverse.
  function errFrom(res) {
    const e = new Error(String((res && res.error) || 'translate_failed'));
    if (res && res.code && res.code !== 'UNKNOWN') e.code = res.code;
    if (res && Number(res.status) > 0) e.status = Number(res.status);
    return e;
  }

  // Rimette i figli originali (nodi vivi) al posto dei segnaposto. Niente contenuto perso: i figli che il modello non ha richiamato tornano comunque in fondo.
  function applyTranslation(unit, text) {
    // Traduzione che arriva quando l'utente ha già chiesto l'originale: si butta. Se ha detto di tornare indietro ci deve restare — una pagina che si ritraduce da sola non l'ha chiesta nessuno (#407).
    if (!unit || unit.run !== runSeq) return;
    if (unit.title) return applyTitleTranslation(unit, text);
    if (unit.attr) return applyAttrTranslation(unit, text);
    const el = unit.el;
    if (!el || unit.applied || !text) return;
    if (el.dataset.snTranslated) return;
    try {
      const original = Array.from(el.childNodes);
      const refs = unit.refs || [];
      const used = new Set();
      // Il documento dell'elemento, non il nostro: dentro un riquadro riempito
      // dalla pagina stessa (#407) i nodi nuovi appartengono a quel documento.
      const doc = el.ownerDocument || document;
      const frag = doc.createDocumentFragment();
      let last = 0;
      let m;
      PLACEHOLDER_RE.lastIndex = 0;
      while ((m = PLACEHOLDER_RE.exec(text))) {
        if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)));
        const k = Number(m[1]);
        if (refs[k] && !used.has(k)) {
          frag.appendChild(refs[k]);
          used.add(k);
        }
        last = PLACEHOLDER_RE.lastIndex;
      }
      if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
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

  // Il nome della scheda è testo come gli altri: un'unità sola, applicata scrivendo `document.title`. Solo dal frame principale — il titolo di un riquadro non si vede, e tradurlo sarebbe pagato per niente.
  function titleUnit(myRun) {
    if (!isTopFrame() || translatedTitle) return null;
    let text = '';
    try { text = String(document.title || '').replace(/\s+/g, ' ').trim(); } catch (_) { return null; }
    if (!hasTranslatableText(text)) return null;
    return { title: true, templated: text, refs: [], run: myRun };
  }

  function applyTitleTranslation(unit, text) {
    if (unit.applied || !text) return;
    try {
      const original = document.title;
      document.title = text;
      // Il segno sul <title> serve a due cose: la ripresa lo conta fra i pezzi già fatti, e la sentinella del testo nuovo non scambia la nostra stessa scrittura per testo appena arrivato dal sito.
      const el = document.querySelector('title');
      if (el && el.dataset) el.dataset.snTranslated = '1';
      translatedTitle = { original };
      unit.applied = true;
    } catch (_) {}
  }

  // Etichette GEMELLE del testo già mostrato (il suggerimento uguale al testo del link, l'etichetta uguale alla scritta del bottone): decine per pagina, e mandarle al modello pagherebbe due volte la stessa riga.
  // Si copiano dal testo appena tradotto, letto ADESSO dall'elemento e non dalla traduzione di una singola unità: l'etichetta può stare su un contenitore, dove la frase tradotta è quella del figlio.
  function applyMirroredAttrs(mirrors, myRun) {
    for (const m of (mirrors || [])) {
      if (myRun !== runSeq) return;
      const el = m && m.el;
      if (!el || !el.isConnected) continue;
      let now = '';
      try { now = String(el.textContent || '').replace(/\s+/g, ' ').trim(); } catch (_) { continue; }
      // Il testo non è cambiato: la sua traduzione non è arrivata. L'etichetta resta com'è e senza marchio, così la ripresa ci riprova invece di darla per fatta.
      if (!now || now === m.text) continue;
      applyTranslation({ el, attr: m.attr, run: myRun }, now);
    }
  }

  // Si scrive l'attributo tenendo da parte com'era, e SE c'era: su una <option> senza etichetta la aggiungiamo noi, e il ritorno all'originale deve toglierla, non lasciarne una vuota.
  // setAttribute scrive una stringa: il testo del modello non è mai interpretato come HTML.
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

  function hasTranslatableText(templated) {
    const bare = templated.replace(PLACEHOLDER_RE, ' ').trim();
    PLACEHOLDER_RE.lastIndex = 0;
    return bare.length >= 2 && /\p{L}/u.test(bare);
  }

  function restoreOriginal(opts) {
    // Dentro un riquadro incorporato: torna all'originale insieme alla pagina
    // che lo ospita, ma senza avvisi propri (l'avviso è uno, ed è il suo).
    const quiet = !!(opts && opts.quiet);
    // Se si può tradurre un riquadro incorporato si deve poter tornare indietro anche lì: senza questa parola «Mostra originale» lascerebbe in italiano proprio il rettangolo che l'utente vede meglio.
    if (!quiet && isTopFrame()) {
      frameRuns.clear();
      try { chrome.runtime.sendMessage({ type: MSG.TRANSLATE_FRAMES, mode: 'restore', runId: '' }); } catch (_) {}
    }
    // Prima di tutto il resto: l'avviso «sto traducendo» sparisce nell'istante in cui l'utente ferma, non quando le richieste già spedite si decidono a tornare.
    closeProgressToast();
    stopWatchingNewContent();
    newContentSeen = false;
    hiddenSkipped = [];
    // Il lavoro ancora in volo smette di essere quello buono: le risposte si butteranno via da sole invece di ritradurre a metà una pagina appena riportata indietro.
    runSeq++;
    const wasWorking = pageTranslating;
    // Il giro in corso finisce qui: l'utente deve poter far ripartire una traduzione subito, senza aspettare che le richieste già spedite tornino.
    pageTranslating = false;
    const restoredAny = translatedUnits.length > 0 || translatedAttrs.length > 0 || !!translatedTitle;
    if (translatedTitle) {
      try {
        document.title = translatedTitle.original;
        const el = document.querySelector('title');
        if (el && el.dataset) delete el.dataset.snTranslated;
      } catch (_) {}
      translatedTitle = null;
    }
    // Etichette: si rimette il valore di prima, o si toglie l'attributo se prima non c'era (le voci a tendina tornano a mostrare il loro testo).
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
    // Traduzioni di formati precedenti. La ricerca attraversa anche i componenti isolati (#439): lì dentro ora finisce del testo tradotto, e ciò che si può tradurre si deve poter rimettere com'era.
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
    document.querySelectorAll('[data-sn-translation="1"]').forEach((n) => n.remove());
    pageHasTranslation = false;
    pageComplete = false;
    missingCount = 0;
    totalCount = 0;
    // Fermare una traduzione appena partita non è «ripristinare»: sullo schermo non era ancora cambiato niente, e dire il contrario è già una piccola bugia. La richiesta però è stata ascoltata, e va detto.
    if (quiet) return;
    if (!restoredAny && wasWorking) Popup.showToast(I18n.t('toast_translation_cancelled'));
    else Popup.showToast(I18n.t('toast_original_restored'));
  }

  function hasTranslation() { return pageHasTranslation; }
  // Traduzione presente ma incompleta: il menu deve offrire «Riprendi», non «Mostra originale», che butterebbe via anche la parte già tradotta e pagata.
  function isPartial() { return pageHasTranslation && !pageComplete; }
  // Traduzione completa, ma sullo schermo c'è testo in lingua originale. Due strade, per l'utente identiche: il sito l'ha AGGIUNTO, oppure era già lì e lui l'ha SCOPERTO aprendo una fisarmonica o un «leggi tutto».
  // In entrambi i casi il menu deve offrire di tradurlo: senza, l'unica strada era tornare all'originale e ripagare l'intera pagina per tre righe.
  function hasNewContent() {
    if (!pageHasTranslation || !pageComplete) return false;
    if (newContentSeen) return true;
    return !!(Extract && typeof Extract.hasRevealedText === 'function'
      && Extract.hasRevealedText(hiddenSkipped));
  }
  // C'è dell'altro da tradurre, per un motivo o per l'altro: nei due casi
  // l'icona del menu serve a CONTINUARE, non a tornare all'originale.
  function canContinue() { return isPartial() || hasNewContent(); }
  // L'icona torna all'originale a traduzione completa e ferma, e anche MENTRE traduce: una cosa che parte si deve poter fermare, e a metà lavoro fermarsi vuol dire tornare indietro.
  // Fonte unica: la usano sia l'icona sia la voce etichettata.
  function showsRestore() { return pageTranslating || (pageHasTranslation && !canContinue()); }
  function missing() { return missingCount; }
  function total() { return totalCount; }

  // «Mostra originale» come voce etichettata SOLO quando c'è ancora lavoro da fare: lì l'icona serve a continuare, ma chi vuole rinunciare deve poter tornare indietro. A traduzione completa la offre già l'icona.
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
