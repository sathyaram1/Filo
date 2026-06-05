// Logica pagina Sicurezza: due toggle (proteggi IP via WebRTC + blocca popup)
// + box informativo sui servizi P2P. Le impostazioni sono in settings.security.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const I18n = window.SN_I18N;
  const Storage = window.SN_STORAGE;
  const Bootstrap = window.SN_PAGE_BOOTSTRAP;

  function $(id) { return document.getElementById(id); }

  function fillStaticText() {
    document.title = I18n.t('security_title');
    $('title').textContent = I18n.t('security_title');
    $('sec-protect-ip-label').textContent = I18n.t('options_security_protect_ip');
    $('sec-protect-ip-desc').textContent = I18n.t('options_security_protect_ip_desc');
    $('sec-block-popups-label').textContent = I18n.t('options_security_block_popups');
    $('sec-block-popups-desc').textContent = I18n.t('options_security_block_popups_desc');
    $('sec-p2p-box-title').textContent = I18n.t('options_security_p2p_box_title');
    $('sec-p2p-box-body').textContent = I18n.t('options_security_p2p_box_body');
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
    $('sec-export-btn').textContent = I18n.t('security_export_btn');
    $('sec-export-desc').textContent = I18n.t('security_export_desc');
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

  async function load() {
    fillStaticText();
    const settings = await Storage.getSettings();
    Bootstrap.applyTheme(settings.theme);
    Bootstrap.applyTextScale(settings.textScale);
    const sec = settings.security || {};
    // Default-on: il merge con DEFAULT_SETTINGS.security mette già true/true se
    // l'utente non ha mai salvato, quindi qui leggiamo "!== false" per
    // riflettere il default anche in casi limite (es. chiave esistente ma null).
    $('sec-protect-ip').checked = sec.protectIpLeak !== false;
    $('sec-block-popups').checked = sec.blockPopups !== false;
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
  }

  // ─── gestione cookie ──────────────────────────────────────────────────────

  let cookieWhitelist = [];

  function currentMode() {
    const checked = document.querySelector('input[name="cookie-mode"]:checked');
    return checked ? checked.value : 'default';
  }

  // In "Privacy massima" niente sopravvive alla sessione: la whitelist non ha
  // effetto, quindi la disabilitiamo e mostriamo la nota esplicativa.
  function syncCookieMode() {
    const privacy = currentMode() === 'privacy';
    $('sec-cookies-wl-privacy-note').style.display = privacy ? 'block' : 'none';
    const wl = $('sec-cookies-whitelist');
    wl.style.opacity = privacy ? '0.45' : '1';
    $('cookie-wl-input').disabled = privacy;
    $('cookie-wl-add-btn').disabled = privacy;
    for (const btn of $('cookie-wl-list').querySelectorAll('button')) btn.disabled = privacy;
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

  function addWhitelistDomain() {
    const domain = cleanDomain($('cookie-wl-input').value);
    if (!domain) { $('cookie-wl-input').value = ''; return; }
    if (!cookieWhitelist.includes(domain)) {
      cookieWhitelist.push(domain);
      cookieWhitelist.sort();
      renderWhitelist();
      saveCookies();
    }
    $('cookie-wl-input').value = '';
  }

  async function saveCookies() {
    const partial = {
      security: {
        cookies: { mode: currentMode(), loginWhitelist: cookieWhitelist.slice() },
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

  async function save() {
    const partial = {
      security: {
        protectIpLeak: !!$('sec-protect-ip').checked,
        blockPopups: !!$('sec-block-popups').checked,
        safeBrowse: {
          enabled: !!$('sec-safebrowse').checked,
          networkSignals: !!$('sec-safebrowse-network').checked,
          llmJudge: !!$('sec-safebrowse-llm').checked,
          sandbox: !!$('sec-safebrowse-sandbox').checked,
        },
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
    $('sec-safebrowse').addEventListener('change', () => { syncSafebrowseEnabled(); save(); });
    $('sec-safebrowse-network').addEventListener('change', save);
    $('sec-safebrowse-llm').addEventListener('change', save);
    $('sec-safebrowse-sandbox').addEventListener('change', save);
    for (const r of document.querySelectorAll('input[name="cookie-mode"]')) {
      r.addEventListener('change', () => { syncCookieMode(); saveCookies(); });
    }
    $('cookie-wl-add-btn').addEventListener('click', addWhitelistDomain);
    $('cookie-wl-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addWhitelistDomain(); }
    });
    $('sec-export-btn').addEventListener('click', exportData);
  });
})();
