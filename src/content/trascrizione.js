// Il riquadro di Trascrivi (#2374): l'immagine col suo testo sopra, trasparente e selezionabile come in un PDF; Ctrl+C
// copia la selezione, «Copia tutto» tutto, Esc o un clic fuori chiude. Su un sito si apre nello strato dei riquadri,
// mai nel documento: patterns/i-riquadri-di-filo-su-un-sito-stanno-sopra-la-scheda.md. La risposta la legge SN_TRASCRIZIONE_RIGHE.

(function (global) {
  'use strict';

  const MSG = (global.SN_MSG && global.SN_MSG.MSG) || {};
  const ACTIONS = (global.SN_CONST && global.SN_CONST.ACTIONS) || {};
  const t = (k) => (global.SN_I18N ? global.SN_I18N.t(k) : k);
  // Il tetto dello strato è 8 MB: un ritaglio PNG grande quanto uno schermo 4K ci arriva vicino, e si rifà in JPEG.
  const DATI_MAX = 7 * 1024 * 1024;
  // Più piccola di così una porzione non si legge dove sta: si ingrandisce al centro.
  const MINIMO = { w: 160, h: 40 };
  const MARGINE = 16;
  const BARRA_H = 44;
  const INGRANDISCI_MAX = 2;

  let aperto = null;

  // { dataUrl, rect: {x,y,w,h} in px CSS della vista, o null }. Su un sito chiede lo strato; se lo strato non si può
  // fare si disegna nel documento, in un'ombra chiusa, come gli altri riquadri.
  async function apri(opz = {}) {
    let dataUrl = String(opz.dataUrl || '');
    if (!/^data:image\//i.test(dataUrl)) return false;
    if (dataUrl.length > DATI_MAX) dataUrl = await inJpeg(dataUrl);
    const rect = rettangolo(opz.rect);
    if (global.SN_RIQUADRI_SOPRA?.apri('trascrizione', { dataUrl, rect }, () => disegna({ dataUrl, rect }))) return true;
    disegna({ dataUrl, rect });
    return true;
  }

  function rettangolo(r) {
    if (!r || typeof r !== 'object') return null;
    const v = ['x', 'y', 'w', 'h'].map((k) => Number(r[k]));
    if (!v.every(Number.isFinite) || v[2] <= 0 || v[3] <= 0) return null;
    return { x: v[0], y: v[1], w: v[2], h: v[3] };
  }

  function inJpeg(dataUrl) {
    return new Promise((fatto) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const g = c.getContext('2d');
          g.fillStyle = '#fff';
          g.fillRect(0, 0, c.width, c.height);
          g.drawImage(img, 0, 0);
          fatto(c.toDataURL('image/jpeg', 0.9));
        } catch (_) { fatto(dataUrl); }
      };
      img.onerror = () => fatto(dataUrl);
      img.src = dataUrl;
    });
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
    // Col menu del tasto destro aperto sopra, l'Esc è suo: chiude prima lui.
    a.suTasto = (e) => {
      if (aperto !== a || e.key !== 'Escape' || global.SN_MENU?.isOpen?.()) return;
      e.preventDefault();
      e.stopPropagation();
      chiudi();
    };
    a.suMisura = () => { if (aperto === a) posa(a); };
    aperto = a;

    radice.addEventListener('mousedown', (e) => { if (e.target === radice && e.button === 0) chiudi(); });
    radice.addEventListener('keydown', a.suTasto);
    radice.addEventListener('copy', (e) => copiaSelezione(a, e));
    document.addEventListener('keydown', a.suTasto, true);
    window.addEventListener('resize', a.suMisura);

    const host = global.SN_POPUP?.riquadro ? global.SN_POPUP.riquadro(radice) : radice;
    (document.body || document.documentElement).appendChild(host);
    img.onload = () => {
      if (aperto !== a) return;
      a.nat = { w: img.naturalWidth, h: img.naturalHeight };
      posa(a);
      try { radice.focus({ preventScroll: true }); } catch (_) {}
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

  // Ogni riga sta nel suo riquadro: altezza dal riquadro, larghezza col testo stirato o stretto (scaleX), così le parole
  // cadono sopra quelle disegnate e una si seleziona da sola.
  function disponi(a) {
    if (!a.box || !a.righe.length) return;
    const R = global.SN_TRASCRIZIONE_RIGHE;
    a.testo.textContent = '';
    const scatole = R.scatole(a.righe, a.box.w, a.box.h);
    const nodi = scatole.map((s) => {
      const n = el('div', 'sn-tr-riga', s.testo);
      const alta = s.stimata ? Math.min(s.h, 22) : s.h;
      Object.assign(n.style, {
        left: `${s.x}px`, top: `${s.y}px`, height: `${alta}px`, lineHeight: `${alta}px`,
        fontSize: `${Math.max(4, alta * 0.82)}px`,
      });
      a.testo.appendChild(n);
      return [n, s];
    });
    for (const [n, s] of nodi) {
      const naturale = n.scrollWidth;
      if (!naturale) continue;
      const k = s.w / naturale;
      if (!s.stimata || k < 1) n.style.transform = `scaleX(${k})`;
    }
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

  // Il Copia del sistema su questo testo: le righe una per riga, senza gli spazi in coda che la selezione si porta dietro.
  function copiaSelezione(a, e) {
    const radiceOmbra = a.radice.getRootNode && a.radice.getRootNode();
    let sel = null;
    try { sel = (radiceOmbra && radiceOmbra.getSelection && radiceOmbra.getSelection()) || document.getSelection(); } catch (_) { sel = null; }
    const testo = String((sel && sel.toString()) || '').replace(/[ \t]+\n/g, '\n').trim();
    if (!testo || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', testo);
    a.copiato = true;
  }

  global.SN_TRASCRIZIONE = { apri, chiudi, aperto: () => !!aperto };
})(typeof globalThis !== 'undefined' ? globalThis : self);
