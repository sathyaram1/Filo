// Indizi di pagina per il rilevamento siti pericolosi: la pagina chiede una password o i dati di pagamento?
// Autonoma di proposito, senza niente di esterno: il main la esegue anche nei riquadri incorporati, dal sorgente.
// Un modulo ospitato non ha campi password né di carta: cosa chiede un campo di testo lo dice la sua etichetta.

'use strict';

function pageHints(doc, opz) {
  const PASSWORD = /pass ?word|passwort|contrase[ñn]a|mot de passe|\bsenha\b|parola d.ordine|passcode|\bpin\b/i;
  const CARTA = new RegExp(['carta di (credito|debito)', 'numero (della |di )?carta', 'credit ?card', 'debit ?card',
    'card ?number', 'n[uú]mero de (la )?tarjeta', 'tarjeta de (cr[eé]dito|d[eé]bito)', 'num[eé]ro de (la )?carte',
    'carte (bancaire|de cr[eé]dit)', 'kartennummer', 'kreditkarte', '\\bcvv2?\\b', '\\bcvc2?\\b',
    'codice di sicurezza', 'security code'].join('|'), 'i');
  const CAMPI = 'input:not([type]),input[type="text"],input[type="email"],input[type="tel"],input[type="number"],'
    + 'input[type="password"],textarea';
  const PAGAMENTO = 'input[autocomplete*="cc-"], input[name*="card" i], input[name*="cardnumber" i]';
  const etichetta = (el) => {
    const parti = [el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('name'),
      el.getAttribute('title')];
    try { for (const l of el.labels || []) parti.push(l.textContent); } catch (_) {}
    const radice = el.getRootNode && el.getRootNode().getElementById ? el.getRootNode() : doc;
    for (const id of String(el.getAttribute('aria-labelledby') || '').split(/\s+/)) {
      const t = id && radice.getElementById(id);
      if (t) parti.push(t.textContent);
    }
    return parti.filter(Boolean).join(' ');
  };
  // Mostrato = l'utente lo vede, o lo vede scorrendo la pagina: un modulo di accesso tenuto pronto e nascosto non rende
  // delicato un sito (#1004) né un sosia (#728), comunque lo si nasconda. Dove il campo cade nello schermo lo dice il
  // motore (si chiede cosa c'è in quel punto: ritagli di ogni forma inclusi); fuori dallo schermo, le misure dei
  // contenitori. Un riquadro conta se è mostrato anche il riquadro nella pagina che lo contiene.
  // Senza motore di disegno (un documento finto) non si sa, e vale mostrato.
  const mostratoIn = (el, d, profondita) => {
    try {
      if (!el || typeof el.getClientRects !== 'function') return true;
      if (!el.getClientRects().length) return false;
      const w = d.defaultView;
      const stile = (n) => (w && w.getComputedStyle ? w.getComputedStyle(n) : null);
      if (typeof el.checkVisibility === 'function'
        && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
      const r = el.getBoundingClientRect();
      let [x0, y0, x1, y1] = [r.left, r.top, r.right, r.bottom];
      const st = stile(el);
      if (st && (st.visibility === 'hidden' || st.visibility === 'collapse' || Number(st.opacity) === 0)) return false;
      const ritaglia = (b) => { x0 = Math.max(x0, b.left); y0 = Math.max(y0, b.top); x1 = Math.min(x1, b.right); y1 = Math.min(y1, b.bottom); };
      // Si sale lungo l'albero disegnato (anche fuori dai componenti incapsulati): ritaglia solo il contenitore che fa
      // da riferimento alla posizione del campo, come fa il motore.
      let pos = (st && st.position) || 'static';
      const radice = d.documentElement;
      for (let n = el; n && pos !== 'fixed';) {
        const rn = n.getRootNode ? n.getRootNode() : null;
        const p = n.assignedSlot || n.parentElement || (rn && rn.host) || null;
        if (!p || p === radice || p === d.body) break;
        const sp = stile(p);
        n = p;
        if (!sp) continue;
        const posizionato = sp.position !== 'static' || (sp.transform && sp.transform !== 'none');
        if (pos === 'absolute' && !posizionato) continue;
        pos = sp.position || 'static';
        if (/hidden|clip|scroll|auto/.test(`${sp.overflowX} ${sp.overflowY}`) || (sp.clip && sp.clip.startsWith('rect('))) ritaglia(p.getBoundingClientRect());
      }
      const vw = w && typeof w.innerWidth === 'number' ? w.innerWidth : 0;
      const vh = w && typeof w.innerHeight === 'number' ? w.innerHeight : 0;
      if (w && typeof w.innerWidth === 'number') {
        if (pos === 'fixed') ritaglia({ left: 0, top: 0, right: vw, bottom: vh });
        else {
          // Sotto la piega si arriva scorrendo; oltre un bordo che non scorre no.
          const sr = [stile(radice), d.body && stile(d.body)].filter(Boolean);
          const ferma = (asse) => sr.some((s) => /hidden|clip/.test(s[asse]));
          const sx = w.scrollX || 0;
          const sy = w.scrollY || 0;
          ritaglia({
            left: -sx, top: -sy,
            right: ferma('overflowX') ? vw : Math.max(vw, (radice && radice.scrollWidth) || 0) - sx,
            bottom: ferma('overflowY') ? vh : Math.max(vh, (radice && radice.scrollHeight) || 0) - sy,
          });
        }
      } else {
        const sx = (w && w.scrollX) || 0;
        const sy = (w && w.scrollY) || 0;
        ritaglia({ left: -sx, top: -sy, right: Infinity, bottom: Infinity });
      }
      if (!(x1 - x0 >= 2 && y1 - y0 >= 2)) return false;
      // La parte che cade nello schermo: c'è il campo, in quel punto, per il motore?
      const sx0 = Math.max(x0, 0); const sy0 = Math.max(y0, 0);
      const sx1 = Math.min(x1, vw); const sy1 = Math.min(y1, vh);
      const rp = el.getRootNode ? el.getRootNode() : d;
      const sonda = rp && typeof rp.elementsFromPoint === 'function' ? rp : (typeof d.elementsFromPoint === 'function' ? d : null);
      // Un campo che non prende il puntatore il motore non lo trova in nessun punto: lì valgono le misure.
      if (sonda && sx1 - sx0 >= 2 && sy1 - sy0 >= 2 && !(st && st.pointerEvents === 'none')) {
        const mx = (sx0 + sx1) / 2; const my = (sy0 + sy1) / 2;
        const punti = [[mx, my], [sx0 + 1, sy0 + 1], [sx1 - 1, sy0 + 1], [sx0 + 1, sy1 - 1], [sx1 - 1, sy1 - 1]];
        if (!punti.some(([px, py]) => { try { return sonda.elementsFromPoint(px, py).includes(el); } catch (_) { return true; } })) return false;
      }
      // Il riquadro che contiene questo documento, nella pagina sopra (se la si può guardare).
      let fe = null;
      try { fe = w && w.frameElement; } catch (_) { fe = null; }
      if (fe && fe.ownerDocument && (profondita || 0) < 10) return mostratoIn(fe, fe.ownerDocument, (profondita || 0) + 1);
      return true;
    } catch (_) { return true; }
  };
  // opz.mostrati raccoglie i campi mostrati per chi deve guardarli ancora (un riquadro di un altro sito).
  const mostrato = (tipo) => (el) => {
    const si = mostratoIn(el, doc, 0);
    if (si && opz && Array.isArray(opz.mostrati)) opz.mostrati.push({ el, tipo });
    return si;
  };
  // Un modulo dentro un componente incapsulato (shadow DOM aperto) è un modulo della pagina come gli altri. Quelli
  // chiusi nessuno script li vede: li passa il main, che li trova col protocollo di debug (opz.radici).
  const radici = opz && Array.isArray(opz.radici) ? opz.radici.slice() : [doc];
  for (let i = 0; i < radici.length; i++) {
    try { for (const el of radici[i].querySelectorAll('*')) if (el.shadowRoot) radici.push(el.shadowRoot); } catch (_) {}
  }
  const tutti = (sel) => {
    const out = [];
    for (const r of radici) { try { out.push(...r.querySelectorAll(sel)); } catch (_) {} }
    return out;
  };
  const almenoUno = (sel) => radici.some((r) => { try { return !!r.querySelector(sel); } catch (_) { return false; } });
  let hasPassword = almenoUno('input[type="password"]');
  let hasPayment = almenoUno(PAGAMENTO);
  let shownPassword = hasPassword && tutti('input[type="password"]').some(mostrato('pw'));
  let shownPayment = hasPayment && tutti(PAGAMENTO).some(mostrato('carta'));
  if (!shownPassword || !shownPayment) {
    try {
      for (const el of tutti(CAMPI)) {
        const testo = etichetta(el);
        const pw = PASSWORD.test(testo);
        const carta = CARTA.test(testo);
        if (pw) hasPassword = true;
        if (carta) hasPayment = true;
        if ((pw && !shownPassword) || (carta && !shownPayment)) {
          const si = mostrato(pw ? 'pw' : 'carta')(el);
          if (pw && si) shownPassword = true;
          if (carta && si) shownPayment = true;
        }
        if (shownPassword && shownPayment) break;
      }
    } catch (_) {}
  }
  return { hasPassword, hasPayment, shownPassword, shownPayment };
}

module.exports = { pageHints };
