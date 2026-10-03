// Il filo (#866): l'unico modulo che legge e scrive la linea del tempo, un file suo che cresce solo in coda.
// Non passa da storage.json e non tiene niente dell'incognito su disco. Regole:
// patterns/il-filo-cresce-solo-in-coda-e-cancellare-e-un-evento.md, forma degli eventi in src/shared/filoEventi.js.

'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const E = () => globalThis.SN_FILO_EVENTI;
const FILE_EVENTI = 'eventi.jsonl';
const FILE_DISPOSITIVO = 'dispositivo';

function disco() {
  try { return require('../shim/storage'); } catch (_) { return null; }
}

function inIncognito(opts) {
  if (opts && opts.incognito != null) return !!opts.incognito;
  try { return !!(disco() && disco().inIncognito()); } catch (_) { return false; }
}

function cartellaDati() {
  if (process.env.FILO_USER_DATA) return process.env.FILO_USER_DATA;
  return require('electron').app.getPath('userData');
}

// Un'istanza per profilo: il profilo segreto ne aprirà una sua con un'altra cartella, senza vedere questa.
function creaFilo({ cartella } = {}) {
  const dir = () => cartella || path.join(cartellaDati(), 'filo');
  const fileEventi = () => path.join(dir(), FILE_EVENTI);

  const normale = { stato: E().nuovoStato(), caricato: false, caricando: null, dispositivo: '' };
  // L'incognito ha un filo suo in memoria: si vede solo da lì e sparisce con l'ultima finestra incognito.
  let incognito = { stato: E().nuovoStato(), eventi: [] };

  let coda = Promise.resolve();
  function inCoda(fn) {
    const r = coda.then(fn, fn);
    coda = r.then(() => {}, () => {});
    return r;
  }

  async function leggiDispositivo() {
    const f = path.join(dir(), FILE_DISPOSITIVO);
    try {
      const id = (await fsp.readFile(f, 'utf8')).trim();
      if (id) return id;
    } catch (_) {}
    const id = E().uuid();
    try {
      await fsp.mkdir(dir(), { recursive: true });
      await fsp.writeFile(f, id + '\n', 'utf8');
    } catch (e) { console.warn('[Filo] dispositivo non salvato:', e?.message || e); }
    return id;
  }

  async function scriviInCoda(testo) {
    await fsp.mkdir(dir(), { recursive: true });
    const fh = await fsp.open(fileEventi(), 'a');
    try {
      await fh.appendFile(testo, 'utf8');
      // Chi chiude l'app di colpo, o resta senza corrente, ritrova quello che era già scritto.
      await fh.datasync().catch(() => {});
    } finally { await fh.close(); }
  }

  async function rinomina(da, a) {
    for (let i = 0; ; i++) {
      try { return await fsp.rename(da, a); } catch (e) {
        // Su Windows un antivirus o un indicizzatore tiene il file aperto per un attimo.
        if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
        await new Promise((r) => setTimeout(r, 60 * (i + 1)));
      }
    }
  }

  // Le uniche righe che si tolgono dal file sono quelle coperte da una cancellazione; le altre restano byte per byte.
  async function compattaFile() {
    let testo = '';
    try { testo = await fsp.readFile(fileEventi(), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return 0; throw e; }
    const coppie = [];
    for (const r of testo.split('\n')) {
      if (!r.trim()) continue;
      let ev = null;
      try { ev = JSON.parse(r); } catch (_) { continue; }
      if (!ev || typeof ev !== 'object') continue;
      coppie.push({ r, ev });
    }
    const validi = coppie.filter((c) => E().valido(c.ev)).map((c) => c.ev);
    const tenuti = new Set(E().compatta(validi));
    // Una riga che questa versione non capisce (una versione più nuova del formato) resta dov'è.
    const restano = coppie.filter((c) => !E().valido(c.ev) || tenuti.has(c.ev));
    const tmp = fileEventi() + '.tmp';
    const fh = await fsp.open(tmp, 'w');
    try {
      await fh.writeFile(restano.map((c) => c.r + '\n').join(''), 'utf8');
      await fh.datasync().catch(() => {});
    } finally { await fh.close(); }
    await rinomina(tmp, fileEventi());
    return coppie.length - restano.length;
  }

  async function caricaDaDisco() {
    const stato = E().nuovoStato();
    let testo = '';
    try { testo = await fsp.readFile(fileEventi(), 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const { eventi, scartate } = E().analizza(testo);
    if (scartate) console.warn(`[Filo] filo: ${scartate} righe illeggibili saltate`);
    let daCompattare = false;
    for (const ev of eventi) if (E().applica(stato, ev).tolti) daCompattare = true;
    // Una riga lasciata a metà da un guasto non deve incollarsi all'evento che arriva dopo.
    if (testo && !testo.endsWith('\n')) await scriviInCoda('\n');
    // Una cancellazione scritta ma non ancora tolta dal file (l'app è morta in mezzo) si finisce adesso.
    if (daCompattare) await compattaFile();
    return stato;
  }

  // Le chat salvate prima del filo (#525) diventano segmenti: una chat già nel filo non si riscrive, così la
  // migrazione si può ripetere (un avvio interrotto, un vecchio export reimportato) senza doppioni.
  async function migraChatSalvate(chats) {
    const lista = (Array.isArray(chats) ? chats : []).filter((c) => c && c.id && !normale.stato.chat.has(c.id));
    if (!lista.length) return 0;
    const eventi = E().daChatSalvate(lista, { dispositivo: normale.dispositivo });
    await scriviInCoda(eventi.map(E().riga).join(''));
    for (const ev of eventi) E().applica(normale.stato, ev);
    return lista.length;
  }

  async function migraDaStorage() {
    const D = disco();
    const KEY = globalThis.SN_CONST && globalThis.SN_CONST.STORAGE_KEYS && globalThis.SN_CONST.STORAGE_KEYS.FILO_CHATS;
    const chrome = globalThis.chrome;
    if (!KEY || !chrome || !chrome.storage || !chrome.storage.local) return;
    const leggi = () => chrome.storage.local.get(KEY);
    const res = D && D.fuoriDaIncognito ? await D.fuoriDaIncognito(leggi) : await leggi();
    const chats = res && res[KEY];
    if (chats === undefined) return;
    if (Array.isArray(chats) && chats.length) await migraChatSalvate(chats);
    const togli = async () => {
      await chrome.storage.local.remove(KEY);
      if (D && D.flushNow) await D.flushNow();
    };
    if (D && D.fuoriDaIncognito) await D.fuoriDaIncognito(togli); else await togli();
  }

  function carica() {
    if (normale.caricato) return Promise.resolve();
    if (!normale.caricando) {
      normale.caricando = (async () => {
        if (!normale.dispositivo) normale.dispositivo = await leggiDispositivo();
        try {
          normale.stato = await caricaDaDisco();
        } catch (e) {
          // Senza leggere il filo non si migra né si compatta: una migrazione su un elenco vuoto farebbe doppioni.
          console.warn('[Filo] filo non leggibile, riprovo alla prossima richiesta:', e?.message || e);
          normale.caricando = null;
          return;
        }
        try { await migraDaStorage(); } catch (e) { console.warn('[Filo] migrazione delle chat:', e?.message || e); }
        normale.caricato = true;
      })();
    }
    return normale.caricando;
  }

  function evento(tipo, campi, { autore, ts, id } = {}) {
    return E().crea(tipo, campi, { autore, ts, id, dispositivo: normale.dispositivo || 'sconosciuto' });
  }

  async function scrivi(incog, eventi) {
    const validi = (Array.isArray(eventi) ? eventi : [eventi]).filter((ev) => E().valido(ev));
    if (!validi.length) return { scritti: [], tolti: 0 };
    let tolti = 0;
    if (incog) {
      const scritti = [];
      for (const ev of validi) {
        const r = E().applica(incognito.stato, ev);
        if (r.nuovo) { incognito.eventi.push(ev); scritti.push(ev); }
        tolti += r.tolti;
      }
      if (tolti) incognito.eventi = E().compatta(incognito.eventi);
      return { scritti, tolti };
    }
    const nuovi = validi.filter((ev) => !normale.stato.ids.has(ev.id));
    if (!nuovi.length) return { scritti: [], tolti: 0 };
    await scriviInCoda(nuovi.map(E().riga).join(''));
    for (const ev of nuovi) tolti += E().applica(normale.stato, ev).tolti;
    if (tolti) await compattaFile();
    return { scritti: nuovi, tolti };
  }

  // Leggere, decidere e scrivere senza che un'altra scrittura passi in mezzo: due schede che chattano insieme non
  // si mangiano un messaggio. L'incognito si decide qui, una volta, con la richiesta.
  function transazione(fn, opts) {
    const incog = inIncognito(opts);
    return inCoda(async () => {
      await carica();
      const v = incog ? incognito : normale;
      return fn({
        incognito: incog,
        chat: (id) => (id ? v.stato.chat.get(id) || null : null),
        evento,
        scrivi: (eventi) => scrivi(incog, eventi),
      });
    });
  }

  async function vista(opts) {
    const incog = inIncognito(opts);
    await carica();
    return incog ? incognito : normale;
  }

  async function chats(opts) {
    const v = await vista(opts);
    return E().elencoChat(v.stato).map(E().copiaChat);
  }

  async function chat(id, opts) {
    if (!id) return null;
    const v = await vista(opts);
    return E().copiaChat(v.stato.chat.get(id));
  }

  async function pagine(periodo, opts) {
    const v = await vista(opts);
    return E().pagineNelPeriodo(v.stato, periodo || { da: null, a: null }).map((p) => ({ ...p }));
  }

  // Ogni pagina aperta in una scheda: dalla finestra incognito resta nel filo in memoria, mai su disco.
  function registraVisita({ url, titolo, scheda, ts } = {}, opts) {
    if (!url) return Promise.resolve(null);
    return transazione(async (t) => {
      const ev = t.evento(E().TIPI.NAVIGAZIONE, {
        url: String(url), titolo: String(titolo || ''), scheda: scheda == null ? undefined : scheda,
      }, { autore: 'utente', ts });
      await t.scrivi([ev]);
      return ev;
    }, opts);
  }

  function cancellaPagine(periodo, opts) {
    if (!periodo) return Promise.resolve(0);
    return transazione(async (t) => {
      const ev = t.evento(E().TIPI.CANCELLAZIONE, { pagine: { da: periodo.da ?? null, a: periodo.a ?? null } }, { autore: 'utente' });
      const { tolti } = await t.scrivi([ev]);
      return tolti;
    }, opts);
  }

  // Per l'esportazione: il filo così com'è sul disco (o, dall'incognito, quello in memoria).
  async function esporta(opts) {
    const incog = inIncognito(opts);
    return inCoda(async () => {
      await carica();
      if (incog) return Buffer.from(incognito.eventi.map(E().riga).join(''), 'utf8');
      try { return await fsp.readFile(fileEventi()); } catch (e) { if (e.code === 'ENOENT') return Buffer.alloc(0); throw e; }
    });
  }

  // Gli eventi di un export: entrano quelli con un id che qui non c'è, nell'ordine in cui erano.
  function importa(testo, opts) {
    return transazione(async (t) => {
      const { eventi, scartate } = E().analizza(Buffer.isBuffer(testo) ? testo.toString('utf8') : testo);
      const { scritti } = await t.scrivi(eventi);
      return { aggiunti: scritti.length, scartate };
    }, opts);
  }

  // Un export di prima del filo porta le chat nel vecchio formato: entrano come alla migrazione.
  function importaChatSalvate(chatsVecchie, opts) {
    return transazione(async (t) => {
      if (t.incognito) {
        const nuove = (Array.isArray(chatsVecchie) ? chatsVecchie : []).filter((c) => c && c.id && !t.chat(c.id));
        await t.scrivi(E().daChatSalvate(nuove, { dispositivo: normale.dispositivo || 'sconosciuto' }));
        return nuove.length;
      }
      return migraChatSalvate(chatsVecchie);
    }, opts);
  }

  function resetIncognito() {
    incognito = { stato: E().nuovoStato(), eventi: [] };
  }

  async function dispositivo() {
    await carica();
    return normale.dispositivo;
  }

  // Aspetta che ogni scrittura in fila sia arrivata su disco (prove e chiusura dell'app).
  function quandoFermo() {
    return inCoda(() => {});
  }

  return {
    carica, transazione, chats, chat, pagine, registraVisita, cancellaPagine, esporta, importa, importaChatSalvate,
    resetIncognito, dispositivo, quandoFermo, percorso: fileEventi,
  };
}

const filo = creaFilo();
globalThis.SN_IL_FILO = filo;
module.exports = { ...filo, creaFilo };
