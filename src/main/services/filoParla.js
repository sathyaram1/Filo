// Filo parla per primo (#869): quando succede qualcosa (un timer scaduto, un download finito, un avviso, l'inizio della
// giornata, la fine dell'accoglienza) scrive un turno suo in coda al filo. Mai all'apertura di una scheda. Due suoi
// messaggi vicini, senza niente in mezzo, si fondono. Regole: patterns/la-home-e-la-coda-del-filo.md.

const Coda = require('./codaFilo');

const TIPI = Object.freeze(['timer', 'download', 'avviso', 'giornata', 'accoglienza']);
// Gli eventi che arrivano insieme (due timer allo stesso minuto, un download che finisce mentre suona) fanno un giro solo.
const ATTESA_MS = 1200;
// Il messaggio nasce leggendo nomi di file, avvisi e sveglie che scrivono altri: riletto, è una lettura (#592.4).
const ESTERNO = 'dal messaggio con cui Filo racconta avvisi, sveglie e download, i cui nomi li scrivono altri';
// Una pagina lasciata aperta può far partire un download al secondo mentre l'utente non c'è (#2294): i download aprono
// un giro al più ogni `ritmoDownloadMs`, e quelli arrivati intanto si contano e si raccontano tutti nel giro dopo.
const NOMI_RACCONTATI = 5;

const app = {
  // ({ eventi, fondi, precedente }) → { message, suggestions } | null; lo dà handlers.js.
  genera: null,
  puoParlare: async () => false,
  annuncia: () => {},
};
function collega(f) { Object.assign(app, f || {}); }

let pendenti = [];
let attesa = null;
let corsa = Promise.resolve();

let ritmoDownloadMs = 10 * 60_000;
let ultimoDownload = -Infinity;
let sospesi = { n: 0, nomi: [] };
let attesaDownload = null;

function configura(settings) {
  const C = globalThis.SN_CONST;
  const min = C && typeof C.minutiFraDownload === 'function' ? C.minutiFraDownload(settings && settings.filoParla) : 10;
  ritmoDownloadMs = min * 60_000;
  if (sospesi.n) armaDownload();
}

function segnala({ tipo, testo = '' } = {}) {
  if (!TIPI.includes(tipo)) return;
  const t = String(testo == null ? '' : testo).slice(0, 300);
  if (tipo === 'download') {
    sospesi.n++;
    if (sospesi.nomi.length < NOMI_RACCONTATI) sospesi.nomi.push(t);
    armaDownload();
    return;
  }
  pendenti.push({ tipo, testo: t });
  arma();
}

function arma() {
  clearTimeout(attesa);
  attesa = setTimeout(() => { giro().catch((e) => console.warn('[Filo parla]', e?.message || e)); }, ATTESA_MS);
}

function armaDownload() {
  clearTimeout(attesaDownload);
  attesaDownload = null;
  const resta = ultimoDownload + ritmoDownloadMs - Date.now();
  if (resta <= 0) { arma(); return; }
  attesaDownload = setTimeout(() => { attesaDownload = null; arma(); }, resta);
  attesaDownload.unref?.();
}

// I download sospesi entrano nel giro quando il ritmo lo lascia, o quando il giro parte comunque per un altro evento.
function prendiDownload(conAltri) {
  if (!sospesi.n || (!conAltri && Date.now() - ultimoDownload < ritmoDownloadMs)) return [];
  const { n, nomi } = sospesi;
  sospesi = { n: 0, nomi: [] };
  ultimoDownload = Date.now();
  clearTimeout(attesaDownload);
  attesaDownload = null;
  if (n <= NOMI_RACCONTATI) return nomi.map((testo) => ({ tipo: 'download', testo }));
  const visti = nomi.slice(0, NOMI_RACCONTATI - 1).map((x) => x.slice(0, 80));
  return [{ tipo: 'download', testo: `${visti.join(', ')} e altri ${n - visti.length} file (${n} in tutto)` }];
}

// Un giro alla volta: il secondo evento arrivato mentre il primo si scriveva trova già il messaggio da fondere.
// Sempre sul filo di disco: un evento nato mentre girava una richiesta dell'incognito non finisce nel suo filo in memoria.
function normale(fn) {
  let D = null;
  try { D = require('../shim/storage'); } catch (_) { D = null; }
  return D && typeof D.runNormale === 'function' ? D.runNormale(fn) : fn();
}

function giro({ subito = [] } = {}) {
  const fai = () => normale(() => giroOra(subito));
  const p = corsa.then(fai, fai);
  corsa = p.then(() => {}, () => {});
  return p;
}

async function giroOra(subito) {
  const altri = [...pendenti.splice(0), ...subito];
  const nuovi = [...altri, ...prendiDownload(altri.length > 0)];
  if (!nuovi.length) return null;
  if (!(await app.puoParlare())) return null;
  const Chats = globalThis.SN_FILO_CHATS;
  const corrente = await Coda.chatCorrente();
  const ultimo = corrente && corrente.messages[corrente.messages.length - 1];
  const fondi = !!(ultimo && ultimo.spontaneo && ultimo.role === 'filo') && await Coda.siFonde(corrente.id);
  const motivi = [...(fondi && Array.isArray(ultimo.motivi) ? ultimo.motivi : []), ...nuovi];
  const r = await app.genera({ eventi: motivi, fondi, precedente: fondi ? String(ultimo.text || '') : '' });
  const testo = String((r && r.message) || '').trim();
  if (!testo) return r || null;
  const chat = corrente ? corrente.id : require('node:crypto').randomUUID();
  // I verdetti dei suoi collegamenti restano con la frase: riaperta, chi chiedeva l'OK lo chiede ancora (#1505).
  const verdetti = {
    ...(Array.isArray(r.linkDaConfermare) && r.linkDaConfermare.length ? { linkDaConfermare: r.linkDaConfermare } : {}),
    ...(r.senzaVerdetto ? { senzaVerdetto: true } : {}),
  };
  const scritta = await Chats.append(chat, { role: 'filo', text: testo, spontaneo: true, motivi, esterno: ESTERNO, ...verdetti, ...(fondi ? { fonde: true } : {}) });
  const i = scritta ? scritta.messages.length - 1 : 0;
  const m = scritta && scritta.messages[i];
  app.annuncia({ chat, i, ts: (m && m.ts) || new Date().toISOString(), testo, fuso: fondi });
  return r;
}

// La prima apertura della giornata: se nella home oggi non si è detto ancora niente. Una volta al giorno: dieci schede
// aperte mentre il saluto si scrive non ne chiedono altri dieci.
let giornataChiesta = '';
async function forseGiornata() {
  const d = new Date();
  const oggi = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  if (giornataChiesta === oggi) return;
  try {
    // Senza un modello adesso (la configurazione arriva dalla rete dopo l'avvio) il saluto aspetta la scheda dopo.
    if (!(await app.puoParlare()) || !(await Coda.serveGiornata()) || giornataChiesta === oggi) return;
    giornataChiesta = oggi;
    segnala({ tipo: 'giornata' });
  } catch (_) {}
}

function _azzera() {
  clearTimeout(attesa);
  clearTimeout(attesaDownload);
  attesa = null;
  attesaDownload = null;
  pendenti = [];
  sospesi = { n: 0, nomi: [] };
  ultimoDownload = -Infinity;
}

module.exports = { TIPI, ESTERNO, collega, configura, segnala, giro, forseGiornata, _azzera, _ritmoMs: () => ritmoDownloadMs };
globalThis.SN_FILO_PARLA = module.exports;
