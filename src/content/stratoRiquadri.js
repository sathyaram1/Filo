// Lo strato dei riquadri sopra un sito (#1509.1), lato disegno: apre il riquadro che il content script della pagina ha
// chiesto, dice al main cosa c'è aperto (posa e tastiera) e rigira alla pagina i gesti del vuoto. Gira solo lì.
// Regole: patterns/i-riquadri-di-filo-su-un-sito-stanno-sopra-la-scheda.md

(function (global) {
  'use strict';

  const S = global.SN_STRATO_RIQUADRI;
  if (!S) return;
  const RADICI = '.sn-fb-overlay, .sn-editbox-overlay, .sn-rt-overlay, .sn-popup, .sn-sidebar';
  const MODALI = '.sn-fb-overlay, .sn-editbox-overlay, .sn-rt-overlay';

  // La pagina sotto, per il feedback e le bozze: la manda il main con ogni apertura.
  global.SN_PAGINA_SOTTO = S.pagina || null;

  // Le misure arrivano al documento un attimo dopo che il main le ha date alla vista: il riquadro le aspetta.
  function misure(m) {
    return new Promise((fatto) => {
      if (!m) { fatto(); return; }
      const fine = Date.now() + 1000;
      const guarda = () => {
        if ((innerWidth === m.w && innerHeight === m.h) || Date.now() > fine) fatto();
        else requestAnimationFrame(guarda);
      };
      guarda();
    });
  }

  S.onApri((d) => {
    if (!d || typeof d !== 'object') return;
    misure(d.misura).then(() => apri(d));
  });

  function apri(d) {
    if (d.pagina) global.SN_PAGINA_SOTTO = d.pagina;
    const dati = d.dati || {};
    if (d.tipo === 'feedback') global.SN_FEEDBACK_UI?.open({ testo: String(dati.testo || '') });
    else if (d.tipo === 'redteam') global.SN_REDTEAM_ATTACK_UI?.open();
    else if (d.tipo === 'modifica') {
      global.SN_EDITBOX?.openEditBox(String(dati.testo || ''), {
        sostituisci: (testo) => S.inPagina({ id: d.id, cosa: 'sostituisci', testo: String(testo) }),
      });
    } else if (d.tipo === 'risposta') {
      global.SN_POPUP?.openStreaming({
        action: dati.action, payload: dati.payload || {}, anchor: dati.anchor || undefined, title: dati.title || '',
      });
    }
    riferisci();
  }

  // Esc premuto sulla pagina: si chiude il riquadro più in alto, come se il tasto fosse arrivato qui.
  S.onEsc(() => {
    const radici = [...document.querySelectorAll(RADICI)].filter(visibile);
    if (!radici.length) return;
    const z = (el) => Number.parseInt(getComputedStyle(el).zIndex, 10) || 0;
    const cima = radici.reduce((a, b) => (z(b) >= z(a) ? b : a));
    const bersaglio = cima.contains(document.activeElement) ? document.activeElement : cima;
    bersaglio.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, composed: true, cancelable: true }));
  });

  function visibile(el) {
    if (!el || !el.isConnected) return false;
    try { if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true })) return false; } catch (_) {}
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // Disegnato da noi e a schermo: un pezzo in cima al documento, o qualcosa dentro di lui (la pila degli avvisi).
  function aSchermo(el) {
    if (visibile(el)) return true;
    for (const c of el.querySelectorAll('*')) if (visibile(c)) return true;
    return false;
  }

  let detto = '';
  function riferisci() {
    const pezzi = [...document.documentElement.children].filter((el) => el !== document.head && el !== document.body);
    const aperti = pezzi.filter(aSchermo).length;
    const riquadri = [...document.querySelectorAll(RADICI)].filter(visibile).length;
    const modale = [...document.querySelectorAll(MODALI)].some(visibile);
    const firma = `${aperti}|${riquadri}|${modale}`;
    if (firma === detto) return;
    detto = firma;
    S.stato({ aperti, riquadri, modale });
  }
  let inCoda = false;
  const presto = () => {
    if (inCoda) return;
    inCoda = true;
    requestAnimationFrame(() => { inCoda = false; riferisci(); });
  };
  new MutationObserver(presto).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
  // Un'animazione che finisce (la chiusura di un avviso) non muta niente: si ricontrolla anche dopo.
  document.addEventListener('animationend', presto, true);
  document.addEventListener('transitionend', presto, true);

  // Fuori dai riquadri lo strato è della pagina sotto: clic, rotella e trascinamenti le tornano (src/renderer/vuoto.js).
  try {
    require('../renderer/vuoto.js');
    const V = global.SN_VUOTO || (global.window && global.window.SN_VUOTO);
    V?.collega({
      inoltra: (g) => S.inoltra(g),
      onCursore: (fn) => S.onCursore(fn),
      // Alla pagina sotto torna solo un gesto vero: i suoi clic sono veri anche per lei.
      proprio: (e) => {
        if (!e.isTrusted || document.querySelector(MODALI)) return true;
        const t = e.target;
        return !!t && t !== document.documentElement && t !== document.body;
      },
      versoLaPagina: () => false,
    });
  } catch (e) { console.error('[Filo riquadri] vuoto', e); }

  riferisci();
})(typeof globalThis !== 'undefined' ? globalThis : self);
