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

  // I livelli della scala delle priorità di Filo (routines/roles/verifier.md
  // § Che esito dare): 3 sicurezza/dati/Filo inutilizzabile, 2 la cosa chiesta
  // non si ottiene o cammino principale, 1 cosmetica/attrito fuori cammino,
  // 0 situazione rara.
  const LEVELS = [0, 1, 2, 3];

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
  // Una riga per rilievo, che comincia col livello fra parentesi quadre:
  //
  //   [2] Il pulsante «Salva» non salva se il titolo è vuoto: passi …
  //   [1?] Il colore del bordo non segue il tema scuro (chiede una decisione)
  //   [0] Con la finestra sotto i 300 pixel il menu esce dallo schermo
  //
  // Il `?` dopo il livello segna «chiede una decisione dell'owner» (un
  // trade-off vero, una scelta di prodotto). Le righe che seguono un rilievo
  // senza un livello davanti sono la sua continuazione (i passi per
  // riprodurlo); le righe PRIMA del primo rilievo sono il riassunto («cosa
  // funziona»). Una critica senza nessuna riga con livello ha zero rilievi:
  // è il pass.
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
  const FINDING_LINE = new RegExp(`^\\s*${PREFISSO_ELENCO}(?:\\*\\*)?\\[\\s*([0-3])\\s*(\\?)?\\s*\\](?:\\*\\*)?\\s*(.*)$`);
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
  const LEVEL_TOKEN_SRC = '\\[\\s*(?:[A-Za-zÀ-ÿ.?!]{1,10}\\s*)?\\d+(?:\\s*[-–/]\\s*\\d+)?\\s*[?!]*\\s*\\]';
  const LEVEL_START = new RegExp(`^\\s*${PREFISSO_ELENCO}(?:\\*\\*)?${LEVEL_TOKEN_SRC}`);
  // Un livello scritto in una parentesi qualunque — tonda, graffa, doppia,
  // spaiata — o con la cifra a parole. Il lettore riconosce solo la quadra con
  // la cifra: tutto il resto finiva nel riassunto in silenzio, e una
  // bocciatura diventava una promozione (feedback #565). Qui si guarda come
  // APRE la riga, e basta che dentro ci sia una cifra o una parola che dice un
  // livello.
  const PARENTESI_QUALUNQUE = '(?:\\[{1,2}|\\(|\\{)\\s*[^\\]\\)\\}\\n]{0,20}(?:\\]{1,2}|\\)|\\})';
  const APERTURA_PARENTESI = new RegExp(`^\\s*${PREFISSO_ELENCO}(?:\\*\\*)?(${PARENTESI_QUALUNQUE})`);
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
  const QUADRA_OVUNQUE = new RegExp(`(${LEVEL_TOKEN_SRC})`);
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
  const LEVEL_LABEL = new RegExp(`^\\s*${PREFISSO_ELENCO}(?:\\*\\*)?[^\\[\\]]{1,30}?\\s*${LEVEL_TOKEN_SRC}\\s*[:\\-–—]`);

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
  const ESCAPED_BREAK_BEFORE_BRACKET = new RegExp(`(?:\\\\r)?\\\\n\\s*${PREFISSO_ELENCO}(?:\\*\\*)?\\[`);

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
        flush();
        count += 1;
        current = { line: raw.trim(), text: m[3].trim() };
        continue;
      }
      const apertura = APERTURA_PARENTESI.exec(raw) || LIVELLO_VICINO.exec(raw.trim());
      const parentesiStorta = (!!apertura && DENTRO_SEMBRA_LIVELLO.test(apertura[1]))
        || (current ? QUADRA_VICINA.test(raw.trim()) : QUADRA_OVUNQUE.test(raw))
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
   * @returns {{ summary: string, findings: Array<{level:number, text:string, decision:boolean}> }}
   */
  function parseFindings(text) {
    const lines = normalizeCritique(text).split('\n');
    const summary = [];
    const findings = [];
    let current = null;
    for (const raw of lines) {
      const m = FINDING_LINE.exec(raw);
      if (m) {
        current = { level: Number(m[1]), text: m[3].trim(), decision: m[2] === '?' };
        findings.push(current);
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
    };
  }

  /**
   * Un elenco di rilievi arrivato da fuori (dal client, da un file) portato
   * alla forma canonica. Scarta quello che non è un rilievo: livello fuori
   * scala, testo vuoto. PURA.
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
      out.push({ level, text, decision: f.decision === true });
      if (out.length >= MAX_FINDINGS) break;
    }
    return out;
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
  // z per gli 0. I DEFAULT vivono in feedbackTransitions.js (VERIFIER_CAPS,
  // fonte unica incorporata dal server); i valori effettivi li detta l'owner
  // dalla dashboard. Il tetto alto è lo stesso della dashboard.
  const CAP_MIN = 0;
  const CAP_MAX = 10;
  const CAP_KEYS = ['cap2', 'cap1', 'cap0'];

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
   *   - un rilievo di livello 3/2 (o 1) si corregge se il SUO bilancio ha
   *     ancora giri; a bilancio finito un 3/2 ferma il lavoro, un 1 va nel
   *     feedback derivato;
   *   - un 1 che chiede una decisione va nel feedback derivato;
   *   - gli 0 si correggono solo se nello stesso giro si corregge anche altro
   *     (un altro verificatore arriva comunque) oppure se l'owner ha dato
   *     giri al loro bilancio; altrimenti vanno nel feedback derivato;
   *   - un giro consuma UN giro dal bilancio del livello più alto corretto;
   *   - se il lavoro si ferma, non si corregge niente: decide l'owner su tutto.
   *
   * @param {object} p { findings, caps:{cap2,cap1,cap0}, counts:{count2,count1,count0} }
   * @returns {{
   *   stop: boolean, blocking: object[], fix: object[], derived: object[],
   *   consume: 'cap2'|'cap1'|'cap0'|null, counts: object,
   *   budgets: { cap2:{cap,used,left}, cap1:…, cap0:… }
   * }}
   */
  function decideRound(p) {
    const findings = normalizeFindings(p && p.findings);
    const caps = normalizeCaps(p && p.caps, p && p.defaults);
    const counts = normalizeCounts(p && p.counts);
    const left = (k) => caps[k] - counts[k.replace('cap', 'count')];

    const blocking = [];
    const fixable = [];
    const derived = [];
    const zeros = [];
    for (const f of findings) {
      if (f.level >= 2) {
        if (f.decision || left('cap2') <= 0) blocking.push(f);
        else fixable.push(f);
      } else if (f.level === 1) {
        if (f.decision || left('cap1') <= 0) derived.push(f);
        else fixable.push(f);
      } else {
        zeros.push(f);
      }
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
      return { stop: true, blocking, fix: [], derived: [], consume: null, counts: Object.assign({}, counts), budgets };
    }

    // Ordine stabile: come nella critica. Il bilancio si paga dal livello più
    // alto corretto.
    const fix = findings.filter((f) => fixable.includes(f));
    const rest = findings.filter((f) => derived.includes(f));
    let consume = null;
    if (fix.length) {
      consume = capKeyOf(maxLevel(fix));
      counts[consume.replace('cap', 'count')] += 1;
      budgets[consume].used += 1;
      budgets[consume].left = Math.max(0, budgets[consume].left - 1);
    }
    return { stop: false, blocking: [], fix, derived: rest, consume, counts, budgets };
  }

  // ── Testi ─────────────────────────────────────────────────────────────────

  /** Un rilievo come riga di elenco: «- [2] testo (chiede una decisione)». PURA. */
  function formatFinding(f) {
    const mark = f && f.decision ? '?' : '';
    const text = String((f && f.text) || '').replace(/\n/g, '\n  ');
    return `- [${Number(f && f.level) || 0}${mark}] ${text}`;
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
    if (d.stop) {
      parts.push('Il lavoro si ferma: c\'è un rilievo di livello 2 o 3 che non si può correggere da soli (bilancio esaurito, o chiede una tua decisione).');
    } else if (Array.isArray(d.fix) && d.fix.length) {
      parts.push(`La correzione riguarda ${d.fix.length === list.length ? 'tutti i rilievi' : `${d.fix.length} su ${list.length}`}; poi un'altra verifica ricontrolla.`);
    } else {
      parts.push('Nessun rilievo da correggere adesso: il lavoro prosegue e i rilievi vanno in un feedback derivato.');
    }
    parts.push(formatFindings(list));
    return parts.join('\n');
  }

  global.SN_VERIFIER_ROUND = {
    LEVELS, MAX_FINDINGS, MAX_FINDING_TEXT, CAP_KEYS, CAP_MIN, CAP_MAX,
    capKeyOf, countKeyOf, normalizeCritique, parseFindings, unparsedLevelLines, normalizeFindings, maxLevel,
    normalizeCaps, normalizeCounts, decideRound,
    formatFinding, formatFindings, hasDecision, roundNote,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
