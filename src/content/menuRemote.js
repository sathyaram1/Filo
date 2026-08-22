// #445 — il menu del tasto destro di un riquadro incorporato, disegnato dalla
// pagina che lo ospita.
//
// Dentro un iframe il menu non può uscire dai bordi del riquadro: su un player
// o una pubblicità alti 100-350 px diventa una fessura da scorrere, mentre lo
// stesso menu, due centimetri più in là sulla stessa pagina, si vede tutto.
// Quando il menu non ci sta, il riquadro non lo disegna: manda alla pagina la
// DESCRIZIONE del menu e la pagina lo disegna sopra al riquadro, con tutta
// l'altezza della finestra a disposizione. Le voci restano quelle dell'elemento
// cliccato nel riquadro: la pagina rimanda indietro la scelta, il riquadro la
// esegue: è lui a conoscere il link, l'immagine, il campo di testo.
//
// Fra i due frame passano DATI, mai nodi né HTML:
//   - etichette, scorciatoie e testo entrano come testo (textContent);
//   - le icone valgono solo se coincidono con una del registro di Filo
//     (whitelist), altrimenti la voce resta senza icona;
//   - le sezioni che si riempiono dopo (la spiegazione AI, l'anteprima di un
//     link) mandano il loro STATO — { state, text, markdown } — e a disegnarlo
//     è menu.js dalla parte della pagina.
// Il ponte del main instrada solo fra i due frame legati dal token del menu
// aperto (vedi MSG.PROJECT_MENU in src/main/services/handlers/nav.js).

(function (global) {
  'use strict';

  const MSG = (global.SN_MSG && global.SN_MSG.MSG) || {};

  const IS_SUBFRAME = (() => {
    try { return window.top !== window.self; } catch (_) { return true; }
  })();

  const send = (payload) => {
    try {
      return Promise.resolve(chrome.runtime.sendMessage({ type: MSG.PROJECT_MENU, ...payload }))
        .catch(() => ({ ok: false }));
    } catch (_) { return Promise.resolve({ ok: false }); }
  };

  const str = (v) => (v == null ? '' : String(v));

  // ── Lato riquadro: dove siamo dentro la finestra ──────────────────────────
  //
  // Un iframe di un'altra origine non può sapere in che punto del genitore si
  // trova. Lo apprende dal main: a ogni click destro Electron conosce le
  // coordinate dell'evento nella scheda, il riquadro conosce le proprie, e la
  // differenza è l'origine del riquadro.
  let lastLocalPoint = null;
  let viewOffset = null;

  function noteLocalPoint(x, y) {
    lastLocalPoint = { x: Number(x) || 0, y: Number(y) || 0 };
  }

  function noteViewPos(x, y) {
    if (!lastLocalPoint) return;
    viewOffset = {
      dx: (Number(x) || 0) - lastLocalPoint.x,
      dy: (Number(y) || 0) - lastLocalPoint.y,
      t: Date.now(),
    };
  }

  // L'offset invecchia: se la pagina scorre fra un click destro e l'altro il
  // riquadro si sposta. Viene riscritto a ogni click destro, quindi in pratica
  // ha sempre l'età dell'apertura in corso.
  const OFFSET_MAX_AGE_MS = 10000;

  function canProject() {
    if (!IS_SUBFRAME) return false;
    if (!viewOffset || Date.now() - viewOffset.t > OFFSET_MAX_AGE_MS) return false;
    // A tutto schermo il browser disegna SOLO l'elemento fullscreen: un menu
    // appeso alla pagina resterebbe dietro al video. Lì il riquadro occupa già
    // tutta la finestra, quindi non c'è niente da delegare.
    try { if (document.fullscreenElement) return false; } catch (_) {}
    return true;
  }

  // ── Lato riquadro: proiezione ─────────────────────────────────────────────

  let owned = null; // { token, handlers, inline, correction, cleanups, ready, done }

  function newToken() {
    return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function sanitizeHistoryEntry(entry) {
    if (!entry || typeof entry !== 'object') return { text: '' };
    return {
      type: entry.type === 'image' ? 'image' : 'text',
      text: str(entry.text).slice(0, 400),
      description: str(entry.description).slice(0, 200),
    };
  }

  function serialize(items, reg) {
    const ref = (fn) => {
      if (typeof fn !== 'function') return null;
      const id = `h${reg.handlers.size + 1}`;
      reg.handlers.set(id, fn);
      return id;
    };
    const subList = (list) => (Array.isArray(list) ? list : []).map((s) => {
      if (s && s.type === 'separator') return { t: 'sep' };
      if (s && s.type === 'info') return { t: 'info', label: str(s.label) };
      return { t: 'item', label: str(s && s.label), disabled: !!(s && s.disabled), click: ref(s && s.onClick) };
    });

    const out = [];
    let n = 0;
    for (const it of (items || [])) {
      const type = it && it.type;
      if (type === 'separator') { out.push({ t: 'sep', hidden: !!it.hidden }); continue; }
      if (type === 'row') {
        // La riga di icone globali NON viaggia: sono azioni sulla PAGINA (già
        // oggi il riquadro le rimanda a lei) e la pagina se la ricostruisce da
        // sé, col suo layout e il suo trascinamento. Passa solo lo stato di
        // navigazione, che decide il grigio di avanti/indietro.
        out.push({ t: 'row', navState: it.navState || null });
        continue;
      }
      if (type === 'inline') {
        const path = `p${++n}`;
        reg.inline.set(path, it);
        out.push({
          t: 'inline',
          path,
          content: str(it.content),
          variant: it.variant || 'plain',
          arrow: !!it.arrow,
          arrowTitle: str(it.arrowTitle),
          onArrow: ref(it.onArrow),
        });
        continue;
      }
      if (type === 'correction') {
        const path = `p${++n}`;
        reg.correction.set(path, it);
        out.push({
          t: 'correction',
          path,
          label: str(it.label),
          loading: !!it.loading,
          hidden: !!it.hidden,
          disabled: !!it.disabled,
          click: ref(it.onClick),
          sub: subList(it.subItems),
        });
        continue;
      }
      if (type === 'split') {
        out.push({
          t: 'split',
          label: str(it.label),
          icon: str(it.icon),
          shortcut: str(it.shortcut),
          arrowTitle: str(it.arrowTitle),
          disabled: !!it.disabled,
          click: ref(it.onClick),
          sub: subList(it.subItems),
        });
        continue;
      }
      if (type === 'paste') {
        const history = Array.isArray(it.history) ? it.history : [];
        // Le voci tornano indietro per POSIZIONE: la lista è la stessa dalle due
        // parti e l'unica modifica possibile è la rimozione, che qui rispecchia
        // quella fatta di là — altrimenti gli indici si sfaserebbero e si
        // incollerebbe l'appunto sbagliato.
        out.push({
          t: 'paste',
          label: str(it.label),
          shortcut: str(it.shortcut),
          disabled: !!it.disabled,
          click: ref(it.onClick),
          history: history.map(sanitizeHistoryEntry),
          pick: ref(typeof it.onPickHistory === 'function'
            ? (i) => { const e = history[i]; if (e) it.onPickHistory(e); } : null),
          remove: ref(typeof it.onRemoveHistory === 'function'
            ? (i) => { const e = history[i]; if (e) { it.onRemoveHistory(e); history.splice(i, 1); } } : null),
          clear: ref(it.onClearHistory),
        });
        continue;
      }
      out.push({
        t: 'item',
        label: str(it && it.label),
        icon: str(it && it.icon),
        shortcut: str(it && it.shortcut),
        tag: str(it && it.tag),
        disabled: !!(it && it.disabled),
        click: ref(it && it.onClick),
      });
    }
    return out;
  }

  // Traduce le props di un update() in dati: le funzioni diventano riferimenti.
  function serializeProps(props, reg) {
    const p = props || {};
    const ref = (fn) => {
      if (typeof fn !== 'function') return null;
      const id = `h${reg.handlers.size + 1}`;
      reg.handlers.set(id, fn);
      return id;
    };
    const out = {};
    for (const k of ['state', 'text', 'warn', 'label']) {
      if (Object.prototype.hasOwnProperty.call(p, k)) out[k] = str(p[k]);
    }
    for (const k of ['markdown', 'remove', 'hidden', 'loading', 'disabled']) {
      if (Object.prototype.hasOwnProperty.call(p, k)) out[k] = !!p[k];
    }
    if (Object.prototype.hasOwnProperty.call(p, 'onClick')) out.click = ref(p.onClick);
    if (Object.prototype.hasOwnProperty.call(p, 'subItems')) {
      out.sub = (Array.isArray(p.subItems) ? p.subItems : []).map((s) => {
        if (s && s.type === 'separator') return { t: 'sep' };
        if (s && s.type === 'info') return { t: 'info', label: str(s.label) };
        return { t: 'item', label: str(s && s.label), disabled: !!(s && s.disabled), click: ref(s && s.onClick) };
      });
    }
    return out;
  }

  function project({ items, x, y, keepOnScroll, onFallback }) {
    if (!canProject()) return false;
    const reg = {
      handlers: new Map(),
      inline: new Map(),
      correction: new Map(),
    };
    const token = newToken();
    const spec = serialize(items, reg);
    const state = {
      token, reg, cleanups: [], ready: false, done: false, onFallback,
      remoteClosed: false,
    };
    owned = state;

    send({
      phase: 'open',
      token,
      spec,
      x: Math.round(x + viewOffset.dx),
      y: Math.round(y + viewOffset.dy),
      keepOnScroll: !!keepOnScroll,
    }).then((res) => {
      if (owned !== state || state.done) return;
      if (!res || res.ok === false) giveUp(state);
    });

    // Le righe di correzione montano SUBITO: l'unica cosa che fanno è mettere in
    // mano al chiamante l'updater, e il suggerimento del correttore nativo può
    // arrivare nello stesso istante in cui il menu si apre.
    for (const [path, item] of reg.correction) {
      if (typeof item.onMount !== 'function') continue;
      try {
        const cleanup = item.onMount(null, (props) => {
          if (owned !== state || state.done) return;
          send({ phase: 'patch', token, path, props: serializeProps(props, reg) });
        });
        if (typeof cleanup === 'function') state.cleanups.push(cleanup);
      } catch (e) { console.error('[SN] correzione proiettata', e); }
    }

    // Le sezioni che chiedono qualcosa al modello partono SOLO quando la pagina
    // conferma di aver disegnato il menu: se non ce l'ha fatta ricadiamo sul
    // menu locale, e la spiegazione non deve essere chiesta (e pagata) due volte.
    state.timer = setTimeout(() => {
      if (owned === state && !state.ready && !state.done) giveUp(state);
    }, 1500);

    return true;
  }

  function mountInline(state) {
    for (const [path, item] of state.reg.inline) {
      if (typeof item.onMount !== 'function') continue;
      try {
        const cleanup = item.onMount(null, (props) => {
          if (owned !== state || state.done) return;
          send({ phase: 'patch', token: state.token, path, props: serializeProps(props, state.reg) });
        });
        if (typeof cleanup === 'function') state.cleanups.push(cleanup);
      } catch (e) { console.error('[SN] sezione proiettata', e); }
    }
  }

  function runCleanups(state) {
    for (const fn of state.cleanups) { try { fn(); } catch (_) {} }
    state.cleanups.length = 0;
  }

  // La pagina non ce l'ha fatta (o non ha risposto): il menu lo disegna il
  // riquadro, scorrevole, come prima di questo lavoro. Meglio stretto che
  // assente.
  function giveUp(state) {
    if (state.done) return;
    state.done = true;
    if (state.timer) clearTimeout(state.timer);
    runCleanups(state);
    if (owned === state) owned = null;
    try { state.onFallback && state.onFallback(); } catch (e) { console.error(e); }
  }

  // Chiude il menu che sta disegnando la pagina (se ce n'è uno di questo frame).
  function closeProjected() {
    const state = owned;
    if (!state || state.done) return;
    state.done = true;
    if (state.timer) clearTimeout(state.timer);
    runCleanups(state);
    owned = null;
    if (!state.remoteClosed) send({ phase: 'close', token: state.token });
  }

  function hasProjection() { return !!(owned && !owned.done); }

  // ── Lato pagina: disegno del menu per conto del riquadro ──────────────────

  let hosted = null; // { token, closingFromRemote }

  // Whitelist delle icone: una stringa SVG che arriva da un altro frame vale
  // solo se è IDENTICA a una che questa pagina sa produrre da sé. Così la voce
  // "Condividi" mostra l'aeroplanino e nient'altro può entrare come markup.
  let iconWhitelist = null;
  const ICON_SIZES = [12, 14, 16, 18, 20, 22, 24, 28];
  function allowedIcon(value) {
    const s = str(value);
    if (!s) return undefined;
    const isSvg = global.SN_ICONS_UTIL?.isSvgIcon
      ? global.SN_ICONS_UTIL.isSvgIcon(s)
      : s.startsWith('<svg');
    if (!isSvg) return s.length <= 8 ? s : undefined; // glifi unicode (▸, ▾): testo, non markup
    if (!iconWhitelist) {
      iconWhitelist = new Set();
      const Icons = global.SN_ICONS || {};
      for (const k of Object.keys(Icons)) {
        if (typeof Icons[k] !== 'function') continue;
        for (const size of ICON_SIZES) {
          try { iconWhitelist.add(Icons[k](size)); } catch (_) {}
        }
      }
    }
    return iconWhitelist.has(s) ? s : undefined;
  }

  function deserialize(spec, ctx) {
    const fire = (id, arg) => {
      if (!id || !hosted || hosted.token !== ctx.token) return;
      send({ phase: 'event', token: ctx.token, id: String(id), arg });
    };
    const subList = (list) => (Array.isArray(list) ? list : []).map((s) => {
      if (s && s.t === 'sep') return { type: 'separator' };
      if (s && s.t === 'info') return { type: 'info', label: str(s.label) };
      const click = s && s.click;
      return {
        label: str(s && s.label),
        disabled: !!(s && s.disabled),
        onClick: click ? () => fire(click) : null,
      };
    });

    const items = [];
    for (const s of (Array.isArray(spec) ? spec : [])) {
      const t = s && s.t;
      if (t === 'sep') { items.push({ type: 'separator', hidden: !!s.hidden }); continue; }
      if (t === 'row') {
        const Icons = global.SN_MENU_ICONS;
        if (Icons && typeof Icons.buildGlobalIconRow === 'function') {
          try { items.push(Icons.buildGlobalIconRow(s.navState || null)); } catch (_) {}
        }
        continue;
      }
      if (t === 'inline') {
        const onArrow = s.onArrow;
        items.push({
          type: 'inline',
          content: str(s.content),
          variant: s.variant === 'explain' || s.variant === 'link' ? s.variant : 'plain',
          arrow: !!s.arrow,
          arrowTitle: str(s.arrowTitle),
          onArrow: onArrow ? () => fire(onArrow) : null,
          onMount: (_el, update) => { ctx.updaters.set(str(s.path), update); },
        });
        continue;
      }
      if (t === 'correction') {
        const click = s.click;
        items.push({
          type: 'correction',
          label: str(s.label),
          loading: !!s.loading,
          hidden: !!s.hidden,
          disabled: !!s.disabled,
          onClick: click ? () => fire(click) : null,
          subItems: subList(s.sub),
          onMount: (_wrap, update) => { ctx.updaters.set(str(s.path), update); },
        });
        continue;
      }
      if (t === 'split') {
        const click = s.click;
        items.push({
          type: 'split',
          label: str(s.label),
          icon: allowedIcon(s.icon),
          shortcut: str(s.shortcut),
          arrowTitle: str(s.arrowTitle),
          disabled: !!s.disabled,
          onClick: click ? () => fire(click) : null,
          subItems: subList(s.sub),
        });
        continue;
      }
      if (t === 'paste') {
        const history = (Array.isArray(s.history) ? s.history : []).map(sanitizeHistoryEntry);
        const click = s.click;
        items.push({
          type: 'paste',
          label: str(s.label),
          shortcut: str(s.shortcut),
          disabled: !!s.disabled,
          onClick: click ? () => fire(click) : null,
          history,
          onPickHistory: s.pick ? (entry) => fire(s.pick, history.indexOf(entry)) : null,
          onRemoveHistory: s.remove ? (entry) => fire(s.remove, history.indexOf(entry)) : null,
          onClearHistory: s.clear ? () => fire(s.clear) : null,
        });
        continue;
      }
      const click = s && s.click;
      items.push({
        type: 'item',
        label: str(s && s.label),
        icon: allowedIcon(s && s.icon),
        shortcut: str(s && s.shortcut),
        tag: str(s && s.tag),
        disabled: !!(s && s.disabled),
        onClick: click ? () => fire(click) : null,
      });
    }
    return items;
  }

  function deserializeProps(props, ctx) {
    const p = props || {};
    const fire = (id, arg) => {
      if (!id || !hosted || hosted.token !== ctx.token) return;
      send({ phase: 'event', token: ctx.token, id: String(id), arg });
    };
    const out = {};
    for (const k of ['state', 'text', 'warn', 'label']) {
      if (Object.prototype.hasOwnProperty.call(p, k)) out[k] = str(p[k]);
    }
    for (const k of ['markdown', 'remove', 'hidden', 'loading', 'disabled']) {
      if (Object.prototype.hasOwnProperty.call(p, k)) out[k] = !!p[k];
    }
    if (Object.prototype.hasOwnProperty.call(p, 'click')) {
      const click = p.click;
      out.onClick = click ? () => fire(click) : null;
    }
    if (Object.prototype.hasOwnProperty.call(p, 'sub')) {
      out.subItems = (Array.isArray(p.sub) ? p.sub : []).map((s) => {
        if (s && s.t === 'sep') return { type: 'separator' };
        if (s && s.t === 'info') return { type: 'info', label: str(s.label) };
        const click = s && s.click;
        return {
          label: str(s && s.label),
          disabled: !!(s && s.disabled),
          onClick: click ? () => fire(click) : null,
        };
      });
    }
    return out;
  }

  function hostMenu(msg) {
    const Menu = global.SN_MENU;
    if (!Menu) return;
    const token = str(msg.token);
    // A tutto schermo il browser disegna solo l'elemento fullscreen: se è il
    // riquadro stesso, un menu appeso a questa pagina finirebbe dietro di lui.
    // Meglio dire di no e lasciare che il riquadro se lo disegni da sé.
    let fs = null;
    try { fs = document.fullscreenElement; } catch (_) {}
    if (fs) { send({ phase: 'refused', token }); return; }

    const ctx = { token, updaters: new Map() };
    hosted = ctx;
    const items = deserialize(msg.spec, ctx);
    Menu.open({
      x: Number(msg.x) || 0,
      y: Number(msg.y) || 0,
      items,
      keepOnScroll: !!msg.keepOnScroll,
      noProject: true,
      // Il campo su cui l'utente stava scrivendo vive nel RIQUADRO: un click
      // su questa pagina glielo toglierebbe, e con lui il punto in cui
      // incollare o la parola da correggere.
      keepFocus: true,
      onClose: () => {
        if (hosted !== ctx) return;
        hosted = null;
        if (!ctx.closingFromRemote) send({ phase: 'close', token });
      },
    });
    send({ phase: 'ready', token });
  }

  function onBridgeMessage(msg) {
    if (!msg || msg.type !== MSG.PROJECTED_MENU) return;
    const phase = str(msg.phase);
    const token = str(msg.token);

    // Arrivati al riquadro che ha aperto il menu.
    if (phase === 'ready' || phase === 'refused' || phase === 'event' || phase === 'close') {
      const state = owned;
      if (state && !state.done && state.token === token) {
        if (phase === 'ready') {
          state.ready = true;
          if (state.timer) clearTimeout(state.timer);
          mountInline(state);
          return;
        }
        if (phase === 'refused') { giveUp(state); return; }
        if (phase === 'close') { state.remoteClosed = true; closeProjected(); return; }
        if (phase === 'event') {
          const fn = state.reg.handlers.get(str(msg.id));
          if (typeof fn === 'function') {
            try { fn(msg.arg); } catch (e) { console.error('[SN] azione dal menu proiettato', e); }
          }
          return;
        }
      }
    }

    // Arrivati alla pagina che disegna il menu per conto del riquadro.
    if (phase === 'open') { hostMenu(msg); return; }
    if (phase === 'patch') {
      if (!hosted || hosted.token !== token) return;
      const update = hosted.updaters.get(str(msg.path));
      if (typeof update === 'function') {
        try { update(deserializeProps(msg.props, hosted)); } catch (e) { console.error(e); }
      }
      return;
    }
    if (phase === 'close') {
      if (!hosted || hosted.token !== token) return;
      hosted.closingFromRemote = true;
      try { global.SN_MENU?.close?.(); } catch (_) {}
      hosted = null;
    }
  }

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      try {
        if (msg && msg.type === MSG.FRAME_VIEW_POS) { noteViewPos(msg.x, msg.y); return; }
        onBridgeMessage(msg);
      } catch (e) { console.error('[SN] ponte menu', e); }
    });
  } catch (_) {}

  // Lo scroll dentro il riquadro non arriva alla pagina (gli eventi non
  // attraversano il confine di un iframe): senza questo il menu disegnato di là
  // resterebbe fermo sopra un contenuto che si è già spostato.
  if (IS_SUBFRAME) {
    try {
      const bail = () => { if (hasProjection()) { try { global.SN_MENU?.close?.(); } catch (_) {} } };
      window.addEventListener('scroll', bail, true);
      window.addEventListener('resize', bail, true);
    } catch (_) {}
  }

  global.SN_MENU_REMOTE = {
    canProject,
    project,
    closeProjected,
    hasProjection,
    noteLocalPoint,
    noteViewPos,
    // per i test unitari
    _serialize: serialize,
    _allowedIcon: allowedIcon,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
