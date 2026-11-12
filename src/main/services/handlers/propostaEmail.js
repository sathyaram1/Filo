// L'email dell'account proposta nei campi di accesso dei siti (#1124). Aperto ai siti di proposito: lo chiama il content
// script del frame col campo, e la risposta non porta mai l'email. Regole: src/main/propostaEmail.js.

const Proposta = require('../../propostaEmail');

module.exports = function register(on, ctx) {
  const { MSG } = ctx;
  on(MSG.PROPOSTA_EMAIL, (msg, sender) => Proposta.daContenuto(msg, sender));
};
