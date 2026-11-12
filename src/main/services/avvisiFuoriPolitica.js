// L'avviso di una risposta servita da un host che la politica esclude (#1478): uno per host e motivo, in coda finché
// una pagina davanti agli occhi lo prende (#1478.1). Niente Electron: chi lo crea dice come si spinge alle schede.
// Regole: tests/unit/avvisiFuoriPolitica.test.mjs.
'use strict';

const crypto = require('node:crypto');

// Una pagina tradotta a pezzi dallo stesso host non ne impila cinquanta: la pausa parte da quando uno si è visto.
const PAUSA_MS = 10 * 60 * 1000;

// `manda(messaggio)` lo offre alle schede: lo mostra solo quella in vista, che prima lo prende.
function crea({ manda, ora = Date.now, nuovoId = () => crypto.randomUUID() } = {}) {
  const mostrati = new Map(); // chiave → quando si è visto
  const inCoda = new Map(); // chiave → { messaggio, alMostrare }

  // `componi()` dà { messaggio, alMostrare? }: si scrive solo se l'avviso parte davvero.
  function avvisa(chiave, componi) {
    const k = String(chiave || '');
    if (!k || ora() - (mostrati.get(k) || 0) < PAUSA_MS) return null;
    let voce = inCoda.get(k);
    if (!voce) {
      const c = componi() || {};
      if (!c.messaggio) return null;
      voce = { messaggio: { ...c.messaggio, avviso: nuovoId() }, alMostrare: c.alMostrare };
      inCoda.set(k, voce);
    }
    // Lo stesso oggetto a ogni offerta: entra nel filo una volta sola (accaduti.avviso).
    try { manda(voce.messaggio); } catch (_) {}
    return voce.messaggio;
  }

  // Li prende la pagina che li mostra adesso: da qui parte la pausa. Con `id` solo quello, senza tutti quelli in coda.
  function prendi(id) {
    const presi = [];
    for (const [k, voce] of inCoda) {
      if (id && voce.messaggio.avviso !== id) continue;
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

  const inAttesa = () => [...inCoda.values()].map((v) => v.messaggio);
  return { avvisa, prendi, inAttesa, riproponi };
}

module.exports = { crea, PAUSA_MS };
