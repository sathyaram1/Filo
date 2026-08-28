// Rilevamento siti pericolosi — interfaccia (content script).
//
// Vive sulle pagine web esterne (page-preload.js). Riceve il verdetto dal main
// process (services/safebrowse) e disegna:
//   - "pericoloso" → interstitial a pagina piena che BLOCCA l'interazione.
//     Per proseguire l'utente deve scrivere "confermo" e premere "Procedi".
//   - "sospetto"   → popup di conferma centrato che blocca l'interazione: per
//     restare l'utente sceglie "Continua" (conferma), altrimenti "Torna indietro".
//   - "safe"       → rimuove qualsiasi avviso.
//
// NON blocca mai la navigazione: la pagina carica normalmente, l'avviso la
// copre. Il verdetto può cambiare in corsa (segnali di rete asincroni): il main
// fa broadcast SAFEBROWSE_UPDATE e qui ridisegniamo.
//
// Tutti gli stili sono applicati via proprietà inline (CSSOM), non via <style>
// o <link>: così l'avviso appare anche sotto le CSP più rigide e non è
// influenzato dal CSS della pagina (vive in uno Shadow DOM isolato).

(function (global) {
  'use strict';

  const MSG = (global.SN_MSG && global.SN_MSG.MSG) || {};
  const T_GET = MSG.SAFEBROWSE_GET || 'safebrowse_get';
  const T_PROCEED = MSG.SAFEBROWSE_PROCEED || 'safebrowse_proceed';
  const T_DISMISS = MSG.SAFEBROWSE_DISMISS || 'safebrowse_dismiss';
  const T_UPDATE = MSG.SAFEBROWSE_UPDATE || 'safebrowse_update';

  const HOST_ID = 'filo-safebrowse-host';
  let host = null;        // elemento host dello shadow root
  let shadow = null;
  let currentLevel = 'safe';

  const chrome = global.chrome;
  function send(msg, cb) {
    try { chrome.runtime.sendMessage(msg, cb); } catch (_) { if (cb) cb(null); }
  }

  function css(el, obj) { try { Object.assign(el.style, obj); } catch (_) {} }

  // Indizi di pagina: la presenza di campi sensibili alza la gravità lato motore.
  function pageHints() {
    let hasPassword = false, hasPayment = false;
    try { hasPassword = !!document.querySelector('input[type="password"]'); } catch (_) {}
    try {
      hasPayment = !!document.querySelector(
        'input[autocomplete*="cc-"], input[autocomplete="cc-number"], input[name*="card" i], input[name*="cardnumber" i]'
      );
    } catch (_) {}
    return { hasPassword, hasPayment };
  }

  function sameHost(a, b) {
    try { return new URL(a).host === new URL(b).host; } catch (_) { return true; }
  }

  function ensureHost() {
    if (host && document.documentElement.contains(host)) return;
    host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      global.SN_FILO_UI?.mark(host);
      css(host, { all: 'initial' });
      shadow = host.attachShadow({ mode: 'open' });
      (document.documentElement || document.body).appendChild(host);
    } else if (!shadow) {
      shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
    }
  }

  function clear() {
    currentLevel = 'safe';
    if (shadow) { try { shadow.replaceChildren(); } catch (_) { shadow.innerHTML = ''; } }
    if (host) { css(host, { pointerEvents: 'none' }); }
  }

  function mkButton(label, primary) {
    const b = document.createElement('button');
    b.textContent = label;
    css(b, {
      font: '600 15px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      padding: '10px 18px',
      border: 'none',
      borderRadius: '8px',
      cursor: 'pointer',
      color: primary ? '#fff' : '#b91c1c',
      background: primary ? '#b91c1c' : 'transparent',
      boxShadow: primary ? 'none' : 'inset 0 0 0 1.5px #b91c1c',
      transition: 'opacity .15s ease',
    });
    return b;
  }

  // ── Interstitial "pericoloso" (blocca l'interazione) ──────────────────────
  function renderDanger(url, message) {
    ensureHost();
    shadow.replaceChildren();
    css(host, { pointerEvents: 'auto' });

    const overlay = document.createElement('div');
    css(overlay, {
      position: 'fixed', inset: '0', zIndex: '2147483647',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px', boxSizing: 'border-box',
      background: 'rgba(40, 6, 6, 0.92)',
      backdropFilter: 'blur(4px)',
      font: '15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
    });

    const card = document.createElement('div');
    css(card, {
      maxWidth: '520px', width: '100%', boxSizing: 'border-box',
      background: '#fff', color: '#1a1a1a',
      borderRadius: '16px', padding: '28px 28px 24px',
      boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
      textAlign: 'center',
    });

    const icon = document.createElement('div');
    icon.textContent = '⚠️';
    css(icon, { fontSize: '46px', lineHeight: '1', marginBottom: '12px' });

    const title = document.createElement('div');
    title.textContent = (message && message.title) || 'Sito pericoloso';
    css(title, { font: '700 22px/1.25 inherit', color: '#b91c1c', marginBottom: '10px' });

    const body = document.createElement('div');
    body.textContent = (message && message.body) || 'Questo sito potrebbe essere una truffa o tentare di rubare i tuoi dati.';
    css(body, { fontSize: '15.5px', color: '#374151', marginBottom: '22px' });

    const hint = document.createElement('div');
    hint.textContent = 'Se sai cosa stai facendo, scrivi "confermo" per continuare.';
    css(hint, { fontSize: '13px', color: '#6b7280', marginBottom: '8px' });

    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.placeholder = 'confermo';
    css(input, {
      font: '15px/1.2 inherit', textAlign: 'center',
      width: '180px', padding: '9px 10px', marginBottom: '18px',
      border: '1.5px solid #d1d5db', borderRadius: '8px', outline: 'none',
      boxSizing: 'border-box', color: '#1a1a1a', background: '#fff',
    });

    const row = document.createElement('div');
    css(row, { display: 'flex', gap: '10px', justifyContent: 'center' });

    const back = mkButton('Torna indietro', false);
    const proceed = mkButton('Procedi comunque', true);
    css(proceed, { opacity: '0.45', pointerEvents: 'none' });

    const sync = () => {
      const ok = input.value.trim().toLowerCase() === 'confermo';
      css(proceed, { opacity: ok ? '1' : '0.45', pointerEvents: ok ? 'auto' : 'none' });
    };
    input.addEventListener('input', sync);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim().toLowerCase() === 'confermo') {
        e.preventDefault(); doProceed();
      }
    });

    const doProceed = () => { send({ type: T_PROCEED, url }); clear(); };
    proceed.addEventListener('click', doProceed);
    back.addEventListener('click', () => {
      // "Torna indietro" NON deve MAI confermare il sito pericoloso. Se c'è una
      // pagina precedente ci torniamo; se la scheda è nuova (nessuna cronologia)
      // usciamo e basta, SENZA inviare T_PROCEED (che registrerebbe il bypass,
      // trattando l'uscita come "confermo" → "Procedi comunque").
      try { if (history.length > 1) history.back(); else location.replace('about:blank'); }
      catch (_) {}
    });

    row.appendChild(back); row.appendChild(proceed);
    card.appendChild(icon); card.appendChild(title); card.appendChild(body);
    card.appendChild(hint); card.appendChild(input); card.appendChild(row);
    overlay.appendChild(card);
    shadow.appendChild(overlay);
    try { input.focus(); } catch (_) {}
  }

  // ── Popup "sospetto" (richiede conferma) ──────────────────────────────────
  // #176 — l'utente vuole che il sito sospetto compaia con un popup di conferma
  // (come gli altri popup di Filo), non con una striscia passiva chiudibile con
  // "Ho capito" che si può ignorare. Il popup BLOCCA l'interazione finché non si
  // sceglie: "Torna indietro" (lascia il sito) o "Continua" (conferma esplicita
  // di voler restare). Meno severo dell'interstitial "pericoloso" (niente parola
  // da digitare), ma comunque una scelta attiva, non un avviso ignorabile.
  function renderSuspect(url, message) {
    ensureHost();
    shadow.replaceChildren();
    css(host, { pointerEvents: 'auto' });

    const overlay = document.createElement('div');
    css(overlay, {
      position: 'fixed', inset: '0', zIndex: '2147483647',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px', boxSizing: 'border-box',
      background: 'rgba(40, 20, 6, 0.78)',
      backdropFilter: 'blur(3px)',
      font: '15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
    });

    const card = document.createElement('div');
    css(card, {
      maxWidth: '480px', width: '100%', boxSizing: 'border-box',
      background: '#fff', color: '#1a1a1a',
      borderRadius: '16px', padding: '28px 28px 24px',
      boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
      textAlign: 'center',
    });

    const icon = document.createElement('div');
    icon.textContent = '⚠️';
    css(icon, { fontSize: '42px', lineHeight: '1', marginBottom: '12px' });

    const title = document.createElement('div');
    title.textContent = (message && message.title) || 'Sito potenzialmente sospetto';
    css(title, { font: '700 21px/1.25 inherit', color: '#9a3412', marginBottom: '10px' });

    const body = document.createElement('div');
    body.textContent = (message && message.body) || 'Questo sito ha alcune caratteristiche sospette. Fai attenzione ai dati che inserisci.';
    css(body, { fontSize: '15px', color: '#374151', marginBottom: '22px' });

    const row = document.createElement('div');
    css(row, { display: 'flex', gap: '10px', justifyContent: 'center' });

    const back = mkButton('Torna indietro', false);
    css(back, { color: '#9a3412', boxShadow: 'inset 0 0 0 1.5px #9a3412' });
    const proceed = mkButton('Continua', true);
    css(proceed, { background: '#9a3412' });

    const doProceed = () => { send({ type: T_DISMISS, url }); clear(); };
    proceed.addEventListener('click', doProceed);
    back.addEventListener('click', () => {
      try { if (history.length > 1) history.back(); else send({ type: T_DISMISS, url }, () => location.replace('about:blank')); }
      catch (_) {}
    });

    row.appendChild(back); row.appendChild(proceed);
    card.appendChild(icon); card.appendChild(title); card.appendChild(body); card.appendChild(row);
    overlay.appendChild(card);
    shadow.appendChild(overlay);
    try { proceed.focus(); } catch (_) {}
  }

  function render(level, message, url) {
    const u = url || location.href;
    if (level === 'pericoloso') { currentLevel = level; renderDanger(u, message); }
    else if (level === 'sospetto') { currentLevel = level; renderSuspect(u, message); }
    else clear();
  }

  function requestVerdict() {
    const hints = pageHints();
    send({ type: T_GET, url: location.href, hasPassword: hints.hasPassword, hasPayment: hints.hasPayment }, (r) => {
      if (r && r.ok) render(r.level, r.message);
    });
  }

  // Broadcast dal main: il verdetto per la URL è cambiato.
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== T_UPDATE) return;
      if (msg.url && !sameHost(msg.url, location.href)) return;
      render(msg.level, msg.message, msg.url);
    });
  } catch (_) {}

  function start() {
    requestVerdict();
    // Ricontrolla dopo un attimo: alcuni siti montano i campi password/pagamento
    // via JS dopo il primo paint, alzando la gravità del verdetto.
    setTimeout(() => { if (currentLevel === 'safe') requestVerdict(); }, 1600);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  global.SN_SAFEBROWSE_UI = { render, requestVerdict, clear, _state: () => currentLevel };
})(typeof globalThis !== 'undefined' ? globalThis : self);
