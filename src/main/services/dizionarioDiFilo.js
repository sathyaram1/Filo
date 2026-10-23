// Il dizionario con cui il correttore sa quali parole non conosce (#1585), col motore (dizionarioMotore.js) in un thread:
// caricarlo tiene la CPU per un decimo di secondo, e il processo principale non deve fermarsi. Non sceglie i segni.
// Perché non quello del browser: patterns/il-dizionario-del-correttore-e-di-filo.md; tests/unit/dizionarioDiFilo.test.mjs.

'use strict';

const { Worker } = require('node:worker_threads');
const Motore = require('./dizionarioMotore');

const MOTORE = require.resolve('./dizionarioMotore');
// La pagina che chiede resta ferma finché non ha la risposta: oltre, risponde il browser.
const RISPOSTA_MAX_MS = 5000;
// Un caricamento vero sta sotto il secondo: oltre, il thread è bloccato e il dizionario si carica nel processo.
const CARICA_MAX_MS = 60_000;

const CORPO_THREAD = `
const { parentPort, workerData } = require('node:worker_threads');
require(workerData.motore).carica(workerData.lingue).then((m) => {
  parentPort.on('message', ({ id, tipo, dato }) => {
    let res = null;
    try { res = tipo === 'proposte' ? m.proposte(dato) : m.sbagliate(dato); } catch (_) {}
    parentPort.postMessage({ id, res });
  });
  parentPort.postMessage({ pronto: { lingue: m.lingue, errori: m.errori } });
});
`;

function scegli(locale) {
  if (!globalThis.SN_SPELL_LANG) require('../../shared/spellLanguages.js');
  return globalThis.SN_SPELL_LANG.select(Motore.LINGUE, locale, Motore.LINGUE);
}

const stato = { fase: 'spento', lingue: [], errori: [], dove: '' };
// (tipo, dato) → Promise della risposta, finché il dizionario è pronto.
let chiedi = null;
let promessa = null;
let programmato = null;
let atteso = null;

// Il dizionario si è perso (il thread è morto): la prossima domanda lo ricarica, e intanto risponde il browser.
function perso(motivo) {
  chiedi = null;
  promessa = null;
  stato.fase = 'spento';
  stato.lingue = [];
  stato.errori.push(motivo);
}

// Risolve quando il thread ha caricato quello che poteva; rifiuta se non parte o muore prima.
function nelThread(lingue) {
  return new Promise((resolve, reject) => {
    const w = new Worker(CORPO_THREAD, { eval: true, workerData: { motore: MOTORE, lingue } });
    const attese = new Map();
    let prossimo = 1;
    let pronto = false;
    let finito = false;
    const limite = setTimeout(() => { w.terminate().catch(() => {}); }, CARICA_MAX_MS);
    const domanda = (tipo, dato) => new Promise((ok) => {
      if (finito) { ok(null); return; }
      const id = prossimo++;
      const timer = setTimeout(() => { attese.delete(id); ok(null); }, RISPOSTA_MAX_MS);
      attese.set(id, { ok, timer });
      try { w.postMessage({ id, tipo, dato }); } catch (_) { clearTimeout(timer); attese.delete(id); ok(null); }
    });
    const fine = (motivo) => {
      if (finito) return;
      finito = true;
      clearTimeout(limite);
      for (const a of attese.values()) { clearTimeout(a.timer); a.ok(null); }
      attese.clear();
      if (!pronto) reject(new Error(motivo));
      else if (chiedi === domanda) perso(motivo);
    };
    w.on('message', (msg) => {
      if (msg && msg.pronto) {
        clearTimeout(limite);
        pronto = true;
        if (!msg.pronto.lingue.length) w.terminate().catch(() => {});
        resolve({ lingue: msg.pronto.lingue, errori: msg.pronto.errori, chiedi: domanda });
        return;
      }
      const a = msg && attese.get(msg.id);
      if (!a) return;
      attese.delete(msg.id);
      clearTimeout(a.timer);
      a.ok(msg.res ?? null);
    });
    w.on('error', (e) => fine(`thread: ${e?.message || e}`));
    w.on('exit', () => fine('thread chiuso'));
    // Dopo gli ascoltatori: aggiungerli riaggancia il thread al ciclo e Filo non uscirebbe più.
    w.unref();
  });
}

// `dopoMs`: all'avvio si carica quando la finestra c'è già; una domanda arrivata prima lo fa partire subito.
function prepara({ locale = '', dopoMs = 0 } = {}) {
  if (promessa) return promessa;
  if (dopoMs > 0) {
    if (!programmato) {
      atteso = { locale };
      programmato = setTimeout(avviaSeAtteso, dopoMs);
      programmato.unref?.();
    }
    return null;
  }
  atteso = { locale };
  clearTimeout(programmato);
  programmato = null;
  stato.fase = 'in caricamento';
  promessa = (async () => {
    const lingue = scegli(locale);
    let r = await nelThread(lingue).catch((e) => ({ lingue: [], errori: [e.message] }));
    stato.errori.push(...r.errori);
    stato.dove = 'thread';
    if (!r.lingue.length) {
      // Senza il thread il motore si carica qui: meglio il processo fermo un decimo di secondo che nessun dizionario.
      const m = await Motore.carica(lingue);
      stato.errori.push(...m.errori);
      r = { lingue: m.lingue, chiedi: async (tipo, dato) => (tipo === 'proposte' ? m.proposte(dato) : m.sbagliate(dato)) };
      stato.dove = 'processo';
    }
    chiedi = r.lingue.length ? r.chiedi : null;
    stato.lingue = r.lingue.slice();
    stato.fase = r.lingue.length ? 'pronto' : 'guasto';
    if (stato.errori.length) console.warn('[Filo] dizionario del correttore:', stato.errori.join('; '));
    return stato.fase === 'pronto';
  })();
  return promessa;
}

function avviaSeAtteso() {
  if (!promessa && atteso) prepara({ locale: atteso.locale });
}

function domanda(tipo, dato) {
  if (!chiedi) { avviaSeAtteso(); return Promise.resolve(null); }
  return chiedi(tipo, dato);
}

/** Per ogni parola, se nessuna lingua la conosce; `null` finché il dizionario non è pronto (o non si è caricato). */
function sbagliate(parole) {
  if (!Array.isArray(parole) || parole.length > Motore.RICHIESTA_MAX) return Promise.resolve(null);
  return domanda('sbagliate', parole);
}

/** Le correzioni, alternate fra le lingue come fa Chromium; `null` finché il dizionario non è pronto. */
function proposte(parola) {
  return domanda('proposte', parola);
}

function descrivi() {
  return { fase: stato.fase, lingue: stato.lingue.slice(), errori: stato.errori.slice(), dove: stato.dove };
}

module.exports = { prepara, sbagliate, proposte, stato: descrivi, scegli, LINGUE: Motore.LINGUE };
