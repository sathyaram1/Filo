// Indizi di pagina per il rilevamento siti pericolosi: la pagina chiede una password o i dati di pagamento?
// Autonoma di proposito, senza niente di esterno: il main la esegue anche nei riquadri incorporati, dal sorgente.
// Un modulo ospitato non ha campi password: la password si chiede in un campo di testo, e lo dice la sua etichetta.

'use strict';

function pageHints(doc) {
  const PASSWORD = /pass ?word|passwort|contrase[ñn]a|mot de passe|\bsenha\b|parola d.ordine|passcode|\bpin\b/i;
  const CAMPI = 'input:not([type]),input[type="text"],input[type="email"],input[type="tel"],input[type="number"],textarea';
  const PAGAMENTO = 'input[autocomplete*="cc-"], input[name*="card" i], input[name*="cardnumber" i]';
  const etichetta = (el) => {
    const parti = [el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('name'), el.getAttribute('title')];
    try { for (const l of el.labels || []) parti.push(l.textContent); } catch (_) {}
    for (const id of String(el.getAttribute('aria-labelledby') || '').split(/\s+/)) {
      const t = id && doc.getElementById(id);
      if (t) parti.push(t.textContent);
    }
    return parti.filter(Boolean).join(' ');
  };
  let hasPassword = false, hasPayment = false;
  try { hasPassword = !!doc.querySelector('input[type="password"]'); } catch (_) {}
  if (!hasPassword) {
    try {
      for (const el of doc.querySelectorAll(CAMPI)) {
        if (PASSWORD.test(etichetta(el))) { hasPassword = true; break; }
      }
    } catch (_) {}
  }
  try { hasPayment = !!doc.querySelector(PAGAMENTO); } catch (_) {}
  return { hasPassword, hasPayment };
}

module.exports = { pageHints };
