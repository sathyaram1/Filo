// Box "Modifica" (preview + conferma, mai sovrascrittura cieca).
// Apre un overlay modale (HTML), mostra originale + proposta con diff, e
// azioni esplicite [Sostituisci] / [Copia la nuova] / [Annulla]. Scorciatoie
// pronte (più formale / informale / riassumi / traduci / correggi) + campo
// libero per istruzioni arbitrarie.
// Estratto da content.js — viene caricato prima di lui dai preload. content.js
// chiama init() passando l'accesso al pasteContext (che resta suo).

(function (global) {
  'use strict';

  const { ACTIONS } = global.SN_CONST;
  const { MSG } = global.SN_MSG;
  const I18n = global.SN_I18N;
  const Popup = global.SN_POPUP;

  // Dipendenze iniettate da content.js (vedi init in fondo).
  let deps = {
    getPasteContext: () => null,
    setPasteContext: () => {},
    restorePasteContext: () => false,
  };

  function openEditBox(originalText) {
    if (!deps.getPasteContext()) {
      // Rivalido al volo: senza editable il "Sostituisci" non avrebbe senso.
      Popup.showToast(I18n.t('err_no_selection'));
      return;
    }
    const savedCtx = deps.getPasteContext(); // congelo il riferimento per il momento del replace

    const root = document.createElement('div');
    root.className = 'sn-editbox-overlay';
    global.SN_FILO_UI?.mark(root);
    root.dataset.snTheme = document.documentElement.dataset.snTheme || '';
    root.innerHTML = `
      <div class="sn-editbox" role="dialog" aria-label="${I18n.t('edit_box_title')}">
        <div class="sn-editbox-header">${I18n.t('edit_box_title')}</div>
        <div class="sn-editbox-shortcuts">
          <button type="button" data-sc="formal">${I18n.t('edit_box_shortcut_formal')}</button>
          <button type="button" data-sc="casual">${I18n.t('edit_box_shortcut_casual')}</button>
          <button type="button" data-sc="summarize">${I18n.t('edit_box_shortcut_summarize')}</button>
          <button type="button" data-sc="translate">${I18n.t('edit_box_shortcut_translate')}</button>
          <button type="button" data-sc="fix">${I18n.t('edit_box_shortcut_fix')}</button>
        </div>
        <input type="text" class="sn-editbox-instruction" placeholder="${I18n.t('edit_box_instruction_placeholder')}">
        <div class="sn-editbox-panels">
          <div class="sn-editbox-panel">
            <div class="sn-editbox-label">${I18n.t('edit_box_original')}</div>
            <div class="sn-editbox-original"></div>
          </div>
          <div class="sn-editbox-panel">
            <div class="sn-editbox-label">${I18n.t('edit_box_proposed')}</div>
            <div class="sn-editbox-proposed sn-editbox-empty">${I18n.t('edit_box_loading')}</div>
          </div>
        </div>
        <div class="sn-editbox-footer">
          <button type="button" class="sn-editbox-cancel">${I18n.t('edit_box_cancel')}</button>
          <button type="button" class="sn-editbox-copy" disabled>${I18n.t('edit_box_copy_new')}</button>
          <button type="button" class="sn-editbox-replace" disabled>${I18n.t('edit_box_replace')}</button>
        </div>
      </div>
    `;
    document.documentElement.appendChild(root);

    const $orig = root.querySelector('.sn-editbox-original');
    const $prop = root.querySelector('.sn-editbox-proposed');
    const $instr = root.querySelector('.sn-editbox-instruction');
    const $cancel = root.querySelector('.sn-editbox-cancel');
    const $copy = root.querySelector('.sn-editbox-copy');
    const $replace = root.querySelector('.sn-editbox-replace');

    $orig.textContent = originalText;
    $instr.focus();

    const SHORTCUTS = {
      formal: 'Rendi il testo più formale, mantenendo il significato.',
      casual: 'Rendi il testo più informale e amichevole.',
      summarize: 'Riassumi il testo mantenendo i punti principali.',
      translate: 'Traduci il testo in inglese.',
      fix: 'Correggi eventuali errori grammaticali e di ortografia, senza alterare il senso.',
    };
    root.querySelectorAll('.sn-editbox-shortcuts button').forEach((b) => {
      b.addEventListener('click', () => {
        const k = b.dataset.sc;
        $instr.value = SHORTCUTS[k] || '';
        runEdit();
      });
    });

    let currentResult = '';
    let inFlight = false;
    async function runEdit() {
      const instruction = $instr.value.trim();
      if (!instruction || inFlight) return;
      inFlight = true;
      $prop.classList.add('sn-editbox-empty');
      $prop.textContent = I18n.t('edit_box_loading');
      $copy.disabled = true;
      $replace.disabled = true;
      try {
        const res = await chrome.runtime.sendMessage({
          type: MSG.AI_REQUEST,
          action: ACTIONS.EDIT_TEXT,
          payload: { original: originalText, instruction },
        });
        if (!res?.ok || !res.text) {
          $prop.textContent = res?.error || I18n.t('edit_box_error');
          return;
        }
        currentResult = res.text.trim();
        $prop.classList.remove('sn-editbox-empty');
        renderDiff($prop, originalText, currentResult);
        $copy.disabled = false;
        $replace.disabled = false;
      } catch (_) {
        $prop.textContent = I18n.t('edit_box_error');
      } finally {
        inFlight = false;
      }
    }

    $instr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        runEdit();
      } else if (e.key === 'Escape') {
        close();
      }
    });
    $cancel.addEventListener('click', close);
    $copy.addEventListener('click', () => {
      navigator.clipboard.writeText(currentResult).then(() => {
        Popup.showToast(I18n.t('toast_copied'));
        close();
      }, () => Popup.showToast(I18n.t('err_provider_failed')));
    });
    $replace.addEventListener('click', () => {
      deps.setPasteContext(savedCtx);
      deps.restorePasteContext();
      // In input/textarea sostituisco il range salvato; in contenteditable uso execCommand insertText
      // dopo aver ripristinato la selezione originale, così Ctrl+Z funziona.
      if (savedCtx.kind === 'input') {
        const el = savedCtx.el;
        const start = savedCtx.start, end = savedCtx.end;
        el.value = el.value.slice(0, start) + currentResult + el.value.slice(end);
        const caret = start + currentResult.length;
        el.setSelectionRange(start, caret);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (savedCtx.kind === 'ce') {
        try { document.execCommand('insertText', false, currentResult); } catch (_) {}
      }
      Popup.showToast(I18n.t('edit_box_replaced'));
      close();
    });

    function close() {
      try { root.remove(); } catch (_) {}
      document.removeEventListener('keydown', onDocKey, true);
    }
    const onDocKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onDocKey, true);
    root.addEventListener('mousedown', (e) => {
      if (e.target === root) close(); // click fuori dal box
    });

    // Avvia subito una proposta neutra (rifrasi), così l'utente vede già qualcosa.
    $instr.value = '';
    // No autorun — l'utente deve dare istruzione esplicita.
    $prop.textContent = '—';
  }

  // Diff parola-per-parola: ricostruisce il testo proposto evidenziando aggiunte
  // (verde) e rimozioni (rosso barrato). Algoritmo LCS semplice sulle parole.
  function renderDiff(container, original, proposed) {
    container.innerHTML = '';
    const a = original.split(/(\s+)/);
    const b = proposed.split(/(\s+)/);
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
        else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    const ops = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) { ops.push({ op: 'eq', t: a[i - 1] }); i--; j--; }
      else if (dp[i - 1][j] >= dp[i][j - 1]) { ops.push({ op: 'del', t: a[i - 1] }); i--; }
      else { ops.push({ op: 'add', t: b[j - 1] }); j--; }
    }
    while (i > 0) { ops.push({ op: 'del', t: a[i - 1] }); i--; }
    while (j > 0) { ops.push({ op: 'add', t: b[j - 1] }); j--; }
    ops.reverse();
    for (const o of ops) {
      if (o.op === 'eq') {
        container.appendChild(document.createTextNode(o.t));
      } else if (o.op === 'add') {
        const s = document.createElement('span');
        s.className = 'sn-diff-add';
        s.textContent = o.t;
        container.appendChild(s);
      } else {
        const s = document.createElement('span');
        s.className = 'sn-diff-del';
        s.textContent = o.t;
        container.appendChild(s);
      }
    }
  }

  function init(d) { deps = { ...deps, ...d }; }

  global.SN_EDITBOX = { init, openEditBox };
})(typeof globalThis !== 'undefined' ? globalThis : self);
