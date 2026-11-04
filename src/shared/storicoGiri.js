// I giri di verifica dei lavori chiusi (#795): livelli trovati, esterni, corretti, bilancio pagato ed esito, e i totali.
// Logica pura per Gestione → Routine → Log e scripts/storico-giri.mjs; solo numeri, mai il testo dei rilievi.
// Prove: tests/unit/storicoGiri.test.mjs.

(function (global) {
  'use strict';

  const LIVELLI = Object.freeze([3, 2, 1, 0]);
  const ESITI = Object.freeze(['passa', 'corregge', 'corretto', 'fermato']);
  const GIORNO = 24 * 60 * 60 * 1000;
  const FINESTRA_PREDEFINITA = 30 * GIORNO;

  function livelli(v) {
    return (Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 3);
  }

  /** I totali per livello (trovati, esterni, corretti, giri pagati da quel bilancio) e per esito. PURA. */
  function totali(lavori) {
    const perLivello = Object.fromEntries(LIVELLI.map((l) => [l, { trovati: 0, esterni: 0, corretti: 0, pagati: 0 }]));
    const perEsito = Object.fromEntries(ESITI.map((e) => [e, 0]));
    let giri = 0; let nonRegistrati = 0; let senzaEsito = 0;
    for (const l of Array.isArray(lavori) ? lavori : []) {
      nonRegistrati += Math.max(0, Number(l && l.roundsDropped) || 0);
      for (const g of Array.isArray(l && l.rounds) ? l.rounds : []) {
        giri += 1;
        for (const n of livelli(g.found)) perLivello[n].trovati += 1;
        for (const n of livelli(g.external)) perLivello[n].esterni += 1;
        for (const n of livelli(g.fixed)) perLivello[n].corretti += 1;
        const pagato = /^cap([0-3])$/.exec(String(g.consumed || ''));
        if (pagato) perLivello[Number(pagato[1])].pagati += 1;
        if (ESITI.includes(g.outcome)) perEsito[g.outcome] += 1; else senzaEsito += 1;
      }
    }
    return { lavori: (Array.isArray(lavori) ? lavori : []).length, giri, nonRegistrati, senzaEsito, perLivello, perEsito };
  }

  /** I livelli di un giro scritti per l'owner: «2 1», o una lineetta se non ce ne sono. PURA. */
  function elenco(v) {
    return livelli(v).length ? livelli(v).join(' ') : '—';
  }

  /** Il bilancio pagato da un giro: «dei 2», o una lineetta. PURA. */
  function bilancio(c) {
    return /^cap[0-3]$/.test(String(c || '')) ? `dei ${String(c).slice(3)}` : '—';
  }

  global.SN_STORICO_GIRI = Object.freeze({ LIVELLI, ESITI, FINESTRA_PREDEFINITA, livelli, totali, elenco, bilancio });
})(typeof globalThis !== 'undefined' ? globalThis : this);
