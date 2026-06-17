// Sceglie le lingue del correttore ortografico nativo (Hunspell/Chromium).
//
// Filo è un'app italiana: l'italiano va sempre attivato per primo (così i
// suggerimenti per le parole italiane — la stragrande maggioranza del testo —
// compaiono in cima). La lingua di sistema viene aggiunta dopo, SE diversa.
//
// Bug #169: la versione precedente forzava SEMPRE anche 'en-US'/'en' nella
// lista. Con il dizionario inglese attivo, Chromium fonde i suggerimenti delle
// due lingue: parole italiane errate (es. "funzion") ricevevano correzioni
// inglesi ("function") in cima. Caricando l'inglese SOLO quando è la lingua di
// sistema, un utente italiano su sistema italiano ottiene suggerimenti
// puramente italiani ("funzione").

(function (global) {
  'use strict';

  function base(s) {
    return String(s || '').toLowerCase().split('-')[0];
  }

  // available: lista dei codici dizionario disponibili (es. ['it','en-US',…]).
  // locale: lingua di sistema (app.getLocale(), es. 'it-IT' o 'en-US').
  // Ritorna i codici da attivare, italiano per primo, senza inglese forzato.
  function select(available, locale) {
    const list = Array.isArray(available) ? available : [];
    if (!list.length) return [];
    const pick = (pref) =>
      list.find((l) => l.toLowerCase() === String(pref).toLowerCase()) ||
      list.find((l) => base(l) === base(pref));

    const want = [];
    for (const pref of ['it', locale]) {
      if (!pref) continue;
      const match = pick(pref);
      if (match && !want.includes(match)) want.push(match);
    }
    return want;
  }

  global.SN_SPELL_LANG = { select };
})(typeof globalThis !== 'undefined' ? globalThis : self);
