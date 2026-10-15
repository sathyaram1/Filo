// Come partono le azioni di un giro della chat: aperture di pagina e letture di fila insieme, il resto una dopo l'altra
// perché i suoi esiti decidono i passi dopo. Gli esiti si consegnano sempre nell'ordine del modello.
// Prove: tests/unit/giroAzioni.test.mjs.
'use strict';

// Le letture si controllano contro quello che il modello aveva davanti a inizio giro (#1097.2): gli esiti di questo giro
// non li ha ancora visti, quindi non possono essere finiti in una sua query. Le altre azioni vedono anche quelli.
//   avvia(azione, { contesto, fonti }) → promessa dell'esito
//   dopo(azione, esito)                → lo consegna (e di solito lo aggiunge a `contesto`)
//   fermo()                            → vero se l'utente ha fermato: le azioni non ancora partite non partono
async function eseguiGiro(azioni, { contesto, fonti, avvia, dopo, fermo = () => false, apertura, lettura }) {
  const inizio = { contesto: contesto.slice(), fonti: fonti.slice() };
  const esiti = new Map();
  // Un guasto di un'azione partita insieme alle altre risale quando tocca a lei, non prima e non perso.
  const lancia = (a, ctx) => { const p = avvia(a, ctx); p.catch(() => {}); esiti.set(a, p); };
  for (let i = 0; i < azioni.length; i++) {
    const a = azioni[i];
    if (!esiti.has(a)) {
      if (fermo()) return { fermato: true };
      if (apertura(a)) for (let j = i; j < azioni.length && apertura(azioni[j]); j++) lancia(azioni[j], { contesto, fonti });
      else if (lettura(a)) for (let j = i; j < azioni.length && lettura(azioni[j]); j++) lancia(azioni[j], inizio);
      else lancia(a, { contesto, fonti });
    }
    await dopo(a, await esiti.get(a));
  }
  return { fermato: false };
}

module.exports = { eseguiGiro };
