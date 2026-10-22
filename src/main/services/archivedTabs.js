// Archivio delle schede chiuse (§3.1): metadati, riassunto e vettore di ogni scheda, in file propri (userData/archivio-schede).
// Nessun tetto e nessuna scadenza: una scheda esce solo quando l'utente la cancella, e allora sparisce dal disco.
// Regole: patterns/un-archivio-che-cresce-sta-in-file-suoi-a-sole-aggiunte.md; prove: tests/archive-store-unlimited.spec.mjs.

(function (global) {
  'use strict';

  const path = require('node:path');
  const { creaDeposito } = require('./depositoAggiunte');
  const { MISURA, taglia } = require('./misurePagine');
  const Disco = require('../shim/storage');

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

  // L'incognito non vede l'archivio e non ci scrive (la stessa garanzia che storage.json dà alle sue chiavi di navigazione).
  // Per questo si apre solo da fuori: la migrazione deve leggere storage.json vero, non la vista vuota dell'incognito.
  function apri() {
    if (!apertura) {
      apertura = (async () => {
        const d = creaDeposito({ cartella: cartella(), meseDi });
        await d.carica();
        await migra(d);
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

  async function list() {
    if (Disco.inIncognito()) return [];
    return (await apri()).tutti();
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
    const entry = {
      id: uuid(),
      url: u.testo,
      title: t.testo,
      ...(u.tagliato ? { urlTagliato: true } : {}),
      ...(t.tagliato ? { titleTagliato: true } : {}),
      // Anche l'icona la sceglie il sito (un data: lungo un mega): oltre la misura non si tiene, a metà non si disegna.
      favicon: typeof meta.favicon === 'string' && meta.favicon.length <= MISURA.url ? meta.favicon : '',
      // Colore identità del sito (§1.2): serve all'ordine cromatico in archivio.
      identityColor: meta.identityColor || null,
      openedAt: meta.openedAt || null,
      closedAt: meta.closedAt || new Date().toISOString(),
      // 'manual' per la chiusura dell'utente, altri valori dall'auto-archiviazione (§2.1).
      reason: meta.reason || 'manual',
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
    return r;
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
    for (const id of via) { const t = d.prendi(id); if (t && t.url) urlVia.add(t.url); }
    for (const t of d.tutti()) if (!via.has(t.id) && urlVia.has(t.url)) urlVia.delete(t.url);
    return d.togli([...via], (t) => {
      if (!urlVia.size || !Array.isArray(t.coOpenUrls) || !t.coOpenUrls.some((u) => urlVia.has(u))) return t;
      const tagliati = new Set(Array.isArray(t.coOpenUrlsTagliati) ? t.coOpenUrlsTagliati : []);
      const resta = t.coOpenUrls.map((u, i) => ({ u, tagliato: tagliati.has(i) })).filter((x) => !urlVia.has(x.u));
      const { coOpenUrlsTagliati: _prima, ...senza } = t;
      const segni = resta.map((x, i) => (x.tagliato ? i : -1)).filter((i) => i >= 0);
      return { ...senza, coOpenUrls: resta.map((x) => x.u), ...(segni.length ? { coOpenUrlsTagliati: segni } : {}) };
    });
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
    (await apri()).svuota();
    return [];
  }

  // Importazione di un backup: si aggiungono le schede che mancano, dietro alle
  // presenti (come l'unione delle liste in exportData). Ritorna quante ne sono entrate.
  async function importa(voci) {
    if (Disco.inIncognito() || !Array.isArray(voci)) return 0;
    const d = await apri();
    const pronte = voci
      .filter((t) => t && typeof t === 'object' && !Array.isArray(t))
      .map((t) => (typeof t.id === 'string' && t.id ? t : { ...t, id: uuid() }));
    return entrate(d.aggiungiMolti(pronte, { inCoda: true })).length;
  }

  global.SN_ARCHIVED_TABS = {
    list, listMeta, archive, update, remove, removeMany, dimenticaPagine, clear, importa,
    suEntrate, cartella,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
