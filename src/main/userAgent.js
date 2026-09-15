// Toglie dalla user-agent i token `<nomeApp>/<ver>` ed `Electron/<ver>` che
// Electron aggiunge: i provider di login (Google in testa) li leggono come
// "browser embedded" e rifiutano l'accesso. Pura, senza Electron: testabile.

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
