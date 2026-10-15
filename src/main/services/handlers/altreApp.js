// #779 — le porte della pagina Preferenze verso il componente delle altre applicazioni. Installano un programma e aprono i
// pannelli del sistema: nessun sito le raggiunge (soloFilo). Accendere e spegnere passa dalle impostazioni, non da qui.
'use strict';

const { soloFilo } = require('./origine');

module.exports = function register(on, ctx) {
  const { MSG, broadcastToFiloPages } = ctx;
  const AltreApp = require('../altreApp');

  AltreApp.suCambio((stato) => broadcastToFiloPages({ type: MSG.ALTRE_APP_CAMBIATO, stato }));

  on(MSG.ALTRE_APP_STATO, soloFilo(async () => ({ ok: true, stato: await AltreApp.statoPerPagina({ verifica: true }) })));
  on(MSG.ALTRE_APP_REINSTALLA, soloFilo(async () => AltreApp.reinstalla()));
  on(MSG.ALTRE_APP_PERMESSO, soloFilo(async (msg) => {
    const id = msg && typeof msg.permesso === 'string' ? msg.permesso : '';
    return AltreApp.chiediPermesso(id);
  }));
};
