// Le pagine delicate lato main (#1004): ricorda i siti che hanno mostrato un campo password o carta, e dà ai lavori
// automatici una domanda sola, «questa pagina è delicata?», con impostazioni ed elenco remoto di adesso.
// La regola sta in src/shared/pagineDelicate.js; dall'incognito non si scrive niente su disco.

const { getDomainInfo } = require('./safebrowse/psl');
const { ElencoSiti } = require('./stessoSito');

const PD = globalThis.SN_PAGINE_DELICATE || require('../../shared/pagineDelicate.js');

// Per dominio registrabile: chi entra da accesso.banca.it e poi legge i movimenti su online.banca.it resta sullo stesso sito.
// Un ricordo salvato su gov.it quando contava come un sito solo copre ancora i siti sotto di lui (stessoSito.js).
const conCampi = new ElencoSiti();
// Quelli da tenere anche dopo un riavvio: la scheda riaperta è già dentro l'area riservata, dove il campo non c'è.
const salvati = new Set();
let caricati = null;
let letti = false;

const chiaveDisco = () => (globalThis.SN_CONST && globalThis.SN_CONST.STORAGE_KEYS.SITI_CON_CAMPI) || 'filo_siti_con_campi';

function carica() {
  if (!caricati) {
    caricati = Promise.resolve().then(async () => {
      const lista = await globalThis.SN_STORAGE.getRaw(chiaveDisco(), []);
      for (const k of Array.isArray(lista) ? lista : []) {
        if (typeof k === 'string' && k) { conCampi.add(k); salvati.add(k); }
      }
      letti = true;
    }).catch(() => { caricati = null; });
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
  // Senza aver letto quelli già salvati, scrivere li cancellerebbe.
  if (!letti || salvati.has(k)) return;
  salvati.add(k);
  try { await globalThis.SN_STORAGE.setRaw(chiaveDisco(), [...salvati]); } catch (_) {}
}

// Cancellate le pagine visitate di un sito, o tutte, se ne va anche il ricordo del suo campo password: è una traccia
// di dove si è stati. Un periodo parziale non dice quando il campo si è visto, e il ricordo resta.
async function dimentica({ da = null, a = null, sito = '' } = {}) {
  const n = String(sito || '').toLowerCase().replace(/^www\./, '');
  if (!n && (da != null || a != null)) return;
  // Come per le pagine: senza punto vale ogni dominio con quel nome, col punto il dominio e i suoi sottodomini.
  const delSito = (k) => !n || (n.includes('.') ? k === n || k.endsWith(`.${n}`) || n.endsWith(`.${k}`) : k.split('.').includes(n));
  await carica();
  for (const k of [...conCampi]) if (delSito(k)) { conCampi.delete(k); salvati.delete(k); }
  if (!letti) return;
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
    nonDelicati: PD.nonDelicati(settings),
  };
  const f = (url) => PD.classifica(url, opzioni);
  f.attivo = opzioni.attivo;
  // Una scheda archiviata porta il motivo di quando si è chiusa; un sito tolto dopo dai segnati per il campo ne è fuori.
  const tolto = (url) => {
    const h = PD.host(url);
    return Boolean(h) && opzioni.nonDelicati.some((d) => h === d || h.endsWith(`.${d}`));
  };
  f.voce = (it) => {
    const m = opzioni.attivo && it && it.delicata;
    if (m && !(m === 'campi' && tolto(it.url))) return m;
    return f(it && it.url);
  };
  return f;
}

// I siti segnati per un campo password o carta che restano anche dopo un riavvio: quelli che l'utente vede in Sicurezza.
// Quelli visti solo in incognito non ci sono, e non escono.
async function elencoCampi() {
  await carica();
  return [...salvati].sort();
}

globalThis.SN_DELICATE = { segnaCampi, haCampi, filtro, carica, dimentica, elencoCampi };

module.exports = globalThis.SN_DELICATE;
