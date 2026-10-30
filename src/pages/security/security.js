// Pagina Sicurezza: proteggi IP via WebRTC e blocca popup; impostazioni in settings.security.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const I18n = window.SN_I18N;
  const Storage = window.SN_STORAGE;
  const Bootstrap = window.SN_PAGE_BOOTSTRAP;
  // Si salva la forma «xn--…», si mostra il nome come l'utente l'ha scritto (münchen.de).
  const leggibile = window.SN_NOMI_SITO.leggibile;
  // #876 — i siti fidati si salvano come li usa Filo: la regola di «stesso sito» del main.
  const Sito = window.SN_STESSO_SITO;
  const Eseguibili = window.SN_ESEGUIBILI;
  const Google = window.SN_DOMINI_GOOGLE;

  function $(id) { return document.getElementById(id); }

  // Il riquadro «da un altro paese» esiste solo col fornitore (#771), e ne
  // dichiara l'host: per onestà, chi passa il traffico di quelle schede.
  let lastProxy = '';
  async function renderProxyBox() {
    let st = null;
    try { st = await chrome.runtime.sendMessage({ type: MSG.PROXY_STATUS }); } catch (_) {}
    const on = !!(st && st.ok && st.configured);
    $('sec-proxy-box').hidden = !on;
    const provEl = $('sec-proxy-box-provider');
    const host = on ? String(st.providerHost || '') : '';
    provEl.textContent = host ? I18n.t('options_security_proxy_box_provider').replace('%s', host) : '';
    provEl.hidden = !host;
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
    $('sec-adskip-label').textContent = I18n.t('options_security_adskip');
    $('sec-adskip-desc').textContent = I18n.t('options_security_adskip_desc');
    $('sec-siteblock-label').textContent = I18n.t('options_security_siteblock');
    $('sec-siteblock-desc').textContent = I18n.t('options_security_siteblock_desc');
    $('sec-siteblock-lists-label').textContent = I18n.t('options_security_siteblock_lists');
    $('sec-siteblock-blacklist-label').textContent = I18n.t('options_security_siteblock_blacklist_label');
    $('sec-dl-exe-label').textContent = I18n.t('options_security_downloads');
    $('sec-dl-exe-desc').textContent = I18n.t('options_security_downloads_desc');
    $('sec-dl-trusted-label').textContent = I18n.t('options_security_downloads_trusted_label');
    $('sec-delicate-label').textContent = I18n.t('options_security_delicate');
    $('sec-delicate-desc').textContent = I18n.t('options_security_delicate_desc');
    $('sec-delicate-sites-label').textContent = I18n.t('options_security_delicate_sites_label');
    $('sec-delicate-campi-title').textContent = I18n.t('options_security_delicate_campi_title');
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
    $('sec-safebrowse-fidati-title').textContent = I18n.t('options_security_fidati_title');
    $('sec-safebrowse-fidati-desc').textContent = I18n.t('options_security_fidati_desc');
    $('sec-cookies-title').textContent = I18n.t('options_cookies_title');
    $('sec-site-perms-title').textContent = I18n.t('options_site_perms_title');
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
    $('sec-cookies-accessi-title').textContent = I18n.t('options_cookies_accessi_title');
    $('sec-cookies-accessi-desc').textContent = I18n.t('options_cookies_accessi_desc');
    $('sec-cookies-riquadri-title').textContent = I18n.t('options_cookies_riquadri_title');
    $('sec-cookies-riquadri-desc').textContent = I18n.t('options_cookies_riquadri_desc');
    $('sec-riquadri-modello-label').textContent = I18n.t('options_cookies_riquadri_modello');
    $('sec-riquadri-modello-desc').textContent = I18n.t('options_cookies_riquadri_modello_desc');
    $('sec-cookies-banners-title').textContent = I18n.t('options_cookies_banners_title');
    $('sec-cookies-done-title').textContent = I18n.t('options_cookies_done_title');
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
    $('sec-visite-title').textContent = I18n.t('security_visite_title');
    $('sec-visite-desc').textContent = I18n.t('security_visite_desc');
    $('sec-visite-ora').textContent = I18n.t('security_visite_ora');
    $('sec-visite-oggi').textContent = I18n.t('security_visite_oggi');
    $('sec-visite-tutto').textContent = I18n.t('security_visite_tutto');
    $('sec-clip-title').textContent = I18n.t('security_clipboard_title');
    $('sec-clip-desc').textContent = I18n.t('security_clipboard_desc');
    $('sec-clip-empty').textContent = I18n.t('security_clipboard_empty');
    $('sec-clip-noresults').textContent = I18n.t('security_clipboard_no_results');
    $('sec-clip-search').placeholder = I18n.t('security_clipboard_search');
    $('sec-clip-search').setAttribute('aria-label', I18n.t('security_clipboard_search'));
    $('sec-clip-clear').textContent = I18n.t('menu_paste_clear');
    $('sec-export-btn').textContent = I18n.t('security_export_btn');
    $('sec-export-desc').textContent = I18n.t('security_export_desc');
    for (const p of ['sec-export-keys', 'sec-wipe-export-keys']) {
      $(`${p}-label`).textContent = I18n.t('security_export_keys_label');
      $(`${p}-desc`).textContent = I18n.t('security_export_keys_desc');
    }
    $('sec-import-btn').textContent = I18n.t('security_import_btn');
    $('sec-import-desc').textContent = I18n.t('security_import_desc');
    $('sec-wipe-btn').textContent = I18n.t('security_wipe_btn');
    $('sec-wipe-desc').textContent = I18n.t('security_wipe_desc');
    $('sec-wipe-export-text').textContent = I18n.t('security_wipe_export_text');
    $('sec-wipe-export').textContent = I18n.t('security_export_btn');
    $('sec-wipe-list-title').textContent = I18n.t('security_wipe_list_title');
    $('sec-wipe-list').textContent = I18n.t('security_wipe_list');
    $('sec-wipe-server').textContent = I18n.t('security_wipe_server');
    $('sec-wipe-identity-label').textContent = I18n.t('security_wipe_identity_label');
    $('sec-wipe-identity-desc').textContent = I18n.t('security_wipe_identity_desc');
    $('sec-wipe-word-label').textContent = I18n.t('security_wipe_word_label');
    $('sec-wipe-word').placeholder = 'conferma';
    $('sec-wipe-cancel').textContent = I18n.t('security_wipe_cancel');
    $('sec-wipe-go').textContent = I18n.t('security_wipe_go');
    $('savedHint').textContent = I18n.t('options_saved');
  }

  // Le chiavi escono solo con la spunta (#905), che vale anche dalla conferma di «Cancella tutto»: è la stessa scelta.
  const CASELLE_CHIAVI = ['sec-export-keys', 'sec-wipe-export-keys'];
  function mostraCaselleChiavi(settings) {
    const ci = !!window.SN_CONST.haSegreti(settings);
    for (const id of CASELLE_CHIAVI) {
      $(`${id}-row`).hidden = !ci;
      if (!ci) $(id).checked = false;
    }
  }

  // `resta`: l'esito non sparisce (nella conferma di «Cancella tutto» dice che l'archivio c'è già).
  async function exportData({ btn = $('sec-export-btn'), hint = $('sec-export-hint'), fatto = 'security_export_done', resta = false } = {}) {
    btn.disabled = true;
    let riuscito = false;
    try {
      const chiavi = CASELLE_CHIAVI.some((id) => !$(`${id}-row`).hidden && $(id).checked);
      const res = await chrome.runtime.sendMessage({ type: MSG.EXPORT_DATA, chiavi });
      if (res && res.ok) {
        riuscito = true;
        hint.textContent = I18n.t(fatto);
        hint.classList.remove('sn-error', 'sn-hint-warn');
        hint.classList.add('sn-show');
      } else if (res && res.canceled) {
        // L'utente ha annullato il dialog: nessun messaggio.
      } else {
        hint.textContent = I18n.t('security_export_fail');
        hint.classList.add('sn-show', 'sn-error', 'sn-hint-warn');
      }
    } catch (_) {
      hint.textContent = I18n.t('security_export_fail');
      hint.classList.add('sn-show', 'sn-error', 'sn-hint-warn');
    } finally {
      btn.disabled = false;
      clearTimeout(hint._t);
      if (!(resta && riuscito)) hint._t = setTimeout(() => hint.classList.remove('sn-show'), 2500);
    }
  }

  // ── Cancella tutti i dati di Filo (#850) ────────────────────────────────
  // Il tasto apre sotto di sé la conferma: prima l'esportazione, poi cosa sparisce, e il sì solo con la parola scritta.
  // Il cancello vero sta nel main (cancellaTutto.js), che rifà lo stesso controllo sulla parola.
  const PAROLA_CANCELLA = 'conferma';
  const CONTROLLI_CANCELLA = ['sec-wipe-btn', 'sec-wipe-export', 'sec-wipe-export-keys', 'sec-wipe-identity', 'sec-wipe-word', 'sec-wipe-cancel'];
  let cancellazioneInCorso = false;

  const parolaScritta = () => $('sec-wipe-word').value.trim().toLowerCase() === PAROLA_CANCELLA;

  function aggiornaTastoCancella() {
    const go = $('sec-wipe-go');
    go.disabled = cancellazioneInCorso || !parolaScritta();
    go.title = parolaScritta() ? '' : I18n.t('security_wipe_go_spento');
  }

  function mostraEsitoCancella(testo, errore) {
    const hint = $('sec-wipe-hint');
    hint.textContent = testo;
    hint.classList.toggle('sn-hint-warn', !!errore);
    hint.classList.toggle('sn-show', !!testo);
  }

  async function apriCancellaTutto(e) {
    // Un doppio clic aprirebbe e richiuderebbe subito: conta il primo.
    if (e && e.detail > 1) return;
    const box = $('sec-wipe-box');
    if (!box.hidden) { chiudiCancellaTutto(); return; }
    box.hidden = false;
    $('sec-wipe-btn').setAttribute('aria-expanded', 'true');
    aggiornaTastoCancella();
    box.scrollIntoView({ block: 'nearest' });
    $('sec-wipe-export').focus({ preventScroll: true });
    // La scelta sull'identità compare solo se c'è un'identità: senza risposta resta nascosta, e l'identità resta.
    let st = null;
    try { st = await chrome.runtime.sendMessage({ type: MSG.CANCELLA_TUTTI_I_DATI_STATO }); } catch (_) {}
    $('sec-wipe-identity-row').hidden = !(st && st.ok && st.identita);
    if ($('sec-wipe-identity-row').hidden) $('sec-wipe-identity').checked = false;
  }

  function chiudiCancellaTutto() {
    if (cancellazioneInCorso) return;
    $('sec-wipe-box').hidden = true;
    $('sec-wipe-btn').setAttribute('aria-expanded', 'false');
    $('sec-wipe-word').value = '';
    $('sec-wipe-identity').checked = false;
    mostraEsitoCancella('', false);
    aggiornaTastoCancella();
  }

  async function cancellaTutto(e) {
    // La coda di un doppio clic non è un secondo sì.
    if ((e && e.detail > 1) || cancellazioneInCorso || !parolaScritta()) return;
    cancellazioneInCorso = true;
    for (const id of CONTROLLI_CANCELLA) $(id).disabled = true;
    aggiornaTastoCancella();
    mostraEsitoCancella(I18n.t('security_wipe_in_corso'), false);
    let r = null;
    try {
      r = await chrome.runtime.sendMessage({
        type: MSG.CANCELLA_TUTTI_I_DATI,
        parola: $('sec-wipe-word').value,
        ancheIdentita: !$('sec-wipe-identity-row').hidden && $('sec-wipe-identity').checked,
      });
    } catch (_) {}
    // Riuscito, Filo si chiude da sé: la pagina resta com'è fino all'ultimo.
    if (r && r.ok) return;
    cancellazioneInCorso = false;
    for (const id of CONTROLLI_CANCELLA) $(id).disabled = false;
    aggiornaTastoCancella();
    mostraEsitoCancella(I18n.t('security_wipe_fail'), true);
  }

  // La chat porta qui con #cancella-tutto, l'avviso del filo pesante con #cancella-pagine (#1525): sul tasto, che
  // non cancella da solo.
  const TASTI_DA_INDIRIZZO = {
    '#cancella-tutto': { tasto: 'sec-wipe-btn', riga: 'sec-wipe-row' },
    '#cancella-pagine': { tasto: 'sec-visite-ora', riga: 'sec-visite' },
  };
  function portaAlTasto() {
    const dove = TASTI_DA_INDIRIZZO[location.hash];
    if (!dove) return;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
    const btn = $(dove.tasto);
    const centra = () => $(dove.riga).scrollIntoView({ block: 'center' });
    centra();
    btn.focus({ preventScroll: true });
    btn.classList.remove('sn-card-highlight');
    void btn.offsetWidth;
    btn.classList.add('sn-card-highlight');
    btn.addEventListener('animationend', () => btn.classList.remove('sn-card-highlight'), { once: true });
    // Le liste qui sopra arrivano dopo e spingono giù il tasto: lo si segue finché l'utente non si muove da sé.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(centra) : null;
    const GESTI = ['wheel', 'keydown', 'pointerdown', 'touchstart'];
    const smetti = () => { ro?.disconnect(); for (const t of GESTI) removeEventListener(t, smetti, true); };
    ro?.observe(document.body);
    for (const t of GESTI) addEventListener(t, smetti, true);
    setTimeout(smetti, 2000);
  }

  // #866 — le pagine visitate che il filo ricorda: si cancellano per periodo, e il popup dice quante prima del sì.
  const PERIODO_DETTO = { ultima_ora: 'nell’ultima ora', oggi: 'oggi', tutto: 'da sempre' };
  function showVisiteHint(text, isError) {
    const hint = $('sec-visite-hint');
    hint.textContent = text;
    hint.classList.toggle('sn-error', !!isError);
    hint.classList.add('sn-show');
    clearTimeout(showVisiteHint._t);
    showVisiteHint._t = setTimeout(() => hint.classList.remove('sn-show'), 4000);
  }

  async function cancellaVisite(btn) {
    const periodo = btn.dataset.periodo;
    btn.disabled = true;
    try {
      const conta = await chrome.runtime.sendMessage({ type: MSG.FILO_PAGINE_CONTA, periodo });
      if (!conta || !conta.ok) { showVisiteHint(I18n.t('security_visite_fail'), true); return; }
      if (!conta.n) { showVisiteHint(I18n.t('security_visite_nessuna'), false); return; }
      const quali = conta.n === 1 ? 'la pagina visitata' : `le ${conta.n} pagine visitate`;
      const ok = await window.SN_CONFIRM_UI.confirm({
        title: I18n.t('security_visite_confirm_title'),
        text: I18n.t('security_visite_confirm_text').replace('%1', quali).replace('%2', PERIODO_DETTO[periodo] || ''),
        okLabel: I18n.t('security_visite_confirm_ok'),
      });
      if (!ok) return;
      const r = await chrome.runtime.sendMessage({ type: MSG.FILO_PAGINE_CANCELLA, periodo });
      if (!r || !r.ok) { showVisiteHint(I18n.t('security_visite_fail'), true); return; }
      showVisiteHint(r.n === 1 ? '1 pagina cancellata' : `${r.n} pagine cancellate`, false);
    } catch (_) {
      showVisiteHint(I18n.t('security_visite_fail'), true);
    } finally {
      btn.disabled = false;
    }
  }

  // Due passi voluti: prima si legge il file e si dice COSA contiene, poi si chiede conferma,
  // così l'utente sa cosa sta per rimettere dentro. Popup di Filo, mai il confirm nativo.
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
        const errori = {
          invalid_file: 'security_import_invalid',
          damaged_file: 'security_import_damaged',
          compressed_file: 'security_import_compressed',
          encrypted_file: 'security_import_encrypted',
        };
        showImportHint(I18n.t(errori[prev && prev.error] || 'security_import_fail'), true);
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
      const conta = (n, uno, molti) => (n === 1 ? `1 ${uno}` : `${n} ${molti}`);
      const delFilo = [
        prev.chats ? conta(prev.chats, 'chat con Filo', 'chat con Filo') : '',
        prev.pagine ? conta(prev.pagine, 'pagina visitata', 'pagine visitate') : '',
      ].filter(Boolean).join(' e ');
      // Quello che del file non entra si dice prima del sì, col numero (#1088), lista per lista col suo tetto (#1256).
      const fuori = (n, tetto, mie, chiave) => (n ? I18n.t(`security_import_${chiave}_out`)
        .replace('%1', String(n))
        .replace('%2', String(tetto || ''))
        + (mie ? ' ' + I18n.t(`security_import_${chiave}_out_mine`).replace('%1', String(mie)) : '') : '');
      // Il tetto di spesa del backup, più largo, si offre e lo mette solo il suo bottone (#1050).
      const tetto = prev.tettoSpesa && typeof prev.tettoSpesa.backup === 'number' ? prev.tettoSpesa : null;
      const euro = (n) => (Number(n) > 0
        ? `${Number(n).toLocaleString('it-IT', { useGrouping: true, minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 })} €`
        : 'senza limite');
      const bottoneTetto = tetto ? I18n.t(tetto.backup > 0 ? 'security_import_tetto_btn' : 'security_import_tetto_btn_senza') : '';
      const manca = [
        prev.vociPerse ? I18n.t('security_import_voci_perse').replace('%1', String(prev.vociPerse)) : '',
        prev.immaginiPerse ? I18n.t('security_import_images_lost').replace('%1', String(prev.immaginiPerse)) : '',
        prev.filoPerso ? I18n.t('security_import_filo_lost') : '',
        fuori(prev.pagineFuori, prev.tettoPagine, prev.pagineMieFuori, 'pages'),
        fuori(prev.appuntiFuori, prev.tettoAppunti, prev.appuntiMieFuori, 'appunti'),
        fuori(prev.downloadFuori, prev.tettoDownload, prev.downloadMieFuori, 'download'),
        tetto ? I18n.t(tetto.backup > 0 ? 'security_import_tetto_backup' : 'security_import_tetto_senza')
          .replace('%1', () => euro(tetto.tenuto))
          .replace('%2', () => euro(tetto.backup))
          .replace('%3', () => bottoneTetto) : '',
        prev.tettoSceso && typeof prev.tettoSceso.dopo === 'number'
          ? I18n.t(Number(prev.tettoSceso.prima) > 0 ? 'security_import_tetto_sceso' : 'security_import_tetto_sceso_senza')
            .replace('%1', () => euro(prev.tettoSceso.prima))
            .replace('%2', () => euro(prev.tettoSceso.dopo)) : '',
        prev.chiavi === false ? I18n.t('security_import_senza_chiavi') : '',
        prev.proxySenzaCredenziali ? I18n.t('security_import_proxy_senza_credenziali') : '',
      ].filter(Boolean);
      const escono = [
        prev.pagineMieFuori ? I18n.t('security_import_escono_pagine') : '',
        prev.appuntiMieFuori ? I18n.t('security_import_escono_appunti') : '',
        prev.downloadMieFuori ? I18n.t('security_import_escono_download') : '',
      ].filter(Boolean);
      const elencoEscono = escono.length > 1 ? `${escono.slice(0, -1).join(', ')} e ${escono[escono.length - 1]}` : escono[0] || '';
      // Sostituzioni a funzione: un `$&` o un `%2` nel nome del file non pescano nella frase di Filo.
      const testo = I18n.t('security_import_confirm_text')
        .replace('%6', () => (elencoEscono
          ? I18n.t('security_import_escono_mie').replace('%1', () => elencoEscono)
          : I18n.t('security_import_nulla_perso')))
        .replace('%2', () => when)
        .replace('%3', () => sezioni)
        .replace('%4', () => immagini)
        .replace('%5', () => (delFilo ? `, più ${delFilo}` : ''))
        + (manca.length ? `\n\n${manca.join('\n')}` : '');
      // Il nome lo sceglie chi ha dato il file: nel suo riquadro, fuori dalle parole di Filo (#592.7).
      const nome = String(prev.fileName || '');
      const [prima, dopo = ''] = testo.split('"%1"');
      const text = `${prima}"${nome}"${dopo}`;
      const parti = nome ? [prima, { citazione: nome }, dopo] : null;

      const ok = window.SN_CONFIRM_UI
        ? await window.SN_CONFIRM_UI.confirm({
          title: I18n.t('security_import_confirm_title'),
          text,
          parti,
          okLabel: I18n.t('security_import_confirm_ok'),
          altroLabel: bottoneTetto,
        })
        : true;
      if (!ok) return;

      const res = await chrome.runtime.sendMessage({
        type: MSG.IMPORT_DATA_APPLY,
        token: prev.token,
        tettoDelBackup: ok === 'altro',
      });
      if (res && res.ok) {
        showImportHint(I18n.t('security_import_done'), false);
        // La pagina si ricarica: i dati appena rimessi dentro devono comparire al posto dei vecchi.
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

  // Le risposte date ai siti che restano fra un avvio e l'altro: si vedono tutte qui e si tolgono una per una.
  async function renderSitePerms() {
    const list = $('sec-perm-list');
    let scelte = [];
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.PERMESSI_SITI_GET });
      scelte = (r && Array.isArray(r.scelte)) ? r.scelte : [];
    } catch (_) { scelte = []; }
    list.replaceChildren();
    if (!scelte.length) {
      const li = document.createElement('li');
      li.className = 'sn-muted';
      li.style.border = 'none';
      li.textContent = I18n.t('options_site_perms_empty');
      list.appendChild(li);
      return;
    }
    for (const s of scelte) {
      const li = document.createElement('li');
      const testo = document.createElement('span');
      const sito = document.createElement('strong');
      sito.textContent = (s.sotto ? s.sotto + '.' : '') + s.dominio;
      sito.title = s.origine;
      const cosa = I18n.STRINGS['options_site_perms_part_' + s.parte] || s.parte;
      testo.append(sito, ' · ', `${cosa}: ${I18n.t(s.si ? 'options_site_perms_yes' : 'options_site_perms_no')}`);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sn-btn-secondary';
      btn.textContent = I18n.t('options_site_perms_remove');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try { await chrome.runtime.sendMessage({ type: MSG.PERMESSI_SITI_TOGLI, origine: s.origine, parte: s.parte }); } catch (_) {}
        renderSitePerms();
      });
      li.append(testo, btn);
      list.appendChild(li);
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
  // Quante voci VIVE la ricerca sta mostrando, oppure null quando nessuna
  // ricerca è in corso: la conferma dello svuotamento parla del filtro solo se
  // il filtro c'è davvero (vedi il commento su testoConferma nel modulo
  // condiviso della cronologia).
  let clipVisibili = null;

  function applyClipFilter() {
    const q = ($('sec-clip-search').value || '').trim().toLowerCase();
    const righe = $('sec-clip-list').querySelectorAll('.sn-clip-item');
    let aSchermo = 0;   // righe che il filtro lascia vedere, barrate comprese
    let vive = 0;       // di quelle, le voci che ci sono ancora davvero
    for (const r of righe) {
      const match = !q || (r.dataset.snSearch || '').includes(q);
      r.style.display = match ? '' : 'none';
      if (!match) continue;
      aSchermo++;
      if (!r.classList.contains('sn-clip-gone')) vive++;
    }
    clipVisibili = q ? vive : null;
    const nessuno = righe.length > 0 && aSchermo === 0;
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
      const copia = row.querySelector('.sn-clip-copy');
      if (copia) {
        copia.disabled = true;
        copia.title = I18n.t('security_clipboard_gone');
      }
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

  // I controlli intorno alla lista (svuota, ricerca) devono dire la verità sulle
  // voci VERE, anche mentre la lista sta ferma sotto il puntatore e a schermo ci
  // sono ancora righe barrate. Senza questo, tolte a mano tutte le voci senza
  // uscire dalla lista, «Svuota cronologia» restava lì e, raggiunto col
  // tabulatore, offriva di far sparire zero voci.
  // Mentre la lista è ferma, però, quello che sparisce non deve spostarla: la
  // ricerca (sopra) lascia il suo posto vuoto, e sotto si tiene l'altezza, così
  // la pagina in fondo non si accorcia e lo scorrimento non trascina le righe.
  function sincronizzaControlli(ferma) {
    const vuota = vociCorrenti.length === 0;
    const azioni = $('sec-clip-actions');
    const ricerca = $('sec-clip-search-row');
    if (ferma && vuota && !azioni.style.minHeight) azioni.style.minHeight = `${azioni.offsetHeight}px`;
    if (!ferma) azioni.style.minHeight = '';
    $('sec-clip-clear').style.display = vuota ? 'none' : '';
    const tieniPosto = ferma && vuota && ricerca.style.display !== 'none';
    ricerca.style.visibility = tieniPosto ? 'hidden' : '';
    if (!tieniPosto) ricerca.style.display = vuota ? 'none' : '';
    if (vuota) $('sec-clip-noresults').style.display = 'none';
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
      sincronizzaControlli(true);
      return;
    }
    inAttesa = null;

    // Se la lista che arriva è IDENTICA a quella già a schermo non si tocca
    // niente. Ricostruirla per nulla azzererebbe lo scorrimento e butterebbe
    // fuori il fuoco della tastiera — e succede a ogni rimozione, perché chi
    // tiene la cronologia avvisa tutte le pagine quando cambia e l'avviso
    // torna anche alla pagina che ha appena chiesto la modifica: la lista
    // arriva due volte, la seconda uguale alla prima.
    const disegnateOra = [...list.querySelectorAll('.sn-clip-item')];
    const identica = disegnateOra.length > 0
      && disegnateOra.length === entries.length
      && !list.querySelector('.sn-clip-gone')
      && disegnateOra.every((r, i) => r.dataset.snKey === clipKey(entries[i]));
    if (identica) {
      aggiornaAvvisoInAttesa();
      applyClipFilter();
      sincronizzaControlli();
      return;
    }

    list.textContent = '';
    // Vuota: niente lista e niente "Svuota cronologia" (non c'è nulla da
    // svuotare), solo la riga che lo dice.
    const empty = entries.length === 0;
    $('sec-clip-empty').style.display = empty ? '' : 'none';
    list.style.display = empty ? 'none' : '';
    $('sec-clip-clear').style.display = empty ? 'none' : '';
    $('sec-clip-search-row').style.display = empty ? 'none' : '';
    $('sec-clip-search-row').style.visibility = '';
    $('sec-clip-actions').style.minHeight = '';
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
        thumb.alt = '';
        // Un'immagine che non si riesce a disegnare lasciava l'iconcina rotta
        // del browser: nel menu "Incolla" lo stesso caso rimette l'iconcina di
        // Filo, ed è la stessa lista vista da due parti.
        thumb.addEventListener('error', () => {
          const icona = document.createElement('span');
          icona.className = 'sn-clip-thumb sn-clip-thumb-fallback';
          const svg = window.SN_ICONS && window.SN_ICONS.image;
          if (svg) icona.innerHTML = svg(16);
          else icona.textContent = '🖼';
          thumb.replaceWith(icona);
        });
        thumb.src = entry.dataUrl;
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
      // `detail === 0` = premuto con Invio o barra, non col mouse: solo in quel
      // caso il fuoco va rimesso da qualche parte dopo la rimozione.
      rm.addEventListener('click', (ev) => removeClipEntry(entry, rm, ev.detail === 0));
      row.appendChild(rm);

      list.appendChild(row);
    }
    aggiornaAvvisoInAttesa();
    // Il filtro in corso vale anche per la lista appena ridisegnata: se stavi
    // cercando "pass" e nel frattempo hai tolto l'unica voce che corrispondeva,
    // la lista deve dire che quella ricerca non ha risultati, non restare muta.
    applyClipFilter();
  }

  // Le righe su cui si può ancora agire: quelle che il filtro lascia vedere e
  // che non sono già state tolte. Sono le stesse prima e dopo una rimozione,
  // meno quella tolta, quindi l'indice di una riga qui dentro resta confrontabile
  // fra i due momenti anche quando la lista sta ferma sotto il puntatore e le
  // righe tolte restano a schermo barrate.
  function righeVive() {
    return [...$('sec-clip-list').querySelectorAll('.sn-clip-item')]
      .filter((r) => r.style.display !== 'none' && !r.classList.contains('sn-clip-gone'));
  }

  // Dopo una rimozione fatta da tastiera, il fuoco va sul "Rimuovi" della voce
  // che ha preso quel posto in lista (o dell'ultima, se hai tolto quella in
  // fondo). Se non resta niente da togliere va sul tasto per svuotare, e se
  // nemmeno quello c'è più sul campo di ricerca: qualcosa sotto le dita resta
  // sempre.
  function fuocoDopoRimozione(indice) {
    const righe = righeVive();
    if (righe.length) {
      const i = Math.min(Math.max(indice, 0), righe.length - 1);
      const b = righe[i].querySelector('.sn-clip-remove');
      if (b && !b.disabled) { metti(b); return; }
    }
    const svuota = $('sec-clip-clear');
    if (svuota && svuota.style.display !== 'none') { metti(svuota); return; }
    const cerca = $('sec-clip-search');
    if (cerca && $('sec-clip-search-row').style.display !== 'none') metti(cerca);

    function metti(el) {
      try { el.focus({ preventScroll: true }); } catch (_) { try { el.focus(); } catch (__) {} }
    }
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
  async function removeClipEntry(entry, btn, daTastiera) {
    // Chi usa la tastiera non deve ripartire dall'inizio della pagina a ogni
    // voce tolta. Disabilitare il bottone premuto butta il fuoco sul corpo
    // della pagina, e per la voce dopo toccherebbe riattraversare col tabulatore
    // tutta la pagina delle impostazioni.
    //
    // Il fuoco va rimesso in TUTTI e due i casi, e per un po' ne copriva uno
    // solo: quando la lista si ricompone il bottone premuto sparisce, ma se il
    // puntatore del mouse è fermo sulla lista la lista sta ferma e quel bottone
    // resta a schermo disabilitato. Il vecchio controllo guardava solo se il
    // bottone fosse ancora nella pagina, quindi con la mano ferma sul mouse il
    // fuoco restava caduto. Adesso conta se il bottone è ancora PREMIBILE.
    const indice = righeVive().findIndex((r) => r.contains(btn));
    const avevaFuoco = !!daTastiera && document.activeElement === btn;
    const rimettiFuoco = () => {
      try { btn.focus({ preventScroll: true }); } catch (_) { try { btn.focus(); } catch (__) {} }
    };
    btn.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({
        type: MSG.REMOVE_CLIPBOARD_ENTRY,
        entry,
      });
      if (res && res.ok) {
        // Le scritture non rispondono con l'elenco (#589.4): la lista vera si rilegge.
        let dopo = null;
        try { dopo = await chrome.runtime.sendMessage({ type: MSG.GET_CLIPBOARD_HISTORY }); } catch (_) {}
        renderClipboard(dopo && dopo.ok ? dopo.items : vociCorrenti.filter((x) => Clip.chiave(x) !== Clip.chiave(entry)));
        if (avevaFuoco && (!document.contains(btn) || btn.disabled)) fuocoDopoRimozione(indice);
        showClipHint(I18n.t('security_clipboard_removed'), false);
      } else {
        btn.disabled = false;
        // La voce è ancora lì: il fuoco torna sul suo stesso "Rimuovi", così
        // riprovare è un altro Invio e non un altro giro col tabulatore.
        if (avevaFuoco) rimettiFuoco();
        showClipHint(I18n.t('security_clipboard_fail'), true);
      }
    } catch (_) {
      btn.disabled = false;
      if (avevaFuoco) rimettiFuoco();
      showClipHint(I18n.t('security_clipboard_fail'), true);
    }
  }

  // Svuotamento: distruttivo e non annullabile → conferma prima, col popup di
  // Filo (mai il confirm nativo). Stesso testo del menu del tasto destro: è la
  // stessa azione, deve suonare uguale da dove la si faccia.
  async function clearClipboard() {
    const btn = $('sec-clip-clear');
    // Niente da svuotare, niente conferma: il tasto in questo caso è già
    // nascosto, ma chiedere «spariscono tutte e 0 le voci» resta una frase che
    // non deve poter uscire da nessuna strada.
    if (vociCorrenti.length === 0) return;
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
    renderSitePerms();
    loadClipboard();
    const settings = await Storage.getSettings();
    Bootstrap.applyTheme(settings.theme);
    Bootstrap.applyTextScale(settings.textScale);
    mostraCaselleChiavi(settings);
    const sec = settings.security || {};
    lastProxy = JSON.stringify(settings.proxy || {});
    renderProxyBox();
    // Default-on: il merge con DEFAULT_SETTINGS.security mette già true/true se
    // l'utente non ha mai salvato, quindi qui leggiamo "!== false" per
    // riflettere il default anche in casi limite (es. chiave esistente ma null).
    $('sec-protect-ip').checked = sec.protectIpLeak !== false;
    $('sec-block-popups').checked = sec.blockPopups !== false;
    $('sec-adblock').checked = (sec.adblock || {}).enabled !== false;
    $('sec-adskip').checked = (sec.adSkip || {}).enabled !== false;
    const sblk = sec.siteBlock || {};
    $('sec-siteblock').checked = sblk.enabled !== false;
    $('sec-siteblock-lists').checked = sblk.useAdblockLists !== false;
    // Le righe che non sono domini si salvano a parte e tornano qui con l'avviso: chi ha scritto
    // «facebook» e chiuso la scheda deve rivederla, non trovarla sparita (#590.2).
    $('sec-siteblock-blacklist').value = righe(sblk.blacklist, sblk.righeScartate);
    setBlacklistError(parseBlacklist($('sec-siteblock-blacklist').value).invalid);
    syncSiteBlockEnabled();
    // #588 — conferma prima di scaricare/aprire un programma. Default ON: la
    // chiave assente vale "chiedi", come nel main.
    const dl = sec.downloads || {};
    $('sec-dl-exe').checked = dl.confirmExecutables !== false;
    $('sec-dl-trusted').value = righe(dl.trustedSites, dl.righeScartate);
    setTrustedError(parseFidati($('sec-dl-trusted').value).invalid);
    syncDownloadsEnabled();
    const del = sec.pagineDelicate || {};
    $('sec-delicate').checked = del.enabled !== false;
    $('sec-delicate-sites').value = righe(del.siti, del.righeScartate);
    setDelicateError(parseBlacklist($('sec-delicate-sites').value).invalid);
    syncDelicateEnabled();
    loadDelicateCampi();
    caricaSitiScaricati();
    const sb = sec.safeBrowse || {};
    $('sec-safebrowse').checked = sb.enabled !== false;
    $('sec-safebrowse-network').checked = sb.networkSignals !== false;
    $('sec-safebrowse-llm').checked = sb.llmJudge !== false;
    $('sec-safebrowse-sandbox').checked = sb.sandbox !== false;
    syncSafebrowseEnabled();
    sbFidati = fidatiDaMostrare(Array.isArray(sb.trustedSites) ? sb.trustedSites : []);
    renderFidati();

    const cookies = sec.cookies || {};
    const mode = ['manual', 'default', 'privacy'].includes(cookies.mode) ? cookies.mode : 'default';
    const radio = document.querySelector(`input[name="cookie-mode"][value="${mode}"]`);
    if (radio) radio.checked = true;
    const trusted = cookies.trustedSites || cookies.loginWhitelist;
    cookieWhitelist = Array.isArray(trusted) ? Google.sitiDeiFidati(trusted) : [];
    cookieBannerSites = Array.isArray(cookies.bannerSites) ? cookies.bannerSites.slice() : [];
    cookieLoggedSites = Array.isArray(cookies.loggedSites) ? cookies.loggedSites.slice() : [];
    cookieEmbedSites = Array.isArray(cookies.embedSites) ? cookies.embedSites.slice() : [];
    $('sec-riquadri-modello').checked = !(sec.riquadriRotti && sec.riquadriRotti.modello === false);
    renderWhitelist();
    renderBannerSites();
    renderLoggedSites();
    renderEmbedSites();
    // Il testo lasciato nella casella dei fidati torna lì: un sito valido è già nell'elenco, il resto con l'avviso.
    const bozza = typeof cookies.bozza === 'string' ? cookies.bozza : '';
    $('cookie-wl-input').value = bozza;
    setWhitelistError(bozza.trim() && !sitoFidato(bozza) ? avvisoFidato(bozza) : '');
    loadCookieDone();
    syncCookieMode();

    const fp = sec.fingerprint || {};
    const fpMode = ['off', 'default', 'privacy'].includes(fp.mode) ? fp.mode : 'default';
    const fpRadio = document.querySelector(`input[name="fp-mode"][value="${fpMode}"]`);
    if (fpRadio) fpRadio.checked = true;

    // F4 — Default ON quando il setting non è ancora stato scritto (undefined → true).
    $('sec-auto-feedback').checked = sec.autoFeedback === undefined ? true : !!sec.autoFeedback;
    mostrata = leggiSicurezza();
  }

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

  let cookieWhitelist = [];
  // #754 — siti dove l'utente ha chiesto di rivedere i banner (dal menu della scheda): qui si vedono e si tolgono.
  let cookieBannerSites = [];
  // #758 — siti dove Filo ha visto un tuo accesso: i loro contenuti incorporati tengono i cookie. Li scrive Filo,
  // qui si vedono e si tolgono.
  let cookieLoggedSites = [];
  let cookieEmbedSites = [];

  function currentMode() {
    const checked = document.querySelector('input[name="cookie-mode"]:checked');
    return checked ? checked.value : 'default';
  }

  // I "siti fidati" contano in "Privacy massima" (jar isolato ma persistente) e in "Automatico" (#758: i loro
  // contenuti incorporati altrove tengono i cookie): lì la lista si usa. In "Manuale" Filo non gestisce niente.
  function syncCookieMode() {
    const modo = currentMode();
    const conta = modo !== 'manual';
    $('sec-cookies-trusted-note').style.display = modo === 'default' ? 'block' : 'none';
    const wl = $('sec-cookies-whitelist');
    wl.style.opacity = conta ? '1' : '0.45';
    $('cookie-wl-input').disabled = !conta;
    $('cookie-wl-add-btn').disabled = !conta;
    for (const btn of $('cookie-wl-list').querySelectorAll('button')) btn.disabled = !conta;
    // In Manuale Filo non rifiuta cookie, quindi nessun riquadro si rompe per colpa sua e il modello non parte.
    $('sec-riquadri-modello-row').style.opacity = conta ? '1' : '0.45';
    $('sec-riquadri-modello').disabled = !conta;
  }

  // "https://www.Mail.Google.com/x" → "mail.google.com", '' se non è un sito: la riduzione di tutti gli elenchi (#843).
  const cleanDomain = window.SN_NOMI_SITO.daScritto;
  // Il sito che la voce tiene connesso: «https://mail.google.com/mail/u/0/» e gmail.com sono google.com, come li usa il main (#876).
  // Una piattaforma (github.io, co.uk) non è il sito di nessuno: non entra, come fra i programmi fidati.
  function sitoFidato(raw) {
    const d = cleanDomain(raw);
    return d && !Sito.piattaforma(d) ? Google.sitiDeiFidati([d])[0] || '' : '';
  }
  function avvisoFidato(raw) {
    const d = cleanDomain(raw);
    return d ? Eseguibili.testoPiattaforma(d) : I18n.t('options_cookies_whitelist_invalid');
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
      const voce = document.createElement('div');
      const span = document.createElement('span');
      span.textContent = leggibile(domain);
      voce.appendChild(span);
      // Una piattaforma salvata prima che la si rifiutasse non tiene connessi i siti ospitati: lo si dice, come fra i programmi.
      if (Sito.piattaforma(domain) && Sito.voceSalvata(`x.${domain}`, [domain]) !== domain) {
        const nota = document.createElement('small');
        nota.className = 'sn-cookie-wl-nota';
        nota.textContent = Eseguibili.testoPiattaforma(domain);
        voce.appendChild(nota);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sn-btn-secondary';
      btn.textContent = I18n.t('options_cookies_whitelist_remove');
      btn.addEventListener('click', () => {
        cookieWhitelist = cookieWhitelist.filter((d) => d !== domain);
        renderWhitelist();
        saveCookies();
      });
      li.appendChild(voce);
      li.appendChild(btn);
      list.appendChild(li);
    }
  }

  function renderBannerSites() {
    const box = $('sec-cookies-banners');
    const list = $('cookie-banners-list');
    list.innerHTML = '';
    box.hidden = !cookieBannerSites.length;
    for (const domain of cookieBannerSites) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = leggibile(domain);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sn-btn-secondary';
      btn.textContent = I18n.t('options_cookies_banners_remove');
      btn.addEventListener('click', () => {
        cookieBannerSites = cookieBannerSites.filter((d) => d !== domain);
        renderBannerSites();
        saveCookies();
      });
      li.appendChild(span);
      li.appendChild(btn);
      list.appendChild(li);
    }
  }

  function renderLoggedSites() {
    const box = $('sec-cookies-accessi');
    const list = $('cookie-accessi-list');
    list.innerHTML = '';
    // L'elenco si vede in tutte le modalità: è roba che Filo ha segnato su di te, e si toglie da qui anche quando
    // la modalità di adesso non lo usa.
    box.hidden = !cookieLoggedSites.length;
    for (const domain of cookieLoggedSites) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = leggibile(domain);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sn-btn-secondary';
      btn.textContent = I18n.t('options_cookies_accessi_remove');
      btn.addEventListener('click', () => {
        cookieLoggedSites = cookieLoggedSites.filter((d) => d !== domain);
        renderLoggedSites();
        saveCookies();
      });
      li.appendChild(span);
      li.appendChild(btn);
      list.appendChild(li);
    }
  }

  // I servizi a cui hai riattivato i cookie dal riquadro rotto (#760): si vedono tutti e si tolgono da qui o dal
  // tasto destro sul riquadro.
  function renderEmbedSites() {
    const box = $('sec-cookies-riquadri');
    const list = $('cookie-riquadri-list');
    list.innerHTML = '';
    box.hidden = !cookieEmbedSites.length;
    for (const domain of cookieEmbedSites) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = leggibile(domain);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sn-btn-secondary';
      btn.textContent = I18n.t('options_cookies_riquadri_remove');
      btn.addEventListener('click', () => {
        cookieEmbedSites = cookieEmbedSites.filter((d) => d !== domain);
        renderEmbedSites();
        saveCookies();
      });
      li.appendChild(span);
      li.appendChild(btn);
      list.appendChild(li);
    }
  }

  // I siti di cui ti fidi (#967): ci entrano dal «Continua» sull'avviso sospetto o dall'«Apri comunque» di «Non trovo»,
  // e da qui si tolgono uno per uno. La voce di una pagina ospitata porta il suo percorso.
  let sbFidati = [];
  // Le voci tolte da qui finché il main non le ha scritte: un elenco arrivato prima della loro scrittura non le rimette,
  // se no il clic dopo cade sulla voce già tolta invece che su quella sotto.
  const sbFidatiInUscita = new Set();
  const fidatiDaMostrare = (l) => l.filter((x) => !sbFidatiInUscita.has(x));
  function voceLeggibile(v) {
    const i = String(v).indexOf('/');
    return i < 0 ? leggibile(v) : leggibile(v.slice(0, i)) + v.slice(i);
  }
  function renderFidati() {
    const box = $('sec-safebrowse-fidati');
    const list = $('sec-safebrowse-fidati-list');
    list.innerHTML = '';
    box.hidden = !sbFidati.length;
    for (const voce of sbFidati) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = voceLeggibile(voce);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sn-btn-secondary';
      btn.textContent = I18n.t('options_security_fidati_remove');
      btn.addEventListener('click', async () => {
        sbFidatiInUscita.add(voce);
        sbFidati = sbFidati.filter((x) => x !== voce);
        renderFidati();
        let r = null;
        try { r = await chrome.runtime.sendMessage({ type: MSG.SITI_FIDATI_IMPOSTA, fidato: false, voci: [voce] }); } catch (_) {}
        sbFidatiInUscita.delete(voce);
        // Non scritta: la voce torna, l'utente non deve crederla tolta.
        if (!(r && r.ok)) {
          try {
            const sb = ((await Storage.getSettings()).security || {}).safeBrowse || {};
            sbFidati = fidatiDaMostrare(Array.isArray(sb.trustedSites) ? sb.trustedSites : []);
            renderFidati();
          } catch (_) {}
          return;
        }
        const hint = $('savedHint');
        hint.classList.add('sn-show');
        clearTimeout(renderFidati._t);
        renderFidati._t = setTimeout(() => hint.classList.remove('sn-show'), 1500);
      });
      li.appendChild(span);
      li.appendChild(btn);
      list.appendChild(li);
    }
  }

  // Cosa Filo ha fatto coi banner, sito per sito: la stessa memoria che il menu della scheda legge, tutta.
  // «Mostra il banner» qui fa quello che fa dal menu: il sito passa all'elenco sopra e dimentica la risposta.
  let cookieDoneSites = [];
  let cookieDoneSig = '';

  async function loadCookieDone() {
    let r = null;
    try { r = await chrome.runtime.sendMessage({ type: MSG.COOKIES_SITES }); } catch (_) {}
    const sites = (r && r.ok && Array.isArray(r.sites) ? r.sites : []).filter((x) => x && !cookieBannerSites.includes(x.site));
    const sig = sites.map((x) => x.site + (x.rejected ? 'r' : '') + (x.hidden ? 'h' : '')).join('\n');
    if (sig === cookieDoneSig) return;
    cookieDoneSig = sig;
    cookieDoneSites = sites;
    renderCookieDone();
  }

  function renderCookieDone() {
    const box = $('sec-cookies-done');
    const list = $('cookie-done-list');
    list.innerHTML = '';
    box.hidden = !cookieDoneSites.length;
    for (const it of cookieDoneSites) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = leggibile(it.site);
      const what = document.createElement('span');
      what.className = 'sn-muted';
      what.style.marginLeft = '8px';
      what.textContent = I18n.t(it.rejected ? 'options_cookies_done_rejected' : 'options_cookies_done_hidden');
      span.appendChild(what);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sn-btn-secondary';
      btn.textContent = I18n.t('options_cookies_done_show');
      btn.addEventListener('click', () => {
        if (!cookieBannerSites.includes(it.site)) cookieBannerSites.push(it.site);
        cookieBannerSites.sort();
        cookieDoneSites = cookieDoneSites.filter((x) => x.site !== it.site);
        cookieDoneSig = '';
        renderBannerSites();
        renderCookieDone();
        saveCookies();
      });
      li.appendChild(span);
      li.appendChild(btn);
      list.appendChild(li);
    }
  }

  // Un input rifiutato senza avviso sparirebbe senza spiegazione.
  function setWhitelistError(msg) {
    const el = $('cookie-wl-error');
    if (!el) return;
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
  }

  function addWhitelistDomain(opts) {
    const input = $('cookie-wl-input');
    const raw = String(input.value || '').trim();
    if (!raw) { setWhitelistError(''); return; }
    const domain = sitoFidato(raw);
    if (!domain) {
      // Input non vuoto ma non è un sito: avvisa invece di svuotare
      // in silenzio. Lascia il testo nel campo così l'utente può correggerlo.
      setWhitelistError(avvisoFidato(raw));
      if (!(opts && opts.fuoco === false)) input.focus();
      return;
    }
    if (cookieWhitelist.includes(domain)) {
      setWhitelistError(I18n.t('options_cookies_whitelist_dup', leggibile(domain)));
      input.value = '';
      return;
    }
    cookieWhitelist.push(domain);
    cookieWhitelist.sort();
    renderWhitelist();
    syncCookieMode();
    setWhitelistError('');
    input.value = '';
    saveCookies();
  }

  // Un sito lasciato nella casella vale già come fidato; quello che non è un dominio resta come `bozza`.
  async function saveCookies() {
    caselle.spedita('fidato');
    const bozza = String($('cookie-wl-input').value || '').trim();
    const dominio = sitoFidato(bozza);
    const fidati = dominio && !cookieWhitelist.includes(dominio) ? [...cookieWhitelist, dominio].sort() : cookieWhitelist.slice();
    const partial = {
      security: {
        cookies: {
          mode: currentMode(),
          trustedSites: fidati,
          bannerSites: cookieBannerSites.slice(),
          loggedSites: cookieLoggedSites.slice(),
          embedSites: cookieEmbedSites.slice(),
          bozza: dominio ? '' : bozza,
        },
      },
    };
    await chrome.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings: partial });
    const hint = $('savedHint');
    hint.classList.add('sn-show');
    clearTimeout(saveCookies._t);
    saveCookies._t = setTimeout(() => hint.classList.remove('sn-show'), 1500);
  }

  // I sotto-controlli valgono solo quando il controllo principale è acceso.
  function syncSafebrowseEnabled() {
    const on = $('sec-safebrowse').checked;
    const sub = $('sec-safebrowse-sub');
    sub.style.opacity = on ? '1' : '0.45';
    for (const id of ['sec-safebrowse-network', 'sec-safebrowse-llm', 'sec-safebrowse-sandbox']) {
      $(id).disabled = !on;
    }
  }

  function syncSiteBlockEnabled() {
    const on = !!$('sec-siteblock').checked;
    const sub = $('sec-siteblock-sub');
    if (sub) sub.style.opacity = on ? '1' : '0.45';
    $('sec-siteblock-lists').disabled = !on;
    $('sec-siteblock-blacklist').disabled = !on;
  }

  function syncDownloadsEnabled() {
    const on = !!$('sec-dl-exe').checked;
    const sub = $('sec-dl-exe-sub');
    if (sub) sub.style.opacity = on ? '1' : '0.45';
    $('sec-dl-trusted').disabled = !on;
  }

  // Spenta la protezione, l'elenco resta lì ma non vale: si vede attenuato, come quello dei siti fidati.
  function syncDelicateEnabled() {
    const on = !!$('sec-delicate').checked;
    const sub = $('sec-delicate-sub');
    if (sub) sub.style.opacity = on ? '1' : '0.45';
    $('sec-delicate-sites').disabled = !on;
  }

  // I siti che Filo ha segnato da solo per un campo password o carta: tutti visibili, e ognuno si toglie e si rimette.
  let delicateCampi = [];
  let delicateCampiSig = '';
  async function loadDelicateCampi() {
    let r = null;
    try { r = await chrome.runtime.sendMessage({ type: MSG.PAGINE_DELICATE_CAMPI }); } catch (_) {}
    const siti = r && r.ok && Array.isArray(r.siti) ? r.siti : [];
    const sig = siti.map((x) => x.sito + (x.tolto ? '-' : '')).join('\n');
    if (sig === delicateCampiSig) return;
    delicateCampiSig = sig;
    delicateCampi = siti;
    renderDelicateCampi();
  }

  function renderDelicateCampi() {
    const box = $('sec-delicate-campi');
    const list = $('sec-delicate-campi-list');
    list.innerHTML = '';
    box.hidden = !delicateCampi.length;
    for (const it of delicateCampi) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = leggibile(it.sito);
      if (it.tolto) {
        const what = document.createElement('span');
        what.className = 'sn-muted';
        what.style.marginLeft = '8px';
        what.textContent = I18n.t('options_security_delicate_campi_tolto');
        span.appendChild(what);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sn-btn-secondary';
      btn.textContent = I18n.t(it.tolto ? 'options_security_delicate_campi_rimetti' : 'options_security_delicate_campi_togli');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        // L'elenco ha già tutti i tolti: è da lì che si scrive quello nuovo.
        const tolti = delicateCampi.filter((x) => x.tolto && x.sito !== it.sito).map((x) => x.sito);
        if (!it.tolto) tolti.push(it.sito);
        await chrome.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings: { security: { pagineDelicate: { nonDelicati: tolti.sort() } } } });
        delicateCampiSig = '';
        await loadDelicateCampi();
      });
      li.appendChild(span);
      li.appendChild(btn);
      list.appendChild(li);
    }
  }

  // Una riga che non è un dominio non protegge niente, e chi l'ha scritta crede di sì.
  function setDelicateError(invalidRows) {
    const el = $('sec-delicate-sites-error');
    if (!el) return;
    if (invalidRows && invalidRows.length) {
      el.textContent = I18n.t('options_security_delicate_sites_invalid', invalidRows.join(', '));
      el.style.display = 'block';
    } else {
      el.textContent = '';
      el.style.display = 'none';
    }
  }

  // Le righe scartate si dicono, come per la blacklist: un dominio scritto male
  // qui non allenta nessuna difesa, ma chi l'ha scritto crede di sì.
  // Una piattaforma che ospita i siti di chiunque (github.io) è scartata anche lei, ma col suo perché e il sito preciso
  // da scrivere al suo posto (#876).
  function setTrustedError(invalidRows) {
    const el = $('sec-dl-trusted-error');
    if (!el) return;
    const piattaforme = [];
    const altre = [];
    for (const r of invalidRows || []) {
      const v = Eseguibili.sitoFidabile(r);
      if (!(v && v.piattaforma)) altre.push(r);
      else if (!piattaforme.includes(v.piattaforma)) piattaforme.push(v.piattaforma);
    }
    const frasi = piattaforme.map((p) => Eseguibili.testoPiattaforma(p, sitiScaricati));
    if (altre.length) frasi.push(I18n.t('options_security_downloads_trusted_invalid', altre.join(', ')));
    el.textContent = frasi.join('\n');
    el.style.display = frasi.length ? 'block' : 'none';
  }

  // I siti da cui sono scesi programmi, dal più recente: il sito preciso da proporre a chi scrive la loro piattaforma.
  // Solo quello cliccato: chi serve i byte dopo un rimando è di solito un deposito di tutti (il secchio di Bitbucket).
  let sitiScaricati = [];
  async function caricaSitiScaricati() {
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.DOWNLOADS_LIST });
      const items = (r && Array.isArray(r.items) ? r.items : []).filter((x) => x && x.exe);
      sitiScaricati = items.map((x) => x.site).filter((s) => typeof s === 'string' && s);
    } catch (_) { sitiScaricati = []; }
    if ($('sec-dl-trusted-error').style.display === 'block') setTrustedError(parseFidati($('sec-dl-trusted').value).invalid);
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

  // Ogni riga ridotta come i siti fidati (niente IP né nomi senza estensione): i validi e le righe scartate col loro posto.
  const parseBlacklist = window.SN_NOMI_SITO.elencoDaTesto;
  const righe = window.SN_NOMI_SITO.testoDaElenco;
  // I programmi fidati: ogni riga al sito che copre, le piattaforme fra le scartate.
  const parseFidati = Eseguibili.elencoFidati;

  // Le caselle di testo della pagina non hanno un «Salva» (#590.2): ognuna si iscrive qui e ne eredita pausa e uscite.
  // L'uscita vera accende gli avvisi anche se il testo è già partito col Ctrl di Ctrl+Tab, e il sito lasciato
  // nella casella dei fidati passa nell'elenco: tornando lo si trova dove si trova riaprendo la pagina.
  const caselle = window.SN_CASELLE.crea({
    uscita() {
      setBlacklistError(parseBlacklist($('sec-siteblock-blacklist').value).invalid);
      setTrustedError(parseFidati($('sec-dl-trusted').value).invalid);
      setDelicateError(parseBlacklist($('sec-delicate-sites').value).invalid);
      if (String($('cookie-wl-input').value || '').trim()) addWhitelistDomain({ fuoco: false });
    },
    spegni: () => $('savedHint').classList.remove('sn-show'),
  });
  caselle.registra('liste', (avvisi) => save({ avvisi }));
  caselle.registra('fidato', (avvisi) => spedisciFidato(avvisi));
  function spedisciFidato(avvisi) {
    const raw = String($('cookie-wl-input').value || '').trim();
    if (avvisi && raw && !sitoFidato(raw)) setWhitelistError(avvisoFidato(raw));
    saveCookies();
  }

  // La sezione Sicurezza come la mostra la pagina adesso.
  function leggiSicurezza() {
    const blocco = parseBlacklist($('sec-siteblock-blacklist').value);
    const fidati = parseFidati($('sec-dl-trusted').value);
    const delicati = parseBlacklist($('sec-delicate-sites').value);
    return {
      protectIpLeak: !!$('sec-protect-ip').checked,
      blockPopups: !!$('sec-block-popups').checked,
      adblock: { enabled: !!$('sec-adblock').checked },
      adSkip: { enabled: !!$('sec-adskip').checked },
      siteBlock: {
        enabled: !!$('sec-siteblock').checked,
        useAdblockLists: !!$('sec-siteblock-lists').checked,
        blacklist: blocco.valid,
        righeScartate: blocco.scartate,
      },
      safeBrowse: {
        enabled: !!$('sec-safebrowse').checked,
        networkSignals: !!$('sec-safebrowse-network').checked,
        llmJudge: !!$('sec-safebrowse-llm').checked,
        sandbox: !!$('sec-safebrowse-sandbox').checked,
      },
      // #588 — conferma sui programmi scaricati, e i siti che ne sono esenti.
      downloads: {
        confirmExecutables: !!$('sec-dl-exe').checked,
        trustedSites: fidati.valid,
        righeScartate: fidati.scartate,
      },
      // #1004 — le pagine delicate e i siti che l'utente aggiunge all'elenco di serie.
      pagineDelicate: {
        enabled: !!$('sec-delicate').checked,
        siti: delicati.valid,
        righeScartate: delicati.scartate,
      },
      // F4 — Feedback autonomo: letto da maybeAutoFeedback nel main process.
      autoFeedback: !!$('sec-auto-feedback').checked,
      riquadriRotti: { modello: !!$('sec-riquadri-modello').checked },
    };
  }

  // Quello che la pagina ha letto o scritto l'ultima volta. Si salva solo ciò che l'utente ha
  // cambiato qui: una pagina rimasta aperta da prima non riscrive la lista cambiata altrove (#590).
  let mostrata = null;

  function soloCambiati(ora, prima) {
    const out = {};
    for (const k of Object.keys(ora)) {
      const n = ora[k];
      const v = prima ? prima[k] : undefined;
      if (n && typeof n === 'object' && !Array.isArray(n)) {
        const d = soloCambiati(n, v && typeof v === 'object' ? v : null);
        if (Object.keys(d).length) out[k] = d;
      } else if (JSON.stringify(n) !== JSON.stringify(v)) {
        out[k] = n;
      }
    }
    return out;
  }

  // Con `avvisi: false` (mentre si scrive) le righe scartate non si dicono ancora: «faceb» è una riga a metà.
  async function save(opts) {
    const biglietto = caselle.spedita('liste');
    if (!(opts && opts.avvisi === false)) {
      setTrustedError(parseFidati($('sec-dl-trusted').value).invalid);
      setBlacklistError(parseBlacklist($('sec-siteblock-blacklist').value).invalid);
      setDelicateError(parseBlacklist($('sec-delicate-sites').value).invalid);
    }
    const ora = leggiSicurezza();
    const cambi = soloCambiati(ora, mostrata);
    mostrata = ora;
    if (Object.keys(cambi).length) {
      await chrome.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings: { security: cambi }, mentreScrive: !!(opts && opts.avvisi === false) });
    }
    if (!caselle.aggiornata('liste', biglietto)) return;
    const hint = $('savedHint');
    hint.classList.add('sn-show');
    clearTimeout(save._t);
    save._t = setTimeout(() => hint.classList.remove('sn-show'), 1500);
  }

  // Un cambio arrivato da altrove (la chat, un'altra scheda): la pagina mostra il valore nuovo, tranne nei
  // campi che l'utente ha toccato qui e non sono ancora partiti. Le voci le dà la fonte unica (#949).
  function foglieDi(o, base = '', out = []) {
    for (const k of Object.keys(o || {})) {
      const p = base ? `${base}.${k}` : k;
      if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) foglieDi(o[k], p, out);
      else out.push(p);
    }
    return out;
  }
  function dentroDi(o, percorso) {
    return percorso.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
  }
  function mettiIn(o, percorso, v) {
    const seg = percorso.split('.');
    let n = o;
    for (let i = 0; i < seg.length - 1; i++) { if (!n[seg[i]] || typeof n[seg[i]] !== 'object') n[seg[i]] = {}; n = n[seg[i]]; }
    n[seg[seg.length - 1]] = v;
  }
  function riallinea(settings) {
    if (!mostrata || !settings) return;
    const Voci = window.SN_VOCI_IMPOSTAZIONI;
    const pendenti = foglieDi(soloCambiati(leggiSicurezza(), mostrata));
    // Le righe scartate sono la metà non valida della stessa casella.
    const inSospeso = new Set(pendenti.map((p) => p.replace(/^siteBlock\.righeScartate$/, 'siteBlock.blacklist')
      .replace(/^downloads\.righeScartate$/, 'downloads.trustedSites')
      .replace(/^pagineDelicate\.righeScartate$/, 'pagineDelicate.siti')));
    const sec = settings.security || {};
    const scartate = {
      'sec-siteblock-blacklist': (sec.siteBlock || {}).righeScartate,
      'sec-dl-trusted': (sec.downloads || {}).righeScartate,
      'sec-delicate-sites': (sec.pagineDelicate || {}).righeScartate,
    };
    const toccati = Voci.riallineaPagina('security', settings, {
      // La casella dei siti fidati serve ad aggiungerne uno: l'elenco vero è sotto, e si riallinea qui dopo.
      // Una casella che dice già lo stesso elenco, con altre righe vuote o a metà, non si riscrive: chi scrive
      // perderebbe l'a capo appena battuto. Quello che non è ancora partito sta in `inSospeso`.
      salta: (id, percorso, el) => id === 'cookie-wl-input' || inSospeso.has(percorso.replace(/^security\./, ''))
        || (el.tagName === 'TEXTAREA'
          && JSON.stringify((id === 'sec-dl-trusted' ? parseFidati : parseBlacklist)(el.value).valid)
            === JSON.stringify(Voci.leggi(settings, percorso))),
      elenco: (id, lista) => righe(lista, scartate[id]),
    });
    const fidati = Voci.leggi(settings, 'security.cookies.trustedSites');
    if (Array.isArray(fidati) && Google.sitiDeiFidati(fidati).join('\n') !== cookieWhitelist.join('\n')) {
      cookieWhitelist = Google.sitiDeiFidati(fidati);
      renderWhitelist();
    }
    if (toccati.includes('sec-siteblock-blacklist')) setBlacklistError(parseBlacklist($('sec-siteblock-blacklist').value).invalid);
    if (toccati.includes('sec-dl-trusted')) setTrustedError(parseFidati($('sec-dl-trusted').value).invalid);
    if (toccati.includes('sec-delicate-sites')) setDelicateError(parseBlacklist($('sec-delicate-sites').value).invalid);
    syncSiteBlockEnabled();
    syncDownloadsEnabled();
    syncDelicateEnabled();
    syncSafebrowseEnabled();
    syncCookieMode();
    const ora = leggiSicurezza();
    for (const p of pendenti) mettiIn(ora, p, dentroDi(mostrata, p));
    mostrata = ora;
  }

  // Un sito aggiunto dal menu della scheda mentre questa pagina è aperta deve comparire qui, e un
  // salvataggio da qui non deve riscrivere l'elenco com'era all'apertura.
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === MSG.SETTINGS_UPDATED && msg.settings) {
        const p = JSON.stringify(msg.settings.proxy || {});
        if (p !== lastProxy) { lastProxy = p; renderProxyBox(); }
        mostraCaselleChiavi(msg.settings);
        riallinea(msg.settings);
        loadDelicateCampi();
        // Un «Continua» in un'altra scheda, o la chat, cambia l'elenco mentre la pagina è aperta.
        const f = msg.settings.security && msg.settings.security.safeBrowse && msg.settings.security.safeBrowse.trustedSites;
        if (Array.isArray(f) && f.join('\n') !== sbFidati.join('\n')) { sbFidati = f.slice(); renderFidati(); }
      }
      const c = msg && msg.type === MSG.SETTINGS_UPDATED && msg.settings && msg.settings.security && msg.settings.security.cookies;
      if (!c) return;
      // Un accesso visto da Filo entra nell'elenco mentre la pagina è aperta.
      if (Array.isArray(c.loggedSites) && c.loggedSites.join('\n') !== cookieLoggedSites.join('\n')) {
        cookieLoggedSites = c.loggedSites.slice();
        renderLoggedSites();
      }
      // Un servizio riattivato dalla proposta sul riquadro entra nell'elenco mentre la pagina è aperta.
      if (Array.isArray(c.embedSites) && c.embedSites.join('\n') !== cookieEmbedSites.join('\n')) {
        cookieEmbedSites = c.embedSites.slice();
        renderEmbedSites();
      }
      if (!Array.isArray(c.bannerSites)) return;
      if (c.bannerSites.join('\n') === cookieBannerSites.join('\n')) return;
      cookieBannerSites = c.bannerSites.slice();
      renderBannerSites();
      loadCookieDone();
    });
  }
  // Filo rifiuta e nasconde mentre si naviga nelle altre schede: tornando qui l'elenco è quello di adesso.
  // In una scheda di Filo il cambio di scheda non passa da `visibilitychange` (resta per il
  // ricaricamento): lo annuncia il main con TAB_IN_VISTA. L'uscita la ascolta SN_CASELLE.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { loadCookieDone(); loadDelicateCampi(); caricaSitiScaricati(); }
  });
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === MSG.TAB_IN_VISTA && msg.inVista) { loadCookieDone(); loadDelicateCampi(); caricaSitiScaricati(); }
      if (msg && msg.type === MSG.PERMESSI_SITI_CAMBIATI) renderSitePerms();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    load().catch((e) => console.warn('[Sicurezza] caricamento:', e)).finally(portaAlTasto);
    // Tornando su questa scheda si rilegge, a meno che l'utente non abbia qui modifiche non salvate:
    // un'altra pagina Sicurezza può aver cambiato le liste nel frattempo.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !mostrata) return;
      if (Object.keys(soloCambiati(leggiSicurezza(), mostrata)).length) return;
      load();
    });
    // Niente pulsante "Salva": ogni toggle viene applicato e persistito subito.
    $('sec-protect-ip').addEventListener('change', save);
    $('sec-block-popups').addEventListener('change', save);
    $('sec-adblock').addEventListener('change', save);
    $('sec-adskip').addEventListener('change', save);
    $('sec-siteblock').addEventListener('change', () => { syncSiteBlockEnabled(); save(); });
    $('sec-siteblock-lists').addEventListener('change', save);
    // L'avviso sulle righe scartate si toglie mentre si corregge e torna quando si esce dal campo.
    $('sec-siteblock-blacklist').addEventListener('change', save);
    $('sec-siteblock-blacklist').addEventListener('input', (e) => { setBlacklistError([]); caselle.cambiato('liste', e); });
    $('sec-dl-exe').addEventListener('change', () => { syncDownloadsEnabled(); save(); });
    $('sec-dl-trusted').addEventListener('change', save);
    $('sec-dl-trusted').addEventListener('input', (e) => { setTrustedError([]); caselle.cambiato('liste', e); });
    $('sec-delicate').addEventListener('change', () => { syncDelicateEnabled(); save(); });
    $('sec-delicate-sites').addEventListener('change', save);
    $('sec-delicate-sites').addEventListener('input', (e) => { setDelicateError([]); caselle.cambiato('liste', e); });
    $('sec-safebrowse').addEventListener('change', () => { syncSafebrowseEnabled(); save(); });
    $('sec-safebrowse-network').addEventListener('change', save);
    $('sec-safebrowse-llm').addEventListener('change', save);
    $('sec-safebrowse-sandbox').addEventListener('change', save);
    $('sec-auto-feedback').addEventListener('change', save);
    $('sec-riquadri-modello').addEventListener('change', save);
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
    // Mentre si corregge l'avviso sparisce, e il testo parte come quello delle due liste.
    $('cookie-wl-input').addEventListener('input', (e) => { setWhitelistError(''); caselle.cambiato('fidato', e); });
    $('cookie-wl-input').addEventListener('change', () => spedisciFidato(true));
    for (const id of ['sec-visite-ora', 'sec-visite-oggi', 'sec-visite-tutto']) {
      $(id).addEventListener('click', (e) => cancellaVisite(e.currentTarget));
    }
    $('sec-clip-clear').addEventListener('click', clearClipboard);
    $('sec-clip-search').addEventListener('input', applyClipFilter);
    // Finché il puntatore è dentro la lista, nessuna riga cambia posto: una
    // riga tolta resta al suo posto barrata e le voci nuove aspettano. Appena
    // esce, la lista si ricompone. Vedi il commento lungo su renderClipboard.
    const lista = $('sec-clip-list');
    lista.addEventListener('mouseenter', () => { puntatoreDentro = true; });
    lista.addEventListener('mouseleave', () => {
      puntatoreDentro = false;
      if (inAttesa) renderClipboard(inAttesa, { forza: true });
      else if (lista.querySelector('.sn-clip-gone')) renderClipboard(vociCorrenti, { forza: true });
    });
    $('sec-export-btn').addEventListener('click', () => exportData());
    for (const id of CASELLE_CHIAVI) {
      $(id).addEventListener('change', (e) => { for (const altra of CASELLE_CHIAVI) $(altra).checked = e.currentTarget.checked; });
    }
    $('sec-import-btn').addEventListener('click', importData);
    $('sec-wipe-btn').addEventListener('click', apriCancellaTutto);
    $('sec-wipe-export').addEventListener('click', () => exportData({
      btn: $('sec-wipe-export'), hint: $('sec-wipe-export-hint'), fatto: 'security_wipe_export_done', resta: true,
    }));
    $('sec-wipe-word').addEventListener('input', aggiornaTastoCancella);
    $('sec-wipe-word').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); cancellaTutto(); }
    });
    $('sec-wipe-go').addEventListener('click', cancellaTutto);
    $('sec-wipe-cancel').addEventListener('click', () => { chiudiCancellaTutto(); $('sec-wipe-btn').focus(); });
    $('sec-wipe-box').addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || cancellazioneInCorso) return;
      e.preventDefault();
      chiudiCancellaTutto();
      $('sec-wipe-btn').focus();
    });
    window.addEventListener('hashchange', portaAlTasto);
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
