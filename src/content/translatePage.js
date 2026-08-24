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
  const MAX_SPLIT_DEPTH = 4;    // bisezione massima quando il modello sballa i separatori
  const SEPARATOR = '\n@@@SN_SEP@@@\n';
  const SEP_RE = /\n?@@@\s*SN_SEP\s*@@@\n?/;
  const PLACEHOLDER_RE = /\[\[\s*L\s*(\d+)\s*\]\]/g;

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

  async function translatePage() {
    // Riclic mentre traduce: l'avviso "in corso" è già sullo schermo (dura
    // quanto il lavoro), un secondo riquadro identico sopra sarebbe solo rumore.
    if (pageTranslating) return;
    pageTranslating = true;
    // L'avviso "sto traducendo" dura quanto la traduzione e viene SOSTITUITO
    // dall'esito: due riquadri sovrapposti nell'angolo sono illeggibili.
    const progress = Popup.showToast(I18n.t('toast_translating_page'), { duration: 0 });

    try {
      const blocks = Extract.extractTranslatableBlocks();
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
      const already = Extract.findTranslatedElements().length;
      const units = [];
      for (const b of blocks) {
        if (b.el && b.el.dataset && b.el.dataset.snTranslated) continue;
        const { templated, refs } = templateizeBlock(b.el);
        // Se tolti i segnaposto non resta testo, non c'è nulla da tradurre.
        if (!hasTranslatableText(templated)) continue;
        units.push({ el: b.el, templated, refs });
      }

      if (!units.length) {
        progress.close();
        if (truncated) {
          // Niente di nuovo da mandare in questo giro, ma la coda della pagina
          // esiste: non è finita, e va detto.
          pageHasTranslation = already > 0;
          pageComplete = false;
          totalCount = already + truncated;
          missingCount = truncated;
          Popup.showToast(I18n.t('toast_page_translate_batch', already, totalCount), { duration: 7000 });
        } else if (already) {
          // Ripresa su una pagina che nel frattempo è già tutta tradotta.
          pageHasTranslation = true;
          pageComplete = true;
          missingCount = 0;
          totalCount = already;
          Popup.showToast(...doneToast(unreachable));
        } else if (unreachable) {
          // Pagina fatta solo di componenti chiusi: non è "niente da tradurre",
          // è testo che non riusciamo a leggere. Dire l'una per l'altra
          // manderebbe l'utente a riprovare all'infinito.
          Popup.showToast(I18n.t('toast_only_closed_components'), { duration: 7000 });
        } else {
          Popup.showToast(I18n.t('toast_nothing_to_translate'));
        }
        return;
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
        while (next < chunks.length) {
          const chunk = chunks[next++];
          const err = await translateGroup(chunk, 0);
          if (err) lastError = err;
          tick();
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker),
      );

      const done = units.filter((u) => u.applied).length;
      const applied = already + done;
      progress.close();
      totalCount = grandTotal;
      missingCount = grandTotal - applied;

      if (!applied) {
        // Niente tradotto: né prima né adesso. Nessuno stato da conservare.
        pageHasTranslation = false;
        pageComplete = false;
        Popup.showToast(I18n.t('toast_page_translate_failed', reasonFor(lastError)), { duration: 7000 });
        return;
      }

      pageHasTranslation = true;
      // NB: i componenti chiusi non rendono la traduzione "riprendibile" —
      // riprovare non li aprirà mai. Lo stato resta quindi completo (il menu
      // offre "Mostra originale", non "Riprendi": riprendere non farebbe
      // nulla), ed è l'AVVISO a dire che una parte è rimasta fuori.
      pageComplete = missingCount === 0;
      if (pageComplete) {
        Popup.showToast(...doneToast(unreachable));
      } else {
        // MAI "Pagina tradotta" quando non lo è: si dice che si è interrotta,
        // quanto manca e come riprendere (il motivo tecnico grezzo resta fuori).
        Popup.showToast(
          I18n.t('toast_page_translate_stopped', applied, grandTotal, reasonFor(lastError)),
          { duration: 7000 },
        );
      }
    } finally {
      progress.close();
      pageTranslating = false;
    }
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
    Popup.showToast(I18n.t('toast_original_restored'));
  }

  function hasTranslation() { return pageHasTranslation; }
  // Traduzione presente ma incompleta: il menu deve offrire "Riprendi", non
  // "Mostra originale" (che butterebbe via anche la parte già tradotta e
  // pagata).
  function isPartial() { return pageHasTranslation && !pageComplete; }
  function missing() { return missingCount; }
  function total() { return totalCount; }

  // Voce etichettata "Mostra originale" da mostrare SOLO quando la traduzione è
  // a metà: lì l'icona del menu serve per riprendere, ma chi vuole rinunciare
  // deve comunque poter tornare indietro (se puoi aggiungere, devi poter
  // togliere). A traduzione completa la voce non serve: la offre già l'icona.
  function buildRestoreOriginalItem() {
    const Icons = global.SN_ICONS;
    const icon = (Icons && typeof Icons.showOriginal === 'function') ? Icons.showOriginal(18) : undefined;
    return { type: 'item', icon, label: I18n.t('menu_show_original'), onClick: () => restoreOriginal() };
  }

  global.SN_TRANSLATE_PAGE = {
    translatePage, restoreOriginal, hasTranslation,
    isPartial, missing, total, buildRestoreOriginalItem,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
