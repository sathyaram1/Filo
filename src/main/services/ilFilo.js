// Il filo (#866): l'unico modulo che legge e scrive la linea del tempo, un file suo che cresce solo in coda.
// Non passa da storage.json e non tiene niente dell'incognito su disco. Regole:
// patterns/il-filo-cresce-solo-in-coda-e-cancellare-e-un-evento.md, forma degli eventi in src/shared/filoEventi.js.

'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { perRiga } = require('./leggiARighe');
const { MISURA, taglia } = require('./misurePagine');

const E = () => globalThis.SN_FILO_EVENTI;
const FILE_EVENTI = 'eventi.jsonl';
const FILE_DISPOSITIVO = 'dispositivo';
// Segno che le schede chiuse di prima del filo ci sono entrate (#872): dopo, entrano solo quelle di un backup.
const FILE_SCHEDE_ENTRATE = 'schede-chiuse-entrate';
// Una visita già nel filo per la stessa scheda chiusa: stesso indirizzo, aperta fra l'apertura e la chiusura (più un margine).
const MARGINE_SCHEDA_MS = 2 * 60 * 1000;
// Oltre questa misura il file si fa notare una volta per avvio, con la strada per alleggerirlo (#1525): non è un tetto.
const SOGLIA_AVVISO = 256 * 1024 * 1024;
// Il filo che non si legge lo dice; ogni richiesta riprova, ma l'avviso non torna a ogni pagina aperta.
const RIPETI_ILLEGGIBILE_MS = 10 * 60 * 1000;
const CANCELLA_PAGINE_URL = 'filo://security/security.html#cancella-pagine';

function avvisoDiFinestra(testo, opts) {
  try { require('./avvisoFinestra').avvisoQuandoPronta(testo, opts); } catch (_) {}
}

// La causa come la capisce chi usa Filo: il codice di sistema resta nel log.
function causaDi(e) {
  const c = e && e.code;
  if (c === 'EACCES' || c === 'EPERM') return 'il sistema non dà il permesso di leggerle';
  if (c === 'EBUSY') return 'un altro programma tiene occupato il file';
  if (c === 'EIO') return 'il disco ha dato un errore di lettura';
  if (c === 'EMFILE' || c === 'ENFILE') return 'il sistema ha troppi file aperti in questo momento';
  if (c === 'EISDIR') return 'al posto del file c’è una cartella';
  if (c === 'ENOMEM' || e instanceof RangeError) return 'non c’è abbastanza memoria per leggerle';
  const m = String((e && e.message) || '').trim();
  return m ? `c’è stato un errore («${m.slice(0, 200)}»)` : 'c’è stato un errore sconosciuto';
}

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
// `avvisa(testo, { chiave, azioni })`: il toast nella cornice della finestra (le prove lo raccolgono).
function creaFilo({ cartella, avvisa = avvisoDiFinestra } = {}) {
  const dir = () => cartella || path.join(cartellaDati(), 'filo');
  const fileEventi = () => path.join(dir(), FILE_EVENTI);

  const normale = { stato: E().nuovoStato(), caricato: false, caricando: null, dispositivo: '' };
  const avvisi = { illeggibile: 0, peso: false };
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
  // Due letture a righe, mai il file intero in memoria: la prima decide quali righe restano, la seconda le copia.
  async function compattaFile() {
    const lette = [];
    // Di un evento servono solo i campi che decidono cosa copre una cancellazione, non il testo dei messaggi.
    const sottile = (ev) => ({
      id: ev.id, tipo: ev.tipo, ts: ev.ts, chat: ev.chat, url: ev.url, visita: ev.visita, pagine: ev.pagine, parametri: ev.parametri,
      testo: ev.tipo === E().TIPI.NOTIFICA ? ev.testo : undefined,
    });
    try {
      await perRiga(fileEventi(), (r, i) => {
        if (!r.trim()) return;
        let ev = null;
        try { ev = JSON.parse(r); } catch (_) { return; }
        if (!ev || typeof ev !== 'object') return;
        lette.push({ i, ev: E().valido(ev) ? sottile(ev) : null });
      });
    } catch (e) { if (e.code === 'ENOENT') return 0; throw e; }
    const tenuti = new Set(E().compatta(lette.filter((x) => x.ev).map((x) => x.ev)));
    // Una riga che questa versione non capisce (una versione più nuova del formato) resta dov'è.
    const restano = new Set(lette.filter((x) => !x.ev || tenuti.has(x.ev)).map((x) => x.i));
    await scriviIntero(async (fh) => {
      let blocco = '';
      await perRiga(fileEventi(), (r, i) => {
        if (!restano.has(i)) return undefined;
        blocco += r + '\n';
        if (blocco.length < (1 << 20)) return undefined;
        const b = blocco;
        blocco = '';
        return fh.write(b, null, 'utf8');
      });
      if (blocco) await fh.write(blocco, null, 'utf8');
    });
    return lette.length - restano.size;
  }

  // Il file intero si riscrive solo passando da un temporaneo: chi muore a metà ritrova quello di prima.
  async function scriviIntero(scrivi) {
    const tmp = fileEventi() + '.tmp';
    const fh = await fsp.open(tmp, 'w');
    try {
      await scrivi(fh);
      await fh.datasync().catch(() => {});
    } finally { await fh.close(); }
    await rinomina(tmp, fileEventi());
  }

  // Le prove che riusano un'app rimettono il filo com'era all'apertura (tests/helpers/appCondivisa.mjs).
  function ricomincia(testo) {
    return inCoda(async () => {
      await carica();
      await fsp.mkdir(dir(), { recursive: true });
      await scriviIntero((fh) => fh.writeFile(String(testo || ''), 'utf8'));
      normale.stato = await caricaDaDisco();
      resetIncognito();
    });
  }

  async function caricaDaDisco() {
    const stato = E().nuovoStato();
    let scartate = 0;
    let daCompattare = false;
    let aCapo = true;
    try {
      ({ aCapo } = await perRiga(fileEventi(), (r) => {
        const ev = E().analizzaRiga(r);
        if (ev === null) scartate++;
        else if (ev && E().applica(stato, ev).tolti) daCompattare = true;
      }));
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (scartate) console.warn(`[Filo] filo: ${scartate} righe illeggibili saltate`);
    // Una riga lasciata a metà da un guasto non deve incollarsi all'evento che arriva dopo.
    if (!aCapo) await scriviInCoda('\n');
    // Una cancellazione scritta ma non ancora tolta dal file (l'app è morta in mezzo) si finisce adesso.
    if (daCompattare) await compattaFile();
    return stato;
  }

  function avvisaIlleggibile(e) {
    const ora = Date.now();
    if (ora - avvisi.illeggibile < RIPETI_ILLEGGIBILE_MS) return;
    avvisi.illeggibile = ora;
    avvisa(`Filo non riesce a leggere le chat e le pagine visitate, perché ${causaDi(e)}. Finché non ci riesce non salva niente di nuovo, e riprova a ogni richiesta.`,
      { chiave: 'filo-illeggibile' });
  }

  async function avvisaSePesa() {
    if (avvisi.peso) return;
    let byte = 0;
    try { byte = (await fsp.stat(fileEventi())).size; } catch (_) { return; }
    if (byte <= SOGLIA_AVVISO) return;
    avvisi.peso = true;
    avvisa(`Le chat e le pagine visitate occupano ${Math.round(byte / (1024 * 1024))} MB sul disco. Cancellare le pagine di un periodo le alleggerisce.`,
      { chiave: 'filo-pesante', azioni: [{ label: 'Cancella pagine', openUrl: CANCELLA_PAGINE_URL }] });
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

  // Il registro grezzo di prima (#868): la sua sola copia dei messaggi tagliati a 200 caratteri non serve più a nessuno.
  async function togliRegistroGrezzo() {
    const D = disco();
    const KEY = globalThis.SN_CONST && globalThis.SN_CONST.STORAGE_KEYS && globalThis.SN_CONST.STORAGE_KEYS.FILO_RAW_LOG;
    const chrome = globalThis.chrome;
    if (!KEY || !chrome || !chrome.storage || !chrome.storage.local) return;
    const togli = async () => {
      const r = await chrome.storage.local.get(KEY);
      if (r && r[KEY] !== undefined) await chrome.storage.local.remove(KEY);
    };
    if (D && D.fuoriDaIncognito) await D.fuoriDaIncognito(togli); else await togli();
  }

  // Il registro dei cambi di prima (#867) entra nel filo alla sua ora; la chiave si toglie solo dopo che è su disco.
  async function migraCambiSalvati() {
    const D = disco();
    const KEY = globalThis.SN_CONST && globalThis.SN_CONST.STORAGE_KEYS && globalThis.SN_CONST.STORAGE_KEYS.FILO_CAMBI;
    const chrome = globalThis.chrome;
    if (!KEY || !chrome || !chrome.storage || !chrome.storage.local) return;
    const leggi = () => chrome.storage.local.get(KEY);
    const res = D && D.fuoriDaIncognito ? await D.fuoriDaIncognito(leggi) : await leggi();
    const lista = res && res[KEY];
    if (lista === undefined) return;
    const gia = new Set(E().cambiDi(normale.stato).map((e) => e.id));
    const eventi = E().daCambiSalvati(lista, { dispositivo: normale.dispositivo, gia });
    if (eventi.length) {
      await scriviInCoda(eventi.map(E().riga).join(''));
      for (const ev of eventi) E().applica(normale.stato, ev);
    }
    const togli = async () => {
      await chrome.storage.local.remove(KEY);
      if (D && D.flushNow) await D.flushNow();
    };
    if (D && D.fuoriDaIncognito) await D.fuoriDaIncognito(togli); else await togli();
  }

  async function migraDaStorage() {
    try { await togliRegistroGrezzo(); } catch (e) { console.warn('[Filo] registro grezzo non tolto:', e?.message || e); }
    try { await migraCambiSalvati(); } catch (e) { console.warn('[Filo] migrazione dei cambi:', e?.message || e); }
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

  // Rifiuta se il file non si legge: chi scrive non deve lavorare su un filo vuoto (le sue righe finirebbero in coda a
  // un file che nessuno ha riletto). La richiesta dopo riprova da capo.
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
          avvisaIlleggibile(e);
          const err = new Error(`il filo non si legge: ${e?.message || e}`);
          err.code = 'FILO_ILLEGGIBILE';
          err.cause = e;
          throw err;
        }
        try { await migraDaStorage(); } catch (e) { console.warn('[Filo] migrazione delle chat:', e?.message || e); }
        normale.caricato = true;
        avvisaSePesa().catch(() => {});
      })();
    }
    return normale.caricando;
  }

  // Chi legge soltanto vede il filo vuoto (l'avviso dice perché); chi scrive passa da `transazione`, che rifiuta.
  async function caricaPerLeggere() {
    try { await carica(); } catch (_) {}
  }

  function evento(tipo, campi, { autore, ts, id } = {}) {
    return E().crea(tipo, campi, { autore, ts, id, dispositivo: normale.dispositivo || 'sconosciuto' });
  }

  // Un evento fuori formato non si butta in silenzio: chi scrive lo deve sapere (per la chat lo registra handlers.js).
  async function scrivi(incog, eventi, { scartaInvalidi = false } = {}) {
    const tutti = Array.isArray(eventi) ? eventi : [eventi];
    const validi = tutti.filter((ev) => E().valido(ev));
    if (validi.length < tutti.length && !scartaInvalidi) {
      throw new Error(`evento del filo fuori formato: ${tutti.filter((ev) => !E().valido(ev)).map((ev) => ev && ev.tipo).join(', ')}`);
    }
    const st = incog ? incognito.stato : normale.stato;
    const visite = new Set(validi.filter((ev) => ev.tipo === E().TIPI.NAVIGAZIONE && !E().coperto(st, ev)).map((ev) => ev.id));
    const daScrivere = validi.filter((ev) => !E().coperto(st, ev, visite));
    if (!daScrivere.length) return { scritti: [], tolti: 0, pagine: 0 };
    let tolti = 0;
    let pagine = 0;
    if (incog) {
      const scritti = [];
      for (const ev of daScrivere) {
        const r = E().applica(incognito.stato, ev);
        if (r.nuovo) { incognito.eventi.push(ev); scritti.push(ev); }
        tolti += r.tolti;
        pagine += r.pagine || 0;
      }
      if (tolti) incognito.eventi = E().compatta(incognito.eventi);
      annunciaPagine(scritti, true);
      return { scritti, tolti, pagine };
    }
    const nuovi = daScrivere.filter((ev) => !normale.stato.ids.has(ev.id));
    if (!nuovi.length) return { scritti: [], tolti: 0, pagine: 0 };
    await scriviInCoda(nuovi.map(E().riga).join(''));
    for (const ev of nuovi) {
      const r = E().applica(normale.stato, ev);
      tolti += r.tolti;
      pagine += r.pagine || 0;
    }
    annunciaPagine(nuovi, false);
    if (tolti) await compattaFile();
    return { scritti: nuovi, tolti, pagine };
  }

  // Ogni pagina che entra, cambia titolo o se ne va passa di qui, e da qui lo sanno le home aperte: una visita si scrive
  // a pagina caricata, spesso con la home già davanti (#1307.4). Si annuncia a stato già piegato: chi rilegge la vede.
  const sullePagine = new Set();
  function suPagine(fn) { if (typeof fn === 'function') sullePagine.add(fn); }
  function annunciaPagine(scritti, incog) {
    const T = E().TIPI;
    const tocca = (ev) => ev.tipo === T.NAVIGAZIONE || ev.tipo === T.TITOLO_PAGINA || (ev.tipo === T.CANCELLAZIONE && ev.chat == null);
    if (!scritti.some(tocca)) return;
    for (const fn of sullePagine) { try { fn({ incognito: incog }); } catch (_) {} }
  }

  // Leggere, decidere e scrivere senza che un'altra scrittura passi in mezzo: due schede che chattano insieme non
  // si mangiano un messaggio. L'incognito si decide qui, una volta, con la richiesta.
  function transazione(fn, opts) {
    const incog = inIncognito(opts);
    return inCoda(async () => {
      // L'incognito ha il filo in memoria: un file che non si legge non lo tocca.
      if (incog) await caricaPerLeggere(); else await carica();
      const v = incog ? incognito : normale;
      return fn({
        incognito: incog,
        chat: (id) => (id ? v.stato.chat.get(id) || null : null),
        tutte: () => [...v.stato.chat.values()],
        ultimoCambio: () => { const l = v.stato.cambi || []; return l.length ? E().cambiDi({ cambi: [l[l.length - 1]] })[0] : null; },
        dispositivo: normale.dispositivo || 'sconosciuto',
        evento,
        scrivi: (eventi, o) => scrivi(incog, eventi, o),
      });
    });
  }

  async function vista(opts) {
    const incog = inIncognito(opts);
    await caricaPerLeggere();
    return incog ? incognito : normale;
  }

  // Una chat nascosta (#1295) non la vede nessuno che chiede «le chat»: solo chi la chiede (`nascoste`: true tutte, 'solo').
  const quali = (opts) => {
    const n = opts && opts.nascoste;
    return n === 'solo' ? (c) => !!c.nascosta : (n ? () => true : (c) => !c.nascosta);
  };
  async function chats(opts) {
    const v = await vista(opts);
    return E().elencoChat(v.stato).filter(quali(opts)).map(E().copiaChat);
  }

  async function chat(id, opts) {
    if (!id) return null;
    const v = await vista(opts);
    return E().copiaChat(v.stato.chat.get(id));
  }

  // Per la home (#869): tutte le chat col dispositivo di ogni messaggio, le pagine e il dispositivo di qui. `pos` cambia a
  // ogni evento: chi ne ricava qualcosa di costoso lo tiene finché non cambia.
  async function perLaCoda(opts) {
    const v = await vista(opts);
    return {
      pos: v.stato.pos,
      qui: normale.dispositivo,
      chats: E().elencoChat(v.stato).filter(quali(opts)).map((c) => E().copiaChat(c, { dispositivi: true })),
      pagine: E().pagineNelPeriodo(v.stato, { da: null, a: null }).map((p) => ({ ...p })),
    };
  }

  // Dov'è un evento (messaggio o pagina visitata), per saltarci: null se non c'è più (#872).
  async function dove(id, opts) {
    const v = await vista(opts);
    return E().dove(v.stato, id);
  }

  // L'evento dell'ultimo messaggio dell'utente in una chat: la fonte di una lezione chiesta a parole.
  async function ultimaDomanda(id, opts) {
    const v = await vista(opts);
    const c = id ? E().copiaChat(v.stato.chat.get(String(id)), { ids: true }) : null;
    if (!c) return '';
    for (let i = c.messages.length - 1; i >= 0; i--) if (c.messages[i].role === 'user') return c.eids[i] || '';
    return '';
  }

  // I cambi di stato (#867) del filo di chi chiede: l'incognito vede i suoi, mai quelli del disco.
  async function cambi(opts) {
    const v = await vista(opts);
    return E().cambiDi(v.stato);
  }

  // Azioni, schede, ricerche, download, documenti, timer, avvisi e sistema (#1561), in ordine di arrivo.
  async function accaduti(filtro, opts) {
    const v = await vista(opts);
    return E().accadutiDi(v.stato, filtro || {});
  }

  async function pagine(periodo, opts) {
    const v = await vista(opts);
    return E().pagineNelPeriodo(v.stato, periodo || { da: null, a: null }).map((p) => ({ ...p }));
  }

  // Ogni pagina aperta in una scheda: dalla finestra incognito resta nel filo in memoria, mai su disco.
  // Indirizzo e titolo li sceglie il sito: oltre la misura si tagliano, e la visita lo segna.
  function registraVisita({ url, titolo, scheda, ts } = {}, opts) {
    if (!url) return Promise.resolve(null);
    const u = taglia(url, MISURA.url);
    const tt = taglia(titolo || '', MISURA.titolo);
    return transazione(async (t) => {
      const ev = t.evento(E().TIPI.NAVIGAZIONE, {
        url: u.testo, titolo: tt.testo, scheda: scheda == null ? undefined : scheda,
        urlTagliato: u.tagliato || undefined, titoloTagliato: tt.tagliato || undefined,
      }, { autore: 'utente', ts });
      // Una pagina di risultati è anche una ricerca (#1561): nasce con la sua visita e se ne va con lei.
      const A = globalThis.SN_FILO_ACCADUTI;
      const cercato = A && typeof A.ricercaNellIndirizzo === 'function' ? A.ricercaNellIndirizzo(String(url)) : null;
      const eventi = [ev];
      if (cercato) {
        eventi.push(t.evento(E().TIPI.RICERCA, { testo: cercato.testo, dove: 'sito', sito: cercato.sito, visita: ev.id }, { autore: 'utente', ts: ev.ts }));
      }
      await t.scrivi(eventi);
      return ev;
    }, opts);
  }

  // Il titolo che la pagina si dà dopo (un'app web, «Caricamento…» che diventa il nome vero) è un evento in coda.
  function aggiornaTitolo({ visita, titolo: intero } = {}, opts) {
    if (!visita || typeof intero !== 'string' || !intero) return Promise.resolve(null);
    const { testo: titolo, tagliato } = taglia(intero, MISURA.titolo);
    return transazione(async (t) => {
      const ev = t.evento(E().TIPI.TITOLO_PAGINA, { visita: String(visita), titolo, titoloTagliato: tagliato || undefined }, { autore: 'utente' });
      const { scritti } = await t.scrivi([ev]);
      return scritti.length ? ev : null;
    }, opts);
  }

  function cancellaPagine(periodo, opts) {
    if (!periodo) return Promise.resolve(0);
    return cancella([periodo], opts);
  }

  // Visite tolte ({ ts, sito, url }, o una fila dello stesso sito con { da, a }), in una scrittura sola. `schedeChiuse:
  // false` quando sono proprio le schede chiuse a portarle via (la Cronologia): quelle ancora aperte restano fuori.
  function cancellaVisite(visite, opts, { schedeChiuse = true } = {}) {
    const periodi = (Array.isArray(visite) ? visite : []).filter((p) => p && p.ts)
      .map((p) => ({ da: p.da || p.ts, a: p.a || p.ts, sito: p.sito || '', url: p.url || null }));
    return periodi.length ? cancella(periodi, opts, { schedeChiuse }) : Promise.resolve(0);
  }

  function cancella(periodi, opts, { schedeChiuse = true } = {}) {
    return transazione(async (t) => {
      const voci = periodi.map((periodo) => {
        const sito = periodo.sito ? E().normaSito(periodo.sito) : '';
        return { pagine: { da: periodo.da ?? null, a: periodo.a ?? null, ...(sito ? { sito } : {}) }, url: periodo.url || null };
      });
      // Si dicono le pagine tolte, come la conferma: le azioni e le ricerche che se ne vanno con loro non si contano.
      const { pagine } = await t.scrivi(voci.map((v) => t.evento(E().TIPI.CANCELLAZIONE, { pagine: v.pagine }, { autore: 'utente' })));
      // Il ricordo dei campi password va via per sito, e ogni volta si riscrive: un sito una volta sola («Svuota archivio»).
      const siti = new Set();
      for (const v of voci) {
        const k = v.pagine.sito || `|${v.pagine.da}|${v.pagine.a}`;
        if (!siti.has(k)) { siti.add(k); try { await globalThis.SN_DELICATE?.dimentica(v.pagine); } catch (_) {} }
        if (schedeChiuse) { try { await globalThis.SN_ARCHIVED_TABS?.dimenticaPagine({ ...v.pagine, url: v.url }); } catch (_) {} }
      }
      return pagine;
    }, opts);
  }

  // Per l'esportazione: il filo così com'è sul disco (o, dall'incognito, quello in memoria).
  async function esporta(opts) {
    const incog = inIncognito(opts);
    return inCoda(async () => {
      await caricaPerLeggere();
      if (incog) return Buffer.from(incognito.eventi.map(E().riga).join(''), 'utf8');
      try { return await fsp.readFile(fileEventi()); } catch (e) { if (e.code === 'ENOENT') return Buffer.alloc(0); throw e; }
    });
  }

  // Gli eventi di un export: entrano quelli con un id che qui non c'è, nell'ordine in cui erano. I cambi di stato no:
  // raccontano lo stato di quell'installazione, e annullarne uno qui rimetterebbe valori di là (l'import fa i suoi).
  function importa(testo, opts) {
    return transazione(async (t) => {
      const letti = E().analizza(Buffer.isBuffer(testo) ? testo.toString('utf8') : testo);
      const eventi = letti.eventi.filter((ev) => ev.tipo !== E().TIPI.CAMBIO);
      const { scartate } = letti;
      const { scritti } = await t.scrivi(eventi, { scartaInvalidi: true });
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

  // Le schede chiuse archiviate prima che il filo esistesse entrano alla loro data, una visita per scheda, legata alla
  // sua voce d'archivio (riassunto e vettore restano lì). Si ripete senza doppioni: una scheda già legata, o che ha già
  // una visita del suo indirizzo mentre era aperta, non rientra; una che una cancellazione copre non si scrive.
  function entranoSchedeChiuse(schede, { unaVolta = false } = {}) {
    return transazione(async (t) => {
      if (t.incognito) return 0;
      const segno = path.join(dir(), FILE_SCHEDE_ENTRATE);
      if (unaVolta) { try { await fsp.access(segno); return 0; } catch (_) {} }
      const st = normale.stato;
      const legate = new Set();
      const perUrl = new Map();
      for (const p of st.pagine.values()) {
        if (p.archivio) legate.add(p.archivio);
        if (!perUrl.has(p.url)) perUrl.set(p.url, []);
        perUrl.get(p.url).push(Date.parse(p.ts));
      }
      const eventi = [];
      const ordinate = (Array.isArray(schede) ? schede : [])
        .filter((s) => s && typeof s.id === 'string' && typeof s.url === 'string' && /^(https?|file):/i.test(s.url))
        .map((s) => ({ s, t: Date.parse(s.openedAt) || Date.parse(s.closedAt) }))
        .filter((x) => Number.isFinite(x.t))
        .sort((a, b) => a.t - b.t);
      for (const { s, t: inizio } of ordinate) {
        if (legate.has(s.id)) continue;
        const fine = Date.parse(s.closedAt) || inizio;
        const u = taglia(s.url, MISURA.url);
        const tt = taglia(s.title && s.title !== s.url ? s.title : '', MISURA.titolo);
        const viste = perUrl.get(u.testo) || [];
        if (viste.some((x) => x >= inizio - MARGINE_SCHEDA_MS && x <= fine + MARGINE_SCHEDA_MS)) continue;
        eventi.push(t.evento(E().TIPI.NAVIGAZIONE, {
          url: u.testo, titolo: tt.testo, archivio: s.id,
          urlTagliato: (u.tagliato || s.urlTagliato === true) || undefined, titoloTagliato: (tt.tagliato || s.titleTagliato === true) || undefined,
        }, { autore: 'utente', ts: new Date(inizio).toISOString() }));
      }
      const { scritti } = eventi.length ? await t.scrivi(eventi) : { scritti: [] };
      if (unaVolta) {
        try { await fsp.mkdir(dir(), { recursive: true }); await fsp.writeFile(segno, new Date().toISOString() + '\n', 'utf8'); }
        catch (e) { console.warn('[Filo] segno delle schede chiuse non scritto:', e?.message || e); }
      }
      return scritti.length;
    }, { incognito: false });
  }

  function resetIncognito() {
    incognito = { stato: E().nuovoStato(), eventi: [] };
  }

  async function dispositivo() {
    await caricaPerLeggere();
    if (!normale.dispositivo) normale.dispositivo = await leggiDispositivo();
    return normale.dispositivo;
  }

  // Aspetta che ogni scrittura in fila sia arrivata su disco (prove e chiusura dell'app).
  function quandoFermo() {
    return inCoda(() => {});
  }

  return {
    carica, transazione, chats, chat, perLaCoda, pagine, cambi, accaduti, dove, ultimaDomanda, entranoSchedeChiuse, registraVisita, aggiornaTitolo, cancellaPagine, cancellaVisite, suPagine,
    esporta, importa, importaChatSalvate,
    resetIncognito, dispositivo, quandoFermo, percorso: fileEventi,
    ...(process.env.NODE_ENV === 'test' ? { ricomincia } : {}),
  };
}

const filo = creaFilo();
globalThis.SN_IL_FILO = filo;
module.exports = { ...filo, creaFilo };
