// Quali schede chiude CHIUDI_SCHEDE (#413): i numeri dell'elenco che il modello aveva davanti, un sito, o tutte tranne
// alcune. Logica pura sulle schede che riceve, senza Electron: chiude il TabManager. Regole: tests/unit/chiudiSchede.test.mjs.

function eventi() {
  if (!globalThis.SN_FILO_EVENTI) require('../../shared/filoEventi.js');
  return globalThis.SN_FILO_EVENTI;
}

const SI = /^(true|1|si|sì|yes|tutte|tutti)$/i;

// Da un array, da un numero o da «3, 5»: null se c'è qualcosa che non è un numero di scheda.
function numeri(v) {
  if (v == null || v === '') return [];
  const lista = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(/[\s,;]+/).filter(Boolean) : [v]);
  const out = [];
  for (const x of lista) {
    const n = typeof x === 'number' ? x : (/^\d+$/.test(String(x).trim()) ? Number(String(x).trim()) : NaN);
    if (!Number.isInteger(n) || n < 1) return null;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

function richiesta(action) {
  const a = action || {};
  const tutte = a.tutte ?? a.tutti ?? a.all;
  return {
    schede: numeri(a.schede ?? a.numeri ?? a.numero ?? a.scheda),
    tranne: numeri(a.tranne ?? a.eccetto),
    tutte: tutte === true || SI.test(String(tutte ?? '')),
    sito: eventi().normaSito(a.sito ?? a.dominio ?? a.site ?? ''),
  };
}

// `viste`: gli id nell'ordine dell'elenco del modello, `numerate` quanti avevano il numero; `chat` si chiude solo nominata;
// `resta(tab, modo)` dice perché una presa in blocco resta aperta. Torna { errore } o { chiudere, restano: [{ perche }] }.
function risolvi(action, { schede = [], viste = [], numerate = 12, chat = null, resta = () => '' } = {}) {
  const r = richiesta(action);
  if (r.schede === null || r.tranne === null) {
    return { errore: 'le schede si indicano col numero che hanno nell\'elenco TAB APERTE (1, 2, 3…)' };
  }
  const limite = Math.min(numerate, viste.length);
  const fuori = [...r.schede, ...r.tranne].filter((n) => n > limite);
  if (fuori.length) {
    return {
      errore: `nell'elenco TAB APERTE ${fuori.length > 1 ? `non ci sono i numeri ${fuori.join(', ')}` : `non c'è il numero ${fuori[0]}`}`
        + (limite ? ` (vanno da 1 a ${limite}). Una scheda senza numero si prende solo col suo sito e non si lascia fuori da`
          + ' «tutte»: se l\'utente vuole tenerla aperta non usare «tutte», diglielo' : ''),
    };
  }
  const tutte = r.tutte || (r.tranne.length > 0 && !r.sito && !r.schede.length);
  if (!r.schede.length && !tutte && !r.sito) {
    return { errore: 'indica quali schede chiudere: i numeri dell\'elenco TAB APERTE, un sito, oppure tutte' };
  }
  const tenute = new Set(r.tranne.map((n) => viste[n - 1]));
  const inElenco = new Set(viste);
  const perId = new Map(schede.map((t) => [t.id, t]));
  const chiudere = [];
  const restano = [];
  const prese = new Set();
  const metti = (tab, modo) => {
    if (prese.has(tab.id)) return;
    prese.add(tab.id);
    if (tenute.has(tab.id)) return;
    if (tab.id === chat && modo !== 'numero') return;
    // Una scheda che il modello non aveva davanti (aperta in questo turno) non la prende un «tutte».
    const perche = modo === 'numero' ? '' : (inElenco.has(tab.id) ? resta(tab, modo) : 'nuova');
    if (perche) restano.push({ tab, perche });
    else chiudere.push(tab);
  };
  for (const n of r.schede) {
    const tab = perId.get(viste[n - 1]);
    if (tab) metti(tab, 'numero');
    else restano.push({ tab: null, numero: n, perche: 'chiusa' });
  }
  if (tutte) for (const tab of schede) metti(tab, 'tutte');
  else if (r.sito) for (const tab of schede) if (eventi().delSito(tab.url, r.sito)) metti(tab, 'sito');
  return { chiudere, restano, sito: r.sito, tutte };
}

module.exports = { risolvi, numeri };
