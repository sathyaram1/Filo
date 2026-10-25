// Persistenza schede "Salva per dopo".

(function (global) {
  'use strict';

  const { STORAGE_KEYS, SAVED_PAGES_LIMIT } = global.SN_CONST;
  // Nel file dei dati entra solo un'anteprima già piccola, da qualunque strada arrivi (#839).
  const { accettabile } = require('./miniature');
  const Copie = require('./copieIcone');

  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // L'icona di una voce è la copia che Filo tiene (#1273): un indirizzo di rete (le voci di prima) non arriva a nessuna
  // pagina, passa in `faviconDaChiedere`, che il riordino delle icone chiede una volta sola, senza cookie.
  function conIconaLocale(p) {
    const f = p && typeof p.favicon === 'string' ? p.favicon : '';
    if (!f || Copie.eLocale(f)) return p;
    const daChiedere = p.faviconDaChiedere || (/^https?:\/\//i.test(f) ? f : '');
    const { faviconDaChiedere, ...resto } = p;
    return { ...resto, favicon: '', ...(daChiedere ? { faviconDaChiedere: daChiedere } : {}) };
  }

  async function list() {
    const res = await chrome.storage.local.get(STORAGE_KEYS.SAVED_PAGES);
    return (res[STORAGE_KEYS.SAVED_PAGES] || []).map(conIconaLocale);
  }

  // `page.favicon`: il data: URL che la scheda ha già scaricato con la sua sessione; un indirizzo qui non si segue.
  // Senza copia la voce la chiede una volta al riordino delle icone (iconeVecchie.js), salvo se `proxy` dice che la scheda
  // passava da un proxy: da qui la richiesta uscirebbe dalla connessione vera.
  async function save(page, { proxy = null } = {}) {
    // Dalla pagina d'errore di Filo si mette da parte il sito che non si è caricato, non la pagina interna (#839).
    const sito = global.SN_NET_ERROR?.targetOf?.(page.url);
    if (sito) page = { ...page, url: sito, favicon: '' };
    const thumbnail = accettabile(page.thumbnail);
    const icona = await Copie.conserva(page.favicon);
    const dalProxy = proxy && proxy.country ? { country: String(proxy.country), tier: proxy.tier || null } : null;
    const pages = await list();

    // Ri-salvare una pagina già in elenco aggiorna la voce e la riporta in cima, senza
    // doppioni: id e categoria già assegnati restano.
    const idx = pages.findIndex((p) => p.url === page.url);
    if (idx >= 0) {
      const existing = pages[idx];
      existing.title = page.title || existing.title || page.url;
      const vecchia = existing.favicon;
      if (icona) { existing.favicon = icona; delete existing.faviconDaChiedere; delete existing.iconaMancante; }
      if (dalProxy) existing.proxy = dalProxy;
      if (thumbnail) existing.thumbnail = thumbnail;
      existing.savedAt = new Date().toISOString();
      pages.splice(idx, 1);
      pages.unshift(existing);
      await chrome.storage.local.set({ [STORAGE_KEYS.SAVED_PAGES]: pages });
      if (vecchia !== existing.favicon) Copie.togliSeOrfane(vecchia);
      if (!existing.favicon) riordinaIcone();
      return existing;
    }

    const entry = {
      id: uuid(),
      url: page.url,
      title: page.title || page.url,
      favicon: icona,
      ...(dalProxy ? { proxy: dalProxy } : {}),
      thumbnail,
      savedAt: new Date().toISOString(),
      category: page.category || null,
      categoryConfidence: page.categoryConfidence || null,
    };
    pages.unshift(entry);
    await scriviNelTetto(pages);
    if (!icona && !dalProxy) riordinaIcone();
    return entry;
  }

  const Vecchie = () => require('./iconeVecchie');
  function riordinaIcone() {
    try { Vecchie().pianifica(); } catch (_) {}
  }

  async function scriviNelTetto(pages) {
    const fuori = pages.length > SAVED_PAGES_LIMIT ? pages.splice(SAVED_PAGES_LIMIT) : [];
    await chrome.storage.local.set({ [STORAGE_KEYS.SAVED_PAGES]: pages });
    if (fuori.length) {
      dichiaraUscite(fuori);
      Copie.togliSeOrfane(fuori.map((p) => p.favicon));
    }
  }

  // L'elenco vive in storage.json, che si riscrive intero: il tetto resta, ma chi esce lo si dice (#1088).
  // In fondo stanno le più vecchie: save() mette in cima e l'importazione ordina per data.
  function dichiaraUscite(fuori) {
    const nome = (p) => `«${String((p && (p.title || p.url)) || '').slice(0, 80)}»`;
    const testo = fuori.length === 1
      ? `Le pagine salvate per dopo sono al massimo ${SAVED_PAGES_LIMIT}. ${nome(fuori[0])}, la più vecchia, è uscita dall’elenco.`
      : `Le pagine salvate per dopo sono al massimo ${SAVED_PAGES_LIMIT}. Le ${fuori.length} più vecchie sono uscite dall’elenco.`;
    try { require('./avvisoFinestra').avvisoNellaFinestra(testo, { chiave: 'pagine-salvate-tetto', tipo: 'pagine_salvate_tetto' }); } catch (_) {}
  }

  // Aggiorna SOLO la miniatura di una scheda già salvata (per id). Serve al
  // flusso "Salva per dopo": il salvataggio viene committato subito col testo,
  // la miniatura arriva dopo (cattura ~120ms) ed è opzionale. Se la scheda non
  // esiste più (rimossa nel frattempo) l'update è un no-op.
  async function setThumbnail(id, thumbnail) {
    thumbnail = accettabile(thumbnail);
    if (!id || !thumbnail) return null;
    const pages = await list();
    const entry = pages.find((p) => p.id === id);
    if (!entry) return null;
    entry.thumbnail = thumbnail;
    await chrome.storage.local.set({ [STORAGE_KEYS.SAVED_PAGES]: pages });
    return entry;
  }

  // Le voci appena tolte restano qui per l'«Annulla»: la pagina chiede solo l'id, e la voce (miniatura compresa)
  // torna da qui, non da quello che manda la pagina (#839).
  const rimosse = new Map();
  const RIMOSSE_TETTO = 200;

  async function remove(id) {
    const pages = await list();
    const indice = pages.findIndex((p) => p.id === id);
    if (indice < 0) return pages;
    rimosse.delete(id);
    const tolta = { entry: pages[indice], indice, icona: '' };
    rimosse.set(id, tolta);
    while (rimosse.size > RIMOSSE_TETTO) rimosse.delete(rimosse.keys().next().value);
    const filtered = pages.filter((p) => p.id !== id);
    await chrome.storage.local.set({ [STORAGE_KEYS.SAVED_PAGES]: filtered });
    // Il file dell'icona se ne va con la voce; per l'«Annulla» i suoi byte restano qui in memoria.
    if (Copie.eCopia(tolta.entry.favicon)) {
      tolta.icona = await Copie.comeDato(tolta.entry.favicon);
      Copie.togliSeOrfane(tolta.entry.favicon);
    }
    return filtered;
  }

  // Rimette una voce tolta dov'era, con la sua data e la sua categoria (se nel frattempo quella categoria è
  // stata eliminata, la voce torna fra le non categorizzate invece di finire in un gruppo che non si vede).
  async function rimetti(id, categorie) {
    const tolta = rimosse.get(id);
    const icona = tolta && tolta.icona ? await Copie.conserva(tolta.icona) : '';
    const pages = await list();
    if (!tolta) return { pages, entry: null };
    rimosse.delete(id);
    // Risalvata nel frattempo: resta quella più nuova, senza doppioni.
    if (pages.some((p) => p.id === id || p.url === tolta.entry.url)) return { pages, entry: null };
    const entry = { ...tolta.entry, ...(tolta.icona ? { favicon: icona } : {}) };
    if (entry.categoryId && Array.isArray(categorie)) {
      const cat = categorie.find((c) => c.id === entry.categoryId);
      entry.categoryId = cat ? cat.id : null;
      entry.category = cat ? cat.name : null;
    }
    // L'elenco va dal più recente: si rientra davanti alla prima più vecchia, così due «Annulla» di fila
    // rimettono anche l'ordine fra loro.
    let i = entry.savedAt ? pages.findIndex((p) => (p.savedAt || '') < entry.savedAt) : Math.min(tolta.indice, pages.length);
    if (i < 0) i = pages.length;
    pages.splice(i, 0, entry);
    await scriviNelTetto(pages);
    return { pages, entry };
  }

  // "Consuma": rimuove dalla lista. Usato quando l'utente apre una scheda.
  async function consume(id) {
    return remove(id);
  }

  // `esiti`: id → { prima, a } dal riordino delle icone (iconeVecchie.js); una voce cambiata nel frattempo resta com'è.
  async function aggiornaIcone(esiti) {
    const pages = await list();
    let cambiate = 0;
    for (const p of pages) {
      const e = esiti.get(p.id);
      if (!e || Vecchie().statoIcona(p) !== e.prima) continue;
      Object.assign(p, Vecchie().esitoIcona(p, e.a));
      if (!p.faviconDaChiedere) delete p.faviconDaChiedere;
      if (!p.iconaMancante) delete p.iconaMancante;
      cambiate++;
    }
    if (cambiate) await chrome.storage.local.set({ [STORAGE_KEYS.SAVED_PAGES]: pages });
    return cambiate;
  }

  Copie.usaCopie('pagine-salvate', async () => (await list()).map((p) => p.favicon));

  global.SN_SAVED_PAGES = {
    list, save, setThumbnail, remove, rimetti, consume, aggiornaIcone,
    rimpicciolisciMiniature: require('./miniature').rimpicciolisciSalvate,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
