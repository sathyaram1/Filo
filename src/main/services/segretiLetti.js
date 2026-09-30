// I segreti che Filo ha letto da fuori in questa sessione, da qualunque superficie (#810): l'uscita che ne porta
// uno si ferma in ogni conversazione, non solo in quella che l'ha letto. Solo in memoria, mai a un modello.
// Regole: src/shared/urlExfil.js (valutaUscita); chi legge chiama `ricorda`, la porta delle uscite `tutti`.

// Largo: una pagina di codici di recupero ne ha decine, e il costo per uscita resta di pochi millisecondi.
const MAX_LETTI = 50000;
const letti = new Map();

function aggiungi(x, fonte) {
  if (!x || typeof x.valore !== 'string' || !x.valore) return;
  const k = `${x.regola}:${x.valore.toLowerCase()}`;
  // La prima fonte è quella vera: una frase di Filo che lo ripete dopo non la cambia.
  const prima = letti.get(k);
  letti.delete(k);
  letti.set(k, prima || { valore: x.valore, regola: x.regola, fonte: fonte || x.fonte || 'da fuori' });
  if (letti.size > MAX_LETTI) letti.delete(letti.keys().next().value);
}

function ricorda(testo, fonte) {
  const G = globalThis.SN_GUARDIANO_STATICO;
  if (!G || typeof testo !== 'string' || !testo.trim()) return;
  for (const x of G.segretiNelTesto(testo)) aggiungi(x, fonte);
}

function tutti() {
  return [...letti.values()];
}

function svuota() {
  letti.clear();
}

module.exports = { ricorda, aggiungi, tutti, svuota };
