// Il giro di verifica, la parte PURA (#561). Il server la incorpora al deploy (bake-shared di filo-security): un
// cambio qui arriva su main solo insieme a un lavoro server che ne porta il generato.
//
// COSA C'È QUI
//   Le regole con cui un giro di verifica decide cosa succede ai rilievi:
//   quali si correggono subito (e da quale bilancio si paga il giro), quali
//   finiscono nel feedback derivato, e quando il lavoro si ferma e passa
//   all'owner. Più il formato con cui il verificatore scrive la critica
//   (`[livello+sede] testo`: `[2i]`, `[1i?]`, `[2i?!]`, e `[e]` senza livello
//   per un esterno, una riga per rilievo) e il suo parser. Decidono gli
//   interni, gli esterni escono a parte.
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

  // La scala a tre livelli (decisione dell'owner dell'08/11/2026, #2339): il livello misura il lavoro rispetto al suo
  // obiettivo. La scala intera sta in routines/roles/_livelli-e-sede.md.
  const LEVELS = [1, 2, 3];
  // La SEDE: `i` se il difetto riguarda l'obiettivo del feedback o l'ha introdotto il ramo, e solo lui prende un
  // livello; `e` tutto il resto, che esce in un feedback nuovo senza livello, classificato dopo come ogni altro.
  const SEDI = ['i', 'e'];
  // La 2 è la rosa del giorno e la mette solo il manutentore (SPEC-MANUTENTORE § 2): un rilievo di livello 2 messo
  // da parte nasce a 1. Il livello resta quello scritto; cambia solo la priorità del feedback che nasce.
  const prioritaDiNascita = (level) => (Number(level) === 2 ? 1 : Number(level));
  // La scala delle priorità dei feedback (0-3) non è quella dei livelli dei rilievi.
  const PRIORITA = [0, 1, 2, 3];
  const SPIEGAZIONE_SEDE = 'manca la sede dopo il livello: «i» se il difetto riguarda l\'obiettivo del feedback o l\'ha introdotto il ramo (per esempio [2i], [1i?]); tutto il resto è esterno e si scrive [e], senza livello';
  // La scala vecchia (livello 0, sede «vicino», livello su un esterno) si respinge dicendo cosa è cambiato: scritta
  // durante il passaggio non deve perdersi in silenzio.
  const SPIEGAZIONE_ZERO = 'il livello 0 non c\'è più (scala a tre livelli dall\'08/11/2026): un caso molto raro, un miglioramento incerto o un problema raro o molto meno grave dell\'originale sono un 1 ([1i]); un difetto che non riguarda l\'obiettivo e che il ramo non ha introdotto è esterno, [e], senza livello';
  const SPIEGAZIONE_VICINO = 'la sede «vicino» non c\'è più (dall\'08/11/2026): un difetto che non riguarda l\'obiettivo del feedback e che il ramo non ha introdotto è esterno anche se sta in un file che il ramo modifica, e non prende livello: [e] testo';
  const SPIEGAZIONE_ESTERNO = 'un rilievo esterno non prende livello (dall\'08/11/2026): diventa un feedback nuovo, classificato dopo come gli altri. Scrivi [e] testo, o [e?] se chiede una decisione';
  const SPIEGAZIONE_INTERNO = 'un rilievo interno prende un livello fra 1 e 3: [3i], [2i], [1i]';

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
    return 'cap1';
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
  //   [e] Preferenze aperta in due schede cancella le modifiche (c'era già su main)
  //
  // Il `?` dopo la sede segna «chiede una decisione dell'owner» (un
  // trade-off vero, una scelta di prodotto); il `!` dopo il `?` (`[2i?!]`) dice
  // che quella scelta è difficile da disfare (dati degli utenti, sicurezza,
  // formati salvati su disco): è il segno da cui il server decide se fermare,
  // mai dal testo (#1202). Un `!` senza `?` non è una scelta, e si respinge.
  // La sede è OBBLIGATORIA: un
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
  // Il segno «?» si accetta anche PRIMA della lettera («[1?i]»), e il «!» prima
  // del «?» («[2i!?]»): il significato è lo stesso e respingerlo costerebbe un
  // giro per un ordine di due caratteri.
  // Il livello è facoltativo nella forma, perché l'esterno non lo porta: le combinazioni sbagliate (0, «v», un
  // esterno col livello, un interno senza) si leggono qui per respingerle col perché (motivoDelRifiuto).
  const FINDING_LINE = new RegExp(`^\\s*${PREFISSO_ELENCO}${GRASSETTO}\\[\\s*([0-3])?\\s*(?:(\\?)\\s*)?([ievIEV])\\s*(\\?\\s*!|!\\s*\\?|\\?|!)?\\s*\\]${GRASSETTO}\\s*(.*)$`);
  // La forma VECCHIA, col solo livello: si riconosce per respingerla con la
  // spiegazione giusta, non per leggerla.
  const FINDING_LINE_SENZA_SEDE = new RegExp(`^\\s*${PREFISSO_ELENCO}${GRASSETTO}\\[\\s*([0-3])\\s*(\\?)?\\s*\\]${GRASSETTO}\\s*(.*)$`);
  const SPIEGAZIONE_SEGNO = 'il segno «!» (scelta difficile da disfare) va con il «?» della decisione: [2i?!]';
  // Una sede nuda fra quadre in mezzo a una riga («… [e] …») è un secondo rilievo senza a capo, non testo; attaccata a un
  // nome o a una chiusa («righe[i]», «f(x)[e]») è l'indice di una citazione di codice.
  const QUADRA_SEDE = /(?<![\w\])À-ÿ])\[{1,2}\s*(?:\?\s*)?[ievIEV]\s*[?!]*\s*\]{1,2}/;

  /** I gruppi di FINDING_LINE come rilievo: livello (null se non c'è), sede minuscola, segni «?» e «!», testo. PURA. */
  function rilievoDa(m) {
    const dopo = String(m[4] || '');
    const f = { level: m[1] == null ? null : Number(m[1]), sede: String(m[3]).toLowerCase(), text: m[5].trim(), decision: m[2] === '?' || dopo.includes('?') };
    if (dopo.includes('!')) f.irreversibile = true;
    return f;
  }

  /** Perché una riga di FINDING_LINE non si legge come rilievo, '' se si legge. PURA. */
  function motivoDelRifiuto(m) {
    const f = rilievoDa(m);
    if (f.level === 0) return SPIEGAZIONE_ZERO;
    if (f.sede === 'v') return SPIEGAZIONE_VICINO;
    if (f.sede === 'e' && f.level !== null) return SPIEGAZIONE_ESTERNO;
    if (f.sede === 'i' && f.level === null) return SPIEGAZIONE_INTERNO;
    if (f.irreversibile === true && !f.decision) return SPIEGAZIONE_SEGNO;
    return '';
  }

  /** Il motivo per la forma senza sede: lo 0 dice prima che il livello non c'è più. PURA. */
  function motivoSenzaSede(raw) {
    const m = FINDING_LINE_SENZA_SEDE.exec(raw);
    return m && Number(m[1]) === 0 ? SPIEGAZIONE_ZERO : SPIEGAZIONE_SEDE;
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
  // Nelle tonde e graffe la cifra conta come in SOLO_UN_LIVELLO, anche in testa alla riga: «(2865)»,
  // «(10)», «(1.000)» sono numeri, «(2)», «(2.5)», «(2-3)» livelli (#2179).
  const DENTRO_TONDA_SEMBRA_LIVELLO = /(?<![\d.,])\d(?:[.,]\d)?(?![\d.,]*\d)|zero|uno|due|tre|livello|level|priorit/i;
  function aperturaSembraLivello(p) {
    return (p.startsWith('[') ? DENTRO_SEMBRA_LIVELLO : DENTRO_TONDA_SEMBRA_LIVELLO).test(p);
  }
  // La rete per tutte le altre aperture: se entro sei caratteri c'è un livello e il lettore
  // non legge la riga come rilievo, è un rilievo scritto male. Una frase vera ha più parole.
  const LIVELLO_VICINO = new RegExp(`^.{0,6}?(${PARENTESI_QUALUNQUE})`);
  // Regola dell'owner (#565): una QUADRA con dentro un livello è SEMPRE un rilievo, dovunque
  // stia. Se la riga non si legge come rilievo, viene respinta con la spiegazione.
  const QUADRA_OVUNQUE = /\[{1,2}[^\]\n]{0,200}\]{1,2}/g;
  // E, dovunque nella riga, una parentesi di QUALUNQUE forma che contenga SOLO un livello:
  // «(3)», «{2}», «[2)», «(due)». Il contenuto è stretto apposta: «(3 volte)» resta testo, e
  // la cifra è UNA: «(2865)» è un numero di feedback o un conteggio, non un livello (#2179).
  const SOLO_UN_LIVELLO = '\\s*(?:(?:livello|level|priorit[àa]|liv|L|P)\\s*)?(?:\\d(?:\\s*[.,\\-–/]\\s*\\d)?|zero|uno|due|tre)\\s*[?!]*\\s*';
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
    // La cifra è UNA: «10) decimo punto» è un elenco lungo, non un livello (#2179).
    + `|\\d(?!\\d)[^\\[\\](){}\\n]{1,200}?\\)`
    + `)`, 'i');

  // Ridà il PEZZO letto come livello (vuoto se non c'è): il rifiuto lo mostra a chi scrive.
  function quadraColLivello(riga) {
    // TUTTE le quadre della riga, non solo la prima: una frase fra quadre all'inizio nascondeva
    // il livello scritto più avanti. E il contenuto può essere lungo.
    const testo = String(riga || '');
    // Prima la quadra intera: è il pezzo da mostrare, la spaiata ne darebbe solo l'inizio.
    QUADRA_OVUNQUE.lastIndex = 0;
    for (let m = QUADRA_OVUNQUE.exec(testo); m; m = QUADRA_OVUNQUE.exec(testo)) {
      if (DENTRO_SEMBRA_LIVELLO.test(m[0])) { QUADRA_OVUNQUE.lastIndex = 0; return m[0]; }
    }
    const sede = QUADRA_SEDE.exec(testo);
    if (sede) return sede[0];
    // La quadra SPAIATA col contenuto lunghissimo: una parentesi dimenticata è lo stesso errore
    // di battitura della virgoletta che manca, e non deve costare una bocciatura.
    const spaiata = QUADRA_APERTA.exec(testo) || QUADRA_CHIUSA.exec(testo);
    return spaiata ? spaiata[0] : '';
  }

  function pezzo(re, riga) {
    const m = re.exec(riga);
    return m ? m[0].trim() : '';
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
  // `pezzo` è la parte della riga letta come livello, quando la ragione è quella (#2179).
  function righeStorte(text) {
    const lines = normalizeCritique(text).split('\n');
    const out = [];
    let current = null;
    let count = 0;
    const flush = () => {
      if (current && !current.text) out.push({ riga: `${current.line} (rilievo senza testo)`, pezzo: '' });
      current = null;
    };
    for (const raw of lines) {
      const m = FINDING_LINE.exec(raw);
      if (m) {
        // Due livelli sulla STESSA riga: il secondo finiva dentro al testo del
        // primo, e un difetto di sicurezza spariva in coda a uno cosmetico.
        // Basta un a capo dimenticato, che è lo stesso errore della virgoletta
        // che manca (feedback #565).
        const doppio = quadraColLivello(m[5]);
        if (doppio) {
          flush();
          out.push({ riga: raw.trim(), pezzo: doppio });
          continue;
        }
        const motivo = motivoDelRifiuto(m);
        if (motivo) {
          flush();
          out.push({ riga: `${raw.trim()} (${motivo})`, pezzo: '' });
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
        out.push({ riga: `${raw.trim()} (${motivoSenzaSede(raw)})`, pezzo: '' });
        continue;
      }
      // La regola per intero sta su QUADRA_OVUNQUE: le quadre col livello dentro sono sempre un
      // rilievo; le altre parentesi valgono a inizio riga, dove uno le userebbe per aprirlo.
      const apertura = APERTURA_PARENTESI.exec(raw) || LIVELLO_VICINO.exec(raw.trim());
      const letto = pezzo(LEVEL_START, raw)
        || (apertura && aperturaSembraLivello(apertura[1].trim()) ? apertura[1].trim() : '')
        || quadraColLivello(raw)
        || pezzo(APRE_LIVELLO_SENZA_APERTURA, raw)
        || pezzo(PARENTESI_LIVELLO, raw)
        || pezzo(ETICHETTA_PRIMA, raw)
        || (!current ? pezzo(LEVEL_LABEL, raw) : '');
      if (letto) {
        flush();
        out.push({ riga: raw.trim(), pezzo: letto });
        continue;
      }
      if (current && raw.trim()) current.text += raw.trim();
    }
    flush();
    if (count > MAX_FINDINGS) {
      out.push({ riga: `troppi rilievi: ${count}, il massimo è ${MAX_FINDINGS} (raggruppa per causa: un rilievo per porta, non per sintomo)`, pezzo: '' });
    }
    return out;
  }

  function unparsedLevelLines(text) {
    return righeStorte(text).map((r) => r.riga);
  }

  // Il rifiuto di una critica con righe storte, vuoto se non ce ne sono: lo stampano
  // dispatch e verify-local, e ogni riga dice quale suo pezzo è stato letto come livello.
  function testoRilieviNonRiconosciuti(text) {
    const storte = righeStorte(text);
    if (!storte.length) return '';
    const righe = storte.map((r) => (r.pezzo ? `${r.riga}\n    letto come livello: «${r.pezzo}»` : r.riga));
    return `rilievi non riconosciuti. Le parentesi quadre con dentro un livello o una sede sono SEMPRE un rilievo, dovunque stiano nella riga: nel riassunto e nei passi un livello si cita a parole («il livello 2»), mai «[2i]»; lo stesso vale per una parentesi tonda o graffa con dentro una cifra sola («(2)»). Un rilievo interno (riguarda l'obiettivo del feedback, o l'ha introdotto il ramo) apre la riga col livello fra 1 e 3 e la «i»; uno esterno con la sola «e», senza livello; poi il testo, una riga per rilievo («[2i] testo», «[1i?] testo», «[e] testo», anche «- [2i]», «1. [2i]», «### [2i]»). Righe da sistemare:\n  ${righe.join('\n  ')}`;
  }

  /**
   * Legge la critica scritta dal verificatore. PURA.
   *
   * `rifiutati` sono le righe che sembrano un rilievo ma non si leggono, con
   * la spiegazione: senza la sede («[2] …»), col «!» senza il «?», o nella
   * scala vecchia (livello 0, sede «v», esterno col livello). Non diventano
   * rilievi né riassunto, e chi registra deve respingere la critica finché ce
   * ne sono (le altre forme storte le elenca unparsedLevelLines).
   * @returns {{ summary: string, findings: Array<{level:number|null, sede:'i'|'e', text:string, decision:boolean, irreversibile?:true}>, rifiutati: string[] }}
   */
  function parseFindings(text) {
    const lines = normalizeCritique(text).split('\n');
    const summary = [];
    const findings = [];
    const rifiutati = [];
    let current = null;
    for (const raw of lines) {
      const m = FINDING_LINE.exec(raw);
      const motivo = m ? motivoDelRifiuto(m) : '';
      if (motivo) {
        rifiutati.push(`${raw.trim()} (${motivo})`);
        current = null;
        continue;
      }
      if (m) {
        current = rilievoDa(m);
        findings.push(current);
        continue;
      }
      if (FINDING_LINE_SENZA_SEDE.test(raw)) {
        rifiutati.push(`${raw.trim()} (${motivoSenzaSede(raw)})`);
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

  /** La sede canonica: `e` come scritta, e il `v` dello stato vecchio è esterno; il resto (anche l'assenza) interno. PURA. */
  function sedeDi(raw) {
    const s = String(raw == null ? '' : raw).trim().toLowerCase();
    return s === 'e' || s === 'v' ? 'e' : 'i';
  }

  /** Il livello più alto fra gli INTERNI di un elenco (null se non ce ne sono). PURA. */
  function livelloDegliInterni(list) {
    return maxLevel((Array.isArray(list) ? list : []).filter((f) => f && sedeDi(f.sede) === 'i'));
  }

  /**
   * Un rilievo interno col «?» ferma il lavoro? Un 3, o una scelta difficile da
   * disfare (`!`) a qualunque livello: gli altri 2 vanno avanti con l'opzione
   * consigliata, gli 1 vanno da parte (#1202; il `!` a ogni livello dal #2339). PURA.
   */
  function decisioneFerma(f) {
    if (!f || f.decision !== true) return false;
    return Number(f.level) >= 3 || f.irreversibile === true;
  }

  /**
   * A chi va un rilievo che ferma: la scelta difficile da disfare al manutentore, che risponde o la porta
   * all'owner; il resto all'owner (decisione dell'owner dell'08/11/2026, #2339). PURA.
   */
  function destinatarioDelFermo(f) {
    return f && f.decision === true && f.irreversibile === true ? 'manutentore' : 'owner';
  }

  /**
   * Il rifiuto di «blocca» sulla domanda di un rilievo (#1202.2), uno per lo
   * strumento delle routine e per il server: `chi` è il rilievo come lo nomina
   * chi rifiuta. PURA.
   */
  function bloccaSuUnRilievo(chi) {
    return `${chi} porta «blocca»: su un rilievo non si scrive, decidono il livello e il segno. Fermano il lavoro `
      + 'un interno [3i?] e una scelta difficile da disfare ([2i?!], a ogni livello); un [2i?] si corregge con l\'opzione che consigli e '
      + 'la domanda esce in un feedback suo; gli altri col «?» vanno da parte con la loro domanda. '
      + 'Togli «blocca» dal JSON (e, se serve, cambia il segno).';
  }

  /**
   * Un elenco di rilievi arrivato da fuori (dal client, da un file) portato
   * alla forma canonica. Scarta quello che non è un rilievo: livello fuori
   * scala in un interno, testo vuoto. Un rilievo STRUTTURATO senza sede vale
   * interno: è la forma dei client non aggiornati e dello stato già scritto,
   * dove la sede non esisteva; l'obbligo vale sul testo della critica. Lo stato
   * scritto con la scala a quattro livelli si legge così: uno 0 interno vale 1,
   * un vicino è esterno, e un esterno perde il livello (`level: null`). PURA.
   */
  function normalizeFindings(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const f of list) {
      if (!f || typeof f !== 'object') continue;
      const sede = sedeDi(f.sede);
      const scritto = f.level == null || f.level === '' ? NaN : Number(f.level);
      const level = sede === 'e' ? null : (scritto === 0 ? 1 : scritto);
      if (sede === 'i' && !LEVELS.includes(level)) continue;
      const text = String(f.text == null ? '' : f.text).trim().slice(0, MAX_FINDING_TEXT);
      if (!text) continue;
      const rilievo = { level, sede, text, decision: f.decision === true };
      // Il «!» vale solo su una scelta: senza «?» non c'è niente da disfare.
      if (rilievo.decision && f.irreversibile === true) rilievo.irreversibile = true;
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
  // Tre bilanci per feedback, uno per livello (dal #2339; prima quattro). I
  // numeri li scrivono l'owner dalla dashboard e il manutentore
  // (config/routines): nel codice non c'è un default (decisione del
  // 2026-09-16), e un bilancio mancante non vale 0 né altro — decideRound si
  // ferma con un errore che dice quale manca. Il tetto alto è lo stesso della
  // dashboard. I NOMI sono anche in feedbackTransitions.js (VERIFIER_CAP_KEYS)
  // e nei campi della dashboard: una sentinella li confronta.
  const CAP_MIN = 0;
  const CAP_MAX = 10;
  const CAP_KEYS = ['cap3', 'cap2', 'cap1'];

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
   * Il livello del bilancio con cui un rilievo di livello `level` può pagare
   * un giro: il suo, o finito quello il più alto ancora aperto sotto (X-1,
   * poi X-2…: decisione dell'owner D88, #744); null se sono finiti tutti. PURA.
   */
  function livelloCheLoPaga(level, left) {
    for (let n = Math.min(3, Math.max(1, Number(level) || 1)); n >= 1; n -= 1) {
      if (left(capKeyOf(n)) > 0) return n;
    }
    return null;
  }

  /**
   * L'esito di un giro, calcolato dai livelli e dai bilanci (spec §4). PURA.
   *
   * Regole:
   *   - ferma il lavoro un rilievo che chiede una decisione se è un 3, o se è
   *     una scelta difficile da disfare a qualunque livello (`?!`: decisioneFerma);
   *   - un rilievo di livello X paga col bilancio di X; finito quello, col più
   *     alto ancora aperto sotto X (D88, #744), anche se nient'altro fa
   *     partire il giro (livelloCheLoPaga);
   *   - un 3 che non può pagare nemmeno così ferma il lavoro (è l'unico
   *     livello che ferma per bilancio); un 2 o un 1 NON fermano: vanno
   *     nel feedback derivato (un 2 a priorità 1), e il giro passa se non c'è
   *     altro (decisione dell'owner del 2026-09-23);
   *   - se almeno un interno può pagare il giro parte, e ci salgono tutti gli
   *     altri, anche chi non può pagare (sta per forza sotto chi paga, e un
   *     altro verificatore arriva comunque: 2026-09-16);
   *   - un 2 col `?` segue le stesse regole del 2: chi corregge applica
   *     l'opzione consigliata, e il rilievo esce ANCHE fra i `derived` (con
   *     `inCorrezione: true`), in un feedback suo con la domanda: se l'owner
   *     sceglie diversamente, quel feedback cambia il codice già fuso (#1202);
   *   - un 1 che chiede una decisione va nel feedback derivato;
   *   - una scelta difficile da disfare (`?!`) ferma a ogni livello, e va al
   *     manutentore (`destinatario` su ogni `blocking`: destinatarioDelFermo);
   *   - un giro consuma UN giro dal bilancio più alto fra quelli con cui i
   *     rilievi possono pagare (bilancioPagato lo racconta nella nota);
   *   - se il lavoro si ferma, non si corregge niente;
   *   - senza uno dei tre bilanci LANCIA (`bilanci del verificatore
   *     mancanti: …`): un numero inventato al posto di quello dell'owner è
   *     peggio di un errore (decisione del 2026-09-16).
   *
   * Il giro lo decidono i rilievi interni (sede `i`). Gli esterni non entrano
   * in nessuna delle regole sopra: tornano a parte in `external`, senza livello
   * e con `priority: null` (il feedback nuovo lo classifica chi classifica gli
   * altri, #2339), in ogni esito. Un esterno col `?` non ferma niente: la
   * domanda viaggia nel suo feedback. I rilievi messi da parte (`derived`)
   * portano la `priority` del livello SCRITTO; come diventano feedback lo dice
   * derivedGroups.
   *
   * @param {object} p { findings, caps:{cap3,cap2,cap1}, counts:{count3,count2,count1} }
   * @returns {{
   *   stop: boolean, blocking: object[], sospesi: object[], fix: object[], derived: object[], external: object[],
   *   consume: 'cap3'|'cap2'|'cap1'|null, counts: object,
   *   budgets: { cap3:{cap,used,left}, cap2:…, cap1:… }
   * }}
   *   `sospesi` (solo allo stop): gli altri interni della stessa critica, che
   *   restano davanti a chi riprende dopo la risposta.
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
    const conPriorita = (f) => Object.assign({}, f, { priority: prioritaDiNascita(f.level) });

    const findings = tutti.filter((f) => f.sede !== 'e');
    const external = tutti.filter((f) => f.sede === 'e').map((f) => Object.assign({}, f, { priority: null }));
    const blocking = [];
    const derived = [];
    const candidati = [];
    // Il livello del bilancio che paga il giro: il più alto fra quelli che i
    // candidati possono pagare. Chi non può pagare sta per forza sotto chi paga.
    let paga = null;
    for (const f of findings) {
      const level = Number(f.level);
      if (decisioneFerma(f)) {
        blocking.push(f);
        continue;
      }
      if (level < 2 && f.decision) {
        derived.push(f);
        continue;
      }
      const p = livelloCheLoPaga(level, left);
      if (level >= 3 && p === null) blocking.push(f);
      else {
        candidati.push(f);
        if (p !== null && (paga === null || p > paga)) paga = p;
      }
    }
    const fixable = paga === null ? [] : candidati;
    if (paga === null) derived.push(...candidati);

    const budgets = {};
    for (const k of CAP_KEYS) budgets[k] = { cap: caps[k], used: counts[k.replace('cap', 'count')], left: Math.max(0, left(k)) };

    if (blocking.length) {
      // Gli altri interni non si perdono con lo stop: chi riprende li trova nel
      // segnalibro, insieme a quello che ha fermato, e il giro dopo non li riscopre.
      const sospesi = findings.filter((f) => !blocking.includes(f));
      const conDestinatario = blocking.map((f) => Object.assign({}, f, { destinatario: destinatarioDelFermo(f) }));
      return { stop: true, blocking: conDestinatario, sospesi, fix: [], derived: [], external, consume: null, counts: Object.assign({}, counts), budgets };
    }

    // Ordine stabile: come nella critica. Un 2 col `?` corretto esce anche da parte:
    // la domanda all'owner viaggia nel suo feedback mentre il lavoro va avanti.
    const fix = findings.filter((f) => fixable.includes(f));
    const rest = findings
      .filter((f) => derived.includes(f) || (fixable.includes(f) && f.decision))
      .map((f) => (fixable.includes(f) ? Object.assign(conPriorita(f), { inCorrezione: true }) : conPriorita(f)));
    let consume = null;
    if (fix.length) {
      consume = capKeyOf(paga);
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
   *     viaggia nel suo feedback), senza livello e con `priority: null`: lo
   *     classifica chi classifica ogni feedback nuovo (#2339);
   *   - `decisione`: un interno col `?`, da solo (anche un 2 col `?` che
   *     intanto si corregge: porta `inCorrezione`);
   *   - `rimasti`: TUTTI gli altri interni messi da parte dal bilancio in un
   *     feedback solo, alla priorità più alta fra i loro livelli scritti (un 2 nasce a 1).
   * Accetta un elenco di rilievi o una decisione di decideRound (`external` +
   * `derived`). I rilievi escono con i campi che avevano (anche `num`, `id`),
   * più `sede`, `level`, `priority` e `decision` canonici (lo stato della scala
   * vecchia come in normalizeFindings). Ordine: i gruppi da soli come arrivano,
   * `rimasti` in fondo.
   * @returns {Array<{ tipo: 'esterno'|'decisione'|'rimasti', priority: number|null, decision: boolean, findings: object[] }>}
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
      const sede = sedeDi(f.sede);
      if (sede === 'e') {
        const item = Object.assign({}, f, { level: null, sede, priority: null, decision: f.decision === true });
        groups.push({ tipo: 'esterno', priority: null, decision: item.decision, findings: [item] });
        continue;
      }
      const level = Number(f.level) === 0 ? 1 : Number(f.level);
      if (!LEVELS.includes(level)) continue;
      const priority = PRIORITA.includes(Number(f.priority)) ? Number(f.priority) : prioritaDiNascita(level);
      const item = Object.assign({}, f, { level, sede, priority, decision: f.decision === true });
      if (item.decision) {
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

  /** «[2i]», «[1i?]», «[2i?!]», «[e]»: livello e sede di un rilievo, senza testo. PURA. */
  function findingTag(f) {
    const segni = f && f.decision ? `?${f.irreversibile === true ? '!' : ''}` : '';
    const sede = sedeDi(f && f.sede);
    if (sede === 'e') return `[e${segni}]`;
    const n = Number(f && f.level);
    return `[${LEVELS.includes(n) ? n : 1}i${segni}]`;
  }

  /**
   * Cosa contiene un gruppo, in poche parole: la stessa etichetta nella nota
   * del server, nelle risposte delle routine e nella verifica locale. PURA.
   */
  function groupLabel(g) {
    const findings = g && Array.isArray(g.findings) ? g.findings : [];
    if (g && g.tipo === 'esterno') return g.decision ? 'esterno, da decidere' : 'esterno';
    if (g && g.tipo === 'decisione') {
      return findings[0] && findings[0].inCorrezione === true ? 'interno, da decidere: intanto si applica l\'opzione consigliata' : 'interno, da decidere';
    }
    const n = findings.length;
    return `rimasti del giro: ${n} ${n === 1 ? 'rilievo' : 'rilievi'} (${findings.map(findingTag).join(', ')})`;
  }

  // ── Testi ─────────────────────────────────────────────────────────────────

  /** Un rilievo come riga di elenco: «- [2i] testo», «- [1i?] testo», «- [e] testo». PURA. */
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

  // Le frasi sui bilanci stanno qui sole: le stampano anche dispatch e la verifica locale.
  const RILIEVI_CHE_FERMANO = 'Rilievi interni che non si possono correggere da soli (un 3 con finiti il suo bilancio e quelli dei livelli sotto, o una decisione su un 3): decide l\'owner. Una scelta difficile da disfare ferma anche lei, e va al manutentore.';

  /** La riga sui 2 interni messi da parte (finiti i bilanci dal 2 in giù), o ''. PURA. */
  function dueDaParteRiga(list) {
    const n = (Array.isArray(list) ? list : []).filter((f) => f && Number(f.level) === 2 && sedeDi(f.sede) === 'i' && f.decision !== true).length;
    if (!n) return '';
    return `I bilanci delle correzioni dei livelli 2 e 1 sono finiti: ${n === 1 ? 'il rilievo interno di livello 2 rimasto non ferma il lavoro ed entra' : `i ${n} rilievi interni di livello 2 rimasti non fermano il lavoro ed entrano`} nel feedback dei rimasti.`;
  }

  /**
   * La riga che dice quale bilancio ha pagato il giro quando non è quello del
   * rilievo interno più grave corretto (D88), o '': senza, un 2 corretto a
   * bilancio dei 2 finito sembra un conto sbagliato. PURA.
   */
  function bilancioPagato(decision) {
    const d = decision || {};
    if (!CAP_KEYS.includes(d.consume)) return '';
    const paga = Number(d.consume.slice(3));
    const grave = livelloDegliInterni(d.fix);
    if (grave === null || grave <= paga) return '';
    return `Il giro lo paga il bilancio del livello ${paga}: ${grave - paga === 1 ? `quello del livello ${grave} è finito` : `quelli dei livelli da ${grave} a ${paga + 1} sono finiti`}.`;
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
      parts.push(`${esterni === 1 ? 'Un rilievo è esterno (non riguarda l\'obiettivo e non l\'ha introdotto il ramo): diventa un feedback nuovo, senza livello, classificato' : `${esterni} rilievi sono esterni (non riguardano l'obiettivo e non li ha introdotti il ramo): diventano feedback nuovi, senza livello, classificati`} come ogni altro feedback.`);
    }
    if (d.stop) {
      const alManutentore = Array.isArray(d.blocking) && d.blocking.some((f) => destinatarioDelFermo(f) === 'manutentore');
      const allOwner = !Array.isArray(d.blocking) || !d.blocking.length || d.blocking.some((f) => destinatarioDelFermo(f) === 'owner');
      if (allOwner) parts.push('Il lavoro si ferma: c\'è un rilievo interno di livello 3 che non si può correggere da soli (finiti il suo bilancio e quelli dei livelli sotto), o un rilievo interno di livello 3 che chiede una tua decisione.');
      if (alManutentore) parts.push('Il lavoro si ferma su una scelta difficile da disfare (dati degli utenti, formati su disco): la decide il manutentore, che te la porta se serve.');
      const sospesi = Array.isArray(d.sospesi) ? d.sospesi.length : 0;
      if (sospesi) parts.push(`${sospesi === 1 ? 'Un altro rilievo interno resta' : `Altri ${sospesi} rilievi interni restano`} davanti a chi riprende dopo la risposta.`);
    } else if (Array.isArray(d.fix) && d.fix.length) {
      parts.push(`La correzione riguarda ${d.fix.length === list.length ? 'tutti i rilievi' : `${d.fix.length} su ${list.length}`}; poi un'altra verifica ricontrolla.`);
      const pagato = bilancioPagato(d);
      if (pagato) parts.push(pagato);
    } else {
      parts.push(esterni === list.length
        ? 'Nessun rilievo interno: il lavoro prosegue.'
        : 'Nessun rilievo interno da correggere adesso: il lavoro prosegue e i rilievi messi da parte vanno in feedback derivati.');
    }
    const gruppi = derivedGroups({ derived: d.stop ? [] : d.derived });
    const applicate = gruppi.filter((g) => g.tipo === 'decisione' && g.findings[0].inCorrezione === true).length;
    const domande = gruppi.filter((g) => g.tipo === 'decisione').length - applicate;
    if (domande) {
      parts.push(`${domande === 1 ? 'Un rilievo chiede una tua decisione senza fermare il lavoro: esce in un feedback a parte' : `${domande} rilievi chiedono una tua decisione senza fermare il lavoro: escono ciascuno in un feedback a parte`}, con la priorità del livello (un 2 nasce a 1: la rosa la sceglie il manutentore).`);
    }
    if (applicate) {
      parts.push(`${applicate === 1 ? 'Un rilievo di livello 2 chiede una tua decisione' : `${applicate} rilievi di livello 2 chiedono una tua decisione`} senza fermare il lavoro: chi corregge applica intanto l'opzione consigliata dal verificatore, e la domanda esce in un feedback a parte. Se scegli diversamente, quel feedback cambia il codice già fuso.`);
    }
    const rimasti = gruppi.find((g) => g.tipo === 'rimasti');
    if (rimasti) {
      const n = rimasti.findings.length;
      const voci = rimasti.findings.map((f) => `${findingTag(f)} ${primaFrase(f.text, 80)}`).join('; ');
      parts.push(n === 1
        ? `Il rilievo non corretto in questo giro esce in un feedback derivato, a priorità ${rimasti.priority}: ${voci}`
        : `I ${n} rilievi non corretti in questo giro escono insieme in un solo feedback derivato, a priorità ${rimasti.priority} (la più alta fra loro): ${voci}`);
    }
    const due = d.stop ? '' : dueDaParteRiga(d.derived);
    if (due) parts.push(due);
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
    LEVELS, SEDI, SPIEGAZIONE_SEDE, SPIEGAZIONE_SEGNO, SPIEGAZIONE_ZERO, SPIEGAZIONE_VICINO, SPIEGAZIONE_ESTERNO, SPIEGAZIONE_INTERNO,
    MAX_FINDINGS, MAX_FINDING_TEXT, CAP_KEYS, CAP_MIN, CAP_MAX,
    capKeyOf, countKeyOf, normalizeCritique, parseFindings, unparsedLevelLines, testoRilieviNonRiconosciuti, normalizeFindings, maxLevel, primaFrase,
    sedeDi, livelloDegliInterni, decisioneFerma, destinatarioDelFermo, bloccaSuUnRilievo, missingCaps, normalizeCaps, normalizeCounts,
    livelloCheLoPaga, decideRound, RILIEVI_CHE_FERMANO, dueDaParteRiga, bilancioPagato, derivedGroups, groupLabel,
    findingTag, formatFinding, formatFindings, hasDecision, roundNote, domandeMancanti, titoloDelDerivato,
    FILE_DI_SERVIZIO, MOTIVI_CORRETTORE, FORMA_MOTIVO, leggiMotivoCorrettore, testoMotivo, giroDopoRiallineamento,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
