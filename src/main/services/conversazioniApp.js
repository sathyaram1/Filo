// Le conversazioni dell'Editor, dei Mazzi e dell'Aiuto nel filo (#974): l'unico punto che ogni chat di un'app chiama,
// dal main con `annota` o dalla pagina con FILO_CONVERSAZIONE_APP. Il disco lo tocca solo ilFilo.js; cosa diventa
// riga e dove si mostra lo decide src/shared/filoApp.js.

'use strict';

const A = () => globalThis.SN_FILO_APP;
const F = () => globalThis.SN_IL_FILO;
const T = () => globalThis.SN_FILO_EVENTI.TIPI;

const app = {
  annuncia: () => {},
  tetti: async () => ({ giorni: 3 }),
};
function collega(f) { Object.assign(app, f || {}); }

// Quello che Filo ha risposto in un'altra app veniva da un documento, da una pagina, dalle carte: riletto dalla chat è
// una lettura come le altre (#810), imbustato e contato per le uscite.
const ESTERNO = Object.freeze({
  editor: "dalla chat dell'Editor, sul testo di un documento",
  mazzi: 'dalla chat dei Mazzi',
  aiuto: "dall'Aiuto, sul contenuto di una pagina",
});

function pulisci(messaggi) {
  return (Array.isArray(messaggi) ? messaggi : [messaggi])
    .filter((m) => m && typeof m.text === 'string' && m.text.trim())
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'filo', text: m.text }));
}

// «Riprova» rimanda la stessa domanda subito dopo sé stessa: è lo stesso turno, non si scrive due volte.
function senzaRiprova(prima, nuovi) {
  const ultimo = prima[prima.length - 1];
  const primo = nuovi[0];
  if (ultimo && primo && ultimo.role === 'user' && primo.role === 'user' && String(ultimo.text) === String(primo.text)) {
    return nuovi.slice(1);
  }
  return nuovi;
}

// `rif` dice quale conversazione dell'app (documento e modulo, mazzo, apertura dell'Aiuto); `dove` riapre l'app lì.
// `daPagina`: l'Aiuto parla da sopra un sito, che vede le parole dell'utente (#1508, src/shared/filoApp.js → conProvenienza).
function annota({ app: nome, rif, soggetto, dove, messaggi, daPagina = false } = {}, opts) {
  const R = A();
  if (!R.eApp(nome)) return Promise.resolve(null);
  const chiave = String(rif == null ? '' : rif).slice(0, 400);
  const nuovi = pulisci(messaggi);
  if (!chiave || !nuovi.length) return Promise.resolve(null);
  const sogg = R.soggetto(soggetto);
  return F().transazione(async (t) => {
    // Una conversazione nascosta (#1295) non si continua: quello che l'app scrive dopo è una riga nuova, in vista.
    const c = R.daContinuare(t.tutte().filter((x) => !x.nascosta), { app: nome, rif: chiave, ora: Date.now() });
    const id = c ? c.id : globalThis.SN_FILO_EVENTI.uuid();
    const eventi = [];
    if (!c) {
      eventi.push(t.evento(T().CHAT_APERTA, {
        chat: id, app: nome, rif: chiave, soggetto: sogg, dove: typeof dove === 'string' && dove ? dove : undefined,
      }, { autore: 'utente' }));
    }
    const soggettoOra = sogg || (c && c.soggetto) || '';
    if (!c || soggettoOra !== (c.soggetto || '')) {
      eventi.push(t.evento(T().CHAT_TITOLO, {
        // Un nome dato dall'utente in Cronologia resta suo anche quando il documento cambia nome.
        chat: id, title: c && c.titleByUser ? c.title : R.titolo(nome, soggettoOra), kind: globalThis.SN_CHAT_ARCHIVE.KIND_TALK,
        soggetto: soggettoOra,
      }, { autore: 'filo' }));
    }
    for (const m of senzaRiprova(c ? c.messages : [], nuovi)) {
      eventi.push(t.evento(T().MESSAGGIO, {
        chat: id, msg: { role: m.role, text: m.text, ...(m.role === 'filo' ? { esterno: ESTERNO[nome] } : (daPagina === true ? { daPagina: true } : {})) },
      }, { autore: m.role === 'user' ? 'utente' : 'filo' }));
    }
    await t.scrivi(eventi);
    return globalThis.SN_FILO_EVENTI.copiaChat(t.chat(id));
  }, opts).then((chat) => {
    try { app.annuncia(); } catch (_) {}
    return chat;
  });
}

// Il documento o il mazzo ha cambiato nome: le sue righe lo seguono subito, anche per la ricerca, senza aspettare il
// prossimo messaggio. Un nome dato dall'utente in Cronologia resta suo. `prefisso`: tutte quelle di un documento.
function rinomina({ app: nome, rif, prefisso, soggetto } = {}, opts) {
  const R = A();
  if (!R.eApp(nome)) return Promise.resolve(0);
  const r = rif == null ? '' : String(rif).slice(0, 400);
  const p = prefisso == null ? '' : String(prefisso);
  const sogg = R.soggetto(soggetto);
  if ((!r && !p) || !sogg) return Promise.resolve(0);
  return F().transazione(async (t) => {
    const eventi = t.tutte()
      .filter((c) => c.app === nome && (r ? c.rif === r : String(c.rif || '').startsWith(p)) && (c.soggetto || '') !== sogg)
      .map((c) => t.evento(T().CHAT_TITOLO, {
        chat: c.id, ...(c.titleByUser ? {} : { title: R.titolo(nome, sogg) }), soggetto: sogg,
      }, { autore: 'filo' }));
    if (eventi.length) await t.scrivi(eventi);
    return eventi.length;
  }, opts).then((n) => {
    if (n) { try { app.annuncia(); } catch (_) {} }
    return n;
  });
}

async function righe({ chat = null } = {}, opts) {
  const tutte = await F().chats(opts);
  let giorni = 3;
  try { giorni = (await app.tetti()).giorni; } catch (_) {}
  return A().perLaHome(tutte, { chat, ora: Date.now(), giorni });
}

// L'app ha cancellato la sua conversazione (chat svuotata, mazzo eliminato, modulo tolto): se ne va anche dal filo,
// con le sue copie. `prefisso`: tutte quelle di un documento.
async function dimentica({ app: nome, rif, prefisso } = {}) {
  if (!A().eApp(nome)) return [];
  const r = rif == null ? '' : String(rif);
  const p = prefisso == null ? '' : String(prefisso);
  if (!r && !p) return [];
  const tutte = await F().chats({ nascoste: true });
  const tolte = tutte.filter((c) => c.app === nome && (r ? c.rif === r : String(c.rif || '').startsWith(p))).map((c) => c.id);
  for (const id of tolte) await globalThis.SN_FILO_CHATS.remove(id);
  if (tolte.length) { try { app.annuncia(tolte); } catch (_) {} }
  return tolte;
}

globalThis.SN_CONVERSAZIONI_APP = { annota, rinomina, righe, dimentica, collega, ESTERNO };
module.exports = globalThis.SN_CONVERSAZIONI_APP;
