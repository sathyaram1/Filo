// Componenti di conferma riusabili per i livelli di sicurezza delle azioni
// di Filo (#146.2). Stile minimale, costruito sui token del tema (--sn-*).
//
//   SN_CONFIRM_UI.confirm({ title, text, okLabel, cancelLabel }) → Promise<bool>
//     Livello 2: popup che SPIEGA in chiaro la modifica, con OK e Annulla.
//
//   SN_CONFIRM_UI.confirmTyped({ title, text, word }) → Promise<bool>
//     Livello 3: box con attrito maggiore — il bottone resta disabilitato
//     finché l'utente non digita espressamente la parola ("conferma").
//
// Esc o click fuori dal box = annulla. Una sola conferma alla volta.
//
// SICUREZZA (#249): il dialogo vive in uno Shadow DOM in modalità CLOSED,
// agganciato a un host neutro (.sn-confirm-host). Il DOM del documento è
// condiviso tra il mondo isolato del preload (dove gira questo codice sulle
// pagine web esterne) e il mondo principale della pagina: senza shadow root
// chiuso, uno script ostile della pagina poteva trovare il bottone OK via
// querySelector/MutationObserver e auto-cliccarlo, confermando azioni di
// livello 2 senza alcun consenso reale. Con lo shadow root chiuso i nodi
// interni (bottoni, testo, input) NON sono raggiungibili da fuori: la pagina
// vede solo l'host vuoto. Il riferimento al root resta privato di questo
// modulo (e degli hook _test, che sulle pagine esterne vivono anch'essi nel
// mondo isolato, quindi fuori dalla portata della pagina).

(function (global) {
  'use strict';

  const CSS = `
.sn-confirm-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  font-family: var(--sn-font);
}
.sn-confirm-box {
  width: min(440px, calc(100vw - 48px));
  padding: 20px;
  background: var(--sn-overlay-bg, var(--sn-bg, #fff));
  color: var(--sn-fg, #1a1918);
  border: 1px solid var(--sn-border, #e0dcd4);
  border-radius: var(--sn-radius, 6px);
  box-shadow: var(--sn-shadow, 0 4px 16px rgba(0,0,0,0.18));
}
.sn-confirm-title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
}
.sn-confirm-text {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--sn-fg, #1a1918);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  /* Il testo di un'azione può essere lungo (il feedback che Filo sta per
     mandare a nome dell'utente): deve restare LEGGIBILE PER INTERO, quindi il
     popup non lo taglia — scorre. Il tetto è relativo al viewport così il box
     resta dentro lo schermo insieme a titolo e bottoni. */
  max-height: min(52vh, 420px);
  overflow-y: auto;
}
.sn-confirm-input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin: 0 0 16px;
  padding: 8px 10px;
  font-family: var(--sn-font);
  font-size: 13px;
  color: var(--sn-fg, #1a1918);
  background: var(--sn-bg, #fff);
  border: 1px solid var(--sn-border, #e0dcd4);
  border-radius: var(--sn-radius, 6px);
  outline: none;
}
.sn-confirm-input:focus { border-color: var(--sn-accent, #c45a3b); }
.sn-confirm-row {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.sn-confirm-btn {
  all: unset;
  box-sizing: border-box;
  padding: 8px 14px;
  font-family: var(--sn-font);
  font-size: 13px;
  border-radius: var(--sn-radius, 6px);
  cursor: pointer;
  text-align: center;
}
.sn-confirm-btn-cancel {
  color: var(--sn-fg, #1a1918);
  border: 1px solid var(--sn-border, #e0dcd4);
}
.sn-confirm-btn-cancel:hover { background: var(--sn-hover, rgba(0,0,0,0.05)); }
.sn-confirm-btn-ok {
  background: var(--sn-btn-bg, var(--sn-fg, #1a1918));
  color: var(--sn-btn-fg, var(--sn-bg, #fff));
  border: 1px solid transparent;
}
.sn-confirm-btn-ok:hover { opacity: 0.85; }
.sn-confirm-btn-danger {
  background: var(--sn-error, #b91c1c);
  color: #fff;
  border: 1px solid transparent;
}
.sn-confirm-btn-danger:hover { opacity: 0.85; }
.sn-confirm-btn[disabled] {
  opacity: 0.45;
  cursor: not-allowed;
}
.sn-confirm-text {
  scrollbar-width: thin;
  scrollbar-color: var(--sn-border, #e0dcd4) transparent;
}
.sn-confirm-text::-webkit-scrollbar { width: 8px; }
.sn-confirm-text::-webkit-scrollbar-track { background: transparent; }
.sn-confirm-text::-webkit-scrollbar-thumb {
  background: var(--sn-border, #e0dcd4);
  border-radius: 999px;
}
.sn-confirm-text::-webkit-scrollbar-thumb:hover { background: var(--sn-accent, #c45a3b); }
.sn-confirm-text::-webkit-scrollbar-button { display: none; width: 0; height: 0; }

/* Selezione del testo nella palette Filo, non nel blu di sistema.
   La regola ::selection del tema (src/styles/theme.css) sta nel foglio del
   DOCUMENTO e non entra in questo shadow root chiuso: senza queste righe,
   selezionare il testo del popup — cosa che si fa per rileggerlo o copiarlo —
   lo evidenzia col blu del sistema operativo, l'unico punto della UI di Filo
   fuori palette. I custom properties invece attraversano il confine dello
   shadow DOM, quindi i token del tema (e gli override estetici dell'utente)
   valgono anche qui; il letterale resta come ripiego per il primo paint. */
.sn-confirm-overlay ::selection,
.sn-confirm-overlay::selection {
  background: var(--sn-selection-bg, rgba(196, 90, 59, 0.30));
  color: var(--sn-selection-fg, inherit);
}
.sn-confirm-overlay ::-moz-selection,
.sn-confirm-overlay::-moz-selection {
  background: var(--sn-selection-bg, rgba(196, 90, 59, 0.30));
  color: var(--sn-selection-fg, inherit);
}
`;

  // Dialogo attivo (uno alla volta): il root CHIUSO è raggiungibile solo da
  // questo modulo. `active` serve a done() e agli hook di test qui sotto.
  let active = null; // { host, root }

  // Costruisce host+shadow(closed)+overlay+box e ritorna { overlay, box, done }
  // dove done(result) smonta tutto e risolve la Promise una sola volta.
  function buildOverlay(resolve) {
    const doc = global.document;

    // L'host è l'UNICO nodo visibile dal documento: nessun contenuto, solo il
    // posizionamento a tutto viewport (inline, così non serve CSS nel documento).
    const host = doc.createElement('div');
    host.className = 'sn-confirm-host';
    // Su una pagina web l'host finisce dentro il <body> del sito: marcarlo
    // tiene fuori il riquadro da chi cammina sulla pagina (la traduzione).
    global.SN_FILO_UI?.mark(host);
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';

    const root = host.attachShadow({ mode: 'closed' });
    const style = doc.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    const overlay = doc.createElement('div');
    overlay.className = 'sn-confirm-overlay';
    const box = doc.createElement('div');
    box.className = 'sn-confirm-box';
    overlay.appendChild(box);
    root.appendChild(overlay);

    let settled = false;
    function done(result) {
      if (settled) return;
      settled = true;
      doc.removeEventListener('keydown', onKey, true);
      host.remove();
      if (active && active.root === root) active = null;
      resolve(result);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
    }
    doc.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) done(false); });

    doc.body.appendChild(host);
    active = { host, root };
    return { overlay, box, done };
  }

  function header(box, { title, text }) {
    const doc = global.document;
    if (title) {
      const h = doc.createElement('div');
      h.className = 'sn-confirm-title';
      h.textContent = title;
      box.appendChild(h);
    }
    const p = doc.createElement('div');
    p.className = 'sn-confirm-text';
    p.textContent = text || '';
    box.appendChild(p);
  }

  function buttonRow(box) {
    const row = global.document.createElement('div');
    row.className = 'sn-confirm-row';
    box.appendChild(row);
    return row;
  }

  function makeBtn(row, label, className) {
    const btn = global.document.createElement('button');
    btn.type = 'button';
    btn.className = `sn-confirm-btn ${className}`;
    btn.textContent = label;
    row.appendChild(btn);
    return btn;
  }

  // Livello 2 — popup di conferma con spiegazione + OK/Annulla.
  function confirm({ title = 'Conferma', text = '', okLabel = 'OK', cancelLabel = 'Annulla' } = {}) {
    return new Promise((resolve) => {
      const { box, done } = buildOverlay(resolve);
      header(box, { title, text });
      const row = buttonRow(box);
      const cancel = makeBtn(row, cancelLabel, 'sn-confirm-btn-cancel');
      const ok = makeBtn(row, okLabel, 'sn-confirm-btn-ok');
      cancel.addEventListener('click', () => done(false));
      ok.addEventListener('click', () => done(true));
      ok.focus();
    });
  }

  // Livello 3 — l'utente deve digitare la parola (default "conferma") per
  // sbloccare il bottone. Per azioni irreversibili.
  function confirmTyped({ title = 'Conferma richiesta', text = '', word = 'conferma', okLabel = 'Esegui', cancelLabel = 'Annulla' } = {}) {
    return new Promise((resolve) => {
      const doc = global.document;
      const { box, done } = buildOverlay(resolve);
      header(box, { title, text: `${text}\n\nQuesta azione non è reversibile. Scrivi “${word}” per procedere.` });

      const input = doc.createElement('input');
      input.type = 'text';
      input.className = 'sn-confirm-input';
      input.placeholder = word;
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('spellcheck', 'false');
      box.appendChild(input);

      const row = buttonRow(box);
      const cancel = makeBtn(row, cancelLabel, 'sn-confirm-btn-cancel');
      const ok = makeBtn(row, okLabel, 'sn-confirm-btn-danger');
      ok.disabled = true;

      const matches = () => input.value.trim().toLowerCase() === String(word).toLowerCase();
      input.addEventListener('input', () => { ok.disabled = !matches(); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && matches()) { e.preventDefault(); done(true); }
      });
      cancel.addEventListener('click', () => done(false));
      ok.addEventListener('click', () => { if (matches()) done(true); });
      input.focus();
    });
  }

  // Avviso a un solo bottone — comunica qualcosa senza chiedere una scelta
  // (es. "Hai ricevuto N crediti in regalo 🎁"). Risolve quando l'utente chiude.
  function notify({ title = '', text = '', okLabel = 'OK' } = {}) {
    return new Promise((resolve) => {
      const { box, done } = buildOverlay(resolve);
      header(box, { title, text });
      const row = buttonRow(box);
      const ok = makeBtn(row, okLabel, 'sn-confirm-btn-ok');
      ok.addEventListener('click', () => done(true));
      ok.focus();
    });
  }

  // ── Hook di TEST (tests/helpers/confirm.mjs) ─────────────────────────────
  // Il root chiuso rende il dialogo invisibile ai locator Playwright: gli spec
  // sulle pagine filo:// (contextIsolation:false) passano da qui via
  // page.evaluate. Sulle pagine web esterne SN_CONFIRM_UI vive nel mondo
  // isolato del preload: la pagina NON può chiamare questi hook, quindi non
  // riaprono la falla del feedback #249.
  const _test = {
    // Stato del dialogo aperto, o null se non ce n'è uno.
    state() {
      if (!active) return null;
      const q = (s) => active.root.querySelector(s);
      const okBtn = q('.sn-confirm-btn-ok') || q('.sn-confirm-btn-danger');
      const textEl = q('.sn-confirm-text');
      // Il testo lungo scorre dentro il box invece di essere tagliato, e la sua
      // selezione usa la palette Filo: entrambe le cose vivono nello shadow root
      // chiuso, quindi solo da qui sono ispezionabili da uno spec.
      let selectionBg = '';
      try {
        if (textEl) selectionBg = global.getComputedStyle(textEl, '::selection').backgroundColor || '';
      } catch (_) {}
      return {
        title: (q('.sn-confirm-title') && q('.sn-confirm-title').textContent) || '',
        text: (textEl && textEl.textContent) || '',
        okDisabled: !!(okBtn && okBtn.disabled),
        hasInput: !!q('.sn-confirm-input'),
        textScrolls: !!(textEl && textEl.scrollHeight > textEl.clientHeight + 1),
        selectionBg,
      };
    },
    // Clicca un bottone: which = 'ok' | 'cancel' | 'danger'.
    // Ritorna false se non c'è dialogo, bottone assente o disabilitato.
    click(which) {
      if (!active) return false;
      const btn = active.root.querySelector('.sn-confirm-btn-' + which);
      if (!btn || btn.disabled) return false;
      btn.click();
      return true;
    },
    // Scrive nel campo del dialogo livello 3 (dispatch dell'evento input).
    fill(value) {
      if (!active) return false;
      const input = active.root.querySelector('.sn-confirm-input');
      if (!input) return false;
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },
  };

  global.SN_CONFIRM_UI = { confirm, confirmTyped, notify, _test };
})(typeof globalThis !== 'undefined' ? globalThis : self);
