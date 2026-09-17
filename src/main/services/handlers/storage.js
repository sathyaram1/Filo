// Handler di dominio: storage (shim chrome.storage), impostazioni, export
// dati, cronologia appunti (clipboard), cronologia AI e costi.

module.exports = function register(on, ctx) {
  const { MSG, winOf, applySettingsUpdate } = ctx;
  const { SN_CONST } = globalThis;
  const Storage = globalThis.SN_STORAGE;
  const History = globalThis.SN_HISTORY;
  const Costs = globalThis.SN_COSTS;
  const I18n = globalThis.SN_I18N;

  // Difesa in profondità: le operazioni potenti (azzerare, leggere le chiavi, scrivere i
  // settings) solo da filo://; ciò che i content script fanno davvero resta consentito.
  const SETTINGS_KEY = SN_CONST.STORAGE_KEYS.SETTINGS; // 'settings' → contiene apiKeys
  const isFilo = (origin) => String(origin || '').startsWith('filo://');
  // Le pagine web non devono vedere `settings.apiKeys`: al renderer non serve, la chiave la
  // allega il main.
  function redactForWeb(value) {
    if (!value || typeof value !== 'object' || !value[SETTINGS_KEY]) return value;
    const s = value[SETTINGS_KEY];
    if (!s || typeof s !== 'object' || !s.apiKeys) return value;
    return { ...value, [SETTINGS_KEY]: { ...s, apiKeys: undefined } };
  }
  // Una richiesta tocca la chiave `settings`? (set: oggetto; remove: lista chiavi)
  const touchesSettings = (keys) =>
    (Array.isArray(keys) ? keys : [keys]).some((k) => k === SETTINGS_KEY);

  on('_storage:get', async (msg, sender, origin) => {
    const value = await globalThis.chrome.storage.local.get(msg.keys ?? null);
    return { ok: true, value: isFilo(origin) ? value : redactForWeb(value) };
  });

  on('_storage:set', async (msg, sender, origin) => {
    const obj = msg.obj || {};
    // Una pagina web non può scrivere né avvelenare i settings, né iniettare apiKeys.
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
    // Azzerare tutti i dati non è mai legittimo per una pagina web: solo le pagine interne.
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
    await globalThis.chrome.storage.local.clear();
    return { ok: true };
  });

  on(MSG.GET_SETTINGS, async (msg, sender, origin) => {
    const settings = await Storage.getSettings();
    // Indirizzo della PAGINA, non del riquadro che chiede: serve a sapere se il sito che lo
    // ospita è fra quelli dove Filo è spento, e da dentro un riquadro è illeggibile.
    const pageUrl = String(sender?.tab?.url || '');
    // Le pagine web leggono tema, spellcheck e simili, ma non devono ricevere le chiavi API.
    if (!isFilo(origin) && settings && settings.apiKeys) {
      return { ok: true, pageUrl, settings: { ...settings, apiKeys: undefined } };
    }
    return { ok: true, pageUrl, settings };
  });

  on(MSG.UPDATE_SETTINGS, async (msg, sender, origin) => {
    // I content script aggiornano legittimamente alcune preferenze: l'update non è vietato
    // in blocco; le chiavi API si strippano prima del merge, o una pagina ne inietta una.
    let incoming = msg.settings;
    if (!isFilo(origin) && incoming && typeof incoming === 'object' && 'apiKeys' in incoming) {
      incoming = { ...incoming };
      delete incoming.apiKeys;
    }
    // Tutta la propagazione vive in applySettingsUpdate: lo stesso percorso di quando una
    // preferenza la cambia Filo dalla chat.
    const merged = await applySettingsUpdate(incoming);
    if (!isFilo(origin) && merged && merged.apiKeys) {
      return { ok: true, settings: { ...merged, apiKeys: undefined } };
    }
    return { ok: true, settings: merged };
  });

  on(MSG.RESET_SETTINGS, async (msg, sender, origin) => {
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
    // Ripristino completo: sostituisce l'INTERO oggetto settings, non un merge, così spariscono
    // anche le chiavi residue. Si preservano solo le credenziali dei provider AI.
    const current = await Storage.getSettings();
    const defaults = JSON.parse(JSON.stringify(SN_CONST.DEFAULT_SETTINGS));
    if (current && current.apiKeys) defaults.apiKeys = current.apiKeys;
    if (current && current.modelRegistry) defaults.modelRegistry = current.modelRegistry;
    await Storage.setSettings(defaults);
    const merged = await applySettingsUpdate({});
    return { ok: true, settings: merged };
  });

  on(MSG.EXPORT_DATA, async (msg, sender, origin) => {
    // Solo dalle pagine interne: una pagina web non deve poter innescare un dump completo dei
    // dati utente, chiavi API comprese, né aprire un file dialog.
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
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

  // Due passi apposta: prima si dice all'utente COSA contiene l'archivio, poi si scrive, dopo
  // un sì esplicito. Il contenuto resta nel main: un dump completo non attraversa l'IPC.
  let PENDING_IMPORT = null;

  on(MSG.IMPORT_DATA_PREVIEW, async (msg, sender, origin) => {
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
    try {
      const { dialog } = require('electron');
      const fsp = require('node:fs/promises');
      const path = require('node:path');
      const { readExportZip } = require('../exportData');

      const win = winOf(sender);
      const res = await dialog.showOpenDialog(win || undefined, {
        title: I18n.t('security_import_title'),
        properties: ['openFile'],
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
      });
      if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };

      const filePath = res.filePaths[0];
      const buf = await fsp.readFile(filePath);
      const parsed = readExportZip(buf); // lancia se non è un export di Filo

      const token = `imp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      PENDING_IMPORT = { token, data: parsed.data, at: Date.now() };
      return {
        ok: true,
        token,
        fileName: path.basename(filePath),
        exportedAt: parsed.exportedAt || '',
        sections: parsed.sectionCount,
        images: parsed.imageCount,
      };
    } catch (e) {
      // «Non è un archivio di Filo» si distingue dall'errore generico: la pagina lo dice con
      // parole umane.
      const code = String(e?.message || e);
      const invalid = ['not_a_zip', 'no_data_json', 'bad_data_json', 'zip64_unsupported'].includes(code);
      if (!invalid) console.error('[Filo import] lettura fallita:', e);
      return { ok: false, error: invalid ? 'invalid_file' : code };
    }
  });

  // Il contenuto in attesa scade: se l'utente si dimentica dell'anteprima, un dump dei suoi
  // dati non deve restare in memoria per tutta la sessione.
  const IMPORT_TTL_MS = 10 * 60 * 1000;

  on(MSG.IMPORT_DATA_APPLY, async (msg, sender, origin) => {
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
    if (PENDING_IMPORT && Date.now() - PENDING_IMPORT.at > IMPORT_TTL_MS) PENDING_IMPORT = null;
    if (!PENDING_IMPORT || !msg || msg.token !== PENDING_IMPORT.token) {
      return { ok: false, error: 'expired' };
    }
    const pending = PENDING_IMPORT;
    PENDING_IMPORT = null;
    try {
      const DiskStorage = require('../../shim/storage');
      const { mergeImportedData } = require('../exportData');

      const current = await DiskStorage.get(null);
      const { merged, stats } = mergeImportedData(current, pending.data);

      // Le impostazioni passano da applySettingsUpdate, così il backup è attivo subito senza
      // riavviare. Si riscrivono solo le chiavi che cambiano: gli altri listener non si svegliano.
      const settings = merged[SETTINGS_KEY];
      const rest = {};
      for (const k of Object.keys(merged)) {
        if (k === SETTINGS_KEY) continue;
        if (JSON.stringify(merged[k]) !== JSON.stringify(current[k])) rest[k] = merged[k];
      }
      if (Object.keys(rest).length) await DiskStorage.set(rest);
      if (settings && typeof settings === 'object') await applySettingsUpdate(settings);

      return { ok: true, added: stats.added, updated: stats.updated, unchanged: stats.unchanged };
    } catch (e) {
      console.error('[Filo import] scrittura fallita:', e);
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // Cronologia appunti NON guardata per origine, di proposito: il menu «Incolla» gira su
  // qualsiasi pagina, e un gate la spegnerebbe ovunque tranne le pagine interne.
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

  // Come PUSH, non guardata per origine: il raggio è una voce sola, e serve a togliere subito
  // una password copiata senza cambiare pagina.
  on(MSG.REMOVE_CLIPBOARD_ENTRY, async (msg) => {
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
    const target = keyOf(e);
    const next = arr.filter((x) => keyOf(x) !== target);
    if (next.length !== arr.length) {
      await Storage.setRaw(SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, next);
    }
    return { ok: true, items: next };
  });

  // Svuotare si deve poter fare dallo stesso menu «Incolla» che la mostra, e quel menu gira su
  // qualunque pagina. Lettura e rimozione sono già aperte: il gate non proteggerebbe niente.
  on(MSG.CLEAR_CLIPBOARD_HISTORY, async () => {
    await Storage.setRaw(SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, []);
    return { ok: true };
  });

  // Cronologia AI e costi solo dalle pagine interne: contengono testi dell'utente e un dato
  // riservato, che nessuna pagina web deve leggere, scrivere o cancellare.
  on(MSG.GET_HISTORY, async (msg, sender, origin) => {
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
    return { ok: true, items: await History.list() };
  });

  on(MSG.APPEND_HISTORY, async (msg, sender, origin) => {
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
    const item = await History.append(msg.entry);
    return { ok: true, item };
  });

  // Stesso confine del resto della cronologia AI; torna la lista aggiornata per riallineare.
  on(MSG.REMOVE_HISTORY_ENTRY, async (msg, sender, origin) => {
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
    const items = await History.remove(msg.id);
    return { ok: true, items };
  });

  on(MSG.CLEAR_HISTORY, async (msg, sender, origin) => {
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
    await History.clear();
    return { ok: true };
  });

  on(MSG.GET_COSTS, async (msg, sender, origin) => {
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
    return { ok: true, monthly: await Costs.getMonthly(), state: await Costs.getState() };
  });
};
