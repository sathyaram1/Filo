// SINGOLA SORGENTE del recap aggiornamento (popup all'avvio) e del calcolo
// "quante patch sei indietro". Vedi CLAUDE.md → "Patch notes".
//
// Ogni volta che chiudi un fix o aggiungi una feature VISIBILE all'utente,
// aggiungi una riga al blocco della versione corrente (features/fixes), in
// italiano e NON tecnica. Le voci interne (refactor/test/infra) NON vanno qui.
//
// Formato (lista ordinata dalla versione PIÙ RECENTE alla più vecchia):
//   { version: '0.2.50', date: '2026-06-18',
//     features: ['Testo per l’utente…'],
//     fixes: ['Testo per l’utente…'] }

(function (global) {
  'use strict';

  const NOTES = [
    // ↓ Nuove versioni in cima. Esempio di forma (da popolare nei task C2–C5):
    // {
    //   version: '0.2.50', date: '2026-06-18',
    //   features: ['Nuova pagina Crediti nel profilo: vedi quanto ti resta e come lo usi.'],
    //   fixes: [],
    // },
  ];

  // Confronto versioni stile semver leggero ('0.2.49' vs '0.2.5' → corretto).
  function cmpVersion(a, b) {
    const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d < 0 ? -1 : 1;
    }
    return 0;
  }

  // Note delle versioni STRETTAMENTE successive a `lastSeen` (escluso), fino a
  // `current` incluso. Se `lastSeen` è nullo/assente → tutte (primo avvio non
  // mostra nulla a sorpresa: lo decide il chiamante). Ordinate dalla più recente.
  function since(lastSeen, current = latestVersion()) {
    return NOTES
      .filter((n) => cmpVersion(n.version, current) <= 0
        && (!lastSeen || cmpVersion(n.version, lastSeen) > 0))
      .sort((x, y) => cmpVersion(y.version, x.version));
  }

  // Quante "patch" (versioni con note) separano lastSeen da current.
  function countBehind(lastSeen, current = latestVersion()) {
    return since(lastSeen, current).length;
  }

  function latestVersion() {
    return NOTES.length ? NOTES[0].version : '0.0.0';
  }

  global.SN_PATCH_NOTES = { NOTES, cmpVersion, since, countBehind, latestVersion };
})(typeof globalThis !== 'undefined' ? globalThis : self);
