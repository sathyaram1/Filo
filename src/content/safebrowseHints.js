// Indizi di pagina per il rilevamento siti pericolosi: la pagina chiede una password o i dati di pagamento?
// Autonoma di proposito, senza niente di esterno: il main la esegue anche nei riquadri incorporati, dal sorgente.
// Un modulo ospitato non ha campi password né di carta: cosa chiede un campo di testo lo dice la sua etichetta.

'use strict';

function pageHints(doc) {
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
  // delicato un sito (#1004) né un sosia (#728), comunque lo si nasconda. Una regola sola: un pezzo del campo resta
  // dopo i ritagli di tutti i contenitori e dello schermo raggiungibile, e né lui né un contenitore è trasparente.
  // Senza motore di disegno (un documento finto) non si sa, e vale mostrato.
  const mostrato = (el) => {
    try {
      if (!el || typeof el.getClientRects !== 'function') return true;
      if (!el.getClientRects().length) return false;
      const w = doc.defaultView;
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
      const radice = doc.documentElement;
      for (let n = el; n && pos !== 'fixed';) {
        const rn = n.getRootNode ? n.getRootNode() : null;
        const p = n.assignedSlot || n.parentElement || (rn && rn.host) || null;
        if (!p || p === radice || p === doc.body) break;
        const sp = stile(p);
        n = p;
        if (!sp) continue;
        const posizionato = sp.position !== 'static' || (sp.transform && sp.transform !== 'none');
        if (pos === 'absolute' && !posizionato) continue;
        pos = sp.position || 'static';
        if (/hidden|clip|scroll|auto/.test(`${sp.overflowX} ${sp.overflowY}`) || (sp.clip && sp.clip.startsWith('rect('))) ritaglia(p.getBoundingClientRect());
      }
      if (w && typeof w.innerWidth === 'number') {
        const vw = w.innerWidth;
        const vh = w.innerHeight;
        if (pos === 'fixed') ritaglia({ left: 0, top: 0, right: vw, bottom: vh });
        else {
          // Sotto la piega si arriva scorrendo; oltre un bordo che non scorre no.
          const sr = [stile(radice), doc.body && stile(doc.body)].filter(Boolean);
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
      return x1 - x0 >= 2 && y1 - y0 >= 2;
    } catch (_) { return true; }
  };
  // Un modulo dentro un componente incapsulato (shadow DOM aperto) è un modulo della pagina come gli altri.
  const radici = [doc];
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
  let shownPassword = hasPassword && tutti('input[type="password"]').some(mostrato);
  let shownPayment = hasPayment && tutti(PAGAMENTO).some(mostrato);
  if (!shownPassword || !shownPayment) {
    try {
      for (const el of tutti(CAMPI)) {
        const testo = etichetta(el);
        const pw = PASSWORD.test(testo);
        const carta = CARTA.test(testo);
        if (pw) hasPassword = true;
        if (carta) hasPayment = true;
        if ((pw && !shownPassword) || (carta && !shownPayment)) {
          const si = mostrato(el);
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
