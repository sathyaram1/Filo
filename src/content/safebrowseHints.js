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
    for (const id of String(el.getAttribute('aria-labelledby') || '').split(/\s+/)) {
      const t = id && doc.getElementById(id);
      if (t) parti.push(t.textContent);
    }
    return parti.filter(Boolean).join(' ');
  };
  let hasPassword = false, hasPayment = false;
  try { hasPassword = !!doc.querySelector('input[type="password"]'); } catch (_) {}
  try { hasPayment = !!doc.querySelector(PAGAMENTO); } catch (_) {}
  if (!hasPassword || !hasPayment) {
    try {
      for (const el of doc.querySelectorAll(CAMPI)) {
        const testo = etichetta(el);
        if (!hasPassword && PASSWORD.test(testo)) hasPassword = true;
        if (!hasPayment && CARTA.test(testo)) hasPayment = true;
        if (hasPassword && hasPayment) break;
      }
    } catch (_) {}
  }
  return { hasPassword, hasPayment };
}

module.exports = { pageHints };
