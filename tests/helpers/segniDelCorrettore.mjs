// Il riquadro di un segno del correttore. Lo strato si ridisegna (fine di un passaggio, un controllo che torna) e fra
// la ricerca e la misura di `boundingBox()` il nodo può essere già sostituito: null vuol dire «riprova», non «non c'è».
export async function riquadroDelSegno(loc, { timeout = 5000 } = {}) {
  const fine = Date.now() + timeout;
  for (;;) {
    const b = await loc.boundingBox({ timeout });
    if (b && b.width > 0) return b;
    if (Date.now() > fine) throw new Error(`il segno ${loc} non ha un riquadro`);
    await new Promise((ok) => setTimeout(ok, 50));
  }
}
