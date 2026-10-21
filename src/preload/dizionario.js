// Il dizionario del correttore del browser, chiesto parola per parola (#1446): i segni li disegna Filo, il browser dice
// solo quali parole non conosce e cosa propone. Senza dizionario caricato ogni parola risulta giusta, mai un errore finto.

'use strict';

module.exports = function dizionario(webFrame) {
  return Object.freeze({
    sbagliata(parola) {
      try { return Boolean(webFrame && webFrame.isWordMisspelled(String(parola || ''))); } catch (_) { return false; }
    },
    proposte(parola) {
      try { return (webFrame && webFrame.getWordSuggestions(String(parola || ''))) || []; } catch (_) { return []; }
    },
  });
};
