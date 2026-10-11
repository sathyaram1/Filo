// Il processo a parte che legge il testo dei documenti per l'indice (utilityProcess di Electron): un PDF grosso o
// costruito male occupa lui, non il processo principale da cui dipendono finestre e schede. Fa solo `estrai`.
// Chi lo avvia, lo ferma e ne aspetta le risposte: documentiLettore.js.

'use strict';

const { estrai } = require('./documentiTesto');

const porta = process.parentPort;
let coda = Promise.resolve();

porta.on('message', (e) => {
  const msg = (e && e.data) || {};
  const id = msg.id;
  const percorso = String(msg.percorso || '');
  // Uno alla volta: pdf.js in parallelo moltiplica la memoria senza finire prima.
  coda = coda.then(async () => {
    let r;
    try { r = await estrai(percorso); } catch (_) { r = { testo: '', pagine: 0, vuoto: false, errore: 'illeggibile' }; }
    porta.postMessage({ id, r });
  });
});
