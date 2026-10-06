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
  // Mostrato = a schermo, anche sotto la piega: un modulo di accesso tenuto pronto e nascosto non rende delicato un
  // sito (#1004). Senza motore di disegno (un documento finto) non si sa, e vale mostrato.
  const mostrato = (el) => {
    try {
      if (!el || typeof el.getClientRects !== 'function') return true;
      if (!el.getClientRects().length) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const w = doc.defaultView;
      const st = w && w.getComputedStyle ? w.getComputedStyle(el) : null;
      if (st && (st.visibility === 'hidden' || st.visibility === 'collapse' || Number(st.opacity) === 0)) return false;
      return r.right + ((w && w.scrollX) || 0) > 0 && r.bottom + ((w && w.scrollY) || 0) > 0;
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
