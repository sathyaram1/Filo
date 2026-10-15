// Il passo prima che electron-builder chiuda l'asar: il preload delle pagine web impacchettato per la sandbox
// (src/main/preloadPacchetto.js), che il pacchetto usa così com'è. Non decide niente: scrive dai sorgenti di adesso,
// sempre uguale a sé stesso (il Mac universale impacchetta due copie che devono coincidere).

const { scrivi, NEL_PACCHETTO } = require('../src/main/preloadPacchetto');

exports.default = async function beforePack() {
  scrivi(NEL_PACCHETTO);
  console.log(`[before-pack] preload delle pagine web impacchettato: ${NEL_PACCHETTO}`);
};
