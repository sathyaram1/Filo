// Il giro di verifica — la parte PURA (feedback #561, deciso con l'owner il
// 2026-09-04/05).
//
// COSA C'È QUI
//   Le regole con cui un giro di verifica decide cosa succede ai rilievi:
//   quali si correggono subito (e da quale bilancio si paga il giro), quali
//   finiscono nel feedback derivato, e quando il lavoro si ferma e passa
//   all'owner. Più il formato con cui il verificatore scrive la critica
//   (`[livello] testo`, una riga per rilievo) e il suo parser.
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
  // segnalazione, o l'ha creato il ramo), `e` esterno (un altro lavoro). Il
  // giro conta solo gli interni; ogni esterno esce subito in un feedback suo
  // con priorità uguale al livello.
  const SEDI = ['i', 'e'];
  const SPIEGAZIONE_SEDE = 'manca la sede dopo il livello: «i» se tocca a questo lavoro, «e» se è un altro lavoro (per esempio [2i], [1e?])';

  // Tetto ai rilievi di una critica: oltre non è una critica, è un elenco
  // generato. E tetto al testo di ciascuno: finiscono nel feedback derivato.
  const MAX_FINDINGS = 40;
  // Il tetto di un singolo rilievo è lo stesso della critica intera (12000):
  // un rilievo con i suoi passi sta comunque dentro la critica, che oltre il
  // tetto viene RESPINTA col numero, non tagliata. A 2000 i passi in coda
  // sparivano in silenzio (verifica del giro 11 su #561; CLAUDE.md § Limiti).
  const MAX_FINDING_TEXT = 12000;

  /**
   * A quale bilancio appartiene un livello. I livelli 3 e 2 condividono lo
   * stesso bilancio (x): entrambi sono "la cosa chiesta non si ottiene", e la
   * differenza fra loro conta per la priorità, non per quante correzioni si
   * pagano. PURA.
   */
  function capKeyOf(level) {
    const n = Number(level);
    if (n >= 2) return 'cap2';
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
  // Il grassetto di Markdown si scrive con gli asterischi O con gli
  // underscore: guardando solo gli asterischi, «__tre] …» passava muta e la
  // bocciatura finiva nel riassunto (feedback #565).
  const GRASSETTO = '(?:\\*{1,3}|_{1,3})?';
  // Il segno «?» si accetta anche PRIMA della lettera («[1?i]»): il significato
  // è lo stesso e respingerlo costerebbe un giro per un ordine di due caratteri.
  const FINDING_LINE = new RegExp(`^\\s*${PREFISSO_ELENCO}${GRASSETTO}\\[\\s*([0-3])\\s*(?:(\\?)\\s*)?([ieIE])\\s*(\\?)?\\s*\\]${GRASSETTO}\\s*(.*)$`);
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
  // Un livello scritto in una parentesi qualunque — tonda, graffa, doppia,
  // spaiata — o con la cifra a parole. Il lettore riconosce solo la quadra con
  // la cifra: tutto il resto finiva nel riassunto in silenzio, e una
  // bocciatura diventava una promozione (feedback #565). Qui si guarda come
  // APRE la riga, e basta che dentro ci sia una cifra o una parola che dice un
  // livello.
  const PARENTESI_QUALUNQUE = '(?:\\[{1,2}|\\(|\\{)\\s*[^\\]\\)\\}\\n]{0,20}(?:\\]{1,2}|\\)|\\})';
  const APERTURA_PARENTESI = new RegExp(`^\\s*${PREFISSO_ELENCO}${GRASSETTO}(${PARENTESI_QUALUNQUE})`);
  const DENTRO_SEMBRA_LIVELLO = /\d|zero|uno|due|tre|livello|level|priorit/i;
  // E la rete che tiene tutte le altre aperture: QUALUNQUE cosa stia davanti —
  // un trattino lungo, un «+», «1.1», «100.», «(a)», un apice inverso, un
  // pallino diverso — se subito dopo (al più sei caratteri) c'è un livello e il
  // lettore non riesce a leggere la riga come rilievo, quella riga è un rilievo
  // scritto male, non riassunto. Elencare i modi di elencare ammessi è una
  // rincorsa che si perde: ogni forma dimenticata era una bocciatura che
  // passava per promozione (feedback #565). Sei caratteri perché una frase vera
  // («Nel caso [2] ho provato…») ha più parole davanti, e resta testo.
  const LIVELLO_VICINO = new RegExp(`^.{0,6}?(${PARENTESI_QUALUNQUE})`);
  // La stessa rete per il livello scritto BENE ma con davanti qualcosa che
  // il lettore non conosce («(a) [2] …»): lì la prima parentesi non è il
  // livello, e cercarla come prima cosa la mancava.
  // FINE DELLA RINCORSA: dovunque stia nella riga. Per cinque giri di fila
  // il controllo ha guardato una finestra sempre un po' piu' larga, e ogni
  // volta bastava un'etichetta di una parola in piu' perche' un rilievo —
  // anche di sicurezza — finisse nel riassunto e la bocciatura diventasse
  // una promozione. Adesso la regola e' netta: le parentesi quadre con
  // dentro un livello sono SEMPRE un rilievo; se la riga non si legge come
  // rilievo viene respinta con la spiegazione. Il prezzo, che vale la pena:
  // nel riassunto un livello si cita senza le quadre («il livello 2»),
  // altrimenti si riscrive la riga. Rovescia una scelta del giro 4 su #561,
  // che quelle parentesi in mezzo a una frase le lasciava passare
  // (feedback #565).
  // QUALUNQUE cosa dentro le quadre che somigli a un livello, dovunque nella
  // riga: «[3 - sicurezza]», «[2, grave]», «[3.]», «[#2]», «[2%]». Inseguire una
  // forma per volta è la rincorsa che questo feedback ha perso sei volte: la
  // regola dell'owner è che le quadre col livello dentro sono sempre un
  // rilievo, e questa è quella regola scritta per intero (feedback #565).
  const QUADRA_OVUNQUE = /\[{1,2}[^\]\n]{0,200}\]{1,2}/g;
  // E, dovunque nella riga, una parentesi di QUALUNQUE forma che contenga SOLO
  // un livello: «(3)», «{2}», «[2)», «(due)». Il contenuto è stretto apposta —
  // «(3 volte)» in mezzo a una frase resta testo normale (feedback #565).
  const SOLO_UN_LIVELLO = '\\s*(?:(?:livello|level|priorit[àa]|liv|L|P)\\s*)?(?:\\d+(?:\\s*[.,\\-–/]\\s*\\d+)?|zero|uno|due|tre)\\s*[?!]*\\s*';
  /** Una quadra che contiene qualcosa che somiglia a un livello. PURA. */
  // Dentro la quadra spaiata può esserci qualunque cosa fra il livello e la
  // parentesi: guardare solo «cifra più lettere» lasciava passare «3 -
  // sicurezza]», «3, grave]», «[#3», «[tre». Due sbagli insieme — la quadra
  // dimenticata E il livello scritto in una forma sua — e la bocciatura
  // spariva nel riassunto (feedback #565). Le parole si ancorano ai confini,
  // o «altre» conterrebbe «tre».
  // E fra il livello e la parentesi ci può stare una descrizione intera, non
  // una dozzina di caratteri: «3 dati dell'utente a rischio]» è come uno
  // scrive davvero, e con la finestra corta finiva muta nel riassunto. La
  // stessa misura delle quadre appaiate (200), e non allarga niente: qui la
  // finestra non può contenere una parentesi, quindi vale solo per la quadra
  // SPAIATA — quelle appaiate le guarda già QUADRA_OVUNQUE (feedback #565).
  // Il confine si guarda alle LETTERE, non con `\b`: per la regex l'underscore
  // è un carattere di parola, quindi dopo un grassetto scritto «__tre]» il
  // confine non c'era e la riga passava muta; e la stessa cosa dopo un a capo
  // scritto a mano, dove il carattere prima è la «n» (feedback #565).
  const LIVELLO_NUDO = '(?:\\d|(?<![A-Za-zÀ-ÿ])(?:zero|uno|due|tre)(?![A-Za-zÀ-ÿ])|[?!])';
  const QUADRA_APERTA = new RegExp(`\\[{1,2}[^\\[\\]\\n]{0,200}?${LIVELLO_NUDO}`, 'i');
  const QUADRA_CHIUSA = new RegExp(`${LIVELLO_NUDO}[^\\[\\]\\n]{0,200}?\\]{1,2}`, 'i');

  // Un livello che APRE la riga e incontra una parentesi di CHIUSURA senza
  // che ne sia mai stata aperta una: «tre] …», «tre) …», «__tre] …». È la
  // parentesi dimenticata, e con una tonda al posto della quadra passava muta
  // (feedback #565). La finestra non può contenere una parentesi APERTA,
  // quindi «3 volte (ok)» in mezzo a una frase resta testo.
  const APRE_LIVELLO_SENZA_APERTURA = new RegExp(
    `^\\s*${PREFISSO_ELENCO}${GRASSETTO}(?:`
    // Quadra e graffa di chiusura: nessuno le usa per elencare, quindi valgono
    // sempre.
    + `${LIVELLO_NUDO}[^\\[\\](){}\\n]{0,200}?[\\]}]`
    // La tonda invece È un modo di elencare: «1) primo punto» è testo normale.
    // Vale solo col livello scritto a parole, o con qualcosa in mezzo.
    + `|(?:zero|uno|due|tre)(?![A-Za-zÀ-ÿ])[^\\[\\](){}\\n]{0,200}?\\)`
    + `|\\d[^\\[\\](){}\\n]{1,200}?\\)`
    + `)`, 'i');

  function quadraColLivello(riga) {
    // TUTTE le quadre della riga, non solo la prima: bastava una frase fra
    // quadre all'inizio per far sparire il livello scritto più avanti. E il
    // contenuto può essere lungo: «[3 dati dell'utente a rischio]» è come uno
    // scrive davvero (feedback #565).
    const testo = String(riga || '');
    // La quadra SPAIATA — aperta e mai chiusa, o chiusa e mai aperta — e il
    // contenuto lunghissimo: una parentesi dimenticata è lo stesso errore di
    // battitura della virgoletta che manca, e non deve costare una bocciatura
    // (feedback #565).
    if (QUADRA_APERTA.test(testo) || QUADRA_CHIUSA.test(testo)) return true;
    QUADRA_OVUNQUE.lastIndex = 0;
    for (let m = QUADRA_OVUNQUE.exec(testo); m; m = QUADRA_OVUNQUE.exec(testo)) {
      if (DENTRO_SEMBRA_LIVELLO.test(m[0])) { QUADRA_OVUNQUE.lastIndex = 0; return true; }
    }
    return false;
  }
  const PARENTESI_LIVELLO = new RegExp(`(?:\\[{1,2}|\\(|\\{)${SOLO_UN_LIVELLO}(?:\\]{1,2}|\\)|\\})`);
  // Dentro la CONTINUAZIONE di un rilievo, invece, un livello citato in mezzo
  // a una frase resta testo («Passi: critica con [2] - poi start», verifica
  // del giro 6): lì il danno è minore — il rilievo sopra è comunque
  // registrato e la bocciatura non si perde — quindi vale la finestra.
  const QUADRA_VICINA = new RegExp(`^.{0,14}?(${LEVEL_TOKEN_SRC})`);
  // «Difetto: [2] …», «rilievo grave [2] …»: l'etichetta sta PRIMA del livello,
  // col separatore o senza. Il controllo guardava solo la forma opposta
  // («Rilievo [2]: …»), e questa passava per riassunto (feedback #565).
  const ETICHETTA_PRIMA = new RegExp(`^\\s*${PREFISSO_ELENCO}[^\\[\\]]{1,20}?[:\\-–—]\\s*${LEVEL_TOKEN_SRC}`);
  // L'etichetta breve col separatore («Rilievo [2]: …») vale solo nel
  // riassunto: dentro la continuazione di un rilievo («Passi: critica con
  // [2] - poi start») è testo, e respingerla mandava a riscrivere una riga
  // giusta (verifica del giro 6).
  const LEVEL_LABEL = new RegExp(`^\\s*${PREFISSO_ELENCO}${GRASSETTO}[^\\[\\]]{1,30}?\\s*${LEVEL_TOKEN_SRC}\\s*[:\\-–—]`);

  // Un a capo scritto coi due caratteri barra e n: è come esce il comando
  // d'esempio («<riassunto>\n[livello] …») copiato dentro virgolette doppie, in
  // bash come in PowerShell. Se davanti a una parentesi quadra c'è quella
  // coppia, chi scrive la usava come a capo, e vale come a capo in tutto il
  // testo; in mezzo a una frase, senza una parentesi dopo, resta testo. Senza
  // questo un «[2]» dopo una barra-n finiva nel riassunto e il lavoro passava
  // in silenzio, in tutti e tre i posti (porta chiusa al giro 3 su #561 e
  // riaperta al giro 5).
  // Gli stessi modi di elencare del lettore, non cinque su nove: con un titolo
  // Markdown o una citazione dopo la barra-n l'a capo non veniva riconosciuto,
  // la riga non diventava mai una riga e il rilievo finiva nel riassunto —
  // un'altra bocciatura letta come promozione (feedback #565).
  // E la parentesi di apertura può mancare: «\ntre] i dati in chiaro». Chiesta
  // una parentesi per forza, quell'a capo non veniva riconosciuto, la riga non
  // diventava mai una riga e finiva nel riassunto — bocciatura letta come
  // promozione, con tre sbagli insieme ma sempre lo stesso esito (#565).
  // Qui il confine a sinistra ce l'ha già il pattern (l'a capo e il punto
  // elenco), e guardarlo di nuovo lo romperebbe: l'a capo scritto a mano
  // finisce per «n», che è una lettera, e la riga tornava muta (#565).
  const LIVELLO_DOPO_CONFINE = '(?:\\d|(?:zero|uno|due|tre)(?![A-Za-zÀ-ÿ])|[?!])';
  const DOPO_A_CAPO = `(?:[\\[({]|${LIVELLO_DOPO_CONFINE}[^\\[\\]\\n]{0,200}?[\\]})])`;
  const ESCAPED_BREAK_BEFORE_BRACKET = new RegExp(`(?:\\\\r)?\\\\n\\s*${PREFISSO_ELENCO}${GRASSETTO}${DOPO_A_CAPO}`, 'i');

  /** La critica con gli a capo veri: `\r\n` → `\n`, e la barra-n letterale usata come a capo. PURA. */
  function normalizeCritique(text) {
    const s = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    return ESCAPED_BREAK_BEFORE_BRACKET.test(s) ? s.replace(/(?:\\r)?\\n/g, '\n') : s;
  }

  /**
   * Le righe della critica che NON si possono registrare così come sono. PURA.
   *
   *   - un livello fuori posto o fuori scala («Rilievo [2]: …», «[4] …»,
   *     «[2-3] …»): senza questo controllo finivano nel riassunto, e un lavoro
   *     con un [2] scritto così passava in silenzio (verifiche dei giri 2 e 3
   *     su #561);
   *   - un livello SENZA testo (una riga «[2]» e basta, senza continuazione):
   *     il lettore lo scartava e il rilievo spariva — un [2] diventava un pass
   *     (verifica del giro 4);
   *   - più rilievi del tetto: il quarantunesimo veniva tagliato senza dirlo.
   *
   * Chi registra la critica le rifiuta chiedendo il formato giusto.
   */
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
      // La regola, senza finestre e senza eccezioni (decisione dell'owner del
      // 2026-09-07 su #565): le QUADRE con dentro un livello sono sempre un
      // rilievo, dovunque stiano nella riga e anche dentro la continuazione di
      // un altro rilievo. Le altre parentesi valgono all'inizio della riga, che
      // è dove uno le userebbe per aprire un rilievo: in mezzo a una frase
      // «(3 volte)» è testo normale.
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
      const sede = String(f.sede == null ? '' : f.sede).trim().toLowerCase() === 'e' ? 'e' : 'i';
      out.push({ level, sede, text, decision: f.decision === true });
      if (out.length >= MAX_FINDINGS) break;
    }
    return out;
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
  // Tre bilanci per feedback (spec §4): x giri per i livelli 3 e 2, y per gli 1,
  // z per gli 0. I numeri li detta SOLO l'owner dalla dashboard
  // (config/routines): nel codice non c'è un default (decisione del
  // 2026-09-16), e un bilancio mancante non vale 0 né altro — decideRound si
  // ferma con un errore che dice quale manca. Il tetto alto è lo stesso della
  // dashboard.
  const CAP_MIN = 0;
  const CAP_MAX = 10;
  const CAP_KEYS = ['cap2', 'cap1', 'cap0'];

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
   *   - un rilievo di livello 3/2 si corregge se il SUO bilancio ha ancora
   *     giri; a bilancio finito ferma il lavoro;
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
   *   - senza uno dei tre bilanci LANCIA (`bilanci del verificatore
   *     mancanti: …`): un numero inventato al posto di quello dell'owner è
   *     peggio di un errore (decisione del 2026-09-16).
   *
   * Contano SOLO i rilievi interni (sede `i`). Gli esterni non entrano in
   * nessuna delle regole sopra: tornano a parte in `external`, ciascuno con
   * `priority` uguale al livello, in ogni esito (anche a lavoro fermo: sono
   * di un altro lavoro, ed escono in un feedback loro). Un esterno col `?`
   * non ferma niente: la domanda viaggia nel suo feedback. Anche i rilievi
   * interni messi da parte (`derived`) portano `priority` = livello.
   *
   * @param {object} p { findings, caps:{cap2,cap1,cap0}, counts:{count2,count1,count0} }
   * @returns {{
   *   stop: boolean, blocking: object[], fix: object[], derived: object[], external: object[],
   *   consume: 'cap2'|'cap1'|'cap0'|null, counts: object,
   *   budgets: { cap2:{cap,used,left}, cap1:…, cap0:… }
   * }}
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
    const ones = [];
    const zeros = [];
    for (const f of findings) {
      if (f.level >= 2) {
        if (f.decision || left('cap2') <= 0) blocking.push(f);
        else fixable.push(f);
      } else if (f.level === 1) {
        ones.push(f);
      } else {
        zeros.push(f);
      }
    }
    // Gli 1: con un 3/2 da correggere nello stesso giro si correggono pure
    // loro (il giro lo paga il 3/2); da soli seguono il loro bilancio.
    const withHigher = fixable.length > 0;
    for (const f of ones) {
      if (f.decision) derived.push(f);
      else if (withHigher || left('cap1') > 0) fixable.push(f);
      else derived.push(f);
    }
    // Gli 0: con qualcos'altro da correggere si correggono pure loro; da soli
    // solo se il loro bilancio lo permette (z = 0 per default).
    for (const f of zeros) {
      if (f.decision) derived.push(f);
      else if (fixable.length || left('cap0') > 0) fixable.push(f);
      else derived.push(f);
    }

    const budgets = {};
    for (const k of CAP_KEYS) budgets[k] = { cap: caps[k], used: counts[k.replace('cap', 'count')], left: Math.max(0, left(k)) };

    if (blocking.length) {
      return { stop: true, blocking, fix: [], derived: [], external, consume: null, counts: Object.assign({}, counts), budgets };
    }

    // Ordine stabile: come nella critica. Il bilancio si paga dal livello più
    // alto corretto.
    const fix = findings.filter((f) => fixable.includes(f));
    const rest = findings.filter((f) => derived.includes(f)).map(conPriorita);
    let consume = null;
    if (fix.length) {
      consume = capKeyOf(maxLevel(fix));
      counts[consume.replace('cap', 'count')] += 1;
      budgets[consume].used += 1;
      budgets[consume].left = Math.max(0, budgets[consume].left - 1);
    }
    return { stop: false, blocking: [], fix, derived: rest, external, consume, counts, budgets };
  }

  // ── Testi ─────────────────────────────────────────────────────────────────

  /** Un rilievo come riga di elenco: «- [2i] testo», «- [1e?] testo». PURA. */
  function formatFinding(f) {
    const mark = f && f.decision ? '?' : '';
    const sede = f && String(f.sede || '').toLowerCase() === 'e' ? 'e' : 'i';
    const text = String((f && f.text) || '').replace(/\n/g, '\n  ');
    return `- [${Number(f && f.level) || 0}${sede}${mark}] ${text}`;
  }

  /** L'elenco puntato dei rilievi, col livello davanti. PURA. */
  function formatFindings(findings) {
    return normalizeFindings(findings).map(formatFinding).join('\n');
  }

  /** Almeno un rilievo chiede una decisione dell'owner? PURA. */
  function hasDecision(findings) {
    return normalizeFindings(findings).some((f) => f.decision);
  }

  /**
   * La nota per la chat del feedback con l'esito della verifica. PURA.
   * Zero rilievi = superata; altrimenti l'elenco, e cosa ne è stato fatto.
   */
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
    if (d.stop) {
      parts.push('Il lavoro si ferma: c\'è un rilievo interno di livello 2 o 3 che non si può correggere da soli (bilancio esaurito, o chiede una tua decisione).');
    } else if (Array.isArray(d.fix) && d.fix.length) {
      parts.push(`La correzione riguarda ${d.fix.length === list.length ? 'tutti i rilievi' : `${d.fix.length} su ${list.length}`}; poi un'altra verifica ricontrolla.`);
    } else {
      parts.push(esterni === list.length
        ? 'Nessun rilievo interno: il lavoro prosegue.'
        : 'Nessun rilievo interno da correggere adesso: il lavoro prosegue e i rilievi messi da parte vanno in feedback derivati.');
    }
    parts.push(formatFindings(list));
    return parts.join('\n');
  }

  global.SN_VERIFIER_ROUND = {
    LEVELS, SEDI, SPIEGAZIONE_SEDE, MAX_FINDINGS, MAX_FINDING_TEXT, CAP_KEYS, CAP_MIN, CAP_MAX,
    capKeyOf, countKeyOf, normalizeCritique, parseFindings, unparsedLevelLines, normalizeFindings, maxLevel, primaFrase,
    missingCaps, normalizeCaps, normalizeCounts, decideRound,
    formatFinding, formatFindings, hasDecision, roundNote,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
