// Rilevamento siti pericolosi — interfaccia (content script).
//
// Vive sulle pagine web esterne (page-preload.js). Riceve il verdetto dal main
// process (services/safebrowse) e disegna:
//   - "pericoloso" → interstitial a pagina piena che BLOCCA l'interazione.
//     Per proseguire l'utente deve scrivere "confermo" e premere "Procedi".
//   - "sospetto"   → striscia in alto, chiudibile con "Ho capito".
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
      try { if (history.length > 1) history.back(); else send({ type: T_PROCEED, url }, () => location.replace('about:blank')); }
      catch (_) {}
    });

    row.appendChild(back); row.appendChild(proceed);
    card.appendChild(icon); card.appendChild(title); card.appendChild(body);
    card.appendChild(hint); card.appendChild(input); card.appendChild(row);
    overlay.appendChild(card);
    shadow.appendChild(overlay);
    try { input.focus(); } catch (_) {}
  }

  // ── Striscia "sospetto" (chiudibile) ──────────────────────────────────────
  function renderSuspect(url, message) {
    ensureHost();
    shadow.replaceChildren();
    css(host, { pointerEvents: 'none' });

    const bar = document.createElement('div');
    css(bar, {
      position: 'fixed', top: '0', left: '0', right: '0', zIndex: '2147483647',
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '11px 16px', boxSizing: 'border-box',
      background: '#7c2d12', color: '#fff',
      font: '14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
      pointerEvents: 'auto',
    });

    const icon = document.createElement('span');
    icon.textContent = '⚠️';
    css(icon, { fontSize: '18px', flex: '0 0 auto' });

    const txt = document.createElement('span');
    const t = (message && message.title) ? (message.title + ' — ') : '';
    txt.textContent = t + ((message && message.body) || 'Questo sito ha alcune caratteristiche sospette. Fai attenzione ai dati che inserisci.');
    css(txt, { flex: '1 1 auto' });

    const ok = document.createElement('button');
    ok.textContent = 'Ho capito';
    css(ok, {
      flex: '0 0 auto', font: '600 13px/1.2 inherit',
      padding: '7px 14px', border: 'none', borderRadius: '6px', cursor: 'pointer',
      color: '#7c2d12', background: '#fff',
    });
    ok.addEventListener('click', () => { send({ type: T_DISMISS, url }); clear(); });

    bar.appendChild(icon); bar.appendChild(txt); bar.appendChild(ok);
    shadow.appendChild(bar);
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
