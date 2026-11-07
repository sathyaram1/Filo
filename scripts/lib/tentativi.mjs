// I tentativi di lavoro nuovo su un feedback (`worker/<id>-<stampo>`): come si legge il nome, quali sono superati, quali vivi.
// PURO: niente git, niente rete. Una regola sola per dispatch e per l'elenco dei rami in corso (#2152).
// Regole: tests/unit/ripartenzaDalTentativoMorto.test.mjs.

const TENTATIVO = /^(?:origin\/)?worker\/([A-Za-z0-9._-]+)-(\d{8}T\d{6}Z)$/;

/** L'id come lo porta il nome del ramo: chi riconosce un ramo dal suo id (fusioni, rami in corso) usa questa forma. */
export function idNelRamo(id) {
  return String(id || '').replace(/[^A-Za-z0-9._-]/g, '');
}

/** `worker/<id>-<stampo>`, anche con `origin/` davanti → `{ id, stampo }`, se no null. Lo stampo ordina come stringa. */
export function leggiTentativo(ramo) {
  const m = TENTATIVO.exec(String(ramo || '').trim());
  return m ? { id: m[1], stampo: m[2] } : null;
}

/**
 * I rami superati fra `tentativi` ([{ ramo, fuso, vuoto }]): un tentativo non fuso più vecchio dell'ultimo lavoro dello
 * stesso feedback arrivato su main è morto anche se nessuno l'ha fuso. Arrivato è un tentativo fuso che non sia `vuoto`
 * (nato da main e mai scritto: sta su main senza averci portato niente), o la fusione del feedback letta su main,
 * `fusioni` = { id: stampo della più recente }, che regge anche dopo la potatura del ramo fuso.
 */
export function tentativiSuperati(tentativi, { fusioni = {} } = {}) {
  const letti = (Array.isArray(tentativi) ? tentativi : []).map((t) => ({ ...t, l: leggiTentativo(t && t.ramo) })).filter((t) => t.l);
  const arrivo = new Map(Object.entries(fusioni || {}).filter(([, s]) => s));
  for (const t of letti) {
    if (t.fuso && !t.vuoto && !(arrivo.get(t.l.id) >= t.l.stampo)) arrivo.set(t.l.id, t.l.stampo);
  }
  return new Set(letti.filter((t) => !t.fuso && arrivo.has(t.l.id) && t.l.stampo < arrivo.get(t.l.id)).map((t) => t.ramo));
}

/**
 * Fra i tentativi vivi di UN feedback ([{ ramo, head }]) quelli che nessun altro contiene, dal più recente: il primo è
 * il lavoro da riprendere, gli altri lavoro che lui non ha. `contiene(a, b)`: la punta di `a` sta dentro quella di `b`.
 */
export function viviInCima(vivi, contiene) {
  const lista = (Array.isArray(vivi) ? vivi : []).filter((t) => leggiTentativo(t && t.ramo));
  const stampo = (t) => leggiTentativo(t.ramo).stampo;
  const cima = lista.filter((t) => !lista.some((o) => o.head !== t.head && contiene(t, o)))
    .sort((a, b) => stampo(b).localeCompare(stampo(a)));
  // Due rami sulla stessa punta sono lo stesso lavoro: resta il più recente.
  return cima.filter((t, i) => !cima.slice(0, i).some((o) => o.head === t.head));
}
