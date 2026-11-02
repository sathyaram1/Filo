// La sede della sessione (FILO_SEDE, decisione dell'owner del 01/11/2026, SPEC-DOMANDE.md §1.2): nella sede owner gli
// strumenti rifiutano il testo non fidato invece di sporcare il biglietto. Non decide la fiducia (la tiene il server).
// Gli strumenti coperti e la sentinella: tests/unit/sedeFidata.test.mjs.

export const ENV_SEDE = 'FILO_SEDE';
export const SEDI = Object.freeze(['owner', 'ricerca', 'compiti']);

/**
 * La sede dalla variabile: 'owner' | 'ricerca' | 'compiti', '' = sessione locale sul PC. Un valore che non è una sede
 * vale 'owner': un refuso nella sede fidata non deve far passare il testo non fidato. PURA.
 * @returns {{ sede: string, grezza: string, sconosciuta: boolean }}
 */
export function sedeDi(env = process.env) {
  const grezza = String((env && env[ENV_SEDE]) || '').trim();
  const v = grezza.toLowerCase();
  if (!v) return { sede: '', grezza, sconosciuta: false };
  if (SEDI.includes(v)) return { sede: v, grezza, sconosciuta: false };
  return { sede: 'owner', grezza, sconosciuta: true };
}

/** Il nome della sede per il registro della sessione: quello della variabile, 'locale' senza. PURA. */
export function nomeSede(env = process.env) {
  return sedeDi(env).sede || 'locale';
}

/** La sede rifiuta il testo non fidato? Con `registrata` (la sede scritta accanto al biglietto) vale la più severa. PURA. */
export function rifiutaNonFidati(env = process.env, registrata = '') {
  return sedeDi(env).sede === 'owner' || String(registrata || '').trim().toLowerCase() === 'owner';
}

/** La riga che il gancio di avvio stampa. PURA. */
export function rigaSede(env = process.env) {
  const s = sedeDi(env);
  const rifiuta = 'gli strumenti che consegnano testo scritto da altri rifiutano le voci non fidate col numero e il motivo, e il biglietto resta pulito';
  if (s.sconosciuta) return `Sede: «${s.grezza.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 40)}» non è una sede (${SEDI.join(', ')}), quindi vale owner: ${rifiuta}.`;
  if (s.sede === 'owner') return `Sede: owner (${ENV_SEDE}): ${rifiuta}.`;
  if (s.sede) return `Sede: ${s.sede} (${ENV_SEDE}): il testo non fidato si consegna e sporca il biglietto.`;
  return `Sede: locale, sul PC (${ENV_SEDE} assente): il testo non fidato si consegna e sporca il biglietto.`;
}

// Il motivo di un rifiuto del cancello della sede: il server non è stato chiamato, e chi stampa non deve dire «dal server».
export const MOTIVO_SEDE_OWNER = 'sede_owner';

/** Chi ha rifiutato, per la riga del rifiuto. PURA. */
export function chiRifiuta(motivo) {
  return motivo === MOTIVO_SEDE_OWNER ? 'RIFIUTATO nella sede owner, senza chiamare il server' : 'RIFIUTATO dal server';
}

/** Gli id in una riga, tutti fino a `max`. PURA. */
export function elencoIds(ids, max = 50) {
  const l = (Array.isArray(ids) ? ids : []).map((x) => String(x).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 30));
  return l.slice(0, max).join(', ') + (l.length > max ? ` e altri ${l.length - max}` : '');
}

/** La riga di un rifiuto: cosa (col numero) e perché. `motivi` = quelli che altrove sporcherebbero. PURA. */
export function rigaRifiuto(cosa, motivi) {
  const perche = (Array.isArray(motivi) ? motivi : [motivi]).map((m) => String(m || '').trim()).filter(Boolean).join('; ') || 'testo non fidato';
  return `RIFIUTATO nella sede owner: ${cosa}, ${perche}. Non stampato, e il biglietto resta pulito: si legge da una sede ricerca o compiti, o dalla finestra di Filo.`;
}
