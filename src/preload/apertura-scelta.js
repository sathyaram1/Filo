// L'aggancio con cui le voci del menu di Filo dichiarano al main l'indirizzo che aprono, per pagine web e pagine di Filo:
// un cammino solo (#1461.1). `azione`: la voce che apre, misurata dal main fino alla pagina caricata (#1461).
module.exports = (ipcRenderer) => (url, azione) => {
  const a = azione && typeof azione === 'object' ? { id: String(azione.id || ''), t0: Number(azione.t0) } : null;
  try { ipcRenderer.sendSync('filo:apertura-scelta', String(url || ''), a); } catch (_) {}
};
