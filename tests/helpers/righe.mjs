// Quante RIGHE DI TESTO occupa il contenuto di un elemento.
//
// Perché esiste questo file. Il modo ovvio di chiederlo è prendere i rettangoli
// del contenuto (`Range.getClientRects()`) e contare quanti bordi alti diversi
// ci sono. Funziona finché tutti i pezzi hanno lo stesso corpo: appena uno è più
// piccolo (il numero accanto al nome di una scheda è a 13px, il nome a 14px) i
// due rettangoli hanno altezze diverse e quindi bordi alti diversi, pur stando
// sulla STESSA riga. Su uno schermo al 100% i due numeri cadono sullo stesso
// intero e non si nota; al 125% no (109,6 contro 108,8), e il controllo dice
// "spezzata su due righe" di una scheda che è tutta su una riga sola.
//
// Contare i rettangoli e basta è ancora peggio: un nome più un numero fanno due
// rettangoli anche quando sono affiancati.
//
// La domanda giusta non è "hanno lo stesso bordo alto" ma "si sovrappongono in
// verticale": due pezzi della stessa riga si coprono quasi per intero, due pezzi
// su righe diverse non si toccano. Questo file fa quello, e non dipende dal
// fattore di scala dello schermo.

// Sorgente della funzione che gira DENTRO la pagina: la si passa come stringa
// perché `page.evaluate` non sa serializzare funzioni negli argomenti.
const CONTA = `(el) => {
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
  const linee = [];
  for (const r of rects) {
    const l = linee.find((x) => {
      const coperta = Math.min(x.bottom, r.bottom) - Math.max(x.top, r.top);
      return coperta > Math.min(x.bottom - x.top, r.bottom - r.top) / 2;
    });
    if (l) { l.top = Math.min(l.top, r.top); l.bottom = Math.max(l.bottom, r.bottom); }
    else linee.push({ top: r.top, bottom: r.bottom });
  }
  return linee.length;
}`;

/**
 * Per ogni elemento che risponde al selettore: il suo testo e quante righe
 * occupa. Salta gli elementi nascosti, che di righe non ne occupano nessuna.
 */
export function righeDiTesto(page, selettore) {
  return page.evaluate(([sel, sorgente]) => {
    const conta = eval(sorgente);
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      if (el.hidden || !el.getClientRects().length) continue;
      out.push({ testo: (el.textContent || '').trim(), righe: conta(el) });
    }
    return out;
  }, [selettore, CONTA]);
}
