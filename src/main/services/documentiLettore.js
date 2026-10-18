// Chi legge il testo dei documenti per l'indice: il processo a parte (documentiLettoreFiglio.js) quando c'è, il
// processo stesso altrimenti (unit test, Electron che non lo avvia). Un file che lo tiene fermo troppo a lungo si
// lascia stare e il lettore riparte. Le regole del testo: documentiTesto.js.

'use strict';

const path = require('node:path');

// Una bolletta si legge in decimi di secondo, un PDF di quaranta pagine in qualche secondo: oltre, il file è
// costruito male o il lettore è bloccato.
const TEMPO_MAX_MS = 45_000;
// Il lettore si spegne da sé quando non serve: pdf.js tiene memoria anche a riposo.
const RIPOSO_MS = 60_000;

let figlio = null;
let senzaFiglio = false;
let prossimo = 1;
const attese = new Map();
let riposo = null;

function abbandona(motivo) {
  const vecchio = figlio;
  figlio = null;
  for (const [id, a] of attese) {
    attese.delete(id);
    clearTimeout(a.timer);
    a.resolve({ testo: '', pagine: 0, vuoto: false, errore: motivo });
  }
  try { if (vecchio) vecchio.kill(); } catch (_) {}
}

function avvia() {
  let utilityProcess;
  try { ({ utilityProcess } = require('electron')); } catch (_) { utilityProcess = null; }
  if (!utilityProcess || typeof utilityProcess.fork !== 'function') { senzaFiglio = true; return null; }
  try {
    const f = utilityProcess.fork(path.join(__dirname, 'documentiLettoreFiglio.js'), [], { serviceName: 'Filo · lettura documenti' });
    f.on('message', (msg) => {
      const a = msg && attese.get(msg.id);
      if (!a) return;
      attese.delete(msg.id);
      clearTimeout(a.timer);
      a.resolve(msg.r || { testo: '', pagine: 0, vuoto: false, errore: 'illeggibile' });
    });
    f.on('exit', () => { if (figlio === f) abbandona('illeggibile'); });
    return f;
  } catch (_) {
    senzaFiglio = true;
    return null;
  }
}

function programmaRiposo() {
  clearTimeout(riposo);
  riposo = setTimeout(() => {
    if (!attese.size && figlio) { const f = figlio; figlio = null; try { f.kill(); } catch (_) {} }
  }, RIPOSO_MS);
  if (riposo.unref) riposo.unref();
}

/** Il testo di un documento: { testo, pagine, vuoto, errore }. Non rifiuta mai. */
async function estrai(percorso) {
  if (!senzaFiglio && !figlio) figlio = avvia();
  if (!figlio) {
    try { return await require('./documentiTesto').estrai(percorso); } catch (_) {
      return { testo: '', pagine: 0, vuoto: false, errore: 'illeggibile' };
    }
  }
  const f = figlio;
  const id = prossimo++;
  programmaRiposo();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!attese.has(id)) return;
      // Fermo su un file: chi aspettava riceve «illeggibile», il prossimo file riparte da un lettore nuovo.
      if (figlio === f) abbandona('illeggibile');
    }, TEMPO_MAX_MS);
    attese.set(id, { resolve, timer });
    try { f.postMessage({ id, percorso: String(percorso) }); } catch (_) {
      attese.delete(id);
      clearTimeout(timer);
      if (figlio === f) abbandona('illeggibile');
      resolve({ testo: '', pagine: 0, vuoto: false, errore: 'illeggibile' });
    }
  });
}

function ferma() {
  clearTimeout(riposo);
  abbandona('illeggibile');
}

module.exports = { estrai, ferma, TEMPO_MAX_MS };
