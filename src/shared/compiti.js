// I compiti delle routine come li mostra Filo (SPEC-DOMANDE.md §6): etichette, stati, costo delle chiamate, e il
// controllo di un compito scritto a mano con le stesse regole del server (ownerCompiti), che ha l'ultima parola.
// Logica pura: le schede Compiti e Compiti ricorrenti, il main e scripts/compito.mjs. Prove: tests/unit/compiti.test.mjs.

(function (global) {
  'use strict';

  const NOME_FASE = Object.freeze({ primo: 'primo lavoro', verifica: 'verifica', correzione: 'correzione', controllo: 'controllo cieco' });
  const NOME_STATO = Object.freeze({
    aperto: 'in attesa', in_corso: 'in corso', fatto: 'fatto', superato: 'superato', annullato: 'annullato',
  });
  const MODELLI = Object.freeze(['opus', 'sonnet', 'haiku', 'fable']);
  const SFORZI = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
  // Gli ambiti attivi che il codice conosce (ambiti.js, caricato prima): valgono finché il server non manda i suoi.
  const AMBITI = Object.freeze(global.SN_AMBITI ? global.SN_AMBITI.attivi() : ['lavoro', 'server']);
  // Gli stessi tetti e la stessa scala del server (compiti/modello.js, compiti/urgenza.js).
  const TETTI = Object.freeze({ titolo: 300, istruzioni: 40000 });
  const URGENZA = Object.freeze({ min: 0, max: 99, nuovo: 45 });

  const testo = (v) => (typeof v === 'string' ? v : '');

  /** «#1196 · verifica» per una fase, «C-12 · titolo» per gli altri, «C-13 · Unione di #12, #15» per un'unione. */
  function etichetta(c) {
    if (!c || typeof c !== 'object') return '';
    if (c.tipo === 'fase') return `${c.feedbackNum || 'feedback'} · ${NOME_FASE[c.fase] || c.fase || '?'}`;
    if (c.tipo === 'risposta') return `${c.id} · Gestisci la risposta a ${testo(c.domandaId) || 'una domanda'}`;
    let t = testo(c.titolo).trim();
    if (!t && c.tipo === 'unione' && Array.isArray(c.feedbackNums) && c.feedbackNums.length) t = `Unione di ${c.feedbackNums.join(', ')}`;
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

  /** La somma non dice tutto: qualche chiamata senza costo, o le più vecchie non tenute. */
  function costoParziale(c) {
    const lista = Array.isArray(c && c.biglietti) ? c.biglietti : [];
    return Number(c && c.bigliettiTolti) > 0 || lista.some((b) => !b || typeof b.costo !== 'number' || !Number.isFinite(b.costo));
  }

  /** «1,60 $»; «almeno» davanti a una somma parziale, «meno di 0,01 $» per un costo vero ma minimo. */
  function costoTesto(n, parziale = false) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '';
    const cifra = n > 0 && n < 0.005 ? 'meno di 0,01 $' : `${n.toFixed(2).replace('.', ',')} $`;
    return parziale ? `almeno ${cifra}` : cifra;
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
    if (c.tipo === 'ricorrente') return `Urgenza ${c.urgenza}, quella del compito ricorrente`;
    if (c.tipo === 'unione') return `Urgenza ${c.urgenza}, quella delle unioni di feedback`;
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

  /** I nomi degli ambiti attivi nella risposta del server (`ambiti`, come SN_AMBITI.elenco); senza, quelli del codice. */
  function ambitiAttivi(r) {
    const lista = Array.isArray(r && r.ambiti) ? r.ambiti.filter((a) => a && a.attivo === true && typeof a.nome === 'string') : [];
    return lista.length ? lista.map((a) => a.nome) : AMBITI.slice();
  }

  /** «il ricorrente vuole un nome» → «Il ricorrente vuole un nome.»: i dettagli del server e delle regole, per l'owner. */
  function frase(s) {
    const t = testo(s).trim();
    if (!t) return '';
    const su = t.charAt(0).toUpperCase() + t.slice(1);
    return /[.!?…:]$/.test(su) ? su : `${su}.`;
  }

  function ammessoDa(ambiti, spenti) {
    if (Array.isArray(ambiti)) return (n) => ambiti.includes(n);
    const A = global.SN_AMBITI;
    if (!A) return (n) => AMBITI.includes(n);
    // Senza l'elenco del server un nome nuovo può essere un ambito approvato dall'owner: lo decide il server.
    return (n) => (Object.prototype.hasOwnProperty.call(A.INIZIALI, n) ? (spenti || A.INIZIALI[n].attivo) : A.NOME_RE.test(n));
  }

  /**
   * Urgenza, modello, sforzo e ambito di un compito o di un ricorrente, con le regole del server. `ambiti`: i nomi
   * ammessi; senza, quelli che il codice sa possibili. `spenti`: un ricorrente può aspettare un ambito non ancora attivo.
   * @returns {{ ok:true, scelte:{ urgenza, modello, sforzo, ambito } } | { ok:false, testo }}
   */
  function validaScelte(raw, ambiti, { spenti = false } = {}) {
    const d = raw && typeof raw === 'object' ? raw : {};
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
    if (!ammessoDa(ambiti, spenti)(ambito)) {
      return { ok: false, testo: Array.isArray(ambiti) ? `Ambito fra ${ambiti.join(', ')}.` : `L’ambito «${ambito.slice(0, 40)}» non è fra quelli che il server accetta.` };
    }
    return { ok: true, scelte: { urgenza, modello, sforzo, ambito } };
  }

  /**
   * Un compito scritto a mano, controllato come lo controlla il server. `ambiti`: come in validaScelte.
   * @returns {{ ok:true, compito } | { ok:false, testo }}
   */
  function validaNuovo(raw, ambiti) {
    const d = raw && typeof raw === 'object' ? raw : {};
    const titolo = testo(d.titolo).trim();
    const istruzioni = testo(d.istruzioni).trim();
    if (!titolo) return { ok: false, testo: 'Scrivi un titolo.' };
    if (titolo.length > TETTI.titolo) return { ok: false, testo: `Il titolo ha ${titolo.length} caratteri: il massimo è ${TETTI.titolo}.` };
    if (istruzioni.length > TETTI.istruzioni) return { ok: false, testo: `Le istruzioni hanno ${istruzioni.length} caratteri: il massimo è ${TETTI.istruzioni}.` };
    const v = validaScelte(d, ambiti);
    if (!v.ok) return v;
    return { ok: true, compito: Object.assign({ titolo, istruzioni }, v.scelte) };
  }

  function quandoRoma(ms) {
    const R = global.SN_RICORRENTI;
    return R ? R.quandoTesto(ms) : new Date(ms).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' });
  }

  /** Perché un compito in attesa non è ancora partito: la frase del server, o «non prima di …»; '' se niente lo ferma. */
  function attesaTesto(c, adessoMs = Date.now()) {
    if (!c || c.aperto === false || c.stato !== 'aperto') return '';
    const a = testo(c.attesa).trim().replace(/\.$/, '');
    if (a) return a;
    const n = Number(c.nonPrimaDi);
    return Number.isFinite(n) && n > adessoMs ? `non prima di ${quandoRoma(n)}` : '';
  }

  global.SN_COMPITI = Object.freeze({
    NOME_FASE, NOME_STATO, MODELLI, SFORZI, AMBITI, TETTI, URGENZA,
    etichetta, nomeStato, modelloTesto, costoTotale, costoParziale, costoTesto, durataTesto, urgenzaTesto, dividi,
    ambitiAttivi, frase, validaScelte, validaNuovo, attesaTesto,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
