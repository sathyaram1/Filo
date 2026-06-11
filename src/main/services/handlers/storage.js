// Handler di dominio: storage (shim chrome.storage), impostazioni, export
// dati, cronologia appunti (clipboard), cronologia AI e costi.

module.exports = function register(on, ctx) {
  const { MSG, winOf, applySettingsUpdate } = ctx;
  const { SN_CONST } = globalThis;
  const Storage = globalThis.SN_STORAGE;
  const History = globalThis.SN_HISTORY;
  const Costs = globalThis.SN_COSTS;
  const I18n = globalThis.SN_I18N;

  // ── canali interni per lo shim chrome.* nel renderer ──────────────────
  on('_storage:get', async (msg) => ({ ok: true, value: await globalThis.chrome.storage.local.get(msg.keys ?? null) }));

  on('_storage:set', async (msg) => {
    await globalThis.chrome.storage.local.set(msg.obj || {});
    return { ok: true };
  });

  on('_storage:remove', async (msg) => {
    await globalThis.chrome.storage.local.remove(msg.keys);
    return { ok: true };
  });

  on('_storage:clear', async () => {
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
