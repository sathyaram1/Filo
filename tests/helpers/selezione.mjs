// Seleziona un testo dentro un elemento come farebbe il mouse, anche dentro un'ombra aperta (l'Aiuto). Per le prove
// che rispondono a un passo selezionato (#2346).

export async function seleziona(el, testo) {
  await el.evaluate((nodo, cosa) => {
    const nodi = [];
    const w = document.createTreeWalker(nodo, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) nodi.push(n);
    const tutto = nodi.map((n) => n.data).join('');
    const k = tutto.indexOf(cosa);
    if (k < 0) throw new Error(`non c'è: ${cosa}`);
    const dove = (p) => {
      let f = 0;
      for (const n of nodi) { if (p <= f + n.data.length) return [n, p - f]; f += n.data.length; }
      return null;
    };
    const r = document.createRange();
    r.setStart(...dove(k));
    r.setEnd(...dove(k + cosa.length));
    const radice = nodo.getRootNode();
    const s = radice !== document && radice.getSelection ? radice.getSelection() : getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }, testo);
}
