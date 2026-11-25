// Gli avvisi che contano come detti solo quando una pagina davanti agli occhi li prende (#1478.1): l'host che la politica
// esclude (#1478), uno per host e motivo, e il ripiego sui crediti di Filo (#662.1). Niente Electron: chi lo crea dice
// come si spinge alle schede. Regole: tests/unit/avvisiFuoriPolitica.test.mjs.
'use strict';

const crypto = require('node:crypto');

// Una pagina tradotta a pezzi dallo stesso host non ne impila cinquanta: la pausa parte da quando uno si è visto.
const PAUSA_MS = 10 * 60 * 1000;

// `manda(messaggio)` lo offre alle schede: lo mostra solo quella in vista, che prima lo prende.
function crea({ manda, ora = Date.now, nuovoId = () => crypto.randomUUID() } = {}) {
  const mostrati = new Map(); // chiave → quando si è visto
  const inCoda = new Map(); // chiave → { messaggio, alMostrare }

  // `dettoAltrove(davanti)` della voce dice se la scheda davanti (`davanti.scheda`, o quella che sa lui) lo mostra già
  // in un altro modo: allora esce dalla coda senza partire, e la pausa la tiene lui.
  function giaDetto(k, voce, davanti) {
    let detto = false;
    try { detto = typeof voce.dettoAltrove === 'function' && voce.dettoAltrove(davanti || {}) === true; } catch (_) {}
    if (detto && inCoda.get(k) === voce) inCoda.delete(k);
    return detto || inCoda.get(k) !== voce;
  }

  // Lo stesso oggetto a ogni offerta: entra nel filo una volta sola (accaduti.avviso).
  function offri(k, voce) {
    if (giaDetto(k, voce)) return false;
    try { manda(voce.messaggio); } catch (_) {}
    return true;
  }

  // `componi()` dà { messaggio, alMostrare?, dettoAltrove? }: si scrive solo se l'avviso parte davvero.
  function avvisa(chiave, componi) {
    const k = String(chiave || '');
    if (!k || ora() - (mostrati.get(k) || 0) < PAUSA_MS) return null;
    let voce = inCoda.get(k);
    if (!voce) {
      const c = componi() || {};
      if (!c.messaggio) return null;
      voce = { messaggio: { ...c.messaggio, avviso: nuovoId() }, alMostrare: c.alMostrare, dettoAltrove: c.dettoAltrove };
      inCoda.set(k, voce);
    }
    return offri(k, voce) ? voce.messaggio : null;
  }

  // Li prende la pagina che li mostra adesso (`davanti.scheda`): da qui parte la pausa. Con `id` solo quello, senza
  // tutti quelli in coda.
  function prendi(id, davanti) {
    const presi = [];
    for (const [k, voce] of [...inCoda]) {
      if (id && voce.messaggio.avviso !== id) continue;
      if (giaDetto(k, voce, davanti)) continue;
      inCoda.delete(k);
      mostrati.set(k, ora());
      try { if (typeof voce.alMostrare === 'function') voce.alMostrare(); } catch (_) {}
      presi.push(voce.messaggio);
    }
    return presi;
  }

  // Tornati su Filo da una parte che non dà il fuoco alla pagina (la barra delle schede): si offrono di nuovo.
  function riproponi() {
    for (const voce of inCoda.values()) { try { manda(voce.messaggio); } catch (_) {} }
  }

  // Detto altrove, o non più vero: esce dalla coda senza contare come visto, e la sua pausa la tiene chi lo ritira.
  function ritira(chiave) {
    const k = String(chiave || '');
    inCoda.delete(k);
    mostrati.delete(k);
  }

  const inAttesa = () => [...inCoda.values()].map((v) => v.messaggio);
  return { avvisa, prendi, inAttesa, riproponi, ritira };
}

module.exports = { crea, PAUSA_MS };
