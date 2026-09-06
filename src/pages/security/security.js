// Logica pagina Sicurezza: due toggle (proteggi IP via WebRTC + blocca popup)
// + box informativo sui servizi P2P. Le impostazioni sono in settings.security.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const I18n = window.SN_I18N;
  const Storage = window.SN_STORAGE;
  const Bootstrap = window.SN_PAGE_BOOTSTRAP;

  function $(id) { return document.getElementById(id); }

  // Estrae l'host del fornitore proxy dal template datacenter configurato
  // (es. 'socks5://user-{country}:pass@gate.provider.com:7000' → 'gate.provider.com').
  // Ritorna '' se non configurato o non parsabile. La pagina mostra l'host per
  // dichiarare onestamente per chi passa il traffico delle tab "da un altro paese".
  function proxyProviderHost(proxy) {
    const tmpl = String((proxy && proxy.datacenter) || '').trim();
    if (!tmpl) return '';
    const filled = tmpl.replace(/\{country\}/gi, 'us');
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(filled) ? filled : `socks5://${filled}`;
    try { return new URL(withScheme).hostname || ''; } catch (_) { return ''; }
  }

  function fillStaticText() {
    document.title = I18n.t('security_title');
    $('title').textContent = I18n.t('security_title');
    $('sec-protect-ip-label').textContent = I18n.t('options_security_protect_ip');
    $('sec-protect-ip-desc').textContent = I18n.t('options_security_protect_ip_desc');
    $('sec-block-popups-label').textContent = I18n.t('options_security_block_popups');
    $('sec-block-popups-desc').textContent = I18n.t('options_security_block_popups_desc');
    $('sec-adblock-label').textContent = I18n.t('options_security_adblock');
    $('sec-adblock-desc').textContent = I18n.t('options_security_adblock_desc');
    $('sec-siteblock-label').textContent = I18n.t('options_security_siteblock');
    $('sec-siteblock-desc').textContent = I18n.t('options_security_siteblock_desc');
    $('sec-siteblock-lists-label').textContent = I18n.t('options_security_siteblock_lists');
    $('sec-siteblock-blacklist-label').textContent = I18n.t('options_security_siteblock_blacklist_label');
    $('sec-p2p-box-title').textContent = I18n.t('options_security_p2p_box_title');
    $('sec-p2p-box-body').textContent = I18n.t('options_security_p2p_box_body');
    $('sec-proxy-box-title').textContent = I18n.t('options_security_proxy_box_title');
    $('sec-proxy-box-body').textContent = I18n.t('options_security_proxy_box_body');
    $('sec-safebrowse-label').textContent = I18n.t('options_security_safebrowse');
    $('sec-safebrowse-desc').textContent = I18n.t('options_security_safebrowse_desc');
    $('sec-safebrowse-network-label').textContent = I18n.t('options_security_safebrowse_network');
    $('sec-safebrowse-network-desc').textContent = I18n.t('options_security_safebrowse_network_desc');
    $('sec-safebrowse-llm-label').textContent = I18n.t('options_security_safebrowse_llm');
    $('sec-safebrowse-llm-desc').textContent = I18n.t('options_security_safebrowse_llm_desc');
    $('sec-safebrowse-sandbox-label').textContent = I18n.t('options_security_safebrowse_sandbox');
    $('sec-safebrowse-sandbox-desc').textContent = I18n.t('options_security_safebrowse_sandbox_desc');
    $('sec-safebrowse-key-managed').textContent = I18n.t('options_security_safebrowse_key_managed');
    $('sec-cookies-title').textContent = I18n.t('options_cookies_title');
    $('sec-cookies-desc').textContent = I18n.t('options_cookies_desc');
    $('cookie-mode-manual-label').textContent = I18n.t('options_cookies_mode_manual');
    $('cookie-mode-manual-desc').textContent = I18n.t('options_cookies_mode_manual_desc');
    $('cookie-mode-default-label').textContent = I18n.t('options_cookies_mode_default');
    $('cookie-mode-default-desc').textContent = I18n.t('options_cookies_mode_default_desc');
    $('cookie-mode-privacy-label').textContent = I18n.t('options_cookies_mode_privacy');
    $('cookie-mode-privacy-desc').textContent = I18n.t('options_cookies_mode_privacy_desc');
    $('sec-cookies-wl-title').textContent = I18n.t('options_cookies_whitelist_title');
    $('sec-cookies-wl-desc').textContent = I18n.t('options_cookies_whitelist_desc');
    $('sec-cookies-trusted-note').textContent = I18n.t('options_cookies_trusted_note_other');
    $('cookie-wl-input').placeholder = I18n.t('options_cookies_whitelist_placeholder');
    $('cookie-wl-add-btn').textContent = I18n.t('options_cookies_whitelist_add');
    $('sec-fp-title').textContent = I18n.t('options_fp_title');
    $('sec-fp-desc').textContent = I18n.t('options_fp_desc');
    $('fp-mode-off-label').textContent = I18n.t('options_fp_mode_off');
    $('fp-mode-off-desc').textContent = I18n.t('options_fp_mode_off_desc');
    $('fp-mode-default-label').textContent = I18n.t('options_fp_mode_default');
    $('fp-mode-default-desc').textContent = I18n.t('options_fp_mode_default_desc');
    $('fp-mode-privacy-label').textContent = I18n.t('options_fp_mode_privacy');
    $('fp-mode-privacy-desc').textContent = I18n.t('options_fp_mode_privacy_desc');
    $('sec-auto-feedback-label').textContent = I18n.t('options_security_auto_feedback');
    $('sec-auto-feedback-desc').textContent = I18n.t('options_security_auto_feedback_desc');
    $('sec-clip-title').textContent = I18n.t('security_clipboard_title');
    $('sec-clip-desc').textContent = I18n.t('security_clipboard_desc');
    $('sec-clip-empty').textContent = I18n.t('security_clipboard_empty');
    $('sec-clip-noresults').textContent = I18n.t('security_clipboard_no_results');
    $('sec-clip-search').placeholder = I18n.t('security_clipboard_search');
    $('sec-clip-search').setAttribute('aria-label', I18n.t('security_clipboard_search'));
    $('sec-clip-clear').textContent = I18n.t('menu_paste_clear');
    $('sec-export-btn').textContent = I18n.t('security_export_btn');
    $('sec-export-desc').textContent = I18n.t('security_export_desc');
    $('sec-import-btn').textContent = I18n.t('security_import_btn');
    $('sec-import-desc').textContent = I18n.t('security_import_desc');
    $('savedHint').textContent = I18n.t('options_saved');
  }

  async function exportData() {
    const btn = $('sec-export-btn');
    const hint = $('sec-export-hint');
    btn.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.EXPORT_DATA });
      if (res && res.ok) {
        hint.textContent = I18n.t('security_export_done');
        hint.classList.remove('sn-error');
        hint.classList.add('sn-show');
      } else if (res && res.canceled) {
        // L'utente ha annullato il dialog: nessun messaggio.
      } else {
        hint.textContent = I18n.t('security_export_fail');
        hint.classList.add('sn-show', 'sn-error');
      }
    } catch (_) {
      hint.textContent = I18n.t('security_export_fail');
      hint.classList.add('sn-show', 'sn-error');
    } finally {
      btn.disabled = false;
      clearTimeout(exportData._t);
      exportData._t = setTimeout(() => hint.classList.remove('sn-show'), 2500);
    }
  }

  // Metà mancante dell'esportazione: ricarica un .zip esportato da Filo.
  // Due passi voluti — prima leggiamo il file e diciamo COSA contiene, poi
  // chiediamo conferma: l'utente sa cosa sta per rimettere dentro prima di
  // dire sì. Il popup è quello di Filo (SN_CONFIRM_UI), mai il confirm nativo.
  function showImportHint(text, isError) {
    const hint = $('sec-import-hint');
    hint.textContent = text;
    hint.classList.toggle('sn-error', !!isError);
    hint.classList.add('sn-show');
    clearTimeout(importData._t);
    importData._t = setTimeout(() => hint.classList.remove('sn-show'), 4000);
  }

  async function importData() {
    const btn = $('sec-import-btn');
    btn.disabled = true;
    try {
      const prev = await chrome.runtime.sendMessage({ type: MSG.IMPORT_DATA_PREVIEW });
      if (!prev || !prev.ok) {
        if (prev && prev.canceled) return; // dialog annullato: nessun messaggio
        showImportHint(
          I18n.t(prev && prev.error === 'invalid_file' ? 'security_import_invalid' : 'security_import_fail'),
          true,
        );
        return;
      }

      // Data del backup in chiaro, quando il file la dichiara.
      let when = '';
      if (prev.exportedAt) {
        const d = new Date(prev.exportedAt);
        if (!isNaN(d.getTime())) when = ` (del ${d.toLocaleDateString()})`;
      }
      const sezioni = prev.sections === 1 ? '1 sezione di dati' : `${prev.sections} sezioni di dati`;
      const immagini = prev.images === 0
        ? 'nessuna immagine'
        : (prev.images === 1 ? '1 immagine' : `${prev.images} immagini`);
      const text = I18n.t('security_import_confirm_text')
        .replace('%1', prev.fileName || '')
        .replace('%2', when)
        .replace('%3', sezioni)
        .replace('%4', immagini);

      const ok = window.SN_CONFIRM_UI
        ? await window.SN_CONFIRM_UI.confirm({
          title: I18n.t('security_import_confirm_title'),
          text,
          okLabel: I18n.t('security_import_confirm_ok'),
        })
        : true;
      if (!ok) return;

      const res = await chrome.runtime.sendMessage({
        type: MSG.IMPORT_DATA_APPLY,
        token: prev.token,
      });
      if (res && res.ok) {
        showImportHint(I18n.t('security_import_done'), false);
        // I dati appena rimessi dentro devono comparire: la pagina si ricarica
        // per mostrare le impostazioni importate invece di quelle vecchie.
        setTimeout(() => location.reload(), 1200);
      } else {
        showImportHint(I18n.t('security_import_fail'), true);
      }
    } catch (_) {
      showImportHint(I18n.t('security_import_fail'), true);
    } finally {
      btn.disabled = false;
    }
  }

  // ─── cronologia appunti (#256) ────────────────────────────────────────────
  //
  // Le stesse due azioni del menu "Incolla" (togli una voce, svuota tutto), ma
  // raggiungibili SEMPRE. Nel menu del tasto destro la cronologia compare solo
  // dentro un campo di testo: chi ha copiato una password mentre leggeva un
  // articolo non ha nessun campo da cliccare, e finiva per non poterla togliere
  // proprio quando gli premeva di più. Questa pagina è l'ingresso che mancava.
  //
  // La lista viene sempre da quella che risponde il main (che è anche quella su
  // disco): dopo ogni rimozione riprendiamo `items` dalla risposta invece di
  // togliere il nodo e sperare — così la pagina non può raccontare una
  // cronologia diversa da quella che c'è davvero.

  // Chiave ed etichetta di una voce le decide il modulo condiviso: la stessa
  // regola vale nel menu "Incolla" e in chi tiene la cronologia su disco.
  const Clip = window.SN_CLIPBOARD;
  const clipKey = (entry) => Clip.chiave(entry);
  const clipLabel = (entry) => Clip.etichetta(entry);

  function showClipHint(text, isError) {
    const hint = $('sec-clip-hint');
    hint.textContent = text;
    hint.classList.toggle('sn-error', !!isError);
    hint.classList.add('sn-show');
    clearTimeout(showClipHint._t);
    showClipHint._t = setTimeout(() => hint.classList.remove('sn-show'), 2500);
  }

  // Filtro di ricerca: la cronologia tiene fino a cinquanta voci e nel riquadro
  // se ne vedono sette per volta. Cercare "la password copiata stamattina"
  // scorrendo a mano è lo stesso attrito che nel menu "Incolla" era già stato
  // tolto con un campo di ricerca: qui è la stessa lista, quindi lo stesso campo.
  let clipVisibili = 0;

  function applyClipFilter() {
    const q = ($('sec-clip-search').value || '').trim().toLowerCase();
    const righe = $('sec-clip-list').querySelectorAll('.sn-clip-item');
    let visibili = 0;
    for (const r of righe) {
      const match = !q || (r.dataset.snSearch || '').includes(q);
      r.style.display = match ? '' : 'none';
      if (match) visibili++;
    }
    clipVisibili = visibili;
    const nessuno = righe.length > 0 && visibili === 0;
    $('sec-clip-noresults').style.display = nessuno ? '' : 'none';
  }

  // ── la lista non si muove sotto la mano ───────────────────────────────────
  //
  // Togliere una riga e ricompattare subito la lista sposta di una posizione
  // tutte quelle sotto, e il clic successivo colpisce la voce sbagliata: un
  // doppio clic sul "Rimuovi" ne portava via due (quella mirata e la vicina), e
  // bastava che una copia fatta in un'altra scheda entrasse in cima mentre stavi
  // mirando per cancellare il vicino di sopra. Su voci che spariscono per sempre
  // è il danno peggiore possibile.
  //
  // Quindi: finché il puntatore è dentro la lista, NESSUNA riga cambia posto.
  // La voce tolta resta al suo posto barrata, e le liste nuove aspettano. Appena
  // il puntatore esce, la lista si ricompone.
  let vociCorrenti = [];      // l'ultima lista vera arrivata dal main
  let inAttesa = null;        // lista da disegnare appena il puntatore esce
  let puntatoreDentro = false;

  function segnaSparite(entries) {
    const vive = new Set(entries.map(clipKey));
    for (const row of $('sec-clip-list').querySelectorAll('.sn-clip-item')) {
      if (row.classList.contains('sn-clip-gone')) continue;
      if (vive.has(row.dataset.snKey)) continue;
      row.classList.add('sn-clip-gone');
      const btn = row.querySelector('.sn-clip-remove');
      if (btn) {
        btn.disabled = true;
        btn.textContent = I18n.t('security_clipboard_gone');
        btn.title = '';
      }
    }
  }

  // Avviso sotto la lista (mai sopra: una riga in più in cima sposterebbe di
  // nuovo tutto) quando ci sono voci nuove che aspettano.
  function aggiornaAvvisoInAttesa() {
    const el = $('sec-clip-pending');
    if (!el) return;
    const nuove = inAttesa
      ? inAttesa.filter((e) => !disegnate().has(clipKey(e))).length
      : 0;
    if (nuove > 0) {
      el.textContent = nuove === 1
        ? I18n.t('security_clipboard_pending_one')
        : I18n.t('security_clipboard_pending').replace('%d', String(nuove));
      el.style.display = '';
    } else {
      el.textContent = '';
      el.style.display = 'none';
    }
  }

  function disegnate() {
    const s = new Set();
    for (const row of $('sec-clip-list').querySelectorAll('.sn-clip-item')) s.add(row.dataset.snKey);
    return s;
  }

  function renderClipboard(items, opts) {
    const list = $('sec-clip-list');
    const entries = Array.isArray(items) ? items : [];
    vociCorrenti = entries;
    const giaDisegnata = !!list.querySelector('.sn-clip-item');
    if (puntatoreDentro && giaDisegnata && !(opts && opts.forza)) {
      inAttesa = entries;
      segnaSparite(entries);
      aggiornaAvvisoInAttesa();
      applyClipFilter();
      return;
    }
    inAttesa = null;
    list.textContent = '';
    // Vuota: niente lista e niente "Svuota cronologia" (non c'è nulla da
    // svuotare), solo la riga che lo dice.
    const empty = entries.length === 0;
    $('sec-clip-empty').style.display = empty ? '' : 'none';
    list.style.display = empty ? 'none' : '';
    $('sec-clip-clear').style.display = empty ? 'none' : '';
    $('sec-clip-search-row').style.display = empty ? 'none' : '';
    if (empty) {
      $('sec-clip-noresults').style.display = 'none';
      // Cronologia svuotata: anche la ricerca riparte da zero. Altrimenti il
      // campo resterebbe pieno di una parola che nessuno vede più, e la prima
      // cosa copiata dopo comparirebbe già filtrata via.
      $('sec-clip-search').value = '';
    }

    // Se in lista c'è almeno un'immagine, anche le righe di testo tengono il
    // posto della miniatura: altrimenti il bordo sinistro va a zig-zag.
    const conMiniature = entries.some((e) => e && e.type === 'image' && e.dataUrl);

    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'sn-clip-item';
      row.dataset.snSearch = clipLabel(entry).toLowerCase();
      row.dataset.snKey = clipKey(entry);

      // La riga si illuminava al passaggio del mouse ma cliccarla non faceva
      // niente: una promessa che non veniva mantenuta. Nel menu "Incolla" la
      // riga cliccata incolla; qui non c'è un campo dove incollare, quindi la
      // cosa equivalente è rimettere la voce negli appunti, pronta da incollare
      // dove serve.
      const copia = document.createElement('button');
      copia.type = 'button';
      copia.className = 'sn-clip-copy';
      copia.title = I18n.t('security_clipboard_copy_title');

      // Un'immagine si riconosce guardandola, non leggendo "Immagine": senza
      // miniatura, con due schermate copiate in fila, l'utente non sa quale
      // delle due sta togliendo. Il dato ce l'abbiamo già in mano.
      if (entry.type === 'image' && entry.dataUrl) {
        const thumb = document.createElement('img');
        thumb.className = 'sn-clip-thumb';
        thumb.src = entry.dataUrl;
        thumb.alt = '';
        copia.appendChild(thumb);
      } else if (conMiniature) {
        const spacer = document.createElement('span');
        spacer.className = 'sn-clip-spacer';
        copia.appendChild(spacer);
      }

      const label = clipLabel(entry);
      const text = document.createElement('span');
      text.className = 'sn-clip-text';
      text.textContent = label;
      text.title = label;
      copia.appendChild(text);
      copia.addEventListener('click', () => copiaVoce(entry, row));
      row.appendChild(copia);

      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'sn-clip-remove';
      rm.textContent = I18n.t('security_clipboard_remove');
      rm.title = I18n.t('security_clipboard_remove_title');
      rm.addEventListener('click', () => removeClipEntry(entry, rm));
      row.appendChild(rm);

      list.appendChild(row);
    }
    aggiornaAvvisoInAttesa();
    // Il filtro in corso vale anche per la lista appena ridisegnata: se stavi
    // cercando "pass" e nel frattempo hai tolto l'unica voce che corrispondeva,
    // la lista deve dire che quella ricerca non ha risultati, non restare muta.
    applyClipFilter();
  }

  // Rimette una voce negli appunti di sistema, pronta da incollare.
  async function copiaVoce(entry, row) {
    if (row && row.classList.contains('sn-clip-gone')) return;
    try {
      if (entry.type === 'image' && entry.dataUrl) {
        const blob = await (await fetch(entry.dataUrl)).blob();
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      } else {
        await navigator.clipboard.writeText(entry.text || '');
      }
      showClipHint(I18n.t('security_clipboard_copied'), false);
    } catch (_) {
      showClipHint(I18n.t('security_clipboard_fail'), true);
    }
  }

  async function loadClipboard() {
    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.GET_CLIPBOARD_HISTORY });
      renderClipboard(res && res.ok ? res.items : []);
    } catch (_) {
      renderClipboard([]);
    }
  }

  // Rimozione di UNA voce: puntuale di proposito. Chi ha copiato una password
  // per sbaglio non deve pagare con tutto il resto della cronologia.
  async function removeClipEntry(entry, btn) {
    btn.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({
        type: MSG.REMOVE_CLIPBOARD_ENTRY,
        entry,
      });
      if (res && res.ok) {
        renderClipboard(res.items);
        showClipHint(I18n.t('security_clipboard_removed'), false);
      } else {
        btn.disabled = false;
        showClipHint(I18n.t('security_clipboard_fail'), true);
      }
    } catch (_) {
      btn.disabled = false;
      showClipHint(I18n.t('security_clipboard_fail'), true);
    }
  }

  // Svuotamento: distruttivo e non annullabile → conferma prima, col popup di
  // Filo (mai il confirm nativo). Stesso testo del menu del tasto destro: è la
  // stessa azione, deve suonare uguale da dove la si faccia.
  async function clearClipboard() {
    const btn = $('sec-clip-clear');
    // La conferma dice QUANTE voci spariscono, e se una ricerca ne sta
    // nascondendo una parte lo dichiara: con un filtro attivo la lista mostrava
    // una riga sola e lo svuotamento le portava via tutte.
    const text = Clip.testoConferma(vociCorrenti.length, clipVisibili);
    const ok = window.SN_CONFIRM_UI
      ? await window.SN_CONFIRM_UI.confirm({
        title: I18n.t('menu_paste_clear'),
        text,
        okLabel: I18n.t('menu_paste_clear'),
      })
      : window.confirm(text);
    if (!ok) return;
    btn.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.CLEAR_CLIPBOARD_HISTORY });
      if (res && res.ok) {
        // Qui il ridisegno non aspetta il puntatore: l'utente ha appena chiesto
        // lui di far sparire tutto, e la lista svuotata è la risposta.
        renderClipboard([], { forza: true });
        showClipHint(I18n.t('security_clipboard_cleared'), false);
      } else {
        showClipHint(I18n.t('security_clipboard_fail'), true);
      }
    } catch (_) {
      showClipHint(I18n.t('security_clipboard_fail'), true);
    } finally {
      btn.disabled = false;
    }
  }

  async function load() {
    fillStaticText();
    loadClipboard();
    const settings = await Storage.getSettings();
    Bootstrap.applyTheme(settings.theme);
    Bootstrap.applyTextScale(settings.textScale);
    const sec = settings.security || {};
    // "Apri da un altro paese": se è configurato un fornitore proxy, mostra il
    // suo host nella riga privacy (onestà: dichiariamo per chi passa il traffico).
    const provHost = proxyProviderHost(settings.proxy);
    const provEl = $('sec-proxy-box-provider');
    if (provEl) {
      if (provHost) {
        provEl.textContent = I18n.t('options_security_proxy_box_provider').replace('%s', provHost);
        provEl.style.display = '';
      } else {
        provEl.style.display = 'none';
      }
    }
    // Default-on: il merge con DEFAULT_SETTINGS.security mette già true/true se
    // l'utente non ha mai salvato, quindi qui leggiamo "!== false" per
    // riflettere il default anche in casi limite (es. chiave esistente ma null).
    $('sec-protect-ip').checked = sec.protectIpLeak !== false;
    $('sec-block-popups').checked = sec.blockPopups !== false;
    $('sec-adblock').checked = (sec.adblock || {}).enabled !== false;
    const sblk = sec.siteBlock || {};
    $('sec-siteblock').checked = sblk.enabled !== false;
    $('sec-siteblock-lists').checked = sblk.useAdblockLists !== false;
    $('sec-siteblock-blacklist').value = (Array.isArray(sblk.blacklist) ? sblk.blacklist : []).join('\n');
    // Se ci sono voci salvate da prima del controllo (o non valide), avvisa
    // subito che non bloccheranno nulla invece di lasciarle passare mute.
    setBlacklistError(parseBlacklist($('sec-siteblock-blacklist').value).invalid);
    syncSiteBlockEnabled();
    const sb = sec.safeBrowse || {};
    $('sec-safebrowse').checked = sb.enabled !== false;
    $('sec-safebrowse-network').checked = sb.networkSignals !== false;
    $('sec-safebrowse-llm').checked = sb.llmJudge !== false;
    $('sec-safebrowse-sandbox').checked = sb.sandbox !== false;
    syncSafebrowseEnabled();

    const cookies = sec.cookies || {};
    const mode = ['manual', 'default', 'privacy'].includes(cookies.mode) ? cookies.mode : 'default';
    const radio = document.querySelector(`input[name="cookie-mode"][value="${mode}"]`);
    if (radio) radio.checked = true;
    const trusted = cookies.trustedSites || cookies.loginWhitelist;
    cookieWhitelist = Array.isArray(trusted) ? trusted.slice() : [];
    renderWhitelist();
    syncCookieMode();

    const fp = sec.fingerprint || {};
    const fpMode = ['off', 'default', 'privacy'].includes(fp.mode) ? fp.mode : 'default';
    const fpRadio = document.querySelector(`input[name="fp-mode"][value="${fpMode}"]`);
    if (fpRadio) fpRadio.checked = true;

    // F4 — Default ON quando il setting non è ancora stato scritto (undefined → true).
    $('sec-auto-feedback').checked = sec.autoFeedback === undefined ? true : !!sec.autoFeedback;
  }

  // ─── protezione fingerprinting ─────────────────────────────────────────────

  function currentFpMode() {
    const checked = document.querySelector('input[name="fp-mode"]:checked');
    return checked ? checked.value : 'default';
  }

  async function saveFingerprint() {
    const partial = { security: { fingerprint: { mode: currentFpMode() } } };
    await chrome.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings: partial });
    const hint = $('savedHint');
    hint.classList.add('sn-show');
    clearTimeout(saveFingerprint._t);
    saveFingerprint._t = setTimeout(() => hint.classList.remove('sn-show'), 1500);
  }

  // ─── gestione cookie ──────────────────────────────────────────────────────

  let cookieWhitelist = [];

  function currentMode() {
    const checked = document.querySelector('input[name="cookie-mode"]:checked');
    return checked ? checked.value : 'default';
  }

  // I "siti fidati" hanno effetto SOLO in "Privacy massima" (dove ogni sito è
  // isolato/effimero): lì la lista è attiva. In "Automatico"/"Manuale" i login
  // restano comunque, quindi la lista è informativa (disabilitata + nota).
  function syncCookieMode() {
    const privacy = currentMode() === 'privacy';
    $('sec-cookies-trusted-note').style.display = privacy ? 'none' : 'block';
    const wl = $('sec-cookies-whitelist');
    wl.style.opacity = privacy ? '1' : '0.45';
    $('cookie-wl-input').disabled = !privacy;
    $('cookie-wl-add-btn').disabled = !privacy;
    for (const btn of $('cookie-wl-list').querySelectorAll('button')) btn.disabled = !privacy;
  }

  // Pulisce l'input utente in un dominio confrontabile: toglie schema, path,
  // www. e porta, lascia il bare host minuscolo. "https://www.Gmail.com/x" →
  // "gmail.com". Ritorna '' se non estraibile.
  function cleanDomain(raw) {
    let s = String(raw || '').trim().toLowerCase();
    if (!s) return '';
    try {
      if (s.includes('://')) s = new URL(s).hostname;
      else s = new URL('http://' + s).hostname;
    } catch (_) {
      s = s.split('/')[0].split('?')[0];
    }
    s = s.replace(/^www\./, '');
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s) ? s : '';
  }

  function renderWhitelist() {
    const list = $('cookie-wl-list');
    list.innerHTML = '';
    if (!cookieWhitelist.length) {
      const li = document.createElement('li');
      li.className = 'sn-muted';
      li.style.border = 'none';
      li.textContent = I18n.t('options_cookies_whitelist_empty');
      list.appendChild(li);
      return;
    }
    for (const domain of cookieWhitelist) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = domain;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sn-btn-secondary';
      btn.textContent = I18n.t('options_cookies_whitelist_remove');
      btn.addEventListener('click', () => {
        cookieWhitelist = cookieWhitelist.filter((d) => d !== domain);
        renderWhitelist();
        saveCookies();
      });
      li.appendChild(span);
      li.appendChild(btn);
      list.appendChild(li);
    }
  }

  // Mostra (o nasconde, con msg vuoto) un avviso inline sotto il campo "siti
  // fidati". Senza questo, un input rifiutato spariva senza spiegazione.
  function setWhitelistError(msg) {
    const el = $('cookie-wl-error');
    if (!el) return;
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
  }

  function addWhitelistDomain() {
    const input = $('cookie-wl-input');
    const raw = String(input.value || '').trim();
    if (!raw) { setWhitelistError(''); return; }
    const domain = cleanDomain(raw);
    if (!domain) {
      // Input non vuoto ma non è un dominio valido: avvisa invece di svuotare
      // in silenzio. Lascia il testo nel campo così l'utente può correggerlo.
      setWhitelistError(I18n.t('options_cookies_whitelist_invalid'));
      input.focus();
      return;
    }
    if (cookieWhitelist.includes(domain)) {
      setWhitelistError(I18n.t('options_cookies_whitelist_dup', domain));
      input.value = '';
      return;
    }
    cookieWhitelist.push(domain);
    cookieWhitelist.sort();
    renderWhitelist();
    saveCookies();
    setWhitelistError('');
    input.value = '';
  }

  async function saveCookies() {
    const partial = {
      security: {
        cookies: { mode: currentMode(), trustedSites: cookieWhitelist.slice() },
      },
    };
    await chrome.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings: partial });
    const hint = $('savedHint');
    hint.classList.add('sn-show');
    clearTimeout(saveCookies._t);
    saveCookies._t = setTimeout(() => hint.classList.remove('sn-show'), 1500);
  }

  // I sotto-controlli del rilevamento siti pericolosi sono attivi solo quando il
  // controllo principale è acceso.
  function syncSafebrowseEnabled() {
    const on = $('sec-safebrowse').checked;
    const sub = $('sec-safebrowse-sub');
    sub.style.opacity = on ? '1' : '0.45';
    for (const id of ['sec-safebrowse-network', 'sec-safebrowse-llm', 'sec-safebrowse-sandbox']) {
      $(id).disabled = !on;
    }
  }

  // Disabilita i sotto-controlli del blocco siti quando il blocco è spento.
  function syncSiteBlockEnabled() {
    const on = !!$('sec-siteblock').checked;
    const sub = $('sec-siteblock-sub');
    if (sub) sub.style.opacity = on ? '1' : '0.45';
    $('sec-siteblock-lists').disabled = !on;
    $('sec-siteblock-blacklist').disabled = !on;
  }

  // Mostra (o nasconde, con lista vuota) un avviso inline sotto la blacklist
  // che nomina le righe scartate perché non sono domini validi. Senza questo,
  // una voce tipo "facebook" veniva salvata muta ma non bloccava mai il sito.
  function setBlacklistError(invalidRows) {
    const el = $('sec-siteblock-blacklist-error');
    if (!el) return;
    if (invalidRows && invalidRows.length) {
      el.textContent = I18n.t('options_security_siteblock_blacklist_invalid', invalidRows.join(', '));
      el.style.display = 'block';
    } else {
      el.textContent = '';
      el.style.display = 'none';
    }
  }

  // Normalizza e valida ogni riga della blacklist come il campo "siti fidati":
  // scarta schema/path/www, minuscolo, e tiene solo domini con estensione
  // (niente IP o nomi a etichetta singola come "facebook"). Ritorna i domini
  // validi (deduplicati) e le righe scartate così com'erano, per l'avviso.
  function parseBlacklist(raw) {
    const valid = [];
    const seen = new Set();
    const invalid = [];
    for (const line of String(raw || '').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const domain = cleanDomain(trimmed);
      if (!domain) { invalid.push(trimmed); continue; }
      if (seen.has(domain)) continue;
      seen.add(domain);
      valid.push(domain);
    }
    return { valid, invalid };
  }

  async function save() {
    const { valid: blacklist, invalid } = parseBlacklist($('sec-siteblock-blacklist').value);
    setBlacklistError(invalid);
    const partial = {
      security: {
        protectIpLeak: !!$('sec-protect-ip').checked,
        blockPopups: !!$('sec-block-popups').checked,
        adblock: { enabled: !!$('sec-adblock').checked },
        siteBlock: {
          enabled: !!$('sec-siteblock').checked,
          useAdblockLists: !!$('sec-siteblock-lists').checked,
          blacklist,
        },
        safeBrowse: {
          enabled: !!$('sec-safebrowse').checked,
          networkSignals: !!$('sec-safebrowse-network').checked,
          llmJudge: !!$('sec-safebrowse-llm').checked,
          sandbox: !!$('sec-safebrowse-sandbox').checked,
        },
        // F4 — Feedback autonomo: letto da maybeAutoFeedback nel main process.
        autoFeedback: !!$('sec-auto-feedback').checked,
      },
    };
    await chrome.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings: partial });
    const hint = $('savedHint');
    hint.classList.add('sn-show');
    clearTimeout(save._t);
    save._t = setTimeout(() => hint.classList.remove('sn-show'), 1500);
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
    // Niente pulsante "Salva": ogni toggle viene applicato e persistito subito.
    $('sec-protect-ip').addEventListener('change', save);
    $('sec-block-popups').addEventListener('change', save);
    $('sec-adblock').addEventListener('change', save);
    $('sec-siteblock').addEventListener('change', () => { syncSiteBlockEnabled(); save(); });
    $('sec-siteblock-lists').addEventListener('change', save);
    $('sec-siteblock-blacklist').addEventListener('change', save);
    // Mentre l'utente corregge le righe, togli l'avviso precedente (rivalutato
    // al prossimo salvataggio su blur).
    $('sec-siteblock-blacklist').addEventListener('input', () => setBlacklistError([]));
    $('sec-safebrowse').addEventListener('change', () => { syncSafebrowseEnabled(); save(); });
    $('sec-safebrowse-network').addEventListener('change', save);
    $('sec-safebrowse-llm').addEventListener('change', save);
    $('sec-safebrowse-sandbox').addEventListener('change', save);
    $('sec-auto-feedback').addEventListener('change', save);
    for (const r of document.querySelectorAll('input[name="cookie-mode"]')) {
      r.addEventListener('change', () => { syncCookieMode(); saveCookies(); });
    }
    for (const r of document.querySelectorAll('input[name="fp-mode"]')) {
      r.addEventListener('change', saveFingerprint);
    }
    $('cookie-wl-add-btn').addEventListener('click', addWhitelistDomain);
    $('cookie-wl-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addWhitelistDomain(); }
    });
    // Mentre l'utente corregge il valore, togli l'avviso d'errore precedente.
    $('cookie-wl-input').addEventListener('input', () => setWhitelistError(''));
    $('sec-clip-clear').addEventListener('click', clearClipboard);
    $('sec-clip-search').addEventListener('input', applyClipFilter);
    $('sec-export-btn').addEventListener('click', exportData);
    $('sec-import-btn').addEventListener('click', importData);
    // La cronologia appunti cresce ALTROVE (ogni copia, in qualunque scheda) e
    // si accorcia altrove (il "×" del menu "Incolla"): una pagina lasciata
    // aperta mostrerebbe una lista vecchia, e su un dato che si va a
    // controllare per privacy è la bugia peggiore. Ogni volta che la cronologia
    // cambia, il main avvisa le pagine interne e qui la rileggiamo.
    //
    // Non poggiamo su "la scheda torna in primo piano": cambiare scheda in Filo
    // NON spegne la pagina di prima (le schede in secondo piano restano
    // "visibili" per Chromium, larghe zero), quindi quel momento non arriva mai
    // e la lista restava ferma a com'era all'apertura. Il visibilitychange resta
    // come rete di sicurezza per la finestra ridotta a icona, non come unica via.
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === MSG.CLIPBOARD_HISTORY_UPDATED) loadClipboard();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) loadClipboard();
    });
  });
})();
