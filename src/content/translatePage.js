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
  // Unità tradotte in questa sessione, con i NODI originali (non l'HTML): è ciò
  // che "Mostra originale" rimette al suo posto.
  let translatedUnits = [];

  async function translatePage() {
    if (pageTranslating) {
      Popup.showToast(I18n.t('toast_translating_page'));
      return;
    }
    pageTranslating = true;
    // L'avviso "sto traducendo" dura quanto la traduzione e viene SOSTITUITO
    // dall'esito: due riquadri sovrapposti nell'angolo sono illeggibili.
    const progress = Popup.showToast(I18n.t('toast_translating_page'), { duration: 0 });

    try {
      const blocks = Extract.extractTranslatableBlocks();

      // Per ogni unità: i figli (link, img, span, …) diventano segnaposto [[Lk]],
      // così il modello traduce solo il testo e la struttura resta intatta.
      const units = [];
      for (const b of blocks) {
        const { templated, refs } = templateizeBlock(b.el);
        // Se tolti i segnaposto non resta testo, non c'è nulla da tradurre.
        if (!hasTranslatableText(templated)) continue;
        units.push({ el: b.el, templated, refs });
      }

      if (!units.length) {
        Popup.showToast(I18n.t('toast_nothing_to_translate'));
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

      // Le richieste partono a gruppi e i risultati vengono applicati appena
      // arrivano: la pagina si traduce progressivamente sotto gli occhi.
      let lastError = '';
      let next = 0;
      const worker = async () => {
        while (next < chunks.length) {
          const chunk = chunks[next++];
          const err = await translateGroup(chunk, 0);
          if (err) lastError = err;
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker),
      );

      const done = units.filter((u) => u.applied).length;
      if (!done) {
        Popup.showToast(lastError || I18n.t('err_provider_failed'));
      } else {
        pageHasTranslation = true;
        Popup.showToast(I18n.t(done < units.length ? 'toast_page_translated_partial' : 'toast_page_translated'));
      }
    } finally {
      pageTranslating = false;
    }
  }

  // Traduce un gruppo di unità con UNA richiesta. Se il modello restituisce un
  // numero di pezzi diverso dal numero di unità, i testi finirebbero nei blocchi
  // sbagliati: in quel caso si dimezza il gruppo e si riprova (fino a una unità
  // sola, dove il rischio non esiste). Ritorna '' se ok, il messaggio d'errore
  // altrimenti.
  async function translateGroup(units, depth) {
    if (!units.length) return '';
    const joined = units.map((u) => u.templated).join(SEPARATOR);
    const res = await requestTranslation(joined);
    if (!res.ok) return res.error;

    const parts = String(res.text || '').split(SEP_RE);
    if (units.length === 1) {
      // Separatori spuri nell'output di una singola unità: si ricuce tutto.
      applyTranslation(units[0], parts.join(' ').trim());
      return '';
    }
    if (parts.length === units.length) {
      for (let i = 0; i < units.length; i++) applyTranslation(units[i], (parts[i] || '').trim());
      return '';
    }
    if (depth >= MAX_SPLIT_DEPTH) {
      // Ripiego: applica quel che si può, in ordine, senza sfasare oltre.
      const n = Math.min(parts.length, units.length);
      for (let i = 0; i < n; i++) applyTranslation(units[i], (parts[i] || '').trim());
      return '';
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
        res = { ok: false, error: (e && e.message) || '' };
      }
      if (res?.ok && String(res.text || '').trim()) return { ok: true, text: res.text };
      if (attempt) return { ok: false, error: res?.error || I18n.t('err_provider_failed') };
    }
    return { ok: false, error: I18n.t('err_provider_failed') };
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
    document.querySelectorAll('[data-sn-translated="1"]').forEach((el) => {
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
    Popup.showToast(I18n.t('toast_original_restored'));
  }

  function hasTranslation() { return pageHasTranslation; }

  global.SN_TRANSLATE_PAGE = { translatePage, restoreOriginal, hasTranslation };
})(typeof globalThis !== 'undefined' ? globalThis : self);
