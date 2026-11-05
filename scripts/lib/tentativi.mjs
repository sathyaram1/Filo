// I tentativi di lavoro nuovo su un feedback (`worker/<id>-<stampo>`): come si legge il nome e quali sono superati.
// PURO: niente git, niente rete. Una regola sola per dispatch e per l'elenco dei rami in corso (#2152).
// Regole: tests/unit/ripartenzaDalTentativoMorto.test.mjs.

const TENTATIVO = /^(?:origin\/)?worker\/([A-Za-z0-9._-]+)-(\d{8}T\d{6}Z)$/;

/** `worker/<id>-<stampo>`, anche con `origin/` davanti → `{ id, stampo }`, se no null. Lo stampo ordina come stringa. */
export function leggiTentativo(ramo) {
  const m = TENTATIVO.exec(String(ramo || '').trim());
  return m ? { id: m[1], stampo: m[2] } : null;
}

/**
 * I rami superati fra `tentativi` ([{ ramo, fuso }]): un tentativo più vecchio dell'ultimo dello stesso feedback
 * arrivato su main è morto anche se nessuno l'ha fuso, e il suo lavoro non è più da riprendere.
 */
export function tentativiSuperati(tentativi) {
  const letti = (Array.isArray(tentativi) ? tentativi : []).map((t) => ({ ...t, l: leggiTentativo(t && t.ramo) })).filter((t) => t.l);
  const ultimoFuso = new Map();
  for (const t of letti) {
    if (t.fuso && !(ultimoFuso.get(t.l.id) >= t.l.stampo)) ultimoFuso.set(t.l.id, t.l.stampo);
  }
  return new Set(letti.filter((t) => !t.fuso && ultimoFuso.has(t.l.id) && t.l.stampo < ultimoFuso.get(t.l.id)).map((t) => t.ramo));
}
