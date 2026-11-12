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

// Gli stili calcolati di un segno, `{ proprietà: valore }`. Stessa corsa: un nodo già sostituito risponde con stringhe
// vuote, che non vogliono dire «trasparente»; si rilegge finché il nodo letto è ancora nello strato.
export async function stileDelSegno(loc, proprieta, { timeout = 5000 } = {}) {
  const fine = Date.now() + timeout;
  for (;;) {
    const v = await loc.evaluate((el, ps) => {
      if (!el.isConnected) return null;
      const cs = getComputedStyle(el);
      return Object.fromEntries(ps.map((p) => [p, cs.getPropertyValue(p)]));
    }, proprieta, { timeout });
    if (v) return v;
    if (Date.now() > fine) throw new Error(`il segno ${loc} non resta nello strato abbastanza per leggerne lo stile`);
    await new Promise((ok) => setTimeout(ok, 50));
  }
}
