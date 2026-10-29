// Quello che l'Aiuto fa sulla pagina (#1509.3): la legge (foto, schema, immagini), aspetta che si fermi, ci esegue le
// azioni del menu, ne evidenzia il passo. Su un sito lo chiede l'Aiuto dallo strato sopra la scheda e qui si risponde;
// sulle pagine di Filo lo chiama l'Aiuto nel documento. Regole: patterns/i-riquadri-di-filo-su-un-sito-stanno-sopra-la-scheda.md

(function (global) {
  'use strict';

  const MSG = (global.SN_MSG && global.SN_MSG.MSG) || {};
  const Extract = global.SN_EXTRACT;
  const Highlight = global.SN_HIGHLIGHT;

  // Etichetta breve (≤4 parole) per descrivere un'azione utente: va al modello, quindi passa da
  // `nomeElemento`, che non legge mai il valore di un campo segreto (#810.7).
  function describeElementBriefly(el) {
    if (!el) return '';
    const raw = (() => { try { return Extract?.nomeElemento?.(el) || ''; } catch (_) { return ''; } })();
    if (!raw) return el.tagName.toLowerCase();
    return raw.split(' ').slice(0, 4).join(' ');
  }

  function trova(selector) {
    try { return document.querySelector(selector); } catch (_) { return null; }
  }

  // ---------- Leggere la pagina ----------

  // #711 — «questa foto è fatta con l'AI?» chiesto qui deve avere la stessa lettura del
  // tasto destro: si leggono le etichette delle immagini che l'utente ha davanti, dalle
  // più grandi. Oltre il tetto il modello sa quante ne sono rimaste fuori.
  const MAX_IMMAGINI_ORIGINE = 12;
  // Un'immagine che non arriva non deve tenere ferma la risposta: conta come non letta.
  const ATTESA_ORIGINE_MS = 3000;
  // Un'immagine letta resta letta: le domande dopo non la riscaricano.
  const origineLetta = new Map();
  function immaginiVisibili() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const viste = new Set();
    const out = [];
    for (const im of Array.from(document.images || [])) {
      if (im.closest && im.closest('.sn-sidebar')) continue;
      const src = im.currentSrc || im.src;
      if (!src || viste.has(src) || !im.complete || !im.naturalWidth) continue;
      const r = im.getBoundingClientRect();
      if (r.width < 48 || r.height < 48) continue;
      if (r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) continue;
      viste.add(src);
      out.push({ im, src, r, area: r.width * r.height });
    }
    return out.sort((a, b) => b.area - a.area);
  }
  async function origineImmaginiVisibili() {
    const Actions = global.SN_ACTIONS;
    if (!Actions?.leggiOrigine || !Actions?.scaricaImmagine) return null;
    const tutte = immaginiVisibili();
    if (!tutte.length) return null;
    const esiti = await Promise.all(tutte.slice(0, MAX_IMMAGINI_ORIGINE).map(async ({ im, src, r }, i) => {
      try {
        let lettura = origineLetta.get(src);
        if (!lettura) {
          lettura = (async () => Actions.leggiOrigine(await Actions.scaricaImmagine(src, im)))();
          lettura.then((p) => { if (!p || !p.ok || p.firmatario === 'non_verificato') origineLetta.delete(src); }, () => origineLetta.delete(src));
          if (origineLetta.size >= 500) origineLetta.delete(origineLetta.keys().next().value);
          origineLetta.set(src, lettura);
        }
        const p = await Promise.race([
          lettura,
          new Promise((ok) => setTimeout(() => ok(null), ATTESA_ORIGINE_MS)),
        ]);
        if (!p || !p.ok) return null;
        return {
          n: i + 1,
          alt: String(im.alt || im.title || '').slice(0, 120),
          larghezza: Math.round(r.width),
          altezza: Math.round(r.height),
          frase: p.frase || '',
        };
      } catch (_) { return null; }
    }));
    const lette = esiti.filter(Boolean);
    return { visibili: tutte.length, controllate: lette.length, esiti: lette.filter((e) => e.frase) };
  }

  // I campi segreti leggibili a schermo arrivano al modello coperti dai puntini (#810.7): misurati prima e dopo lo
  // scatto, se la pagina scorre nel frattempo; quelli dei riquadri e dei componenti chiusi li misura il main, che
  // con campi da coprire manda la foto piena: coperta prima di diventare leggera, il JPEG non sparge le cifre attorno.
  // Se coprirli non riesce, l'immagine non parte.
  async function captureScreenshot() {
    try {
      const prima = Extract.campiSegretiInVista();
      const r = await chrome.runtime.sendMessage({
        type: MSG.CAPTURE_VISIBLE_TAB, leggera: true, campiSegreti: true, campiNellaPagina: prima.length,
      });
      if (!r?.ok || !r.dataUrl) return null;
      const campi = prima.concat(Array.isArray(r.campi) ? r.campi : [], Extract.campiSegretiInVista());
      if (!campi.length && !r.fattore) return r.dataUrl;
      // `fattore` e `qualita` dal main quando la foto è arrivata piena: si rimpicciolisce come farebbe lui.
      return await Extract.fotoCoperta(r.dataUrl, campi, r);
    } catch (_) {}
    return null;
  }

  // Le SPA cambiano contenuto e URL in modo asincrono: si esce quando l'URL è cambiato e il
  // DOM è quieto da `quietMs`, oppure dopo `maxMs`.
  function waitForPageSettle({ initialUrl, minMs = 250, quietMs = 350, maxMs = 2500 } = {}) {
    return new Promise((resolve) => {
      const start = Date.now();
      let lastMutation = Date.now();
      let urlChanged = !initialUrl || location.href !== initialUrl;

      const observer = new MutationObserver(() => {
        lastMutation = Date.now();
        if (!urlChanged && location.href !== initialUrl) urlChanged = true;
      });
      try {
        observer.observe(document.documentElement, {
          childList: true, subtree: true, attributes: true, characterData: true,
        });
      } catch (_) {}

      const tick = () => {
        const now = Date.now();
        const elapsed = now - start;
        const sinceMutation = now - lastMutation;
        const ready = document.readyState === 'complete';
        const longEnough = elapsed >= minMs;
        const quiet = sinceMutation >= quietMs;
        const enoughEvidence = urlChanged || elapsed >= maxMs / 2;
        if ((longEnough && quiet && ready && enoughEvidence) || elapsed >= maxMs) {
          observer.disconnect();
          resolve();
          return;
        }
        setTimeout(tick, 80);
      };
      tick();
    });
  }

  // Quello che il modello vede a ogni giro. `attendi`: dopo un'azione si aspetta la pagina aggiornata prima della
  // foto, o il modello vede quella vecchia e chiede di ripetere il clic; `daUrl` è l'indirizzo di prima dell'azione.
  // `origine`: le etichette delle immagini a vista, solo quando scrive l'utente.
  async function leggi({ attendi = false, daUrl = '', origine = false } = {}) {
    if (attendi) await waitForPageSettle({ initialUrl: String(daUrl || '') || location.href });
    const [screenshot, origineImmagini] = await Promise.all([
      captureScreenshot(),
      origine ? origineImmaginiVisibili().catch(() => null) : Promise.resolve(null),
    ]);
    const outline = (() => { try { return Extract?.extractInteractiveOutline?.() || ''; } catch (_) { return ''; } })();
    const viewport = (() => { try { return Extract?.viewportInfo?.() || null; } catch (_) { return null; } })();
    return { url: location.href, titolo: document.title, outline, viewport, screenshot, origineImmagini };
  }

  // ---------- Azioni SULLA PAGINA (parità col menu tasto destro) ----------
  //
  // L'agente "Aiuto" può eseguire le stesse azioni del menu contestuale su
  // testo/immagine/link. A differenza delle azioni tipizzate di Filo, queste
  // vivono nel content script (SN_ACTIONS in src/content/actions.js, SN_TTS in
  // tts.js) e operano sull'elemento o sulla selezione corrente. Ognuna dichiara
  // solo il suo COSTO: se parte, chiede o no lo decide il main con la stessa
  // regola del dispatch (#530, MSG.FILO_DECIDI_PAGINA). Uscire verso l'esterno
  // (cercare, condividere) costa 2; il resto resta sul computer e costa 1.
  //
  // SN_ACTIONS/SN_TTS sono caricati DOPO questo file (vedi i preload), quindi si
  // risolvono al volo dentro la funzione, non al top dell'IIFE.
  const AZIONI = Object.freeze({
    // testo / selezione
    copy:         { target: 'text',  costo: 1, label: 'copia testo' },
    cut:          { target: 'text',  costo: 1, label: 'taglia testo' },
    search_text:  { target: 'text',  costo: 2, label: 'cerca testo sul web', viaFilo: true },
    read_aloud:   { target: 'text',  costo: 1, label: 'leggi ad alta voce' },
    stop_reading: { target: 'none',  costo: 1, label: 'ferma la lettura' },
    edit_text:    { target: 'text',  costo: 1, label: 'modifica testo' },
    // immagini
    copy_image:      { target: 'image', costo: 1, label: 'copia immagine' },
    save_image:      { target: 'image', costo: 1, label: 'salva immagine' },
    copy_image_link: { target: 'image', costo: 1, label: 'copia link immagine' },
    search_image:    { target: 'image', costo: 2, label: 'cerca immagine sul web', viaFilo: true },
    // `viaFilo`: passa da NAVIGA, che il dispatch decide da sé (una ricerca porta `cerca` e costa 2 anche lì).
    // Chiedere anche qui farebbe due domande per la stessa uscita.
    open_link:  { target: 'link', costo: 1, label: 'apri link in nuova scheda', viaFilo: true },
    copy_link:  { target: 'link', costo: 1, label: 'copia link' },
    save_link:  { target: 'link', costo: 1, label: 'salva link per dopo' },
    share_link: { target: 'link', costo: 2, label: 'condividi link' },
    // la pagina intera: la stessa strada di «Salva per dopo» del menu, che poi chiude la scheda (niente passo dopo).
    save_page: { target: 'none', costo: 1, label: 'salva la pagina per dopo', chiude: true },
  });

  // Come Alt+S: le pagine di Filo non si mettono da parte, tranne quella d'errore, che salva il sito non caricato.
  function paginaDaSalvare() {
    try { return location.protocol !== 'filo:' || location.href.startsWith('filo://error/'); } catch (_) { return false; }
  }

  // Testo bersaglio: quello fornito dall'agente, altrimenti la selezione corrente.
  function resolveActionText(page) {
    const provided = String(page.text ?? page.testo ?? page.query ?? page.selection ?? '').trim();
    if (provided) return provided;
    try {
      if (Extract?.selezioneSegreta?.()) return '';
      return (window.getSelection?.()?.toString() || '').trim();
    } catch (_) { return ''; }
  }

  // Immagine bersaglio: per selettore, per src, altrimenti la più grande visibile.
  function resolveImageEl(page) {
    const sel = String(page.selector ?? page.css ?? '').trim();
    if (sel) {
      const el = trova(sel);
      if (el) return el.tagName === 'IMG' ? el : el.querySelector('img');
    }
    const wanted = String(page.src ?? page.url ?? page.href ?? '').trim();
    const imgs = Array.from(document.images || []);
    if (wanted) {
      const hit = imgs.find((im) => (im.currentSrc || im.src || '') === wanted)
        || imgs.find((im) => (im.currentSrc || im.src || '').includes(wanted));
      if (hit) return hit;
    }
    let best = null; let bestArea = 0;
    for (const im of imgs) {
      const r = im.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea && r.width > 32 && r.height > 32) { best = im; bestArea = area; }
    }
    return best;
  }

  // Link bersaglio: per selettore (anche su un figlio del link), per URL. Collegamento e indirizzo come li vede il menu.
  function resolveLinkEl(page) {
    const { SELETTORE_COLLEGAMENTO: LINK, indirizzoDelLink: indirizzo } = global.SN_ACTIONS;
    const sel = String(page.selector ?? page.css ?? '').trim();
    if (sel) {
      try {
        const el = document.querySelector(sel);
        const a = el && (el.closest?.(LINK) || el.querySelector?.(LINK));
        if (a && indirizzo(a)) return a;
      } catch (_) {}
    }
    const wanted = String(page.url ?? page.href ?? '').trim();
    if (wanted) {
      const links = Array.from(document.querySelectorAll(LINK));
      const hit = links.find((a) => indirizzo(a) === wanted) || links.find((a) => indirizzo(a).includes(wanted));
      if (hit) return hit;
    }
    return null;
  }

  // L'azione sulla pagina. `{ ok, riga }` dice com'è andata, in una riga del diario; un'uscita che passa da Filo
  // (cercare, aprire un link) torna come `{ filo: { action, etichetta } }`, e la fa chi tiene la conversazione.
  async function azione(page) {
    page = page && typeof page === 'object' ? page : {};
    const spec = AZIONI[page.op];
    if (!spec) return { ok: false };
    const Actions = global.SN_ACTIONS;
    const Tts = global.SN_TTS;
    const label = spec.label;

    // Risolvi il bersaglio in anticipo: se manca, niente popup né esecuzione.
    let text = '';
    let imgEl = null;
    let linkEl = null;
    if (spec.target === 'text') {
      text = resolveActionText(page);
      if (!text && page.op !== 'edit_text') return { ok: false, nonTrovato: true, riga: `${label}: nessun testo selezionato` };
    } else if (spec.target === 'image') {
      imgEl = resolveImageEl(page);
      if (!imgEl) return { ok: false, nonTrovato: true, riga: `${label}: immagine non trovata` };
    } else if (spec.target === 'link') {
      linkEl = resolveLinkEl(page);
      const fallbackUrl = String(page.url ?? page.href ?? '').trim();
      if (!linkEl && !(page.op === 'open_link' && fallbackUrl)) return { ok: false, nonTrovato: true, riga: `${label}: link non trovato` };
    } else if (page.op === 'save_page' && !paginaDaSalvare()) {
      return { ok: false, riga: `${label}: le pagine di Filo non si salvano per dopo` };
    }

    // Senza risposta dal main si chiede: il caso prudente.
    if (!spec.viaFilo) {
      let d = null;
      try { d = await chrome.runtime.sendMessage({ type: MSG.FILO_DECIDI_PAGINA, costo: spec.costo, campo: 'web' }); } catch (_) {}
      const risposta = d && d.ok ? d.risposta : 'chiede';
      if (risposta === 'no') return { ok: false, riga: `${label}: non applicata, ${(d && d.no) || 'Filo non la fa da solo'}` };
      if (risposta !== 'si') {
        const Ui = global.SN_CONFIRM_UI;
        // Il testo intero e nel suo riquadro: si conferma quello che si legge, e il
        // testo non può chiudere le virgolette e parlare come Filo (#592.7).
        let detail = '';
        if (spec.target === 'text') detail = text;
        else if (imgEl) detail = imgEl.currentSrc || imgEl.src || '';
        else if (linkEl) detail = Actions.indirizzoDelLink(linkEl);
        const perche = d && d.perche ? `\n\n${d.perche}` : '';
        const parti = [...(detail ? [`${label}:`, { citazione: detail, nuda: spec.target !== 'text' }] : [label]), ...(perche ? [perche] : [])];
        const opts = { title: 'Filo chiede conferma', text: `${label}${detail ? `:\n“${detail}”` : ''}${perche}`, parti };
        let ok = false;
        try {
          ok = Ui ? await (d && d.digita ? Ui.confirmTyped(opts) : Ui.confirm(opts)) : global.confirm(opts.text);
        } catch (_) { ok = false; }
        if (d && d.conferma) {
          try { global.SN_POPUP?.conta?.({ misura: 'conferma', chiave: String(d.conferma), esito: ok ? 'approvata' : 'rifiutata' }); } catch (_) {}
        }
        if (!ok) return { ok: false, riga: `${label}: annullata` };
      }
    }

    try {
      switch (page.op) {
        case 'copy': Actions?.copyToClipboard(text); break;
        case 'cut': Actions?.cutSelection(); break;
        case 'search_text': return { filo: { action: { type: 'NAVIGA', url: Actions.searchUrlFor(text), cerca: text }, etichetta: label } };
        case 'read_aloud': await Tts?.readAloud(text); break;
        case 'stop_reading': Tts?.stopReading(); break;
        case 'edit_text': global.SN_EDITBOX?.openEditBox(text); break;
        case 'copy_image': await Actions?.copyImage(imgEl); break;
        case 'save_image': Actions?.downloadImage(imgEl); break;
        case 'copy_image_link': Actions?.copyUrlToClipboard(imgEl.currentSrc || imgEl.src); break;
        case 'search_image': return { filo: {
          action: { type: 'NAVIGA', url: Actions.imageSearchUrlFor(imgEl), cerca: imgEl.currentSrc || imgEl.src || 'immagine' },
          etichetta: label,
        } };
        case 'open_link': {
          // "Apri in nuova scheda" è un'azione di sistema già registrata: la
          // instradiamo via il ponte di #192.1 (NAVIGA → TabManager del main).
          const url = Actions.indirizzoDelLink(linkEl) || String(page.url ?? page.href ?? '').trim();
          return { filo: { action: { type: 'NAVIGA', url }, etichetta: '' } };
        }
        case 'copy_link': Actions?.copyUrlToClipboard(Actions.indirizzoDelLink(linkEl)); break;
        case 'save_link': await Actions?.saveLink(linkEl); break;
        case 'save_page': {
          if (!(await Actions?.savePage())) return { ok: false, riga: `${label}: non riuscita` };
          return { ok: true, riga: 'pagina salvata in «Aperti per dopo»: chiudo la scheda' };
        }
        case 'share_link': await Actions?.shareLink(linkEl); break;
        default: return { ok: false, riga: `${label}: non riuscita` };
      }
    } catch (_) {
      return { ok: false, riga: `${label}: non riuscita` };
    }
    return { ok: true, riga: `${label}: fatto` };
  }

  // ---------- Il passo indicato ----------

  // `segui`: il clic sul passo (o l'Accetta di un campo) è un gesto dell'utente da riportare a `suAzione`, con quello
  // che serve al giro dopo: il nome dell'elemento e l'indirizzo di prima del clic. `id` dice di quale passo si tratta.
  // Con `suPosa(rect | null)` nota, valore e Accetta li disegna chi chiede, fuori dal documento, sul rettangolo che riceve.
  let passoMostrato = 0;
  function evidenzia(h, suAzione, suPosa) {
    h = h && typeof h === 'object' ? h : {};
    const selector = String(h.selector || '');
    const id = Number(h.id) || 0;
    const onAction = h.segui && typeof suAzione === 'function' ? () => {
      const etichetta = describeElementBriefly(trova(selector));
      const daUrl = location.href;
      pulisci({ hover: true });
      suAzione({ id, etichetta, daUrl });
    } : null;
    const fuori = typeof suPosa === 'function';
    let ok = false;
    try {
      ok = !!Highlight.show(selector, {
        note: String(h.note || ''), action: h.action, value: h.value, onAction,
        senzaNota: fuori, suPosa: fuori ? (r) => suPosa(id, r) : null,
      });
    } catch (_) { ok = false; }
    passoMostrato = ok ? id : 0;
    return { ok };
  }

  // L'Accetta premuto sulla nota fuori dal documento, per il passo `id` se è ancora quello mostrato.
  function accetta(a) {
    const id = Number(a && a.id) || 0;
    if (!id || id !== passoMostrato) return { ok: false };
    let ok = false;
    try { ok = !!Highlight.accetta(); } catch (_) { ok = false; }
    return { ok };
  }

  // reveal e hover li fa Filo da sé: validazione e whitelist stanno in Highlight.autoAction.
  function auto(a) {
    a = a && typeof a === 'object' ? a : {};
    let r = null;
    try { r = Highlight.autoAction(String(a.selector || ''), a.act); } catch (_) { r = null; }
    if (!r) return { ok: false, reason: 'errore', etichetta: '' };
    return { ok: !!r.ok, reason: r.reason || '', etichetta: r.target ? describeElementBriefly(r.target) : '' };
  }

  // `hover`: anche il menu tenuto aperto da Filo, che dopo un gesto vero dell'utente non serve più.
  function pulisci(a) {
    passoMostrato = 0;
    try { Highlight.clear(); } catch (_) {}
    if (a && a.hover) { try { Highlight.clearForceHover?.(); } catch (_) {} }
    return { ok: true };
  }

  // ---------- Le domande dell'Aiuto nello strato ----------

  // Risponde solo il frame principale della pagina: è lui «la pagina» (#405). Nello strato non c'è niente da servire.
  const principale = (() => { try { return window.top === window.self; } catch (_) { return false; } })();
  const nelloStrato = !!global.SN_FILO_UI?.nelloStrato;

  const manda = (m) => { try { Promise.resolve(chrome.runtime.sendMessage(m)).catch(() => {}); } catch (_) {} };

  // Dove sta il bersaglio del passo, allo strato: una volta per fotogramma, mentre la pagina scorre o cambia.
  let posaInCoda = null;
  function mandaPosa(id, r) {
    const prima = posaInCoda;
    posaInCoda = { id, rect: r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null };
    if (prima) return;
    requestAnimationFrame(() => {
      const x = posaInCoda;
      posaInCoda = null;
      if (x) manda({ type: MSG.AIUTO_ALLO_STRATO, comando: 'posa', id: x.id, rect: x.rect });
    });
  }

  async function servi(m) {
    const args = m.args && typeof m.args === 'object' ? m.args : {};
    let esito = null;
    try {
      if (m.op === 'stato') esito = !!global.SN_SIDEBAR?.dalloStrato?.(args);
      else if (m.op === 'leggi') esito = await leggi(args);
      else if (m.op === 'azione') esito = await azione(args.page);
      else if (m.op === 'evidenzia') {
        esito = evidenzia(args, (ev) => manda({ type: MSG.AIUTO_ALLO_STRATO, comando: 'azione', ...ev }), mandaPosa);
      } else if (m.op === 'accetta') esito = accetta(args);
      else if (m.op === 'auto') esito = auto(args);
      else if (m.op === 'pulisci') esito = pulisci(args);
    } catch (e) {
      console.error('[Filo] Aiuto sulla pagina', m.op, e);
      esito = null;
    }
    if (m.rid) manda({ type: MSG.AIUTO_ESITO, rid: String(m.rid), esito });
  }

  if (principale && !nelloStrato && MSG.AIUTO_DALLO_STRATO) {
    try {
      global.chrome?.runtime?.onMessage?.addListener((m) => {
        if (!m || m.type !== MSG.AIUTO_DALLO_STRATO) return;
        servi(m);
      });
    } catch (_) {}
  }

  global.SN_AIUTO_PAGINA = {
    AZIONI, leggi, azione, evidenzia, accetta, auto, pulisci, describeElementBriefly,
    resolveActionText, resolveImageEl, resolveLinkEl,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
