// Che forma prende un avviso secondo dove sta l'utente (#2390): la regola sola, che la shell chiede per ogni avviso.
// Non disegna niente. Sentinella: tests/unit/formaAvviso.test.mjs.

(function (global) {
  'use strict';
  if (global.SN_FORMA_AVVISO) return;

  // Fuori da Filo l'unica strada è la notifica del sistema; davanti a una pagina l'angolo in basso a destra; nella
  // home la carta che già racconta la stessa cosa si fa notare lei, e senza carta l'avviso finisce nella colonna
  // delle carte (subito, se il sistema chiede meno movimento: il volo è proprio il movimento).
  function forma({ davanti = true, home = false, haCarta = false, riduciMovimento = false } = {}) {
    if (!davanti) return 'sistema';
    if (!home) return 'angolo';
    if (haCarta) return 'carta';
    return riduciMovimento ? 'colonna' : 'angolo';
  }

  // Finito il tempo di lettura: nella home l'avviso vola nella colonna e resta lì, altrove se ne va.
  function allaScadenza({ home = false } = {}) {
    return home ? 'vola' : 'chiudi';
  }

  // Un avviso che resta finché lo si chiude (durata 0): nella home sta nell'angolo solo il tempo di leggerlo.
  function tempoNellAngolo(durataMs, { home = false, letturaMs = 5000 } = {}) {
    const d = Number(durataMs) || 0;
    if (!home) return d;
    return d > 0 ? d : Math.max(1, Number(letturaMs) || 5000);
  }

  // L'icona di un avviso: quella che chiede chi lo manda, se no dalla cosa che racconta.
  const ICONE = ['bell', 'warning', 'timer', 'alarm', 'download', 'globe', 'reload', 'blocked', 'check', 'sparkles'];
  function icona({ icona: chiesta = '', carta = '', errore = false } = {}) {
    if (ICONE.includes(chiesta)) return chiesta;
    if (errore) return 'warning';
    const tipo = String(carta || '').split(':')[0];
    if (tipo === 'download') return 'download';
    if (tipo === 'timer') return 'timer';
    return 'bell';
  }

  global.SN_FORMA_AVVISO = { forma, allaScadenza, tempoNellAngolo, icona, ICONE };
})(typeof globalThis !== 'undefined' ? globalThis : self);
