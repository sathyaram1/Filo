// Dove sta nel repo il file di filo://<host>/<rel>, a barre normali: la tabella sola, per il protocollo (protocol.js,
// che controlla anche il confine) e per la mappa prova → file della suite (#2502). Pura, senza Electron.

function percorsoFilo(host, rel) {
  const r = String(rel || '');
  if (host === 'shell') return `src/renderer/${r || 'shell.html'}`;
  // La home sta nella cartella dashboard: «newtab.html» è il nome che la regola <host>/<host>.html delle altre
  // pagine fa scrivere, e deve aprire la home invece di un file che non c'è (#830.4).
  if (host === 'newtab') return `src/pages/dashboard/${!r || r.toLowerCase() === 'newtab.html' ? 'dashboard.html' : r}`;
  if (host === 'asset') return `assets/${r}`;
  if (host === 'style') return `src/styles/${r}`;
  if (host === 'shared') return `src/shared/${r}`;
  // Il codice portato chiama chrome.runtime.getURL('src/...') e lo shim costruisce filo://src/..., che atterra qui.
  if (host === 'src') return `src/${r}`;
  return `src/pages/${host}/${r || `${host}.html`}`;
}

module.exports = { percorsoFilo };
