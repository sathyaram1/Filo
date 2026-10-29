// Archivio delle schede chiuse (§3.1): metadati, riassunto e vettore di ogni scheda, in file propri (userData/archivio-schede).
// Nessun tetto e nessuna scadenza: una scheda esce solo quando l'utente la cancella, e allora sparisce dal disco.
// Regole: patterns/un-archivio-che-cresce-sta-in-file-suoi-a-sole-aggiunte.md; prove: tests/archive-store-unlimited.spec.mjs.

(function (global) {
  'use strict';

  const path = require('node:path');
  const { creaDeposito } = require('./depositoAggiunte');
  const { MISURA, taglia } = require('./misurePagine');
  const Disco = require('../shim/storage');
  const Copie = require('./copieIcone');

  // La chiave dove l'archivio stava in storage.json: serve solo a migrarlo.
  const CHIAVE_VECCHIA = global.SN_CONST.STORAGE_KEYS.ARCHIVED_TABS;

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function cartella() {
    const root = process.env.FILO_USER_DATA || require('electron').app.getPath('userData');
    return path.join(root, 'archivio-schede');
  }

  function meseDi(t) {
    const d = new Date(t && t.closedAt);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 7);
  }

  let apertura = null;

  // Ogni scheda che entra in archivio (chiusura, migrazione, importazione) passa di qui: chi indicizza lo sa
  // da una strada sola, così una strada d'ingresso nuova non resta senza indice (#825).
  const ascoltatori = new Set();
  function entrate(voci) {
    if (voci.length) for (const fn of ascoltatori) { try { fn(voci); } catch (_) {} }
    return voci;
  }
  function suEntrate(fn) {
    ascoltatori.add(fn);
    return () => ascoltatori.delete(fn);
  }
  // E ogni scheda che ne esce (cancellata, dimenticata, archivio svuotato): `null` = tutte. Chi tiene una copia
  // delle schede chiuse (la pila di Ctrl+Shift+T) la dimentica con loro.
  const uscite = new Set();
  function uscita(ids) {
    for (const fn of uscite) { try { fn(ids); } catch (_) {} }
  }
  function suUscite(fn) {
    uscite.add(fn);
    return () => uscite.delete(fn);
  }

  // L'incognito non vede l'archivio e non ci scrive (la stessa garanzia che storage.json dà alle sue chiavi di navigazione).
  // Per questo si apre solo da fuori: la migrazione deve leggere storage.json vero, non la vista vuota dell'incognito.
  function apri() {
    if (!apertura) {
      apertura = (async () => {
        const d = creaDeposito({ cartella: cartella(), meseDi });
        await d.carica();
        await migra(d);
        await iconeLocali(d);
        return d;
      })();
      apertura.catch(() => { apertura = null; });
    }
    return apertura;
  }

  // Si toglie la chiave vecchia solo dopo che le schede sono su disco nei file nuovi:
  // un arresto a metà rifà la migrazione, e gli id già presenti non si duplicano.
  async function migra(d) {
    const res = await chrome.storage.local.get(CHIAVE_VECCHIA);
    const vecchio = res && res[CHIAVE_VECCHIA];
    if (vecchio === undefined) return;
    if (Array.isArray(vecchio) && vecchio.length) {
      const visti = new Set();
      const voci = [];
      for (const t of vecchio) {
        if (!t || typeof t !== 'object' || Array.isArray(t)) continue;
        const id = typeof t.id === 'string' && t.id && !visti.has(t.id) ? t.id : uuid();
        visti.add(id);
        voci.push(id === t.id ? t : { ...t, id });
      }
      entrate(d.aggiungiMolti(voci, { inCoda: true }));
    }
    await chrome.storage.local.remove(CHIAVE_VECCHIA);
  }

  // L'icona di una scheda archiviata è la copia che Filo tiene (#1273): l'indirizzo delle voci di prima passa in
  // `faviconDaChiedere` (iconeVecchie.js), tranne per una scheda passata dal proxy; un data: URL diventa una copia.
  async function iconaLocale(t) {
    const f = typeof t.favicon === 'string' ? t.favicon : '';
    if (!f || Copie.eCopia(f)) return t;
    if (/^data:/i.test(f)) return { ...t, favicon: await Copie.conserva(f) };
    const daChiedere = !t.proxy && /^https?:\/\//i.test(f) ? f : '';
    const { faviconDaChiedere, ...resto } = t;
    return { ...resto, favicon: '', ...(daChiedere ? { faviconDaChiedere: daChiedere } : {}) };
  }

  async function iconeLocali(d) {
    const nuove = new Map();
    for (const t of d.tutti()) {
      const n = await iconaLocale(t);
      if (n !== t) nuove.set(t.id, n);
    }
    if (nuove.size) d.riscrivi((t) => nuove.get(t.id) || t);
  }

  async function list() {
    if (Disco.inIncognito()) return [];
    return (await apri()).tutti();
  }

  // La voce più recente di una pagina chiusa con questo indirizzo intero, o null: chi la riapre per indirizzo (la home,
  // la chat) la riapre com'era e la conta fra le riaperte (#1467).
  async function ultimaPer(url) {
    if (typeof url !== 'string' || !url) return null;
    let ultima = null;
    for (const t of await list()) {
      if (!t || t.url !== url || t.urlTagliato) continue;
      if (!ultima || (Date.parse(t.closedAt) || 0) > (Date.parse(ultima.closedAt) || 0)) ultima = t;
    }
    return ultima;
  }

  // Archivia una tab chiusa. `meta` contiene i campi catturati al momento della
  // chiusura (vedi tabs.js _archiveClosedTab). Ritorna l'entry creata, o null se
  // la tab non è archiviabile (manca l'URL, o la chiamata arriva dall'incognito).
  // Indirizzi e titolo li sceglie il sito: oltre la misura si tagliano e la voce lo segna (un indirizzo a metà non si riapre).
  async function archive(meta) {
    if (!meta || typeof meta.url !== 'string' || !meta.url || Disco.inIncognito()) return null;
    const u = taglia(meta.url, MISURA.url);
    const t = taglia(meta.title || meta.url, MISURA.titolo);
    const insieme = (Array.isArray(meta.coOpenUrls) ? meta.coOpenUrls.slice(0, 30) : []).map((x) => taglia(x, MISURA.url));
    const insiemeTagliati = insieme.map((x, i) => (x.tagliato ? i : -1)).filter((i) => i >= 0);
    const prova = { url: u.testo, openedAt: meta.openedAt || null, closedAt: meta.closedAt || new Date().toISOString() };
    if (dimenticate.some((r) => coperta(prova, r))) return null;
    const d = await apri();
    // `meta.favicon`: il data: URL che la scheda ha scaricato con la sua sessione (col proxy, se ce l'aveva).
    const favicon = await Copie.conserva(meta.favicon);
    const entry = {
      id: uuid(),
      url: u.testo,
      title: t.testo,
      ...(u.tagliato ? { urlTagliato: true } : {}),
      ...(t.tagliato ? { titleTagliato: true } : {}),
      favicon,
      // Colore identità del sito (§1.2): serve all'ordine cromatico in archivio.
      identityColor: meta.identityColor || null,
      openedAt: meta.openedAt || null,
      closedAt: meta.closedAt || new Date().toISOString(),
      // 'manual' per la chiusura dell'utente, altri valori dall'auto-archiviazione (§2.1).
      reason: meta.reason || 'manual',
      // Chiusa dalla pagina stessa o da un crash: né la persona né la pulizia (i contatori delle riaperte, #1467).
      ...(meta.chiusaDaSola === true ? { chiusaDaSola: true } : {}),
      // URL delle altre tab aperte nello stesso momento (contesto di lavoro).
      coOpenUrls: insieme.map((x) => x.testo),
      ...(insiemeTagliati.length ? { coOpenUrlsTagliati: insiemeTagliati } : {}),
      scrollPosition: typeof meta.scrollPosition === 'number' ? meta.scrollPosition : null,
      // Proxy alla chiusura: riaprendo dalla cronologia la tab rinasce sulla stessa location.
      proxy: meta.proxy && meta.proxy.country
        ? { country: String(meta.proxy.country), tier: meta.proxy.tier || null }
        : null,
    };
    const r = d.aggiungi(entry);
    if (r) entrate([r]);
    // Senza copia (chiusa prima che l'icona arrivasse) la si chiede una volta, se la scheda non passava da un proxy.
    if (r && !r.favicon && !r.proxy) riordinaIcone();
    return r;
  }

  const Vecchie = () => require('./iconeVecchie');
  function riordinaIcone() {
    try { Vecchie().pianifica(); } catch (_) {}
  }

  // Come list() ma SENZA gli embedding: è ciò che mandiamo al renderer, per non
  // spedire MB di vettori via IPC ad ogni apertura della pagina.
  async function listMeta() {
    return (await list()).map(({ embedding, ...rest }) => rest);
  }

  // Aggiorna un'entry (riassunto, snippet, vettore dopo l'arricchimento). Il vettore resta finché resta la scheda.
  async function update(id, patch) {
    if (!id || !patch || Disco.inIncognito()) return null;
    return (await apri()).aggiorna(id, patch);
  }

  // Un indirizzo cancellato non deve restare nemmeno fra le «schede aperte insieme» delle altre,
  // a meno che un'altra scheda archiviata abbia quello stesso indirizzo.
  function togli(d, ids) {
    const via = new Set(ids);
    const urlVia = new Set();
    const icone = [];
    for (const id of via) { const t = d.prendi(id); if (t && t.url) urlVia.add(t.url); if (t) icone.push(t.favicon); }
    for (const t of d.tutti()) if (!via.has(t.id) && urlVia.has(t.url)) urlVia.delete(t.url);
    uscita([...via]);
    const tolte = d.togli([...via], (t) => {
      if (!urlVia.size || !Array.isArray(t.coOpenUrls) || !t.coOpenUrls.some((u) => urlVia.has(u))) return t;
      const tagliati = new Set(Array.isArray(t.coOpenUrlsTagliati) ? t.coOpenUrlsTagliati : []);
      const resta = t.coOpenUrls.map((u, i) => ({ u, tagliato: tagliati.has(i) })).filter((x) => !urlVia.has(x.u));
      const { coOpenUrlsTagliati: _prima, ...senza } = t;
      const segni = resta.map((x, i) => (x.tagliato ? i : -1)).filter((i) => i >= 0);
      return { ...senza, coOpenUrls: resta.map((x) => x.u), ...(segni.length ? { coOpenUrlsTagliati: segni } : {}) };
    });
    // L'icona se ne va con la scheda, se nessun'altra voce la usa.
    Copie.togliSeOrfane(icone);
    return tolte;
  }

  async function remove(id) {
    if (Disco.inIncognito()) return [];
    const d = await apri();
    togli(d, [id]);
    return d.tutti();
  }

  // Cancellazione multipla (§5 pulizia retroattiva).
  async function removeMany(ids) {
    if (Disco.inIncognito()) return { removed: 0, remaining: 0 };
    const d = await apri();
    const removed = togli(d, Array.isArray(ids) ? ids : []);
    return { removed, remaining: d.numero() };
  }

  // Le pagine tolte dal filo se ne vanno anche da qui, o la ricerca nel filo le ritroverebbe (#869): conta una scheda
  // aperta nel periodo, sul sito detto, e con quell'indirizzo se ne è dato uno (una visita tolta da sola).
  function regolaDimenticate({ da = null, a = null, sito = null, url = null } = {}, { finoA = Infinity } = {}) {
    const t0 = da != null ? Date.parse(da) : -Infinity;
    const t1 = Math.min(a != null ? Date.parse(a) : Infinity, finoA);
    return { t0, t1, sito, url };
  }
  function coperta(t, r) {
    const E = global.SN_FILO_EVENTI;
    if (!t || !t.url || (r.url && t.url !== r.url)) return false;
    if (r.sito && !(E && E.delSito(t.url, r.sito))) return false;
    const chiusa = Date.parse(t.closedAt);
    const aperta = Date.parse(t.openedAt);
    const fine = Number.isFinite(chiusa) ? chiusa : Infinity;
    const inizio = Number.isFinite(aperta) ? aperta : (r.url ? -Infinity : fine);
    return inizio <= r.t1 && fine >= r.t0;
  }
  // Una scheda ancora aperta quando le sue pagine si tolgono entra qui solo alla chiusura: la regola resta per lei, ma
  // solo per le schede aperte prima di adesso (una visita di dopo non è stata tolta). Vale finché Filo resta aperto.
  const dimenticate = [];

  async function dimenticaPagine(periodo = {}) {
    if (Disco.inIncognito()) return 0;
    dimenticate.push(regolaDimenticate(periodo, { finoA: Date.now() }));
    const r = regolaDimenticate(periodo);
    const d = await apri();
    const ids = d.tutti().filter((t) => coperta(t, r)).map((t) => t.id);
    return ids.length ? togli(d, ids) : 0;
  }

  async function clear() {
    if (Disco.inIncognito()) return [];
    const d = await apri();
    const icone = d.tutti().map((t) => t.favicon);
    d.svuota();
    uscita(null);
    Copie.togliSeOrfane(icone);
    return [];
  }

  // Importazione di un backup: si aggiungono le schede che mancano, dietro alle
  // presenti (come l'unione delle liste in exportData). Ritorna quante ne sono entrate.
  async function importa(voci) {
    if (Disco.inIncognito() || !Array.isArray(voci)) return 0;
    const d = await apri();
    const pronte = [];
    for (const t of voci) {
      if (!t || typeof t !== 'object' || Array.isArray(t)) continue;
      pronte.push(await iconaLocale(typeof t.id === 'string' && t.id ? t : { ...t, id: uuid() }));
    }
    const entrati = entrate(d.aggiungiMolti(pronte, { inCoda: true }));
    if (entrati.some((t) => !t.favicon && !t.proxy)) riordinaIcone();
    return entrati.length;
  }

  // `esiti`: id → { prima, a }, come in SN_SAVED_PAGES.aggiornaIcone. Una riscrittura sola: l'indirizzo chiesto non resta nei file.
  async function aggiornaIcone(esiti) {
    if (Disco.inIncognito()) return 0;
    const d = await apri();
    let cambiate = 0;
    d.riscrivi((t) => {
      const e = esiti.get(t.id);
      if (!e || Vecchie().statoIcona(t) !== e.prima) return t;
      cambiate++;
      const { faviconDaChiedere, iconaMancante, ...resto } = t;
      const esito = Vecchie().esitoIcona(t, e.a);
      return { ...resto, favicon: esito.favicon, ...(esito.iconaMancante ? { iconaMancante: true } : {}) };
    });
    return cambiate;
  }

  Copie.usaCopie('schede-archiviate', async () => (Disco.inIncognito() ? [] : (await apri()).tutti().map((t) => t.favicon)));

  global.SN_ARCHIVED_TABS = {
    list, listMeta, ultimaPer, archive, update, remove, removeMany, dimenticaPagine, clear, importa, aggiornaIcone,
    suEntrate, suUscite, cartella,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
