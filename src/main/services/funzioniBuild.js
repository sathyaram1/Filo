// Le funzioni che una build può lasciare fuori. Una build da negozio (App Store e Google Play vietano di scaricare
// da YouTube, regola 5.2.3) mette `"filoNegozio": true` nel package.json del pacchetto, con extraMetadata di
// electron-builder: il salvataggio dei video in streaming sparisce, e con lui la sua voce nel manifesto (#1488).

'use strict';

let pkg = {};
try { pkg = require('../../../package.json'); } catch (_) {}

const negozio = pkg.filoNegozio === true;

module.exports = Object.freeze({ negozio, salvaVideoInStreaming: !negozio });
