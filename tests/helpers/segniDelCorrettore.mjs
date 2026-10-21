// Il riquadro di un segno del correttore, letto in un passo solo: lo strato si ridisegna (fine di un passaggio, un
// controllo che torna) e fra la ricerca e la misura di `boundingBox()` il nodo può essere già sostituito, e dare null.
export function riquadroDelSegno(loc) {
  return loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}
