// La porta UNICA da cui passa un testo nato da roba scritta da altri prima di
// comparire all'utente (#536): controlli statici, poi un secondo modello.
// Regole e racconto: patterns/un-secondo-modello-guarda-il-testo-prima-dellutente.md

'use strict';

// Quante volte si richiede il giudizio nello stesso giro. Ogni tentativo è già
// una catena di fornitori: oltre non si guadagna niente, si fa solo aspettare.
const TENTATIVI = 2;
// Quanto si aspetta prima di ripassare su una voce rimasta in attesa. Un
// avviso che arriva dieci minuti dopo non ha fatto danno.
const RIPRESA_MS = 5 * 60 * 1000;
// Quanto del testo fermato finisce nel registro: abbastanza per riconoscerlo.
const ANTEPRIMA = 160;
// Un avviso più lungo si RIFIUTA, non si taglia: l'esca si scriverebbe dopo il
// taglio. Per questo il tetto non è un numero suo, è quello del guardiano.
const MAX_TESTO = () => (globalThis.SN_GUARDIANO && globalThis.SN_GUARDIANO.MAX_PEZZO) || 1500;

// Le regole che scattano perché il testo contiene un segreto: l'anteprima nel
// registro ne sarebbe una seconda copia.
const REGOLE_SENZA_ANTEPRIMA = new Set(['segreto', 'chiave', 'codice', 'iban', 'carta']);

let deps = { getSettings: null, runOneShot: null, modelForAction: null };
// Il giro in corso, per non sovrapporne due sulla stessa coda. Chi FORZA
// aspetta quello in volo e poi rifà il suo: una richiesta dell'utente non si
// risolve rispondendogli «sto già facendo altro».
let giroInCorso = null;

function configure(d) {
  deps = { ...deps, ...(d || {}) };
}

// Un giro di posta propone più avvisi insieme, e chi rilegge tutta la lista per
// riscriverla perde in silenzio quella del vicino: si scrive in fila
// (patterns/chi-rilegge-tutto-e-riscrive-tutto-mette-le-scritture-in-fila.md).
let fila = Promise.resolve();
function inFila(fn) {
  const prossimo = fila.then(fn, fn);
  fila = prossimo.catch(() => {});
  return prossimo;
}

function G() { return globalThis.SN_GUARDIANO; }
function GS() { return globalThis.SN_GUARDIANO_STATICO; }
function F() { return globalThis.SN_FIDUCIA; }
function Mem() { return globalThis.SN_FILO_MEMORY; }

// I segreti che Filo custodisce, per il confronto letterale. Solo quelli che
// il testo in uscita non deve MAI contenere.
function segretiDi(settings) {
  const out = [];
  const k = (settings && settings.apiKeys) || {};
  for (const v of Object.values(k)) if (typeof v === 'string' && v.trim()) out.push(v.trim());
  const sb = (settings && settings.security && settings.security.safeBrowse) || {};
  if (typeof sb.safeBrowsingKey === 'string' && sb.safeBrowsingKey.trim()) out.push(sb.safeBrowsingKey.trim());
  return out;
}

// Chi ha scritto, come compare nella riga di blocco. Di una fonte si tiene
// SOLO l'identità verificabile — l'indirizzo di posta, o il sito — perché
// tutto il resto del campo lo scrive chi manda: un nome di mittente è testo
// libero, e lasciarcelo passare rimetterebbe nella riga l'esca appena tolta
// (un numero da chiamare non ha bisogno di nessun collegamento).
function fonteVisibile(fonte) {
  const C = globalThis.SN_CONST;
  const st = GS();
  const grezza = C ? C.unaRigaDiDati(fonte, 200) : String(fonte || '').trim();
  if (!grezza) return 'una fonte che non si è identificata';
  const posta = grezza.match(/[^\s<>()@,;:"]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  if (posta) return posta[0].toLowerCase();
  const host = st ? st.hostNominato(grezza) : '';
  if (host) return host;
  return 'una fonte che non si è identificata';
}

// I collegamenti escono dalla frase e si etichettano con la destinazione vera:
// dentro la frase la scritta la sceglie chi l'ha scritta.
function separaLink(testo) {
  const FB = globalThis.SN_FEEDBACK;
  const st = GS();
  const link = [];
  let out = String(testo == null ? '' : testo);
  if (!st) return { testo: out, link };
  const visti = new Set();
  for (const l of st.linkNelTesto(out)) {
    const etichetta = FB && typeof FB.linkLabel === 'function' ? FB.linkLabel(l.url) : '';
    out = out.replace(`[${l.etichetta}](${l.url})`, l.etichetta);
    if (!etichetta || visti.has(l.url)) continue;
    visti.add(l.url);
    link.push({ etichetta, url: l.url });
  }
  return { testo: out, link };
}

// Esiti: 'passa' | 'blocca' | 'attesa'. 'attesa' NON è un passa: è «non lo so»,
// e chi chiama non mostra niente.
async function vaglia({ testo, classe, fonte, richiesta, modelloProduttore, link } = {}) {
  const fid = F();
  const cls = fid ? fid.normalizza(classe) : String(classe || 'messaggio');
  if (fid && !fid.contaminata(cls)) return { esito: 'passa', regola: '', motivo: '', motivoChiave: '' };

  let settings = {};
  try { settings = (deps.getSettings && await deps.getSettings()) || {}; } catch (_) { settings = {}; }

  const statico = GS().controlla(testo, { segreti: segretiDi(settings), link: link || [] });
  if (statico.blocca) {
    return { esito: 'blocca', regola: statico.regola, motivo: statico.motivo, motivoChiave: statico.regola };
  }

  const guard = G();
  const C = globalThis.SN_CONST;
  // Dal punto che risolve i modelli per tutti: un soprannome deprecato lo
  // rimappa lui, e una copia a mano qui diverge in silenzio.
  const refGuardiano = deps.modelForAction
    ? deps.modelForAction(settings, C.ACTIONS.NOTICE_GUARD)
    : ((settings.models && settings.models[C.ACTIONS.NOTICE_GUARD]) || '');
  const catena = guard.catenaIndipendente(refGuardiano, modelloProduttore);
  // Nessun modello diverso da quello che ha scritto il testo: due contesti
  // sullo stesso modello cadono insieme, quindi qui non c'è controllo. Si
  // aspetta, non si passa.
  if (!catena.length) {
    return { esito: 'attesa', regola: 'senza-guardiano', motivo: '', motivoChiave: '' };
  }
  // I soprannomi non bastano: fra la scelta e la chiamata c'è chi li riscrive
  // (l'interruttore «solo modelli a pesi aperti» sostituisce ogni modello
  // proprietario col suo equivalente aperto). L'indipendenza si verifica sui
  // modelli che partono DAVVERO, qui, dove la lista dei tentativi è già fatta.
  const vietati = deps.modelliConcreti
    ? deps.modelliConcreti(settings, modelloProduttore, C.ACTIONS.NOTICE_GUARD)
    : [];

  const messages = [
    { role: 'system', content: guard.SISTEMA },
    { role: 'user', content: guard.domanda({ testo, classe: cls, fonte, richiesta, link }) },
  ];
  for (let i = 0; i < TENTATIVI; i++) {
    let risposta = null;
    try {
      risposta = await deps.runOneShot(C.ACTIONS.NOTICE_GUARD, messages, {
        modelRef: catena.join(','), escludiModelli: vietati,
      });
    } catch (e) {
      // Restare senza tentativi perché tutti finivano sul modello che ha
      // scritto il testo non è un guasto di rete: aspettare non lo risolve.
      if (e && e.code === 'GUARDIANO_NON_INDIPENDENTE') {
        return { esito: 'attesa', regola: 'senza-guardiano', motivo: '', motivoChiave: '' };
      }
      console.warn('[guardiano] tentativo fallito:', (e && e.message) || e);
      continue;
    }
    const letto = guard.leggi(risposta);
    if (!letto) continue;
    if (letto.passa) return { esito: 'passa', regola: '', motivo: '', motivoChiave: '' };
    return { esito: 'blocca', regola: 'guardiano', motivo: letto.motivo, motivoChiave: letto.motivoChiave };
  }
  return { esito: 'attesa', regola: 'senza-risposta', motivo: '', motivoChiave: '' };
}

function rigaDiBlocco(fonte, motivo) {
  const chi = fonteVisibile(fonte);
  return `Ho fermato un avviso nato da ${chi}: ${motivo || 'non diceva la verità su dove portava'}.`;
}

async function registraBlocco({ fonte, classe, testo, esito }) {
  const mem = Mem();
  try {
    await inFila(() => mem.addBloccoGuardiano({
      fonte, classe, motivo: esito.motivo, regola: esito.regola,
      anteprima: REGOLE_SENZA_ANTEPRIMA.has(esito.regola)
        ? '' : globalThis.SN_CONST.unaRigaDiDati(testo, ANTEPRIMA),
    }));
  } catch (_) {}
  return inFila(() => mem.addNotification({
    kind: 'alert', classe: 'filo', text: rigaDiBlocco(fonte, esito.motivo),
    action: { tipo: 'guardiano-blocco', regola: esito.regola },
  }));
}

// L'unico modo di proporre un avviso nato da roba di altri. Torna
// { esito, notifica }.
async function proponiAvviso({ testo, classe, fonte, richiesta, modelloProduttore, kind, action } = {}) {
  const mem = Mem();
  const tetto = MAX_TESTO();
  if (String(testo || '').length > tetto) {
    return { esito: 'rifiutato', motivo: `l'avviso supera ${tetto} caratteri`, max: tetto };
  }
  const separato = separaLink(testo);
  const esito = await vaglia({
    testo: separato.testo, classe, fonte, richiesta, modelloProduttore, link: separato.link,
  });

  if (esito.esito === 'blocca') {
    const notifica = await registraBlocco({ fonte, classe, testo: separato.testo, esito });
    return { esito: 'blocca', notifica, motivo: esito.motivo };
  }

  const notifica = await inFila(() => mem.addNotification({
    kind: kind || 'alert',
    text: separato.testo,
    classe, fonte,
    guardiano: { esito: esito.esito },
    motivoAttesa: esito.regola,
    // `modelloProduttore` resta appiccicato alla voce: se finisce in coda, il
    // giro dopo deve sapere di nuovo quale modello NON può fare da guardiano.
    action: {
      ...(action || {}), link: separato.link,
      richiesta: richiesta || '', modelloProduttore: modelloProduttore || '',
    },
  }));
  return { esito: esito.esito, notifica };
}

// Le voci rimaste in attesa ripassano dal guardiano. Non blocca chi la chiama:
// il risultato arriva alla dashboard col prossimo aggiornamento live.
async function riprendiInAttesa({ forza = false } = {}) {
  if (giroInCorso) {
    const atteso = await giroInCorso.catch(() => 0);
    if (!forza) return atteso;
  }
  const giro = giraSullaCoda(forza);
  giroInCorso = giro;
  try { return await giro; } finally { if (giroInCorso === giro) giroInCorso = null; }
}

async function giraSullaCoda(forza) {
  let cambiate = 0;
  try {
    const mem = Mem();
    const lista = await mem.listNotifications();
    const ora = Date.now();
    for (const n of lista) {
      if (n.stato !== 'attesa') continue;
      const ultimo = n.ultimoTentativo ? Date.parse(n.ultimoTentativo) : 0;
      if (!forza && ultimo && ora - ultimo < RIPRESA_MS) continue;
      const esito = await vaglia({
        testo: n.text, classe: n.classe, fonte: n.fonte,
        richiesta: (n.action && n.action.richiesta) || '',
        modelloProduttore: (n.action && n.action.modelloProduttore) || '',
        link: (n.action && n.action.link) || [],
      });
      if (esito.esito === 'attesa') {
        await inFila(() => mem.segnaEsitoGuardiano(n.id, {
          tentativi: (n.tentativi || 0) + 1, motivoAttesa: esito.regola,
        }));
        continue;
      }
      if (esito.esito === 'blocca') {
        await inFila(() => mem.segnaEsitoGuardiano(n.id, { stato: 'bloccato' }));
        await registraBlocco({ fonte: n.fonte, classe: n.classe, testo: n.text, esito });
      } else {
        await inFila(() => mem.segnaEsitoGuardiano(n.id, { stato: 'visibile' }));
      }
      cambiate++;
    }
  } catch (e) {
    console.warn('[guardiano] ripresa fallita:', (e && e.message) || e);
  }
  if (cambiate) {
    try { require('./handlers').broadcastLiveUpdate(); } catch (_) {}
  }
  return cambiate;
}

const API = {
  configure, vaglia, proponiAvviso, riprendiInAttesa,
  segretiDi, fonteVisibile, separaLink, rigaDiBlocco, inFila,
  TENTATIVI, RIPRESA_MS, MAX_TESTO,
};

globalThis.SN_GUARDIANO_AVVISI = API;
module.exports = API;
