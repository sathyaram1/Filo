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

    await leggi();
  }

  async function leggi() {
    const r = await chrome.runtime.sendMessage({ type: MSG.GET_HISTORY });
    items = r?.items || [];
    buildFilterOptions();
    render();
    preparaRicerca();
  }

  // La prima lettera della ricerca non deve comporre il testo di migliaia di voci: lo si fa mentre la pagina è ferma.
  function preparaRicerca() {
    if (typeof requestIdleCallback !== 'function') return;
    const lista = items;
    let i = 0;
    const passo = (scadenza) => {
      while (i < lista.length && scadenza.timeRemaining() > 1) { if (lista[i]) haystackOf(lista[i]); i++; }
      if (i < lista.length && lista === items) requestIdleCallback(passo);
    };
    requestIdleCallback(passo);
  }
  // Un backup importato in un'altra scheda porta voci sue: compaiono senza riaprire la pagina (#1256).
  try {
    chrome.runtime.onMessage.addListener((msg) => { if (msg && msg.type === MSG.DATI_IMPORTATI) leggi().catch(() => {}); });
  } catch (_) {}

  // Il menu "filtra per tipo" elenca solo i tipi presenti, e per ETICHETTA, non
  // per codice: più codici interni portano lo stesso nome (#481), e la voce deve
  // tenere tutte le righe che mostrano quel nome.
  function buildFilterOptions() {
    const sel = $('filter');
    const current = sel.value;
    const seen = new Set();
    for (const it of items) {
      if (it && it.action) seen.add(formatActionLabel(it.action));
    }
    seen.delete('');
    const labels = [...seen].sort((x, y) => x.localeCompare(y, 'it'));

    sel.innerHTML = '';
    const all = document.createElement('option');
    all.value = '';
    all.textContent = I18n.t('history_filter_all');
    sel.appendChild(all);
    for (const label of labels) {
      const opt = document.createElement('option');
      opt.value = label;
      opt.textContent = label;
      sel.appendChild(opt);
    }
    sel.value = seen.has(current) ? current : '';
  }

  function render() {
    const q = ($('search').value || '').trim().toLowerCase();
    const filter = $('filter').value;
    const list = $('list');
    list.innerHTML = '';

    let filtered = items;
    if (filter) filtered = filtered.filter((it) => it && it.action && formatActionLabel(it.action) === filter);
    if (q) {
      filtered = filtered.filter((it) => {
        // Cerca SOLO sui testi che la voce mostra davvero — non su
        // JSON.stringify(it.input), che infilava nell'ago i NOMI dei campi
        // interni del payload (selection, userMessage, title, url…) e la
        // punteggiatura JSON, facendo "trovare" parole che l'utente non vede
        // da nessuna parte. Qui usiamo l'input formattato come in lista,
        // l'etichetta dell'azione, il modello, l'output e l'origine.
        return haystackOf(it).includes(q);
      });
    }

    shown = filtered;
    drawn = 0;
    if (!filtered.length) {
      showEmpty();
      return;
    }
    $('empty').hidden = true;
    drawMore();
  }

  // Distingui "cronologia realmente vuota" da "nessun risultato per la
  // ricerca/filtro": mostrare il testo di vuoto assoluto durante una
  // ricerca fa credere che la cronologia sia stata cancellata.
  function showEmpty() {
    const q = ($('search').value || '').trim();
    const empty = $('empty');
    if (fondo) fondo.hidden = true;
    if (items.length && q) empty.textContent = I18n.t('history_no_results');
    else if (items.length && $('filter').value) empty.textContent = I18n.t('history_no_results_filter');
    else empty.textContent = I18n.t('history_empty');
    empty.hidden = false;
  }

  // La cronologia non ha tetto (#1065): disegnarla tutta a ogni apertura e a ogni lettera della ricerca
  // blocca la pagina per secondi con qualche migliaio di voci. Si disegna un lotto, il resto mentre si scorre.
  const LOTTO = 100;
  let shown = [];
  let drawn = 0;
  let fondo = null;

  function drawMore() {
    const frag = document.createDocumentFragment();
    const fine = Math.min(shown.length, drawn + LOTTO);
    for (; drawn < fine; drawn++) frag.appendChild(renderItem(shown[drawn]));
    $('list').appendChild(frag);
    if (!fondo) return;
    fondo.hidden = drawn >= shown.length;
    // Una finestra alta può avere il fondo ancora in vista dopo il lotto: l'osservatore non riscatta da solo.
    if (!fondo.hidden) { osservatore.unobserve(fondo); osservatore.observe(fondo); }
  }

  const osservatore = new IntersectionObserver((voci) => {
    if (voci.some((v) => v.isIntersecting) && drawn < shown.length) drawMore();
  }, { rootMargin: '1200px 0px' });

  // Il testo in cui cerca una voce si compone una volta sola, non a ogni lettera per ogni voce.
  const haystacks = new WeakMap();
  function haystackOf(it) {
    let h = haystacks.get(it);
    if (h === undefined) {
      h = [
        formatActionLabel(it.action),
        formatInput(it.input),
        it.output || '',
        it.origin || '',
        it.model || '',
        // Quello che la riga mostra si deve poter cercare: l'host che ha servito e il segno di fornitore non ammesso.
        it.servedBy || '',
        it.policyViolation ? I18n.t('history_policy_violation') : '',
      ].join(' ').toLowerCase();
      haystacks.set(it, h);
    }
    return h;
  }

  function renderItem(it) {
    const wrap = document.createElement('div');
    wrap.className = 'sn-history-item';

    const meta = document.createElement('div');
    meta.className = 'sn-history-meta';
    const left = document.createElement('span');
    // Chi ha davvero servito la risposta: rende verificabile la politica sui fornitori.
    const via = it.servedBy ? ` • via ${it.servedBy}` : '';
    left.textContent = `${formatActionLabel(it.action)} • ${it.model || ''}${via} • ${formatDate(it.timestamp)}`;
    meta.appendChild(left);
    // Servita da un fornitore non ammesso: la voce lo dice, non solo il log.
    if (it.policyViolation) {
      const warn = document.createElement('span');
      warn.className = 'sn-history-policy-warn';
      warn.textContent = I18n.t('history_policy_violation');
      warn.title = I18n.t('history_policy_violation_title');
      left.appendChild(warn);
    }
    const right = document.createElement('span');
    right.className = 'sn-history-meta-right';
    // Quanta parte del prompt il fornitore ha riusato: è il modo di vedere se tenere le
    // istruzioni fisse in testa funziona — se resta a zero, non funziona.
    const inTok = Number(it.usage?.promptTokens) || 0;
    if (inTok > 0) {
      const reused = Number(it.usage?.cachedPromptTokens) || 0;
      const pct = Math.round((reused / inTok) * 100);
      const chip = document.createElement('span');
      chip.className = 'sn-history-reuse';
      chip.textContent = I18n.t('history_reuse', String(pct));
      // Le scritture le riportano i modelli coi punti di cache espliciti: dicono che la richiesta dopo potrà riusare.
      const written = Number(it.usage?.cacheWriteTokens) || 0;
      chip.title = (reused > 0
        ? I18n.t('history_reuse_title', formatTokens(reused), formatTokens(inTok))
        : I18n.t('history_reuse_none_title', formatTokens(inTok)))
        + (written > 0 ? ` ${I18n.t('history_cache_written', formatTokens(written))}` : '');
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
      // L'attesa prima della richiesta (stato del computer, saldo) la vive chi aspetta: compare per prima (#1097.1).
      const prima = tm.preparazioneMs != null;
      chip.textContent = (prima ? I18n.t('history_timing_prep', fmt(tm.preparazioneMs)) : '')
        + I18n.t('history_timing', fmt(tm.firstReasoningMs), fmt(first), fmt(tm.totalMs));
      chip.title = I18n.t('history_timing_title')
        + (prima ? `\n${I18n.t('history_timing_prep_title', fmt(tm.preparazioneMs), fmt(tm.sistemaMs), fmt(tm.saldoMs))}` : '');
      right.appendChild(chip);
    }

    const cost = document.createElement('span');
    cost.textContent = it.costEur ? `€${it.costEur.toFixed(4)}` : '—';
    right.appendChild(cost);

    // Compare all'hover per non appesantire la lista.
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'sn-history-remove';
    remove.textContent = I18n.t('history_remove');
    remove.title = I18n.t('history_remove_title');
    remove.addEventListener('click', async (e) => {
      e.stopPropagation();
      const r = await chrome.runtime.sendMessage({ type: MSG.REMOVE_HISTORY_ENTRY, id: it.id });
      items = r?.items || items.filter((x) => x.id !== it.id);
      preparaRicerca();
      // Un tipo d'azione può essere scomparso del tutto: riallinea il filtro.
      const prima = $('filter').value;
      buildFilterOptions();
      if ($('filter').value !== prima) { render(); return; }
      // Ridisegnare da capo riporterebbe in cima chi ha scorso fino a questa voce: si toglie solo lei.
      const i = shown.indexOf(it);
      if (i >= 0) { shown = shown.filter((x) => x !== it); if (i < drawn) drawn--; }
      wrap.remove();
      if (!shown.length) showEmpty();
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

  function formatTokens(n) {
    return Number(n || 0).toLocaleString('it-IT', { useGrouping: true });
  }

  document.addEventListener('DOMContentLoaded', () => {
    fondo = document.createElement('div');
    fondo.className = 'sn-history-fondo';
    fondo.hidden = true;
    fondo.style.height = '1px';
    $('list').after(fondo);
    osservatore.observe(fondo);
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
      // Svuotando la cronologia spariscono tutti i tipi: riallinea il menu, o resterebbero
      // opzioni per dati che non esistono più.
      buildFilterOptions();
      render();
    });
    $('openArchive').addEventListener('click', () => {
      chrome.tabs.create({ url: 'filo://quaderno/quaderno.html' });
    });
    $('openHome').addEventListener('click', () => {
      // #252 — indirizzo canonico: una sola scheda per "Aperti per dopo".
      chrome.tabs.create({ url: 'filo://home/home.html' });
    });
    $('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
  });
})();
