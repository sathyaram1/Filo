// Dominio registrabile (eTLD+1) di un host, per safebrowse: la regola e la Public Suffix List stanno in
// src/shared/stessoSito.js, che le dà anche alle pagine. Qui si riesportano soltanto.

'use strict';

const Sito = require('../../../shared/stessoSito.js');

module.exports = {
  getDomainInfo: Sito.getDomainInfo,
  isIpAddress: Sito.isIpAddress,
  S3: Sito.S3,
  PRIVATE_AVVISO: Sito.PRIVATE_AVVISO,
  DEL_MARCHIO: Sito.DEL_MARCHIO,
};
