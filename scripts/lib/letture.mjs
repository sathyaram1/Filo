// Quanto è costato questo giro, detto da chi l'ha fatto.
// Le letture di Firestore si pagano a documento: chi lancia uno script di
// manutenzione deve vedere il conto sullo schermo, non in fattura (#680).

/**
 * Un contatore da passare in giro. `aggiungi` accetta anche un numero che non
 * si conosce (undefined, NaN): lo ignora invece di trasformare il totale in
 * NaN, che sarebbe un conto peggiore di nessun conto.
 */
export function contatoreLetture() {
  const voci = [];
  let totale = 0;
  return {
    aggiungi(n, etichetta = '') {
      const v = Math.max(0, Math.trunc(Number(n)));
      if (!Number.isFinite(v)) return;
      totale += v;
      voci.push({ n: v, etichetta: String(etichetta || '') });
    },
    get totale() { return totale; },
    get voci() { return voci.slice(); },
    riga() { return rigaLetture(totale, voci); },
  };
}

/**
 * La riga finale. Il dettaglio fra parentesi c'è solo se ci sono più voci:
 * «documenti letti: 763 (segnalazioni 763)» non dice niente in più.
 * PURA.
 */
export function rigaLetture(totale, voci = []) {
  const n = Math.max(0, Math.trunc(Number(totale) || 0));
  const pezzi = (Array.isArray(voci) ? voci : []).filter((v) => v && v.etichetta);
  const dettaglio = pezzi.length > 1 ? ` (${pezzi.map((v) => `${v.etichetta} ${v.n}`).join(', ')})` : '';
  return `Documenti letti dal server in questo giro: ${n}${dettaglio}.`;
}
