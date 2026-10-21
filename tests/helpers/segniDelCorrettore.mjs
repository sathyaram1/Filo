// Il riquadro di un segno del correttore, cercato e misurato in un passo solo: lo strato si ridisegna (fine di un
// passaggio, un controllo che torna) e fra la ricerca e la misura di un locator il nodo può essere già sostituito.
export async function riquadroDelSegno(page, selettore, { n = 0, testo = null } = {}) {
  const r = await page.waitForFunction(([sel, n, testo]) => {
    const tutti = [...document.querySelectorAll(sel)].filter((el) => testo == null || el.textContent.includes(testo));
    const el = tutti[n];
    if (!el) return null;
    const q = el.getBoundingClientRect();
    return q.width > 0 ? { x: q.x, y: q.y, width: q.width, height: q.height } : null;
  }, [selettore, n, testo], { timeout: 5000 });
  return r.jsonValue();
}
