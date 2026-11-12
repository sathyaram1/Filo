// Il freno sulle scansioni per chi lo importa da un modulo: importarlo lo installa. Il nucleo sta in freno-letture.cjs,
// che src/shared/feedback.js carica da sé fuori da Electron. Regole: patterns/una-scansione-chiede-i-campi-che-usa-e-si-paga-una-volta.md

import freno from './freno-letture.cjs';

export const {
  DOCUMENTI_SENZA_CAMPI_MAX, ScansioneSenzaCampi, scansioneSenzaCampi, conFreno, frenoInstallato, installaFreno,
} = freno;
