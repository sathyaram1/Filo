// Handler di dominio: storage (shim chrome.storage), impostazioni, export
// dati, cronologia appunti (clipboard), cronologia AI e costi.

module.exports = function register(on, ctx) {
  const { MSG, winOf, applySettingsUpdate } = ctx;
  const { SN_CONST } = globalThis;
  const Storage = globalThis.SN_STORAGE;
  const History = globalThis.SN_HISTORY;
  const Costs = globalThis.SN_COSTS;
  const I18n = globalThis.SN_I18N;

  // SICUREZZA — confine d'origine: questi handler stanno sul canale generico `filo:message`, raggiungibile SIA dalle pagine filo:// SIA dai content script dei siti esterni. I content script girano nel mondo isolato, quindi oggi una pagina ostile non può chiamarli, ma far poggiare TUTTA la barriera sull'isolamento di contesto è fragile.
  // Difesa in profondità: le operazioni potenti (azzerare lo storage, leggere le chiavi API, scrivere i settings) solo da origine filo://; ciò che i content script fanno davvero (leggere le impostazioni, salvare dizionario, draft, layout) resta consentito.
  const SETTINGS_KEY = SN_CONST.STORAGE_KEYS.SETTINGS; // 'settings' → contiene apiKeys
  const isFilo = (origin) => String(origin || '').startsWith('filo://');
  // Le pagine web non devono MAI vedere i segreti dentro `settings.apiKeys`: al renderer non servono, perché le richieste AI allegano la chiave nel main.
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
    // Azzerare TUTTI i dati utente non è mai un'operazione legittima per una pagina web: solo le pagine interne (Opzioni → "cancella dati").
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
    await globalThis.chrome.storage.local.clear();
    return { ok: true };
  });

  on(MSG.GET_SETTINGS, async (msg, sender, origin) => {
    const settings = await Storage.getSettings();
    // #405 — indirizzo della PAGINA, non del riquadro incorporato che sta chiedendo: serve a un riquadro per sapere se il sito che lo ospita è fra quelli dove l'utente ha spento Filo. Da dentro un riquadro di un'altra origine quell'indirizzo è illeggibile, e senza questo il menu ricompariva proprio nei siti esclusi.
    const pageUrl = String(sender?.tab?.url || '');
    // Le pagine web leggono tema, spellcheck e simili, ma non devono ricevere le chiavi API.
    if (!isFilo(origin) && settings && settings.apiKeys) {
      return { ok: true, pageUrl, settings: { ...settings, apiKeys: undefined } };
    }
    return { ok: true, pageUrl, settings };
  });

  on(MSG.UPDATE_SETTINGS, async (msg, sender, origin) => {
    // I content script aggiornano legittimamente alcune preferenze (es. il modello di dettatura dal menu del tasto destro), quindi l'update NON è vietato in blocco. Ma da un'origine web non deve poter toccare le chiavi API: si strippano prima del merge, o una pagina ostile potrebbe iniettarne una e dirottare i prompt.
    let incoming = msg.settings;
    if (!isFilo(origin) && incoming && typeof incoming === 'object' && 'apiKeys' in incoming) {
      incoming = { ...incoming };
      delete incoming.apiKeys;
    }
    // Tutta la propagazione (broadcast, tema nativo, sicurezza, fingerprint, safebrowse, cookie) vive in applySettingsUpdate: lo stesso percorso di quando Filo cambia una preferenza via chat.
    const merged = await applySettingsUpdate(incoming);
    if (!isFilo(origin) && merged && merged.apiKeys) {
      return { ok: true, settings: { ...merged, apiKeys: undefined } };
    }
    return { ok: true, settings: merged };
  });

  on(MSG.RESET_SETTINGS, async (msg, sender, origin) => {
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
    // Ripristino completo (#184): sostituisce l'INTERO oggetto settings coi valori predefiniti — non un merge — così spariscono anche le chiavi residue di una personalizzazione sfuggita di mano.
    // Si preservano SOLO le credenziali (chiavi API e registro dei modelli), per non disconnettere l'utente dai provider AI con un reset estetico.
    const current = await Storage.getSettings();
    const defaults = JSON.parse(JSON.stringify(SN_CONST.DEFAULT_SETTINGS));
    if (current && current.apiKeys) defaults.apiKeys = current.apiKeys;
    if (current && current.modelRegistry) defaults.modelRegistry = current.modelRegistry;
    await Storage.setSettings(defaults);
    const merged = await applySettingsUpdate({});
    return { ok: true, settings: merged };
  });

  on(MSG.EXPORT_DATA, async (msg, sender, origin) => {
    // Esporta TUTTI i dati in un unico .zip. Solo dalle pagine interne: una pagina web non deve poter innescare un dump completo dei dati utente (chiavi API comprese) né aprire un file dialog.
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

  // Reimportazione dell'archivio esportato, in DUE passi apposta: il primo legge il file e dice all'utente COSA contiene (quante sezioni, quante immagini, di quando è), così la conferma è informata; il secondo scrive, solo dopo un sì esplicito.
  // Il contenuto letto resta nel main fra i due passi: non si fa attraversare l'IPC a un dump completo dei dati utente — chiavi API comprese — solo per mostrarne il conteggio.
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
      // Si distingue "non è un archivio di Filo" dall'errore generico, così la pagina può dirlo con parole umane.
      const code = String(e?.message || e);
      const invalid = ['not_a_zip', 'no_data_json', 'bad_data_json', 'zip64_unsupported'].includes(code);
      if (!invalid) console.error('[Filo import] lettura fallita:', e);
      return { ok: false, error: invalid ? 'invalid_file' : code };
    }
  });

  // Il contenuto in attesa di conferma scade: se l'utente apre l'anteprima e poi se ne dimentica, un dump completo dei suoi dati non deve restare in memoria per tutta la sessione.
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

      // Le impostazioni passano da applySettingsUpdate come qualsiasi altra modifica, così tema, sicurezza, cookie, fingerprint e adblock del backup diventano attivi SUBITO, senza riavviare.
      // Si riscrivono SOLO le chiavi che l'import cambia davvero: rimettere a posto valori identici sveglierebbe per niente i listener onChanged su tutto lo storage.
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

  // Cronologia appunti: NON guardata per origine, di proposito. Questi canali li usano i content script di Filo sulle pagine web — il menu "Incolla" con la cronologia funziona su QUALSIASI pagina — quindi un gate isFilo() la spegnerebbe ovunque tranne le pagine interne: una regressione, non una difesa.
  // La barriera contro le pagine ostili resta l'isolamento di contesto (il main world non vede chrome.runtime). Le operazioni riservate — cronologia AI e costi — sono guardate: vedi sotto.
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

  // Simmetrica a PUSH e non guardata per origine come le altre operazioni sulla cronologia appunti: il raggio d'azione è una sola voce (l'utente ha copiato una password e vuole toglierla subito, senza cambiare pagina).
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

  // Svuota TUTTA la cronologia appunti, e non è guardato per origine: l'utente deve poter svuotare dallo stesso menu "Incolla" che la mostra, e quel menu gira su qualunque pagina (#256).
  // Il gate non offrirebbe più protezione reale: la lettura — l'operazione più sensibile — e la rimozione per-voce sono già consentite da origine web, quindi chi bucasse l'isolamento potrebbe già leggere tutto o svuotare in loop. Restano gated a filo:// i canali davvero riservati: cronologia AI e costi.
  on(MSG.CLEAR_CLIPBOARD_HISTORY, async () => {
    await Storage.setRaw(SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, []);
    return { ok: true };
  });

  // Cronologia interazioni AI e costi: usati SOLO dalle pagine interne — in produzione le voci AI le scrive il main mentre esegue la richiesta, non un content script. La cronologia AI può contenere testi selezionati o tradotti dall'utente e i costi sono un dato riservato: nessuna pagina web deve poterli leggere, scrivere o cancellare.
  on(MSG.GET_HISTORY, async (msg, sender, origin) => {
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
    return { ok: true, items: await History.list() };
  });

  on(MSG.APPEND_HISTORY, async (msg, sender, origin) => {
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
    const item = await History.append(msg.entry);
    return { ok: true, item };
  });

  // Stesso confine delle altre operazioni sulla cronologia AI. Ritorna la lista aggiornata per riallineare la vista.
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
