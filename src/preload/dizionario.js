// Il dizionario del correttore, chiesto parola per parola (#1446): i segni li disegna Filo, il dizionario dice solo quali
// parole non conosce e cosa propone. Risponde quello di Filo, uguale su ogni sistema (#1585); finché non è pronto, quello
// del browser. Senza nessuno dei due ogni parola risulta giusta, mai un errore finto.

'use strict';

// `lingua` ('it', 'en'): quella del testo (#2756); senza, le lingue di serie. Il browser non la sa: risponde con le sue.
module.exports = function dizionario(ipcRenderer, webFrame) {
  const chiedi = (canale, dato, lingua) => {
    try { return typeof lingua === 'string' && lingua ? ipcRenderer.sendSync(canale, dato, lingua) : ipcRenderer.sendSync(canale, dato); } catch (_) { return null; }
  };
  const delBrowser = (p) => { try { return Boolean(webFrame && webFrame.isWordMisspelled(p)); } catch (_) { return false; } };
  function sbagliate(parole, lingua) {
    const lista = (Array.isArray(parole) ? parole : []).map((p) => String(p ?? ''));
    if (!lista.length) return [];
    const r = chiedi('filo:dizionario-sbagliate', lista, lingua);
    return lista.map((p, i) => (Array.isArray(r) && typeof r[i] === 'boolean' ? r[i] : delBrowser(p)));
  }
  return Object.freeze({
    sbagliate,
    sbagliata(parola, lingua) { return sbagliate([parola], lingua)[0]; },
    proposte(parola, lingua) {
      const p = String(parola ?? '');
      const r = chiedi('filo:dizionario-proposte', p, lingua);
      if (Array.isArray(r)) return r.filter((x) => typeof x === 'string');
      try { return (webFrame && webFrame.getWordSuggestions(p)) || []; } catch (_) { return []; }
    },
  });
};
