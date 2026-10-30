// Il giro di verifica — la parte PURA (feedback #561, deciso con l'owner il
// 2026-09-04/05).
//
// COSA C'È QUI
//   Le regole con cui un giro di verifica decide cosa succede ai rilievi:
//   quali si correggono subito (e da quale bilancio si paga il giro), quali
//   finiscono nel feedback derivato, e quando il lavoro si ferma e passa
//   all'owner. Più il formato con cui il verificatore scrive la critica
//   (`[livello+sede] testo`: `[2i]`, `[1v]`, `[1e?]`, una riga per rilievo) e il
//   suo parser. Contano gli interni, i vicini valgono 0, gli esterni escono a parte.
//   In fondo il motivo del correttore e il giro dopo un riallineamento.
//
// PERCHÉ È CONDIVISO
//   Le stesse regole girano in TRE posti: sul server (filo-security, che le
//   incorpora al deploy con bake-shared, come le transizioni), nello strumento
//   delle routine (`scripts/dispatch.mjs`, che le usa per lo specchio locale
//   dello stato) e nella verifica locale (`scripts/verify-local.mjs`). Una
//   copia sola, o la dashboard mostra una regola e il server ne applica
//   un'altra.
//
// PURO: niente Firestore, niente rete, niente I/O. Convenzione IIFE del repo:
// si registra su globalThis come SN_VERIFIER_ROUND.

(function (global) {
  'use strict';

  // I livelli della scala delle priorità di Filo (routines/roles/
  // _critica-e-livelli.md): il metro è la frequenza, 3 sicurezza/soldi/Filo
  // inutilizzabile sul cammino normale, 2 funzione rotta nel caso normale,
  // 1 di rado, 0 cosmetico raro.
  const LEVELS = [0, 1, 2, 3];
  // La SEDE di un rilievo, indipendente dal livello (decisione dell'owner del
  // 2026-09-22): `i` interno (tocca a questo lavoro: lo scenario della
  // segnalazione, o l'ha creato il ramo), `e` esterno (un altro lavoro), `v`
  // vicino (un altro lavoro, ma in un file che il ramo modifica già: decisione
  // del 2026-09-27). Il giro conta gli interni, e i vicini come livello 0; ogni
  // esterno esce subito in un feedback suo con priorità uguale al livello.
  const SEDI = ['i', 'e', 'v'];
  const SPIEGAZIONE_SEDE = 'manca la sede dopo il livello: «i» se tocca a questo lavoro, «v» se è di un altro lavoro ma sta in un file che il ramo modifica già, «e» se è un altro lavoro (per esempio [2i], [1v], [1e?])';

  // Tetto ai rilievi di una critica: oltre non è una critica, è un elenco generato.
  const MAX_FINDINGS = 40;
  // Il tetto di un rilievo è quello della critica intera: oltre, la critica viene RESPINTA
  // col numero, non tagliata — a 2000 i passi in coda sparivano in silenzio.
  const MAX_FINDING_TEXT = 12000;

  /**
   * A quale bilancio appartiene un livello: uno per livello. Fino al
   * 2026-09-23 il 3 pagava dal bilancio del 2; separarli è ciò che permette
   * al 2 di non fermare il lavoro a bilancio finito (decideRound). PURA.
   */
  function capKeyOf(level) {
    const n = Number(level);
    if (n >= 3) return 'cap3';
    if (n === 2) return 'cap2';
    if (n === 1) return 'cap1';
    return 'cap0';
  }

  function countKeyOf(level) {
    return capKeyOf(level).replace('cap', 'count');
  }

  // ── Il formato della critica ───────────────────────────────────────────────
  //
  // Una riga per rilievo, che comincia col livello E la sede fra quadre:
  //
  //   [2i] Il pulsante «Salva» non salva se il titolo è vuoto: passi …
  //   [1i?] Il colore del bordo non segue il tema scuro (chiede una decisione)
  //   [2e] Preferenze aperta in due schede cancella le modifiche (c'era già su main)
  //
  // Il `?` dopo la sede segna «chiede una decisione dell'owner» (un
  // trade-off vero, una scelta di prodotto). La sede è OBBLIGATORIA: un
  // «[2]» senza lettera non prende un default in silenzio, viene respinto con
  // la spiegazione (unparsedLevelLines, e `rifiutati` di parseFindings). Le
  // righe che seguono un rilievo senza un livello davanti sono la sua
  // continuazione (i passi per riprodurlo); le righe PRIMA del primo rilievo
  // sono il riassunto («cosa funziona»). Una critica senza nessuna riga con
  // livello ha zero rilievi: è il pass.
  // Il livello può stare dopo un punto elenco («- [2]») o un numero («1. [2]»):
  // un elenco numerato è il modo più naturale di scrivere tre rilievi.
  // Davanti al livello valgono anche un titolo Markdown («### [2]»), una
  // citazione («> [2]») e un elenco con le lettere («a) [2]»): chi scrive in
  // Markdown se le aspetta come «- [2]» e «1. [2]» (verifica del giro 11).
  // I modi di elencare ammessi davanti al livello stanno in UN posto solo: il
  // controllo che respinge un livello scritto male deve guardarne esattamente
  // quanti ne accetta il lettore. Quando ne guardava meno, un «[4] gravissimo»
  // scritto dopo un `>` o dei cancelletti finiva nel riassunto — cioè una
  // bocciatura diventava una promozione, in silenzio (feedback #565).
  const PREFISSO_ELENCO = '(?:#{1,6}\\s*|>\\s*|[-*•]\\s*|\\d{1,2}[.)]\\s*|[A-Za-z][.)]\\s*)?';
  // Il grassetto si scrive con gli asterischi O con gli underscore: «__tre] …» deve valere
  // quanto «**tre] …».
  const GRASSETTO = '(?:\\*{1,3}|_{1,3})?';
  // Il segno «?» si accetta anche PRIMA della lettera («[1?i]»): il significato
  // è lo stesso e respingerlo costerebbe un giro per un ordine di due caratteri.
  const FINDING_LINE = new RegExp(`^\\s*${PREFISSO_ELENCO}${GRASSETTO}\\[\\s*([0-3])\\s*(?:(\\?)\\s*)?([ievIEV])\\s*(\\?)?\\s*\\]${GRASSETTO}\\s*(.*)$`);
  // La forma VECCHIA, col solo livello: si riconosce per respingerla con la
  // spiegazione giusta, non per leggerla.
  const FINDING_LINE_SENZA_SEDE = new RegExp(`^\\s*${PREFISSO_ELENCO}${GRASSETTO}\\[\\s*([0-3])\\s*(\\?)?\\s*\\]${GRASSETTO}\\s*(.*)$`);

  /** I gruppi di FINDING_LINE come rilievo: livello, sede minuscola, segno «?», testo. PURA. */
  function rilievoDa(m) {
    return { level: Number(m[1]), sede: String(m[3]).toLowerCase(), text: m[5].trim(), decision: m[2] === '?' || m[4] === '?' };
  }
  // Qualunque cosa fra parentesi quadre che sembri un livello — anche fuori
  // scala («[4]») o scritto come intervallo («[2-3]», «[2/3]»). Una riga che
  // COMINCIA così, o che lo porta dopo una breve etichetta e prima di un
  // separatore («Rilievo [2]: …», «Livello [2] - …»), non è un rilievo ma non
  // è nemmeno riassunto. Con la sola scala 0-3 un «[4] gravissimo» passava in
  // silenzio (verifica del giro 3 su #561). In MEZZO a una frase invece le
  // parentesi sono testo: «ho ri-provato la porta [2] del giro scorso» è il
  // modo naturale di scrivere il riassunto (verifica del giro 4).
  // Anche un livello scritto con una parola davanti («[livello 2]», «[L2]»,
  // «[P2]») è un livello messo male, non riassunto: finiva nel riassunto in
  // silenzio e il lavoro passava (verifica del giro 6). Lo stesso per il segno
  // messo prima della cifra («[?2]») o un segno diverso dopo («[2!]»): non
  // erano né rilievi né errori (verifica del giro 7).
  const LEVEL_TOKEN_SRC = '\\[\\s*(?:[A-Za-zÀ-ÿ.?!]{1,10}\\s*)?\\d+(?:\\s*[-–/.,]\\s*\\d+)?\\s*[?!]*\\s*(?:[A-Za-zÀ-ÿ]{1,10}\\s*)?\\]';
  const LEVEL_START = new RegExp(`^\\s*${PREFISSO_ELENCO}${GRASSETTO}${LEVEL_TOKEN_SRC}`);
  // Un livello in una parentesi qualunque — tonda, graffa, doppia, spaiata — o con la cifra a
  // parole: il lettore riconosce solo la quadra con la cifra. Qui si guarda come APRE la riga.
  const PARENTESI_QUALUNQUE = '(?:\\[{1,2}|\\(|\\{)\\s*[^\\]\\)\\}\\n]{0,20}(?:\\]{1,2}|\\)|\\})';
  const APERTURA_PARENTESI = new RegExp(`^\\s*${PREFISSO_ELENCO}${GRASSETTO}(${PARENTESI_QUALUNQUE})`);
  const DENTRO_SEMBRA_LIVELLO = /\d|zero|uno|due|tre|livello|level|priorit/i;
  // La rete per tutte le altre aperture: se entro sei caratteri c'è un livello e il lettore
  // non legge la riga come rilievo, è un rilievo scritto male. Una frase vera ha più parole.
  const LIVELLO_VICINO = new RegExp(`^.{0,6}?(${PARENTESI_QUALUNQUE})`);
  // Regola dell'owner (#565): una QUADRA con dentro un livello è SEMPRE un rilievo, dovunque
  // stia. Se la riga non si legge come rilievo, viene respinta con la spiegazione.
  const QUADRA_OVUNQUE = /\[{1,2}[^\]\n]{0,200}\]{1,2}/g;
  // E, dovunque nella riga, una parentesi di QUALUNQUE forma che contenga SOLO un livello:
  // «(3)», «{2}», «[2)», «(due)». Il contenuto è stretto apposta: «(3 volte)» resta testo.
  const SOLO_UN_LIVELLO = '\\s*(?:(?:livello|level|priorit[àa]|liv|L|P)\\s*)?(?:\\d+(?:\\s*[.,\\-–/]\\s*\\d+)?|zero|uno|due|tre)\\s*[?!]*\\s*';
  // Le parole si ancorano ai confini, o «altre» conterrebbe «tre»; il confine si guarda alle
  // LETTERE, non con \b: per la regex l'underscore è carattere di parola.
  const LIVELLO_NUDO = '(?:\\d|(?<![A-Za-zÀ-ÿ])(?:zero|uno|due|tre)(?![A-Za-zÀ-ÿ])|[?!])';
  const QUADRA_APERTA = new RegExp(`\\[{1,2}[^\\[\\]\\n]{0,200}?${LIVELLO_NUDO}`, 'i');
  const QUADRA_CHIUSA = new RegExp(`${LIVELLO_NUDO}[^\\[\\]\\n]{0,200}?\\]{1,2}`, 'i');

  // Un livello che APRE la riga e incontra una parentesi di CHIUSURA mai aperta: «tre] …».
  // La finestra non può contenere una parentesi APERTA, così «3 volte (ok)» resta testo.
  const APRE_LIVELLO_SENZA_APERTURA = new RegExp(
    `^\\s*${PREFISSO_ELENCO}${GRASSETTO}(?:`
    // Quadra e graffa di chiusura: nessuno le usa per elencare, quindi valgono sempre.
    + `${LIVELLO_NUDO}[^\\[\\](){}\\n]{0,200}?[\\]}]`
    // La tonda invece È un modo di elencare: «1) primo punto» è testo normale. Vale solo col
    // livello scritto a parole, o con qualcosa in mezzo.
    + `|(?:zero|uno|due|tre)(?![A-Za-zÀ-ÿ])[^\\[\\](){}\\n]{0,200}?\\)`
    + `|\\d[^\\[\\](){}\\n]{1,200}?\\)`
    + `)`, 'i');

  function quadraColLivello(riga) {
    // TUTTE le quadre della riga, non solo la prima: una frase fra quadre all'inizio nascondeva
    // il livello scritto più avanti. E il contenuto può essere lungo.
    const testo = String(riga || '');
    // La quadra SPAIATA col contenuto lunghissimo: una parentesi dimenticata è lo stesso errore
    // di battitura della virgoletta che manca, e non deve costare una bocciatura.
    if (QUADRA_APERTA.test(testo) || QUADRA_CHIUSA.test(testo)) return true;
    QUADRA_OVUNQUE.lastIndex = 0;
    for (let m = QUADRA_OVUNQUE.exec(testo); m; m = QUADRA_OVUNQUE.exec(testo)) {
      if (DENTRO_SEMBRA_LIVELLO.test(m[0])) { QUADRA_OVUNQUE.lastIndex = 0; return true; }
    }
    return false;
  }
  const PARENTESI_LIVELLO = new RegExp(`(?:\\[{1,2}|\\(|\\{)${SOLO_UN_LIVELLO}(?:\\]{1,2}|\\)|\\})`);
  // Nella CONTINUAZIONE di un rilievo un livello citato in mezzo a una frase resta testo: lì
  // il rilievo sopra è comunque registrato e la bocciatura non si perde.
  const QUADRA_VICINA = new RegExp(`^.{0,14}?(${LEVEL_TOKEN_SRC})`);
  // «Difetto: [2] …»: l'etichetta sta PRIMA del livello, col separatore o senza. Guardando
  // solo la forma opposta («Rilievo [2]: …») passava per riassunto.
  const ETICHETTA_PRIMA = new RegExp(`^\\s*${PREFISSO_ELENCO}[^\\[\\]]{1,20}?[:\\-–—]\\s*${LEVEL_TOKEN_SRC}`);
  // L'etichetta breve col separatore vale solo nel riassunto: dentro la continuazione di un
  // rilievo è testo, e respingerla mandava a riscrivere una riga giusta.
  const LEVEL_LABEL = new RegExp(`^\\s*${PREFISSO_ELENCO}${GRASSETTO}[^\\[\\]]{1,30}?\\s*${LEVEL_TOKEN_SRC}\\s*[:\\-–—]`);

  // Un a capo scritto coi due caratteri barra e n: è così che esce un comando d'esempio
  // copiato fra virgolette. Davanti a una quadra vale come a capo; in mezzo a una frase no.
  const LIVELLO_DOPO_CONFINE = '(?:\\d|(?:zero|uno|due|tre)(?![A-Za-zÀ-ÿ])|[?!])';
  const DOPO_A_CAPO = `(?:[\\[({]|${LIVELLO_DOPO_CONFINE}[^\\[\\]\\n]{0,200}?[\\]})])`;
  const ESCAPED_BREAK_BEFORE_BRACKET = new RegExp(`(?:\\\\r)?\\\\n\\s*${PREFISSO_ELENCO}${GRASSETTO}${DOPO_A_CAPO}`, 'i');

  // La critica con gli a capo veri: `\r\n` → `\n`, e la barra-n letterale usata come a capo.
  function normalizeCritique(text) {
    const s = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    return ESCAPED_BREAK_BEFORE_BRACKET.test(s) ? s.replace(/(?:\\r)?\\n/g, '\n') : s;
  }

  // Le righe che NON si possono registrare così: livello fuori posto o fuori scala, livello
  // SENZA testo (un «[2]» solo diventava un pass), più rilievi del tetto: si rifiuta.
  function unparsedLevelLines(text) {
    const lines = normalizeCritique(text).split('\n');
    const out = [];
    let current = null;
    let count = 0;
    const flush = () => {
      if (current && !current.text) out.push(`${current.line} (rilievo senza testo)`);
      current = null;
    };
    for (const raw of lines) {
      const m = FINDING_LINE.exec(raw);
      if (m) {
        // Due livelli sulla STESSA riga: il secondo finiva dentro al testo del
        // primo, e un difetto di sicurezza spariva in coda a uno cosmetico.
        // Basta un a capo dimenticato, che è lo stesso errore della virgoletta
        // che manca (feedback #565).
        if (quadraColLivello(m[5])) {
          flush();
          out.push(raw.trim());
          continue;
        }
        flush();
        count += 1;
        current = { line: raw.trim(), text: m[5].trim() };
        continue;
      }
      // Il livello c'è ma la sede no: è la forma vecchia, e si spiega cosa
      // manca invece di lasciarla fra le righe «scritte male» senza motivo.
      if (FINDING_LINE_SENZA_SEDE.test(raw)) {
        flush();
        out.push(`${raw.trim()} (${SPIEGAZIONE_SEDE})`);
        continue;
      }
      // La regola per intero sta su QUADRA_OVUNQUE: le quadre col livello dentro sono sempre un
      // rilievo; le altre parentesi valgono a inizio riga, dove uno le userebbe per aprirlo.
      const apertura = APERTURA_PARENTESI.exec(raw) || LIVELLO_VICINO.exec(raw.trim());
      const parentesiStorta = (!!apertura && DENTRO_SEMBRA_LIVELLO.test(apertura[1]))
        || quadraColLivello(raw)
        || APRE_LIVELLO_SENZA_APERTURA.test(raw)
        || PARENTESI_LIVELLO.test(raw)
        || ETICHETTA_PRIMA.test(raw);
      if (LEVEL_START.test(raw) || parentesiStorta || (!current && LEVEL_LABEL.test(raw))) {
        flush();
        out.push(raw.trim());
        continue;
      }
      if (current && raw.trim()) current.text += raw.trim();
    }
    flush();
    if (count > MAX_FINDINGS) {
      out.push(`troppi rilievi: ${count}, il massimo è ${MAX_FINDINGS} (raggruppa per causa: un rilievo per porta, non per sintomo)`);
    }
    return out;
  }

  /**
   * Legge la critica scritta dal verificatore. PURA.
   *
   * `rifiutati` sono le righe con un livello ma SENZA la sede («[2] …»), con
   * la spiegazione: non diventano rilievi né riassunto, e chi registra deve
   * respingere la critica finché ce ne sono (le altre forme storte le elenca
   * unparsedLevelLines).
   * @returns {{ summary: string, findings: Array<{level:number, sede:'i'|'e', text:string, decision:boolean}>, rifiutati: string[] }}
   */
  function parseFindings(text) {
    const lines = normalizeCritique(text).split('\n');
    const summary = [];
    const findings = [];
    const rifiutati = [];
    let current = null;
    for (const raw of lines) {
      const m = FINDING_LINE.exec(raw);
      if (m) {
        current = rilievoDa(m);
        findings.push(current);
        continue;
      }
      if (FINDING_LINE_SENZA_SEDE.test(raw)) {
        rifiutati.push(`${raw.trim()} (${SPIEGAZIONE_SEDE})`);
        current = null;
        continue;
      }
      if (current) {
        const cont = raw.trim();
        if (cont) current.text = `${current.text}${current.text ? '\n' : ''}${cont}`;
      } else {
        summary.push(raw);
      }
    }
    return {
      summary: summary.join('\n').trim(),
      findings: normalizeFindings(findings),
      rifiutati,
    };
  }

  /** La sede canonica: `e` e `v` come scritte, tutto il resto (anche l'assenza) interno. PURA. */
  function sedeDi(raw) {
    const s = String(raw == null ? '' : raw).trim().toLowerCase();
    return s === 'e' || s === 'v' ? s : 'i';
  }

  /** Il livello con cui un rilievo conta nel giro: un vicino vale 0, qualunque livello porti scritto. PURA. */
  function effectiveLevel(f) {
    return f && sedeDi(f.sede) === 'v' ? 0 : Number(f && f.level);
  }

  /**
   * Un elenco di rilievi arrivato da fuori (dal client, da un file) portato
   * alla forma canonica. Scarta quello che non è un rilievo: livello fuori
   * scala, testo vuoto. Un rilievo STRUTTURATO senza sede vale interno: è
   * la forma dei client non aggiornati e dello stato già scritto, dove la
   * sede non esisteva; l'obbligo vale sul testo della critica. PURA.
   */
  function normalizeFindings(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const f of list) {
      if (!f || typeof f !== 'object') continue;
      const level = Number(f.level);
      if (!LEVELS.includes(level)) continue;
      const text = String(f.text == null ? '' : f.text).trim().slice(0, MAX_FINDING_TEXT);
      if (!text) continue;
      const rilievo = { level, sede: sedeDi(f.sede), text, decision: f.decision === true };
      // La domanda di un rilievo col `?` (#1790) viaggia con lui: la controlla e la adotta il server, con SN_DOMANDE.
      if (rilievo.decision && f.domanda && typeof f.domanda === 'object' && !Array.isArray(f.domanda)) rilievo.domanda = f.domanda;
      out.push(rilievo);
      if (out.length >= MAX_FINDINGS) break;
    }
    return out;
  }

  /**
   * I rilievi col `?` senza la loro domanda, come campo da nominare nel rifiuto (`findings[1].domanda`): il server non
   * compone più domande dai rilievi (#1790). Vuoto se ognuno ha la sua. PURA.
   */
  function domandeMancanti(findings) {
    return (Array.isArray(findings) ? findings : []).map((f, i) => ({ f, i }))
      .filter(({ f }) => f && f.decision === true && !(f.domanda && typeof f.domanda === 'object' && !Array.isArray(f.domanda)))
      .map(({ i }) => `findings[${i}].domanda`);
  }

  /** Il titolo di un feedback derivato da un rilievo col `?`: quello della sua domanda, '' se non ce l'ha. PURA. */
  function titoloDelDerivato(g) {
    const f = g && Array.isArray(g.findings) && g.findings.length === 1 ? g.findings[0] : null;
    const t = f && f.decision && f.domanda && typeof f.domanda.titolo === 'string' ? f.domanda.titolo.trim() : '';
    return t;
  }

  /** La prima frase di un rilievo, per un titolo (al più `max` caratteri). PURA. */
  function primaFrase(text, max = 120) {
    const prima = String(text == null ? '' : text).split('\n')[0].trim();
    const m = /^(.*?[.!?])(?:\s|$)/.exec(prima);
    const frase = (m ? m[1] : prima).trim();
    return frase.length > max ? `${frase.slice(0, max - 1).trimEnd()}…` : frase;
  }

  /** Il livello più alto fra i rilievi (null se non ce ne sono). PURA. */
  function maxLevel(findings) {
    let m = null;
    for (const f of findings || []) {
      const n = Number(f && f.level);
      if (LEVELS.includes(n) && (m === null || n > m)) m = n;
    }
    return m;
  }

  // ── I bilanci ─────────────────────────────────────────────────────────────
  //
  // Quattro bilanci per feedback, uno per livello (dal 2026-09-23; prima i
  // livelli 3 e 2 ne condividevano uno). I numeri li detta SOLO l'owner dalla
  // dashboard (config/routines): nel codice non c'è un default (decisione del
  // 2026-09-16), e un bilancio mancante non vale 0 né altro — decideRound si
  // ferma con un errore che dice quale manca. Il tetto alto è lo stesso della
  // dashboard. I NOMI sono anche in feedbackTransitions.js (VERIFIER_CAP_KEYS)
  // e nei campi della dashboard: una sentinella li confronta.
  const CAP_MIN = 0;
  const CAP_MAX = 10;
  const CAP_KEYS = ['cap3', 'cap2', 'cap1', 'cap0'];

  /** I bilanci che mancano (né in `caps` né in `defaults`): [] se ci sono tutti. PURA. */
  function missingCaps(caps, defaults) {
    const def = defaults && typeof defaults === 'object' ? defaults : {};
    const src = caps && typeof caps === 'object' ? caps : {};
    return CAP_KEYS.filter((k) => {
      const raw = src[k] != null ? src[k] : def[k];
      return !Number.isFinite(Number(raw)) || raw === '' || raw === true || raw === false;
    });
  }

  function normalizeCaps(caps, defaults) {
    const def = defaults && typeof defaults === 'object' ? defaults : {};
    const src = caps && typeof caps === 'object' ? caps : {};
    const out = {};
    for (const k of CAP_KEYS) {
      const raw = src[k] != null ? src[k] : def[k];
      const n = Math.round(Number(raw));
      out[k] = Number.isFinite(n) ? Math.min(CAP_MAX, Math.max(CAP_MIN, n)) : 0;
    }
    return out;
  }

  function normalizeCounts(counts) {
    const src = counts && typeof counts === 'object' ? counts : {};
    const out = {};
    for (const k of CAP_KEYS) {
      const n = Math.round(Number(src[k.replace('cap', 'count')]));
      out[k.replace('cap', 'count')] = Number.isFinite(n) && n > 0 ? n : 0;
    }
    return out;
  }

  /**
   * L'esito di un giro, calcolato dai livelli e dai bilanci (spec §4). PURA.
   *
   * Regole:
   *   - un rilievo di livello 3 o 2 che chiede una decisione ferma il lavoro;
   *   - un 3 si corregge se il bilancio dei 3 ha ancora giri; a bilancio
   *     finito ferma il lavoro (è l'unico livello che ferma per bilancio);
   *   - un 2 si corregge se nello stesso giro si corregge anche un 3 (il giro
   *     lo paga il 3) oppure se il bilancio dei 2 ha ancora giri; a bilancio
   *     finito NON ferma: va nel feedback derivato, a priorità 2, e il giro
   *     passa se non c'è altro (decisione dell'owner del 2026-09-23);
   *   - un 1 si corregge se nello stesso giro si corregge anche un 3/2 (il
   *     giro lo paga già il livello più alto, e un altro verificatore arriva
   *     comunque: decisione dell'owner del 2026-09-16) oppure se il suo
   *     bilancio ha ancora giri; altrimenti va nel feedback derivato;
   *   - un 1 che chiede una decisione va nel feedback derivato;
   *   - gli 0 si correggono solo se nello stesso giro si corregge anche altro
   *     (un altro verificatore arriva comunque) oppure se l'owner ha dato
   *     giri al loro bilancio; altrimenti vanno nel feedback derivato;
   *   - un giro consuma UN giro dal bilancio del livello più alto corretto;
   *   - se il lavoro si ferma, non si corregge niente: decide l'owner su tutto;
   *   - senza uno dei quattro bilanci LANCIA (`bilanci del verificatore
   *     mancanti: …`): un numero inventato al posto di quello dell'owner è
   *     peggio di un errore (decisione del 2026-09-16).
   *
   * Contano i rilievi interni (sede `i`) e i vicini (sede `v`), questi ultimi
   * come livello 0 qualunque sia il livello scritto: entrano in una correzione
   * che parte comunque, da soli la fanno partire solo col bilancio `cap0`, e
   * un `v?` va da parte come uno 0 col `?`. Gli esterni non entrano in
   * nessuna delle regole sopra: tornano a parte in `external`, ciascuno con
   * `priority` uguale al livello, in ogni esito (anche a lavoro fermo: sono
   * di un altro lavoro, ed escono in un feedback loro). Un esterno col `?`
   * non ferma niente: la domanda viaggia nel suo feedback. Anche i rilievi
   * messi da parte (`derived`) portano `priority` = livello SCRITTO; come
   * diventano feedback lo dice derivedGroups.
   *
   * @param {object} p { findings, caps:{cap3,cap2,cap1,cap0}, counts:{count3,count2,count1,count0} }
   * @returns {{
   *   stop: boolean, blocking: object[], sospesi: object[], fix: object[], derived: object[], external: object[],
   *   consume: 'cap3'|'cap2'|'cap1'|'cap0'|null, counts: object,
   *   budgets: { cap3:{cap,used,left}, cap2:…, cap1:…, cap0:… }
   * }}
   *   `sospesi` (solo allo stop): gli altri interni della stessa critica, che
   *   restano davanti a chi riprende dopo la risposta dell'owner.
   */
  function decideRound(p) {
    const tutti = normalizeFindings(p && p.findings);
    const mancanti = missingCaps(p && p.caps, p && p.defaults);
    if (mancanti.length) {
      throw new Error(`bilanci del verificatore mancanti: ${mancanti.join(', ')} — li imposta l'owner in Gestione → Automazioni (config/routines); nel codice non c'è un default`);
    }
    const caps = normalizeCaps(p && p.caps, p && p.defaults);
    const counts = normalizeCounts(p && p.counts);
    const left = (k) => caps[k] - counts[k.replace('cap', 'count')];
    const conPriorita = (f) => Object.assign({}, f, { priority: f.level });

    const findings = tutti.filter((f) => f.sede !== 'e');
    const external = tutti.filter((f) => f.sede === 'e').map(conPriorita);
    const blocking = [];
    const fixable = [];
    const derived = [];
    const twos = [];
    const ones = [];
    const zeros = [];
    for (const f of findings) {
      const level = effectiveLevel(f);
      if (level >= 3) {
        if (f.decision || left('cap3') <= 0) blocking.push(f);
        else fixable.push(f);
      } else if (level === 2) {
        if (f.decision) blocking.push(f);
        else twos.push(f);
      } else if (level === 1) {
        ones.push(f);
      } else {
        zeros.push(f);
      }
    }
    // I 2: con un 3 da correggere nello stesso giro si correggono pure loro
    // (il giro lo paga il 3); da soli seguono il loro bilancio, e a bilancio
    // finito non fermano: vanno da parte, ciascuno un feedback a priorità 2.
    const withThree = fixable.length > 0;
    for (const f of twos) {
      if (withThree || left('cap2') > 0) fixable.push(f);
      else derived.push(f);
    }
    // Gli 1: con un 3/2 da correggere nello stesso giro si correggono pure
    // loro (il giro lo paga il 3/2); da soli seguono il loro bilancio.
    const withHigher = fixable.length > 0;
    for (const f of ones) {
      if (f.decision) derived.push(f);
      else if (withHigher || left('cap1') > 0) fixable.push(f);
      else derived.push(f);
    }
    // Gli 0: con qualcos'altro da correggere si correggono pure loro; da soli solo se il loro
    // bilancio lo permette.
    for (const f of zeros) {
      if (f.decision) derived.push(f);
      else if (fixable.length || left('cap0') > 0) fixable.push(f);
      else derived.push(f);
    }

    const budgets = {};
    for (const k of CAP_KEYS) budgets[k] = { cap: caps[k], used: counts[k.replace('cap', 'count')], left: Math.max(0, left(k)) };

    if (blocking.length) {
      // Gli altri interni non si perdono con lo stop: chi riprende li trova nel
      // segnalibro, insieme a quello che ha fermato, e il giro dopo non li riscopre.
      const sospesi = findings.filter((f) => !blocking.includes(f));
      return { stop: true, blocking, sospesi, fix: [], derived: [], external, consume: null, counts: Object.assign({}, counts), budgets };
    }

    // Ordine stabile: come nella critica. Il bilancio si paga dal livello più alto corretto.
    const fix = findings.filter((f) => fixable.includes(f));
    const rest = findings.filter((f) => derived.includes(f)).map(conPriorita);
    let consume = null;
    if (fix.length) {
      consume = capKeyOf(maxLevel(fix.map((f) => ({ level: effectiveLevel(f) }))));
      counts[consume.replace('cap', 'count')] += 1;
      budgets[consume].used += 1;
      budgets[consume].left = Math.max(0, budgets[consume].left - 1);
    }
    return { stop: false, blocking: [], sospesi: [], fix, derived: rest, external, consume, counts, budgets };
  }

  // ── I feedback derivati ───────────────────────────────────────────────────

  /**
   * Come i rilievi che un lavoro non corregge diventano feedback derivati
   * (decisione dell'owner del 2026-09-27). PURA. Tre tipi di gruppo:
   *   - `esterno`: un rilievo con sede `e`, da solo (anche col `?`: la domanda
   *     viaggia nel suo feedback), così un esterno di livello 3 nasce subito;
   *   - `decisione`: un interno o vicino col `?`, da solo;
   *   - `rimasti`: TUTTI gli altri (interni messi da parte dal bilancio, vicini
   *     non corretti) in un feedback solo, a priorità = il livello scritto più alto.
   * Accetta un elenco di rilievi o una decisione di decideRound (`external` +
   * `derived`). I rilievi escono con i campi che avevano (anche `num`, `id`),
   * più `sede`, `level`, `priority` e `decision` canonici. Ordine: i gruppi da
   * soli come arrivano, `rimasti` in fondo.
   * @returns {Array<{ tipo: 'esterno'|'decisione'|'rimasti', priority: number, decision: boolean, findings: object[] }>}
   */
  function derivedGroups(input) {
    let list = input;
    if (!Array.isArray(list)) {
      const d = list && typeof list === 'object' ? list : {};
      list = [].concat(Array.isArray(d.external) ? d.external : [], Array.isArray(d.derived) ? d.derived : []);
    }
    const groups = [];
    let rimasti = null;
    for (const f of list) {
      if (!f || typeof f !== 'object') continue;
      const level = Number(f.level);
      if (!LEVELS.includes(level)) continue;
      const priority = LEVELS.includes(Number(f.priority)) ? Number(f.priority) : level;
      const item = Object.assign({}, f, { level, sede: sedeDi(f.sede), priority, decision: f.decision === true });
      if (item.sede === 'e') {
        groups.push({ tipo: 'esterno', priority, decision: item.decision, findings: [item] });
      } else if (item.decision) {
        groups.push({ tipo: 'decisione', priority, decision: true, findings: [item] });
      } else {
        if (!rimasti) rimasti = { tipo: 'rimasti', priority, decision: false, findings: [] };
        rimasti.findings.push(item);
        rimasti.priority = Math.max(rimasti.priority, priority);
      }
    }
    if (rimasti) groups.push(rimasti);
    return groups;
  }

  /** «[2i]», «[1v?]»: livello e sede di un rilievo, senza testo. PURA. */
  function findingTag(f) {
    return `[${Number(f && f.level) || 0}${sedeDi(f && f.sede)}${f && f.decision ? '?' : ''}]`;
  }

  /**
   * Cosa contiene un gruppo, in poche parole: la stessa etichetta nella nota
   * del server, nelle risposte delle routine e nella verifica locale. PURA.
   */
  function groupLabel(g) {
    const findings = g && Array.isArray(g.findings) ? g.findings : [];
    if (g && g.tipo === 'esterno') return g.decision ? 'esterno, da decidere' : 'esterno';
    if (g && g.tipo === 'decisione') return `${findings[0] && sedeDi(findings[0].sede) === 'v' ? 'vicino' : 'interno'}, da decidere`;
    const n = findings.length;
    return `rimasti del giro: ${n} ${n === 1 ? 'rilievo' : 'rilievi'} (${findings.map(findingTag).join(', ')})`;
  }

  // ── Testi ─────────────────────────────────────────────────────────────────

  /** Un rilievo come riga di elenco: «- [2i] testo», «- [1v] testo», «- [1e?] testo». PURA. */
  function formatFinding(f) {
    const text = String((f && f.text) || '').replace(/\n/g, '\n  ');
    return `- ${findingTag(f)} ${text}`;
  }

  function formatFindings(findings) {
    return normalizeFindings(findings).map(formatFinding).join('\n');
  }

  function hasDecision(findings) {
    return normalizeFindings(findings).some((f) => f.decision);
  }

  // La nota per la chat del feedback: zero rilievi = superata; altrimenti l'elenco, e cosa
  // ne è stato fatto.
  function roundNote({ summary, findings, decision } = {}) {
    const list = normalizeFindings(findings);
    const s = String(summary || '').trim();
    if (!list.length) return s ? `Verifica superata. ${s}` : 'Verifica superata.';
    const d = decision || {};
    const parts = [`Verifica: ${list.length} ${list.length === 1 ? 'rilievo' : 'rilievi'}.`];
    if (s) parts.push(s);
    const esterni = Array.isArray(d.external) ? d.external.length : 0;
    if (esterni) {
      parts.push(`${esterni === 1 ? 'Un rilievo è esterno (non tocca a questo lavoro): diventa' : `${esterni} rilievi sono esterni (non toccano a questo lavoro): diventano`} feedback a parte, con priorità uguale al livello.`);
    }
    // I 2 interni messi da parte: il bilancio dei 2 è finito, e a differenza
    // dei 3 non fermano il lavoro. Un vicino di livello scritto 2 non è il caso.
    const dueDaParte = Array.isArray(d.derived) ? d.derived.filter((f) => f && Number(f.level) === 2 && sedeDi(f.sede) === 'i').length : 0;
    if (d.stop) {
      parts.push('Il lavoro si ferma: c\'è un rilievo interno di livello 3 che non si può correggere da soli (bilancio esaurito), o un rilievo interno di livello 3 o 2 che chiede una tua decisione.');
      const sospesi = Array.isArray(d.sospesi) ? d.sospesi.length : 0;
      if (sospesi) parts.push(`${sospesi === 1 ? 'Un altro rilievo interno resta' : `Altri ${sospesi} rilievi interni restano`} davanti a chi riprende dopo la tua risposta.`);
    } else if (Array.isArray(d.fix) && d.fix.length) {
      parts.push(`La correzione riguarda ${d.fix.length === list.length ? 'tutti i rilievi' : `${d.fix.length} su ${list.length}`}; poi un'altra verifica ricontrolla.`);
      const vicini = d.fix.filter((f) => f && sedeDi(f.sede) === 'v').length;
      if (vicini) parts.push(`${vicini === 1 ? 'Un rilievo è vicino (di un altro lavoro, ma in un file che il ramo modifica già): si corregge' : `${vicini} rilievi sono vicini (di un altro lavoro, ma in file che il ramo modifica già): si correggono`} insieme al resto.`);
    } else {
      parts.push(esterni === list.length
        ? 'Nessun rilievo interno: il lavoro prosegue.'
        : 'Nessun rilievo interno da correggere adesso: il lavoro prosegue e i rilievi messi da parte vanno in feedback derivati.');
    }
    const gruppi = derivedGroups({ derived: d.stop ? [] : d.derived });
    const domande = gruppi.filter((g) => g.tipo === 'decisione').length;
    if (domande) {
      parts.push(`${domande === 1 ? 'Un rilievo chiede una tua decisione senza fermare il lavoro: esce in un feedback a parte' : `${domande} rilievi chiedono una tua decisione senza fermare il lavoro: escono ciascuno in un feedback a parte`}, con priorità uguale al livello.`);
    }
    const rimasti = gruppi.find((g) => g.tipo === 'rimasti');
    if (rimasti) {
      const n = rimasti.findings.length;
      const voci = rimasti.findings.map((f) => `${findingTag(f)} ${primaFrase(f.text, 80)}`).join('; ');
      parts.push(n === 1
        ? `Il rilievo non corretto in questo giro esce in un feedback derivato, a priorità ${rimasti.priority}: ${voci}`
        : `I ${n} rilievi non corretti in questo giro escono insieme in un solo feedback derivato, a priorità ${rimasti.priority} (il livello più alto fra loro): ${voci}`);
    }
    if (dueDaParte) {
      parts.push(`Il bilancio delle correzioni di livello 2 è finito: ${dueDaParte === 1 ? 'il rilievo interno di livello 2 rimasto non ferma il lavoro ed entra' : `i ${dueDaParte} rilievi interni di livello 2 rimasti non fermano il lavoro ed entrano`} nel feedback dei rimasti.`);
    }
    parts.push(formatFindings(list));
    return parts.join('\n');
  }

  // ── Il correttore e il riallineamento (SPEC-RIDISEGNO-LAVORO.md §3, regole 3 e 4) ──
  // Ogni lavoro aggiunge una riga a questi file: un conflitto lì è meccanico e
  // non chiede un giro nuovo di verifica, uno in un file di codice sì.
  const FILE_DI_SERVIZIO = ['src/shared/patchNotes.js', 'src/shared/capabilities.js', 'tests/rossi-noti.json', 'PATTERNS.md'];

  // Perché il correttore è stato chiamato, e cosa scrive dopo i due punti.
  const MOTIVI_CORRETTORE = { conflitto: 'file', 'prove-rosse': 'prove', ripresa: 'niente', altro: 'testo' };
  const ALIAS_MOTIVO = { conflitti: 'conflitto', prove: 'prove-rosse', rosse: 'prove-rosse' };
  const MAX_VOCI_MOTIVO = 500;
  const MAX_TESTO_MOTIVO = 1000;
  const FORMA_MOTIVO = 'Scrivilo così: --motivo "conflitto: <file in conflitto, separati da virgole>" (o "conflitto: nessuno" '
    + 'se il riallineamento non ne ha trovati), "prove rosse: <prove>", "ripresa", oppure "altro: <cosa è successo>".';

  /**
   * `--motivo` del correttore → { ok: true, motivo: { tipo, file? | prove? | testo? } } o { ok: false, errore } con la
   * forma giusta: senza motivo il biglietto non si chiude (regola 4).
   */
  function leggiMotivoCorrettore(raw) {
    const t = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    if (!t) return { ok: false, errore: `Manca il motivo della correzione. ${FORMA_MOTIVO}` };
    const i = t.indexOf(':');
    const testa = (i < 0 ? t : t.slice(0, i)).toLowerCase().trim().replace(/[\s_]+/g, '-');
    const proprio = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const tipo = proprio(MOTIVI_CORRETTORE, testa) ? testa : proprio(ALIAS_MOTIVO, testa) ? ALIAS_MOTIVO[testa] : '';
    if (!tipo) return { ok: false, errore: `Motivo non capito: "${testa.slice(0, 40)}". ${FORMA_MOTIVO}` };
    const resto = i < 0 ? '' : t.slice(i + 1).trim();
    const elenco = (campo, voci) => {
      if (!voci.length) return { ok: false, errore: `Il motivo «${tipo}» vuole l'elenco dopo i due punti. ${FORMA_MOTIVO}` };
      if (voci.length > MAX_VOCI_MOTIVO) return { ok: false, errore: `${voci.length} voci nel motivo, il massimo è ${MAX_VOCI_MOTIVO}.` };
      const lunga = voci.find((s) => s.length > 300);
      if (lunga) return { ok: false, errore: `Una voce del motivo supera i 300 caratteri: "${lunga.slice(0, 40)}…".` };
      return { ok: true, motivo: { tipo, [campo]: voci } };
    };
    const pezzi = (sep) => resto.split(sep).map((s) => s.trim()).filter(Boolean);
    if (MOTIVI_CORRETTORE[tipo] === 'file') {
      return /^nessuno$/i.test(resto) ? { ok: true, motivo: { tipo, file: [] } } : elenco('file', pezzi(/[,\s]+/));
    }
    if (MOTIVI_CORRETTORE[tipo] === 'prove') return elenco('prove', pezzi(/\s*,\s*/));
    if (resto.length > MAX_TESTO_MOTIVO) return { ok: false, errore: `Il motivo è lungo ${resto.length} caratteri, il massimo è ${MAX_TESTO_MOTIVO}.` };
    if (MOTIVI_CORRETTORE[tipo] === 'testo' && !resto) return { ok: false, errore: `«altro» vuole due parole su cosa è successo. ${FORMA_MOTIVO}` };
    return { ok: true, motivo: resto ? { tipo, testo: resto } : { tipo } };
  }

  /** Il motivo come riga, nella stessa forma che `leggiMotivoCorrettore` accetta. */
  function testoMotivo(m) {
    if (!m || !m.tipo) return '';
    const nome = m.tipo === 'prove-rosse' ? 'prove rosse' : m.tipo;
    if (Array.isArray(m.file)) return `${nome}: ${m.file.length ? m.file.join(', ') : 'nessuno'}`;
    if (Array.isArray(m.prove)) return `${nome}: ${m.prove.join(', ')}`;
    return m.testo ? `${nome}: ${m.testo}` : nome;
  }

  /**
   * Dopo un riallineamento, dai file in cui la modifica del ramo è cambiata e da quelli che erano in conflitto con main:
   * tutti di servizio (o nessuno) → niente giro nuovo, bastano le prove del server; uno di codice → verifica intera,
   * c'è logica che nessuno ha guardato. Un elenco che manca vale come codice: nel dubbio si verifica.
   */
  function giroDopoRiallineamento(fileRiscritti, opz) {
    const conflitti = opz && opz.conflitti !== undefined ? opz.conflitti : [];
    if (!Array.isArray(fileRiscritti) || !Array.isArray(conflitti)) return { giro: 'pieno', codice: null };
    const codice = [...new Set([...fileRiscritti, ...conflitti].map((f) => String(f || '').replace(/\\/g, '/').replace(/^\.\//, '')))]
      .filter((f) => f && !FILE_DI_SERVIZIO.includes(f)).sort();
    return { giro: codice.length ? 'pieno' : 'nessuno', codice };
  }

  global.SN_VERIFIER_ROUND = {
    LEVELS, SEDI, SPIEGAZIONE_SEDE, MAX_FINDINGS, MAX_FINDING_TEXT, CAP_KEYS, CAP_MIN, CAP_MAX,
    capKeyOf, countKeyOf, normalizeCritique, parseFindings, unparsedLevelLines, normalizeFindings, maxLevel, primaFrase,
    sedeDi, effectiveLevel, missingCaps, normalizeCaps, normalizeCounts, decideRound, derivedGroups, groupLabel,
    findingTag, formatFinding, formatFindings, hasDecision, roundNote, domandeMancanti, titoloDelDerivato,
    FILE_DI_SERVIZIO, MOTIVI_CORRETTORE, FORMA_MOTIVO, leggiMotivoCorrettore, testoMotivo, giroDopoRiallineamento,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
