// Il registro dei cambi (#867): ogni scrittura dello stato (impostazioni, timer e sveglie, regole del
// proxy) diventa un evento del filo nel momento in cui si salva, chiunque l'abbia chiesta. Chi chiede
// dichiara solo da dove viene (`con`). Frasi, esclusioni e annullo: src/shared/cambi.js.

const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const Disco = require('../shim/storage');

const provenienze = new AsyncLocalStorage();
const K = () => globalThis.SN_CAMBI;
const CHIAVI = () => globalThis.SN_CONST.STORAGE_KEYS;

// Quello che il registro deve far fare al resto dell'app per annullare: lo passa handlers.js.
const app = {
  applicaImpostazioni: null,
  aggiornaVivo: () => {},
  aggiornaRegoleProxy: () => {},
  zoomSu: null,
  annuncia: () => {},
};
function collega(f) { Object.assign(app, f || {}); }

// `prov`: { via: 'chat'|'assistente'|'interfaccia'|'pagina'|'importazione'|'filo', dove?, annulla? }.
// `raccolti`, se c'è, riceve ogni evento nato dentro `fn`, anche nei contesti annidati.
function con(prov, fn) {
  const padre = provenienze.getStore() || null;
  return provenienze.run({ ...prov, padre }, fn);
}
function corrente() {
  return provenienze.getStore() || null;
}

function nuovoId() {
  return `c${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

// Una coda per lato: le scritture del disco e quelle dell'incognito non si mescolano mai.
const code = { normale: Promise.resolve(), incognito: Promise.resolve() };
function inCoda(incognito, lavoro) {
  const lato = incognito ? 'incognito' : 'normale';
  const corri = () => (incognito ? Disco.runIncognito(lavoro) : Disco.runNormale(lavoro));
  const p = code[lato].then(corri, corri);
  code[lato] = p.then(() => {}, () => {});
  return p;
}
function attesa() {
  return Promise.all([code.normale, code.incognito]);
}

async function leggiLista() {
  const r = await globalThis.chrome.storage.local.get(CHIAVI().FILO_CAMBI);
  const l = r && r[CHIAVI().FILO_CAMBI];
  return Array.isArray(l) ? l : [];
}

function raccogli(ctx, evento) {
  const voce = { id: evento.id, frase: K().frase(evento), tipo: evento.tipo };
  for (let c = ctx; c; c = c.padre) if (Array.isArray(c.raccolti)) c.raccolti.push(voce);
}

function registra({ tipo, cambi }, { incognito = Disco.inIncognito() } = {}) {
  if (!Array.isArray(cambi) || !cambi.length) return null;
  const ctx = corrente();
  const p = ctx || { via: 'filo' };
  const evento = {
    id: nuovoId(),
    ts: new Date().toISOString(),
    tipo,
    via: p.via || 'filo',
    ...(p.dove ? { dove: p.dove } : {}),
    ...(p.annulla ? { annulla: p.annulla } : {}),
    cambi,
  };
  raccogli(ctx, evento);
  inCoda(incognito, async () => {
    const lista = await leggiLista();
    const ultimo = lista[lista.length - 1];
    let nuova;
    if (K().fondibile(ultimo, evento)) {
      const fuso = K().fondi(ultimo, evento);
      nuova = fuso ? [...lista.slice(0, -1), fuso] : lista.slice(0, -1);
    } else {
      nuova = [...lista, evento];
    }
    await globalThis.chrome.storage.local.set({ [CHIAVI().FILO_CAMBI]: nuova });
  }).then(() => app.annuncia([evento.id])).catch((e) => console.warn('[Filo cambi] evento non salvato:', e?.message || e));
  return evento;
}

// Gira dentro set(), prima che la scrittura avvenga: vede il valore vecchio e quello nuovo.
function osserva(changes, { incognito }) {
  const C = CHIAVI();
  const adesso = Date.now();
  const s = changes[C.SETTINGS];
  // Una scrittura che toglie le impostazioni intere è la cancellazione dei dati (ESCLUSIONI.azzeramento).
  if (s && s.newValue && typeof s.newValue === 'object') {
    const cambi = K().cambiImpostazioni(s.oldValue, s.newValue, globalThis.SN_STORAGE.normalizza);
    registra({ tipo: 'impostazioni', cambi }, { incognito });
  }
  const t = changes[C.FILO_TIMERS];
  if (t && Array.isArray(t.newValue)) registra({ tipo: 'timer', cambi: K().cambiTimer(t.oldValue, t.newValue, adesso) }, { incognito });
  const r = changes[C.FILO_PROXY_RULES];
  if (r && r.newValue && typeof r.newValue === 'object') registra({ tipo: 'proxy', cambi: K().cambiRegoleProxy(r.oldValue, r.newValue) }, { incognito });
}

let staccato = null;
function avvia() {
  if (!staccato) staccato = Disco.onScrittura(osserva);
}

// Lo zoom non passa dallo storage: lo salva Chromium per sito. Il punto in cui il main lo viene a
// sapere (tabs.js) è il suo salvataggio.
function registraZoom({ host, prima, dopo }, { incognito } = {}) {
  const a = Math.round(Number(prima));
  const b = Math.round(Number(dopo));
  if (!host || !Number.isFinite(a) || !Number.isFinite(b) || a === b) return null;
  return registra({ tipo: 'zoom', cambi: [{ chiave: `zoom:${host}`, prima: a, dopo: b }] }, { incognito: incognito ?? Disco.inIncognito() });
}

function vista(e, lista) {
  const chiusi = K().annullati(lista);
  return {
    id: e.id,
    ts: e.agg || e.ts,
    tipo: e.tipo,
    frasi: K().frasi(e),
    frase: K().frase(e),
    provenienza: K().provenienza(e),
    annulla: e.annulla || null,
    annullatoDa: chiusi.get(e.id) || null,
    annullabile: K().annullabile(e),
  };
}

// Letti nel contesto di chi chiede: una pagina incognito vede i suoi, mai quelli del disco.
async function leggi(ids) {
  await attesa();
  const lista = await leggiLista();
  const voluti = new Set((Array.isArray(ids) ? ids : []).map(String));
  return lista.filter((e) => voluti.has(e.id)).map((e) => vista(e, lista));
}

async function ultimi({ max = 40 } = {}) {
  await attesa();
  const lista = await leggiLista();
  return { eventi: lista, ...K().righePerModello(lista, { max }) };
}

async function livelloDi(id) {
  await attesa();
  const lista = await leggiLista();
  const e = bersaglio(lista, id);
  return e ? { livello: K().livello(e), frase: K().frase(e), id: e.id } : null;
}

// Senza id: l'ultimo cambio ancora in piedi che non sia a sua volta un annullo.
function bersaglio(lista, id) {
  if (id) return lista.find((e) => e.id === id) || null;
  const chiusi = K().annullati(lista);
  for (let i = lista.length - 1; i >= 0; i--) {
    const e = lista[i];
    if (!e.annulla && !chiusi.has(e.id) && K().annullabile(e)) return e;
  }
  return null;
}

// Rimette com'era lo stato toccato dall'evento. L'annullo è a sua volta un evento: lo scrive il
// salvataggio, come ogni altro, col segno di chi annulla.
async function annulla(id, prov = {}) {
  await attesa();
  const lista = await leggiLista();
  const e = bersaglio(lista, id ? String(id) : null);
  if (!e) return { ok: false, motivo: id ? 'cambio non trovato' : 'nessun cambio da annullare' };
  if (K().annullati(lista).has(e.id)) return { ok: false, motivo: 'già annullato', id: e.id };
  if (!K().annullabile(e)) return { ok: false, motivo: 'il valore di prima non è conservato (è un segreto)', id: e.id };
  const raccolti = [];
  let saltati = [];
  let riuscito = true;
  await con({ via: prov.via || 'interfaccia', ...(prov.dove ? { dove: prov.dove } : {}), annulla: e.id, raccolti }, async () => {
    if (e.tipo === 'impostazioni') {
      const correnti = await globalThis.SN_STORAGE.getSettings();
      const parziale = K().annulloImpostazioni(e, correnti, globalThis.SN_STORAGE.REPLACE_KEYS);
      if (app.applicaImpostazioni) await app.applicaImpostazioni(parziale);
      else await globalThis.SN_STORAGE.updateSettings(parziale);
    } else if (e.tipo === 'timer') {
      const FM = globalThis.SN_FILO_MEMORY;
      const r = K().annulloTimer(e, await FM.listTimers());
      saltati = r.saltati;
      await FM.setRaw(CHIAVI().FILO_TIMERS, r.lista);
      app.aggiornaVivo();
    } else if (e.tipo === 'proxy') {
      const FM = globalThis.SN_FILO_MEMORY;
      await FM.setRaw(CHIAVI().FILO_PROXY_RULES, K().annulloRegoleProxy(e, await FM.listProxyRules()));
      app.aggiornaRegoleProxy();
    } else if (e.tipo === 'zoom') {
      const c = e.cambi[0];
      riuscito = !!(app.zoomSu && await app.zoomSu(String(c.chiave).slice(5), c.prima));
    }
    // Lo stato era già quello di prima (rimesso a mano nel frattempo): l'annullo resta come evento.
    if (riuscito && !raccolti.length) registra({ tipo: e.tipo, cambi: [] }, {});
  });
  if (!riuscito) return { ok: false, motivo: 'la pagina di quel sito non è aperta', id: e.id };
  return { ok: true, id: e.id, frase: K().frase(e), eventi: raccolti, saltati };
}

module.exports = { avvia, con, corrente, registra, registraZoom, leggi, ultimi, livelloDi, annulla, collega, attesa };
globalThis.SN_REGISTRO_CAMBI = module.exports;
