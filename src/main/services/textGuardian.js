// Il guardiano degli avvisi (#536): IL PUNTO DI PASSAGGIO UNICO.
//
// Ogni testo che Filo mostra all'utente dopo aver letto contenuto non fidato
// passa da qui — le notifiche proposte dalle automazioni, le risposte in chat di
// un compito contaminato, e domani qualunque altra superficie. Non ci sono
// scorciatoie: `SN_FILO_MEMORY.addNotification` è chiamata SOLO da questo file,
// e una sentinella negli unit test (tests/unit/textGuardGate.test.mjs) diventa
// rossa se qualcuno apre un'altra porta.
//
// L'ORDINE, che è anche l'ordine dei costi:
//   1. compito PULITO → passa e basta. Chiamare un secondo modello su «che ore
//      sono» è spreco: il controllo serve dove è entrata roba scritta da altri.
//   2. CONTROLLI STATICI (src/shared/textGuard.js) → deterministici, in locale,
//      a rete staccata. Se scattano: blocco, senza chiamare nessun modello.
//   3. IL GUARDIANO → un secondo modello, DIVERSO da quello che ha scritto il
//      testo (due contesti sullo stesso modello cadono insieme). Vede il testo
//      in uscita, la classe di fiducia, la fonte e la richiesta dell'utente o la
//      regola dell'automazione; mai il contenuto completo delle mail.
//   4. NON RISPONDE (rete, fornitore giù, tetto di tentativi) → l'avviso non
//      compare e NON si perde: va in coda «in attesa del controllo», visibile,
//      e riparte al giro dopo. Un avviso che arriva dieci minuti dopo non ha
//      fatto danno; uno che arriva senza controllo sì.
//
// Il modello del guardiano si imposta come tutte le altre funzioni (Opzioni →
// Modelli, con il valore che arriva dalla configurazione remota dei predefiniti)
// e il consumo finisce sotto la voce crediti «Controlli di sicurezza».

'use strict';

// Quante volte si richiama il guardiano prima di arrendersi e mettere in coda.
// La catena di ripiego fra i modelli configurati vive già dentro il tentativo
// (buildAttemptChain), quindi qui contiamo i GIRI interi di quella catena.
const TENTATIVI_MAX = 3;
// Attesa fra un giro e l'altro: corta, perché un avviso in coda costa comunque
// solo ritardo, e chi è giù di norma torna in fretta.
const PAUSA_MS = 700;
// Ogni quanto la coda può riprovare. La colonna della home chiede le notifiche
// anche una volta al secondo (quando c'è un timer che scorre): senza questo
// freno, una coda che non si svuota chiamerebbe il modello sessanta volte al
// minuto. Un minuto di ritardo su un avviso non fa danno; una chiamata al
// secondo sì — e il costo lo paga chi non ha fatto niente di sbagliato.
const RIPRESA_MIN_MS = 60 * 1000;

// Iniettati dal main (src/main/services/handlers.js → wireTextGuardian):
//   eseguiModello({ messaggi, produttore }) → testo della risposta
//   segreti() → string[] dei segreti che Filo custodisce
let _eseguiModello = null;
let _segreti = null;
let _avvisaCambio = null;
let _pausaMs = PAUSA_MS;
// Quando la coda ha provato l'ultima volta (freno di RIPRESA_MIN_MS).
let _ultimoGiro = 0;

// Quello che non si nomina resta com'è (`undefined` = non toccare); passare
// `null` invece stacca esplicitamente quel pezzo. Serve a chi vuole sostituire
// solo il modello — uno spec, una diagnosi — senza staccare per sbaglio
// l'aggiornamento della colonna o la lista dei segreti.
function configure({ eseguiModello, segreti, pausaMs, avvisaCambio } = {}) {
  if (eseguiModello !== undefined) _eseguiModello = typeof eseguiModello === 'function' ? eseguiModello : null;
  if (segreti !== undefined) _segreti = typeof segreti === 'function' ? segreti : null;
  if (avvisaCambio !== undefined) _avvisaCambio = typeof avvisaCambio === 'function' ? avvisaCambio : null;
  if (Number.isFinite(pausaMs)) _pausaMs = Math.max(0, pausaMs);
  // Cambiare il modello (o ricablare il guardiano) è una ragione per riprovare
  // subito quello che era rimasto in coda: il freno del minuto riparte da zero.
  _ultimoGiro = 0;
}

// La colonna live deve accorgersene subito, non al giro dopo.
function cambiato() {
  if (!_avvisaCambio) return;
  try { _avvisaCambio(); } catch (_) {}
}

function TG() { return globalThis.SN_TEXT_GUARD; }
function Mem() { return globalThis.SN_FILO_MEMORY; }

function dormi(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function segretiCorrenti() {
  if (!_segreti) return [];
  try {
    const s = await _segreti();
    return Array.isArray(s) ? s.filter(Boolean) : [];
  } catch (_) { return []; }
}

// ── Il controllo ────────────────────────────────────────────────────────────
//
//   { testo, fiducia, origine, richiestaUtente, regolaAutomazione, produttore }
//     → { esito: 'passa' | 'blocca' | 'in-attesa', motivo, regola }
//
// `produttore` è la catena di nickname del modello che ha scritto il testo: il
// guardiano non può girare su nessuno di quelli. Se dopo averli tolti la sua
// catena resta vuota, l'esito è 'in-attesa' — MAI 'passa': un controllo che non
// si può fare non è un controllo superato.
async function controllaTesto({
  testo, fiducia, origine, richiestaUtente, regolaAutomazione, produttore,
} = {}) {
  const G = TG();
  if (!G) return { esito: 'in-attesa', motivo: 'controllo non disponibile', regola: '' };

  // 1. compito pulito → nessun secondo modello.
  if (!G.vaControllato(fiducia)) return { esito: 'passa', motivo: '', regola: '' };

  // 2. controlli statici.
  const statico = G.controlliStatici({ testo, segreti: await segretiCorrenti() });
  if (statico.blocca) {
    return { esito: 'blocca', motivo: statico.motivo, regola: statico.regola };
  }

  // 3. il guardiano.
  if (!_eseguiModello) {
    return { esito: 'in-attesa', motivo: 'guardiano non configurato', regola: '', causa: G.CAUSA.CONFIGURAZIONE };
  }
  const messaggi = G.messaggiGuardiano({ testo, fiducia, origine, richiestaUtente, regolaAutomazione });
  let ultimoErrore = '';
  // Perché non è riuscito: la rete che va e viene è una cosa, un modello che
  // manca (o che è lo stesso che ha scritto il testo) è un'altra. Aspettare
  // aggiusta la prima e non aggiusta la seconda, e chi legge deve poterle
  // distinguere: una frase sola per due guasti diversi manda l'utente ad
  // aspettare per sempre una cosa che solo lui può sistemare.
  let causa = G.CAUSA.RETE;
  for (let i = 0; i < TENTATIVI_MAX; i++) {
    try {
      const raw = await _eseguiModello({ messaggi, produttore });
      const verdetto = G.leggiVerdetto(raw);
      if (verdetto) {
        if (verdetto.esito === 'passa') return { esito: 'passa', motivo: '', regola: '' };
        return { esito: 'blocca', motivo: verdetto.motivo, regola: 'guardiano' };
      }
      ultimoErrore = 'risposta non leggibile';
    } catch (e) {
      ultimoErrore = (e && (e.message || e.code)) || 'errore';
      // Il guardiano non ha un modello indipendente su cui girare: ritentare non
      // cambia niente, e lasciar passare sarebbe peggio. Coda subito.
      if (e && e.code === 'GUARDIANO_NON_INDIPENDENTE') { causa = G.CAUSA.CONFIGURAZIONE; break; }
    }
    if (i + 1 < TENTATIVI_MAX && _pausaMs) await dormi(_pausaMs);
  }
  return { esito: 'in-attesa', motivo: ultimoErrore, regola: '', causa };
}

// ── Proporre un avviso ──────────────────────────────────────────────────────
//
// L'UNICA strada per far comparire una notifica. Chi la propone dichiara la
// classe di fiducia del compito e da dove viene il contenuto.
//
//   → { esito, notifica? , blocco?, inAttesa? }
async function proponiNotifica(proposta = {}) {
  const M = Mem();
  const G = TG();
  if (!M || !G) return { esito: 'in-attesa' };
  const {
    testo, kind, action, color,
    fiducia, origine, richiestaUtente, regolaAutomazione, produttore,
  } = proposta;

  const verdetto = await controllaTesto({
    testo, fiducia, origine, richiestaUtente, regolaAutomazione, produttore,
  });

  if (verdetto.esito === 'passa') {
    const notifica = await M.addNotification({
      kind, text: testo, action, color, origine,
      guardiano: G.vaControllato(fiducia) ? 'passato' : 'pulito',
    });
    cambiato();
    return { esito: 'passa', notifica };
  }

  if (verdetto.esito === 'blocca') {
    const blocco = await M.addGuardBlock({
      origine, motivo: verdetto.motivo, regola: verdetto.regola, testo,
      fonte: regolaAutomazione || richiestaUtente || '',
    });
    // Al posto dell'avviso una riga sobria, che dice cosa ha visto.
    const notifica = await M.addNotification({
      kind: 'alert',
      text: G.frasediBlocco({ origine, motivo: verdetto.motivo }),
      action: { tipo: 'guardiano-blocco', bloccoId: blocco.id },
      origine,
      guardiano: 'blocco',
    });
    cambiato();
    return { esito: 'blocca', blocco, notifica };
  }

  const inAttesa = await M.addPendingNotification({
    testo, kind, action, color, fiducia, origine, richiestaUtente, regolaAutomazione, produttore,
    ultimoMotivo: verdetto.motivo,
    ultimaCausa: verdetto.causa || '',
  });
  cambiato();
  return { esito: 'in-attesa', inAttesa };
}

// ── La coda: riparte al giro dopo ───────────────────────────────────────────
//
// Rientrante per finta: se un giro è già in corso, il secondo aspetta quello
// invece di raddoppiare le chiamate al modello.
let _giroInCorso = null;

async function riprendiInAttesa({ force = false } = {}) {
  // La guardia dev'essere SINCRONA: se si aspettasse anche solo una lettura
  // prima di piantare la bandierina, due giri partiti insieme passerebbero
  // entrambi e il modello verrebbe pagato due volte.
  if (_giroInCorso) return _giroInCorso;
  _giroInCorso = (async () => {
    const M = Mem();
    const G = TG();
    if (!M || !G) return { mostrati: 0, bloccati: 0, restano: 0 };
    const coda = await M.listPendingNotifications();
    // Coda vuota: niente da fare, e niente che consumi il freno — così il primo
    // avviso che ci finisce ha subito la sua occasione.
    if (!coda.length) return { mostrati: 0, bloccati: 0, restano: 0 };
    if (!force && _ultimoGiro && Date.now() - _ultimoGiro < RIPRESA_MIN_MS) {
      return { mostrati: 0, bloccati: 0, restano: coda.length, rimandato: true };
    }
    _ultimoGiro = Date.now();
    let mostrati = 0;
    let bloccati = 0;
    for (const voce of coda) {
      const verdetto = await controllaTesto({
        testo: voce.testo,
        fiducia: voce.fiducia,
        origine: voce.origine,
        richiestaUtente: voce.richiestaUtente,
        regolaAutomazione: voce.regolaAutomazione,
        produttore: voce.produttore,
      });
      if (verdetto.esito === 'in-attesa') {
        await M.updatePendingNotification(voce.id, {
          tentativi: (voce.tentativi || 0) + 1,
          ultimoMotivo: verdetto.motivo,
          ultimoTentativo: new Date().toISOString(),
        });
        continue;
      }
      await M.removePendingNotification(voce.id);
      if (verdetto.esito === 'passa') {
        await M.addNotification({
          kind: voce.kind, text: voce.testo, action: voce.action, color: voce.color,
          origine: voce.origine, guardiano: 'passato',
        });
        mostrati++;
      } else {
        const blocco = await M.addGuardBlock({
          origine: voce.origine, motivo: verdetto.motivo, regola: verdetto.regola,
          testo: voce.testo, fonte: voce.regolaAutomazione || voce.richiestaUtente || '',
        });
        await M.addNotification({
          kind: 'alert',
          text: G.frasediBlocco({ origine: voce.origine, motivo: verdetto.motivo }),
          action: { tipo: 'guardiano-blocco', bloccoId: blocco.id },
          origine: voce.origine,
          guardiano: 'blocco',
        });
        bloccati++;
      }
    }
    const restano = (await M.listPendingNotifications()).length;
    if (mostrati || bloccati) cambiato();
    return { mostrati, bloccati, restano };
  })();
  try { return await _giroInCorso; } finally { _giroInCorso = null; }
}

// Le voci in coda come le vede l'utente: una riga che dice che l'avviso esiste e
// sta aspettando, MAI il testo non ancora controllato.
async function righeInAttesa() {
  const M = Mem();
  const G = TG();
  if (!M || !G) return [];
  const coda = await M.listPendingNotifications();
  return coda.map((v) => ({
    id: v.id,
    ts: v.ts,
    kind: 'attesa',
    text: G.fraseInAttesa({ origine: v.origine }),
    origine: v.origine || '',
  }));
}

module.exports = {
  configure,
  controllaTesto,
  proponiNotifica,
  riprendiInAttesa,
  righeInAttesa,
  TENTATIVI_MAX,
};
