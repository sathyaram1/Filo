// Handler di dominio: storage (shim chrome.storage), impostazioni, export
// dati, cronologia appunti (clipboard), cronologia AI e costi.

module.exports = function register(on, ctx) {
  const { MSG, winOf, applySettingsUpdate } = ctx;
  const { SN_CONST } = globalThis;
  const Storage = globalThis.SN_STORAGE;
  const History = globalThis.SN_HISTORY;
  const Costs = globalThis.SN_COSTS;
  const I18n = globalThis.SN_I18N;

  // ── SICUREZZA: confine d'origine sui canali privilegiati ───────────────
  // Questi handler sono registrati sul canale generico `filo:message`, che è
  // raggiungibile SIA dalle pagine interne filo:// SIA dai content script delle
  // pagine web esterne (shim chrome.* in page-preload.js). I content script
  // girano nel mondo isolato, quindi oggi una pagina ostile non può chiamarli
  // direttamente — ma far poggiare TUTTA la barriera sul solo isolamento di
  // contesto è fragile. Difesa-in-profondità: le operazioni potenti (cancellare
  // tutto lo storage, leggere le chiavi API, scrivere i settings) sono ammesse
  // solo da origine filo://; ciò che i content script fanno davvero (leggere le
  // impostazioni, salvare dizionario/draft/layout) resta consentito.
  const SETTINGS_KEY = SN_CONST.STORAGE_KEYS.SETTINGS; // 'settings' → contiene apiKeys
  const isFilo = (origin) => String(origin || '').startsWith('filo://');
  // Le chiavi web non devono MAI vedere i segreti dentro `settings.apiKeys`: il
  // renderer non ne ha bisogno (le richieste AI allegano la chiave nel main).
  function redactForWeb(value) {
    if (!value || typeof value !== 'object' || !value[SETTINGS_KEY]) return value;
    const s = value[SETTINGS_KEY];
    if (!s || typeof s !== 'object' || !s.apiKeys) return value;
    return { ...value, [SETTINGS_KEY]: { ...s, apiKeys: undefined } };
  }
  // Una richiesta tocca la chiave `settings`? (set: oggetto; remove: lista chiavi)
  const touchesSettings = (keys) =>
    (Array.isArray(keys) ? keys : [keys]).some((k) => k === SETTINGS_KEY);

  // ── canali interni per lo shim chrome.* nel renderer ──────────────────
  on('_storage:get', async (msg, sender, origin) => {
    const value = await globalThis.chrome.storage.local.get(msg.keys ?? null);
    return { ok: true, value: isFilo(origin) ? value : redactForWeb(value) };
  });

  on('_storage:set', async (msg, sender, origin) => {
    const obj = msg.obj || {};
    // Una pagina web non può scrivere/avvelenare i settings (né iniettare apiKeys).
    if (!isFilo(origin) && touchesSettings(Object.keys(obj))) {
      return { ok: false, error: 'forbidden' };
    }
    await globalThis.chrome.storage.local.set(obj);
    return { ok: true };
  });

  on('_storage:remove', async (msg, sender, origin) => {
    if (!isFilo(origin) && touchesSettings(msg.keys)) {
      return { ok: false, error: 'forbidden' };
    }
    await globalThis.chrome.storage.local.remove(msg.keys);
    return { ok: true };
  });

  on('_storage:clear', async (msg, sender, origin) => {
    // Azzerare TUTTI i dati utente non è mai un'operazione legittima per una
    // pagina web: solo le pagine interne (Opzioni → "cancella dati") possono.
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
    await globalThis.chrome.storage.local.clear();
    return { ok: true };
  });

  on(MSG.GET_SETTINGS, async () => ({ ok: true, settings: await Storage.getSettings() }));

  on(MSG.UPDATE_SETTINGS, async (msg) => {
    // Tutta la propagazione (broadcast, tema nativo, sicurezza, fingerprint,
    // safebrowse, cookie) vive in applySettingsUpdate: stesso percorso usato
    // quando Filo cambia una preferenza via chat.
    const merged = await applySettingsUpdate(msg.settings);
    return { ok: true, settings: merged };
  });

  on(MSG.RESET_SETTINGS, async () => {
    // Ripristino completo (#184): riscrive TUTTE le impostazioni ai valori
    // predefiniti in un colpo solo, così qualsiasi personalizzazione estetica
    // sfuggita di mano (token, tema, colore identità delle tab, dimensione del
    // testo…) torna allo stato di fabbrica. Sostituisce l'INTERO oggetto
    // settings (non un merge), così spariscono anche eventuali chiavi residue.
    // Si preservano SOLO le credenziali — chiavi API e registro dei modelli —
    // per non disconnettere l'utente dai provider AI con un reset estetico.
    const current = await Storage.getSettings();
    const defaults = JSON.parse(JSON.stringify(SN_CONST.DEFAULT_SETTINGS));
    if (current && current.apiKeys) defaults.apiKeys = current.apiKeys;
    if (current && current.modelRegistry) defaults.modelRegistry = current.modelRegistry;
    await Storage.setSettings(defaults);
    // Ripersiste i default e li propaga ovunque (broadcast SETTINGS_UPDATED,
    // tema nativo, sicurezza, fingerprint, safebrowse, cookie, colore tab).
    const merged = await applySettingsUpdate({});
    return { ok: true, settings: merged };
  });

  on(MSG.EXPORT_DATA, async (msg, sender) => {
    // Esporta TUTTI i dati di Filo in un unico .zip (data.json + immagini
    // copiate estratte come file). L'utente sceglie dove salvarlo.
    try {
      const { dialog } = require('electron');
      const fsp = require('node:fs/promises');
      const DiskStorage = require('../../shim/storage');
      const { buildExportZip } = require('../exportData');

      const allData = await DiskStorage.get(null);
      const zip = buildExportZip(allData);

      const win = winOf(sender);
      const stamp = new Date().toISOString().slice(0, 10);
      const defaultPath = `filo-export-${stamp}.zip`;
      const res = await dialog.showSaveDialog(win || undefined, {
        title: I18n.t('security_export_title'),
        defaultPath,
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
      });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      await fsp.writeFile(res.filePath, zip);
      return { ok: true, path: res.filePath, bytes: zip.length };
    } catch (e) {
      console.error('[Filo export] fallito:', e);
      return { ok: false, error: String(e?.message || e) };
    }
  });

  on(MSG.GET_CLIPBOARD_HISTORY, async () => {
    const list = await Storage.getRaw(SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, []);
    return { ok: true, items: Array.isArray(list) ? list : [] };
  });

  on(MSG.PUSH_CLIPBOARD_ENTRY, async (msg) => {
    const cap = SN_CONST.CLIPBOARD_HISTORY_MAX;
    const list = await Storage.getRaw(SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, []);
    const arr = Array.isArray(list) ? list : [];
    const e = msg.entry;
    if (!e) return { ok: true, items: arr };
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const keyOf = (x) => {
      if (!x) return '';
      if (x.type === 'text') return 't:' + norm(x.text);
      if (x.type === 'image') return 'i:' + (x.dataUrl || '');
      return '';
    };
    const newKey = keyOf(e);
    const seen = new Set([newKey]);
    const filtered = [];
    for (const x of arr) {
      const k = keyOf(x);
      if (k === newKey || seen.has(k)) continue;
      seen.add(k);
      filtered.push(x);
    }
    filtered.unshift({ ...e, ts: Date.now() });
    const trimmed = filtered.slice(0, cap);
    await Storage.setRaw(SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, trimmed);
    return { ok: true, items: trimmed };
  });

  on(MSG.UPDATE_CLIPBOARD_DESCRIPTION, async (msg) => {
    const list = await Storage.getRaw(SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, []);
    const arr = Array.isArray(list) ? list : [];
    let updated = false;
    for (const x of arr) {
      if (x.type === 'image' && x.dataUrl === msg.dataUrl) {
        x.description = msg.description;
        updated = true;
        break;
      }
    }
    if (updated) await Storage.setRaw(SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, arr);
    return { ok: true, items: arr };
  });

  on(MSG.CLEAR_CLIPBOARD_HISTORY, async () => {
    await Storage.setRaw(SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, []);
    return { ok: true };
  });

  on(MSG.GET_HISTORY, async () => ({ ok: true, items: await History.list() }));

  on(MSG.APPEND_HISTORY, async (msg) => {
    const item = await History.append(msg.entry);
    return { ok: true, item };
  });

  on(MSG.CLEAR_HISTORY, async () => {
    await History.clear();
    return { ok: true };
  });

  on(MSG.GET_COSTS, async () => ({ ok: true, monthly: await Costs.getMonthly(), state: await Costs.getState() }));
};
