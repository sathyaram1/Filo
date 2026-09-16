// Il giro di verifica, la parte PURA (#561): le regole con cui un giro decide quali rilievi
// si correggono subito e da quale bilancio si paga il giro, quali finiscono nel feedback
// derivato e quando il lavoro si ferma e passa all'owner; più il formato con cui il
// verificatore scrive la critica (`[livello] testo`) e il suo parser.
// Condiviso perché le stesse regole girano in TRE posti — il server (che le incorpora al
// deploy con bake-shared), scripts/dispatch.mjs e scripts/verify-local.mjs — e una copia
// sola evita che la dashboard mostri una regola e il server ne applichi un'altra.

(function (global) {
  'use strict';

  // I livelli della scala delle priorità (routines/roles/verifier.md § Che esito dare):
  // 3 sicurezza/dati/Filo inutilizzabile, 2 la cosa chiesta non si ottiene o cammino
  // principale, 1 cosmetica/attrito fuori cammino, 0 situazione rara.
  const LEVELS = [0, 1, 2, 3];

  // Tetto ai rilievi di una critica: oltre non è una critica, è un elenco generato.
  const MAX_FINDINGS = 40;
  // Il tetto di un singolo rilievo è lo stesso della critica intera: un rilievo coi suoi passi
  // sta comunque dentro la critica, che oltre il tetto viene RESPINTA col numero, non tagliata.
  // A 2000 i passi in coda sparivano in silenzio (CLAUDE.md § Limiti).
  const MAX_FINDING_TEXT = 12000;

  // A quale bilancio appartiene un livello. I 3 e i 2 condividono lo stesso bilancio: sono
  // entrambi «la cosa chiesta non si ottiene», e la differenza conta per la priorità, non per
  // quante correzioni si pagano.
  function capKeyOf(level) {
    const n = Number(level);
    if (n >= 2) return 'cap2';
    if (n === 1) return 'cap1';
    return 'cap0';
  }

  function countKeyOf(level) {
    return capKeyOf(level).replace('cap', 'count');
  }

  // Il formato della critica: una riga per rilievo che comincia col livello fra quadre —
  // «[2] Il pulsante «Salva» non salva se il titolo è vuoto: passi …». Il `?` dopo il livello
  // («[1?]») segna «chiede una decisione dell'owner»: un trade-off vero, una scelta di
  // prodotto. Le righe che seguono un rilievo senza livello sono la sua continuazione (i passi
  // per riprodurlo), quelle prima del primo rilievo sono il riassunto, e una critica senza
  // nessuna riga con livello ha zero rilievi: è il pass. Il livello può stare dopo un punto
  // elenco, un numero, un titolo Markdown, una citazione o una lettera — chi scrive in
  // Markdown se le aspetta. I modi di elencare ammessi stanno in UN posto solo: il controllo
  // che respinge un livello scritto male deve accettarne esattamente quanti ne legge il
  // lettore, o un «[4] gravissimo» dopo un `>` finisce nel riassunto e una bocciatura diventa
  // una promozione, in silenzio (#565).
  const PREFISSO_ELENCO = '(?:#{1,6}\\s*|>\\s*|[-*•]\\s*|\\d{1,2}[.)]\\s*|[A-Za-z][.)]\\s*)?';
  // Il grassetto di Markdown si scrive con gli asterischi O con gli underscore: guardando
  // solo gli asterischi, «__tre] …» passava muta (#565).
  const GRASSETTO = '(?:\\*{1,3}|_{1,3})?';
  const FINDING_LINE = new RegExp(`^\\s*${PREFISSO_ELENCO}${GRASSETTO}\\[\\s*([0-3])\\s*(\\?)?\\s*\\]${GRASSETTO}\\s*(.*)$`);
  // Qualunque cosa fra quadre che sembri un livello: fuori scala («[4]»), un intervallo
  // («[2-3]», «[2/3]»), con una parola davanti («[livello 2]», «[L2]», «[P2]»), col segno
  // fuori posto («[?2]», «[2!]»). Una riga che COMINCIA così, o che lo porta dopo una breve
  // etichetta e prima di un separatore («Rilievo [2]: …»), non è un rilievo ma non è nemmeno
  // riassunto: senza il controllo passava in silenzio. In MEZZO a una frase invece le quadre
  // sono testo: «ho ri-provato la porta [2] del giro scorso» è il modo naturale di riassumere.
  const LEVEL_TOKEN_SRC = '\\[\\s*(?:[A-Za-zÀ-ÿ.?!]{1,10}\\s*)?\\d+(?:\\s*[-–/.,]\\s*\\d+)?\\s*[?!]*\\s*(?:[A-Za-zÀ-ÿ]{1,10}\\s*)?\\]';
  const LEVEL_START = new RegExp(`^\\s*${PREFISSO_ELENCO}${GRASSETTO}${LEVEL_TOKEN_SRC}`);
  // Un livello in una parentesi qualunque — tonda, graffa, doppia, spaiata — o con la cifra a
  // parole. Il lettore riconosce solo la quadra con la cifra: tutto il resto finiva nel
  // riassunto in silenzio (#565). Qui si guarda come APRE la riga, e basta che dentro ci sia
  // una cifra o una parola che dica un livello.
  const PARENTESI_QUALUNQUE = '(?:\\[{1,2}|\\(|\\{)\\s*[^\\]\\)\\}\\n]{0,20}(?:\\]{1,2}|\\)|\\})';
  const APERTURA_PARENTESI = new RegExp(`^\\s*${PREFISSO_ELENCO}${GRASSETTO}(${PARENTESI_QUALUNQUE})`);
  const DENTRO_SEMBRA_LIVELLO = /\d|zero|uno|due|tre|livello|level|priorit/i;
  // La rete che tiene tutte le altre aperture: QUALUNQUE cosa stia davanti — un trattino
  // lungo, un «+», «1.1», «(a)», un apice inverso, un pallino diverso — se entro sei
  // caratteri c'è un livello e il lettore non riesce a leggere la riga come rilievo, quella
  // riga è un rilievo scritto male, non riassunto: elencare i modi di elencare ammessi è una
  // rincorsa che si perde. Sei caratteri perché una frase vera («Nel caso [2] ho provato…»)
  // ha più parole davanti, e resta testo.
  const LIVELLO_VICINO = new RegExp(`^.{0,6}?(${PARENTESI_QUALUNQUE})`);
  // FINE DELLA RINCORSA (regola dell'owner, #565): le QUADRE con dentro un livello sono
  // SEMPRE un rilievo, dovunque stiano nella riga e qualunque cosa ci sia dentro — «[3 -
  // sicurezza]», «[2, grave]», «[3.]», «[#2]», «[2%]» — e se la riga non si legge come
  // rilievo viene respinta con la spiegazione. Per cinque giri di fila il controllo ha
  // guardato una finestra sempre un po' più larga, e ogni volta bastava un'etichetta di una
  // parola in più perché un rilievo — anche di sicurezza — finisse nel riassunto e la
  // bocciatura diventasse una promozione. Il prezzo, che vale la pena: nel riassunto un
  // livello si cita senza le quadre («il livello 2»), altrimenti si riscrive la riga.
  const QUADRA_OVUNQUE = /\[{1,2}[^\]\n]{0,200}\]{1,2}/g;
  // E, dovunque nella riga, una parentesi di QUALUNQUE forma che contenga SOLO un livello:
  // «(3)», «{2}», «[2)», «(due)». Il contenuto è stretto apposta — «(3 volte)» in mezzo a
  // una frase resta testo normale.
  const SOLO_UN_LIVELLO = '\\s*(?:(?:livello|level|priorit[àa]|liv|L|P)\\s*)?(?:\\d+(?:\\s*[.,\\-–/]\\s*\\d+)?|zero|uno|due|tre)\\s*[?!]*\\s*';
  // Una quadra che contiene qualcosa che somiglia a un livello.
  // Dentro la quadra spaiata, fra il livello e la parentesi, può esserci qualunque cosa e
  // anche una descrizione intera («3 dati dell'utente a rischio]» è come uno scrive davvero):
  // con la finestra corta, o guardando solo «cifra più lettere», finiva muta nel riassunto.
  // Le parole si ancorano ai confini, o «altre» conterrebbe «tre», e il confine si guarda
  // alle LETTERE, non con \b: per la regex l'underscore è carattere di parola, quindi dopo
  // un grassetto scritto «__tre]» il confine non c'era e la riga passava muta (#565).
  const LIVELLO_NUDO = '(?:\\d|(?<![A-Za-zÀ-ÿ])(?:zero|uno|due|tre)(?![A-Za-zÀ-ÿ])|[?!])';
  const QUADRA_APERTA = new RegExp(`\\[{1,2}[^\\[\\]\\n]{0,200}?${LIVELLO_NUDO}`, 'i');
  const QUADRA_CHIUSA = new RegExp(`${LIVELLO_NUDO}[^\\[\\]\\n]{0,200}?\\]{1,2}`, 'i');

  // Un livello che APRE la riga e incontra una parentesi di CHIUSURA mai aperta: «tre] …»,
  // «tre) …», «__tre] …». È la parentesi dimenticata. La finestra non può contenere una
  // parentesi APERTA, quindi «3 volte (ok)» in mezzo a una frase resta testo.
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
    // TUTTE le quadre della riga, non solo la prima: bastava una frase fra quadre all'inizio
    // per far sparire il livello scritto più avanti. E il contenuto può essere lungo.
    const testo = String(riga || '');
    // La quadra SPAIATA — aperta e mai chiusa, o chiusa e mai aperta — col contenuto
    // lunghissimo: una parentesi dimenticata è l'errore di battitura della virgoletta che
    // manca, e non deve costare una bocciatura.
    if (QUADRA_APERTA.test(testo) || QUADRA_CHIUSA.test(testo)) return true;
    QUADRA_OVUNQUE.lastIndex = 0;
    for (let m = QUADRA_OVUNQUE.exec(testo); m; m = QUADRA_OVUNQUE.exec(testo)) {
      if (DENTRO_SEMBRA_LIVELLO.test(m[0])) { QUADRA_OVUNQUE.lastIndex = 0; return true; }
    }
    return false;
  }
  const PARENTESI_LIVELLO = new RegExp(`(?:\\[{1,2}|\\(|\\{)${SOLO_UN_LIVELLO}(?:\\]{1,2}|\\)|\\})`);
  // Dentro la CONTINUAZIONE di un rilievo, invece, un livello citato in mezzo a una frase
  // resta testo: lì il danno è minore — il rilievo sopra è comunque registrato e la
  // bocciatura non si perde — quindi vale la finestra.
  const QUADRA_VICINA = new RegExp(`^.{0,14}?(${LEVEL_TOKEN_SRC})`);
  // «Difetto: [2] …», «rilievo grave [2] …»: l'etichetta sta PRIMA del livello, col
  // separatore o senza. Guardando solo la forma opposta («Rilievo [2]: …») passava per
  // riassunto.
  const ETICHETTA_PRIMA = new RegExp(`^\\s*${PREFISSO_ELENCO}[^\\[\\]]{1,20}?[:\\-–—]\\s*${LEVEL_TOKEN_SRC}`);
  // L'etichetta breve col separatore vale solo nel riassunto: dentro la continuazione di un
  // rilievo («Passi: critica con [2] - poi start») è testo, e respingerla mandava a
  // riscrivere una riga giusta.
  const LEVEL_LABEL = new RegExp(`^\\s*${PREFISSO_ELENCO}${GRASSETTO}[^\\[\\]]{1,30}?\\s*${LEVEL_TOKEN_SRC}\\s*[:\\-–—]`);

  // Un a capo scritto coi due caratteri barra e n: è come esce il comando d'esempio copiato
  // dentro virgolette doppie, in bash come in PowerShell. Se davanti a una quadra c'è quella
  // coppia vale come a capo in tutto il testo; in mezzo a una frase, senza una parentesi
  // dopo, resta testo. Valgono gli stessi modi di elencare del lettore, e la parentesi di
  // apertura può anche mancare («\ntre] i dati in chiaro»): altrimenti l'a capo non veniva
  // riconosciuto, la riga non diventava mai una riga e il rilievo finiva nel riassunto.
  // Il confine a sinistra ce l'ha già il pattern e riguardarlo lo romperebbe: l'a capo
  // scritto a mano finisce per «n», che è una lettera (#565).
  const LIVELLO_DOPO_CONFINE = '(?:\\d|(?:zero|uno|due|tre)(?![A-Za-zÀ-ÿ])|[?!])';
  const DOPO_A_CAPO = `(?:[\\[({]|${LIVELLO_DOPO_CONFINE}[^\\[\\]\\n]{0,200}?[\\]})])`;
  const ESCAPED_BREAK_BEFORE_BRACKET = new RegExp(`(?:\\\\r)?\\\\n\\s*${PREFISSO_ELENCO}${GRASSETTO}${DOPO_A_CAPO}`, 'i');

  // La critica con gli a capo veri: `\r\n` → `\n`, e la barra-n letterale usata come a capo.
  function normalizeCritique(text) {
    const s = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    return ESCAPED_BREAK_BEFORE_BRACKET.test(s) ? s.replace(/(?:\\r)?\\n/g, '\n') : s;
  }

  // Le righe della critica che NON si possono registrare così come sono:
  // - un livello fuori posto o fuori scala («Rilievo [2]: …», «[4] …», «[2-3] …»), che
  // finiva nel riassunto e faceva passare in silenzio un lavoro con un [2];
  // - un livello SENZA testo (una riga «[2]» e basta, senza continuazione): il lettore lo
  // scartava e il rilievo spariva, cioè un [2] diventava un pass;
  // - più rilievi del tetto: il quarantunesimo veniva tagliato senza dirlo.
  // Chi registra la critica le rifiuta chiedendo il formato giusto.
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
        // Due livelli sulla STESSA riga: il secondo finiva dentro al testo del primo, e un difetto
        // di sicurezza spariva in coda a uno cosmetico. Basta un a capo dimenticato.
        if (quadraColLivello(m[3])) {
          flush();
          out.push(raw.trim());
          continue;
        }
        flush();
        count += 1;
        current = { line: raw.trim(), text: m[3].trim() };
        continue;
      }
      // La regola, senza finestre e senza eccezioni (owner, 2026-09-07 su #565): le QUADRE con
      // dentro un livello sono sempre un rilievo, dovunque stiano e anche dentro la continuazione
      // di un altro rilievo. Le altre parentesi valgono all'inizio della riga, dove uno le
      // userebbe per aprire un rilievo: in mezzo a una frase «(3 volte)» è testo normale.
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

  // Legge la critica scritta dal verificatore. Torna { summary, findings: [{ level, text,
  // decision }] }.
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

  // Un elenco di rilievi arrivato da fuori (dal client, da un file) portato alla forma
  // canonica. Scarta quello che non è un rilievo: livello fuori scala, testo vuoto.
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

  // Il livello più alto fra i rilievi (null se non ce ne sono).
  function maxLevel(findings) {
    let m = null;
    for (const f of findings || []) {
      const n = Number(f && f.level);
      if (LEVELS.includes(n) && (m === null || n > m)) m = n;
    }
    return m;
  }

  // Tre bilanci per feedback (spec §4): x giri per i livelli 3 e 2, y per gli 1, z per gli 0.
  // I numeri li detta SOLO l'owner dalla dashboard (config/routines): nel codice non c'è un default (2026-09-16), e un bilancio mancante non vale 0 né altro — decideRound si ferma con un errore che dice quale manca. Il tetto alto è lo stesso della dashboard.
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

  // L'esito di un giro, calcolato dai livelli e dai bilanci (spec §4):
  // - un rilievo di livello 3 o 2 che chiede una decisione ferma il lavoro;
  // - un 3/2 si corregge se il SUO bilancio ha ancora giri; a bilancio finito ferma il lavoro;
  // - un 1 si corregge se nello stesso giro si corregge anche un 3/2 (il giro lo paga già il livello più alto) o se il suo bilancio ha ancora giri; altrimenti va nel feedback derivato, come un 1 che chiede una decisione;
  // - gli 0 si correggono solo se nello stesso giro si corregge anche altro (un altro verificatore arriva comunque) o se l'owner ha dato giri al loro bilancio;
  // - un giro consuma UN giro dal bilancio del livello più alto corretto;
  // - se il lavoro si ferma non si corregge niente: decide l'owner su tutto;
  // - senza uno dei tre bilanci LANCIA (`bilanci del verificatore mancanti: …`): un numero inventato al posto di quello dell'owner è peggio di un errore.
  // p: { findings, caps:{cap2,cap1,cap0}, counts:{count2,count1,count0} } →
  // { stop, blocking, fix, derived, consume, counts, budgets:{cap,used,left} }.
  function decideRound(p) {
    const findings = normalizeFindings(p && p.findings);
    const mancanti = missingCaps(p && p.caps, p && p.defaults);
    if (mancanti.length) {
      throw new Error(`bilanci del verificatore mancanti: ${mancanti.join(', ')} — li imposta l'owner in Gestione → Automazioni (config/routines); nel codice non c'è un default`);
    }
    const caps = normalizeCaps(p && p.caps, p && p.defaults);
    const counts = normalizeCounts(p && p.counts);
    const left = (k) => caps[k] - counts[k.replace('cap', 'count')];

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
    // Gli 1: con un 3/2 da correggere nello stesso giro si correggono pure loro (il giro lo paga il 3/2); da soli seguono il loro bilancio.
    const withHigher = fixable.length > 0;
    for (const f of ones) {
      if (f.decision) derived.push(f);
      else if (withHigher || left('cap1') > 0) fixable.push(f);
      else derived.push(f);
    }
    // Gli 0: con qualcos'altro da correggere si correggono pure loro; da soli solo se il loro
    // bilancio lo permette (z = 0 per default).
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

    // Ordine stabile: come nella critica. Il bilancio si paga dal livello più alto corretto.
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

  // Un rilievo come riga di elenco: «- [2] testo (chiede una decisione)».
  function formatFinding(f) {
    const mark = f && f.decision ? '?' : '';
    const text = String((f && f.text) || '').replace(/\n/g, '\n  ');
    return `- [${Number(f && f.level) || 0}${mark}] ${text}`;
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
    missingCaps, normalizeCaps, normalizeCounts, decideRound,
    formatFinding, formatFindings, hasDecision, roundNote,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
