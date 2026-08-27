// Proposta inline "Apri da un altro paese" — interfaccia (content script).
// Livello decisionale del geo-block (proxy-per-tab-spec.md §5, feedback #151).
//
// Vive sulle pagine web esterne (page-preload.js). Quando il main rileva un
// contenuto bloccato in Italia su un tab con sessione di login attiva (o dopo che
// i retry automatici sono falliti), NON riprova in silenzio: manda un broadcast
// GEO_PROPOSE e qui disegniamo una striscia discreta che PROPONE di aprire la tab
// da un altro paese, avvertendo che lì l'utente non sarà loggato.
//
// Estetica calda e non allarmistica (spec §3: "non un lucchetto da security
// tool"). Stili inline via CSSOM dentro uno Shadow DOM isolato, così appare anche
// sotto le CSP più rigide e non è influenzato dal CSS della pagina.

(function (global) {
  'use strict';

  const MSG = (global.SN_MSG && global.SN_MSG.MSG) || {};
  const T_PROPOSE = MSG.GEO_PROPOSE || 'geo_propose';
  const T_ACCEPT = MSG.GEO_PROPOSE_ACCEPT || 'geo_propose_accept';
  const T_DISMISS = MSG.GEO_PROPOSE_DISMISS || 'geo_propose_dismiss';

  const HOST_ID = 'filo-geoproposal-host';
  let host = null;
  let shadow = null;

  const chrome = global.chrome;
  function send(msg, cb) {
    try { chrome.runtime.sendMessage(msg, cb); } catch (_) { if (cb) cb(null); }
  }
  function css(el, obj) { try { Object.assign(el.style, obj); } catch (_) {} }

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
    if (shadow) { try { shadow.replaceChildren(); } catch (_) { shadow.innerHTML = ''; } }
  }

  function render(url, country, label) {
    ensureHost();
    shadow.replaceChildren();

    const bar = document.createElement('div');
    css(bar, {
      position: 'fixed', top: '0', left: '0', right: '0', zIndex: '2147483646',
      display: 'flex', alignItems: 'center', gap: '14px',
      padding: '12px 18px', boxSizing: 'border-box',
      // Tinte calde della palette Filo (ambra/terracotta), non rosso-allarme.
      background: 'linear-gradient(180deg, #fff7ed 0%, #ffedd5 100%)',
      color: '#7c2d12',
      borderBottom: '1px solid #fed7aa',
      font: '14px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      boxShadow: '0 4px 16px rgba(124, 45, 18, 0.12)',
    });

    const icon = document.createElement('span');
    icon.textContent = '🌍';
    css(icon, { fontSize: '20px', flex: '0 0 auto' });

    const txt = document.createElement('span');
    css(txt, { flex: '1 1 auto' });
    const strong = document.createElement('strong');
    strong.textContent = 'Questo contenuto è bloccato in Italia. ';
    css(strong, { fontWeight: '600' });
    const rest = document.createElement('span');
    rest.textContent = `Lo apro da ${label}? In questa tab non sarai loggato.`;
    txt.appendChild(strong); txt.appendChild(rest);

    const open = document.createElement('button');
    open.textContent = `Apri da ${label}`;
    css(open, {
      flex: '0 0 auto', font: '600 13.5px/1.2 inherit',
      padding: '8px 16px', border: 'none', borderRadius: '8px', cursor: 'pointer',
      color: '#fff', background: '#ea580c',
      boxShadow: '0 1px 3px rgba(124,45,18,0.25)',
    });
    open.addEventListener('click', () => { send({ type: T_ACCEPT, url, country }); clear(); });

    const no = document.createElement('button');
    no.textContent = 'No';
    css(no, {
      flex: '0 0 auto', font: '600 13.5px/1.2 inherit',
      padding: '8px 14px', border: 'none', borderRadius: '8px', cursor: 'pointer',
      color: '#9a3412', background: 'transparent',
      boxShadow: 'inset 0 0 0 1.5px #fdba74',
    });
    no.addEventListener('click', () => { send({ type: T_DISMISS, url }); clear(); });

    bar.appendChild(icon); bar.appendChild(txt); bar.appendChild(open); bar.appendChild(no);
    shadow.appendChild(bar);
  }

  function sameHost(a, b) {
    try { return new URL(a).host === new URL(b).host; } catch (_) { return true; }
  }

  // Broadcast dal main: c'è una proposta geo-block per questa pagina.
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== T_PROPOSE) return;
      if (msg.url && !sameHost(msg.url, location.href)) return;
      render(msg.url || location.href, msg.country, msg.countryLabel || (msg.country || '').toUpperCase());
    });
  } catch (_) {}

  global.SN_GEO_PROPOSAL_UI = { render, clear };
})(typeof globalThis !== 'undefined' ? globalThis : self);
