// La tabella che decide se un'uscita si fa, si chiede o si propone (#530/#533).
// I livelli sono DATI perché la scelta è dell'utente, non del modello.
// Il perimetro lo tiene src/shared/compiti.js; qui si decide e basta.

(function (global) {
  'use strict';

  // `ordine` serve solo a confrontarli fra loro (più alto = più mano libera).
  const LIVELLI = {
    conservativo: { ordine: 0, label: 'Conservativo' },
    default: { ordine: 1, label: 'Predefinito' },
    automatico: { ordine: 2, label: 'Automatico' },
    yolo: { ordine: 3, label: 'Mano libera' },
  };

  const LIVELLO_PREDEFINITO = 'default';

  function livelloValido(l) {
    return Object.prototype.hasOwnProperty.call(LIVELLI, String(l || ''));
  }

  // 'fa' | 'chiede' | 'propone'. `guardiano` è il guardiano di uscita che
  // #533 pretende per lasciar correre un compito contaminato: finché non
  // esiste nessuno lo passa vero, e automatico e yolo chiedono come gli altri.
  function decidi({ livello, perimetro, origine, guardiano = false } = {}) {
    const l = livelloValido(livello) ? String(livello) : LIVELLO_PREDEFINITO;
    if (perimetro !== 'fuori') return 'fa';
    // Un'automazione gira senza nessuno davanti allo schermo: un popup lì è una
    // cosa che non risponde mai, quindi la richiesta diventa una notifica.
    if (String(origine || '') === 'automazione') return 'propone';
    if (LIVELLI[l].ordine >= LIVELLI.automatico.ordine && guardiano === true) return 'fa';
    return 'chiede';
  }

  global.SN_AUTONOMIA = { LIVELLI, LIVELLO_PREDEFINITO, livelloValido, decidi };
})(typeof globalThis !== 'undefined' ? globalThis : self);
