// Le pagine delicate lato main (#1004): ricorda i siti che hanno mostrato un campo password o carta, e dà ai lavori
// automatici una domanda sola, «da qui parte qualcosa da solo?», coi livelli di privacy e l'elenco remoto di adesso.
// La regola sta in src/shared/pagineDelicate.js; dall'incognito non si scrive niente su disco.

const { getDomainInfo } = require('./safebrowse/psl');
const { ElencoSiti } = require('../../shared/stessoSito');

const PD = globalThis.SN_PAGINE_DELICATE || require('../../shared/pagineDelicate.js');
const LP = globalThis.SN_LIVELLI_PRIVACY || require('../../shared/livelliPrivacy.js');

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

// Le schede che mostrano adesso un campo password o carta, con l'indirizzo dove l'hanno mostrato: il pavimento delle
// immagini guarda la pagina, non il sito (da Gmail l'immagine parte anche dopo un accesso a Google).
const campiInVista = new WeakMap();
function mostraCampi(wc, url) {
  if (wc && typeof wc === 'object' && url) campiInVista.set(wc, String(url));
}
const campiOra = (wc) => (url) => Boolean(wc && campiInVista.get(wc) === String(url || ''));

// Un predicato sincrono (url → motivo | null) con le impostazioni di adesso: il motivo per cui da quella pagina non parte
// niente da solo, secondo i livelli di privacy (#1589). `incognito` e `tipo` ('testo' | 'immagine') dicono chi chiede;
// per le immagini `wc` è la scheda, e senza vale il ricordo del sito che ha mostrato il campo. Chi controlla molte
// pagine lo chiede una volta.
async function filtro(settingsIn, { incognito = false, tipo = 'testo', wc = null } = {}) {
  await carica();
  let settings = settingsIn;
  if (!settings) {
    try { settings = await globalThis.SN_STORAGE.getSettings(); } catch (_) { settings = null; }
  }
  const regola = LP.regola(settings);
  const opzioni = {
    sitiUtente: PD.sitiUtente(settings),
    elenco: PD.elenco(elencoRemoto()),
    campi: haCampi,
    nonDelicati: PD.nonDelicati(settings),
  };
  const tolto = (h) => Boolean(h) && opzioni.nonDelicati.some((d) => h === d || h.endsWith(`.${d}`));
  const inVista = wc ? campiOra(wc) : null;
  const decidi = (url, motivo) => {
    const h = PD.host(url);
    if (!h) return null;
    const campi = tipo === 'immagine' && (inVista ? inVista(url) : haCampi(h) && !tolto(h));
    return LP.chiede(regola, { host: h, motivo: motivo || PD.classifica(url, opzioni), campi, incognito, tipo });
  };
  const f = (url) => decidi(url);
  f.regola = regola;
  // Una scheda archiviata porta ciò che la pagina era quando si è chiusa; si decide coi livelli di adesso. Un sito tolto
  // dopo dai segnati per il campo ne è fuori.
  f.voce = (it) => {
    const salvato = it && PD.CLASSI.includes(it.delicata) ? it.delicata : null;
    const valido = salvato && !(salvato === 'campi' && tolto(PD.host(it.url)));
    return decidi(it && it.url, valido ? salvato : null);
  };
  return f;
}

// La domanda di chi sta per mandare una cosa sola: da questa pagina parte da sola? Il motivo per cui chiede, o null. Solo
// pagine web; senza la regola non si sa, e nel dubbio chiede.
async function chiede(url, { incognito = false, tipo = 'testo', wc = null } = {}) {
  if (!/^https?:/i.test(String(url || ''))) return null;
  try { return (await filtro(null, { incognito, tipo, wc }))(url) || null; } catch (_) { return 'campi'; }
}

// I siti segnati per un campo password o carta che restano anche dopo un riavvio: quelli che l'utente vede in Sicurezza.
// Quelli visti solo in incognito non ci sono, e non escono.
async function elencoCampi() {
  await carica();
  return [...salvati].sort();
}

// Dopo un'importazione (#1256): i siti del backup si aggiungono a quelli in memoria, così la prossima scrittura li tiene.
function rileggi() {
  caricati = null;
  return carica();
}

globalThis.SN_DELICATE = { segnaCampi, haCampi, mostraCampi, filtro, chiede, carica, rileggi, dimentica, elencoCampi };

module.exports = globalThis.SN_DELICATE;
