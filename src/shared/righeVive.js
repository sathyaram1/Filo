// Ridisegno di un elenco che tiene VIVE le righe i cui pulsanti non cambiano.
// Un clic che attraversa la sostituzione del suo pulsante si perde senza dire
// niente (#588): ogni elenco che si aggiorna da solo passa di qui.

(function (global) {
  'use strict';

  // Ciò che un clic può colpire: stessa chiave, stessi pulsanti che fanno la
  // stessa cosa, quindi la riga vecchia resta e prende i testi della nuova.
  function chiave(riga, selAzioni) {
    const a = riga.querySelector(selAzioni);
    const bottoni = a
      ? Array.from(a.querySelectorAll('button')).map((b) => `${b.textContent}\u0001${b.disabled ? 0 : 1}`).join('\u0002')
      : '';
    const d = riga.dataset || {};
    return [riga.className, d.state || '', d.missing || '', d.chiede || '', bottoni].join('\u0003');
  }

  // Prima si tolgono i figli che non restano, poi si inseriscono i nuovi
  // davanti ai rimasti: così un nodo che resta non viene mai staccato.
  function allinea(padre, figli) {
    const tieni = new Set(figli);
    for (const f of Array.from(padre.children)) if (!tieni.has(f)) f.remove();
    figli.forEach((f, i) => { if (padre.children[i] !== f) padre.insertBefore(f, padre.children[i] || null); });
  }

  // `nuove`: le righe appena costruite, con `data-id`. Ritorna quelle in pagina.
  function riconcilia(lista, nuove, selAzioni) {
    const vecchie = new Map();
    for (const v of Array.from(lista.children)) if (v.dataset && v.dataset.id) vecchie.set(v.dataset.id, v);
    const righe = nuove.map((n) => {
      const v = n.dataset && n.dataset.id ? vecchie.get(n.dataset.id) : null;
      if (!v || chiave(v, selAzioni) !== chiave(n, selAzioni)) return n;
      const av = v.querySelector(selAzioni);
      const an = n.querySelector(selAzioni);
      allinea(v, Array.from(n.children).map((c) => (c === an ? av : c)));
      if (n.title !== v.title) v.title = n.title;
      return v;
    });
    allinea(lista, righe);
    return righe;
  }

  global.SN_RIGHE_VIVE = { riconcilia };
})(globalThis);
