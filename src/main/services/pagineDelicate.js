// Le pagine delicate lato main (#1004): ricorda per la sessione i siti che hanno mostrato un campo password o carta, e
// dà ai lavori automatici una domanda sola, «questa pagina è delicata?», con impostazioni ed elenco remoto di adesso.
// La regola sta in src/shared/pagineDelicate.js; qui non si salva niente su disco.

const { getDomainInfo } = require('./safebrowse/psl');

const PD = globalThis.SN_PAGINE_DELICATE || require('../../shared/pagineDelicate.js');

// Per dominio registrabile: chi entra da accesso.banca.it e poi legge i movimenti su online.banca.it resta sullo stesso sito.
const conCampi = new Set();

function chiave(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!h) return '';
  let info = null;
  try { info = getDomainInfo(h); } catch (_) { info = null; }
  return (info && info.registrable) || h;
}

function segnaCampi(url) {
  const k = chiave(PD.host(url));
  if (k) conCampi.add(k);
}

function haCampi(host) {
  const k = chiave(host);
  return Boolean(k) && conCampi.has(k);
}

function elencoRemoto() {
  try { return require('./defaultsStore').get().sitiDelicati; } catch (_) { return null; }
}

// Un predicato sincrono (url → motivo | null) con le impostazioni di adesso: chi controlla molte pagine lo chiede una volta.
async function filtro(settingsIn) {
  let settings = settingsIn;
  if (!settings) {
    try { settings = await globalThis.SN_STORAGE.getSettings(); } catch (_) { settings = null; }
  }
  const opzioni = {
    attivo: PD.attivo(settings),
    sitiUtente: PD.sitiUtente(settings),
    elenco: PD.elenco(elencoRemoto()),
    campi: haCampi,
  };
  const f = (url) => PD.classifica(url, opzioni);
  f.attivo = opzioni.attivo;
  // Una scheda archiviata porta il motivo di quando si è chiusa: la memoria dei campi visti non sopravvive al riavvio.
  f.voce = (it) => (opzioni.attivo && it && it.delicata) || f(it && it.url);
  return f;
}

globalThis.SN_DELICATE = { segnaCampi, haCampi, filtro };

module.exports = globalThis.SN_DELICATE;
