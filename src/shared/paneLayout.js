// Larghezze delle colonne nei layout a pannelli trascinabili (deck builder,
// dashboard di gestione). Logica PURA: nessun DOM, nessuno storage — solo
// numeri in e numeri fuori, così è testabile con gli unit test.
//
// PERCHÉ ESISTE
//   Due pagine hanno lo stesso layout "tre colonne + due divisori": le due
//   colonne esterne hanno larghezza fissa scelta a mano dall'utente, quella
//   centrale assorbe il resto. Il calcolo delicato è UNO SOLO ed è lo stesso in
//   entrambe: le larghezze SALVATE possono non entrare nello spazio disponibile
//   (finestra rimpicciolita, schermo diverso, layout salvato su un monitor
//   grande). Applicandole alla lettera la colonna centrale collassa a zero o le
//   colonne traboccano sovrapponendosi. Qui si restringono le esterne quanto
//   basta, senza mai scendere sotto il loro minimo e SENZA toccare le
//   preferenze salvate: allargando di nuovo la finestra tornano le misure
//   scelte dall'utente.
//
// USO
//   const { left, right } = SN_PANE_LAYOUT.fitWidths({
//     avail: grid.clientWidth, gutters: 12,   // somma della larghezza dei divisori
//     left: pref.leftW, right: pref.rightW,
//     minLeft: 150, minRight: 180, minCenter: 320,
//   });

(function (global) {
  'use strict';

  const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

  /**
   * Restringe le due colonne esterne allo spazio realmente disponibile.
   *
   * @param {object}  o
   * @param {number}  o.avail      Larghezza totale del contenitore (px). <=0 → nessun adattamento.
   * @param {number} [o.gutters=0] Somma delle larghezze dei divisori (px).
   * @param {number}  o.left       Larghezza desiderata della colonna sinistra (px).
   * @param {number}  o.right      Larghezza desiderata della colonna destra (px).
   * @param {number} [o.minLeft=0] Minimo della colonna sinistra (px).
   * @param {number} [o.minRight=0]Minimo della colonna destra (px).
   * @param {number} [o.minCenter=0] Minimo della colonna centrale flessibile (px).
   * @returns {{left:number, right:number}} Larghezze da mettere davvero nel grid.
   */
  function fitWidths(o) {
    const opt = o || {};
    const minLeft  = Math.max(0, num(opt.minLeft, 0));
    const minRight = Math.max(0, num(opt.minRight, 0));
    const minCenter = Math.max(0, num(opt.minCenter, 0));
    const gutters  = Math.max(0, num(opt.gutters, 0));
    // Sotto il minimo non si scende mai, nemmeno partendo da una preferenza
    // corrotta o assente (undefined/NaN → il minimo).
    let left  = Math.max(minLeft,  num(opt.left, minLeft));
    let right = Math.max(minRight, num(opt.right, minRight));

    const avail = num(opt.avail, 0);
    if (avail <= 0) return { left, right };

    // Spazio spendibile dalle due colonne esterne, lasciando i divisori e il
    // minimo della colonna centrale.
    const budget = avail - gutters - minCenter;
    const excess = (left + right) - budget;
    if (excess > 0) {
      // Riduci le due colonne PROPORZIONALMENTE a quanto sono comprimibili
      // sopra il loro minimo: chi ha più margine cede più spazio.
      const shrinkL = left - minLeft;
      const shrinkR = right - minRight;
      const total = shrinkL + shrinkR;
      if (total > 0) {
        const cut = Math.min(excess, total);
        const cutL = Math.round(cut * (shrinkL / total));
        left  = Math.max(minLeft,  left - cutL);
        right = Math.max(minRight, right - (cut - cutL));
      }
      // Se nemmeno ai minimi ci stanno (finestra minuscola) restano ai minimi:
      // la colonna centrale si stringe sotto il suo minimo, ma nessuna colonna
      // esce dal riquadro sovrapponendosi al testo delle altre.
    }
    return { left, right };
  }

  global.SN_PANE_LAYOUT = { fitWidths };
})(typeof globalThis !== 'undefined' ? globalThis : self);
