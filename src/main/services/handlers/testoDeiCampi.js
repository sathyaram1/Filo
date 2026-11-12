// Il testo dei campi che non si perde (#2378). TESTO_CAMPI è aperto ai siti di proposito: la pagina la ricava il main
// dal frame che parla. Stato e cancellazione sono delle Preferenze. Regole: src/main/services/testoDeiCampi.js.

const { soloFilo } = require('./origine');
const Testo = require('../testoDeiCampi');

module.exports = function register(on, ctx) {
  const { MSG } = ctx;
  on(MSG.TESTO_CAMPI, (msg, sender) => Testo.daContenuto(msg, sender));
  on(MSG.TESTO_CAMPI_STATO, soloFilo(() => Testo.stato()));
  on(MSG.TESTO_CAMPI_CANCELLA, soloFilo(() => Testo.cancellaTutto()));
};
