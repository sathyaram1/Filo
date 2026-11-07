// Una scheda portata fuori dalla fila arriva qui dal main (#2084), coi punti di questa pagina: sopra una chat di Filo
// diventa un gettone (#2085), sopra un campo di testo di un sito scrive titolo e indirizzo, altrove niente. Mentre si
// passa la destinazione si illumina. Ogni mondo (pagina di Filo, content script, strato) risponde solo per le sue chat.

(function (global) {
  'use strict';

  const chats = new Set();
  let campiDelSito = false;
  let inAscolto = false;
  let luce = null;
  let ora = null;

  const dentro = (r, x, y) => r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

  function chatSotto(x, y) {
    for (const c of chats) {
      if (!c.area.isConnected) continue;
      if (dentro(c.area.getBoundingClientRect(), x, y)) return c;
    }
    return null;
  }

  function elementoSotto(doc, x, y) {
    let el = doc.elementFromPoint(x, y);
    for (let i = 0; el && el.shadowRoot && i < 16; i++) {
      const giu = el.shadowRoot.elementFromPoint(x, y);
      if (!giu || giu === el) break;
      el = giu;
    }
    return el;
  }

  // Il campo che riceverebbe il testo: input o textarea scrivibili, o l'ospite di un contenteditable. Mai un pezzo di Filo.
  function campoSotto(doc, x, y) {
    if (!campiDelSito) return null;
    const el = elementoSotto(doc, x, y);
    const C = global.SN_CAMPO_TESTO;
    if (!el || !C || el.closest('[data-sn-riquadro]') || !C.campoDiTesto(el)) return null;
    if (el.matches('input, textarea')) return el;
    let ospite = el;
    while (ospite.parentElement && ospite.parentElement.isContentEditable) ospite = ospite.parentElement;
    return ospite;
  }

  function bersaglio(doc, x, y) {
    const c = chatSotto(x, y);
    if (c) return { chat: c, el: c.area };
    const f = campoSotto(doc, x, y);
    return f ? { campo: f, el: f } : null;
  }

  function illumina(doc, el) {
    if (!el) { if (luce) luce.style.display = 'none'; return; }
    if (!luce || !luce.isConnected) {
      const ospite = doc.createElement('filo-luce');
      const ombra = ospite.attachShadow({ mode: 'closed' });
      luce = doc.createElement('div');
      luce.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border-radius:8px;box-sizing:border-box;'
        + 'border:2px solid #c8743c;background:rgba(200,116,60,0.10);box-shadow:0 0 0 4px rgba(200,116,60,0.18);'
        + 'transition:all 0.1s ease;';
      ombra.appendChild(luce);
      ospite.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;';
      (doc.documentElement || doc.body).appendChild(ospite);
    }
    const r = el.getBoundingClientRect();
    Object.assign(luce.style, { display: 'block', left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
  }

  function scriviNelCampo(doc, el, x, y, scheda) {
    const tipo = String(el.getAttribute('type') || '').toLowerCase();
    const parole = tipo === 'url' ? scheda.url : `${scheda.titolo} ${scheda.url}`;
    const aFuoco = doc.activeElement === el;
    try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
    if (el.matches('input, textarea')) {
      try { if (!aFuoco) el.setSelectionRange(el.value.length, el.value.length); } catch (_) {}
      let prima = '';
      try { prima = el.value.slice(0, el.selectionStart); } catch (_) { prima = el.value; }
      const t = (prima && !/\s$/.test(prima) ? ' ' : '') + parole;
      if (!doc.execCommand('insertText', false, t)) {
        try { el.setRangeText(t, el.selectionStart, el.selectionEnd, 'end'); } catch (_) { el.value += t; }
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    }
    try {
      const r = doc.caretRangeFromPoint && doc.caretRangeFromPoint(x, y);
      if (r && el.contains(r.startContainer)) { const s = doc.getSelection(); s.removeAllRanges(); s.addRange(r); }
    } catch (_) {}
    return doc.execCommand('insertText', false, parole);
  }

  // Un riquadro incorporato (i commenti di un blog, un editor in un frame): il suo campo lo trova il frame di dentro.
  // Qui si dice al main in quale riquadro e in quale punto del suo contenuto; la scheda gliela porta il main, mai noi.
  let riquadroOra = null;
  function riquadroSotto(doc, x, y) {
    if (!campiDelSito) return null;
    const el = elementoSotto(doc, x, y);
    return el && /^(IFRAME|FRAME)$/.test(el.tagName) ? el : null;
  }
  function inoltra(doc, fr, fase, x, y) {
    let dx = 0;
    let dy = 0;
    try {
      const r = fr.getBoundingClientRect();
      const cs = getComputedStyle(fr);
      dx = r.left + fr.clientLeft + (parseFloat(cs.paddingLeft) || 0);
      dy = r.top + fr.clientTop + (parseFloat(cs.paddingTop) || 0);
    } catch (_) {}
    try {
      const rt = global.chrome && global.chrome.runtime;
      const tipo = (global.SN_MSG && global.SN_MSG.MSG && global.SN_MSG.MSG.SCHEDA_NEL_RIQUADRO) || 'scheda_nel_riquadro';
      const p = rt && rt.sendMessage({
        type: tipo, fase, x: Math.round(x - dx), y: Math.round(y - dy),
        indice: [...doc.querySelectorAll('iframe, frame')].indexOf(fr), src: String(fr.src || ''),
      });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) {}
  }

  // msg: { fase: 'sopra' | 'lascia' | 'esci', x, y, scheda: { id, titolo, url, icona } }
  function ricevi(msg, doc = global.document) {
    if (!msg || !doc) return false;
    const x = Number(msg.x);
    const y = Number(msg.y);
    const S = global.SN_SCHEDE_IN_CHAT;
    const scheda = S ? S.normalizza(msg.scheda) : null;
    const b = msg.fase === 'esci' || !scheda || !Number.isFinite(x) || !Number.isFinite(y) ? null : bersaglio(doc, x, y);
    console.log('[dbg] ricevi', msg.fase, x, y, !!b, campiDelSito, location.href);
    const fr = b || msg.fase === 'esci' || !scheda || !Number.isFinite(x) || !Number.isFinite(y) ? null : riquadroSotto(doc, x, y);
    if (riquadroOra && riquadroOra !== fr) { inoltra(doc, riquadroOra, 'esci', 0, 0); riquadroOra = null; }
    if (fr && (msg.fase === 'sopra' || msg.fase === 'lascia')) {
      illumina(doc, null);
      ora = null;
      inoltra(doc, fr, msg.fase, x, y);
      riquadroOra = msg.fase === 'sopra' ? fr : null;
      return true;
    }
    if (msg.fase === 'sopra') {
      if (!b || !ora || b.el !== ora.el) illumina(doc, b && b.el);
      else illumina(doc, b.el);
      ora = b;
      return !!b;
    }
    illumina(doc, null);
    ora = null;
    if (msg.fase !== 'lascia' || !b) return false;
    if (b.chat) { try { return b.chat.prendi(scheda) !== false; } catch (_) { return false; } }
    return scriviNelCampo(doc, b.campo, x, y, scheda);
  }

  function ascolta(opzioni = {}) {
    if (opzioni.campi === true) campiDelSito = true;
    if (inAscolto) return;
    const rt = global.chrome && global.chrome.runtime;
    if (!rt || !rt.onMessage) return;
    inAscolto = true;
    const tipo = (global.SN_MSG && global.SN_MSG.MSG && global.SN_MSG.MSG.SCHEDA_TRASCINATA) || 'scheda_trascinata';
    rt.onMessage.addListener((msg) => { if (msg && msg.type === tipo) ricevi(msg); });
  }

  // `area`: l'elemento che prende il rilascio (il campo della chat o il suo modulo); `prendi(scheda)` lo riceve.
  function registraChat(area, prendi) {
    if (!area || typeof prendi !== 'function') return () => {};
    const voce = { area, prendi };
    chats.add(voce);
    ascolta();
    return () => chats.delete(voce);
  }

  global.SN_SCHEDA_TRASCINATA = { ricevi, ascolta, registraChat };
})(typeof globalThis !== 'undefined' ? globalThis : self);
