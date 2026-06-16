// Pulizia della UA del browser. Di default Electron infila nella user-agent i
// token `<nomeApp>/<ver>` (es. `filo/0.2.47`) ed `Electron/<ver>`. Diversi
// provider di login — Google, e di riflesso l'accesso a Claude e a molti altri
// siti — leggono quei token come "browser embedded / non sicuro" e RIFIUTANO
// l'accesso con un errore generico ("Si è verificato un errore durante
// l'accesso"). Togliendoli, le pagine esterne vedono una UA Chrome del tutto
// normale e i login funzionano come in un browser desktop qualunque.
//
// Funzione pura (niente Electron) così è testabile a unità.

function stripEmbeddedUaTokens(ua, appName) {
  if (!ua) return ua || '';
  let out = String(ua);
  if (appName) {
    const esc = String(appName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp('\\s*' + esc + '\\/[\\d.]+', 'i'), '');
  }
  out = out.replace(/\s*Electron\/[\d.]+/i, '');
  return out.replace(/\s{2,}/g, ' ').trim();
}

module.exports = { stripEmbeddedUaTokens };
