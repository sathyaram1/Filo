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

  async function load() {
    fillStaticText();
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
    $('sec-export-btn').addEventListener('click', exportData);
    $('sec-import-btn').addEventListener('click', importData);
  });
})();
