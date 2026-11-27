// Le spiegazioni al passaggio (#2388): la parola in corsivo apre un riquadro con la sua spiegazione, che il render di
// src/shared/filoMarkdown.js porta in un <template>. Ogni superficie chiama attacca() sul suo contenitore.
// Stile in src/styles/theme.css (.filo-spiega*); prove tests/spiegazioni.spec.mjs.

(function (global) {
  'use strict';

  const SEL = '.filo-spiega';
  const RIQUADRO = 'filo-spiega-riquadro';
  const MARGINE = 8;
  const STACCO = 6;
  const RITARDO_MS = 350;
  // Il tempo per portare il puntatore dalla parola al riquadro senza che la catena si chiuda.
  const USCITA_MS = 250;

  function msDi(el, nome, predefinito) {
    try {
      const v = el.ownerDocument.defaultView.getComputedStyle(el).getPropertyValue(nome).trim();
      const T = global.SN_THEME_TOKENS;
      const n = v && T && typeof T.durataMs === 'function' ? T.durataMs(v) : NaN;
      return Number.isFinite(n) && n >= 0 ? n : predefinito;
    } catch (_) { return predefinito; }
  }

  // La posizione di un riquadro: il primo sotto la parola (sopra se sotto non ci sta), quelli annidati accanto al
  // riquadro da cui nascono, all'altezza della parola; sempre dentro la vista.
  function posizione({ parola, padre, w, h, vw, vh }) {
    let x;
    let y;
    if (!padre) {
      x = parola.left;
      y = parola.bottom + STACCO;
      if (y + h > vh - MARGINE && parola.top - STACCO - h >= MARGINE) y = parola.top - STACCO - h;
    } else {
      x = padre.right + STACCO;
      if (x + w > vw - MARGINE) x = padre.left - STACCO - w;
      if (x < MARGINE) x = parola.left;
      y = parola.top - MARGINE;
    }
    x = Math.max(MARGINE, Math.min(x, vw - w - MARGINE));
    y = Math.max(MARGINE, Math.min(y, vh - h - MARGINE));
    return { x: Math.round(x), y: Math.round(y) };
  }

  // opzioni: chiedi(testo, parola) manda la domanda alla chat da cui viene la parola; puoChiedere(parola) dice se lì
  // c'è una chat; copia(testo); apriLink(url) per i collegamenti dentro il riquadro.
  function attacca(radice, opzioni = {}) {
    if (!radice || typeof radice.addEventListener !== 'function') return () => {};
    if (radice._filoSpiegazioni) return radice._filoSpiegazioni;
    const doc = radice.ownerDocument;
    const win = doc.defaultView;
    const radiceNodo = radice.getRootNode ? radice.getRootNode() : doc;
    const strato = () => (radiceNodo && radiceNodo.host ? radiceNodo : doc.body || doc.documentElement);
    const catena = [];
    let fissata = false;
    let menu = null;
    let timerApri = 0;
    let timerChiudi = 0;
    let osservaRadice = null;
    let attesa = null;
    // Un contenitore attaccato dentro un altro (il popup di Spiega nella home): il gesto lo prende il più interno.
    const vero = (e) => {
      if (!e || !e.isTrusted || e.filoSpiegazioneGestita) return false;
      e.filoSpiegazioneGestita = true;
      return true;
    };
    const parolaDa = (t) => (t && t.nodeType === 1 && t.closest ? t.closest(SEL) : t && t.parentElement ? t.parentElement.closest(SEL) : null);

    function templateDi(parola) {
      const box = parola.closest('.' + RIQUADRO);
      if (box) return box._filoTpl || null;
      for (let el = parola.parentElement; el; el = el.parentElement) {
        const t = el.querySelector(':scope > template.filo-spieghe');
        if (t) return t;
        if (el === radice) break;
      }
      return null;
    }
    function definizione(parola) {
      const n = parola.getAttribute('data-spiega');
      const tpl = templateDi(parola);
      if (!tpl || !/^\d+$/.test(n || '')) return null;
      const def = tpl.content.querySelector('[data-spiega-def="' + n + '"]');
      return def ? { tpl, def } : null;
    }
    // 0 per una parola della chat, k+1 per una dentro il k-esimo riquadro; -1 se il suo riquadro non è più aperto.
    function livelloDi(parola) {
      const box = parola.closest('.' + RIQUADRO);
      if (!box) return 0;
      const i = catena.findIndex((c) => c.box === box);
      return i < 0 ? -1 : i + 1;
    }
    const nellaCatena = (nodi) => nodi.some((n) => catena.some((c) => c.box === n || c.parola === n) || n === menu);
    // La parola della chat da cui parte la catena: una parola dentro un riquadro chiede nella conversazione della prima.
    function origine(parola) {
      return livelloDi(parola) > 0 && catena[0] ? catena[0].parola : parola;
    }
    // Una risposta che sta arrivando si ridisegna a ogni pezzo: la parola di prima esce dal documento, e al suo posto,
    // nello stesso punto, c'è la stessa parola nuova. Si ritrova da lì.
    function ritrovata(parola, rect) {
      if (parola.isConnected) return parola;
      if (!rect) return null;
      const fonte = radiceNodo && typeof radiceNodo.elementFromPoint === 'function' ? radiceNodo : doc;
      const q = parolaDa(fonte.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
      return q && q.getAttribute('data-spiega') === parola.getAttribute('data-spiega') && q.textContent === parola.textContent ? q : null;
    }
    function riancora() {
      for (const c of catena) {
        if (c.parola.isConnected) continue;
        const q = ritrovata(c.parola, c.rect);
        if (!q) continue;
        c.parola = q;
        q.classList.add('filo-spiega-aperta');
      }
    }

    function riposiziona() {
      riancora();
      catena.forEach((c, i) => {
        if (!c.parola.isConnected) return;
        c.rect = c.parola.getBoundingClientRect();
        const p = posizione({
          parola: c.rect,
          padre: i ? catena[i - 1].box.getBoundingClientRect() : null,
          w: c.box.offsetWidth, h: c.box.offsetHeight, vw: win.innerWidth, vh: win.innerHeight,
        });
        c.box.style.left = p.x + 'px';
        c.box.style.top = p.y + 'px';
      });
    }

    function chiudiDa(liv) {
      while (catena.length > liv) {
        const c = catena.pop();
        try { c.osserva && c.osserva.disconnect(); } catch (_) {}
        try { c.stacca && c.stacca(); } catch (_) {}
        c.box.remove();
        c.parola.classList.remove('filo-spiega-aperta');
      }
      if (!catena.length) {
        fissata = false;
        if (osservaRadice) { osservaRadice.disconnect(); osservaRadice = null; }
      }
    }
    function chiudiMenu() { if (menu) { menu.remove(); menu = null; } }
    // Uno scorrimento finito prima dell'apertura non chiude il menu: la regola è quella del tasto destro (#2452, #2586).
    let menuScorso = () => true;
    function fermaAttesa() { clearTimeout(timerApri); attesa = null; }
    function chiudiTutto() { fermaAttesa(); clearTimeout(timerChiudi); chiudiMenu(); chiudiDa(0); }

    function apri(parola) {
      const liv = livelloDi(parola);
      if (liv < 0 || liv > catena.length) return null;
      if (catena[liv] && catena[liv].parola === parola) { chiudiDa(liv + 1); return catena[liv]; }
      const d = definizione(parola);
      if (!d) return null;
      chiudiDa(liv);
      const box = doc.createElement('div');
      box.className = RIQUADRO + ' filo-md';
      box.setAttribute('role', 'tooltip');
      box.dataset.tipo = d.def.getAttribute('data-tipo') || 'testo';
      box._filoTpl = d.tpl;
      for (const n of d.def.childNodes) box.appendChild(doc.importNode(n, true));
      try { global.SN_FILO_UI && global.SN_FILO_UI.mark && global.SN_FILO_UI.mark(box); } catch (_) {}
      strato().appendChild(box);
      if (!radice.contains(box)) for (const [tipo, fn] of ascoltiRiquadro) box.addEventListener(tipo, fn);
      parola.classList.add('filo-spiega-aperta');
      const voce = { box, parola, osserva: null, stacca: null };
      if (typeof opzioni.apriLink === 'function' && global.SN_MARKDOWN) voce.stacca = global.SN_MARKDOWN.bindLinks(box, opzioni.apriLink);
      // Un'immagine che arriva dopo cambia l'altezza: il riquadro si rimisura.
      if (typeof win.ResizeObserver === 'function') { voce.osserva = new win.ResizeObserver(riposiziona); voce.osserva.observe(box); }
      catena.push(voce);
      if (!osservaRadice && typeof win.MutationObserver === 'function') {
        osservaRadice = new win.MutationObserver(riancora);
        osservaRadice.observe(radice, { childList: true, subtree: true });
      }
      riposiziona();
      return voce;
    }

    function testoDi(parola) {
      const d = definizione(parola);
      return {
        termine: d ? d.def.getAttribute('data-termine') || parola.textContent : parola.textContent,
        spiegazione: d ? String(d.def.textContent || '').replace(/\s+/g, ' ').trim() : '',
      };
    }

    async function copia(testo) {
      if (typeof opzioni.copia === 'function') return opzioni.copia(testo);
      try { await win.navigator.clipboard.writeText(testo); return; } catch (_) {}
      const ta = doc.createElement('textarea');
      ta.value = testo;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      strato().appendChild(ta);
      ta.select();
      try { doc.execCommand('copy'); } catch (_) {}
      ta.remove();
    }

    function apriMenu(parola, x, y) {
      chiudiMenu();
      const { termine, spiegazione } = testoDi(parola);
      const voci = [];
      const da = origine(parola);
      const chiedi = typeof opzioni.chiedi === 'function'
        && (typeof opzioni.puoChiedere !== 'function' || opzioni.puoChiedere(da) !== false);
      if (chiedi) voci.push(['Spiegami di più', 'piu', () => opzioni.chiedi(`Spiegami di più su «${termine}».`, da)]);
      if (spiegazione) voci.push(['Copia la spiegazione', 'copia', () => copia(spiegazione)]);
      if (!voci.length) return;
      // Nel documento della pagina il menu è quello a icone di Filo (#2555), con la parola contornata.
      const I = doc === global.document ? global.SN_MENU_ICONS : null;
      if (I && I.apriVoci && I.apriVoci({ x, y, elemento: parola, voci: voci.map(([label, , fa]) => ({ label, onClick: () => { try { fa(); } catch (_) {} } })) })) return;
      menuScorso =(doc === global.document && global.SN_MENU?.fotoDelloScorrimento?.(x, y)) || (() => true);
      menu = doc.createElement('div');
      menu.className = 'filo-spiega-menu';
      menu.setAttribute('role', 'menu');
      for (const [etichetta, chiave, fa] of voci) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'filo-spiega-voce';
        b.dataset.voce = chiave;
        b.setAttribute('role', 'menuitem');
        b.textContent = etichetta;
        b.addEventListener('click', (e) => {
          if (!vero(e)) return;
          e.preventDefault();
          e.stopPropagation();
          chiudiTutto();
          try { fa(); } catch (_) {}
        });
        menu.appendChild(b);
      }
      try { global.SN_FILO_UI && global.SN_FILO_UI.mark && global.SN_FILO_UI.mark(menu); } catch (_) {}
      strato().appendChild(menu);
      const w = menu.offsetWidth;
      const h = menu.offsetHeight;
      menu.style.left = Math.max(MARGINE, Math.min(x, win.innerWidth - w - MARGINE)) + 'px';
      menu.style.top = Math.max(MARGINE, Math.min(y, win.innerHeight - h - MARGINE)) + 'px';
      const primo = menu.querySelector('button');
      try { primo && primo.focus({ preventScroll: true }); } catch (_) {}
    }

    function suPassaggio(e) {
      const p = parolaDa(e.target);
      if (p || catena.some((c) => c.box.contains(e.target)) || (menu && menu.contains(e.target))) clearTimeout(timerChiudi);
      if (!p || !vero(e)) return;
      const rect = p.getBoundingClientRect();
      // La stessa parola ridisegnata sotto il puntatore fermo (una risposta che arriva) non fa ripartire l'attesa.
      if (attesa && stessaParola(attesa, p, rect)) { attesa = { parola: p, rect }; return; }
      clearTimeout(timerApri);
      attesa = { parola: p, rect };
      timerApri = win.setTimeout(() => {
        const a = attesa;
        attesa = null;
        const q = a && ritrovata(a.parola, a.rect);
        if (q) apri(q);
      }, msDi(p, '--sn-spiega-ritardo', RITARDO_MS));
    }
    function stessaParola(a, p, rect) {
      if (a.parola === p) return true;
      return !a.parola.isConnected && a.parola.getAttribute('data-spiega') === p.getAttribute('data-spiega')
        && a.parola.textContent === p.textContent && Math.abs(a.rect.left - rect.left) < 2 && Math.abs(a.rect.top - rect.top) < 2;
    }
    function suUscita(e) {
      const verso = e.relatedTarget;
      const p = parolaDa(e.target);
      if (p && !(verso && p.contains(verso))) fermaAttesa();
      const dentro = verso && (catena.some((c) => c.box.contains(verso) || c.parola.contains(verso)) || (menu && menu.contains(verso)));
      if (dentro || fissata) return;
      clearTimeout(timerChiudi);
      timerChiudi = win.setTimeout(() => { if (!fissata && !menu) chiudiDa(0); }, USCITA_MS);
    }
    function suClic(e) {
      const p = parolaDa(e.target);
      if (!p || !vero(e)) return;
      e.preventDefault();
      fermaAttesa();
      if (apri(p)) fissata = true;
    }
    function suTasto(e) {
      const p = parolaDa(e.target);
      if (!p || !vero(e) || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      if (apri(p)) fissata = true;
    }
    function suTastoDestro(e) {
      const p = parolaDa(e.target);
      if (!p || !vero(e)) return;
      e.preventDefault();
      e.stopPropagation();
      fermaAttesa();
      apriMenu(p, e.clientX, e.clientY);
    }
    const ascoltiRiquadro = [
      ['pointerover', suPassaggio], ['pointerout', suUscita], ['click', suClic], ['keydown', suTasto], ['contextmenu', suTastoDestro],
    ];
    for (const [tipo, fn] of ascoltiRiquadro) radice.addEventListener(tipo, fn);

    // Un clic fuori chiude. Dentro un'ombra chiusa il documento non vede dove si è cliccato: lo segna l'ombra.
    const dentroOmbra = new WeakSet();
    const segnaDentro = (e) => { if (nellaCatena(e.composedPath())) dentroOmbra.add(e); };
    const fuori = (e) => {
      if (!catena.length && !menu) return;
      if (dentroOmbra.has(e) || nellaCatena(e.composedPath())) return;
      chiudiTutto();
    };
    const esc = (e) => {
      if (e.key !== 'Escape' || (!catena.length && !menu)) return;
      e.preventDefault();
      e.stopPropagation();
      if (menu) { chiudiMenu(); if (!fissata) chiudiDa(0); return; }
      chiudiTutto();
    };
    const scorre = (e) => { if (catena.length) riposiziona(); if (menu && (e.type !== 'scroll' || menuScorso(e))) chiudiMenu(); };
    if (radiceNodo && radiceNodo.host) radiceNodo.addEventListener('pointerdown', segnaDentro, true);
    doc.addEventListener('pointerdown', fuori);
    win.addEventListener('keydown', esc, true);
    win.addEventListener('scroll', scorre, true);
    win.addEventListener('resize', scorre);

    const stacca = () => {
      chiudiTutto();
      for (const [tipo, fn] of ascoltiRiquadro) radice.removeEventListener(tipo, fn);
      if (radiceNodo && radiceNodo.host) radiceNodo.removeEventListener('pointerdown', segnaDentro, true);
      doc.removeEventListener('pointerdown', fuori);
      win.removeEventListener('keydown', esc, true);
      win.removeEventListener('scroll', scorre, true);
      win.removeEventListener('resize', scorre);
      delete radice._filoSpiegazioni;
    };
    radice._filoSpiegazioni = stacca;
    return stacca;
  }

  global.SN_SPIEGAZIONI = { attacca, posizione };
})(typeof globalThis !== 'undefined' ? globalThis : self);
