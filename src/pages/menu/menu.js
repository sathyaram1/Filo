// Lo strato del menu del tasto destro sopra la scheda (#1053): disegna con src/content/menu.js il menu che il content
// script descrive (#1054) e rimanda al main le voci scelte. Da qui non si legge né si tocca la pagina sotto.
// Regole: patterns/il-menu-del-tasto-destro-sta-in-uno-strato-sopra-la-scheda.md
(() => {
  'use strict';
  const api = window.strato;
  const ancora = document.getElementById('ancora');
  const Menu = globalThis.SN_MENU;
  const D = globalThis.SN_MENU_DESCRITTO;
  const Clip = globalThis.SN_CLIPBOARD;
  if (!api || !ancora || !Menu || !D) return;
  let seq = 0;
  let m = null;
  // Una voce chiude il menu e subito dopo dice cosa fare: le due cose arrivano al main come una sola.
  let chiusoOra = false;
  let zitto = false;

  Menu.allaChiusura(() => {
    if (zitto || !m) return;
    chiusoOra = true;
    const s = seq;
    queueMicrotask(() => { if (chiusoOra) { chiusoOra = false; api.fuori(s); } });
  });

  // La ricerca nella cronologia degli appunti fatta nello strato: il main la conta come quella nella pagina (#1461).
  globalThis.SN_MENU_CONTA = (evento) => {
    if (!evento || evento.misura !== 'ricerca') return;
    api.chiedi('conta', { pannello: evento.pannello, esito: evento.esito, attesaMs: evento.attesaMs, posizione: evento.posizione });
  };

  function chiedi(canale, dati = {}) {
    if (!m) return;
    const chiude = chiusoOra;
    chiusoOra = false;
    api.chiedi(canale, { seq, id: m.id, ...dati, chiude });
  }

  function segno(el) {
    let s = m.segni.get(el);
    if (!s) {
      s = `a${m.ancore.size + 1}`;
      m.segni.set(el, s);
      m.ancore.set(s, el);
    }
    return s;
  }

  // Una voce del content script: la si chiama per numero. Chi apre un pannello passa il bottone, che qui diventa il suo
  // segno; mentre la risposta viaggia la stessa voce non riparte (hover e clic sullo stesso «Altro…»).
  const chiamata = (n) => Object.assign((...args) => {
    if (!m) return;
    const conAncora = args.some((a) => a instanceof Element);
    if (conAncora) {
      const t = m.inVolo.get(n);
      if (t && Date.now() - t < 1000) { chiusoOra = false; return; }
      m.inVolo.set(n, Date.now());
    }
    const op = { speciale: (v) => (v instanceof Element ? { $ancora: segno(v) } : undefined) };
    chiedi('esegui', { n, args: D.descrivi(args, op) });
  }, { n });

  // Il contagocce chiede un gesto vero, e la pagina sotto non ce l'ha: lo apre lo strato, e alla voce va il colore.
  // Lo strato resta a schermo, vuoto, finché l'utente non sceglie un punto o rinuncia.
  const contagocce = (fn) => () => {
    if (!m || typeof window.EyeDropper !== 'function') { fn(); return; }
    chiusoOra = false;
    const s = seq;
    new window.EyeDropper().open().then((r) => r && r.sRGBHex, () => null).then((hex) => {
      if (!m || seq !== s) return;
      if (!hex) { api.fuori(s); return; }
      chiusoOra = true;
      chiedi('esegui', { n: fn.n, args: [String(hex)], contagocce: true });
    });
  };

  // ── quello che arriva dalla scheda non diventa codice qui ───────────────
  const SVG_VIETATI = new Set(['script', 'foreignobject', 'use', 'image', 'a', 'iframe', 'style', 'animate', 'set', 'animatemotion', 'animatetransform']);
  function pulisciIcona(s) {
    if (typeof s !== 'string' || !/^<svg[\s>]/.test(s)) return s;
    let doc;
    try { doc = new DOMParser().parseFromString(s, 'image/svg+xml'); } catch (_) { return ''; }
    const radice = doc.documentElement;
    if (!radice || radice.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return '';
    for (const el of [radice, ...radice.querySelectorAll('*')]) {
      if (SVG_VIETATI.has(el.nodeName.toLowerCase())) { el.remove(); continue; }
      for (const a of [...el.attributes]) {
        const nome = a.name.toLowerCase();
        if (nome.startsWith('on') || nome.endsWith('href') || /url\s*\(/i.test(a.value)) el.removeAttribute(a.name);
      }
    }
    return new XMLSerializer().serializeToString(radice);
  }

  const TAG = new Set(['div', 'span', 'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'small', 'mark', 'code', 'pre', 'kbd',
    'sub', 'sup', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'table', 'thead', 'tbody',
    'tfoot', 'tr', 'th', 'td', 'caption', 'del', 'ins', 'abbr', 'button', 'a']);
  const ATTR = new Set(['class', 'title', 'aria-label', 'aria-hidden', 'role', 'hidden', 'data-subject', 'dir', 'lang', 'colspan', 'rowspan']);
  // Un elemento che non passa diventa uno span vuoto, non sparisce: i cammini dei bottoni restano quelli del content script.
  function pulisciHtml(html) {
    const t = document.createElement('template');
    t.innerHTML = String(html || '');
    for (const el of [...t.content.querySelectorAll('*')]) {
      if (!el.isConnected && !t.content.contains(el)) continue;
      const tag = el.localName;
      if (!TAG.has(tag) || el.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
        const vuoto = document.createElement('span');
        el.replaceWith(vuoto);
        continue;
      }
      for (const a of [...el.attributes]) if (!ATTR.has(a.name.toLowerCase())) el.removeAttribute(a.name);
      if (tag === 'button') el.type = 'button';
    }
    return t.content;
  }

  const classi = (s, base) => [base, ...String(s || '').split(/\s+/).filter((c) => /^[\w-]+$/.test(c) && c !== base)].join(' ');

  function applicaInline(n, d) {
    const el = m && m.inline.get(n);
    if (!el) { if (m) m.attese.set(`i${n}`, d); return; }
    if (d.via) {
      const prima = el.previousElementSibling;
      if (d.sepVia && prima && prima.classList.contains('sn-menu-sep')) prima.remove();
      el.remove();
      return;
    }
    const subject = el.dataset.subject;
    el.className = classi(d.classi, 'sn-menu-inline');
    if (subject) el.dataset.subject = subject;
    el.replaceChildren(pulisciHtml(d.html));
  }

  function applicaCorrezione(n, d) {
    const update = m && m.correzioni.get(n);
    if (!update) { if (m) m.attese.set(`c${n}`, d); return; }
    update(voce(D.ricostruisci(d.props || {}, { funzione: chiamata })));
  }

  function voce(v) {
    if (Array.isArray(v)) return v.map(voce);
    if (!v || typeof v !== 'object' || typeof v === 'function') return v;
    for (const k of Object.keys(v)) {
      if (k === 'icon') v[k] = pulisciIcona(v[k]);
      else if (v[k] && typeof v[k] === 'object') v[k] = voce(v[k]);
    }
    if (v.nelloStrato === 'contagocce' && typeof v.onClick === 'function' && Number.isInteger(v.onClick.n)) v.onClick = contagocce(v.onClick);
    return v;
  }

  function costruisci(lista, cronologia) {
    const items = voce(D.ricostruisci(Array.isArray(lista) ? lista : [], { funzione: chiamata }));
    return items.filter((it) => it && typeof it === 'object').map((it) => {
      if (it.type === 'inline' && Number.isInteger(it.$inline)) {
        const n = it.$inline;
        return {
          type: 'inline', subject: it.subject || '', content: it.content || '',
          onMount: (el) => {
            m.inline.set(n, el);
            // La rotella e Ctrl (Cmd) su un collegamento della spiegazione lo aprono dietro, come nella pagina.
            const premuto = (e) => {
              if (e.type === 'auxclick' && e.button !== 1) return;
              const b = e.target.closest && e.target.closest('button, a, [role="button"]');
              const cammino = b && el.contains(b) ? D.cammino(el, b) : null;
              if (!cammino) return;
              e.preventDefault();
              e.stopPropagation();
              chiedi('esegui', { inline: n, cammino, sfondo: e.type === 'auxclick' || e.ctrlKey || e.metaKey });
            };
            el.addEventListener('click', premuto);
            el.addEventListener('auxclick', premuto);
            const d = m.attese.get(`i${n}`);
            if (d) { m.attese.delete(`i${n}`); applicaInline(n, d); }
          },
        };
      }
      if (it.type === 'correction' && Number.isInteger(it.$corr)) {
        const n = it.$corr;
        return {
          ...it,
          onMount: (_wrap, update) => {
            m.correzioni.set(n, update);
            const d = m.attese.get(`c${n}`);
            if (d) { m.attese.delete(`c${n}`); applicaCorrezione(n, d); }
          },
        };
      }
      if (it.type === 'paste' && it.$incolla) {
        const chiave = (e) => (Clip ? Clip.chiave(e) : '');
        return {
          type: 'paste', label: it.label, shortcut: it.shortcut, disabled: !!it.disabled,
          history: cronologia,
          onClick: () => chiedi('incolla'),
          onPickHistory: (e) => chiedi('scegli', { chiave: chiave(e) }),
          onRemoveHistory: (e) => chiedi('togli', { chiave: chiave(e) }),
          onClearHistory: () => chiedi('svuota'),
        };
      }
      return it;
    });
  }

  function applicaTema(tema, tokens) {
    let t = tema === 'dark' || tema === 'light' ? tema : null;
    if (!t) { try { t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (_) { t = 'light'; } }
    document.documentElement.dataset.snTheme = t;
    try { globalThis.SN_THEME_TOKENS?.applyToDocument(document, tokens && typeof tokens === 'object' ? tokens : {}); } catch (_) {}
  }

  function chiudiZitto() {
    zitto = true;
    try { Menu.close(); } finally { zitto = false; }
    chiusoOra = false;
  }

  api.onMostra((d) => {
    if (!d || !Number.isFinite(d.x) || !Number.isFinite(d.y)) return;
    chiudiZitto();
    seq = Number(d.seq) || 0;
    ancora.style.left = `${d.x}px`;
    ancora.style.top = `${d.y}px`;
    ancora.hidden = false;
    m = null;
    if (!d.menu || typeof d.menu.id !== 'string') return;
    m = {
      id: d.menu.id, ancore: new Map(), segni: new WeakMap(), inline: new Map(), correzioni: new Map(),
      attese: new Map(), inVolo: new Map(), restaAperto: !!d.menu.keepOnScroll,
    };
    applicaTema(d.tema, d.tokens);
    const cronologia = Array.isArray(d.cronologia) ? d.cronologia.filter((e) => e && typeof e === 'object') : [];
    const questo = m;
    const disegna = () => {
      if (m !== questo) return;
      Menu.open({ x: d.x, y: d.y, items: costruisci(d.menu.items, cronologia), keepOnScroll: !!d.menu.keepOnScroll });
    };
    // Lo strato era nascosto grande zero: finché la pagina non ha la misura della scheda, il menu si poserebbe nell'angolo.
    quandoMisura(d.w, d.h, disegna);
  });

  function quandoMisura(w, h, fn) {
    const giusta = () => !(w > 0 && h > 0) || (Math.abs(window.innerWidth - w) <= 1 && Math.abs(window.innerHeight - h) <= 1);
    if (giusta()) { fn(); return; }
    let fatto = false;
    const via = () => {
      if (fatto) return;
      fatto = true;
      window.removeEventListener('resize', guarda);
      clearTimeout(t);
      fn();
    };
    const guarda = () => { if (giusta()) via(); };
    const t = setTimeout(via, 500);
    window.addEventListener('resize', guarda);
  }

  api.onAggiorna((d) => {
    if (!m || !d || d.id !== m.id) return;
    if (d.cosa === 'inline' && Number.isInteger(d.n)) applicaInline(d.n, d);
    else if (d.cosa === 'correzione' && Number.isInteger(d.n)) applicaCorrezione(d.n, d);
    else if (d.cosa === 'riga') Menu.refreshIconRow(costruisci(d.items, []));
    else if (d.cosa === 'griglia') Menu.refreshIconGrid(costruisci(d.items, []));
    else if (d.cosa === 'fuori') {
      // L'anteprima finisce in innerHTML: passa solo un SVG ripulito, il resto come testo.
      const ic = pulisciIcona(String(d.svg || ''));
      const icon = /^<svg[\s>]/.test(ic) ? ic : ic.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
      Menu.trascinaDaFuori({ fase: String(d.fase || ''), id: String(d.icona || ''), x: Number(d.x) || 0, y: Number(d.y) || 0, icon });
    }
    else if (d.cosa === 'griglia-apri') {
      m.inVolo.clear();
      const el = m.ancore.get(String(d.ancora || ''));
      // Arrivata tardi, con un altro pannello già aperto dall'utente: vale quello.
      if (!el || !el.isConnected || Menu.isSubMenuOpen()) return;
      Menu.openIconGridSubmenu(el, costruisci(d.items, []), D.ricostruisci(d.opts || {}, { funzione: chiamata }));
    }
  });

  api.onVia(() => {
    chiudiZitto();
    m = null;
    seq = 0;
    ancora.hidden = true;
  });

  // La cronologia degli appunti si cerca scrivendo: aperta, lo strato prende la tastiera.
  let cerca = null;
  new MutationObserver(() => {
    const c = m ? document.querySelector('.sn-menu-history-search-input') : null;
    if (c && c !== cerca) chiedi('tastiera');
    cerca = c;
  }).observe(document.documentElement, { childList: true });

  // Le icone trascinate dal menu verso la barra laterale: i px dello strato sono quelli della scheda (#871).
  let barra = null;
  let mira = null;
  const trascina = (d) => Promise.resolve(api.barra(d)).catch(() => null);
  Menu.setPonteBarra({
    inizio(id, menuSinistra) {
      barra = null;
      mira = null;
      trascina({ fase: 'inizio', id, menuSinistra }).then((r) => { if (r && r.ok) barra = { larghezza: Number(r.larghezza) || 0 }; });
    },
    sopra(x, y) {
      const dentro = !!barra && x <= barra.larghezza;
      const nuova = dentro ? Math.round(y) : null;
      if (nuova !== mira) { mira = nuova; trascina({ fase: 'sopra', y: nuova }); }
      return dentro;
    },
    posa(id, x, y) {
      if (!barra || x > barra.larghezza) return false;
      trascina({ fase: 'posa', id, x: Math.round(x), y: Math.round(y) });
      return true;
    },
    fine() {
      barra = null;
      mira = null;
      trascina({ fase: 'fine' });
    },
  });

  // Fuori dal menu c'è solo lo strato vuoto: chiude, e un tasto destro lì apre il menu nuovo sulla scheda (il Ctrl+clic
  // del Mac arriva già come tasto destro).
  const vuoto = (t) => t === document.documentElement || t === document.body || t === ancora;
  const fuori = (e) => {
    if (!seq || !vuoto(e.target)) return;
    e.preventDefault();
    api.fuori(seq, e.button === 2 ? { x: e.clientX, y: e.clientY } : null);
  };
  document.addEventListener('pointerdown', fuori, true);
  // Il menu di una selezione o di una parola resta mentre la pagina scorre, come nella pagina: la rotella passa sotto.
  document.addEventListener('wheel', (e) => {
    if (!seq || !vuoto(e.target)) return;
    e.preventDefault();
    if (m && m.restaAperto) api.chiedi('rotella', { seq, id: m.id, x: e.clientX, y: e.clientY, dx: e.deltaX, dy: e.deltaY });
    else api.fuori(seq);
  }, { capture: true, passive: false });
  document.addEventListener('contextmenu', (e) => e.preventDefault(), true);
})();
