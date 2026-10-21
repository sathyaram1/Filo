// I compiti delle routine come li mostra Filo (SPEC-DOMANDE.md §6): etichette, stati, costo delle chiamate, e il
// controllo di un compito scritto a mano con le stesse regole del server (ownerCompiti), che ha l'ultima parola.
// Logica pura: la scheda Routine → Compiti, il main e scripts/compito.mjs. Prove: tests/unit/compiti.test.mjs.

(function (global) {
  'use strict';

  const NOME_FASE = Object.freeze({ primo: 'primo lavoro', verifica: 'verifica', correzione: 'correzione', controllo: 'controllo cieco' });
  const NOME_STATO = Object.freeze({
    aperto: 'in attesa', in_corso: 'in corso', fatto: 'fatto', superato: 'superato', annullato: 'annullato',
  });
  const MODELLI = Object.freeze(['opus', 'sonnet', 'haiku', 'fable']);
  const SFORZI = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
  const AMBITI = Object.freeze(['lavoro', 'server']);
  // Gli stessi tetti e la stessa scala del server (compiti/modello.js, compiti/urgenza.js).
  const TETTI = Object.freeze({ titolo: 300, istruzioni: 40000 });
  const URGENZA = Object.freeze({ min: 0, max: 99, nuovo: 45 });

  const testo = (v) => (typeof v === 'string' ? v : '');

  /** «#1196 · verifica» per una fase, «C-12 · titolo» per uno scritto a mano. */
  function etichetta(c) {
    if (!c || typeof c !== 'object') return '';
    if (c.tipo === 'fase') return `${c.feedbackNum || 'feedback'} · ${NOME_FASE[c.fase] || c.fase || '?'}`;
    const t = testo(c.titolo).trim();
    return t ? `${c.id} · ${t}` : String(c.id || '');
  }

  function nomeStato(c) {
    return NOME_STATO[c && c.stato] || String((c && c.stato) || '');
  }

  /** «opus · high»; senza modello vale la definizione dell'agente. */
  function modelloTesto(m, s) {
    const a = testo(m) || 'modello dell’agente';
    return s ? `${a} · ${s}` : a;
  }

  /** La somma dei costi noti delle chiamate; null se nessuna ne dichiara uno (non è zero: non si sa). */
  function costoTotale(c) {
    const lista = Array.isArray(c && c.biglietti) ? c.biglietti : [];
    let somma = null;
    for (const b of lista) {
      const n = b && typeof b.costo === 'number' && Number.isFinite(b.costo) ? b.costo : null;
      if (n !== null) somma = (somma || 0) + n;
    }
    return somma === null ? null : Math.round(somma * 10000) / 10000;
  }

  function costoTesto(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '';
    return `${n.toFixed(2).replace('.', ',')} $`;
  }

  /** Una durata leggibile: «40 s», «12 min», «3 h 05». */
  function durataTesto(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n < 0) return '';
    const s = Math.round(n / 1000);
    if (s < 60) return `${s} s`;
    const min = Math.round(s / 60);
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    return `${h} h ${String(min % 60).padStart(2, '0')}`;
  }

  /** Perché il server lo metterebbe qui in coda: la riga del suo pareggio, detta per l'owner. */
  function urgenzaTesto(c) {
    if (!c || typeof c.urgenza !== 'number') return '';
    if (c.tipo !== 'fase') return `Urgenza ${c.urgenza}, scelta da chi l'ha creato`;
    const prov = `${c.fiducia === 'fidato' ? 'fidato' : 'non fidato'}${c.figlio ? ', figlio di un altro feedback' : ''}`;
    return `Urgenza ${c.urgenza}: priorità ${c.priorita}, ${NOME_FASE[c.fase] || c.fase}, ${prov}`;
  }

  /** Divide l'elenco del server nelle tre parti della scheda; gli aperti restano nell'ordine del server. */
  function dividi(r) {
    const aperti = Array.isArray(r && r.aperti) ? r.aperti : [];
    return {
      inAttesa: aperti.filter((c) => c && c.stato !== 'in_corso'),
      inCorso: aperti.filter((c) => c && c.stato === 'in_corso'),
      storico: Array.isArray(r && r.storico) ? r.storico.filter(Boolean) : [],
    };
  }

  /**
   * Un compito scritto a mano, controllato come lo controlla il server.
   * @returns {{ ok:true, compito } | { ok:false, testo }}
   */
  function validaNuovo(raw) {
    const d = raw && typeof raw === 'object' ? raw : {};
    const titolo = testo(d.titolo).trim();
    const istruzioni = testo(d.istruzioni).trim();
    if (!titolo) return { ok: false, testo: 'Scrivi un titolo.' };
    if (titolo.length > TETTI.titolo) return { ok: false, testo: `Il titolo ha ${titolo.length} caratteri: il massimo è ${TETTI.titolo}.` };
    if (istruzioni.length > TETTI.istruzioni) return { ok: false, testo: `Le istruzioni hanno ${istruzioni.length} caratteri: il massimo è ${TETTI.istruzioni}.` };
    const grezza = typeof d.urgenza === 'string' ? d.urgenza.trim() : d.urgenza;
    const urgenza = grezza === '' || grezza === undefined || grezza === null ? NaN : Number(grezza);
    if (!Number.isInteger(urgenza) || urgenza < URGENZA.min || urgenza > URGENZA.max) {
      return { ok: false, testo: `L'urgenza è un numero intero da ${URGENZA.min} a ${URGENZA.max}.` };
    }
    const modello = testo(d.modello);
    const sforzo = testo(d.sforzo);
    if (modello && !MODELLI.includes(modello)) return { ok: false, testo: `Modello fra ${MODELLI.join(', ')}, o vuoto.` };
    if (sforzo && !SFORZI.includes(sforzo)) return { ok: false, testo: `Sforzo fra ${SFORZI.join(', ')}, o vuoto.` };
    const ambito = testo(d.ambito) || 'lavoro';
    if (!AMBITI.includes(ambito)) return { ok: false, testo: `Ambito fra ${AMBITI.join(', ')}.` };
    return { ok: true, compito: { titolo, istruzioni, urgenza, modello, sforzo, ambito } };
  }

  global.SN_COMPITI = Object.freeze({
    NOME_FASE, NOME_STATO, MODELLI, SFORZI, AMBITI, TETTI, URGENZA,
    etichetta, nomeStato, modelloTesto, costoTotale, costoTesto, durataTesto, urgenzaTesto, dividi, validaNuovo,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
