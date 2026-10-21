// La Bacheca e il Deck builder dei Mazzi in pausa per chi non è owner, finché l'owner non li apre a tutti (#1592).
// Un interruttore ciascuno (config/bacheca, config/mazzi), come il Red Team; la logica sta in cancelloOwner.js.
// Chi decide cosa mostrare chiede qui. Prove: tests/unit/inPausa.test.mjs, tests/in-pausa.spec.mjs.

'use strict';

const { creaCancello } = require('./cancelloOwner');
const Defaults = require('./defaultsStore');

const FRASI_PAUSA = Object.freeze({
  bacheca: 'La Bacheca è in pausa: tornerà più avanti',
  mazzi: 'Il Deck builder è in pausa: tornerà più avanti',
});
const NOMI = Object.freeze(Object.keys(FRASI_PAUSA));

const cancelli = Object.freeze(Object.fromEntries(NOMI.map((nome) => [nome, creaCancello({
  leggi: () => Defaults.getApertoATutti(nome),
  scrivi: (on, idToken) => Defaults.setApertoATutti(nome, on, idToken),
  soloOwner: 'Solo l’owner apre o mette in pausa questa funzione.',
})])));

const valido = (nome) => typeof nome === 'string' && Object.prototype.hasOwnProperty.call(cancelli, nome);

function cancello(nome) {
  if (!valido(nome)) throw new Error(`Funzione sconosciuta: ${nome}`);
  return cancelli[nome];
}

/** { bacheca: stato, mazzi: stato } senza aspettare; la copia scaduta si rilegge in sottofondo. */
function stati() {
  return Object.fromEntries(NOMI.map((n) => [n, cancelli[n].aggiorna()]));
}

async function statiSicuri() {
  const coppie = await Promise.all(NOMI.map(async (n) => [n, await cancelli[n].assicura()]));
  return Object.fromEntries(coppie);
}

/** Il solo sì/no di ognuna, senza rileggere: per i manifesti e i menu calcolati al volo. */
function aperti() {
  return Object.fromEntries(NOMI.map((n) => [n, cancelli[n].visibile()]));
}

/** `fn(nome, stato)` a ogni cambio di «visibile» di una delle due. */
function suCambio(fn) {
  const via = NOMI.map((n) => cancelli[n].suCambio((s) => fn(n, s)));
  return () => { for (const v of via) v(); };
}

function accessoCambiato() {
  for (const n of NOMI) cancelli[n].accessoCambiato();
}

module.exports = { NOMI, FRASI_PAUSA, valido, cancello, stati, statiSicuri, aperti, suCambio, accessoCambiato };
