// Il processo a parte (utilityProcess di Electron) che fa il controllo senza modello della rilettura: un allegato grosso
// occupa lui, non il processo da cui dipendono finestre e schede (#1403.2). Fa solo leggiQui di feedbackL0Statico.js.

'use strict';

const { leggiQui } = require('./feedbackL0Statico');

const porta = process.parentPort;
porta.on('message', (e) => {
  const msg = (e && e.data) || {};
  let r = null;
  try { r = leggiQui(msg.dati); } catch (_) { r = null; }
  porta.postMessage({ id: msg.id, r });
});
