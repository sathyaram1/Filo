// Punto di nascita delle sessioni: ogni sessione che Filo crea (default, Privacy, incognito, proxy…)
// passa di qui e riceve ogni protezione registrata con allaNascita, senza che chi la crea lo ricordi.
// Non crea sessioni. Regole: tests/unit/sessioniNascita.test.mjs.

'use strict';

function creaNascita({ app, sessioneDefault } = {}) {
  const protezioni = [];   // { nome, fn }
  const nate = new Set();  // Electron non libera le sessioni: tenerle vive non costa.
  const esenti = new WeakSet();
  let esenzioneInCorso = 0;
  let installata = false;

  function applica(p, ses) {
    try { p.fn(ses); } catch (e) {
      try { console.error(`[Filo sessioni] protezione "${p.nome}" fallita`, e); } catch (_) {}
    }
  }

  function nasce(ses) {
    if (!ses || nate.has(ses) || esenti.has(ses)) return;
    if (esenzioneInCorso > 0) { esenti.add(ses); return; }
    nate.add(ses);
    for (const p of protezioni) applica(p, ses);
  }

  // Le sessioni già nate la ricevono subito: l'ordine dei require non conta.
  function allaNascita(nome, fn) {
    if (typeof fn !== 'function') throw new TypeError('allaNascita: serve una funzione');
    installa();
    const p = { nome: String(nome || 'anonima'), fn };
    protezioni.push(p);
    for (const ses of nate) applica(p, ses);
  }

  function installa() {
    if (installata || !app || typeof app.on !== 'function') return;
    installata = true;
    // Electron lo emette in modo sincrono dentro fromPartition, anche per le partizioni implicite.
    app.on('session-created', nasce);
    const prendiDefault = () => {
      try { const d = sessioneDefault && sessioneDefault(); if (d) nasce(d); } catch (_) {}
    };
    if (typeof app.isReady === 'function' && app.isReady()) prendiDefault();
    else if (typeof app.whenReady === 'function') app.whenReady().then(prendiDefault).catch(() => {});
  }

  // Solo per sessioni di servizio che non navigano per l'utente (la detonazione di Safe Browse):
  // chi la usa dichiara la scelta, e la sentinella tiene l'elenco.
  function senzaProtezione(crea) {
    installa();
    esenzioneInCorso++;
    try { return crea(); } finally { esenzioneInCorso--; }
  }

  return {
    installa,
    allaNascita,
    senzaProtezione,
    nate: () => [...nate],
    protezioni: () => protezioni.map((p) => p.nome),
    eNata: (ses) => nate.has(ses),
  };
}

let predefinita = null;
function nascita() {
  if (predefinita) return predefinita;
  let electron = null;
  try { electron = require('electron'); } catch (_) {}
  predefinita = creaNascita({
    app: electron && electron.app,
    sessioneDefault: () => electron && electron.session && electron.session.defaultSession,
  });
  return predefinita;
}

module.exports = {
  creaNascita,
  installa: () => nascita().installa(),
  allaNascita: (nome, fn) => nascita().allaNascita(nome, fn),
  senzaProtezione: (crea) => nascita().senzaProtezione(crea),
  nate: () => nascita().nate(),
  protezioni: () => nascita().protezioni(),
  eNata: (ses) => nascita().eNata(ses),
};
