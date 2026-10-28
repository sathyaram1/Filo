// Box «Modifica»: anteprima con diff e conferma esplicita, mai sovrascrittura cieca.
// Caricato prima di content.js, che gli passa il contesto d'incolla con init().

(function (global) {
  'use strict';

  const { ACTIONS } = global.SN_CONST;
  const { MSG } = global.SN_MSG;
  const I18n = global.SN_I18N;
  const Popup = global.SN_POPUP;

  let deps = {
    getPasteContext: () => null,
    setPasteContext: () => {},
    restorePasteContext: () => false,
  };

  function openEditBox(originalText) {
    if (!deps.getPasteContext()) {
      // Rivalido al volo: senza editable il "Sostituisci" non avrebbe senso.
      Popup.toastErrore('err_no_selection');
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
        <input type="text" class="sn-editbox-instruction">
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
    document.documentElement.appendChild(Popup.riquadro ? Popup.riquadro(root) : root);

    const $orig = root.querySelector('.sn-editbox-original');
    const $prop = root.querySelector('.sn-editbox-proposed');
    const $instr = root.querySelector('.sn-editbox-instruction');
    // Il testo d'esempio ha le virgolette: come attributo nel modello HTML si troncherebbe.
    $instr.placeholder = I18n.t('edit_box_instruction_placeholder');
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
    // Per i contatori (#1465): quale scorciatoia ha fatto la proposta (un'istruzione scritta è «libera», mai il suo
    // testo), quante proposte prima dell'esito, e l'esito.
    const CONTATA = { formal: 'formale', casual: 'informale', summarize: 'riassumi', translate: 'traduci', fix: 'correggi' };
    const scorciatoiaDi = (istruzione) => CONTATA[Object.keys(SHORTCUTS).find((k) => SHORTCUTS[k] === istruzione)] || 'libera';
    const conta = (campi) => Popup.conta?.({ misura: 'riquadro', cosa: 'riscrittura', ...campi });
    let proposte = 0;
    let scorciatoia = '';
    let finita = false;
    const fine = (esito) => {
      if (finita) return;
      finita = true;
      if (proposte > 0) conta({ scorciatoia, esito, proposte });
    };
    // Una riscrittura spende una chiamata: parte solo da un tasto o da un clic dell'utente (#1071).
    root.querySelectorAll('.sn-editbox-shortcuts button').forEach((b) => {
      b.addEventListener('click', (e) => {
        if (!e.isTrusted) return;
        const k = b.dataset.sc;
        $instr.value = SHORTCUTS[k] || '';
        runEdit();
      });
    });

    let currentResult = '';
    let inFlight = false;
    let $nota = null; // la riga del ripiego sui crediti di Filo, della proposta in vista
    let $interrotta = null; // la riga della proposta fermata dal tetto di lunghezza (#1097.3)
    async function runEdit() {
      const instruction = $instr.value.trim();
      if (!instruction || inFlight) return;
      inFlight = true;
      if ($nota) { $nota.remove(); $nota = null; }
      if ($interrotta) { $interrotta.remove(); $interrotta = null; }
      $prop.classList.remove('sn-editbox-errore');
      $prop.classList.add('sn-editbox-empty');
      $prop.textContent = I18n.t('edit_box_loading');
      $copy.disabled = true;
      $replace.disabled = true;
      try {
        const res = await chrome.runtime.sendMessage({
          type: MSG.AI_REQUEST,
          action: ACTIONS.EDIT_TEXT,
          payload: { original: originalText, instruction },
          diceRipiego: true,
        });
        if (!res?.ok || !res.text) {
          // Perché la riscrittura non è partita, con la strada per rimediare: la regola sta in
          // SN_CHAT_ERRORS, non un elenco di casi per riquadro (#663).
          mostraErrore(res);
          return;
        }
        currentResult = res.text.trim();
        proposte += 1;
        scorciatoia = scorciatoiaDi(instruction);
        $prop.classList.remove('sn-editbox-empty');
        renderDiff($prop, originalText, currentResult);
        $nota = Popup.notaRipiego($prop.parentNode, res.keyFallback);
        $interrotta = Popup.notaInterrotta($prop.parentNode, res.finishReason);
        $copy.disabled = false;
        // Una riscrittura tagliata al posto del testo intero ne perderebbe la coda: si copia, non si sostituisce.
        $replace.disabled = !!global.SN_CHAT_ERRORS?.troncata?.(res.finishReason);
        if ($replace.disabled) conta({ scorciatoia, tagliata: true });
      } catch (e) {
        mostraErrore({ message: e?.message });
      } finally {
        inFlight = false;
      }
    }
    // Il motivo prende il posto della proposta, ma non il suo aspetto né quello dell'attesa: chi legge di sfuggita
    // non lo deve scambiare per la riscrittura (#663).
    function mostraErrore(res) {
      $prop.classList.remove('sn-editbox-empty');
      $prop.classList.add('sn-editbox-errore');
      Popup.scriviErrore($prop, res);
    }

    $instr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (global.SN_FILO_UI?.veroONostro ? global.SN_FILO_UI.veroONostro(e) : e.isTrusted) runEdit();
      } else if (e.key === 'Escape') {
        close();
        // Il tasto è nostro e lo dichiariamo (#514): a schermo intero è così
        // che si chiude il riquadro senza uscire anche dalla modalità.
        e.preventDefault();
        e.stopPropagation();
      }
    });
    $cancel.addEventListener('click', close);
    $copy.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      navigator.clipboard.writeText(currentResult).then(() => {
        Popup.showToast(I18n.t('toast_copied'));
        fine('copiato');
        close();
      }, () => Popup.toastErrore('err_provider_failed'));
    });
    $replace.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      deps.setPasteContext(savedCtx);
      deps.restorePasteContext();
      // In contenteditable l'inserimento passa da execCommand dopo aver ripristinato la selezione,
      // così Ctrl+Z funziona.
      if (savedCtx.kind === 'input') {
        const el = savedCtx.el;
        const start = savedCtx.start, end = savedCtx.end;
        const caret = start + currentResult.length;
        // Come una battuta: il rosso del correttore sulle altre parole resta (#1111).
        if (global.SN_SPELLCHECK?.sostituisciComeBattuta?.(el, { start, end }, currentResult)) {
          el.setSelectionRange(start, caret);
        } else {
          el.value = el.value.slice(0, start) + currentResult + el.value.slice(end);
          el.setSelectionRange(start, caret);
          // Il campo può stare in un riquadro di Filo, chiuso ai gesti finti: la sostituzione è nostra e deve sentirla.
          const ev = new Event('input', { bubbles: true });
          el.dispatchEvent(global.SN_FILO_UI?.nostro ? global.SN_FILO_UI.nostro(ev) : ev);
        }
      } else if (savedCtx.kind === 'ce') {
        try { document.execCommand('insertText', false, currentResult); } catch (_) {}
      }
      Popup.modificaDiFilo(savedCtx.el || document.activeElement, 'modifica-testo');
      Popup.showToast(I18n.t('edit_box_replaced'));
      fine('sostituito');
      close();
    });

    function close() {
      fine('chiuso');
      if (Popup.togliRiquadro) Popup.togliRiquadro(root);
      else { try { root.remove(); } catch (_) {} }
      document.removeEventListener('keydown', onDocKey, true);
      window.removeEventListener('pagehide', close);
    }
    // La pagina che se ne va col riquadro aperto lo chiude.
    window.addEventListener('pagehide', close);
    const onDocKey = (e) => {
      if (e.key !== 'Escape') return;
      close();
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('keydown', onDocKey, true);
    root.addEventListener('mousedown', (e) => {
      if (e.target === root) close();
    });

    $instr.value = '';
    // No autorun — l'utente deve dare istruzione esplicita.
    $prop.textContent = '—';
  }

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
