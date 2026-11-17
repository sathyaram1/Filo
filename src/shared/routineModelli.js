// Modello e sforzo del worker per ogni fase di un cambio di codice (doc config/routines, campo `roleModels`).
// Logica pura: pagina di gestione e main rifiutano gli stessi valori. Una scelta assente vale la definizione
// dell'agente; l'unica fase con una partenza sua è la verifica dopo un riallineamento, che la prende dal server.

(function (global) {
  'use strict';

  const CAMPO = 'roleModels';
  // L'ordine è quello in cui la fase arriva a un cambio di codice.
  const RUOLI = Object.freeze([
    Object.freeze({ id: 'new-work', nome: 'Primo lavoro' }),
    Object.freeze({ id: 'verifier', nome: 'Verifica' }),
    // Guarda solo i file di un conflitto risolto (#2344): vuota vale la Verifica, salvo la partenza, che il server
    // applica (functions/src/routine/modello.js di filo-security, una prova lì le tiene uguali).
    Object.freeze({
      id: 'verifier-riallineamento', nome: 'Verifica dopo un riallineamento', come: 'verifier', partenza: Object.freeze({ effort: 'medium' }),
      // Base misurata (#2344): 748 $ su 253 verifiche dopo un riallineamento, 1-8/11/2026, Opus a sforzo high. Volume:
      // il traguardo del feedback, sotto 50 a settimana. Gli altri sforzi in proporzione: [costo, minuti], stimati.
      stima: Object.freeze({
        dollariAVerifica: 3, aSettimana: 50, base: 'Opus a sforzo high, 748 $ su 253 verifiche dal 1° all\'8 novembre',
        sforzi: Object.freeze({ low: [0.5, 15], medium: [0.7, 20], high: [1, 25], xhigh: [1.4, 35], max: [2, 45] }),
      }),
    }),
    Object.freeze({ id: 'fixer', nome: 'Correzione' }),
    Object.freeze({ id: 'secaudit', nome: 'Controllo cieco' }),
    // Non è una fase di un cambio: è la regia (SPEC-MANUTENTORE § 1), ultima perché fuori da quell'ordine.
    Object.freeze({ id: 'manutentore', nome: 'Manutentore' }),
  ]);
  const SCELTE = Object.freeze({
    model: Object.freeze([
      Object.freeze({ id: 'opus', nome: 'Opus' }),
      Object.freeze({ id: 'sonnet', nome: 'Sonnet' }),
      Object.freeze({ id: 'haiku', nome: 'Haiku' }),
      Object.freeze({ id: 'fable', nome: 'Fable' }),
    ]),
    effort: Object.freeze(['low', 'medium', 'high', 'xhigh', 'max'].map((id) => Object.freeze({ id, nome: id }))),
  });
  const CAMPI = Object.freeze(Object.keys(SCELTE));
  const NOME_CAMPO = Object.freeze({ model: 'Modello', effort: 'Sforzo' });
  const VUOTO = 'Definizione dell\'agente';
  // Un valore scritto a mano nel documento si mostra com'è, ma non oltre questo: è un'etichetta, non un testo.
  const LUNGO_MAX = 60;

  const idRuoli = () => RUOLI.map((r) => r.id);
  const idScelte = (campo) => (SCELTE[campo] || []).map((s) => s.id);
  const nomeRuolo = (id) => (RUOLI.find((r) => r.id === id) || {}).nome || id;

  /** Cosa vale la voce vuota di una fase, detto all'owner: la definizione dell'agente, la partenza o l'altra fase. */
  function vuotoDi(ruolo, campo) {
    const r = RUOLI.find((x) => x.id === ruolo) || {};
    if (r.partenza && r.partenza[campo]) return `${r.partenza[campo]} (partenza)`;
    if (r.come) return `Come in ${nomeRuolo(r.come)}`;
    return VUOTO;
  }

  /**
   * Costo al mese e durata di una fase con lo sforzo scelto ('' = la partenza): { testo, perche }, o null per una fase
   * senza stima. Si legge dove si decide (filo_design.txt § GESTIONE DEI MODELLI).
   */
  function stimaDi(ruolo, effort) {
    const r = RUOLI.find((x) => x.id === ruolo) || {};
    const s = r.stima;
    const sforzo = effort || (r.partenza && r.partenza.effort) || '';
    if (!s || !s.sforzi[sforzo]) return null;
    const mese = (k) => Math.round((s.dollariAVerifica * s.sforzi[k][0] * s.aSettimana * 52 / 12) / 10) * 10;
    return {
      testo: `Sforzo ${sforzo}: circa ${mese(sforzo)} $ al mese, una verifica in circa ${s.sforzi[sforzo][1]} minuti.`,
      perche: `Stima con ${s.aSettimana} verifiche a settimana. Base: ${s.base}; gli altri sforzi in proporzione. `
        + `Al mese: ${Object.keys(s.sforzi).map((k) => `${k} circa ${mese(k)} $`).join(', ')}.`,
    };
  }

  /**
   * Tutte le fasi, con '' dove vale la definizione dell'agente. Un valore fuori elenco scritto a mano resta
   * com'è: il server potrebbe usarlo, e mostrarlo come «definizione dell'agente» sarebbe una bugia.
   */
  function leggiDoc(doc) {
    const d = doc && typeof doc === 'object' ? doc : {};
    const mappa = d[CAMPO] && typeof d[CAMPO] === 'object' && !Array.isArray(d[CAMPO]) ? d[CAMPO] : {};
    const out = {};
    for (const id of idRuoli()) {
      const voce = Object.prototype.hasOwnProperty.call(mappa, id) && mappa[id] && typeof mappa[id] === 'object' ? mappa[id] : {};
      out[id] = {};
      for (const campo of CAMPI) {
        const v = Object.prototype.hasOwnProperty.call(voce, campo) && typeof voce[campo] === 'string' ? voce[campo].trim() : '';
        out[id][campo] = v.slice(0, LUNGO_MAX);
      }
    }
    return out;
  }

  /** Vero se il valore è nell'elenco della scelta (o vuoto): il resto è un valore scritto a mano. */
  function inElenco(campo, valore) {
    return valore === '' || idScelte(campo).includes(valore);
  }

  /**
   * Una scelta sola: una fase, un campo, un valore ('' = torna alla definizione dell'agente). Un valore storto
   * non si aggiusta in silenzio: si rifiuta dicendo cosa vale, perché chi scrive sappia cosa è rimasto sul server.
   * @returns {{ok:true, ruolo:string, campo:string, valore:string}|{ok:false, testo:string}}
   */
  function valida(patch) {
    const p = patch && typeof patch === 'object' ? patch : {};
    if (!idRuoli().includes(p.ruolo)) {
      return { ok: false, testo: `Fase sconosciuta: vale una fra ${idRuoli().join(', ')}. Non salvato.` };
    }
    if (!CAMPI.includes(p.campo)) {
      return { ok: false, testo: 'Si sceglie il modello o lo sforzo. Non salvato.' };
    }
    if (typeof p.valore !== 'string' || !inElenco(p.campo, p.valore)) {
      return {
        ok: false,
        testo: `${NOME_CAMPO[p.campo]}: vale uno fra ${idScelte(p.campo).join(', ')}, oppure niente (${VUOTO.toLowerCase()}). Non salvato.`,
      };
    }
    return { ok: true, ruolo: p.ruolo, campo: p.campo, valore: p.valore };
  }

  // Un segmento con un trattino (`new-work`) va fra apici inversi, o Firestore lo legge come un'espressione.
  function segmento(nome) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(nome) ? nome : `\`${String(nome).replace(/[\\`]/g, (c) => `\\${c}`)}\``;
  }

  /** Il percorso del solo campo scelto: salvare il modello di una fase non riscrive lo sforzo né le altre fasi. */
  function percorso(ruolo, campo) {
    return [CAMPO, ruolo, campo].map(segmento).join('.');
  }

  global.SN_ROUTINE_MODELLI = Object.freeze({
    CAMPO, RUOLI, SCELTE, CAMPI, NOME_CAMPO, VUOTO,
    leggiDoc, inElenco, valida, percorso, nomeRuolo, vuotoDi, stimaDi,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
