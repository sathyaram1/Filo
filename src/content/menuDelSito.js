// La voce «Menu di <sito>» in cima al tasto destro e il sito dove il tasto destro apre il menu del sito (#975).
// La sonda e il passaggio del clic stanno nel page-preload (src/preload/menu-del-sito.js), conti e proposta nel main
// (src/main/services/menuDelSito.js). Regole: patterns/il-menu-del-sito-e-una-voce-di-filo.md.

(function (global) {
  'use strict';

  const MSG = (global.SN_MSG && global.SN_MSG.MSG) || {};
  const IS_SUBFRAME = (() => { try { return window.top !== window.self; } catch (_) { return true; } })();
  const chrome = global.chrome;
  const ponte = () => global.__snMenuDelSito || null;
  const NOME_MAX = 40;

  function ask(msg) {
    return new Promise((resolve) => {
      try { chrome.runtime.sendMessage(msg, (r) => resolve(r || null)); } catch (_) { resolve(null); }
    });
  }
  function t(key, ...args) {
    const I = global.SN_I18N;
    return I ? I.t(key, ...args) : key;
  }
  function web() {
    try { return /^https?:$/.test(location.protocol); } catch (_) { return false; }
  }

  function dentro(elenco) {
    const h = String(location.hostname || '').toLowerCase();
    return !!h && elenco.some((d) => typeof d === 'string' && d && (h === d || h.endsWith(`.${d}`)));
  }

  function allinea(settings) {
    const p = ponte();
    if (!p) return;
    const elenco = settings && Array.isArray(settings.menuDelSito) ? settings.menuDelSito : [];
    p.primo = web() && dentro(elenco);
  }

  // Il nome che il sito si dà; se manca o è troppo lungo per una voce, l'indirizzo.
  function nome() {
    const meta = (sel) => { try { return document.querySelector(sel)?.getAttribute('content') || ''; } catch (_) { return ''; } };
    for (const sel of ['meta[property="og:site_name"]', 'meta[name="application-name"]']) {
      const n = meta(sel).replace(/\s+/g, ' ').trim();
      if (n && n.length <= NOME_MAX) return n;
    }
    return String(location.hostname || '').replace(/^www\./i, '');
  }

  // All'inizio del tasto destro, prima di ogni attesa: dopo, il percorso dell'evento è vuoto.
  function sonda(e, bersaglio) {
    const p = ponte();
    if (!p || !e || !web()) return null;
    const s = { primo: p.primo === true, x: e.clientX, y: e.clientY, screenX: e.screenX, screenY: e.screenY, bersaglio };
    if (s.primo) return s;
    return p.sonda(e, bersaglio) ? s : null;
  }

  // In un riquadro il clic vero del main non arriva: la pagina del riquadro riceve il tasto destro da qui.
  function clicNelRiquadro(s) {
    const b = s.bersaglio;
    if (!b || !b.isConnected || typeof b.dispatchEvent !== 'function') return;
    const Ev = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
    try {
      b.dispatchEvent(new Ev('contextmenu', {
        bubbles: true, cancelable: true, composed: true, view: window, button: 2,
        clientX: s.x, clientY: s.y, screenX: s.screenX, screenY: s.screenY, pointerType: 'mouse', isPrimary: true,
      }));
    } catch (_) {}
  }

  function apri(s) {
    const p = ponte();
    if (!p) return;
    if (!IS_SUBFRAME) p.lasciaAlSito();
    ask({ type: MSG.MENU_DEL_SITO_APRI, x: s.x, y: s.y }).then((r) => {
      if (r && r.ok && r.cliccato) return;
      p.passaAlSito();
      clicNelRiquadro(s);
    });
  }

  function cambia(primo, n) {
    ask({ type: MSG.MENU_DEL_SITO_CAMBIA, primo }).then((r) => {
      if (!r || !r.ok) return;
      const testo = primo ? t('menu_del_sito_fatto', n) : t('menu_del_sito_tolto', n);
      try { global.SN_POPUP?.showToast?.(testo); } catch (_) {}
    });
  }

  // In cima al menu di Filo. In incognito la scelta non si salva, quindi c'è solo la voce.
  function voci(s, { incognito = false } = {}) {
    if (!s) return [];
    const n = nome();
    const voce = { label: t('menu_del_sito', n), onClick: () => apri(s) };
    if (s.primo) {
      return [{
        type: 'split', ...voce, arrowTitle: t('menu_del_sito_freccia'),
        subItems: [{ label: t('menu_del_sito_togli'), onClick: () => cambia(false, n) }],
      }, { type: 'separator' }];
    }
    if (incognito) return [{ type: 'item', ...voce }, { type: 'separator' }];
    return [{
      type: 'split', ...voce, arrowTitle: t('menu_del_sito_freccia'),
      subItems: [
        { label: t('menu_del_sito_sempre'), onClick: () => cambia(true, n) },
        { type: 'info', label: t('menu_del_sito_filo_dopo') },
      ],
    }, { type: 'separator' }];
  }

  global.SN_MENU_DEL_SITO = { allinea, sonda, voci, nome };
})(typeof globalThis !== 'undefined' ? globalThis : self);
