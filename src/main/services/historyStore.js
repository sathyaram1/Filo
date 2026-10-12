// Cronologia delle richieste ai modelli: una voce per chiamata, in file propri (userData/cronologia-ai), senza tetto.
// Non sta in storage.json, che si riscrive intero a ogni modifica; le voci nate in incognito restano in RAM.
// Regole: patterns/un-archivio-che-cresce-sta-in-file-suoi-a-sole-aggiunte.md; prove: tests/unit/historyStore.test.mjs, tests/ai-history-store.spec.mjs.

(function (global) {
  'use strict';

  const path = require('node:path');
  const { creaDeposito } = require('./depositoAggiunte');
  const Disco = require('../shim/storage');

  // Dove la cronologia stava in storage.json: serve alla migrazione, e il backup la rimette sotto questa chiave.
  const CHIAVE = global.SN_CONST.STORAGE_KEYS.HISTORY;

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function cartella() {
    const root = process.env.FILO_USER_DATA || require('electron').app.getPath('userData');
    return path.join(root, 'cronologia-ai');
  }

  function meseDi(it) {
    const d = new Date(it && it.timestamp);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 7);
  }

  // Campi voluminosi che non hanno valore storico: lo screenshot del flusso Aiuto è un data URL da centinaia di KB per turno.
  function sanitizeInput(input) {
    if (!input || typeof input !== 'object') return input || {};
    const out = { ...input };
    delete out.screenshot;
    // Il tratto del filo davanti alla chat (#868) è fino a 100.000 token, ed è già nel filo: qui ne resta la misura.
    if (Array.isArray(out.filoTratto)) {
      const caratteri = out.filoTratto.reduce((n, m) => n + testoDi(m && m.content).length, 0);
      const immagini = out.filoTratto.reduce((n, m) => n + (Array.isArray(m && m.content) ? m.content.filter((p) => p && p.type === 'image_url').length : 0), 0);
      out.filoTratto = { messaggi: out.filoTratto.length, caratteri, ...(immagini ? { immagini } : {}) };
    }
    return out;
  }

  // Le voci che entrano da un'altra strada (storage.json di prima, un backup) passano dalla stessa pulizia dell'append.
  const ripulita = (it) => (it.input && typeof it.input === 'object' ? { ...it, input: sanitizeInput(it.input) } : it);
  const isVoce = (it) => it && typeof it === 'object' && !Array.isArray(it);

  // Come l'overlay di storage.json per le altre chiavi: si vede solo dall'incognito e sparisce con la sua ultima finestra.
  let dellIncognito = [];

  // Si apre fuori dall'incognito anche se a chiederlo è una sua finestra: lì la vista di storage.json è vuota.
  let apertura = null;
  function apri() {
    if (!apertura) {
      apertura = (async () => {
        const d = creaDeposito({ cartella: cartella(), meseDi });
        await d.carica();
        await Disco.fuoriDaIncognito(() => migra(d));
        return d;
      })();
      apertura.catch(() => { apertura = null; });
    }
    return apertura;
  }

  // La chiave vecchia si toglie solo dopo che le voci sono nei file nuovi: un arresto a metà rifà la migrazione,
  // e gli id già presenti non si duplicano.
  async function migra(d) {
    const res = await chrome.storage.local.get(CHIAVE);
    const vecchia = res && res[CHIAVE];
    if (vecchia === undefined) return;
    const visti = new Set();
    const voci = [];
    for (const it of Array.isArray(vecchia) ? vecchia : []) {
      if (!isVoce(it)) continue;
      const id = typeof it.id === 'string' && it.id && !visti.has(it.id) ? it.id : uuid();
      visti.add(id);
      voci.push(ripulita(id === it.id ? it : { ...it, id }));
    }
    d.aggiungiMolti(voci, { inCoda: true });
    await chrome.storage.local.remove(CHIAVE);
  }

  async function list() {
    if (Disco.inIncognito()) return dellIncognito.slice();
    return (await apri()).tutti();
  }

  async function append(entry) {
    const e = isVoce(entry) ? entry : {};
    const full = {
      id: uuid(),
      timestamp: new Date().toISOString(),
      action: e.action,
      provider: e.provider,
      model: e.model,
      // Chi ha DAVVERO servito la risposta upstream (#421), quando il provider lo riporta: la controprova della politica
      // sui fornitori. Per voce e dettatura arriva dopo, via patch.
      servedBy: e.servedBy || null,
      // Servita da un fornitore escluso: la prova resta sulla voce, non solo in un log che nessuno riapre.
      policyViolation: e.policyViolation === true,
      input: sanitizeInput(e.input),
      output: e.output || '',
      origin: e.origin || '',
      costEur: e.costEur || 0,
      usage: e.usage || null,
      // Tempi del turno (ms dalla partenza): primo ragionamento, prima parola, prima azione, fine.
      timing: (e.timing && typeof e.timing === 'object') ? e.timing : null,
    };
    if (Disco.inIncognito()) {
      dellIncognito.unshift(full);
      return full;
    }
    try {
      return (await apri()).aggiungi(full) || full;
    } catch (e) {
      nonSalvata(e);
      return full;
    }
  }

  // Chi scrive la cronologia sta consegnando una risposta già pagata: un disco pieno o un file bloccato perde la voce, mai la risposta.
  function nonSalvata(e) {
    console.warn('[Filo cronologia AI] voce non salvata:', (e && e.message) || e);
  }

  // Una voce sola, senza svuotare tutto: il suo mese si riscrive, e il testo sparisce dal disco.
  async function remove(id) {
    if (Disco.inIncognito()) {
      dellIncognito = dellIncognito.filter((it) => it.id !== id);
      return dellIncognito.slice();
    }
    const d = await apri();
    d.togli([id]);
    return d.tutti();
  }

  // Pochi campi di una voce già scritta («chi ha servito» delle chiamate audio arriva secondi dopo): una riga in coda.
  async function patch(id, fields) {
    if (!id || !fields || typeof fields !== 'object') return null;
    const i = dellIncognito.findIndex((it) => it.id === id);
    if (i >= 0) {
      dellIncognito[i] = { ...dellIncognito[i], ...fields };
      return dellIncognito[i];
    }
    if (Disco.inIncognito()) return null;
    try {
      return (await apri()).aggiorna(id, fields);
    } catch (e) {
      nonSalvata(e);
      return null;
    }
  }

  async function clear() {
    if (Disco.inIncognito()) { dellIncognito = []; return; }
    (await apri()).svuota();
  }

  // Riscrive le voci che `fn` cambia (una chat cancellata toglie il suo testo, #866): costi e tempi restano, e il testo
  // tolto non resta su disco in una riga di prima.
  async function redigi(fn) {
    let cambiate = 0;
    dellIncognito = dellIncognito.map((it) => { const n = fn(it); if (n && n !== it) { cambiate++; return n; } return it; });
    if (Disco.inIncognito()) return cambiate;
    return cambiate + (await apri()).riscrivi(fn);
  }

  // Un backup: entrano le voci che mancano, dietro alle presenti. Ritorna quante ne sono entrate.
  async function importa(lista) {
    if (!Array.isArray(lista)) return 0;
    const voci = lista.filter(isVoce).map((it) => ripulita(typeof it.id === 'string' && it.id ? it : { ...it, id: uuid() }));
    if (Disco.inIncognito()) {
      const presenti = new Set(dellIncognito.map((it) => it.id));
      const nuove = voci.filter((it) => !presenti.has(it.id) && presenti.add(it.id));
      dellIncognito.push(...nuove);
      return nuove.length;
    }
    return (await apri()).aggiungiMolti(voci, { inCoda: true }).length;
  }

  function resetIncognito() {
    dellIncognito = [];
  }

  // All'avvio, in sottofondo: la migrazione e la lettura dei file non aspettano la prima richiesta.
  function prepara() {
    return Disco.inIncognito() ? Promise.resolve() : apri().then(() => {});
  }

  // La pagina mostra dell'ingresso un estratto (gli stessi campi di formatInput in pages/history/history.js):
  // il testo della pagina e i messaggi interi non attraversano l'IPC.
  const ESTRATTO = 1000;
  function vistaPagina(it) {
    if (!isVoce(it)) return it;
    const inp = it.input;
    if (typeof inp === 'string') return { ...it, input: inp.slice(0, ESTRATTO) };
    if (!isVoce(inp)) return it;
    const breve = {};
    for (const k of ['selection', 'title', 'url']) if (inp[k]) breve[k] = String(inp[k]).slice(0, ESTRATTO);
    const domanda = domandaDi(inp);
    if (domanda) breve.userMessage = domanda.slice(0, ESTRATTO);
    return { ...it, input: breve };
  }

  // Quello che l'utente ha chiesto, ovunque la richiesta lo tenga: una voce della chat lo ha fra i messaggi del turno.
  function domandaDi(inp) {
    if (inp.userMessage) return String(inp.userMessage);
    if (inp.instruction) return String(inp.instruction);
    const giro = Array.isArray(inp.threadMessages) ? inp.threadMessages : Array.isArray(inp.messages) ? inp.messages : [];
    const i = Number.isInteger(inp.indiceDomanda) && giro[inp.indiceDomanda] && giro[inp.indiceDomanda].role === 'user'
      ? inp.indiceDomanda
      : giro.map((m) => m && m.role).lastIndexOf('user');
    return i >= 0 ? testoDi(giro[i].content) : '';
  }

  function testoDi(c) {
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.filter((p) => p && p.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('\n');
    return '';
  }

  global.SN_HISTORY = {
    list, append, patch, remove, clear, redigi, importa, prepara, resetIncognito, vistaPagina, cartella,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
