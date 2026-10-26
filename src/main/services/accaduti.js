// Gli accaduti del filo (#1561): la porta da cui azioni, schede, ricerche, download, documenti dell'editor, timer,
// avvisi e sistema entrano nel filo. La chiama chi scrive quello stato, una volta sola; cosa diventa evento sta in
// src/shared/filoAccaduti.js, la forma in src/shared/filoEventi.js. Sentinella: tests/unit/filoAccaduti.test.mjs.

'use strict';

const Disco = require('../shim/storage');

const E = () => globalThis.SN_FILO_EVENTI;
const A = () => globalThis.SN_FILO_ACCADUTI;
const Filo = () => require('./ilFilo');
const T = () => E().TIPI;
const stringa = (s) => typeof s === 'string' && s.length > 0;
const CHIAVE_EDITOR = 'filo.editor.collection';

// Da dove viene la richiesta in corso (chat, Aiuto, interfaccia, pagina): la stessa che segna i cambi. Senza, nessuno.
function provenienza() {
  try {
    const c = require('./registroCambi').corrente();
    return c && stringa(c.via) ? c.via : null;
  } catch (_) { return null; }
}

// `incognito` lo dice chi lo sa (la scheda, la sessione del download); senza, vale il contesto della richiesta.
// `daSola`: chi l'ha fatto quando nessuno l'ha chiesto (il riordino delle schede che parte da sé).
function annota(tipo, campi, { incognito, via, autore, daSola, id, ts } = {}) {
  const incog = incognito == null ? Disco.inIncognito() : !!incognito;
  const v = via === undefined ? provenienza() : via;
  const chi = autore || (v ? E().autoreDi(v) : (daSola || 'utente'));
  const voce = { tipo, campi: { ...campi, ...(v ? { via: v } : {}) }, opz: { autore: chi, id, ts: ts || new Date().toISOString() } };
  // Uno fuori formato non porta giù gli altri della stessa scrittura, e chi l'ha mandato lo sa.
  const p = E().valido(E().crea(tipo, voce.campi, { ...voce.opz, dispositivo: 'prova' }))
    ? inFila(incog, voce) : Promise.reject(new Error(`evento del filo fuori formato: ${tipo}`));
  p.catch((e) => console.warn(`[Filo] ${tipo} non entrato nel filo:`, e?.message || e));
  return p;
}

// Quello che succede insieme (una scheda aperta e portata davanti, una chiusa e quella che torna davanti) va sul
// disco in una scrittura sola: ogni scrittura del filo aspetta il disco, e le visite e le chat aspettano dietro.
const file = { normale: null, incognito: null };
function inFila(incog, voce) {
  const lato = incog ? 'incognito' : 'normale';
  if (!file[lato]) {
    const giro = { voci: [] };
    giro.fatto = new Promise((r) => setImmediate(r)).then(() => {
      file[lato] = null;
      return Filo().transazione((t) => t.scrivi(giro.voci.map((x) => t.evento(x.tipo, x.campi, x.opz))), { incognito: incog });
    });
    file[lato] = giro;
  }
  file[lato].voci.push(voce);
  return file[lato].fatto;
}

// Il sito da cui è arrivato il file su cui un'azione lavora (uno scaricamento, per id o percorso): l'azione se ne va con
// le pagine di quel sito. Si chiede PRIMA di fare la cosa: rinominato, il file non ha più il percorso con cui è stato chiesto.
function indirizzoDelFile(parametri) {
  const chiesti = [];
  const giro = (v, k, prof) => {
    if (typeof v === 'string') {
      const s = v.trim();
      if (k === 'scaricamento') chiesti.push({ id: s });
      else if (/^(~[\\/]|\/|[a-z]:[\\/]|\\\\)/i.test(s)) chiesti.push({ percorso: s.replace(/^~(?=[\\/])/, () => require('node:os').homedir()) });
    } else if (prof < 3 && v && typeof v === 'object') {
      for (const [kk, x] of Object.entries(v)) giro(x, Array.isArray(v) ? k : kk, prof + 1);
    }
  };
  giro(parametri, '', 0);
  if (!chiesti.length) return '';
  try {
    const D = require('./downloads');
    for (const q of chiesti) { const u = D.indirizzoDi(q); if (u) return u; }
  } catch (_) {}
  return '';
}

// Un'azione di Filo con quello che le è stato chiesto e com'è andata. I segreti che Filo custodisce non arrivano sul
// disco nemmeno qui: escono oscurati come verso i modelli. `url`: il sito del file scaricato, chiesto prima di farla.
function azione(action, res, { via, chatId, fatto = '', segreti = [], incognito, url } = {}) {
  if (!action || !stringa(action.type)) return Promise.resolve(null);
  const parametri = A().parametriAzione(action);
  const sito = stringa(url) ? url : indirizzoDelFile(parametri);
  let campi = {
    nome: action.type,
    parametri,
    esito: A().esitoAzione(res, { fatto: A().perSempre(action) ? '' : fatto, cambi: res && res.cambi }),
    ...(stringa(chatId) ? { chat: chatId } : {}),
    ...(sito ? { url: sito } : {}),
  };
  const G = globalThis.SN_GUARDIANO_STATICO;
  if (G && typeof G.oscuraSegreti === 'function' && segreti.length) campi = G.oscuraSegreti(campi, segreti);
  return annota(T().AZIONE, campi, { via, incognito });
}

// Volume, Wi-Fi e Bluetooth nascono nella porta che la chat e i tasti della home condividono (#874): lo stesso evento
// per le due strade. `segnoAzione` dice a executeFiloAction che l'azione nel filo c'è già.
const NOMI_SISTEMA = { volume: 'VOLUME', wifi: 'WIFI', bluetooth: 'BLUETOOTH' };
function comandoSistema(richiesta, r) {
  const q = richiesta && typeof richiesta === 'object' ? richiesta : {};
  const { cosa, ...parametri } = A().parametriAzione(q);
  const esito = { eseguita: !!(r && r.ok === true) };
  if (r && stringa(r.frase)) esito[esito.eseguita ? 'fatto' : 'errore'] = r.frase;
  return azioneFatta(NOMI_SISTEMA[String(cosa || '').toLowerCase()] || 'COMANDO_SISTEMA', parametri, esito);
}

// L'azione scritta dal punto che la fa, quando chat e tasti di Filo ci passano tutti e due: dentro un'azione chiesta
// alla chat prende la sua chat e le dice che il segno c'è già.
function azioneFatta(nome, parametri, esito, { incognito } = {}) {
  let ctx = null;
  try { ctx = require('./registroCambi').corrente(); } catch (_) {}
  let chat;
  for (let c = ctx; c; c = c.padre) {
    if (!chat && stringa(c.chat)) chat = c.chat;
    if (c.segnoAzione) { c.segnoAzione.scritta = true; break; }
  }
  return annota(T().AZIONE, { nome, parametri: parametri || {}, esito, ...(chat ? { chat } : {}) }, { incognito });
}

// L'azione scritta dal punto che fa la cosa (apre il file, gli dà un nome, instrada la scheda), chiunque ci arrivi: un
// tasto, un avviso, Filo da sé. Dentro un'azione chiesta alla chat o all'Aiuto non scrive: la sua porta la scrive intera.
// `daSola`: l'autore quando nessuno l'ha chiesta (il nome dato da sé a uno scaricamento), qualunque sia il contesto.
// `chat`: la conversazione da cui è nata (se ne va con lei). `url`: il sito del file, se chi chiama l'ha chiesto prima.
function azioneDalPunto(nome, parametri, esito, { incognito, daSola, chat, url } = {}) {
  let ctx = null;
  try { ctx = require('./registroCambi').corrente(); } catch (_) {}
  for (let c = ctx; c; c = c.padre) if (c.segnoAzione) return Promise.resolve(null);
  const chi = daSola ? { via: null, autore: daSola } : {};
  const sito = stringa(url) ? url : indirizzoDelFile(parametri);
  return annota(T().AZIONE, { nome, parametri: parametri || {}, esito, ...(stringa(chat) ? { chat } : {}), ...(sito ? { url: sito } : {}) },
    { incognito, ...chi });
}
// L'esito di un'apertura come lo dà chi apre: `{ ok }`, o il perché no, o la domanda prima di eseguire un programma.
function fileAperto(parametri, r, opz) {
  const x = r && typeof r === 'object' ? r : {};
  const esito = { eseguita: x.ok === true };
  if (x.needsConfirm) esito.chiede = 'conferma';
  const errore = [x.error, x.frase].find(stringa);
  if (!esito.eseguita && !esito.chiede && errore) esito.errore = errore;
  return azioneDalPunto('APRI_FILE', parametri, esito, opz);
}

// Le schede: quale, e se è una pagina di Filo quale (le pagine dei siti stanno nelle visite, che si cancellano).
function interna(url) {
  return typeof url === 'string' && /^filo:\/\//i.test(url) ? url : undefined;
}
function schedaAperta(tab, { incognito, davanti = false } = {}) {
  if (!tab || !stringa(tab.id)) return Promise.resolve(null);
  return annota(T().SCHEDA_APERTA, { scheda: tab.id, davanti: !!davanti, interna: interna(tab.url) }, { incognito });
}
function schedaChiusa(tab, { incognito, come, daSola } = {}) {
  if (!tab || !stringa(tab.id)) return Promise.resolve(null);
  return annota(T().SCHEDA_CHIUSA, { scheda: tab.id, come: stringa(come) ? come : undefined, interna: interna(tab.url) },
    { incognito, daSola });
}
function schedaDavanti(tab, { incognito } = {}) {
  if (!tab || !stringa(tab.id)) return Promise.resolve(null);
  return annota(T().SCHEDA_DAVANTI, { scheda: tab.id, interna: interna(tab.url) }, { incognito });
}

// Una ricerca che Filo fa sul web, per la chat o per l'Aiuto: le parole vengono dalla chat, e se ne vanno con lei.
// Quelle sui siti le scrive la visita (ilFilo.js).
function ricerca({ testo, motore, risultati }) {
  const q = String(testo || '').trim();
  if (!q) return Promise.resolve(null);
  let chat;
  try { const c = require('./registroCambi').corrente(); if (c && stringa(c.chat)) chat = c.chat; } catch (_) {}
  return annota(T().RICERCA, {
    testo: q, dove: 'web', motore: stringa(motore) ? motore : undefined, risultati: Number.isFinite(risultati) ? risultati : undefined, chat,
  });
}

// Inizio e fine di un download (una volta ciascuno: lo garantisce chi chiama, downloads.js).
const STATI_DOWNLOAD = { progressing: 'iniziato', pending: 'iniziato', completed: 'finito', cancelled: 'annullato', interrupted: 'interrotto' };
function download(rec, { incognito } = {}) {
  if (!rec || rec.id == null) return Promise.resolve(null);
  const stato = STATI_DOWNLOAD[rec.state] || String(rec.state || 'iniziato');
  return annota(T().DOWNLOAD, {
    scaricamento: String(rec.id), stato, file: String(rec.filename || ''),
    url: stringa(rec.url) ? rec.url : undefined,
    ...(stato === 'finito' && Number.isFinite(rec.totalBytes) && rec.totalBytes > 0 ? { byte: rec.totalBytes } : {}),
  }, { incognito, via: null, autore: 'utente' });
}

// Un timer o una sveglia che suona. L'id dice quale scadenza: suonato prima di chiudere Filo e ancora acceso alla
// riapertura, non suona due volte nel filo.
function timerScattato(t, { incognito } = {}) {
  if (!t || !stringa(t.id)) return Promise.resolve(null);
  return annota(T().TIMER_SCATTATO, {
    timer: t.id, nome: String(t.label || ''), genere: t.kind === 'alarm' ? 'sveglia' : 'timer',
  }, { incognito, via: null, autore: 'automazione', id: `timer:${t.id}:${t.endsAt || ''}` });
}

// Un avviso di Filo nella home (aggiornamento pronto, crediti finiti…). `url`: l'indirizzo da cui nasce (lo
// scaricamento, il sito bloccato), che lo fa andare via con le pagine di quel sito.
function notifica(n, { incognito } = {}) {
  if (!n || !stringa(n.text)) return Promise.resolve(null);
  return annota(T().NOTIFICA, {
    testo: n.text, genere: stringa(n.kind) ? n.kind : undefined, notifica: stringa(n.id) ? n.id : undefined,
    url: stringa(n.url) && /^https?:\/\//i.test(n.url) ? n.url : undefined,
  }, { incognito, via: null, autore: 'filo' });
}

// Gli avvisi brevi che Filo manda dentro la pagina (`pagina`): uno per avviso, anche quando arriva a più schede.
const avvisiVisti = new WeakSet();
function avviso(testo, genere, { messaggio } = {}) {
  if (messaggio && typeof messaggio === 'object') {
    if (avvisiVisti.has(messaggio)) return Promise.resolve(null);
    avvisiVisti.add(messaggio);
  }
  return notifica({ text: String(testo || '').trim(), kind: genere });
}

// Ogni avviso che la cornice mostra entra da qui, chiunque l'abbia mandato (il main, la cornice stessa): lo stesso testo
// mostrato insieme da più finestre è un avviso solo.
const STESSO_AVVISO_MS = 3000;
const ultimiInCornice = new Map();
function avvisoInCornice(testo, { incognito = false, url } = {}) {
  const t = String(testo || '').trim();
  if (!t) return Promise.resolve(null);
  const k = `${incognito ? 'i' : 'n'}|${t}`;
  const ora = Date.now();
  for (const [x, ts] of ultimiInCornice) if (ora - ts > STESSO_AVVISO_MS) ultimiInCornice.delete(x);
  if (ultimiInCornice.has(k)) return Promise.resolve(null);
  ultimiInCornice.set(k, ora);
  return notifica({ text: t, kind: 'finestra', url }, { incognito });
}

// Il computer: rete caduta o tornata, batteria sotto una soglia, Bluetooth collegato. Vale per tutte le finestre.
function sistema(prima, dopo) {
  const cambi = A().cambiSistema(prima, dopo);
  return Promise.all(cambi.map((c) => annota(T().SISTEMA, c, { incognito: false, via: null, autore: 'automazione' })));
}

// I documenti dell'editor si scrivono tutti nella sua collezione: la scrittura dice cosa è stato aperto, scritto,
// creato, rinominato o tolto, chiunque l'abbia fatta (l'editor, Filo con un appunto).
const raffiche = { normale: new Map(), incognito: new Map() };
function osservaEditor(changes, { incognito }) {
  const c = changes && changes[CHIAVE_EDITOR];
  if (!c) return;
  const eventi = A().cambiEditor(c.oldValue, c.newValue, { raffiche: raffiche[incognito ? 'incognito' : 'normale'] });
  for (const ev of eventi) annota(T().FILE, ev, { incognito });
}

let staccato = null;
function avvia() {
  if (!staccato) staccato = Disco.onScrittura(osservaEditor, [CHIAVE_EDITOR]);
}

function attesa() {
  return Filo().quandoFermo();
}

module.exports = {
  annota, azione, indirizzoDelFile, comandoSistema, azioneFatta, azioneDalPunto, fileAperto, schedaAperta, schedaChiusa, schedaDavanti, ricerca, download, timerScattato, notifica, avviso, avvisoInCornice, sistema, avvia, attesa,
};
globalThis.SN_ACCADUTI = module.exports;
