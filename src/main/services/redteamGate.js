// Chi vede il Red Team (#896): interruttore `config/redteam.openToAll` acceso, oppure owner (cancelloOwner.js).
// Home, tasto destro, pagina, manifesto e handler REDTEAM_* chiedono qui. Prove: tests/redteam-pausa.spec.mjs.

'use strict';

const { creaCancello } = require('./cancelloOwner');
const Defaults = require('./defaultsStore');

const FRASE_PAUSA = 'Il Red Team è in pausa: tornerà dopo il rilascio';

const cancello = creaCancello({
  leggi: () => Defaults.getRedteamOpen(),
  scrivi: (on, idToken) => Defaults.setRedteamOpen(on, idToken),
  soloOwner: 'Solo l’owner apre o mette in pausa il Red Team.',
});

module.exports = { FRASE_PAUSA, ...cancello };
