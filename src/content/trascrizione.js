// Il riquadro di Trascrivi (#2374): l'immagine col suo testo sopra, trasparente e selezionabile come in un PDF; Ctrl+C
// copia la selezione, «Copia tutto» tutto, Esc o un clic fuori chiude. Su un sito si apre nello strato dei riquadri,
// mai nel documento: patterns/i-riquadri-di-filo-su-un-sito-stanno-sopra-la-scheda.md. La risposta la legge SN_TRASCRIZIONE_RIGHE.

(function (global) {
  'use strict';

  const MSG = (global.SN_MSG && global.SN_MSG.MSG) || {};
  const ACTIONS = (global.SN_CONST && global.SN_CONST.ACTIONS) || {};
  const t = (k) => (global.SN_I18N ? global.SN_I18N.t(k) : k);
  // Più piccola di così una porzione non si legge dove sta: si ingrandisce al centro.
  const MINIMO = { w: 160, h: 40 };
  const MARGINE = 16;
  const BARRA_H = 44;
  const INGRANDISCI_MAX = 2;
  // Il lato dell'immagine in grigi su cui si cercano le parole: oltre, la misura non migliora e costa memoria.
  const LATO_GRIGI = 2400;

  let aperto = null;

  // { dataUrl, rect: {x,y,w,h} in px CSS della vista, o null, fondo: '#rrggbb' sotto l'immagine nella pagina }. Formato,
  // peso e trasparenza li decide SN_IMMAGINI_CHAT, come per le immagini date all'Aiuto. Su un sito chiede lo strato; se
  // lo strato non si può fare si disegna nel documento, in un'ombra chiusa, come gli altri riquadri.
  async function apri(opz = {}) {
    const grezza = String(opz.dataUrl || '');
    if (!/^data:image\//i.test(grezza)) return false;
    const IC = global.SN_IMMAGINI_CHAT;
    const blob = IC ? IC.blobDa(grezza) : null;
    const dataUrl = blob ? await IC.perLaChat(blob, { fondo: opz.fondo }).catch(() => '') : '';
    if (!dataUrl || !IC.INTERA.test(dataUrl)) {
      global.SN_POPUP?.showToast?.(t('menu_image_unreadable'));
      return false;
    }
    const rect = rettangolo(opz.rect);
    if (sopra(dataUrl, rect)) return true;
    disegna({ dataUrl, rect });
    return true;
  }

  function sopra(dataUrl, rect) {
    const nelDocumento = () => disegna({ dataUrl, rect });
    return global.SN_RIQUADRI_SOPRA?.apri('trascrizione', { dataUrl, rect }, nelDocumento, () => {
      global.SN_POPUP?.showToast?.(t('trascrivi_troppo_grande'));
    });
  }

  function rettangolo(r) {
    if (!r || typeof r !== 'object') return null;
    const v = ['x', 'y', 'w', 'h'].map((k) => Number(r[k]));
    if (!v.every(Number.isFinite) || v[2] <= 0 || v[3] <= 0) return null;
    return { x: v[0], y: v[1], w: v[2], h: v[3] };
  }

  // L'immagine in grigi, per ritrovare nei pixel dove cadono le parole di ogni riga. null se il canvas non la legge.
  function grigi(img) {
    try {
      const k = Math.min(1, LATO_GRIGI / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * k));
      const h = Math.max(1, Math.round(img.naturalHeight * k));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data;
      const luma = new Uint8Array(w * h);
      for (let i = 0, j = 0; j < luma.length; i += 4, j++) luma[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
      return { w, h, luma };
    } catch (_) { return null; }
  }

  function chiudi() {
    const a = aperto;
    if (!a) return;
    aperto = null;
    if (a.copiato) conta('copiato');
    document.removeEventListener('keydown', a.suTasto, true);
    window.removeEventListener('resize', a.suMisura);
    try { global.SN_POPUP?.togliRiquadro?.(a.radice); } catch (_) {}
    try { a.radice.remove(); } catch (_) {}
  }

  function conta(esito) {
    try { global.SN_POPUP?.conta?.({ misura: 'riquadro', cosa: 'ocr', esito }); } catch (_) {}
  }

  function el(tag, classe, testo) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (testo != null) e.textContent = testo;
    return e;
  }

  function disegna({ dataUrl, rect }) {
    chiudi();
    const radice = el('div', 'sn-tr-overlay');
    radice.dataset.snTheme = document.documentElement.dataset.snTheme || '';
    radice.tabIndex = -1;
    radice.setAttribute('role', 'dialog');
    radice.setAttribute('aria-label', t('menu_transcribe'));
    global.SN_FILO_UI?.mark?.(radice);
    const scena = el('div', 'sn-tr-scena');
    const img = el('img', 'sn-tr-img');
    img.alt = '';
    img.draggable = false;
    const testo = el('div', 'sn-tr-testo');
    scena.append(img, testo);
    const barra = el('div', 'sn-tr-barra');
    const stato = el('span', 'sn-tr-stato');
    stato.append(el('span', 'sn-rinomina-rotella'), el('span', '', t('trascrivi_leggo')));
    barra.append(stato);
    radice.append(scena, barra);

    const a = { radice, scena, img, testo, barra, stato, rect, righe: [], copiato: false, nat: null };
    // Col menu del tasto destro aperto sopra, l'Esc è suo: chiude prima lui. «Seleziona tutto» qui è il testo
    // dell'immagine, non la pagina sotto né le scritte dei tasti.
    a.suTasto = (e) => {
      if (aperto !== a || global.SN_MENU?.isOpen?.()) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === 'a') {
        if (!a.righe.length) return;
        e.preventDefault();
        e.stopPropagation();
        try { document.getSelection().selectAllChildren(a.testo); } catch (_) {}
        return;
      }
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      chiudi();
    };
    a.suMisura = () => { if (aperto === a) posa(a); };
    aperto = a;

    radice.addEventListener('mousedown', (e) => {
      if (e.target === radice && e.button === 0 && !global.SN_MENU?.isOpen?.()) chiudi();
    });
    radice.addEventListener('keydown', a.suTasto);
    radice.addEventListener('copy', (e) => copiaSelezione(a, e));
    document.addEventListener('keydown', a.suTasto, true);
    window.addEventListener('resize', a.suMisura);

    const host = global.SN_POPUP?.riquadro ? global.SN_POPUP.riquadro(radice) : radice;
    (document.body || document.documentElement).appendChild(host);
    img.onload = () => {
      if (aperto !== a) return;
      a.nat = { w: img.naturalWidth, h: img.naturalHeight };
      a.grigi = grigi(img);
      posa(a);
      try { radice.focus({ preventScroll: true }); } catch (_) {}
    };
    img.onerror = () => {
      if (aperto !== a) return;
      chiudi();
      global.SN_POPUP?.showToast?.(t('menu_image_unreadable'));
    };
    img.src = dataUrl;
    leggi(a, dataUrl);
  }

  // Dove sta l'immagine: sopra il punto da cui viene, se ci sta intera e si legge; se no al centro, ingrandita al più
  // del doppio. La barra va sotto, sopra se sotto non c'è posto, o dentro l'immagine in fondo.
  function posa(a) {
    if (!a.nat) return;
    const vw = innerWidth;
    const vh = innerHeight;
    const r = a.rect;
    let box;
    const dentro = r && r.x >= -1 && r.y >= -1 && r.x + r.w <= vw + 1 && r.y + r.h <= vh + 1;
    if (r && dentro && r.w >= MINIMO.w && r.h >= MINIMO.h) box = { ...r };
    else {
      const base = r || { w: a.nat.w / (global.devicePixelRatio || 1), h: a.nat.h / (global.devicePixelRatio || 1) };
      const k = Math.min(INGRANDISCI_MAX, (vw - 2 * MARGINE) / base.w, (vh - 2 * MARGINE - BARRA_H) / base.h);
      const w = Math.max(1, base.w * k);
      const h = Math.max(1, base.h * k);
      box = { x: (vw - w) / 2, y: Math.max(MARGINE, (vh - h - BARRA_H) / 2), w, h };
    }
    Object.assign(a.scena.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
    const sotto = box.y + box.h + 8;
    const b = a.barra.style;
    if (sotto + BARRA_H - 8 <= vh) b.top = `${sotto}px`;
    else if (box.y - BARRA_H >= 0) b.top = `${box.y - BARRA_H}px`;
    else b.top = `${box.y + box.h - BARRA_H}px`;
    b.left = `${Math.max(MARGINE, Math.min(box.x, vw - MARGINE - a.barra.offsetWidth))}px`;
    a.box = box;
    disponi(a);
  }

  // Ogni riga sta nel suo riquadro. Dentro, ogni parola e ogni spazio stanno dove sono disegnati, ritrovati nei pixel
  // della riga, col testo stirato o stretto (scaleX) sulla loro larghezza: il carattere dell'immagine non è quello di
  // Filo, e una parola trascinata dalla prima all'ultima lettera visibile si prende intera. Se nei pixel le parole non
  // si contano, il testo si stira sulla riga intera.
  function disponi(a) {
    if (!a.box || !a.righe.length) return;
    const R = global.SN_TRASCRIZIONE_RIGHE;
    a.testo.textContent = '';
    const scatole = R.scatole(a.righe, a.box.w, a.box.h);
    const gx = a.grigi ? a.grigi.w / a.box.w : 0;
    const gy = a.grigi ? a.grigi.h / a.box.h : 0;
    // Le righe stanno fuori dal flusso, e una selezione che ne attraversa due le incollerebbe: un a capo nel testo fra
    // l'una e l'altra lo mette in ogni copia (Ctrl+C, il tasto destro, Traduci, Cerca), che legga la selezione o il range.
    const pezzi = [];
    scatole.forEach((s, i) => {
      if (i) a.testo.appendChild(document.createTextNode('\n'));
      const n = el('div', 'sn-tr-riga');
      const alta = s.stimata ? Math.min(s.h, 22) : s.h;
      Object.assign(n.style, {
        left: `${s.x}px`, top: `${s.y}px`, height: `${alta}px`, lineHeight: `${alta}px`,
        fontSize: `${Math.max(4, alta * 0.82)}px`,
      });
      // Il riquadro del lettore spesso sfiora la riga sopra e quella sotto: le parole si cercano nella sua fascia centrale.
      const ink = !s.stimata && a.grigi
        ? R.inchiostro(a.grigi.luma, a.grigi.w, a.grigi.h, { x: s.x * gx, y: (s.y + s.h * 0.1) * gy, w: s.w * gx, h: s.h * 0.8 * gy })
        : null;
      const dove = ink ? R.parole(s.testo, ink) : null;
      if (!dove) {
        n.textContent = s.testo;
        a.testo.appendChild(n);
        pezzi.push({ n, w: s.w, stimata: s.stimata });
        return;
      }
      n.style.width = `${s.w}px`;
      // I pezzi restano nel flusso della riga, uno dopo l'altro: posati fuori dal flusso, un trascinamento dentro la
      // stessa riga non allargava la selezione. Il margine porta il pezzo dopo dove inizia il suo disegno.
      const parti = s.testo.trim().split(/(\s+)/);
      for (let j = 0; j < parti.length; j++) {
        const p = Math.floor(j / 2);
        const da = j % 2 ? dove[p].a : dove[p].da;
        const a2 = j % 2 ? dove[p + 1].da : dove[p].a;
        const pezzo = el('span', 'sn-tr-pezzo', parti[j]);
        if (!j) pezzo.style.marginLeft = `${da / gx - s.x}px`;
        n.appendChild(pezzo);
        pezzi.push({ n: pezzo, w: Math.max(1, (a2 - da) / gx), nelFlusso: true });
      }
      a.testo.appendChild(n);
    });
    const naturali = pezzi.map((p) => (p.nelFlusso ? p.n.getBoundingClientRect().width : 0) || p.n.scrollWidth);
    pezzi.forEach((p, i) => {
      const naturale = naturali[i];
      if (!naturale) return;
      const k = p.w / naturale;
      if (!p.stimata || k < 1) p.n.style.transform = `scaleX(${k})`;
      if (p.nelFlusso) p.n.style.marginRight = `${p.w - naturale}px`;
    });
  }

  async function leggi(a, dataUrl) {
    let res = null;
    try {
      res = await global.chrome.runtime.sendMessage({ type: MSG.AI_REQUEST, action: ACTIONS.TRANSCRIBE_IMAGE, payload: { dataUrl } });
    } catch (_) { res = null; }
    if (aperto !== a) return;
    if (!res || !res.ok) {
      chiudi();
      if (res) global.SN_POPUP?.avvisoErrore?.(res);
      else global.SN_POPUP?.toastErrore?.('err_provider_failed');
      return;
    }
    const letto = global.SN_TRASCRIZIONE_RIGHE.leggi(res.text || '');
    a.righe = letto.righe;
    a.stato.textContent = '';
    if (!a.righe.length) {
      conta('vuoto');
      a.stato.textContent = t('toast_transcribe_empty');
      return;
    }
    // Copiabile, ma non intero: fermato al tetto di lunghezza (#1097.3).
    const interrotta = global.SN_CHAT_ERRORS?.rispostaInterrotta?.(res.finishReason);
    if (interrotta) {
      conta('tagliato');
      a.stato.textContent = interrotta;
    }
    const tasto = el('button', 'sn-tr-copia', t('trascrivi_copia_tutto'));
    tasto.type = 'button';
    tasto.addEventListener('click', () => copiaTutto(a));
    a.barra.prepend(tasto);
    a.radice.classList.add('sn-tr-pronto');
    posa(a);
  }

  function copiaTutto(a) {
    const testo = global.SN_TRASCRIZIONE_RIGHE.testoIntero(a.righe);
    if (!testo) return;
    a.copiato = true;
    global.SN_ACTIONS?.copyToClipboard?.(testo);
  }

  // Il Copia del sistema su questo testo, con la regola del Copia del tasto destro: le righe una per riga.
  function copiaSelezione(a, e) {
    const radiceOmbra = a.radice.getRootNode && a.radice.getRootNode();
    let sel = null;
    try { sel = (radiceOmbra && radiceOmbra.getSelection && radiceOmbra.getSelection()) || document.getSelection(); } catch (_) { sel = null; }
    const grezzo = String((sel && sel.toString()) || '');
    const testo = global.SN_ACTIONS?.testoCopiato ? global.SN_ACTIONS.testoCopiato(grezzo) : grezzo.trim();
    if (!testo || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', testo);
    a.copiato = true;
  }

  global.SN_TRASCRIZIONE = { apri, chiudi, aperto: () => !!aperto };
})(typeof globalThis !== 'undefined' ? globalThis : self);
