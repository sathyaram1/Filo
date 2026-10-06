// Riprova a tempo di uno scaricamento di lista fallito (liste dei banner dei cookie e della pubblicità).
// Senza, una prima apertura senza rete lasciava la lista vuota fino al riavvio o per una settimana (#754).

'use strict';

const DELAYS_MS = [60e3, 5 * 60e3, 15 * 60e3, 60 * 60e3, 6 * 60 * 60e3];

// `run` ritorna { ok }; `isOn` dice se la lista serve ancora. Ritorna la funzione che avvia un giro.
function makeRetry(run, isOn) {
  let timer = null;
  let attempt = 0;
  function schedule() {
    if (timer || !isOn()) return;
    const ms = DELAYS_MS[Math.min(attempt, DELAYS_MS.length - 1)];
    attempt++;
    timer = setTimeout(() => { timer = null; start(); }, ms);
    if (timer && timer.unref) timer.unref();
  }
  function start() {
    if (!isOn()) return Promise.resolve(null);
    return Promise.resolve()
      .then(run)
      .then((r) => { if (r && r.ok) attempt = 0; else schedule(); return r; }, () => { schedule(); return null; });
  }
  return start;
}

module.exports = { makeRetry, DELAYS_MS };
