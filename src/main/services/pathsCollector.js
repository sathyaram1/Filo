// Raccolta percorsi della sidebar Aiuto: pipeline di sanitizzazione + invio.
//
// Il client (sidebar) raccoglie una sessione raw (URL iniziale, sequenza di
// {selector, action, retracted}, messaggi raw dell'utente, esito 👍/👎) e la
// passa qui via MSG.SAVE_PATH. Tutto ciò che finisce nella raccolta pubblica
// passa prima per due LLM distinti per evitare leak di dati personali:
//
//   1. INTENT_GUESS   — vede SOLO i dati programmatici (dominio, URL, sequenza
//                       azioni con selettori sanitizzati). Produce una frase
//                       di intento "neutra".
//   2. INTENT_JUDGE   — vede l'intento proposto, i messaggi raw dell'utente E
//                       QUELLO CHE VERREBBE PUBBLICATO (nome del sito,
//                       indirizzo di partenza e nomi degli elementi). Risponde
//                       {ok: true|false}: solo un bit esce da qui.
//
// Il giudice guardava il solo intento, mentre documento, regole e pagina della
// privacy davano per scontato che vedesse tutto (#584, terzo giro): riceveva
// «(nessuna)» e «(nessun elemento)» e approvava alla cieca. È lui l'unica cosa
// che ferma un nome di persona scritto a lettere, «Profilo di Mario Rossi»
// dentro l'etichetta di un pulsante, perché nessuna regola di forma distingue
// un nome da una parola qualunque.
//
// IL NOME DEL SITO è arrivato per ultimo (#584, sesto giro), ed è la parte più
// esposta: non si può ripulire, perché è anche l'indirizzo sotto cui il
// documento va a finire. Su un sito personale quel nome è un nome e cognome,
// su un'intranet è il datore di lavoro. Quindi due difese, in quest'ordine:
// i siti che non sono di nessuno (indirizzi numerici, nomi di una parola sola,
// suffissi di rete locale, le pagine interne di Filo) non si raccolgono
// affatto, senza spendere una chiamata; per tutti gli altri decide il giudice,
// che adesso il nome del sito ce l'ha davanti insieme al resto.
//
// Se il judge dice ok, il percorso NON parte: entra in una coda sul disco e
// viene INVIATO AL SERVER (callable `pathSubmit`) ore dopo. Il server riapplica
// la stessa pulizia deterministica e scrive lui; nessun client scrive più nella
// raccolta (firestore.rules → match /paths), perché i due LLM qui sopra girano
// sulla macchina di chi naviga e nessuna regola può provare che siano passati.
//
// PERCHÉ LA CODA (#584, secondo giro). Togliere il `clientId` dal documento non
// bastava: Firestore scrive da sé su ogni documento l'ora di creazione, al
// microsecondo, e la rimanda a chiunque legga. L'app non può né scriverla né
// toglierla. Due percorsi arrivati su due domini diversi a meno di un secondo
// l'uno dall'altro sono della stessa persona nella stessa sessione: la chiave
// di join che il clientId aveva smesso di essere, la faceva l'orologio. Quindi
// un percorso entra in coda con un'ora di uscita sorteggiata nelle ore
// successive, e la coda ne manda fuori UNO alla volta, a intervalli anch'essi
// sorteggiati. Costa niente: nessuno aspetta questo invio, è telemetria che
// servirà ad altri più tardi.
//
// La pulizia deterministica (redaction dei selettori e dell'indirizzo, tetti,
// forma del dominio, intento su una riga) NON sta qui: è in
// `src/shared/pathsSafety.js`, da dove la incorpora anche il server. Qui resta
// la parte che può vivere solo sul client: i due LLM, i messaggi raw
// dell'utente — che non escono dalla sua macchina — e la coda.

(function (global) {
  'use strict';

  const { ACTIONS } = global.SN_CONST;
  const Paths = global.SN_PATHS;
  const Safety = global.SN_PATHS_SAFETY;

  // Limiti difensivi sui messaggi raw dell'utente: non escono dalla macchina
  // (li vede solo il judge, che risponde 1 bit), ma un prompt non deve poter
  // esplodere — e un messaggio a più righe aprirebbe nella domanda al giudice
  // sezioni che sembrano parte della domanda stessa (#584, quarto giro).
  const MAX_USER_MSG_LEN = 1000;
  const MAX_USER_MSGS = 20;

  function unaRiga(testo, max) {
    return global.SN_CONST.unaRigaDiDati(testo, max);
  }

  function protocolloDi(rawUrl) {
    try { return new URL(String(rawUrl || '')).protocol; } catch (_) { return ''; }
  }

  function sanitizeUserMessages(raws) {
    if (!Array.isArray(raws)) return [];
    return raws
      .filter((m) => typeof m === 'string' && m.trim())
      .slice(0, MAX_USER_MSGS)
      .map((m) => unaRiga(m, MAX_USER_MSG_LEN))
      .filter(Boolean);
  }

  // ------------------------ Estrazione output LLM --------------------------

  // L'intent-guess produce una sola riga di testo. La ripuliamo con la pulizia
  // condivisa (una riga, niente marcature, tetto ai caratteri) e in più
  // riconosciamo la risposta "intento non chiaro", che significa: non salvare.
  function cleanGuessedIntent(text) {
    const s = Safety._internal.sanitizeIntent(typeof text === 'string' ? text : '');
    if (!s) return null;
    if (/^intento non chiaro\.?$/i.test(s)) return null;
    return s;
  }

  function parseJudgeOutput(text) {
    if (typeof text !== 'string') return false;
    const trimmed = text.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) return false;
    try {
      const obj = JSON.parse(trimmed.slice(start, end + 1));
      return obj && obj.ok === true;
    } catch (_) {
      return false;
    }
  }

  // ------------------------ La coda che stacca l'orologio --------------------
  //
  // Perché esista, vedi la testata. Qui i numeri e le regole:
  //
  // - RITARDO: un percorso esce fra mezz'ora e ventiquattr'ore dopo, sorteggiato
  //   per ciascuno a parte. Due percorsi della stessa sessione finiscono quasi
  //   sempre a ore di distanza, e l'ordine in cui escono non è quello in cui
  //   sono stati percorsi.
  // - UNO ALLA VOLTA: ogni giro manda fuori un solo percorso, anche se ne sono
  //   maturati dieci. Serve per il caso "app chiusa per una settimana", dove
  //   svuotare tutto insieme rimetterebbe i percorsi in fila nell'ordine della
  //   sessione, a millisecondi l'uno dall'altro: la ricucitura di prima.
  // - PAUSA fra un giro e l'altro: fra due e venti minuti, sorteggiata.
  // - Se l'invio fallisce (niente rete, server giù) il percorso resta in coda e
  //   si riprova al giro dopo. Dopo trenta giorni si rinuncia: un percorso
  //   vecchio di un mese non serve più a nessuno.

  const CHIAVE_CODA = (global.SN_CONST && global.SN_CONST.STORAGE_KEYS
    && global.SN_CONST.STORAGE_KEYS.PATHS_OUTBOX) || 'pathsOutbox';

  const RITARDO_MIN_MS = 30 * 60 * 1000;          // mezz'ora
  const RITARDO_MAX_MS = 24 * 60 * 60 * 1000;     // un giorno
  const PAUSA_MIN_MS = 2 * 60 * 1000;             // due minuti
  const PAUSA_MAX_MS = 20 * 60 * 1000;            // venti minuti
  // Quanti percorsi può tenere la coda. Era cento, e il centunesimo faceva
  // sparire il più vecchio senza dire niente: cioè proprio quello più vicino a
  // partire, dopo che aveva già aspettato ore (#584, quarto giro). Adesso il
  // tetto è dimensionato sul caso peggiore vero — chi usa l'Aiuto molte volte
  // al giorno e tiene Filo chiuso per giorni, mentre la coda ne manda fuori uno
  // ogni due-venti minuti e dopo trenta giorni un percorso scade da sé — e
  // quando è pieno a restare fuori è quello NUOVO, con un motivo scritto nei
  // log. Quello che è già in coda non si butta: è già stato accettato.
  const MAX_IN_CODA = 500;
  const MAX_ETA_MS = 30 * 24 * 60 * 60 * 1000;    // un mese

  let coda = [];
  let caricamento = null;   // la lettura del disco, una sola per tutti
  let sto = false;          // un giro alla volta
  let auto = true;          // spegnibile nei test
  let timer = null;
  let sorteggio = Math.random;
  // Come si chiede un token fresco al momento dell'invio. Non si può tenere
  // quello di quando il percorso è stato raccolto: fra allora e la partenza
  // passano ore, e un token scaduto è una richiesta senza mittente.
  let ottieniIdToken = async () => '';

  function sorteggia(min, max) {
    return Math.round(min + sorteggio() * (max - min));
  }

  function deposito() { return global.SN_STORAGE; }

  async function salva() {
    try { await deposito()?.setRaw?.(CHIAVE_CODA, coda); }
    catch (e) { console.warn('[Filo] coda percorsi: salvataggio fallito', e?.message || e); }
  }

  // Una sola lettura del disco, e chi arriva mentre è in corso ASPETTA QUELLA.
  // Con un semplice "già fatta?" chi accodava un percorso nei millisecondi fra
  // l'avvio e la fine della lettura scriveva sulla coda ancora vuota, e poi la
  // lettura gli passava sopra: la coda di prima spariva dal disco senza dire
  // niente (#584, terzo giro).
  function carica() {
    if (caricamento) return caricamento;
    caricamento = leggiDaDisco();
    return caricamento;
  }

  async function leggiDaDisco() {
    try {
      const raw = await deposito()?.getRaw?.(CHIAVE_CODA, []);
      if (Array.isArray(raw)) {
        coda = raw
          .filter((v) => v && typeof v === 'object' && v.domain)
          .map((v) => ({
            id: String(v.id || `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
            domain: String(v.domain),
            initialUrl: String(v.initialUrl || ''),
            intent: String(v.intent || ''),
            steps: Array.isArray(v.steps) ? v.steps : [],
            success: !!v.success,
            accodatoIl: Number(v.accodatoIl) || Date.now(),
            nonPrimaDi: Number(v.nonPrimaDi) || Date.now(),
          }));
      }
    } catch (e) {
      console.warn('[Filo] coda percorsi: lettura fallita', e?.message || e);
    }
  }

  function pianifica(fra) {
    if (!auto || timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush().catch(() => {});
    }, Math.max(0, fra | 0));
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  async function accoda(percorso) {
    await carica();
    if (coda.length >= MAX_IN_CODA) {
      console.warn(`[Filo] coda percorsi: piena (${coda.length} in attesa), il percorso nuovo non entra`);
      return { id: '', piena: true };
    }
    const ora = Date.now();
    const voce = {
      id: `p_${ora}_${Math.random().toString(36).slice(2, 8)}`,
      domain: percorso.domain,
      initialUrl: percorso.initialUrl,
      intent: percorso.intent,
      steps: percorso.steps,
      success: !!percorso.success,
      accodatoIl: ora,
      nonPrimaDi: ora + sorteggia(RITARDO_MIN_MS, RITARDO_MAX_MS),
    };
    coda.push(voce);
    await salva();
    pianifica(sorteggia(PAUSA_MIN_MS, PAUSA_MAX_MS));
    return { id: voce.id };
  }

  // Un giro: butta via gli scaduti, manda fuori UN percorso maturo, ripianifica.
  // Torna il numero di percorsi rimasti in coda.
  async function flush({ now = Date.now() } = {}) {
    if (sto) return coda.length;
    sto = true;
    try {
      await carica();
      const prima = coda.length;
      // La scadenza butta il percorso e lo DICE. Finché la funzione del server
      // che li riceve non esiste, ogni invio fallisce e la coda si svuota solo
      // così: senza una riga, la raccolta si fermerebbe e non se ne
      // accorgerebbe nessuno (#584, sesto giro).
      const scaduti = coda.filter((v) => now - v.accodatoIl > MAX_ETA_MS);
      if (scaduti.length) {
        console.warn(`[Filo] coda percorsi: ${scaduti.length} percorso/i scaduto/i dopo trenta giorni senza riuscire a partire, buttati`);
      }
      coda = coda.filter((v) => now - v.accodatoIl <= MAX_ETA_MS);
      // Fra i maturi si sceglie A CASO, non il più vecchio: l'ordine di uscita
      // non deve rifare l'ordine della sessione.
      const maturi = coda.filter((v) => v.nonPrimaDi <= now);
      let inviato = false;
      if (maturi.length) {
        const voce = maturi[Math.min(maturi.length - 1, Math.floor(sorteggio() * maturi.length))];
        let idToken = '';
        try { idToken = (await ottieniIdToken()) || ''; } catch (_) { idToken = ''; }
        try {
          await Paths.submit({
            domain: voce.domain,
            initialUrl: voce.initialUrl,
            intent: voce.intent,
            steps: voce.steps,
            success: voce.success,
            idToken,
          });
          coda = coda.filter((v) => v.id !== voce.id);
          inviato = true;
        } catch (e) {
          console.warn('[Filo] coda percorsi: invio fallito, riprovo', e?.message || e);
        }
      }
      if (inviato || coda.length !== prima) await salva();
    } finally {
      sto = false;
    }
    if (coda.length) pianifica(sorteggia(PAUSA_MIN_MS, PAUSA_MAX_MS));
    return coda.length;
  }

  function inCoda() { return coda.length; }

  // All'avvio: se sul disco è rimasto qualcosa, si riparte (con una pausa, non
  // subito: un lampo di invii all'apertura sarebbe di nuovo un orario).
  function init(opzioni) {
    if (opzioni && typeof opzioni.ottieniIdToken === 'function') {
      ottieniIdToken = opzioni.ottieniIdToken;
    }
    carica().then(() => {
      if (coda.length) pianifica(sorteggia(PAUSA_MIN_MS, PAUSA_MAX_MS));
    }).catch(() => {});
  }

  // ------------------------ «Da qui si raccoglie?» -------------------------
  //
  // LA PORTA UNICA della domanda «se l'utente rispondesse, partirebbe
  // qualcosa?». La fa la raccolta prima di spendere i due modelli, e la fa il
  // riquadrino «Ha funzionato?» prima di comparire: erano due cose diverse, e
  // il riquadro prometteva di condividere anche dalle pagine interne di Filo,
  // dal server di prova, dall'intranet e dal disco di rete, dove il sesto giro
  // ha deciso che non si raccoglie niente. Chi rispondeva leggeva «Grazie!» e
  // non era partito niente (#584, settimo giro). Una promessa che non si
  // avvera è peggio del silenzio, e qui la promessa è tutto quello che
  // l'utente ha per decidere.
  //
  // Sono tre cose, e nessuna costa una chiamata: il protocollo (l'Aiuto si apre
  // anche sulle pagine `filo://`, con lo stesso tasto), il nome del sito, e lo
  // spazio in coda — perché un percorso che non ci entra è un'altra risposta
  // spesa per niente.
  //
  // Ritorna { ok } oppure { ok:false, reason } con lo stesso motivo che
  // `collectAndSave` riporterebbe.
  async function raccoglibile(rawUrl) {
    const domain = Safety._internal.domainOf(rawUrl);
    if (!domain) return { ok: false, reason: 'dominio non valido' };
    if (!/^https?:$/i.test(protocolloDi(rawUrl)) || !Safety.sitoCondivisibile(domain)) {
      return { ok: false, reason: 'sito privato o locale: non si condivide' };
    }
    await carica();
    if (coda.length >= MAX_IN_CODA) return { ok: false, reason: 'coda dei percorsi piena' };
    return { ok: true };
  }

  // ------------------------ Orchestratore --------------------------
  //
  // Ritorna { saved: bool, reason: string }. Non lancia: i fallimenti sono
  // reportati come reason testuale così il chiamante può loggare senza che
  // l'utente veda errori (è una pipeline best-effort di telemetria).
  async function collectAndSave({ session, invokeAI }) {
    if (!session || typeof session !== 'object') {
      return { saved: false, reason: 'session vuota' };
    }
    // Un sito che non è di nessuno non si condivide, e si scopre PRIMA dei due
    // modelli: chiederglielo costerebbe due chiamate per un percorso che verrà
    // buttato comunque. È la stessa domanda che si fa il riquadrino prima di
    // comparire — una porta sola, o le due risposte divergono (vedi
    // `raccoglibile` qui sopra).
    const porta = await raccoglibile(session.rawUrl);
    if (!porta.ok) return { saved: false, reason: porta.reason };
    const domain = Safety._internal.domainOf(session.rawUrl);
    const initialUrl = Safety._internal.normalizedPath(session.rawUrl);
    const sanitizedSteps = Safety._internal.sanitizeSteps(session.rawSteps);
    if (!sanitizedSteps.length) return { saved: false, reason: 'nessuno step utile dopo sanitizzazione' };

    const rawUserMessages = sanitizeUserMessages(session.rawUserMessages);
    if (!rawUserMessages.length) return { saved: false, reason: 'nessun messaggio utente raw' };

    // 1. intent guess: vede SOLO dati programmatici già sanitizzati.
    let guessedIntent = null;
    try {
      const r = await invokeAI({
        action: ACTIONS.HELP_INTENT_GUESS,
        payload: { domain, initialUrl, steps: sanitizedSteps },
      });
      guessedIntent = cleanGuessedIntent(r?.text);
    } catch (e) {
      return { saved: false, reason: `intent_guess fallito: ${e.message || e}` };
    }
    if (!guessedIntent) return { saved: false, reason: 'intento non chiaro' };

    // 2. judge: intento proposto + messaggi raw + QUELLO CHE VERREBBE
    // PUBBLICATO (nome del sito, indirizzo di partenza e nomi degli elementi,
    // già ripuliti). Output: solo 1 bit. Vedi la testata per il perché delle
    // ultime tre.
    let ok = false;
    try {
      const r = await invokeAI({
        action: ACTIONS.HELP_INTENT_JUDGE,
        payload: {
          proposedIntent: guessedIntent,
          userMessages: rawUserMessages,
          domain,
          initialUrl,
          steps: sanitizedSteps,
        },
      });
      ok = parseJudgeOutput(r?.text);
    } catch (e) {
      return { saved: false, reason: `intent_judge fallito: ${e.message || e}` };
    }
    if (!ok) return { saved: false, reason: 'judge ha rifiutato l\'intento' };

    // 3. in coda. NON si invia adesso: vedi la testata.
    try {
      const { id, piena } = await accoda({
        domain,
        initialUrl,
        intent: guessedIntent,
        steps: sanitizedSteps,
        success: !!session.success,
      });
      if (piena) return { saved: false, reason: 'coda dei percorsi piena' };
      return { saved: true, queued: true, id, intent: guessedIntent };
    } catch (e) {
      return { saved: false, reason: `coda percorsi fallita: ${e.message || e}` };
    }
  }

  global.SN_PATHS_COLLECTOR = {
    collectAndSave,
    raccoglibile,
    init,
    flush,
    inCoda,
    // Esposti per test/debug e per riuso in altri moduli. La pulizia
    // deterministica è quella condivisa col server: qui è solo ri-esportata,
    // non riscritta.
    _internal: {
      sanitizeUserMessages, cleanGuessedIntent, parseJudgeOutput,
      accoda, sorteggia, RITARDO_MIN_MS, RITARDO_MAX_MS, MAX_IN_CODA,
      redactSelector: Safety._internal.redactSelector,
      sanitizeSteps: Safety._internal.sanitizeSteps,
      domainOf: Safety._internal.domainOf,
      normalizedPath: Safety._internal.normalizedPath,
      redigiPercorso: Safety._internal.redigiPercorso,
    },
    // ---- helper per i test (nessun effetto in produzione) ----
    _peek: () => coda.map((v) => ({ ...v })),
    _setAuto: (v) => { auto = !!v; if (!auto && timer) { clearTimeout(timer); timer = null; } },
    _setSorteggio: (fn) => { sorteggio = typeof fn === 'function' ? fn : Math.random; },
    _setIdToken: (fn) => { ottieniIdToken = typeof fn === 'function' ? fn : async () => ''; },
    _reset: () => {
      coda = []; caricamento = null; sto = false; auto = true; sorteggio = Math.random;
      ottieniIdToken = async () => '';
      if (timer) { clearTimeout(timer); timer = null; }
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
