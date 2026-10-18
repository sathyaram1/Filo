// Filo parla per primo (#869): quando succede qualcosa (un timer scaduto, un download finito, un avviso, l'inizio della
// giornata, la fine dell'accoglienza) scrive un turno suo in coda al filo. Mai all'apertura di una scheda. Due suoi
// messaggi di fila si fondono (src/shared/filoEventi.js). Regole: patterns/la-home-e-la-coda-del-filo.md.

const Coda = require('./codaFilo');

const TIPI = Object.freeze(['timer', 'download', 'avviso', 'giornata', 'accoglienza']);
// Gli eventi che arrivano insieme (due timer allo stesso minuto, un download che finisce mentre suona) fanno un giro solo.
const ATTESA_MS = 1200;
// Il messaggio nasce leggendo nomi di file, avvisi e sveglie che scrivono altri: riletto, è una lettura (#592.4).
const ESTERNO = 'dal messaggio con cui Filo racconta avvisi, sveglie e download, i cui nomi li scrivono altri';

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

function segnala({ tipo, testo = '' } = {}) {
  if (!TIPI.includes(tipo)) return;
  pendenti.push({ tipo, testo: String(testo == null ? '' : testo).slice(0, 300) });
  clearTimeout(attesa);
  attesa = setTimeout(() => { giro().catch((e) => console.warn('[Filo parla]', e?.message || e)); }, ATTESA_MS);
}

// Un giro alla volta: il secondo evento arrivato mentre il primo si scriveva trova già il messaggio da fondere.
function giro({ subito = [] } = {}) {
  const p = corsa.then(() => giroOra(subito), () => giroOra(subito));
  corsa = p.then(() => {}, () => {});
  return p;
}

async function giroOra(subito) {
  const nuovi = [...pendenti.splice(0), ...subito];
  if (!nuovi.length) return null;
  if (!(await app.puoParlare())) return null;
  const Chats = globalThis.SN_FILO_CHATS;
  const corrente = await Coda.chatCorrente();
  const ultimo = corrente && corrente.messages[corrente.messages.length - 1];
  const fondi = !!(ultimo && ultimo.spontaneo && ultimo.role === 'filo');
  const motivi = [...(fondi && Array.isArray(ultimo.motivi) ? ultimo.motivi : []), ...nuovi];
  const r = await app.genera({ eventi: motivi, fondi, precedente: fondi ? String(ultimo.text || '') : '' });
  const testo = String((r && r.message) || '').trim();
  if (!testo) return r || null;
  const chat = corrente ? corrente.id : require('node:crypto').randomUUID();
  const scritta = await Chats.append(chat, { role: 'filo', text: testo, spontaneo: true, motivi, esterno: ESTERNO });
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

module.exports = { TIPI, ESTERNO, collega, segnala, giro, forseGiornata };
globalThis.SN_FILO_PARLA = module.exports;
