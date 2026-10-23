// Il dizionario del correttore, chiesto parola per parola (#1446): i segni li disegna Filo, il dizionario dice solo quali
// parole non conosce e cosa propone. Risponde quello di Filo, uguale su ogni sistema (#1585); finché non è pronto, quello
// del browser. Senza nessuno dei due ogni parola risulta giusta, mai un errore finto.

'use strict';

module.exports = function dizionario(ipcRenderer, webFrame) {
  const chiedi = (canale, dato) => { try { return ipcRenderer.sendSync(canale, dato); } catch (_) { return null; } };
  const delBrowser = (p) => { try { return Boolean(webFrame && webFrame.isWordMisspelled(p)); } catch (_) { return false; } };
  function sbagliate(parole) {
    const lista = (Array.isArray(parole) ? parole : []).map((p) => String(p ?? ''));
    if (!lista.length) return [];
    const r = chiedi('filo:dizionario-sbagliate', lista);
    return lista.map((p, i) => (Array.isArray(r) && typeof r[i] === 'boolean' ? r[i] : delBrowser(p)));
  }
  return Object.freeze({
    sbagliate,
    sbagliata(parola) { return sbagliate([parola])[0]; },
    proposte(parola) {
      const p = String(parola ?? '');
      const r = chiedi('filo:dizionario-proposte', p);
      if (Array.isArray(r)) return r.filter((x) => typeof x === 'string');
      try { return (webFrame && webFrame.getWordSuggestions(p)) || []; } catch (_) { return []; }
    },
  });
};
