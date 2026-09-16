// Lingue del correttore nativo: italiano sempre per primo, l'inglese solo se è
// la lingua di sistema. Col dizionario inglese attivo Chromium fonde i suggerimenti
// e una parola italiana errata («funzion») riceve correzioni inglesi («function») (#169).

(function (global) {
  'use strict';

  function base(s) {
    return String(s || '').toLowerCase().split('-')[0];
  }

  // `available`: codici dizionario disponibili. `locale`: lingua di sistema
  // (app.getLocale(), es. 'it-IT').
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
