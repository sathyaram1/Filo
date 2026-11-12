// Il tetto di spesa dei giudici per i mittenti non fidati (#1515): tetto e lunghezza giudicabile in config/automation,
// la spesa del giorno nel contatore che tiene il server. Logica pura, dopo campoNumero.js: Gestione e main rifiutano gli
// stessi valori, il server applica gli stessi intervalli. Prove: tests/unit/spesaGiudici.test.mjs.

(function (global) {
  'use strict';

  // I campi di config/automation e il documento del contatore (identities/, scritto solo dal server). L'id senza
  // due punti: nell'indirizzo REST di Firestore i due punti aprono un metodo.
  const CAMPI = Object.freeze({ tetto: 'judgeBudgetUsd', caratteri: 'judgeMaxChars' });
  const DOC_SPESA = 'identities/spesa-giudici';

  // Oltre 130.000 caratteri il numero non dice niente: il server non accetta più di 10.000 di testo e 120.000 di
  // documenti. Sotto i 1.000 nessun feedback con un allegato arriverebbe più ai giudici.
  const REGOLE = Object.freeze({
    tetto: Object.freeze({ min: 0, max: 1000, fabbrica: 2, etichetta: 'Tetto di spesa dei giudici' }),
    caratteri: Object.freeze({ min: 1000, max: 130000, fabbrica: 40000, etichetta: 'Lunghezza giudicata' }),
  });

  const numero = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const centesimi = (n) => Math.round(n * 100) / 100;
  // Le regole per SN_CAMPO_NUMERO, che legge il numero scritto e compone la frase di rifiuto.
  const REGOLE_CAMPO = Object.freeze({
    tetto: Object.freeze({ min: REGOLE.tetto.min, max: REGOLE.tetto.max, intero: false, etichetta: REGOLE.tetto.etichetta }),
    caratteri: Object.freeze({ min: REGOLE.caratteri.min, max: REGOLE.caratteri.max, intero: true, etichetta: REGOLE.caratteri.etichetta }),
  });

  /** Le impostazioni come le legge il server: un campo assente o storto vale il numero di fabbrica. */
  function leggiImpostazioni(doc) {
    const d = doc && typeof doc === 'object' ? doc : {};
    const t = numero(d[CAMPI.tetto]);
    const c = numero(d[CAMPI.caratteri]);
    const dentro = (n, r) => n !== null && n >= r.min && n <= r.max;
    return {
      tettoUsd: dentro(t, REGOLE.tetto) ? centesimi(t) : REGOLE.tetto.fabbrica,
      maxCaratteri: dentro(c, REGOLE.caratteri) ? Math.round(c) : REGOLE.caratteri.fabbrica,
    };
  }

  function cifra(n, decimali) {
    try {
      return new Intl.NumberFormat('it-IT', { minimumFractionDigits: decimali, maximumFractionDigits: decimali, useGrouping: true }).format(n);
    } catch (_) { return n.toFixed(decimali); }
  }

  /**
   * I soli campi ricevuti (`tettoUsd`, `maxCaratteri`), controllati. `null` o vuoto torna al numero di fabbrica; un
   * valore storto NON si aggiusta in silenzio: si rifiuta dicendo l'intervallo.
   * @returns {{ok:true, valori:Object}|{ok:false, testo:string}} `valori` per nome di campo del documento.
   */
  function valida(patch) {
    const p = patch && typeof patch === 'object' ? patch : {};
    const valori = {};
    for (const [chiave, tipo] of [['tettoUsd', 'tetto'], ['maxCaratteri', 'caratteri']]) {
      if (!(chiave in p) || p[chiave] === undefined) continue;
      const v = p[chiave];
      const campo = CAMPI[tipo];
      if (v === null || (typeof v === 'string' && !v.trim())) { valori[campo] = REGOLE[tipo].fabbrica; continue; }
      const esito = global.SN_CAMPO_NUMERO.controlla(v, REGOLE_CAMPO[tipo]);
      if (!esito.ok) return { ok: false, testo: esito.testo };
      valori[campo] = tipo === 'tetto' ? centesimi(esito.valore) : esito.valore;
    }
    return { ok: true, valori };
  }

  /** Il giorno del contatore: quello di Greenwich, uguale per il server e per ogni computer che lo legge. */
  function giorno(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  /** L'istante in cui il contatore riparte, dopo `ms`. */
  function prossimoGiornoMs(ms) {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  }

  /**
   * La spesa di oggi dal documento del contatore. `null` = non letto (si mostra un trattino, non uno zero); un
   * documento assente o di un altro giorno = niente speso oggi.
   * @returns {{spesoUsd:number, prenotatoUsd:number}|null}
   */
  function spesaDiOggi(doc, oraMs) {
    if (doc === null || doc === undefined) return null;
    const d = typeof doc === 'object' ? doc : {};
    if (d.giorno !== giorno(oraMs)) return { spesoUsd: 0, prenotatoUsd: 0 };
    const pos = (v) => { const n = numero(v); return n !== null && n > 0 ? n : 0; };
    return { spesoUsd: pos(d.spesoUsd), prenotatoUsd: pos(d.prenotatoUsd) };
  }

  /** Dollari come li legge l'owner: «1,95 $». */
  function usd(n) {
    const v = numero(n);
    return v === null ? '—' : `${cifra(v, 2)} $`;
  }

  /**
   * La riga di Gestione sulla spesa di oggi.
   * @returns {{testo:string, quota:number|null, pieno:boolean, dettaglio:string}}
   */
  function rigaSpesa(spesa, tettoUsd, oraMs) {
    const tetto = numero(tettoUsd);
    if (!spesa || tetto === null) {
      return { testo: `Oggi: — su ${usd(tetto)}`, quota: null, pieno: false, dettaglio: 'La spesa di oggi non si è potuta leggere.' };
    }
    const impegnato = spesa.spesoUsd + spesa.prenotatoUsd;
    const pieno = impegnato >= tetto;
    const riparte = new Date(prossimoGiornoMs(oraMs)).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const prenotato = spesa.prenotatoUsd > 0 ? `, più ${usd(spesa.prenotatoUsd)} prenotati per i giudizi in corso` : '';
    const dettaglio = pieno
      ? `Tetto raggiunto. I nuovi feedback dei non fidati aspettano te fino alle ${riparte}.`
      : `Il contatore riparte da zero alle ${riparte}.`;
    return {
      testo: `Oggi: ${usd(spesa.spesoUsd)} su ${usd(tetto)}${prenotato}`,
      quota: tetto > 0 ? Math.min(1, impegnato / tetto) : 1,
      pieno,
      dettaglio,
    };
  }

  global.SN_SPESA_GIUDICI = Object.freeze({
    CAMPI, DOC_SPESA, REGOLE, REGOLE_CAMPO,
    leggiImpostazioni, valida, giorno, prossimoGiornoMs, spesaDiOggi, usd, rigaSpesa,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
