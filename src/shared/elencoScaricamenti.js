// L'elenco degli scaricamenti in una superficie che riceve sia gli eventi sia le liste di risposta: una lista fotografata
// prima di un evento già arrivato non lo riscrive (#2307). Logica pura, niente DOM. Regole:
// tests/unit/elencoScaricamenti.test.mjs; il numero `rev` lo dà il main (downloads.js, broadcast).

(function (global) {
  'use strict';

  const revDi = (v) => (v && Number.isFinite(Number(v.rev)) ? Number(v.rev) : 0);

  // `voci`: Map id → voce, la stessa che la superficie disegna. `tolte`: id → rev delle rimozioni viste come evento,
  // finché una lista non le contiene già. `lista`: rev dell'ultima lista applicata.
  function crea(voci = new Map()) {
    return { voci, tolte: new Map(), lista: -1 };
  }

  function evento(stato, kind, item) {
    if (!stato || !item || !item.id) return;
    const ora = stato.voci.get(item.id);
    if (kind === 'removed') {
      stato.voci.delete(item.id);
      stato.tolte.set(item.id, revDi(item));
      return;
    }
    if (ora && revDi(ora) > revDi(item)) return;
    stato.voci.set(item.id, item);
  }

  // `risposta`: { items, rev }. Ritorna false se la lista è più vecchia di una già applicata e non tocca niente.
  // Senza `rev` la lista vale per intero, come prima del numero.
  function lista(stato, risposta) {
    if (!stato) return false;
    const items = risposta && Array.isArray(risposta.items) ? risposta.items : [];
    const conNumero = risposta && Number.isFinite(Number(risposta.rev));
    const fino = conNumero ? Number(risposta.rev) : Infinity;
    if (conNumero && fino < stato.lista) return false;
    const nuove = new Map();
    for (const it of items) {
      if (!it || !it.id) continue;
      if (stato.tolte.has(it.id) && stato.tolte.get(it.id) > fino) continue;
      const ora = stato.voci.get(it.id);
      nuove.set(it.id, ora && revDi(ora) > revDi(it) ? ora : it);
    }
    // Arrivata o cambiata dopo la foto: la lista non la conosce ancora, ma c'è.
    if (conNumero) for (const [id, v] of stato.voci) if (!nuove.has(id) && revDi(v) > fino) nuove.set(id, v);
    stato.voci.clear();
    for (const [id, v] of nuove) stato.voci.set(id, v);
    for (const [id, r] of Array.from(stato.tolte)) if (r <= fino) stato.tolte.delete(id);
    if (conNumero) stato.lista = fino;
    return true;
  }

  global.SN_ELENCO_SCARICAMENTI = { crea, evento, lista };
})(globalThis);
