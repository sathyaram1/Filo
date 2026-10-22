// Le azioni di chi usa Filo, dal gesto alla prima cosa visibile e alla fine (#1461): chi riceve il gesto apre l'azione
// col suo id del manifesto delle capacità, chi fa caricare una pagina dice quale. Senza un gesto in corso `scheda` non
// fa niente: le aperture interne (un ripristino, un link) non sono azioni. Il conto: src/main/services/contatori.js.

const { AsyncLocalStorage } = require('node:async_hooks');

const corrente = new AsyncLocalStorage();

function azione(id, fn, { incognito = null, t0 = null } = {}) {
  let h = null;
  try {
    const C = globalThis.SN_CONTATORI_MAIN;
    h = C && typeof C.azione === 'function' ? C.azione(id, { incognito, t0 }) : null;
  } catch (_) { h = null; }
  if (!h) return fn();
  const ctx = { h, scheda: false };
  const chiudi = (ok) => { if (!ctx.scheda || !ok) h.fine(ok); };
  let r;
  try { r = corrente.run(ctx, fn); } catch (e) { chiudi(false); throw e; }
  if (r && typeof r.then === 'function') return r.then((v) => { chiudi(true); return v; }, (e) => { chiudi(false); throw e; });
  chiudi(true);
  return r;
}

// La pagina che l'azione in corso fa caricare: l'azione si vede al primo DOM pronto e finisce quando smette di caricare.
function scheda(wc) {
  const ctx = corrente.getStore();
  if (!ctx || ctx.scheda || !wc) return;
  ctx.scheda = true;
  try { ctx.h.scheda(wc); } catch (_) {}
}

// Un gesto già misurato: chi apre una pagina dentro un'azione in corso non ne apre un'altra.
function inCorso() { return Boolean(corrente.getStore()); }

module.exports = { azione, scheda, inCorso };
