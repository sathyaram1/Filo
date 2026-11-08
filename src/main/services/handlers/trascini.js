// I trascinamenti interni (#2300): scrive e prende il contenuto solo una pagina di Filo, così un sito che scrive il tipo
// non ha un gettone che valga. Il registro: src/main/services/trasciniInterni.js.

const { soloFilo } = require('./origine');
const Registro = require('../trasciniInterni').crea();

module.exports = function registraTrascini(on) {
  const { MSG } = globalThis.SN_MSG;
  on(MSG.TRASCINO_INTERNO_PARTE, soloFilo(async (msg) => Registro.parte(msg && msg.gettone, msg && msg.cosa, msg && msg.dati)));
  on(MSG.TRASCINO_INTERNO_ARRIVA, soloFilo(async (msg) => Registro.arriva(msg && msg.gettone, msg && msg.cosa)));
};
