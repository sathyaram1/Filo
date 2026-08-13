// Pagina elenco scaricamenti (#410.3). Legge la cronologia persistita dal
// gestore download del main (#410.1) e la mostra dal più recente. Ogni voce ha
// azioni puntuali (clic sinistro = azione primaria, tasto destro = menu con
// tutte le azioni). Gli scaricamenti in corso mostrano barra + percentuale live,
// aggiornate da un segnale broadcast del main (contentless: la pagina ri-legge
// la lista dal canale interno, così nessun percorso su disco viaggia verso le
// schede di siti esterni).

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const Storage = window.SN_STORAGE;
  const ICONS = window.SN_ICONS || {};

  function $(id) { return document.getElementById(id); }

  let items = [];

  const ACTIVE = new Set(['progressing', 'paused']);
  const isActive = (r) => r && ACTIVE.has(r.state);
  const isHttp = (u) => /^https?:/i.test(String(u || ''));

  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  function pct(r) {
    if (r.totalBytes > 0) return Math.min(100, Math.round((r.receivedBytes / r.totalBytes) * 100));
    return null; // indeterminato (server senza Content-Length)
  }
  function stateLabel(r) {
    switch (r.state) {
      case 'completed': return 'Completato';
      case 'cancelled': return 'Annullato';
      case 'interrupted': return 'Interrotto';
      case 'paused': return 'In pausa';
      default: return 'In corso';
    }
  }
  function formatDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleString('it-IT', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch (_) { return ''; }
  }

  // ─── feedback effimero (ogni azione riceve conferma, filo_design) ──────────
  let flashTimer = null;
  function flash(text) {
    let el = $('dl-flash');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dl-flash';
      el.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);'
        + 'background:var(--sn-fg);color:var(--sn-bg);padding:8px 14px;border-radius:8px;'
        + 'font-size:13px;z-index:9999;opacity:0;transition:opacity .15s ease;pointer-events:none;'
        + 'max-width:70vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      document.body.appendChild(el);
    }
    el.textContent = text;
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.style.opacity = '0'; }, 1800);
  }

  // ─── azioni (una sola implementazione, condivisa da bottoni e menu) ────────
  async function reload() {
    const r = await chrome.runtime.sendMessage({ type: MSG.DOWNLOADS_LIST });
    items = (r && r.items) || [];
    render();
  }

  async function openFile(r) {
    const res = await chrome.runtime.sendMessage({ type: MSG.DOWNLOAD_OPEN_FILE, id: r.id });
    if (res && res.ok === false) flash('Impossibile aprire il file');
  }
  async function openFolder(r) {
    const res = await chrome.runtime.sendMessage({ type: MSG.DOWNLOAD_OPEN_FOLDER, id: r.id });
    if (res && res.ok === false) flash('Cartella non disponibile');
  }
  async function copyPath(r) {
    const p = r.savePath || '';
    if (!p) { flash('Percorso non disponibile'); return; }
    try {
      await navigator.clipboard.writeText(p);
      flash('Percorso copiato');
    } catch (_) {
      // Ripiego per contesti senza clipboard API.
      try {
        const ta = document.createElement('textarea');
        ta.value = p; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
        flash('Percorso copiato');
      } catch (e) { flash('Copia non riuscita'); }
    }
  }
  async function redownload(r) {
    if (!isHttp(r.url)) { flash('Sorgente non disponibile per il ri-scaricamento'); return; }
    const res = await chrome.runtime.sendMessage({ type: MSG.DOWNLOAD_LINK, url: r.url });
    if (res && res.ok === false) flash('Ri-scaricamento non avviato');
    else flash('Ri-scaricamento avviato');
    // Il nuovo download comparirà via broadcast; ricarichiamo comunque subito.
    setTimeout(reload, 150);
  }
  async function removeItem(r) {
    const res = await chrome.runtime.sendMessage({ type: MSG.DOWNLOAD_REMOVE, id: r.id });
    items = (res && res.items) || items.filter((x) => x.id !== r.id);
    render();
  }
  async function pause(r) {
    await chrome.runtime.sendMessage({ type: MSG.DOWNLOAD_PAUSE, id: r.id });
    reload();
  }
  async function resume(r) {
    await chrome.runtime.sendMessage({ type: MSG.DOWNLOAD_RESUME, id: r.id });
    reload();
  }
  async function cancel(r) {
    await chrome.runtime.sendMessage({ type: MSG.DOWNLOAD_CANCEL, id: r.id });
    reload();
  }

  // ─── menu contestuale (tasto destro) — set completo di azioni ──────────────
  let openMenu = null;
  function closeCtxMenu() {
    if (!openMenu) return;
    openMenu.remove();
    openMenu = null;
    document.removeEventListener('mousedown', onOutsideClick, true);
    document.removeEventListener('keydown', onMenuKeydown, true);
    window.removeEventListener('scroll', closeCtxMenu, true);
    window.removeEventListener('resize', closeCtxMenu);
  }
  function onOutsideClick(e) { if (openMenu && !openMenu.contains(e.target)) closeCtxMenu(); }
  function onMenuKeydown(e) { if (e.key === 'Escape') closeCtxMenu(); }

  function menuActionsFor(r) {
    // Ogni voce dichiara label + handler; la lista dipende dallo stato così ogni
    // azione compare solo quando ha senso (niente "Apri file" su un download mai
    // completato). Invariante UX: si può sempre RIMUOVERE ciò che è in lista.
    const acts = [];
    if (isActive(r)) {
      // canPause === false: scaricamento "a mano" (Salva immagine/video come…),
      // che non si può sospendere. Meglio non offrire l'azione che offrirne una
      // muta.
      if (r.canPause !== false) {
        if (r.state === 'paused') acts.push(['Riprendi', () => resume(r)]);
        else acts.push(['Pausa', () => pause(r)]);
      }
      acts.push(['Annulla', () => cancel(r)]);
    } else if (r.state === 'completed') {
      acts.push(['Apri file', () => openFile(r)]);
      acts.push(['Apri cartella', () => openFolder(r)]);
    } else {
      // interrupted / cancelled: il file completo non c'è, ma la cartella e la
      // sorgente restano utili.
      acts.push(['Apri cartella', () => openFolder(r)]);
    }
    if (r.savePath) acts.push(['Copia percorso', () => copyPath(r)]);
    if (isHttp(r.url)) acts.push(['Ri-scarica', () => redownload(r)]);
    acts.push(['Rimuovi dalla lista', () => removeItem(r)]);
    return acts;
  }

  function openCtxMenu(x, y, r) {
    closeCtxMenu();
    const menu = document.createElement('div');
    menu.className = 'sn-select-pop dl-ctxmenu';
    menu.setAttribute('role', 'menu');
    for (const [label, fn] of menuActionsFor(r)) {
      const opt = document.createElement('div');
      opt.className = 'sn-select-option';
      opt.setAttribute('role', 'menuitem');
      opt.tabIndex = 0;
      opt.textContent = label;
      opt.addEventListener('click', () => { closeCtxMenu(); fn(); });
      opt.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeCtxMenu(); fn(); }
      });
      menu.appendChild(opt);
    }
    document.body.appendChild(menu);
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = `${Math.max(4, Math.min(x, vw - w - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, vh - h - 4))}px`;
    openMenu = menu;
    setTimeout(() => {
      document.addEventListener('mousedown', onOutsideClick, true);
      document.addEventListener('keydown', onMenuKeydown, true);
      window.addEventListener('scroll', closeCtxMenu, true);
      window.addEventListener('resize', closeCtxMenu);
    }, 0);
  }

  // ─── rendering ─────────────────────────────────────────────────────────────
  function renderItem(r) {
    const row = document.createElement('div');
    row.className = 'dl-item';
    row.dataset.state = r.state;
    row.dataset.id = r.id;
    row.tabIndex = 0;
    row.setAttribute('role', 'listitem');

    const icon = document.createElement('div');
    icon.className = 'dl-icon';
    icon.innerHTML = typeof ICONS.download === 'function' ? ICONS.download(22) : '';
    row.appendChild(icon);

    const name = document.createElement('div');
    name.className = 'dl-name';
    name.textContent = r.filename || 'download';
    name.title = r.filename || '';
    row.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'dl-meta';
    const p = pct(r);
    if (isActive(r)) {
      meta.textContent = p != null
        ? `${stateLabel(r)} · ${p}% · ${fmtBytes(r.receivedBytes)} / ${fmtBytes(r.totalBytes)}`
        : `${stateLabel(r)} · ${fmtBytes(r.receivedBytes)} scaricati`;
    } else {
      const size = fmtBytes(r.totalBytes || r.receivedBytes);
      meta.textContent = `${stateLabel(r)} · ${size} · ${formatDate(r.startedAt)}`;
    }
    row.appendChild(meta);

    // Riga 3: barra viva per gli attivi, altrimenti il percorso su disco.
    if (isActive(r)) {
      const bar = document.createElement('div');
      bar.className = 'dl-bar';
      const fill = document.createElement('div');
      fill.className = 'dl-fill';
      if (p == null) bar.classList.add('indeterminate');
      else fill.style.width = `${p}%`;
      bar.appendChild(fill);
      row.appendChild(bar);
    } else if (r.savePath) {
      const path = document.createElement('div');
      path.className = 'dl-path';
      path.textContent = r.savePath;
      path.title = r.savePath;
      row.appendChild(path);
    }

    // Bottoni rapidi inline (parità col menu contestuale, discoverabili senza
    // tasto destro). Il menu resta l'elenco completo.
    const actions = document.createElement('div');
    actions.className = 'dl-actions';
    const addBtn = (label, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dl-btn';
      b.textContent = label;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      actions.appendChild(b);
    };
    if (isActive(r)) {
      if (r.canPause !== false) {
        if (r.state === 'paused') addBtn('Riprendi', () => resume(r));
        else addBtn('Pausa', () => pause(r));
      }
      addBtn('Annulla', () => cancel(r));
    } else if (r.state === 'completed') {
      addBtn('Apri file', () => openFile(r));
      addBtn('Apri cartella', () => openFolder(r));
    } else if (isHttp(r.url)) {
      addBtn('Ri-scarica', () => redownload(r));
    }
    addBtn('Rimuovi', () => removeItem(r));
    row.appendChild(actions);

    // Clic sinistro sulla riga = azione primaria: apri il file se completato.
    if (r.state === 'completed') {
      row.addEventListener('click', () => openFile(r));
    }
    // Tasto destro = menu completo (centralità del tasto destro in Filo).
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openCtxMenu(e.clientX, e.clientY, r);
    });
    // Tastiera: Invio/Spazio = primaria (apri se completato); Menu/Shift+F10 = menu.
    row.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && r.state === 'completed') {
        e.preventDefault(); openFile(r);
      } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        const rect = row.getBoundingClientRect();
        openCtxMenu(rect.left, rect.bottom, r);
      }
    });
    return row;
  }

  function render() {
    const q = ($('search').value || '').trim().toLowerCase();
    const list = $('list');
    list.setAttribute('role', 'list');
    list.textContent = '';

    let filtered = items;
    if (q) {
      filtered = filtered.filter((r) => {
        const hay = [r.filename, r.url, r.savePath].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
    }

    // Conteggio (scaricamenti attivi evidenziati).
    const active = items.filter(isActive).length;
    $('count').textContent = items.length
      ? (active ? `${items.length} in elenco · ${active} in corso` : `${items.length} in elenco`)
      : '';

    if (!filtered.length) {
      const empty = $('empty');
      empty.textContent = (items.length && q)
        ? 'Nessuno scaricamento corrisponde alla ricerca.'
        : 'Non hai ancora scaricato nulla.';
      empty.hidden = false;
      return;
    }
    $('empty').hidden = true;

    for (const r of filtered) list.appendChild(renderItem(r));
  }

  // ─── live: il main segnala "qualcosa è cambiato" (senza dati) → ri-leggiamo ─
  let liveTimer = null;
  function scheduleReload() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(reload, 120);
  }

  async function load() {
    const settings = await Storage.getSettings();
    window.SN_PAGE_THEME = settings.theme;
    window.SN_PAGE_BOOTSTRAP.applyTheme(settings.theme);
    await reload();
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
    $('search').addEventListener('input', render);
    $('clear').addEventListener('click', async () => {
      const hasTerminal = items.some((r) => !isActive(r));
      if (!hasTerminal) { flash('Nessuno scaricamento concluso da rimuovere'); return; }
      const text = 'Rimuovere dall’elenco tutti gli scaricamenti conclusi? Gli scaricamenti in corso restano.';
      const ok = window.SN_CONFIRM_UI
        ? await window.SN_CONFIRM_UI.confirm({ title: 'Svuota elenco', text, okLabel: 'Svuota' })
        : window.confirm(text);
      if (!ok) return;
      const res = await chrome.runtime.sendMessage({ type: MSG.DOWNLOADS_CLEAR });
      items = (res && res.items) || [];
      render();
    });

    // Aggiornamenti live: il main pusha un segnale contentless quando parte/
    // avanza/finisce uno scaricamento. Ri-leggiamo la lista dal canale interno.
    if (chrome.runtime.onMessage && chrome.runtime.onMessage.addListener) {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === MSG.DOWNLOADS_UPDATED) scheduleReload();
      });
    }
  });
})();
