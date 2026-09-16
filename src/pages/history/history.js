// Pagina cronologia AI: lista, ricerca, filtro per tipo, cancellazione.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const I18n = window.SN_I18N;
  const Storage = window.SN_STORAGE;
  const Const = window.SN_CONST;

  function $(id) { return document.getElementById(id); }

  let items = [];

  async function load() {
    const settings = await Storage.getSettings();
    window.SN_PAGE_THEME = settings.theme;
    window.SN_PAGE_BOOTSTRAP.applyTheme(settings.theme);

    document.title = I18n.t('history_title');
    $('title').textContent = I18n.t('history_title');
    $('search').placeholder = I18n.t('history_search_placeholder');
    $('clear').textContent = I18n.t('history_clear');
    $('empty').textContent = I18n.t('history_empty');

    const r = await chrome.runtime.sendMessage({ type: MSG.GET_HISTORY });
    items = r?.items || [];
    buildFilterOptions();
    render();
  }

  // Il menu «filtra per tipo» elenca SOLO i tipi presenti in cronologia: così copre da sé ogni
  // azione nuova, senza restare disallineato da una lista scritta a mano.
  function buildFilterOptions() {
    const sel = $('filter');
    const current = sel.value;
    const seen = new Set();
    for (const it of items) {
      if (it && it.action) seen.add(it.action);
    }
    const opts = [...seen]
      .map((a) => ({ value: a, label: formatActionLabel(a) }))
      .sort((x, y) => x.label.localeCompare(y.label, 'it'));

    sel.innerHTML = '';
    const all = document.createElement('option');
    all.value = '';
    all.textContent = I18n.t('history_filter_all');
    sel.appendChild(all);
    for (const o of opts) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      sel.appendChild(opt);
    }
    // Mantieni la scelta corrente se ancora valida (es. dopo un reload dati).
    sel.value = seen.has(current) ? current : '';
  }

  function render() {
    const q = ($('search').value || '').trim().toLowerCase();
    const filter = $('filter').value;
    const list = $('list');
    list.innerHTML = '';

    let filtered = items;
    if (filter) filtered = filtered.filter((it) => it.action === filter);
    if (q) {
      filtered = filtered.filter((it) => {
        // Cerca SOLO sui testi che la voce mostra davvero: con JSON.stringify(it.input) finivano
        // nell'ago i NOMI dei campi interni e la punteggiatura JSON, e si «trovavano» parole che
        // l'utente non vede da nessuna parte.
        const haystack = [
          formatActionLabel(it.action),
          formatInput(it.input),
          it.output || '',
          it.origin || '',
          it.model || '',
        ].join(' ').toLowerCase();
        return haystack.includes(q);
      });
    }

    if (!filtered.length) {
      // Distingui «cronologia vuota» da «nessun risultato»: il vuoto assoluto durante una ricerca
      // fa credere che la cronologia sia stata cancellata.
      const empty = $('empty');
      if (items.length && q) empty.textContent = I18n.t('history_no_results');
      else if (items.length && filter) empty.textContent = I18n.t('history_no_results_filter');
      else empty.textContent = I18n.t('history_empty');
      empty.hidden = false;
      return;
    }
    $('empty').hidden = true;

    for (const it of filtered) {
      list.appendChild(renderItem(it));
    }
  }

  function renderItem(it) {
    const wrap = document.createElement('div');
    wrap.className = 'sn-history-item';

    const meta = document.createElement('div');
    meta.className = 'sn-history-meta';
    const left = document.createElement('span');
    // Chi ha davvero servito la risposta (host upstream via OpenRouter, #421): così la politica
    // sui fornitori è verificabile a colpo d'occhio dalla cronologia.
    const via = it.servedBy ? ` • via ${it.servedBy}` : '';
    left.textContent = `${formatActionLabel(it.action)} • ${it.model || ''}${via} • ${formatDate(it.timestamp)}`;
    meta.appendChild(left);
    // Servita da un fornitore escluso: la voce lo dice, non solo il log.
    if (it.policyViolation) {
      const warn = document.createElement('span');
      warn.className = 'sn-history-policy-warn';
      warn.textContent = I18n.t('history_policy_violation');
      left.appendChild(warn);
    }
    const right = document.createElement('span');
    right.className = 'sn-history-meta-right';
    // Riuso del testo in ingresso (#422): quanta parte del prompt il fornitore ha riusato invece
    // di rielaborarla. È il modo di vedere se tenere le istruzioni fisse in testa funziona: se
    // resta a zero, non funziona. Solo quando conosciamo i token in ingresso.
    const inTok = Number(it.usage?.promptTokens) || 0;
    if (inTok > 0) {
      const reused = Number(it.usage?.cachedPromptTokens) || 0;
      const pct = Math.round((reused / inTok) * 100);
      const chip = document.createElement('span');
      chip.className = 'sn-history-reuse';
      chip.textContent = I18n.t('history_reuse', String(pct));
      chip.title = reused > 0
        ? I18n.t('history_reuse_title', formatTokens(reused), formatTokens(inTok))
        : I18n.t('history_reuse_none_title', formatTokens(inTok));
      right.appendChild(chip);
    }
    // Tempi del turno: inizio del ragionamento, prima parola (o prima azione nominata), fine.
    // Solo per le richieste in diretta che li hanno misurati.
    const tm = it.timing;
    if (tm && Number(tm.totalMs) > 0) {
      const fmt = (ms) => (ms == null ? '—' : `${(Number(ms) / 1000).toFixed(1)} s`);
      const first = tm.firstTextMs != null ? tm.firstTextMs : tm.firstToolMs;
      const chip = document.createElement('span');
      chip.className = 'sn-history-timing';
      chip.textContent = I18n.t('history_timing', fmt(tm.firstReasoningMs), fmt(first), fmt(tm.totalMs));
      chip.title = I18n.t('history_timing_title');
      right.appendChild(chip);
    }

    const cost = document.createElement('span');
    cost.textContent = it.costEur ? `€${it.costEur.toFixed(4)}` : '—';
    right.appendChild(cost);

    // Rimozione puntuale della voce, simmetrica alle altre liste di Filo. Compare all'hover per
    // non appesantire la lista.
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'sn-history-remove';
    remove.textContent = I18n.t('history_remove');
    remove.title = I18n.t('history_remove_title');
    remove.addEventListener('click', async (e) => {
      e.stopPropagation();
      const r = await chrome.runtime.sendMessage({ type: MSG.REMOVE_HISTORY_ENTRY, id: it.id });
      items = r?.items || items.filter((x) => x.id !== it.id);
      // Un tipo d'azione può essere scomparso del tutto: riallinea il filtro.
      buildFilterOptions();
      render();
    });
    right.appendChild(remove);

    meta.appendChild(right);
    wrap.appendChild(meta);

    if (it.input) {
      const inp = document.createElement('div');
      inp.className = 'sn-history-input';
      inp.textContent = formatInput(it.input);
      wrap.appendChild(inp);
    }

    const out = document.createElement('div');
    out.className = 'sn-history-output';
    out.textContent = it.output || '';
    wrap.appendChild(out);

    if (it.origin) {
      const origin = document.createElement('div');
      origin.className = 'sn-muted';
      origin.style.marginTop = '6px';
      origin.style.fontSize = '11px';
      origin.textContent = it.origin;
      wrap.appendChild(origin);
    }
    return wrap;
  }

  function formatActionLabel(a) {
    return Const.actionLabel(a);
  }

  function formatInput(input) {
    if (typeof input === 'string') return truncate(input, 400);
    const sel = input.selection || input.userMessage || input.title || input.url || '';
    return truncate(sel, 400);
  }

  function truncate(s, n) {
    if (!s) return '';
    s = String(s);
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function formatDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('it-IT');
  }

  // Numeri nel formato italiano (1.234).
  function formatTokens(n) {
    return Number(n || 0).toLocaleString('it-IT');
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
    $('search').addEventListener('input', render);
    $('filter').addEventListener('change', render);
    $('clear').addEventListener('click', async () => {
      const text = I18n.t('history_clear_confirm');
      const ok = window.SN_CONFIRM_UI
        ? await window.SN_CONFIRM_UI.confirm({ title: I18n.t('history_clear'), text, okLabel: I18n.t('history_clear') })
        : window.confirm(text); // fallback se il modulo non è caricato
      if (!ok) return;
      await chrome.runtime.sendMessage({ type: MSG.CLEAR_HISTORY });
      items = [];
      // Svuotando la cronologia spariscono tutti i tipi: riallinea il menu come fa la rimozione
      // della singola voce, o resterebbero opzioni per dati che non esistono più.
      buildFilterOptions();
      render();
    });
    $('openArchive').addEventListener('click', () => {
      chrome.tabs.create({ url: 'filo://archive/archive.html' });
    });
    $('openHome').addEventListener('click', () => {
      // #252 — indirizzo canonico: una sola scheda per "Aperti per dopo".
      chrome.tabs.create({ url: 'filo://home/home.html' });
    });
    $('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
  });
})();
