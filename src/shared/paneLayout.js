// Larghezze delle colonne nei layout a tre pannelli. Logica pura: numeri in, numeri fuori.
// Le larghezze salvate possono non entrare: le esterne si restringono quanto basta SENZA
// toccare le preferenze, così riallargando tornano quelle scelte.

(function (global) {
  'use strict';

  const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

  // `avail` <= 0 -> nessun adattamento; `gutters` è la somma dei divisori.
  // Ritorna { left, right } da mettere davvero nel grid.
  function fitWidths(o) {
    const opt = o || {};
    const minLeft  = Math.max(0, num(opt.minLeft, 0));
    const minRight = Math.max(0, num(opt.minRight, 0));
    const minCenter = Math.max(0, num(opt.minCenter, 0));
    const gutters  = Math.max(0, num(opt.gutters, 0));
    // Sotto il minimo non si scende mai, nemmeno da una preferenza corrotta o assente.
    let left  = Math.max(minLeft,  num(opt.left, minLeft));
    let right = Math.max(minRight, num(opt.right, minRight));

    const avail = num(opt.avail, 0);
    if (avail <= 0) return { left, right };

    // Spazio spendibile dalle esterne, lasciati i divisori e il minimo della centrale.
    const budget = avail - gutters - minCenter;
    const excess = (left + right) - budget;
    if (excess > 0) {
      // Riduzione PROPORZIONALE alla comprimibilità: chi ha più margine sopra il
      // proprio minimo cede più spazio.
      const shrinkL = left - minLeft;
      const shrinkR = right - minRight;
      const total = shrinkL + shrinkR;
      if (total > 0) {
        const cut = Math.min(excess, total);
        const cutL = Math.round(cut * (shrinkL / total));
        left  = Math.max(minLeft,  left - cutL);
        right = Math.max(minRight, right - (cut - cutL));
      }
      // Se nemmeno ai minimi ci stanno (finestra minuscola) restano ai minimi: si stringe
      // la centrale, ma nessuna colonna esce dal riquadro sovrapponendosi alle altre.
    }
    return { left, right };
  }

  global.SN_PANE_LAYOUT = { fitWidths };
})(typeof globalThis !== 'undefined' ? globalThis : self);
