// Logica pagina Sicurezza: due toggle (proteggi IP via WebRTC + blocca popup)
// + box informativo sui servizi P2P. Le impostazioni sono in settings.security.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const I18n = window.SN_I18N;
  const Storage = window.SN_STORAGE;
  const Bootstrap = window.SN_PAGE_BOOTSTRAP;
  // Si salva la forma «xn--…», si mostra il nome come l'utente l'ha scritto (münchen.de).
  const leggibile = window.SN_NOMI_SITO.leggibile;

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
      const conta = (n, uno, molti) => (n === 1 ? `1 ${uno}` : `${n} ${molti}`);
      const delFilo = [
        prev.chats ? conta(prev.chats, 'chat con Filo', 'chat con Filo') : '',
        prev.pagine ? conta(prev.pagine, 'pagina visitata', 'pagine visitate') : '',
      ].filter(Boolean).join(' e ');
      const text = I18n.t('security_import_confirm_text')
        .replace('%1', prev.fileName || '')
        .replace('%2', when)
        .replace('%3', sezioni)
        .replace('%4', immagini)
        .replace('%5', delFilo ? `, più ${delFilo}` : '');

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

  async function load() {
    fillStaticText();
    renderSitePerms();
    const settings = await Storage.getSettings();
    Bootstrap.applyTheme(settings.theme);
    Bootstrap.applyTextScale(settings.textScale);
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
    setTrustedError(parseBlacklist($('sec-dl-trusted').value).invalid);
    syncDownloadsEnabled();
    const del = sec.pagineDelicate || {};
    $('sec-delicate').checked = del.enabled !== false;
    $('sec-delicate-sites').value = righe(del.siti, del.righeScartate);
    setDelicateError(parseBlacklist($('sec-delicate-sites').value).invalid);
    syncDelicateEnabled();
    loadDelicateCampi();
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
    cookieBannerSites = Array.isArray(cookies.bannerSites) ? cookies.bannerSites.slice() : [];
    cookieLoggedSites = Array.isArray(cookies.loggedSites) ? cookies.loggedSites.slice() : [];
    cookieEmbedSites = Array.isArray(cookies.embedSites) ? cookies.embedSites.slice() : [];
    renderWhitelist();
    renderBannerSites();
    renderLoggedSites();
    renderEmbedSites();
    // Il testo lasciato nella casella dei fidati torna lì: un sito valido è già nell'elenco, il resto con l'avviso.
    const bozza = typeof cookies.bozza === 'string' ? cookies.bozza : '';
    $('cookie-wl-input').value = bozza;
    setWhitelistError(bozza.trim() && !cleanDomain(bozza) ? I18n.t('options_cookies_whitelist_invalid') : '');
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
  }

  // Pulisce l'input utente in un dominio confrontabile: toglie schema, path,
  // www. e porta, lascia il bare host minuscolo. "https://www.Gmail.com/x" →
  // "gmail.com". Ritorna '' se non estraibile.
  function cleanDomain(raw) {
    // Come la lista nel main: «*.sito.it», «.sito.it» e «sito.it.» valgono «sito.it». Prima di
    // leggere l'indirizzo, perché il browser scrive la stella come «%2A».
    let s = String(raw || '').trim().toLowerCase().replace(/^([a-z]+:\/\/)?\*?\.+/, '$1');
    if (!s) return '';
    try {
      if (s.includes('://')) s = new URL(s).hostname;
      else s = new URL('http://' + s).hostname;
    } catch (_) {
      s = s.split('/')[0].split('?')[0];
    }
    s = s.replace(/^\.+|\.+$/g, '').replace(/^www\./, '');
    return window.SN_NOMI_SITO.valido(s) ? s : '';
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
      span.textContent = leggibile(domain);
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

  // Mostra (o nasconde, con msg vuoto) un avviso inline sotto il campo "siti
  // fidati". Senza questo, un input rifiutato spariva senza spiegazione.
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
    const domain = cleanDomain(raw);
    if (!domain) {
      // Input non vuoto ma non è un dominio valido: avvisa invece di svuotare
      // in silenzio. Lascia il testo nel campo così l'utente può correggerlo.
      setWhitelistError(I18n.t('options_cookies_whitelist_invalid'));
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
    const dominio = cleanDomain(bozza);
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
  function setTrustedError(invalidRows) {
    const el = $('sec-dl-trusted-error');
    if (!el) return;
    if (invalidRows && invalidRows.length) {
      el.textContent = I18n.t('options_security_downloads_trusted_invalid', invalidRows.join(', '));
      el.style.display = 'block';
    } else {
      el.textContent = '';
      el.style.display = 'none';
    }
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
  // validi (deduplicati) e le righe scartate così com'erano, per l'avviso; `scartate` le tiene
  // col posto (quanti domini validi le precedevano), per ridarle dove l'utente le aveva scritte.
  function parseBlacklist(raw) {
    const valid = [];
    const seen = new Set();
    const invalid = [];
    const scartate = [];
    for (const line of String(raw || '').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const domain = cleanDomain(trimmed);
      if (!domain) { invalid.push(trimmed); scartate.push({ riga: trimmed, dopo: valid.length }); continue; }
      if (seen.has(domain)) continue;
      seen.add(domain);
      valid.push(domain);
    }
    return { valid, invalid, scartate };
  }

  function righe(validi, scartate) {
    const v = (Array.isArray(validi) ? validi : []).filter((r) => typeof r === 'string' && r.trim());
    const s = (Array.isArray(scartate) ? scartate : [])
      .map((x) => (typeof x === 'string' ? { riga: x, dopo: v.length } : x))
      .filter((x) => x && typeof x.riga === 'string' && x.riga.trim());
    const posto = (x) => Math.max(0, Math.min(v.length, Math.floor(Number(x.dopo)) || 0));
    const out = [];
    for (let i = 0; i <= v.length; i++) {
      for (const x of s) if (posto(x) === i) out.push(x.riga);
      if (i < v.length) out.push(leggibile(v[i]));
    }
    return out.join('\n');
  }

  // Le caselle di testo della pagina non hanno un «Salva» (#590.2): ognuna si iscrive qui e ne eredita pausa e uscite.
  // L'uscita vera accende gli avvisi anche se il testo è già partito col Ctrl di Ctrl+Tab, e il sito lasciato
  // nella casella dei fidati passa nell'elenco: tornando lo si trova dove si trova riaprendo la pagina.
  const caselle = window.SN_CASELLE.crea({
    uscita() {
      setBlacklistError(parseBlacklist($('sec-siteblock-blacklist').value).invalid);
      setTrustedError(parseBlacklist($('sec-dl-trusted').value).invalid);
      setDelicateError(parseBlacklist($('sec-delicate-sites').value).invalid);
      if (String($('cookie-wl-input').value || '').trim()) addWhitelistDomain({ fuoco: false });
    },
  });
  caselle.registra('liste', (avvisi) => save({ avvisi }));
  caselle.registra('fidato', (avvisi) => spedisciFidato(avvisi));
  function spedisciFidato(avvisi) {
    const raw = String($('cookie-wl-input').value || '').trim();
    if (avvisi && raw && !cleanDomain(raw)) setWhitelistError(I18n.t('options_cookies_whitelist_invalid'));
    saveCookies();
  }

  // La sezione Sicurezza come la mostra la pagina adesso.
  function leggiSicurezza() {
    const blocco = parseBlacklist($('sec-siteblock-blacklist').value);
    const fidati = parseBlacklist($('sec-dl-trusted').value);
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
    caselle.spedita('liste');
    if (!(opts && opts.avvisi === false)) {
      setTrustedError(parseBlacklist($('sec-dl-trusted').value).invalid);
      setBlacklistError(parseBlacklist($('sec-siteblock-blacklist').value).invalid);
      setDelicateError(parseBlacklist($('sec-delicate-sites').value).invalid);
    }
    const ora = leggiSicurezza();
    const cambi = soloCambiati(ora, mostrata);
    mostrata = ora;
    if (Object.keys(cambi).length) {
      await chrome.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings: { security: cambi }, mentreScrive: !!(opts && opts.avvisi === false) });
    }
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
          && JSON.stringify(parseBlacklist(el.value).valid) === JSON.stringify(Voci.leggi(settings, percorso))),
      elenco: (id, lista) => righe(lista, scartate[id]),
    });
    const fidati = Voci.leggi(settings, 'security.cookies.trustedSites');
    if (Array.isArray(fidati) && fidati.join('\n') !== cookieWhitelist.join('\n')) {
      cookieWhitelist = fidati.slice();
      renderWhitelist();
    }
    if (toccati.includes('sec-siteblock-blacklist')) setBlacklistError(parseBlacklist($('sec-siteblock-blacklist').value).invalid);
    if (toccati.includes('sec-dl-trusted')) setTrustedError(parseBlacklist($('sec-dl-trusted').value).invalid);
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
        riallinea(msg.settings);
        loadDelicateCampi();
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
    if (document.visibilityState === 'visible') { loadCookieDone(); loadDelicateCampi(); }
  });
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === MSG.TAB_IN_VISTA && msg.inVista) { loadCookieDone(); loadDelicateCampi(); }
      if (msg && msg.type === MSG.PERMESSI_SITI_CAMBIATI) renderSitePerms();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
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
    $('sec-export-btn').addEventListener('click', exportData);
    $('sec-import-btn').addEventListener('click', importData);
  });
})();
