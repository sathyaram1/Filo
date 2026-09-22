// Istanti per i test che guardano una finestra «Oggi».
//
// PERCHÉ ESISTE
//   Un test che costruisce un fatto «di dodici ore fa» e poi guarda la
//   finestra «Oggi» è verde dopo mezzogiorno e rosso prima: «Oggi» parte dalla
//   mezzanotte, e prima di mezzogiorno dodici ore fa è ieri. Due controlli
//   delle statistiche dei feedback erano scritti così, e diventavano rossi
//   ogni notte fino a mezzogiorno — dentro il lavoro di release, che parte
//   ogni sei ore, quello vuol dire una pubblicazione su due bloccata da un
//   rosso che non è un rosso.
//
//   Qui l'istante si CHIEDE: `oggiFa(ore)` torna quello che si voleva —
//   qualcosa che è successo poco fa — senza mai uscire dal giorno di oggi,
//   a qualunque ora giri il test.

/** La mezzanotte locale del giorno che contiene `t` (default: adesso). */
export function mezzanotte(t = Date.now()) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Un istante di `ore` ore fa, che però resta dentro OGGI: se a quest'ora
 * quelle ore cadrebbero ieri, si ferma poco dopo la mezzanotte.
 * Ritorna una stringa ISO, come le altre date dei test.
 *
 * `margineMs` è quanto si sta lontani dalla mezzanotte quando si tocca il
 * fondo: serve a chi ha bisogno di due istanti ordinati dentro la stessa
 * giornata (un passaggio e quello dopo).
 */
export function oggiFa(ore, margineMs = 1000) {
  const adesso = Date.now();
  const voluto = adesso - ore * 60 * 60 * 1000;
  const fondo = mezzanotte(adesso) + margineMs;
  return new Date(Math.max(voluto, Math.min(fondo, adesso))).toISOString();
}
