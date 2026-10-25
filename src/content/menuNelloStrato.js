// Il menu del tasto destro nello strato di Filo sopra la scheda (#1054), a interruttore acceso: qui restano il contesto
// e le funzioni delle voci, tenute per numero; nel documento del sito non entra niente del menu, nemmeno staccato.
// Regole: patterns/il-menu-del-tasto-destro-sta-in-uno-strato-sopra-la-scheda.md

(function (global) {
  'use strict';

  const Menu = global.SN_MENU;
  const D = global.SN_MENU_DESCRITTO;
  const MSG = global.SN_MSG && global.SN_MSG.MSG;
  if (!Menu || !D || !MSG || typeof chrome === 'undefined' || !chrome.runtime) return;

  // Lo chiede il preload al main, una volta: sulle pagine di Filo non c'è e il menu resta nella pagina.
  function acceso() {
    try { return typeof global.SN_STRATO_MENU_ACCESO === 'function' && global.SN_STRATO_MENU_ACCESO() === true; } catch (_) { return false; }
  }

  const locale = {
    open: Menu.open,
    close: Menu.close,
    openIconGridSubmenu: Menu.openIconGridSubmenu,
    refreshIconRow: Menu.refreshIconRow,
    refreshIconGrid: Menu.refreshIconGrid,
    isSubMenuOpen: Menu.isSubMenuOpen,
    isOpen: Menu.isOpen,
    testoNascosto: Menu.testoNascosto,
    trascinaDaFuori: Menu.trascinaDaFuori,
  };

  // Le sezioni che si riempiono dopo (spiegazioni) e le righe di correzione nascono in un documento senza finestra:
  // il sito non lo raggiunge, e un'immagine scritta lì dentro non si scarica. Lo strato ne riceve una copia pulita.
  let inerte = null;
  function documentoInerte() {
    if (!inerte) inerte = document.implementation.createHTMLDocument('');
    return inerte;
  }

  // Un bottone dello strato passato a una voce (l'ancora della griglia «Altro…»): qui è solo il suo segno.
  class Ancora {
    constructor(segno) { this.segno = String(segno); }
  }

  let corrente = null;
  let contatore = 0;

  function nuovoId() {
    contatore += 1;
    return `${Date.now().toString(36)}-${contatore}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function invia(tipo, dati) {
    try {
      return Promise.resolve(chrome.runtime.sendMessage({ type: tipo, ...dati })).catch(() => null);
    } catch (_) { return Promise.resolve(null); }
  }

  function opDi(m) {
    return {
      speciale(v) {
        if (typeof v === 'function') { m.funzioni.push(v); return { $fn: m.funzioni.length - 1 }; }
        if (v instanceof Ancora) return { $ancora: v.segno };
        if (v && typeof v === 'object' && typeof v.nodeType === 'number') return null;
        return undefined;
      },
    };
  }

  function aggiorna(m, cosa, dati) {
    if (corrente !== m) return;
    invia(MSG.STRATO_MENU_AGGIORNA, { id: m.id, cosa, ...dati });
  }

  function pulisci(m) {
    if (!m) return;
    for (const fn of m.pulizie.splice(0)) { try { fn(); } catch (_) {} }
    if (corrente === m) corrente = null;
  }

  // Una sezione che cresce dopo: ogni cambio diventa una copia del suo HTML, spedita allo strato al fotogramma dopo.
  function montaInline(m, n, it, dopoSeparatore) {
    const doc = documentoInerte();
    const radice = doc.createElement('div');
    let sep = null;
    if (dopoSeparatore) {
      sep = doc.createElement('div');
      sep.className = 'sn-menu-sep';
      radice.appendChild(sep);
    }
    const el = doc.createElement('div');
    el.className = 'sn-menu-inline';
    if (it.subject) el.dataset.subject = String(it.subject);
    if (it.content) el.textContent = String(it.content);
    radice.appendChild(el);
    m.inline.set(n, el);
    let inAttesa = false;
    const spedisci = () => {
      inAttesa = false;
      if (corrente !== m) return;
      aggiorna(m, 'inline', {
        n,
        classi: el.className,
        html: el.innerHTML,
        via: el.parentNode !== radice,
        sepVia: !!sep && sep.parentNode !== radice,
      });
    };
    const mo = new MutationObserver(() => {
      if (inAttesa) return;
      inAttesa = true;
      setTimeout(spedisci, 16);
    });
    mo.observe(radice, { childList: true, subtree: true, characterData: true, attributes: true });
    m.pulizie.push(() => { try { mo.disconnect(); } catch (_) {} });
    return el;
  }

  function apri(opzioni) {
    const items = Array.isArray(opzioni && opzioni.items) ? opzioni.items : [];
    if (corrente) chiudi();
    const m = { id: nuovoId(), funzioni: [], pulizie: [], inline: new Map(), montaggi: [], sezioni: 0 };
    corrente = m;
    if (opzioni && typeof opzioni.alChiudere === 'function') m.pulizie.push(opzioni.alChiudere);
    // La pagina che scorre chiude il menu normale, come nel documento: lo strato non scorre con lei e resterebbe sopra un
    // punto che non è più quello cliccato.
    if (!(opzioni && opzioni.keepOnScroll)) {
      const scorre = () => { if (corrente === m) chiudi(); };
      window.addEventListener('scroll', scorre, true);
      m.pulizie.push(() => window.removeEventListener('scroll', scorre, true));
    }
    const op = opDi(m);
    const voci = [];
    items.forEach((it, i) => {
      if (!it || typeof it !== 'object') return;
      const prima = items[i - 1];
      if (it.type === 'inline') {
        const n = m.sezioni++;
        voci.push({ type: 'inline', subject: it.subject ? String(it.subject) : '', content: it.content ? String(it.content) : '', $inline: n });
        m.montaggi.push(() => {
          const el = montaInline(m, n, it, !!prima && prima.type === 'separator');
          if (typeof it.onMount !== 'function') return;
          const via = it.onMount(el);
          if (typeof via === 'function') m.pulizie.push(via);
        });
        return;
      }
      if (it.type === 'correction') {
        const { onMount, ...resto } = it;
        const n = voci.length;
        voci.push({ ...D.descrivi(resto, op), $corr: n });
        if (typeof onMount === 'function') {
          m.montaggi.push(() => {
            const aggiornaRiga = (props) => {
              const { onMount: _o, ...p } = props || {};
              aggiorna(m, 'correzione', { n, props: D.descrivi(p, op) });
            };
            const via = onMount(documentoInerte().createElement('div'), aggiornaRiga);
            if (typeof via === 'function') m.pulizie.push(via);
          });
        }
        return;
      }
      // Incolla e la sua cronologia li fa il main con lo strato: qui non arrivano né gli appunti né le voci.
      if (it.type === 'paste') {
        voci.push({ type: 'paste', label: String(it.label || ''), shortcut: it.shortcut ? String(it.shortcut) : '', disabled: !!it.disabled, $incolla: true });
        return;
      }
      voci.push(D.descrivi(it, op));
    });
    // Rifiutato (il tasto destro non era di questo riquadro, o troppo vecchio): non resta un menu che si crede aperto.
    invia(MSG.STRATO_MENU_APRI, { id: m.id, menu: { items: voci, keepOnScroll: !!(opzioni && opzioni.keepOnScroll) } })
      .then((r) => { if (!(r && r.ok) && corrente === m) pulisci(m); });
    for (const fn of m.montaggi.splice(0)) { try { fn(); } catch (e) { console.error(e); } }
  }

  function chiudi() {
    const m = corrente;
    if (!m) return;
    invia(MSG.STRATO_MENU_CHIUDI, { id: m.id });
    pulisci(m);
  }

  // Una voce scelta nello strato ha appena dato il fuoco alla scheda: copia e schermo intero lo chiedono al documento.
  function fuocoPronto(ms = 400) {
    try { if (document.hasFocus()) return Promise.resolve(); } catch (_) { return Promise.resolve(); }
    return new Promise((fatto) => {
      const fine = () => { clearTimeout(t); window.removeEventListener('focus', fine, true); fatto(); };
      const t = setTimeout(fine, ms);
      window.addEventListener('focus', fine, true);
    });
  }

  async function esegui(msg) {
    const m = corrente;
    if (!m || msg.id !== m.id) return;
    if (msg.inline != null) {
      const el = m.inline.get(Number(msg.inline));
      const b = el && D.trova(el, msg.cammino);
      // Un collegamento scritto dal modello lo apre la porta delle uscite, come nella pagina: qui non c'è una finestra
      // che lo segua.
      if (b && b.matches && b.matches('a.filo-md-link') && global.SN_POPUP && global.SN_POPUP.apriCollegamento) {
        global.SN_POPUP.apriCollegamento(b, { sfondo: msg.sfondo === true });
        return;
      }
      if (b && typeof b.click === 'function') b.click();
      return;
    }
    const fn = m.funzioni[Number(msg.n)];
    if (typeof fn !== 'function') return;
    const args = D.ricostruisci(Array.isArray(msg.args) ? msg.args : [], { ancora: (s) => new Ancora(s) });
    if (msg.chiude) await fuocoPronto();
    try { fn(...args); } catch (e) { console.error(e); }
  }

  async function incolla(msg) {
    const m = corrente;
    if (!m || msg.id !== m.id) return;
    const A = global.SN_ACTIONS;
    if (!A) return;
    await fuocoPronto();
    try {
      if (msg.voce && typeof msg.voce === 'object') await A.pasteHistoryEntry(msg.voce, { giaInCima: true });
      else await A.pasteFromClipboard({ testo: String(msg.testo || ''), immagine: String(msg.immagine || '') });
    } catch (e) { console.error(e); }
  }

  // Esc nella scheda chiude il menu dello strato anche quando il tasto non è passato dal main (gli strumenti di prova lo
  // consegnano dritto alla pagina). Dichiarato preso, come fa il menu nella pagina: lo schermo intero resta (#514).
  document.addEventListener('keydown', (e) => {
    if (!corrente || !e.isTrusted || e.key !== 'Escape') return;
    chiudi();
    e.preventDefault();
    e.stopPropagation();
  }, true);

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === MSG.STRATO_MENU_ESEGUI) { esegui(msg); return; }
    if (msg.type === MSG.STRATO_MENU_INCOLLA) { incolla(msg); return; }
    if (msg.type === MSG.STRATO_MENU_CHIUSO && corrente && msg.id === corrente.id) pulisci(corrente);
  });

  Menu.open = (o) => { if (o) Menu.misuraLeAzioni(o.items); return acceso() ? apri(o) : locale.open(o); };
  Menu.close = () => (acceso() ? chiudi() : locale.close());
  Menu.openIconGridSubmenu = (ancora, items, opts) => {
    if (!acceso()) return locale.openIconGridSubmenu(ancora, items, opts);
    const m = corrente;
    if (!m || !(ancora instanceof Ancora)) return;
    const op = opDi(m);
    aggiorna(m, 'griglia-apri', { ancora: ancora.segno, items: D.descrivi(items || [], op), opts: D.descrivi(opts || {}, op) });
  };
  Menu.refreshIconRow = (items) => {
    if (!acceso()) return locale.refreshIconRow(items);
    if (corrente) aggiorna(corrente, 'riga', { items: D.descrivi(items || [], opDi(corrente)) });
  };
  Menu.refreshIconGrid = (items) => {
    if (!acceso()) return locale.refreshIconGrid(items);
    if (corrente) aggiorna(corrente, 'griglia', { items: D.descrivi(items || [], opDi(corrente)) });
  };
  Menu.isSubMenuOpen = () => (acceso() ? false : locale.isSubMenuOpen());
  Menu.isOpen = () => (acceso() ? !!corrente : locale.isOpen());
  // Il testo di un'immagine descritta nello strato è testo e basta: lì non c'è un sito che lo cerchi.
  Menu.testoNascosto = (labelEl, btnEl, s) => {
    if (labelEl && inerte && labelEl.ownerDocument === inerte) {
      labelEl.textContent = String(s == null ? '' : s);
      if (btnEl) btnEl.setAttribute('aria-label', String(s == null ? '' : s));
      return;
    }
    locale.testoNascosto(labelEl, btnEl, s);
  };
  // Un'icona portata dalla barra laterale sopra il menu aperto (#871): il gesto è della barra, lo strato la posa.
  Menu.trascinaDaFuori = (d) => {
    if (!acceso()) return locale.trascinaDaFuori(d);
    if (!d) return false;
    // Nessun menu aperto: l'icona lasciata qui dalla barra non va da nessuna parte (#1471), come nella pagina.
    if (!corrente) {
      if (d.fase === 'rilascia') {
        try { global.SN_POPUP?.conta?.({ misura: 'gesto', gesto: 'trascinamento', da: 'icona_barra', a: 'nessuna', esito: 'annullato' }); } catch (_) {}
      }
      return false;
    }
    aggiorna(corrente, 'fuori', {
      fase: String(d.fase || ''), icona: String(d.id || ''), x: Number(d.x) || 0, y: Number(d.y) || 0,
      svg: typeof d.icon === 'string' ? d.icon : '',
    });
    return true;
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
