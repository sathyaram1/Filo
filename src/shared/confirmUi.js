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

(function (global) {
  'use strict';

  const STYLE_ID = 'sn-confirm-ui-style';
  const CSS = `
.sn-confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
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
`;

  function ensureStyle(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    const el = doc.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(el);
  }

  // Costruisce overlay+box e ritorna { overlay, box, done } dove done(result)
  // smonta tutto e risolve la Promise una sola volta.
  function buildOverlay(resolve) {
    const doc = global.document;
    ensureStyle(doc);
    const overlay = doc.createElement('div');
    overlay.className = 'sn-confirm-overlay';
    const box = doc.createElement('div');
    box.className = 'sn-confirm-box';
    overlay.appendChild(box);

    let settled = false;
    function done(result) {
      if (settled) return;
      settled = true;
      doc.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(result);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
    }
    doc.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) done(false); });

    doc.body.appendChild(overlay);
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

  global.SN_CONFIRM_UI = { confirm, confirmTyped };
})(typeof globalThis !== 'undefined' ? globalThis : self);
