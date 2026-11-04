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

  /** Mezzanotte locale del giorno scritto (AAAA-MM-GG, GG/MM/AAAA o GG/MM dell'anno in corso), o NaN. PURA. */
  function giornoLocale(testo, ora = Date.now()) {
    const t = String(testo == null ? '' : testo).trim();
    let a; let m; let g;
    let r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
    if (r) { a = Number(r[1]); m = Number(r[2]); g = Number(r[3]); } else if ((r = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(t))) {
      g = Number(r[1]); m = Number(r[2]); a = r[3] ? Number(r[3]) : new Date(ora).getFullYear();
    } else return NaN;
    const d = new Date(a, m - 1, g);
    return d.getFullYear() === a && d.getMonth() === m - 1 && d.getDate() === g ? d.getTime() : NaN;
  }

  /** La fine di una finestra che comprende tutto il giorno di `ms`: la mezzanotte dopo, anche col cambio d'ora. PURA. */
  function fineDelGiorno(ms) {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  }

  /** «#795», «#22.1» o l'id quando il feedback non ha numero. PURA. */
  function numeroDi(lavoro) {
    const FB = global.SN_FEEDBACK;
    const n = FB && FB.formatNum ? FB.formatNum(lavoro && lavoro.seq, lavoro && lavoro.subSeq) : '';
    return n ? `#${n}` : String((lavoro && lavoro.feedbackId) || '?');
  }

  global.SN_STORICO_GIRI = Object.freeze({ LIVELLI, ESITI, FINESTRA_PREDEFINITA, livelli, totali, elenco, bilancio,
    giornoLocale, fineDelGiorno, numeroDi });
})(typeof globalThis !== 'undefined' ? globalThis : this);
