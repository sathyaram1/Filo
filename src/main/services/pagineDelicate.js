// Le pagine delicate lato main (#1004): ricorda i siti che hanno mostrato un campo password o carta, e dà ai lavori
// automatici una domanda sola, «questa pagina è delicata?», con impostazioni ed elenco remoto di adesso.
// La regola sta in src/shared/pagineDelicate.js; dall'incognito non si scrive niente su disco.

const { getDomainInfo } = require('./safebrowse/psl');

const PD = globalThis.SN_PAGINE_DELICATE || require('../../shared/pagineDelicate.js');

// Per dominio registrabile: chi entra da accesso.banca.it e poi legge i movimenti su online.banca.it resta sullo stesso sito.
const conCampi = new Set();
// Quelli da tenere anche dopo un riavvio: la scheda riaperta è già dentro l'area riservata, dove il campo non c'è.
const salvati = new Set();
let caricati = null;

const chiaveDisco = () => (globalThis.SN_CONST && globalThis.SN_CONST.STORAGE_KEYS.SITI_CON_CAMPI) || 'filo_siti_con_campi';

function carica() {
  if (!caricati) {
    caricati = (async () => {
      try {
        const lista = await globalThis.SN_STORAGE.getRaw(chiaveDisco(), []);
        for (const k of Array.isArray(lista) ? lista : []) {
          if (typeof k === 'string' && k) { conCampi.add(k); salvati.add(k); }
        }
      } catch (_) { caricati = null; }
    })();
  }
  return caricati;
}

function chiave(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!h) return '';
  let info = null;
  try { info = getDomainInfo(h); } catch (_) { info = null; }
  return (info && info.registrable) || h;
}

async function segnaCampi(url, { incognito = false } = {}) {
  const k = chiave(PD.host(url));
  if (!k) return;
  conCampi.add(k);
  if (incognito || salvati.has(k)) return;
  await carica();
  if (salvati.has(k)) return;
  salvati.add(k);
  try { await globalThis.SN_STORAGE.setRaw(chiaveDisco(), [...salvati]); } catch (_) {}
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
  await carica();
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
  // Una scheda archiviata porta il motivo di quando si è chiusa.
  f.voce = (it) => (opzioni.attivo && it && it.delicata) || f(it && it.url);
  return f;
}

globalThis.SN_DELICATE = { segnaCampi, haCampi, filtro, carica };

module.exports = globalThis.SN_DELICATE;
