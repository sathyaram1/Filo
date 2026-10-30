// Elenco scaricamenti: cronologia persistita dal main, dal più recente.
// Clic sinistro = azione primaria, tasto destro = menu completo.
// Gli aggiornamenti live non portano contenuto: nessun percorso su disco va alle schede.

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
      case 'pending': return 'In attesa di conferma';
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

  let flashTimer = null;
  // Un errore letto qui si conta come nella barra delle schede, per chiave dell'elenco chiuso (#1461): mai il testo.
  function flashErrore(text, chiave) {
    try { Promise.resolve(chrome.runtime.sendMessage({ type: MSG.CONTATORI_EVENTO, misura: 'avviso', chiave })).catch(() => {}); } catch (_) {}
    flash(text);
  }
  function flash(text) {
    let el = $('dl-flash');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dl-flash';
      el.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);'
        + 'background:var(--sn-fg);color:var(--sn-bg);padding:8px 14px;border-radius:8px;'
        + 'font-size:13px;z-index:9999;opacity:0;transition:opacity calc(.15s * var(--sn-motion, 1)) ease;pointer-events:none;'
        + 'max-width:70vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      document.body.appendChild(el);
    }
    el.textContent = text;
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.style.opacity = '0'; }, 1800);
  }

  // Una sola implementazione delle azioni, condivisa da bottoni e menu.
  async function reload() {
    const r = await chrome.runtime.sendMessage({ type: MSG.DOWNLOADS_LIST });
    items = (r && r.items) || [];
    render();
  }

  // Il file di uno scaricamento concluso può sparire dopo (spostato, rinominato,
  // cestinato): il main se ne accorge guardando il disco e risponde
  // { ok:false, missing:true, error } con la frase da mostrare. La riga viene
  // ridisegnata subito come "non più disponibile", così l'utente non riprova.
  async function openFile(r, confirmed) {
    const res = await chrome.runtime.sendMessage({ type: MSG.DOWNLOAD_OPEN_FILE, id: r.id, confirmed: !!confirmed });
    if (!res || res.ok !== false) return;
    // #588 — è un programma: il main non lo apre finché non torna un sì. Il
    // popup lo chiede qui, con le parole che il main ha scritto per l'utente.
    if (res.needsConfirm) {
      const ok = window.SN_CONFIRM_UI
        ? await window.SN_CONFIRM_UI.confirm({ title: res.title, text: res.text, parti: res.parti, okLabel: 'Apri comunque' })
        : window.confirm(res.text);
      if (ok) await openFile(r, true);
      return;
    }
    flashErrore(res.error || 'Impossibile aprire il file', 'file_non_aperto');
    if (res.missing) reload();
  }

  // Risposta all'avviso "questo è un programma: scaricarlo?" (#588). La stessa
  // che offre la barra in alto: chi ha chiuso l'avviso la ritrova qui.
  async function confirmExe(r, allow) {
    const res = await chrome.runtime.sendMessage({ type: MSG.DOWNLOAD_CONFIRM, id: r.id, allow: !!allow });
    items = (res && res.items) || items;
    render();
    // Due clic di fretta sulla stessa voce: la seconda risposta non ha più
    // niente a cui rispondere, e dirlo è meglio che confermare due volte.
    if (res && res.ok === false) { flash(res.error || 'Risposta non registrata'); return; }
    flash(allow ? 'Scaricamento avviato' : 'Programma non scaricato');
  }
  async function openFolder(r) {
    const res = await chrome.runtime.sendMessage({ type: MSG.DOWNLOAD_OPEN_FOLDER, id: r.id });
    if (!res) return;
    if (res.ok === false) { flashErrore(res.error || 'Cartella non disponibile', 'cartella_non_aperta'); if (res.missing) reload(); return; }
    // Cartella aperta ma senza il file dentro: dillo, invece di lasciarlo cercare.
    if (res.missing) { flashErrore('Il file non c’è più: ho aperto la cartella dov’era', 'file_non_aperto'); reload(); }
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
  // #1287 — uno scaricamento fallito riparte nella stessa riga, dallo stesso indirizzo.
  async function riprova(r) {
    const res = await chrome.runtime.sendMessage({ type: MSG.DOWNLOAD_RIPROVA, id: r.id });
    if (res && res.items) items = res.items;
    render();
    if (res && res.ok === false) flashErrore(res.error || 'Non sono riuscito a far ripartire lo scaricamento', 'download_failed');
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

  // #950 — nome sensato: la voce c'è solo se Filo sa leggere quel file e ha un modello per farlo.
  const Rinomina = window.SN_RINOMINA_UI;
  let nomiDisponibili = false;
  function aggiornaDisponibilita() {
    if (!Rinomina) return;
    Rinomina.disponibile().then((v) => { nomiDisponibili = v; }).catch(() => {});
  }
  const rigaDi = (r) => Array.from(document.querySelectorAll('.dl-item')).find((x) => x.dataset.id === r.id);
  function daiNome(r) {
    const ancora = rigaDi(r);
    if (!Rinomina || !ancora) return;
    Rinomina.apri({ ancora, downloadId: r.id, nome: r.filename, suRinominato: reload, suRimesso: reload });
  }
  async function rimettiNome(r) {
    const res = await chrome.runtime.sendMessage({ type: MSG.DOWNLOAD_RIMETTI_NOME, id: r.id });
    if (res && res.ok) flash(res.cambiato ? `Il nome di prima era preso: ora è ${res.nome}` : `Nome di prima rimesso: ${res.nome}`);
    else flash((res && res.frase) || 'Non sono riuscito a rimettere il nome di prima');
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
    // Ogni azione compare solo quando ha senso (niente «Apri file» su un download mai finito).
    // Invariante UX: si può sempre RIMUOVERE ciò che è in lista.
    const acts = [];
    if (r.state === 'pending') {
      acts.push(['Scarica', () => confirmExe(r, true)]);
      acts.push(['Non scaricare', () => confirmExe(r, false)]);
    } else if (isActive(r)) {
      // canPause === false: scaricamento "a mano" (Salva immagine/video come…),
      // che non si può sospendere. Meglio non offrire l'azione che offrirne una
      // muta.
      if (r.canPause !== false) {
        if (r.state === 'paused') acts.push(['Riprendi', () => resume(r)]);
        else acts.push(['Pausa', () => pause(r)]);
      }
      acts.push(['Annulla', () => cancel(r)]);
    } else if (r.state === 'completed') {
      // Senza il file «Apri file» non ha niente da aprire: restano la cartella e «Ri-scarica».
      if (!r.missing) acts.push(['Apri file', () => openFile(r)]);
      acts.push(['Apri cartella', () => openFolder(r)]);
      if (!r.missing && !r.exe && nomiDisponibili && Rinomina && Rinomina.tipoSupportato(r.filename)) {
        acts.push([Rinomina.VOCE, () => daiNome(r)]);
      }
      if (!r.missing && r.nomeOriginale) acts.push(['Rimetti il nome di prima', () => rimettiNome(r)]);
    } else {
      // interrupted/cancelled: il file completo non c'è, ma cartella e sorgente restano utili.
      acts.push(['Apri cartella', () => openFolder(r)]);
    }
    if (r.savePath) acts.push(['Copia percorso', () => copyPath(r)]);
    if (isHttp(r.url)) acts.push(r.state === 'interrupted' ? ['Riprova', () => riprova(r)] : ['Ri-scarica', () => redownload(r)]);
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
    document.addEventListener('keydown', onMenuKeydown, true);
    setTimeout(() => {
      if (openMenu !== menu) return;
      document.addEventListener('mousedown', onOutsideClick, true);
      window.addEventListener('scroll', closeCtxMenu, true);
      window.addEventListener('resize', closeCtxMenu);
    }, 0);
  }

  function renderItem(r) {
    const row = document.createElement('div');
    row.className = 'dl-item';
    row.dataset.state = r.state;
    // File non più al suo posto: la voce si attenua e perde «Apri file», prima ancora del clic.
    if (r.missing) row.dataset.missing = '1';
    row.dataset.id = r.id;
    row.tabIndex = 0;
    row.setAttribute('role', 'listitem');

    const icon = document.createElement('div');
    icon.className = 'dl-icon';
    icon.innerHTML = typeof ICONS.download === 'function' ? ICONS.download(22) : '';
    row.appendChild(icon);

    const name = document.createElement('div');
    name.className = 'dl-name';
    // #588 — la marca precede il nome: l'estensione sta in coda a un testo che
    // sceglie il sito, e non è lì che l'occhio guarda.
    if (r.exe) {
      const tag = document.createElement('span');
      tag.className = 'dl-tag';
      tag.textContent = 'Programma';
      name.appendChild(tag);
    }
    name.appendChild(document.createTextNode(r.filename || 'download'));
    name.title = r.nomeOriginale ? `${r.filename || ''}\nArrivato come: ${r.nomeOriginale}` : (r.filename || '');
    row.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'dl-meta';
    const p = pct(r);
    if (isActive(r)) {
      const base = p != null
        ? `${stateLabel(r)} · ${p}% · ${fmtBytes(r.receivedBytes)} / ${fmtBytes(r.totalBytes)}`
        : `${stateLabel(r)} · ${fmtBytes(r.receivedBytes)} scaricati`;
      let corsa = '';
      try { corsa = window.SN_SCARICAMENTI_AVANZAMENTO.velocitaEResto(r); } catch (_) {}
      meta.textContent = corsa ? `${base} · ${corsa}` : base;
    } else if (r.state === 'pending') {
      // Da quale sito arriva è la cosa su cui si decide: sta nella riga, non
      // solo nell'avviso che l'utente può aver già chiuso.
      let da = r.site ? ` · da ${r.site}` : '';
      try { const t = window.SN_ESEGUIBILI.provenienza(r.site, r.siteUncertain, r.servedBy, r.filename); da = t ? ` · ${t}` : ''; } catch (_) {}
      meta.textContent = `${stateLabel(r)}${da} · ${formatDate(r.startedAt)}`;
    } else {
      const size = fmtBytes(r.totalBytes || r.receivedBytes);
      const label = r.missing ? 'Non più sul disco' : stateLabel(r);
      meta.textContent = `${label} · ${size} · ${formatDate(r.startedAt)}`;
    }
    row.appendChild(meta);

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

    // Bottoni inline per scoprire le azioni senza tasto destro; il menu resta l'elenco completo.
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
    if (r.state === 'pending') {
      addBtn('Scarica', () => confirmExe(r, true));
      addBtn('Non scaricare', () => confirmExe(r, false));
    } else if (isActive(r)) {
      if (r.canPause !== false) {
        if (r.state === 'paused') addBtn('Riprendi', () => resume(r));
        else addBtn('Pausa', () => pause(r));
      }
      addBtn('Annulla', () => cancel(r));
    } else if (r.state === 'completed' && !r.missing) {
      addBtn('Apri file', () => openFile(r));
      addBtn('Apri cartella', () => openFolder(r));
    } else if (r.missing) {
      // Senza il file la cosa utile è riaverlo; la cartella resta a portata dal tasto destro.
      if (isHttp(r.url)) addBtn('Ri-scarica', () => redownload(r));
    } else if (r.state === 'interrupted' && isHttp(r.url)) {
      addBtn('Riprova', () => riprova(r));
    } else if (isHttp(r.url)) {
      addBtn('Ri-scarica', () => redownload(r));
    }
    addBtn('Rimuovi', () => removeItem(r));
    row.appendChild(actions);

    // #588.8 — il file si trascina dalla sua riga dove serve: un campo per caricare file, la chat, il desktop.
    if (r.state === 'completed' && !r.missing) {
      row.draggable = true;
      row.dataset.trascina = '1';
      row.addEventListener('dragstart', (e) => {
        e.preventDefault();
        chrome.runtime.sendMessage({ type: MSG.DOWNLOAD_TRASCINA, id: r.id }).then((res) => {
          if (res && res.ok === false) { flashErrore(res.error || 'Non sono riuscito a prendere il file', 'file_non_aperto'); if (res.missing) reload(); }
        }).catch(() => {});
      });
    }

    // Clic sinistro = azione primaria: apre solo se completato e il file c'è ancora.
    if (r.state === 'completed' && !r.missing) {
      row.addEventListener('click', () => openFile(r));
    }
    // Tasto destro = menu completo (centralità del tasto destro in Filo). La riga può restare in pagina a più
    // ridisegni (SN_RIGHE_VIVE): il menu si costruisce sulla voce di ADESSO, non su quella che l'ha creata.
    const attuale = () => items.find((x) => x.id === r.id) || r;
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openCtxMenu(e.clientX, e.clientY, attuale());
    });
    // Tastiera: Invio/Spazio = primaria (apri se completato); Menu/Shift+F10 = menu.
    row.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && r.state === 'completed' && !r.missing) {
        e.preventDefault(); openFile(r);
      } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        const rect = row.getBoundingClientRect();
        openCtxMenu(rect.left, rect.bottom, attuale());
      }
    });
    return row;
  }

  function render() {
    const q = ($('search').value || '').trim().toLowerCase();
    const list = $('list');
    list.setAttribute('role', 'list');

    let filtered = items;
    if (q) {
      filtered = filtered.filter((r) => {
        const hay = [r.filename, r.nomeOriginale, r.url, r.savePath].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
    }

    const active = items.filter(isActive).length;
    $('count').textContent = items.length
      ? (active ? `${items.length} in elenco · ${active} in corso` : `${items.length} in elenco`)
      : '';

    if (!filtered.length) {
      const empty = $('empty');
      empty.textContent = (items.length && q)
        ? 'Nessun download corrisponde alla ricerca.'
        : 'Non hai ancora scaricato nulla.';
      empty.hidden = false;
      list.textContent = '';
      return;
    }
    $('empty').hidden = true;

    if (window.SN_RIGHE_VIVE) window.SN_RIGHE_VIVE.riconcilia(list, filtered.map(renderItem), ':scope > .dl-actions');
    else list.replaceChildren(...filtered.map(renderItem));
  }

  let liveTimer = null;
  function scheduleReload() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(reload, 120);
  }

  async function load() {
    const settings = await Storage.getSettings();
    window.SN_PAGE_THEME = settings.theme;
    window.SN_PAGE_BOOTSTRAP.applyTheme(settings.theme);
    aggiornaDisponibilita();
    await reload();
    // Il tasto destro del pannello degli scaricamenti in alto porta qui, col riquadro aperto su quel file.
    const daRinominare = new URLSearchParams(location.search).get('rinomina');
    if (daRinominare) {
      try { history.replaceState(null, '', location.pathname); } catch (_) {}
      const r = items.find((x) => x.id === daRinominare);
      if (r) daiNome(r);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
    $('search').addEventListener('input', render);
    $('clear').addEventListener('click', async () => {
      // Una voce in attesa di conferma NON è conclusa: "Svuota" non deve
      // promettere di toglierla (il main la tiene, e giustamente) (#588).
      const hasTerminal = items.some((r) => !isActive(r) && r.state !== 'pending');
      if (!hasTerminal) { flash('Nessun download concluso da rimuovere'); return; }
      const text = 'Rimuovere dall’elenco tutti i download conclusi? Quelli in corso restano.';
      const ok = window.SN_CONFIRM_UI
        ? await window.SN_CONFIRM_UI.confirm({ title: 'Svuota elenco', text, okLabel: 'Svuota' })
        : window.confirm(text);
      if (!ok) return;
      const res = await chrome.runtime.sendMessage({ type: MSG.DOWNLOADS_CLEAR });
      items = (res && res.items) || [];
      render();
    });

    // Tornando qui dopo aver spostato o cancellato i file da fuori la lista va riletta: nessun
    // evento annuncia una cartella svuotata, e le voci resterebbero «aperibili».
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { scheduleReload(); aggiornaDisponibilita(); }
    });
    window.addEventListener('focus', () => { scheduleReload(); aggiornaDisponibilita(); });

    // Il main segnala ogni cambiamento senza contenuto: la lista si rilegge dal canale interno.
    if (chrome.runtime.onMessage && chrome.runtime.onMessage.addListener) {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === MSG.DOWNLOADS_UPDATED) scheduleReload();
        // Il ritorno sulla scheda: in una scheda di Filo `visibilitychange`
        // non arriva, lo annuncia il main.
        if (msg && msg.type === MSG.TAB_IN_VISTA && msg.inVista) { scheduleReload(); aggiornaDisponibilita(); }
      });
    }
  });
})();
