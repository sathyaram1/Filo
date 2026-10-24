// Lingue del correttore nativo: italiano sempre per primo, l'inglese solo se è
// la lingua di sistema. Col dizionario inglese attivo Chromium fonde i suggerimenti
// e una parola italiana errata («funzion») riceve correzioni inglesi («function») (#169).

(function (global) {
  'use strict';

  function base(s) {
    return String(s || '').toLowerCase().split('-')[0];
  }

  // available: lista dei codici dizionario disponibili (es. ['it','en-US',…]).
  // locale: lingua di sistema (app.getLocale(), es. 'it-IT' o 'en-US').
  // inclusi: i dizionari che Filo ha con sé, quando sono gli unici che si caricano (#1084): fra le varianti di una
  // lingua vince quella inclusa, così «en-AU» prende «en-GB» invece di restare senza dizionario.
  // Ritorna i codici da attivare, italiano per primo, senza inglese forzato.
  function select(available, locale, inclusi) {
    const list = Array.isArray(available) ? available : [];
    if (!list.length) return [];
    const nostri = Array.isArray(inclusi) ? list.filter((l) => inclusi.includes(l)) : [];
    const trova = (elenco, pref) =>
      elenco.find((l) => l.toLowerCase() === String(pref).toLowerCase()) ||
      elenco.find((l) => base(l) === base(pref));
    const pick = (pref) => trova(nostri, pref) || trova(list, pref);

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
