// Traduzione dell'intera pagina e ritorno all'originale; il menu legge lo stato da qui.
// Unità da Extract, più il nome della scheda e i riquadri, a cui si passa parola.
// I figli tornano come nodi vivi, e il tradotto entra come testo: nessun HTML del modello.

(function (global) {
  'use strict';

  const { ACTIONS } = global.SN_CONST;
  const { MSG } = global.SN_MSG;
  const I18n = global.SN_I18N;
  const Popup = global.SN_POPUP;
  const Extract = global.SN_EXTRACT;

  const CHUNK_SIZE = 3000;      // caratteri per richiesta
  const CONCURRENCY = 3;        // richieste in parallelo (l'attesa è attrito)
  // Sulle pagine che si allungano mentre si scorre il testo nuovo arriva mentre traduciamo:
  // fermarsi al primo giro lo lascerebbe fuori sotto un avviso che dichiara finito (#407).
  const MAX_PASSES = 3;
  const MAX_SPLIT_DEPTH = 4;    // bisezione massima quando il modello sballa i separatori
  const SEPARATOR = '\n@@@SN_SEP@@@\n';
  const SEP_RE = /\n?@@@\s*SN_SEP\s*@@@\n?/;
  const PLACEHOLDER_RE = /\[\[\s*L\s*(\d+)\s*\]\]/g;

  const HAS_LETTER = /\p{L}/u;

  // Sotto queste misure non c'è un post incorporato ma un pixel di tracciamento: non si
  // traduce e non entra nel conto, o l'avviso manderebbe a cercare testo che non c'è (#407).
  const FRAME_MIN_W = 120;
  const FRAME_MIN_H = 40;
  // Tempo dato a un riquadro per farsi vivo. Chi non risponde entro questo
  // momento non ha un Filo che lavori lì dentro: è esattamente il caso in cui
  // l'avviso deve dire che una parte è rimasta fuori.
  const FRAME_ACK_GRACE = 2500;
  // Tetto all'attesa di chi sta lavorando: non è un timer da consumare, si esce appena
  // hanno finito tutti.
  const FRAME_WORK_CAP = 60000;

  // Il modello ha risposto ma senza testo: non è un guasto. La frase giusta parla di blocchi
  // tornati vuoti, non di «qualcosa è andato storto», che contraddice l'invito a riprendere.
  const EMPTY_ANSWER = { emptyAnswer: true };

  let pageTranslating = false;
  let pageHasTranslation = false;
  // Distinguere «completa» da «a metà» è ciò che permette al menu di offrire «Riprendi»
  // invece di far ricominciare da capo (#408). Vale solo se pageHasTranslation.
  let pageComplete = false;
  // Quanti blocchi mancano e quanti erano in tutto: serve a dire QUANTO ne manca, non solo
  // che la traduzione si è interrotta.
  let missingCount = 0;
  let totalCount = 0;
  // Unità tradotte in questa sessione, con i NODI originali (non l'HTML): è ciò
  // che "Mostra originale" rimette al suo posto.
  let translatedUnits = [];
  // Etichette tradotte (attributi), con il valore di prima — e se l'attributo
  // prima non c'era affatto, per poterlo togliere invece di lasciarne uno finto.
  let translatedAttrs = [];
  // Testo arrivato DOPO che la traduzione si era dichiarata finita (#407): sui siti a
  // scorrimento infinito è la norma, e senza accorgersene si ripagava tutta la pagina.
  let newContentSeen = false;
  let contentObserver = null;
  // Sottoalberi nascosti al momento della traduzione (fisarmoniche, «leggi tutto»): non
  // tradotti, ma se l'utente li apre il menu deve offrire di tradurli (#407).
  let hiddenSkipped = [];
  // Lo stesso per i riquadri incorporati nascosti al momento della traduzione (#503): non si sono svegliati.
  let hiddenFrames = [];
  // Una sezione si apre o si chiude solo se la pagina cambia o se l'utente la tocca: finché nessuna delle due
  // cose succede, la risposta di prima vale ancora.
  let revealedDirty = true;
  let revealedAnswer = false;
  let revealWatchOn = false;
  // Numero d'ordine del lavoro in corso. Chi chiede l'originale lo fa avanzare:
  // le richieste rimaste in volo si accorgono di non essere più quelle buone e
  // si buttano via, invece di scaricarsi addosso a una pagina che l'utente ha
  // appena riportato indietro (#407).
  let runSeq = 0;
  let usoContato = false;
  // La riga del ripiego sui crediti di Filo (#662): la pagina tradotta non ha un riquadro sotto cui
  // scriverla, la dice un avviso al primo pezzo pagato così (a fine giro si perde chi lascia la pagina prima).
  let ripiegoDelGiro = '';
  // L'avviso "sto traducendo" del giro in corso. Serve a chi lo FERMA: le
  // richieste già spedite tornano quando vogliono, e finché non tornano il
  // riquadro "Traduzione pagina in corso…" resterebbe sullo schermo accanto a
  // "Traduzione annullata". Una cosa che si ferma deve sembrare ferma subito.
  let progressToast = null;
  // Il nome della scheda è l'ultimo pezzo di lingua originale sotto gli occhi, e sta nello
  // stesso giro. Solo nel frame principale: il titolo di un riquadro non si vede.
  let translatedTitle = null;
  // Giro in corso, col conto dei riquadri: attesi, fatti vivi, finiti, e quanto è rimasto in
  // lingua originale. La chiave del giro tiene fuori i resoconti di un giro già chiuso.
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
      // Un riquadro già al lavoro non deve restare «mai finito» nel conto di chi lo ospita, o
      // l'avviso direbbe rimasto fuori del testo che sta invece arrivando.
      if (quiet) reportToHost(frameRunId, { phase: 'end', applied: 0, left: 0 });
      return;
    }
    pageTranslating = true;
    ripiegoDelGiro = '';
    // Una traduzione è un uso, non un uso per blocco: la conta la prima richiesta del giro, le altre (e quelle dei
    // riquadri incorporati) contano solo se si guastano (#969).
    usoContato = quiet;
    const myRun = ++runSeq;
    const aborted = () => myRun !== runSeq;
    // L'avviso "sto traducendo" dura quanto la traduzione e viene SOSTITUITO
    // dall'esito: due riquadri sovrapposti nell'angolo sono illeggibili.
    const progress = quiet
      ? silentToast()
      : Popup.showToast(I18n.t('toast_translating_page'), { duration: 0 });
    if (!quiet) progressToast = progress;
    // Sorveglianza accesa PRIMA di cominciare: scorrere mentre si aspetta è normale, e quel
    // testo resterebbe in lingua originale. Le nostre sostituzioni nascono già marcate.
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
        // Il sito ha allungato la pagina mentre lavoravamo: si finisce adesso, senza ricliccare
        // né ripagare ciò che è fatto. Vale anche se il primo giro non aveva trovato testo.
        if (!newContentSeen || (result.kind !== 'done' && result.kind !== 'none')) break;
      }
      if (aborted()) return;
      if (quiet) { reportToHost(frameRunId, { phase: 'end', applied: appliedOf(result), left: leftOf(result) }); return; }
      // I riquadri lavorano in parallelo e l'avviso finale li aspetta, perché è lui a dover dire
      // la verità su tutta la pagina. Fino ad allora resta in vista «sto traducendo».
      const frames = await waitForFrames(framesRunId, aborted);
      if (aborted()) return;
      // Il testo cambiato sta tutto dentro i riquadri: senza questo il menu offrirebbe di nuovo
      // «Traduci la pagina» e non ci sarebbe modo di tornare indietro.
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
      // L'utente ha annullato (o ha già fatto ripartire un altro giro): lo stato non è più
      // nostro, e toccarlo vorrebbe dire spegnere il lavoro di qualcun altro.
      if (myRun === runSeq) {
        pageTranslating = false;
        // Nessuna traduzione in piedi: niente da continuare, e nessun motivo di
        // tenere una sentinella addosso alla pagina.
        if (!pageHasTranslation) {
          stopWatchingNewContent();
          newContentSeen = false;
          hiddenSkipped = [];
          hiddenFrames = [];
          revealedDirty = true;
          revealedAnswer = false;
        }
      }
    }
  }

  // Un giro: rilegge, manda al modello solo ciò che non è già tradotto, applica. L'avviso lo
  // scrive chi chiama, l'unico a sapere se nel frattempo è arrivato dell'altro.
  async function runPass(progress, myRun) {
    const blocks = Extract.extractTranslatableBlocks();
    // I componenti aperti del sito sono alberi a parte: una sentinella sul solo
    // documento non vede il contenuto che cambia lì dentro.
    addWatchRoots(blocks.shadowRoots);
    addWatchRoots(blocks.frameDocs);
    hiddenSkipped = blocks.hidden || [];
    revealedDirty = true;
    // Pezzi di pagina che nessuno script può leggere (#439): non entrano nel
    // lavoro, ma cambiano l'avviso finale — "Pagina tradotta" sarebbe falso.
    const unreachable = Number(blocks.unreachable || 0);
    // Blocchi oltre il tetto di un giro solo: non sono persi, si prendono alla ripresa. Entrano
    // nei totali perché è l'unico modo perché l'avviso non menta su una pagina enorme.
    const truncated = Number(blocks.truncated || 0);

    // I figli di ogni unità diventano segnaposto: il modello traduce solo il testo. I blocchi
    // già tradotti non si rimandano al modello, servono solo ai totali dell'avviso (#408).
    const doneBefore = Extract.findTranslatedElements();
    const already = doneBefore.length + Number(doneBefore.attrCount || 0);
    const units = [];
    // Il nome della scheda per primo: è la prima riga di lingua originale che l'utente incontra,
    // e l'ultima che restava in inglese a pagina tradotta.
    const title = titleUnit(myRun);
    if (title) units.push(title);
    for (const b of blocks) {
      if (b.el && b.el.dataset && b.el.dataset.snTranslated) continue;
      const { templated, refs } = templateizeBlock(b.el);
      if (!hasTranslatableText(templated)) continue;
      units.push({ el: b.el, templated, refs, run: myRun });
    }
    // Etichette (suggerimenti, descrizioni, scritte sui bottoni): stessa coda di lavoro, ma si
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
        pageHasTranslation = true;
        pageComplete = true;
        missingCount = 0;
        totalCount = already;
        return { kind: 'done', unreachable };
      }
      if (unreachable) {
        // Pagina fatta solo di componenti chiusi: non è «niente da tradurre», è testo che non
        // riusciamo a leggere. Dire l'una per l'altra manda a riprovare all'infinito.
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

    // Avanzamento REALE: i blocchi hanno un totale noto, quindi l'attesa si misura invece di
    // raccontarla.
    const grandTotal = already + units.length + truncated;
    const tick = () => {
      const applied = already + units.filter((u) => u.applied).length;
      try { progress.el.textContent = I18n.t('toast_translating_page_progress', applied, grandTotal); } catch (_) {}
    };
    tick();

    let lastError = null;
    let next = 0;
    const worker = async () => {
      // Se l'utente ha chiesto l'originale, quel che resta non parte nemmeno: non si continua a
      // lavorare, e a far pagare, contro la sua ultima parola.
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

    // Le etichette gemelle si copiano adesso dal testo appena tradotto: per loro non è passata
    // nessuna richiesta al modello.
    applyMirroredAttrs(blocks.mirrors, myRun);

    const done = units.filter((u) => u.applied).length;
    const applied = already + done;
    totalCount = grandTotal;
    missingCount = grandTotal - applied;

    if (!applied) {
      pageHasTranslation = false;
      pageComplete = false;
      return { kind: 'failed', reason: reasonFor(lastError), errore: lastError };
    }

    pageHasTranslation = true;
    // I componenti chiusi non rendono la traduzione riprendibile: riprovare non li aprirà mai.
    // Lo stato resta completo ed è l'AVVISO a dire che una parte è rimasta fuori.
    pageComplete = missingCount === 0;
    if (pageComplete) return { kind: 'done', unreachable };
    // Nessun guasto: la pagina è più lunga di un giro solo, e «interrotta» suonerebbe come un
    // errore che non c'è stato.
    if (!lastError && truncated) return { kind: 'batch', applied, total: grandTotal };
    // MAI "Pagina tradotta" quando non lo è: si dice che si è interrotta,
    // quanto manca e come riprendere (il motivo tecnico grezzo resta fuori).
    return { kind: 'stopped', applied, total: grandTotal, reason: reasonFor(lastError), errore: lastError };
  }

  // `moreArrived` è l'unica cosa che chi ha fatto il lavoro non può sapere: il sito ha
  // aggiunto testo anche durante l'ultimo giro, e si è smesso di rincorrerlo.
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
        // La pagina che ospita non aveva testo proprio, ma i riquadri sì: «Non ho trovato testo»
        // davanti a uno schermo appena cambiato lingua sarebbe falso.
        if (framesApplied) { Popup.showToast(...doneToast(0, framesLeft)); return; }
        if (framesLeft) { Popup.showToast(I18n.t('toast_page_translated_partial_frame'), { duration: 7000 }); return; }
        Popup.showToast(I18n.t('toast_nothing_to_translate'));
        return;
      case 'failed':
        // Il motivo nomina dove si rimedia (crediti, modello): l'avviso porta il tasto per andarci (#663).
        Popup.toastErrore('toast_page_translate_failed', { duration: 7000, rimedio: result.errore }, result.reason);
        return;
      case 'stopped':
        Popup.showToast(
          I18n.t('toast_page_translate_stopped', result.applied, result.total, result.reason),
          { duration: 7000, rimedio: result.errore },
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

  // ── Riquadri incorporati ────────────────────────────────────────────────
  //
  // Un post incorporato, un blocco commenti, un modulo di iscrizione, una guida:
  // sono pagine dentro la pagina. Il loro testo il frame principale non lo tocca
  // — quasi sempre è di un'altra origine — ma il content script di Filo gira
  // anche lì dentro, e la traduzione gli passa parola: ogni riquadro traduce se
  // stesso e riferisce com'è andata. Dove nemmeno questo si può (un riquadro
  // in cui il nostro script non risponde), l'avviso finale lo dice, invece di
  // dichiarare tradotta una pagina con dentro un rettangolo in inglese (#407).

  // I riquadri di questo documento, divisi da chi li guarda come guarda il resto della pagina (#503): quelli da
  // contare e quelli che non si contano. Fra questi ultimi, a parte, quelli nascosti adesso che l'utente può aprire.
  // Chi non si conta non deve nemmeno rispondere: un "ci sono" in più coprirebbe nel conto un riquadro muto.
  function embeddedFrames() {
    const shown = [];
    const skipped = [];
    const folded = [];
    try {
      for (const f of framesOf(document)) {
        // Riquadro riempito dalla pagina stessa: lì dentro non c'è nessun Filo
        // che possa rispondere, ma il testo lo prende l'estrazione da qui.
        if (Extract && typeof Extract.inlineFrameBody === 'function' && Extract.inlineFrameBody(f)) continue;
        const nascosto = frameHidden(f);
        if (isInsideFiloUi(f)) { skipped.push(f); continue; }
        // Una scheda spenta del tutto toglie al riquadro anche la misura: per la riapertura conta che sia nascosto,
        // non quanto è grande adesso (la misura la riguarda chi si chiede se si è scoperto).
        if (frameTooSmall(f)) { skipped.push(f); if (nascosto) folded.push(f); continue; }
        if (nascosto) {
          skipped.push(f);
          folded.push(f);
          continue;
        }
        shown.push(f);
      }
    } catch (_) {}
    return { shown, skipped, folded };
  }

  // Anche i riquadri dentro i componenti aperti del sito: un incorporato avvolto in un componente è la norma. E quelli
  // dentro un riquadro riempito dalla pagina (gli spazi pubblicitari): lì non c'è un Filo che li giudichi al posto nostro.
  function framesOf(root) {
    const out = [];
    const roots = [root];
    while (roots.length) {
      const r = roots.pop();
      let all;
      try { all = r.querySelectorAll('*'); } catch (_) { continue; }
      for (const el of all) {
        const t = el.tagName;
        if (t === 'IFRAME' || t === 'FRAME') {
          out.push(el);
          const body = Extract && typeof Extract.inlineFrameBody === 'function' && Extract.inlineFrameBody(el);
          if (body && body.ownerDocument) roots.push(body.ownerDocument);
        }
        if (el.shadowRoot) roots.push(el.shadowRoot);
      }
    }
    return out;
  }

  // Il riquadro della pagina che ospita `el`, quando `el` sta dentro uno riempito dalla pagina; null al primo livello.
  function hostFrameOf(el) {
    try {
      const w = el.ownerDocument && el.ownerDocument.defaultView;
      return w && w !== window ? w.frameElement : null;
    } catch (_) { return null; }
  }

  // Un riquadro è nascosto se lo è lui o uno dei riquadri della pagina che lo contengono.
  function frameHidden(f) {
    if (!(Extract && typeof Extract.isHiddenFromUser === 'function')) return false;
    for (let el = f, hops = 0; el && hops < 16; el = hostFrameOf(el), hops++) {
      if (Extract.isHiddenFromUser(el)) return true;
    }
    return false;
  }

  // Sotto le misure minime, lui o chi lo contiene: dentro un francobollo non c'è niente da leggere. Conta la finestra
  // da cui si vede, non il rettangolo: un riquadro grande dietro una finestrella da un pixel è un francobollo.
  function frameTooSmall(f) {
    const misura = (el) => {
      if (Extract && typeof Extract.clippedExtent === 'function') return Extract.clippedExtent(el);
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height };
    };
    for (let el = f, hops = 0; el && hops < 16; el = hostFrameOf(el), hops++) {
      const m = misura(el);
      if (m.w < FRAME_MIN_W || m.h < FRAME_MIN_H) return true;
    }
    return false;
  }

  // Il giudizio arriva al riquadro prima della parola di tradurre: lo legge il suo preload, che senza un sì non lo
  // sveglia. La chiave è scritta uguale in page-preload.js.
  // Uno ancora in arrivo non si tocca (#1560): non ha sentito la parola di tradurre, quindi non aspetta un giudizio.
  function tellFrames(runId, list, visible) {
    for (const f of list) {
      try {
        const w = global.SN_RIQUADRI_IN_ARRIVO?.finestra(f);
        if (w) w.postMessage({ filoFrameVerdict: 1, runId: String(runId), visible: !!visible }, '*');
      } catch (_) {}
    }
  }

  // Un riquadro nascosto alla traduzione che adesso si vede: per il menu è testo scoperto come gli altri.
  function framesRevealed() {
    for (const f of hiddenFrames) {
      try {
        if (!f.isConnected) continue;
        if (frameTooSmall(f)) continue;
        if (!frameHidden(f)) return true;
      } catch (_) {}
    }
    return false;
  }

  // Un rettangolo grande come un francobollo è un pixel di tracciamento: non ha testo che
  // qualcuno legga, e una richiesta al modello per lui è denaro buttato.
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
    // Questi tre non passano dal conteggio di un giro: i totali sarebbero quelli, vecchi, di
    // una traduzione precedente.
    if (result.kind === 'none' || result.kind === 'aborted' || result.kind === 'onlyClosed') return 0;
    return Math.max(0, totalCount - missingCount);
  }

  // Quanto è rimasto in lingua originale qui dentro. Non serve il numero esatto: serve
  // sapere SE è rimasto fuori qualcosa, l'unica cosa che cambia l'avviso finale.
  function leftOf(result) {
    if (!result) return 0;
    if (result.kind === 'none' || result.kind === 'aborted') return 0;
    if (result.kind === 'done') return Number(result.unreachable || 0) > 0 ? 1 : 0;
    // Riquadro fatto di soli componenti chiusi: il testo c'è e resta in lingua originale, ma
    // non è «un blocco mancante» di cui contare il numero.
    if (result.kind === 'onlyClosed') return 1;
    return Math.max(1, missingCount);
  }

  // Indice il giro: conta i riquadri da guardare e passa parola. Se non ce n'è
  // nessuno di visibile, non si spende nemmeno un messaggio.
  async function beginFrames(myRun) {
    if (!isTopFrame()) return null;
    const { shown, skipped, folded } = embeddedFrames();
    hiddenFrames = folded;
    const expected = shown.length;
    if (!expected) return null;
    const runId = 'r' + myRun;
    tellFrames(runId, skipped, false);
    tellFrames(runId, shown, true);
    // Chi non si farà vivo resta nel conto: `expected` sono i riquadri che si
    // VEDONO, e un rettangolo visibile che nessuno script raggiunge è
    // esattamente ciò che l'avviso finale deve confessare.
    frameRuns.set(runId, { expected, acked: 0, ended: 0, applied: 0, left: 0 });
    try {
      await chrome.runtime.sendMessage({ type: MSG.TRANSLATE_FRAMES, mode: 'translate', runId });
    } catch (_) {}
    return runId;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Due finestre, non un timer unico: chi c'è si fa vivo subito (chi non lo fa non ha script
  // e non lo farà mai), poi si aspetta che finiscano, e si esce appena hanno finito tutti.
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
    // Qui arriva solo un riquadro che chi lo ospita vede (il preload ha fermato gli altri): ai suoi passa lo stesso
    // giudizio, e nel "ci sono" dice quanti ne contare.
    const { shown, skipped } = embeddedFrames();
    tellFrames(runId, skipped, false);
    tellFrames(runId, shown, true);
    reportToHost(runId, { phase: 'ack', frames: shown.length });
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

  // Sentinella del testo che il sito aggiunge DOPO: segna solo che c'è del nuovo, così il
  // menu si apre subito; il conto vero lo fa la traduzione, che salta il già tradotto.
  function startWatchingNewContent(extraRoots) {
    if (contentObserver) { addWatchRoots(extraRoots); return; }
    if (typeof MutationObserver !== 'function') return;
    try {
      contentObserver = new MutationObserver((muts) => {
        revealedDirty = true;
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
    startWatchingReveal();
  }

  // Le fisarmoniche fatte di solo CSS (la casella nascosta, il bersaglio nell'indirizzo) si aprono senza toccare
  // il documento: la sentinella lì non vede niente, ma un dito l'utente ce l'ha messo.
  function startWatchingReveal() {
    if (revealWatchOn) return;
    revealWatchOn = true;
    // Il tasto di fuga chiude, non apre: è quello con cui si esce dal menu, e sporcare lì la risposta vorrebbe
    // dire rifare la camminata a ogni apertura, cioè proprio dove il risparmio serve.
    const tocco = (e) => { if (!e || e.type !== 'keyup' || (e.key !== 'Escape' && e.key !== 'Esc')) revealedDirty = true; };
    try {
      // Il tasto destro non entra: è lui ad aprire il menu, e segnarlo sporco a ogni apertura annullerebbe il
      // risparmio proprio dove serve.
      document.addEventListener('click', tocco, true);
      document.addEventListener('keyup', tocco, true);
    } catch (_) {}
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

  // Nodo appena comparso che vale la pena offrire in traduzione: ha del testo con almeno una
  // lettera, non è la UI di Filo, e non sta dentro un blocco già tradotto.
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

  // Il marchio sta sulla RADICE del pezzo di UI, quindi si cerca fra gli antenati con
  // `closest`: fermandosi a otto, un popup più profondo passava per testo del sito.
  function isInsideFiloUi(el) {
    const UI = global.SN_FILO_UI;
    return !!(UI && UI.inside(el));
  }

  // «Pagina tradotta» solo se non è rimasto fuori niente: coi componenti chiusi (#439)
  // sarebbe una bugia. `framesLeft` viene prima: è un rettangolo intero, non un pezzetto.
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

  // Un gruppo di unità in UNA richiesta: se il modello torna un numero di pezzi diverso i
  // testi finirebbero nei blocchi sbagliati, quindi si dimezza e si riprova. null se è andata.
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

  // Una richiesta con un ritentativo dopo un attimo: un errore singolo (rete, rate limit)
  // non deve lasciare mezza pagina non tradotta.
  async function requestTranslation(chunk) {
    // Risposta senza testo: richiesta partita, risposta tornata, nessun guasto. L'avviso deve
    // dire «alcuni blocchi sono tornati vuoti», non «qualcosa è andato storto».
    let answeredEmpty = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1200));
      let res = null;
      const parteDiUnUso = usoContato;
      usoContato = true;
      try {
        res = await chrome.runtime.sendMessage({
          type: MSG.AI_REQUEST,
          action: ACTIONS.TRANSLATE_PAGE,
          payload: { chunk },
          diceRipiego: true,
          ...(parteDiUnUso ? { parteDiUnUso: true } : {}),
        });
      } catch (e) {
        res = { ok: false, error: (e && e.message) || '', code: (e && e.code) || '' };
      }
      if (res?.ok && res.keyFallback && res.keyFallback.line && !ripiegoDelGiro) {
        ripiegoDelGiro = res.keyFallback.line;
        Popup.ripiegoMostrato(Popup.showToast(ripiegoDelGiro, { duration: 7000 }).el);
      }
      if (res?.ok && String(res.text || '').trim()) return { ok: true, text: res.text };
      answeredEmpty = !!(res && res.ok);
      if (attempt) return { ok: false, error: answeredEmpty ? null : errFrom(res) };
    }
    return { ok: false, error: errFrom(null) };
  }

  // La regola sta in SN_CHAT_ERRORS, una volta sola: ricomporre a mano la
  // risposta d'errore dell'IPC faceva perdere il codice a chi se lo scordava.
  function errFrom(res) {
    const CE = global.SN_CHAT_ERRORS;
    return CE ? CE.fromResponse(res, 'translate_failed')
      : new Error(String((res && res.error) || 'translate_failed'));
  }

  // Rimette i figli originali (nodi vivi) al posto dei segnaposto. Niente contenuto perso:
  // i figli che il modello non ha richiamato tornano comunque in fondo.
  function applyTranslation(unit, text) {
    // Traduzione che arriva quando l'utente ha già chiesto l'originale: si butta. Una pagina
    // che si ritraduce da sola non l'ha chiesta nessuno (#407).
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

  // Il nome della scheda è testo come gli altri, applicato scrivendo `document.title`. Solo
  // dal frame principale: il titolo di un riquadro non si vede, e sarebbe pagato per niente.
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
      // Il segno sul <title> serve a due cose: la ripresa lo conta fra i pezzi già fatti, e la
      // sentinella non scambia la nostra stessa scrittura per testo nuovo del sito.
      const el = document.querySelector('title');
      if (el && el.dataset) el.dataset.snTranslated = '1';
      translatedTitle = { original };
      unit.applied = true;
    } catch (_) {}
  }

  // Etichette GEMELLE del testo già mostrato: decine per pagina, e mandarle al modello
  // pagherebbe due volte la stessa riga. Si copiano dall'elemento, letto ADESSO.
  function applyMirroredAttrs(mirrors, myRun) {
    for (const m of (mirrors || [])) {
      if (myRun !== runSeq) return;
      const el = m && m.el;
      if (!el || !el.isConnected) continue;
      let now = '';
      try { now = String(el.textContent || '').replace(/\s+/g, ' ').trim(); } catch (_) { continue; }
      // Il testo non è cambiato: la sua traduzione non è arrivata. L'etichetta resta com'è e
      // senza marchio, così la ripresa ci riprova invece di darla per fatta.
      if (!now || now === m.text) continue;
      applyTranslation({ el, attr: m.attr, run: myRun }, now);
    }
  }

  // Si tiene da parte com'era, e SE c'era: su una <option> senza etichetta la aggiungiamo
  // noi, e il ritorno all'originale deve toglierla. setAttribute non interpreta mai HTML.
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
    // Se si può tradurre un riquadro incorporato si deve poter tornare indietro anche lì:
    // senza questa parola «Mostra originale» lo lascerebbe in italiano.
    if (!quiet && isTopFrame()) {
      frameRuns.clear();
      try { chrome.runtime.sendMessage({ type: MSG.TRANSLATE_FRAMES, mode: 'restore', runId: '' }); } catch (_) {}
    }
    // Prima di tutto il resto: l'avviso «sto traducendo» sparisce nell'istante in cui l'utente
    // ferma, non quando le richieste già spedite si decidono a tornare.
    closeProgressToast();
    stopWatchingNewContent();
    newContentSeen = false;
    hiddenSkipped = [];
    hiddenFrames = [];
    revealedDirty = true;
    revealedAnswer = false;
    // Il lavoro ancora in volo smette di essere quello buono: quando le
    // risposte arriveranno si butteranno via da sole, invece di ritradurre a
    // metà una pagina che l'utente ha appena riportato indietro.
    runSeq++;
    const wasWorking = pageTranslating;
    // Il giro in corso finisce qui: l'utente deve poter far ripartire una traduzione subito,
    // senza aspettare che le richieste già spedite tornino.
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
    // Etichette: si rimette il valore di prima, o si toglie l'attributo se prima non c'era
    // (le voci a tendina tornano a mostrare il loro testo).
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
    // Traduzioni di formati precedenti. La ricerca attraversa anche i componenti isolati
    // (#439): ciò che si può tradurre si deve poter rimettere com'era.
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
    // Fermare una traduzione appena partita non è «ripristinare»: sullo schermo non era ancora
    // cambiato niente. La richiesta però è stata ascoltata, e va detto.
    if (quiet) return;
    if (!restoredAny && wasWorking) Popup.showToast(I18n.t('toast_translation_cancelled'));
    else Popup.showToast(I18n.t('toast_original_restored'));
  }

  function hasTranslation() { return pageHasTranslation; }
  // Traduzione presente ma incompleta: il menu deve offrire «Riprendi», non «Mostra
  // originale», che butterebbe via anche la parte già tradotta e pagata.
  function isPartial() { return pageHasTranslation && !pageComplete; }
  // Traduzione completa, ma sullo schermo c'è lingua originale: il sito l'ha aggiunto, o
  // l'utente l'ha scoperto aprendo una fisarmonica. In entrambi i casi va offerto di tradurlo.
  function hasNewContent() {
    if (!pageHasTranslation || !pageComplete) return false;
    if (newContentSeen) return true;
    // La risposta costa una camminata su TUTTE le sezioni rimandate, e il tasto destro è la cosa che in Filo si
    // apre più spesso: si rifà solo se da allora la pagina è cambiata o l'utente l'ha toccata (#505).
    if (!revealedDirty) return revealedAnswer;
    revealedDirty = false;
    revealedAnswer = !!(Extract && typeof Extract.hasRevealedText === 'function'
      && Extract.hasRevealedText(hiddenSkipped)) || framesRevealed();
    return revealedAnswer;
  }
  // C'è dell'altro da tradurre, per un motivo o per l'altro: nei due casi
  // l'icona del menu serve a CONTINUARE, non a tornare all'originale.
  function canContinue() { return isPartial() || hasNewContent(); }
  // La barra laterale chiede il nome dell'icona senza toccare la pagina: la risposta va rifatta.
  function ricontrolla() { revealedDirty = true; }
  // L'icona torna all'originale a traduzione completa e ferma, e anche MENTRE traduce: una
  // cosa che parte si deve poter fermare. Fonte unica: icona e voce etichettata la usano.
  function showsRestore() { return pageTranslating || (pageHasTranslation && !canContinue()); }
  function missing() { return missingCount; }
  function total() { return totalCount; }

  // «Mostra originale» come voce etichettata SOLO quando c'è ancora lavoro da fare: lì
  // l'icona serve a continuare. A traduzione completa la offre già l'icona.
  function buildRestoreOriginalItem() {
    const Icons = global.SN_ICONS;
    const icon = (Icons && typeof Icons.showOriginal === 'function') ? Icons.showOriginal(18) : undefined;
    return { type: 'item', icon, label: I18n.t('menu_show_original'), onClick: () => restoreOriginal() };
  }

  global.SN_TRANSLATE_PAGE = {
    translatePage, restoreOriginal, hasTranslation,
    isPartial, hasNewContent, canContinue, ricontrolla, showsRestore, missing, total, buildRestoreOriginalItem,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
