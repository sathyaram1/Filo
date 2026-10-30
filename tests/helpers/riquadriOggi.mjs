// I conti del documento dei riquadri (#1465, #1586) nelle ore di oggi, letti dallo stato del main: la prova che una
// funzione emette la sua misura. Una voce per nome con l'elenco dell'app, solo i conti sopra zero.

export async function voceOggi(app, misura, chiave) {
  return app.evaluate(async (_e, { misura: m, chiave: k }) => {
    const C = globalThis.SN_CONTATORI;
    const s = await globalThis.SN_CONTATORI_MAIN.letto();
    const g = C.giornoDi(Date.now());
    let somma = null;
    for (const [id, ora] of Object.entries(s.ore || {})) {
      const conti = id.startsWith(`${g}T`) && ora[m] ? ora[m][k] : null;
      if (!Array.isArray(conti)) continue;
      somma = somma || conti.map(() => 0);
      conti.forEach((n, i) => { somma[i] += n; });
    }
    if (!somma) return null;
    const nomi = C.RIQUADRI[m].gruppi.flat();
    return Object.fromEntries(nomi.map((n, i) => [n, somma[i]]).filter(([, n]) => n > 0));
  }, { misura, chiave });
}
