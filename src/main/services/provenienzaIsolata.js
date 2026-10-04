// La lettura delle etichette d'origine (#711) in un thread a parte, con un tempo e una memoria massimi.
// I byte li sceglie chi ha fatto il file: uno costruito apposta non deve fermare né chiudere Filo (#946).
// Il lettore è src/shared/provenienzaImmagine.js; qui c'è solo il recinto.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

// Un'immagine vera da 64 MB si legge in qualche centinaio di millisecondi.
const TEMPO_MAX_MS = 10_000;
const MEMORIA_MB = 512;

// Il sorgente si passa come testo: un thread che legge un percorso dentro l'archivio dell'app impacchettata non è garantito.
const CORPO_THREAD = `
const { parentPort } = require('node:worker_threads');
let versione = null;
let ancore = null;
let ancoreTsa = null;
parentPort.on('message', ({ id, byte, elenco }) => {
  try {
    const P = globalThis.SN_PROVENIENZA;
    if (elenco && elenco.versione !== versione) {
      versione = elenco.versione;
      const a = P.ancoreDaPem(elenco.pem);
      const t = P.ancoreDaPem(elenco.pemTsa);
      ancore = a.length ? a : null;
      ancoreTsa = t.length ? t : null;
    }
    parentPort.postMessage({ id, res: P.analizza(byte, { ancore, ancoreTsa }) });
  } catch (e) {
    parentPort.postMessage({ id, errore: String((e && e.message) || e) });
  }
});
`;

let codice = '';
let thread = null;
let prossimo = 1;
const attese = new Map();

function codiceThread() {
  if (!codice) {
    const sorgente = fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'provenienzaImmagine.js'), 'utf8');
    codice = sorgente + '\n' + CORPO_THREAD;
  }
  return codice;
}

function abbandona(w, motivo) {
  if (thread === w) thread = null;
  for (const [id, a] of attese) {
    if (a.w !== w) continue;
    attese.delete(id);
    clearTimeout(a.timer);
    a.reject(new Error(motivo));
  }
}

function avvia() {
  const w = new Worker(codiceThread(), { eval: true, resourceLimits: { maxOldGenerationSizeMb: MEMORIA_MB } });
  w.versioneElenco = undefined;
  w.on('message', ({ id, res, errore }) => {
    const a = attese.get(id);
    if (!a) return;
    attese.delete(id);
    clearTimeout(a.timer);
    if (errore) a.reject(new Error(errore));
    else a.resolve(res);
  });
  w.on('error', (e) => abbandona(w, `lettura delle etichette interrotta: ${(e && (e.code || e.message)) || e}`));
  w.on('exit', () => abbandona(w, 'lettura delle etichette interrotta'));
  // Dopo gli ascoltatori: aggiungerli riaggancia il thread al ciclo e Filo non uscirebbe più.
  w.unref();
  return w;
}

// `elenco`: { versione, pem, pemTsa }. Il thread riconverte l'elenco solo quando cambia versione.
function analizza(byte, elenco) {
  if (!thread) thread = avvia();
  const w = thread;
  const id = prossimo++;
  const conElenco = elenco && w.versioneElenco !== elenco.versione;
  if (conElenco) w.versioneElenco = elenco.versione;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // Un thread fermo su un file ostile si butta: chi aspettava dietro riceve un rifiuto, la prossima lettura ne apre uno nuovo.
      abbandona(w, `lettura delle etichette oltre ${TEMPO_MAX_MS / 1000} secondi`);
      w.terminate().catch(() => {});
    }, TEMPO_MAX_MS);
    attese.set(id, { resolve, reject, timer, w });
    const copia = byte instanceof ArrayBuffer ? new Uint8Array(byte.slice(0)) : new Uint8Array(byte);
    w.postMessage({ id, byte: copia, elenco: conElenco ? elenco : null }, [copia.buffer]);
  });
}

module.exports = { analizza, TEMPO_MAX_MS };
