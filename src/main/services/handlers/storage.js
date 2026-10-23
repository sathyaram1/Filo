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
  const ARCHIVE_KEY = SN_CONST.STORAGE_KEYS.ARCHIVED_TABS;
  // La cronologia AI ha file suoi (services/historyStore.js): nel backup torna sotto la chiave di sempre.
  const HISTORY_KEY = SN_CONST.STORAGE_KEYS.HISTORY;
  // Verso un'origine web passa solo ciò che è nelle liste di impostazioniPerOrigine
  // (campi letti e scritti, scomparti del magazzino): le stesse delle spinte.
  const {
    isFilo, impostazioniPerOrigine, storagePerOrigine, indirizziDelMittente,
    chiaviStoragePerOrigine, scritturaStorageAmmessa, scritturaImpostazioniAmmessa,
  } = require('../impostazioniPerOrigine');
  const vietato = { ok: false, code: 'forbidden', error: 'forbidden' };
  const { soloFilo } = require('./origine');
  const AppuntiDaiSiti = require('../appuntiDaiSiti');

  // ── canali interni per lo shim chrome.* nel renderer ──────────────────
  // L'origine vera del riquadro che chiede (anche un about:blank ha quella di chi l'ha aperto): la bozza per sito.
  const origineRiquadro = (sender) => { try { return String(sender?.frame?.origin || ''); } catch (_) { return ''; } };

  on('_storage:get', async (msg, sender, origin) => {
    const chiavi = chiaviStoragePerOrigine(msg.keys ?? null, origin, origineRiquadro(sender));
    const value = await globalThis.chrome.storage.local.get(chiavi);
    return { ok: true, value: storagePerOrigine(value, origin, SETTINGS_KEY, indirizziDelMittente(sender)) };
  });

  on('_storage:set', async (msg, sender, origin) => {
    const obj = msg.obj || {};
    if (!scritturaStorageAmmessa(Object.keys(obj), origin, origineRiquadro(sender))) return vietato;
    await globalThis.chrome.storage.local.set(obj);
    return { ok: true };
  });

  on('_storage:remove', async (msg, sender, origin) => {
    if (!scritturaStorageAmmessa(msg.keys, origin, origineRiquadro(sender))) return vietato;
    await globalThis.chrome.storage.local.remove(msg.keys);
    return { ok: true };
  });

  // Quello che il correttore impara e il dizionario personale (#1447): una fila sola nel main, perché le schede e la
  // pagina del correttore riscrivono le stesse chiavi. Dai siti si impara scrivendo; cambiare e togliere solo da filo://.
  on(MSG.CORRETTORE_IMPARA, async (msg, sender, origin) => require('../correttoreImpara').passo(msg, { daFilo: isFilo(origin), origine: origin }));

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
    // In incognito il testo della pagina non parte da solo verso i modelli (#591): la pagina lo deve sapere per non
    // preparare la spiegazione della selezione.
    const win = winOf(sender);
    const incognito = !!(win && (win._filoIncognito || (win._filoTabs && win._filoTabs.incognito)));
    return { ok: true, pageUrl, incognito, settings: impostazioniPerOrigine(settings, origin, indirizziDelMittente(sender)) };
  });

  on(MSG.UPDATE_SETTINGS, async (msg, sender, origin) => {
    // Da un sito passa solo la voce della dettatura scelta dal menu; qualunque
    // altro campo (chiavi, proxy, protezioni, spesa, stile) rifiuta la richiesta.
    let incoming = msg.settings;
    if (!scritturaImpostazioniAmmessa(incoming, origin)) return vietato;
    // Le Preferenze mandano solo i token toccati: si posano sulla mappa salvata adesso, senza che la pagina la rilegga
    // prima di spedire (#1343.1).
    if (msg.tokenModifica === true && incoming && incoming.themeTokens && typeof incoming.themeTokens === 'object') {
      const salvati = (await Storage.getSettings()).themeTokens;
      incoming = { ...incoming, themeTokens: globalThis.SN_THEME_TOKENS.conModifica(salvati, incoming.themeTokens) };
    }
    // Tutta la propagazione (broadcast, tema nativo, sicurezza, fingerprint,
    // safebrowse, cookie) vive in applySettingsUpdate: stesso percorso usato
    // quando Filo cambia una preferenza via chat.
    const merged = await applySettingsUpdate(incoming, { mentreScrive: msg.mentreScrive === true });
    return { ok: true, settings: impostazioniPerOrigine(merged, origin, indirizziDelMittente(sender)) };
  });

  // Le Preferenze registrano una scorciatoia (#842): finché dura, i tasti che Filo prende prima della pagina arrivano
  // a lei. Da un sito no (gli toglierebbe le scorciatoie di Filo), e solo dal frame principale della scheda che chiede.
  on(MSG.REGISTRA_TASTI, soloFilo(async (msg, sender) => {
    const wc = sender && sender.wc;
    if (!wc || (sender.frame && wc.mainFrame && sender.frame !== wc.mainFrame)) return { ok: false, error: 'forbidden' };
    require('../../shortcuts').registraTasti(wc, msg.attivo === true);
    return { ok: true };
  }));

  on(MSG.RESET_SETTINGS, async (msg, sender, origin) => {
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
    // Ripristino completo: sostituisce l'INTERO oggetto settings, non un merge, così spariscono
    // anche le chiavi residue. Si preservano solo le credenziali dei provider AI.
    const current = await Storage.getSettings();
    const defaults = JSON.parse(JSON.stringify(SN_CONST.DEFAULT_SETTINGS));
    if (current && current.apiKeys) defaults.apiKeys = current.apiKeys;
    if (current && current.modelRegistry) defaults.modelRegistry = current.modelRegistry;
    // Tornare al predefinito non alza l'autonomia di Filo: alzarla vuole «conferma» (#530).
    const A = globalThis.SN_AUTONOMIA;
    if (A && current) defaults.autonomia = A.unisciPiuStretta(current.autonomia, defaults.autonomia);
    await Storage.setSettings(defaults);
    const merged = await applySettingsUpdate({});
    return { ok: true, settings: merged };
  });

  on(MSG.EXPORT_DATA, async (msg, sender, origin) => {
    // Esporta i dati di Filo in un unico .zip (data.json + immagini copiate estratte come file); le chiavi solo con
    // `chiavi: true` (#905). Solo dalle pagine interne: una pagina web non deve poter innescare un dump dei dati utente
    // né aprire un file dialog.
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
    try {
      const { dialog } = require('electron');
      const fsp = require('node:fs/promises');
      const DiskStorage = require('../../shim/storage');
      const { buildExportZip } = require('../exportData');

      const allData = await DiskStorage.get(null);
      // Le copie delle icone stanno in file loro (#1273): nel backup tornano immagini, e l'importazione ne rifà la copia.
      const Copie = require('../copieIcone');
      const conIcone = (voci) => Promise.all(voci.map(async (v) => (
        v && Copie.eCopia(v.favicon) ? { ...v, favicon: await Copie.comeDato(v.favicon) } : v)));
      const SALVATE = SN_CONST.STORAGE_KEYS.SAVED_PAGES;
      if (Array.isArray(allData[SALVATE])) allData[SALVATE] = await conIcone(allData[SALVATE]);
      // L'archivio delle schede ha file suoi: nel backup torna sotto la chiave di sempre.
      const archivio = await conIcone(await globalThis.SN_ARCHIVED_TABS.list());
      if (archivio.length) allData[ARCHIVE_KEY] = archivio;
      const cronologia = await History.list();
      if (cronologia.length) allData[HISTORY_KEY] = cronologia;
      const Mie = globalThis.SN_SEGNALAZIONI_MIE;
      const mie = Mie ? await Mie.elenco() : null;
      if (mie && mie.length) allData[Mie.CHIAVE_BACKUP] = mie;
      const filo = await require('../ilFilo').esporta();
      const zip = buildExportZip(allData, { filo, chiavi: !!msg && msg.chiavi === true });

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
  // Le chat e le pagine visitate non stanno in data.json ma nel filo (#866); un export di prima porta le chat qui.
  const FILO_CHATS_KEY = SN_CONST.STORAGE_KEYS.FILO_CHATS;
  const DOWNLOADS_KEY = SN_CONST.STORAGE_KEYS.DOWNLOADS;

  // Quello che c'è adesso, comprese le liste che vivono in file propri: l'anteprima e la scrittura fondono sullo stesso.
  async function datiCorrenti() {
    const DiskStorage = require('../../shim/storage');
    const current = await DiskStorage.get(null);
    const archivio = await globalThis.SN_ARCHIVED_TABS.list();
    if (archivio.length) current[ARCHIVE_KEY] = archivio;
    const cronologia = await History.list();
    if (cronologia.length) current[HISTORY_KEY] = cronologia;
    const Mie = globalThis.SN_SEGNALAZIONI_MIE;
    const mie = Mie ? await Mie.elenco() : null;
    if (mie && mie.length) current[Mie.CHIAVE_BACKUP] = mie;
    return current;
  }
  function opzioniFusione() {
    return {
      tettoPagine: SN_CONST.SAVED_PAGES_LIMIT,
      tettoAppunti: SN_CONST.CLIPBOARD_HISTORY_MAX,
      tettoDownload: require('../downloads').HISTORY_LIMIT,
      prossimaSveglia: globalThis.SN_FILO_MEMORY?.nextAlarmOccurrence,
    };
  }
  function datiDaFondere(data) {
    const dati = { ...data };
    delete dati[FILO_CHATS_KEY];
    return dati;
  }
  function contaFilo(parsed) {
    const E = globalThis.SN_FILO_EVENTI;
    const stato = E.nuovoStato();
    if (parsed.filo) for (const ev of E.analizza(parsed.filo.toString('utf8')).eventi) E.applica(stato, ev);
    const vecchie = Array.isArray(parsed.data[FILO_CHATS_KEY]) ? parsed.data[FILO_CHATS_KEY].filter((c) => c && c.id && !stato.chat.has(c.id)) : [];
    return { chats: stato.chat.size + vecchie.length, pagine: stato.pagine.size };
  }

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
      PENDING_IMPORT = { token, data: parsed.data, filo: parsed.filo, at: Date.now() };
      const filo = contaFilo(parsed);
      const { mergeImportedData, regolaImport, haSegreti, proxyDaCompletare } = require('../exportData');
      const dati = datiDaFondere(parsed.data);
      const { merged, stats } = mergeImportedData(await datiCorrenti(), dati, opzioniFusione());
      return {
        ok: true,
        token,
        fileName: path.basename(filePath),
        exportedAt: parsed.exportedAt || '',
        sections: Object.keys(dati).filter((k) => regolaImport(k) !== 'stato').length,
        images: parsed.imageCount,
        immaginiPerse: parsed.immaginiPerse,
        filoPerso: parsed.filoPerso,
        vociPerse: parsed.vociPerse,
        pagineFuori: stats.pagineFuori,
        pagineMieFuori: stats.pagineMieFuori,
        tettoPagine: SN_CONST.SAVED_PAGES_LIMIT,
        appuntiFuori: stats.appuntiFuori,
        appuntiMieFuori: stats.appuntiMieFuori,
        tettoAppunti: SN_CONST.CLIPBOARD_HISTORY_MAX,
        downloadFuori: stats.downloadFuori,
        downloadMieFuori: stats.downloadMieFuori,
        tettoDownload: opzioniFusione().tettoDownload,
        tettoSpesa: stats.tettoSpesa,
        tettoSceso: stats.tettoSceso,
        chats: filo.chats,
        pagine: filo.pagine,
        chiavi: haSegreti(parsed.data),
        proxySenzaCredenziali: proxyDaCompletare(merged, parsed.proxySenzaCredenziali).length > 0,
      };
    } catch (e) {
      // «Non è un archivio di Filo» si distingue dall'errore generico: la pagina lo dice con
      // parole umane.
      const code = String(e?.message || e);
      if (code === 'zip_damaged') return { ok: false, error: 'damaged_file' };
      if (code === 'zip_method') return { ok: false, error: 'compressed_file' };
      if (code === 'zip_encrypted') return { ok: false, error: 'encrypted_file' };
      const invalid = ['not_a_zip', 'no_data_json', 'bad_data_json', 'zip64_unsupported'].includes(code);
      if (!invalid) console.error('[Filo import] lettura fallita:', e);
      return { ok: false, error: invalid ? 'invalid_file' : code };
    }
  });

  // L'importazione scrive sotto chi tiene una lista in memoria e sotto le pagine aperte (#1256): le liste del main la
  // rileggono, se no il loro prossimo salvataggio cancella il backup, e le pagine la ridisegnano, come le impostazioni.
  async function rileggiInMemoria(scritte) {
    const K = SN_CONST.STORAGE_KEYS;
    const attese = [];
    if (scritte.has(K.SITI_CON_CAMPI)) attese.push(globalThis.SN_DELICATE?.rileggi?.());
    if (scritte.has('sitePermissions')) attese.push(require('../permessiPagine').carica());
    if (scritte.has(K.FILO_PROXY_RULES)) {
      for (const win of require('electron').BrowserWindow.getAllWindows()) {
        if (win._filoTabs && typeof win._filoTabs.loadProxyRules === 'function') attese.push(win._filoTabs.loadProxyRules());
      }
    }
    await Promise.allSettled(attese);
  }
  async function annunciaAllePagine(scritte, sender) {
    const K = SN_CONST.STORAGE_KEYS;
    const annunci = [
      () => ctx.broadcastToTabs({ type: MSG.FILO_CHATS_UPDATED }),
      () => ctx.broadcastLiveUpdate(),
      () => scritte.has(K.CLIPBOARD_HISTORY) && clipboardChanged(),
      () => scritte.has('sitePermissions') && ctx.broadcastToFiloPages({ type: MSG.PERMESSI_SITI_CAMBIATI }),
      () => scritte.has(K.FILO_CARTE_HOME) && require('../carteHome').leggi().then((l) => ctx.annunciaCarteHome(l, sender)),
      () => scritte.has(K.ICON_LAYOUT) && require('../layoutIcone').leggi().then((l) => l && require('../layoutIcone').annuncia(l)),
      () => [K.FILO_MEMORY, K.FILO_MEMORY_FONTI, K.FILO_LESSONS_BUFFER].some((k) => scritte.has(k))
        && globalThis.SN_FILO_MEMORY.viewForUser().then((v) => ctx.broadcastToFiloPages({ type: MSG.FILO_MEMORY_CHANGED, ...v })),
      () => ctx.broadcastToFiloPages({ type: MSG.DATI_IMPORTATI }),
    ];
    for (const annuncia of annunci) {
      try { await annuncia(); } catch (e) { console.warn('[Filo import] riallineamento:', e?.message || e); }
    }
  }

  // Il contenuto in attesa di conferma scade: se l'utente apre l'anteprima e
  // poi se ne dimentica, un dump completo dei suoi dati (chiavi API comprese)
  // non deve restare in memoria per tutta la sessione.
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

      const IlFilo = require('../ilFilo');
      const dati = datiDaFondere(pending.data);
      const chatVecchie = pending.data[FILO_CHATS_KEY];
      if (pending.filo) await IlFilo.importa(pending.filo);
      if (Array.isArray(chatVecchie) && chatVecchie.length) await IlFilo.importaChatSalvate(chatVecchie);

      const current = await datiCorrenti();
      const ArchivedTabs = globalThis.SN_ARCHIVED_TABS;
      const Mie = globalThis.SN_SEGNALAZIONI_MIE;
      const MIE_KEY = Mie ? Mie.CHIAVE_BACKUP : null;
      const { merged, stats } = mergeImportedData(current, dati, opzioniFusione());

      // Le impostazioni passano da applySettingsUpdate, così il backup è attivo subito senza
      // riavviare. Si riscrivono solo le chiavi che cambiano: gli altri listener non si svegliano.
      const settings = merged[SETTINGS_KEY];
      // Un backup non alza l'autonomia di Filo: alzarla vuole «conferma» (#530).
      const A = globalThis.SN_AUTONOMIA;
      if (A && settings && typeof settings === 'object') {
        settings.autonomia = A.unisciPiuStretta((current[SETTINGS_KEY] || {}).autonomia, ((pending.data || {})[SETTINGS_KEY] || {}).autonomia);
      }
      // Il tetto di spesa del backup, più largo di quello di qui, entra solo col bottone che lo offre (#1050).
      if (msg.tettoDelBackup === true && stats.tettoSpesa && settings && typeof settings === 'object') {
        settings.monthlyLimitEur = stats.tettoSpesa.backup;
      }
      const rest = {};
      for (const k of Object.keys(merged)) {
        if (k === SETTINGS_KEY || k === ARCHIVE_KEY || k === HISTORY_KEY || k === MIE_KEY || k === DOWNLOADS_KEY) continue;
        if (JSON.stringify(merged[k]) !== JSON.stringify(current[k])) rest[k] = merged[k];
      }
      // I cambi che l'importazione porta entrano nel filo come suoi, e si annullano come gli altri (#867).
      await require('../registroCambi').con({ via: 'importazione' }, async () => {
        if (Object.keys(rest).length) await DiskStorage.set(rest);
        await rileggiInMemoria(new Set(Object.keys(rest)));
        await ArchivedTabs.importa(merged[ARCHIVE_KEY]);
        // Le schede chiuse di un backup entrano anche nel filo, alla loro data (#872): la Cronologia non c'è più.
        try { await globalThis.SN_SCHEDE_NEL_FILO?.({ unaVolta: false }); } catch (e) { console.warn('[Filo] schede del backup nel filo:', e?.message || e); }
        await History.importa(merged[HISTORY_KEY]);
        // L'elenco dei download vive nella memoria del suo modulo, che lo salva da lì: entra da lui (#1256).
        if (JSON.stringify(merged[DOWNLOADS_KEY]) !== JSON.stringify(current[DOWNLOADS_KEY])) require('../downloads').importa(merged[DOWNLOADS_KEY]);
        if (Mie) await Mie.importa(merged[MIE_KEY]);
        if (settings && typeof settings === 'object') await applySettingsUpdate(settings);
      });
      // Un backup di una versione vecchia porta le miniature a piena risoluzione (#839).
      globalThis.SN_SAVED_PAGES?.rimpicciolisciMiniature?.().catch(() => {});
      await annunciaAllePagine(new Set(Object.keys(rest)), sender);
      // Le icone del backup arrivano come immagini: diventano copie, e quelle di un backup di prima si chiedono una volta (#1273).
      try { require('../iconeVecchie').pianifica(1000); } catch (_) {}

      return { ok: true, added: stats.added, updated: stats.updated, unchanged: stats.unchanged };
    } catch (e) {
      console.error('[Filo import] scrittura fallita:', e);
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── Cancella tutti i dati di Filo (#850) ────────────────────────────────
  // Solo dalla pagina Sicurezza, dove l'utente ha scritto la parola: la chat ci porta, non cancella (cancellaTutto.js).
  const dallaSicurezza = (origin) => /^filo:\/\/security\//.test(String(origin || ''));
  on(MSG.CANCELLA_TUTTI_I_DATI, soloFilo(async (msg, sender, origin) => {
    if (!dallaSicurezza(origin)) return vietato;
    return require('../../cancellaTutto').chiedi({ parola: msg && msg.parola, ancheIdentita: !!msg && msg.ancheIdentita === true });
  }));
  on(MSG.CANCELLA_TUTTI_I_DATI_STATO, soloFilo(async () => ({ ok: true, ...require('../../cancellaTutto').stato() })));

  // ── Cronologia appunti ────────────────────────────────────────────────
  // Il menu «Incolla» vive dentro le pagine di qualunque sito: chi legge e chi scrive lo decide services/appuntiDaiSiti.js
  // (#589.4). Descrivere resta aperto: la descrizione arriva da un modello quando vuole, e serve l'immagine esatta.
  on(MSG.GET_CLIPBOARD_HISTORY, async (msg, sender, origin) => {
    if (!(await AppuntiDaiSiti.elencoLeggibile(sender, origin))) return vietato;
    const list = await Storage.getRaw(SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, []);
    return { ok: true, items: Array.isArray(list) ? list : [] };
  });

  // La cronologia appunti cambia da dovunque: una copia in una scheda qualsiasi,
  // il "×" del menu "Incolla", lo svuotamento dalla pagina della sicurezza. Chi
  // la sta GUARDANDO in quel momento sta guardando un'altra scheda, e senza
  // questo avviso resterebbe fermo a com'era quando l'ha aperta: su una pagina
  // che si apre per controllare cosa Filo tiene da parte, mostrare meno del vero
  // fa concludere che una password non c'è mentre c'è (#256).
  // L'avviso NON porta con sé le voci — chi lo riceve rilegge la cronologia — e
  // va alle sole pagine filo://: ciò che l'utente ha copiato non deve arrivare
  // da solo a una scheda aperta su un sito qualunque.
  const clipboardChanged = () => {
    try { ctx.broadcastToFiloPages?.({ type: MSG.CLIPBOARD_HISTORY_UPDATED }); } catch (_) {}
  };

  // Tolta o svuotata mentre è ancora negli appunti di sistema, una voce non rientra dal primo «Incolla» (#256.2).
  const Tolti = () => require('../appuntiTolti').perFilo();

  on(MSG.PUSH_CLIPBOARD_ENTRY, async (msg, sender, origin) => {
    if (!AppuntiDaiSiti.scritturaAmmessa(sender, origin, msg.entry)) return vietato;
    return inCronologia(msg.entry, msg.via);
  });

  on(MSG.COPY_TEXT_TO_CLIPBOARD, async (msg, sender, origin) => {
    const text = typeof msg.text === 'string' ? msg.text : '';
    if (!text) return { ok: false, error: 'empty' };
    const entry = { type: 'text', text };
    if (!AppuntiDaiSiti.scritturaAmmessa(sender, origin, entry)) return vietato;
    try { require('electron').clipboard.writeText(text); } catch (_) { return { ok: false, error: 'clipboard' }; }
    await inCronologia(entry);
    return { ok: true };
  });

  async function inCronologia(e, via) {
    if (!e) return { ok: true };
    // `tenuta: false` dice alla pagina di non far descrivere a un modello un'immagine che la cronologia non tiene.
    if (!(await Tolti().daTenere(e, via))) return { ok: true, tenuta: false };
    const cap = SN_CONST.CLIPBOARD_HISTORY_MAX;
    const list = await Storage.getRaw(SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, []);
    const arr = Array.isArray(list) ? list : [];
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
    clipboardChanged();
    return { ok: true };
  }

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
    if (updated) {
      await Storage.setRaw(SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, arr);
      clipboardChanged();
    }
    return { ok: true };
  });

  // Una voce sola: l'utente ha copiato una password e la toglie dal menu Incolla, sulla pagina dov'è (#256).
  on(MSG.REMOVE_CLIPBOARD_ENTRY, async (msg, sender, origin) => {
    if (!AppuntiDaiSiti.scritturaAmmessa(sender, origin)) return vietato;
    const list = await Storage.getRaw(SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, []);
    const arr = Array.isArray(list) ? list : [];
    const e = msg.entry;
    if (!e) return { ok: true };
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const keyOf = (x) => {
      if (!x) return '';
      if (x.type === 'text') return 't:' + norm(x.text);
      if (x.type === 'image') return 'i:' + (x.dataUrl || '');
      return '';
    };
    const target = keyOf(e);
    if (target) await Tolti().voceTolta(e);
    const next = arr.filter((x) => keyOf(x) !== target);
    if (next.length !== arr.length) {
      await Storage.setRaw(SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, next);
      clipboardChanged();
    }
    return { ok: true };
  });

  // Svuotare sta nello stesso menu Incolla che mostra la cronologia, su qualunque pagina (#256).
  on(MSG.CLEAR_CLIPBOARD_HISTORY, async (msg, sender, origin) => {
    if (!AppuntiDaiSiti.scritturaAmmessa(sender, origin)) return vietato;
    const prima = await Storage.getRaw(SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, []);
    await Tolti().cronologiaSvuotata(prima);
    await Storage.setRaw(SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, []);
    clipboardChanged();
    return { ok: true };
  });

  // Cronologia AI e costi solo dalle pagine interne: contengono testi dell'utente e un dato
  // riservato, che nessuna pagina web deve leggere, scrivere o cancellare.
  on(MSG.GET_HISTORY, async (msg, sender, origin) => {
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
    return { ok: true, items: (await History.list()).map(History.vistaPagina) };
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
    return { ok: true, items: items.map(History.vistaPagina) };
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
