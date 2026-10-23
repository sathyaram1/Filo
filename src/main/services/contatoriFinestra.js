// Le misure della finestra (#1470): schede e finestre aperte, chiusure, riordino, spostamenti, anteprime, notifiche,
// scaricamenti, ambiente e sessione ripristinata. Passa nomi da elenchi chiusi e numeri al servizio dei contatori, che
// tiene interruttore e incognito; non legge mai titoli, indirizzi o nomi di file. Forma: src/shared/contatoriFinestra.js.

function crea(dip = {}) {
  const contatori = dip.contatori;
  const F = dip.F || globalThis.SN_CONTATORI_FINESTRA;
  const adesso = dip.adesso || (() => Date.now());
  const electron = () => require('electron');
  const finestreNormali = dip.finestreNormali || (() => {
    try {
      return electron().BrowserWindow.getAllWindows().filter((w) => w && !w.isDestroyed() && w._filoTabs && !w._filoIncognito);
    } catch (_) { return []; }
  });
  // La finestra di cui si fotografa l'ambiente: quella davanti, se è normale; altrimenti la prima normale.
  const ambiente = dip.ambiente || (() => {
    const normali = finestreNormali();
    if (!normali.length) return null;
    const { BrowserWindow, screen, nativeTheme } = electron();
    const davanti = BrowserWindow.getFocusedWindow();
    const win = normali.includes(davanti) ? davanti : normali[0];
    const b = win.getBounds();
    let scala = 1;
    try { scala = screen.getDisplayMatching(b).scaleFactor; } catch (_) {}
    const stato = win.isFullScreen() ? 'schermo_intero' : win.isMaximized() ? 'massimizzata' : 'normale';
    return { larghezza: b.width, scala, stato, scuro: !!nativeTheme.shouldUseDarkColors };
  });

  function conteggi() {
    const normali = finestreNormali();
    const schede = normali.reduce((n, w) => n + (Array.isArray(w._filoTabs.tabs) ? w._filoTabs.tabs.length : 0), 0);
    return { schede, finestre: normali.length };
  }

  // A ogni scrittura nell'ora: il massimo di schede e finestre e l'ultimo ambiente visto.
  function fotografa(ora) {
    const c = conteggi();
    if (c.finestre) F.registraSchede(ora, c.schede, c.finestre);
    const a = ambiente();
    if (a) F.registraAmbiente(ora, a);
  }
  contatori.primaDiOgniScrittura(fotografa);

  // `incognito` vero salta; altrimenti decide il contesto della chiamata, come per ogni altro conto.
  const scrivi = (fn, incognito = false) => contatori.finestra((ora) => fn(ora), { incognito: incognito ? true : null });

  // `_broadcast` scatta di continuo: si scrive solo quando l'ora cambia o il massimo cresce.
  let visto = { ora: '', schede: 0, finestre: 0 };
  function schede({ incognito = false } = {}) {
    if (incognito) return;
    const C = globalThis.SN_CONTATORI;
    const ora = C ? C.oraDi(adesso()) : '';
    const c = conteggi();
    if (!c.finestre) return;
    if (visto.ora === ora && c.schede <= visto.schede && c.finestre <= visto.finestre) return;
    visto = { ora, schede: Math.max(c.schede, visto.ora === ora ? visto.schede : 0), finestre: Math.max(c.finestre, visto.ora === ora ? visto.finestre : 0) };
    scrivi(() => true);
  }

  // Le finestre cambiano stato senza che si conti niente: lo stato nuovo entra nell'ora con una scrittura vuota.
  let timerAmbiente = null;
  function ambienteCambiato({ incognito = false } = {}) {
    if (incognito || timerAmbiente) return;
    timerAmbiente = setTimeout(() => { timerAmbiente = null; scrivi(() => true); }, dip.attesaAmbienteMs ?? 2000);
    if (timerAmbiente && typeof timerAmbiente.unref === 'function') timerAmbiente.unref();
  }
  function seguiFinestra(win) {
    if (!win || typeof win.on !== 'function') return;
    for (const ev of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
      win.on(ev, () => { if (win._filoTabs && !win._filoIncognito) ambienteCambiato(); });
    }
  }
  if (dip.segui !== false) {
    try {
      const { app, nativeTheme } = electron();
      app.on('browser-window-created', (_e, win) => seguiFinestra(win));
      nativeTheme.on('updated', () => ambienteCambiato());
      app.on('before-quit', () => allUscita());
    } catch (_) {}
  }

  const etaDi = (tab) => {
    const t = Date.parse((tab && tab.openedAt) || '');
    return Number.isFinite(t) ? Math.max(0, adesso() - t) : null;
  };
  // Le schede ripristinate chiuse a mano nei primi minuti: il riordino non è una scelta di chi le ha riaperte.
  const DAL_RIORDINO = new Set(['riordino_automatico', 'chat']);
  function chiusa(tab, via, { incognito = false } = {}) {
    if (incognito || !tab) return;
    const r = tab._ripristino;
    if (r && !r.fatto && !DAL_RIORDINO.has(via) && adesso() - r.t0 <= F.PRESTO_MS) r.chiuse += 1;
    const eta = etaDi(tab);
    if (eta == null) return;
    scrivi((ora) => F.registraChiusura(ora, via, eta));
  }

  // `esito`: quello di runAutoTriage, più le schede archiviate divise fra duplicati e decisioni del modello.
  function giroRiordino(innesco, { duplicati = 0, modello = 0, giudizioMancato = false, giaInCorso = false } = {}, { incognito = false } = {}) {
    if (incognito) return;
    scrivi((ora) => F.registraGiroRiordino(ora, innesco, { duplicati, modello, giudizioMancato, giaInCorso }));
  }
  function riordinatoPerColore(manager) { if (manager && !manager.incognito) manager._riordinatoAlle = adesso(); }
  // Una voce dell'archivio chiusa dal riordino (il suo motivo non è «manual») e riaperta: il riordino ha sbagliato.
  function riapertaDallArchivio(voce) {
    if (!voce || !voce.reason || voce.reason === 'manual') return;
    const t = Date.parse(voce.closedAt || '');
    if (!Number.isFinite(t)) return;
    scrivi((ora) => F.registraRiaperta(ora, Math.max(0, adesso() - t)));
  }
  function trascinata(manager, distanza) {
    if (!manager || manager.incognito) return;
    const dopoRiordino = Number.isFinite(manager._riordinatoAlle) && adesso() - manager._riordinatoAlle <= F.SPOSTATA_MS;
    scrivi((ora) => {
      const ok = F.registraTrascinata(ora, distanza);
      if (ok && dopoRiordino) F.registraSpostata(ora);
      return ok;
    });
  }

  function voceMenu(id) {
    if (!F.VOCI_MENU_SCHEDA.includes(id)) return false;
    scrivi((ora) => F.registraVoceMenu(ora, id), null);
    return true;
  }
  function anteprima(stato, esito, sostaMs, { incognito = false } = {}) {
    if (incognito) return false;
    scrivi((ora) => F.registraAnteprima(ora, stato, esito, sostaMs));
    return true;
  }
  // Dalla cornice della finestra: tipo, esito e i due segni. In incognito il canale gira già nel suo contesto.
  function notifica(tipo, esito, segni = {}) {
    if (!F.esitoNotifica(esito)) return false;
    scrivi((ora) => F.registraNotifica(ora, tipo, esito, { letta: segni.letta === true, inAttesa: segni.inAttesa === true }), null);
    return true;
  }
  function download(luogo, azione, { incognito = null } = {}) {
    if (!F.LUOGHI_DOWNLOAD.includes(luogo) || !F.AZIONI_DOWNLOAD.includes(azione)) return false;
    scrivi((ora) => F.registraDownload(ora, luogo, azione), incognito);
    return true;
  }
  function rinominato() { scrivi((ora) => F.registraRinominato(ora)); }

  // Le schede tornate all'avvio: dopo PRESTO_MS (o all'uscita, se viene prima) quante ne sono state chiuse.
  const aperte = new Set();
  function chiudiSessione(r) {
    if (r.fatto) return;
    r.fatto = true;
    aperte.delete(r);
    if (r.timer) clearTimeout(r.timer);
    scrivi((ora) => F.registraSessione(ora, r.n, r.chiuse));
  }
  function sessione(manager, nate) {
    if (!manager || manager.incognito || !Array.isArray(nate) || !nate.length) return null;
    const r = { n: nate.length, chiuse: 0, t0: adesso(), fatto: false, timer: null };
    for (const tab of nate) if (tab) tab._ripristino = r;
    aperte.add(r);
    r.timer = setTimeout(() => chiudiSessione(r), F.PRESTO_MS);
    if (r.timer && typeof r.timer.unref === 'function') r.timer.unref();
    return r;
  }
  function allUscita() {
    if (!aperte.size) return;
    for (const r of [...aperte]) chiudiSessione(r);
    Promise.resolve().then(() => contatori.salva()).catch(() => {});
  }

  return {
    fotografa, schede, ambienteCambiato, seguiFinestra, chiusa, giroRiordino, riordinatoPerColore, riapertaDallArchivio,
    trascinata, voceMenu, anteprima, notifica, download, rinominato, sessione, allUscita,
  };
}

// Per gli agganci: una misura che non c'è o che si rompe non ferma mai chi la chiama.
function misura(nome, ...args) {
  try {
    const m = globalThis.SN_CONTATORI_FINESTRA_MAIN;
    return m && typeof m[nome] === 'function' ? m[nome](...args) : undefined;
  } catch (_) { return undefined; }
}

module.exports = { crea, misura };
