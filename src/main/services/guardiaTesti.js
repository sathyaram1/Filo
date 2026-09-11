// Il varco unico dei testi verso l'utente (#536) — wiring.
//
// La logica pura (controlli statici, prompt, verdetto, indipendenza del
// modello) sta in src/shared/guardiano.js. Qui c'è tutto quello che tocca il
// mondo: il modello, i tentativi, il ripiego, la coda, il registro dei blocchi.
//
// TRE ESITI, e solo tre:
//   passa   → il testo compare; i suoi collegamenti mostrano dove portano.
//   blocca  → il testo NON compare. Al suo posto una riga sobria che dice cosa
//             il guardiano ha visto (non «ho avuto un dubbio»), e il caso
//             finisce nel registro dei blocchi.
//   attesa  → il guardiano non ha risposto (rete, fornitore giù, tetto dei
//             tentativi). L'avviso non compare e NON si perde: va in coda con
//             lo stato «in attesa del controllo», visibile, e riparte al giro
//             dopo. Un avviso che arriva dieci minuti dopo non ha fatto danno;
//             uno che arriva senza controllo sì.
//
// Il «passa» è l'UNICO esito che mostra il testo, e lo produce solo una
// risposta esplicita e ben formata del guardiano: un modello dirottato che
// risponde fuori formato, o che non risponde, cade su `attesa`.

'use strict';

const crypto = require('node:crypto');

// Il timbro del varco: chi scrive una notifica contaminata deve esibirlo
// (src/shared/filoMemory.js → addNotification). È casuale a ogni avvio del
// processo, quindi non si può scrivere a mano da nessuna parte.
const VARCO = crypto.randomBytes(16).toString('hex');

// Tetto dei tentativi al guardiano dentro UNA proposta. La catena dei fornitori
// alternativi la percorre già `completeWithFallback` a ogni tentativo: qui si
// riprova per i guasti passeggeri (un 500, una connessione caduta).
const TENTATIVI_MAX = 3;
const ATTESA_FRA_TENTATIVI_MS = 400;

// Ogni quanto un avviso in coda ritenta. Più corto di così vuol dire bombardare
// un fornitore che è giù; più lungo vuol dire un avviso utile che arriva domani.
const RITENTA_DOPO_MS = 60 * 1000;

// Oltre questo numero di tentativi falliti l'avviso resta in coda ma smette di
// ritentare da solo: se il guardiano è rotto da un'ora, il problema non si
// risolve chiamandolo altre mille volte. Resta visibile e riparte al prossimo
// avvio.
const TENTATIVI_CODA_MAX = 20;

function G() { return globalThis.SN_GUARDIANO; }
function Mem() { return globalThis.SN_FILO_MEMORY; }

function attendi(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// La colonna della home si aggiorna subito, come per i timer: un avviso che
// compare (o che esce dalla coda) non deve aspettare il prossimo giro.
function avvisaLaHome() {
  try { globalThis.SN_BROADCAST_LIVE?.(); } catch (_) {}
}

// I segreti che Filo custodisce: se uno finisce dentro un testo in uscita, è
// esfiltrazione e nessun modello deve poter decidere che va bene. Il getter è
// sostituibile (test) e non deve mai far fallire un controllo.
async function segretiCustoditi(deps) {
  try {
    if (deps && typeof deps.segreti === 'function') return (await deps.segreti()) || [];
    if (typeof globalThis.SN_GUARDIA_SEGRETI === 'function') {
      return (await globalThis.SN_GUARDIA_SEGRETI()) || [];
    }
  } catch (_) {}
  return [];
}

// La chiamata al guardiano. In produzione la mette handlers.js su
// globalThis.SN_GUARDIA_COMPLETE (catena di modelli dello slot GUARDIAN_CHECK,
// ripulita dai nickname del produttore del testo). Iniettabile per i test.
function completeDi(deps) {
  if (deps && typeof deps.complete === 'function') return deps.complete;
  if (typeof globalThis.SN_GUARDIA_COMPLETE === 'function') return globalThis.SN_GUARDIA_COMPLETE;
  return null;
}

/**
 * Il controllo, senza effetti collaterali: non scrive notifiche, non scrive in
 * coda. Chi chiama decide cosa farne.
 *
 * @returns {Promise<{esito:'passa'|'blocca'|'attesa', motivo:string, regola:string|null, frase:string, tentativi:number}>}
 */
async function controlla(richiesta = {}, deps = {}) {
  const Gd = G();
  const {
    testo, classe, fonte = null, richiestaUtente = '', regolaAutomazione = '', azione = null,
  } = richiesta;

  if (!Gd) {
    // Il modulo puro non c'è: non si può controllare niente, e quello che non
    // si può controllare non si mostra.
    return { esito: 'attesa', motivo: 'il controllo di sicurezza non è disponibile', regola: null, frase: '', tentativi: 0 };
  }
  if (!Gd.deveControllare(classe)) {
    return { esito: 'passa', motivo: '', regola: null, frase: '', tentativi: 0, saltato: true };
  }

  // 1) Controlli statici: deterministici, in locale, a rete staccata. Se
  // scattano, blocco senza discutere e senza chiamare nessun modello.
  const segreti = await segretiCustoditi(deps);
  const statico = Gd.controlliStatici({ testo, segreti, azione });
  if (statico.bloccato) {
    const motivo = statico.dettaglio ? `${statico.motivo} (${statico.dettaglio})` : statico.motivo;
    return {
      esito: 'blocca', motivo, regola: statico.regola,
      frase: Gd.frasePerBlocco({ fonte, motivo }), tentativi: 0,
    };
  }

  // 2) Il guardiano: un modello DIVERSO da quello che ha scritto il testo.
  const complete = completeDi(deps);
  if (!complete) {
    return { esito: 'attesa', motivo: 'il controllo di sicurezza non è raggiungibile', regola: null, frase: '', tentativi: 0 };
  }
  const { messages } = Gd.costruisciPrompt({ testo, classe, fonte, richiestaUtente, regolaAutomazione });
  let tentativi = 0;
  let ultimoErrore = '';
  while (tentativi < TENTATIVI_MAX) {
    tentativi++;
    try {
      const r = await complete({ messages });
      const verdetto = Gd.interpretaVerdetto(r);
      if (verdetto && verdetto.esito === 'passa') {
        return { esito: 'passa', motivo: '', regola: null, frase: '', tentativi };
      }
      if (verdetto && verdetto.esito === 'blocca') {
        return {
          esito: 'blocca', motivo: verdetto.motivo, regola: null,
          frase: Gd.frasePerBlocco({ fonte, motivo: verdetto.motivo }), tentativi,
        };
      }
      // Risposta incomprensibile: NON è un «passa». Si riprova.
      ultimoErrore = 'risposta fuori formato';
    } catch (e) {
      ultimoErrore = (e && e.message) || String(e);
    }
    if (tentativi < TENTATIVI_MAX) await attendi(ATTESA_FRA_TENTATIVI_MS * tentativi);
  }
  return {
    esito: 'attesa',
    motivo: ultimoErrore ? `il controllo non ha risposto (${ultimoErrore})` : 'il controllo non ha risposto',
    regola: null, frase: '', tentativi,
  };
}

/**
 * Propone una notifica. È l'UNICA porta per un avviso nato da contenuto di
 * terzi: `addNotification` rifiuta a runtime chi la salta.
 *
 * @returns {Promise<{esito:'passa'|'blocca'|'attesa', notifica?:object, frase?:string}>}
 */
async function proponiNotifica(richiesta = {}, deps = {}) {
  const M = Mem();
  const Gd = G();
  const {
    kind = 'alert', text = '', action = null, color = null,
    classe = (Gd ? Gd.CLASSI.TERZI : 'terzi'), fonte = null,
    richiestaUtente = '', regolaAutomazione = '',
  } = richiesta;

  const esitoControllo = await controlla(
    { testo: text, classe, fonte, richiestaUtente, regolaAutomazione, azione: action }, deps,
  );

  if (esitoControllo.esito === 'passa') {
    const notifica = await M.addNotification({
      kind, text, action, color, classe, fonte, _guardia: VARCO,
    });
    avvisaLaHome();
    return { esito: 'passa', notifica };
  }

  if (esitoControllo.esito === 'blocca') {
    await M.addGuardBlock({
      testo: text, fonte, motivo: esitoControllo.motivo, regola: esitoControllo.regola, classe,
    });
    // La riga sobria al posto dell'avviso è testo di FILO, non della mail:
    // classe `sistema`, e nessun collegamento dentro.
    const notifica = await M.addNotification({
      kind: 'alert', text: esitoControllo.frase, action: null, color: null,
      classe: (Gd ? Gd.CLASSI.SISTEMA : 'sistema'),
    });
    avvisaLaHome();
    return { esito: 'blocca', frase: esitoControllo.frase, notifica };
  }

  // attesa: in coda, visibile, riparte al giro dopo.
  const inCoda = await M.pushGuardQueue({
    kind, text, action, color, classe, fonte, richiestaUtente, regolaAutomazione,
  });
  avvisaLaHome();
  return { esito: 'attesa', inCoda };
}

/**
 * Le carte «in attesa del controllo» da mostrare accanto alle notifiche. NON
 * contengono il testo in attesa: sarebbe esattamente il testo non controllato.
 */
async function carteInAttesa() {
  const M = Mem();
  const Gd = G();
  if (!M || !Gd) return [];
  const coda = await M.listGuardQueue();
  return coda.map((e) => ({
    id: e.id,
    ts: e.ts,
    kind: 'attesa',
    stato: 'in_attesa',
    text: Gd.fraseInAttesa({ fonte: e.richiesta && e.richiesta.fonte }),
    link: [],
  }));
}

/**
 * Ripassa la coda: per ogni avviso in attesa da abbastanza tempo, richiama il
 * guardiano. Chi passa diventa una notifica vera, chi viene bloccato finisce
 * nel registro, chi ancora non riceve risposta resta in coda.
 * Best-effort: non lancia mai (lo chiama il giro delle notifiche).
 */
let ultimoGiroCoda = 0;
let giroInCorso = false;

async function riprocessaCoda(deps = {}) {
  const M = Mem();
  if (!M) return { trattati: 0 };
  // Il giro delle notifiche può arrivare una volta al secondo (c'è un timer che
  // scorre): un ripasso per ogni disegno della colonna sarebbe una lettura
  // dello storage al secondo per niente. Una volta ogni dieci secondi basta —
  // quanto aspetta davvero un avviso lo decide `RITENTA_DOPO_MS`.
  const adesso = (deps && typeof deps.ora === 'function') ? deps.ora() : Date.now();
  if (!deps.forza) {
    if (giroInCorso || adesso - ultimoGiroCoda < 10_000) return { trattati: 0, saltato: true };
    giroInCorso = true;
    ultimoGiroCoda = adesso;
  }
  try {
    return await giroCoda(deps);
  } finally {
    if (!deps.forza) giroInCorso = false;
  }
}

async function giroCoda(deps = {}) {
  const M = Mem();
  if (!M) return { trattati: 0 };
  let coda = [];
  try { coda = await M.listGuardQueue(); } catch (_) { return { trattati: 0 }; }
  const ora = (deps && typeof deps.ora === 'function') ? deps.ora() : Date.now();
  const soglia = (deps && Number.isFinite(deps.ritentaDopoMs)) ? deps.ritentaDopoMs : RITENTA_DOPO_MS;
  let trattati = 0;
  for (const e of coda) {
    const ultimo = Date.parse(e.ultimoTentativo || e.ts || '') || 0;
    if (ora - ultimo < soglia) continue;
    if ((e.tentativi || 0) >= TENTATIVI_CODA_MAX) continue;
    const r = e.richiesta || {};
    let esito;
    try {
      esito = await controlla({
        testo: r.text, classe: r.classe, fonte: r.fonte,
        richiestaUtente: r.richiestaUtente, regolaAutomazione: r.regolaAutomazione, azione: r.action,
      }, deps);
    } catch (_) { continue; }
    trattati++;
    if (esito.esito === 'attesa') {
      try { await M.touchGuardQueue(e.id); } catch (_) {}
      continue;
    }
    try { await M.removeGuardQueue(e.id); } catch (_) {}
    if (esito.esito === 'passa') {
      try {
        await M.addNotification({
          kind: r.kind || 'alert', text: r.text, action: r.action || null, color: r.color || null,
          classe: r.classe, fonte: r.fonte, _guardia: VARCO,
        });
      } catch (_) {}
    } else {
      try {
        await M.addGuardBlock({
          testo: r.text, fonte: r.fonte, motivo: esito.motivo, regola: esito.regola, classe: r.classe,
        });
        await M.addNotification({
          kind: 'alert', text: esito.frase, classe: (G() ? G().CLASSI.SISTEMA : 'sistema'),
        });
      } catch (_) {}
    }
  }
  if (trattati) avvisaLaHome();
  return { trattati };
}

const api = {
  timbro: () => VARCO,
  TENTATIVI_MAX,
  RITENTA_DOPO_MS,
  TENTATIVI_CODA_MAX,
  controlla,
  proponiNotifica,
  carteInAttesa,
  riprocessaCoda,
};

module.exports = api;
try { globalThis.SN_GUARDIA = api; } catch (_) {}
