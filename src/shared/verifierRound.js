// Il giro di verifica, parte PURA (#561): quali rilievi si correggono subito, da quale
// bilancio si paga il giro, quando il lavoro passa all'owner; più il formato «[livello]
// testo» e il suo parser. Le stesse regole girano in server, dispatch e verify-local.

(function (global) {
  'use strict';

  // La scala delle priorità (verifier.md): 3 sicurezza/dati/Filo inutilizzabile,
  // 2 la cosa chiesta non si ottiene o cammino principale, 1 attrito fuori cammino, 0 raro.
  const LEVELS = [0, 1, 2, 3];

  // Tetto ai rilievi di una critica: oltre non è una critica, è un elenco generato.
  const MAX_FINDINGS = 40;
  // Il tetto di un rilievo è quello della critica intera: oltre, la critica viene RESPINTA
  // col numero, non tagliata — a 2000 i passi in coda sparivano in silenzio.
  const MAX_FINDING_TEXT = 12000;

  // I 3 e i 2 condividono lo stesso bilancio: sono entrambi «la cosa chiesta non si ottiene»,
  // e la differenza conta per la priorità, non per quante correzioni si pagano.
  function capKeyOf(level) {
    const n = Number(level);
    if (n >= 2) return 'cap2';
    if (n === 1) return 'cap1';
    return 'cap0';
  }

  function countKeyOf(level) {
    return capKeyOf(level).replace('cap', 'count');
  }

  // Una riga per rilievo, aperta col livello fra quadre; il `?` («[1?]») chiede l'owner.
  // Le righe senza livello continuano il rilievo sopra, o sono il riassunto se vengono prima.
  const PREFISSO_ELENCO = '(?:#{1,6}\\s*|>\\s*|[-*•]\\s*|\\d{1,2}[.)]\\s*|[A-Za-z][.)]\\s*)?';
  // Il grassetto si scrive con gli asterischi O con gli underscore: «__tre] …» deve valere
  // quanto «**tre] …».
  const GRASSETTO = '(?:\\*{1,3}|_{1,3})?';
  const FINDING_LINE = new RegExp(`^\\s*${PREFISSO_ELENCO}${GRASSETTO}\\[\\s*([0-3])\\s*(\\?)?\\s*\\]${GRASSETTO}\\s*(.*)$`);
  // Qualunque cosa fra quadre che sembri un livello: fuori scala, un intervallo, con una
  // parola davanti, col segno fuori posto. In MEZZO a una frase invece resta testo.
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
        // Due livelli sulla STESSA riga: il secondo finiva dentro al testo del primo, e un difetto
        // di sicurezza spariva in coda a uno cosmetico.
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

  function maxLevel(findings) {
    let m = null;
    for (const f of findings || []) {
      const n = Number(f && f.level);
      if (LEVELS.includes(n) && (m === null || n > m)) m = n;
    }
    return m;
  }

  // Tre bilanci per feedback (spec §4): x giri per i livelli 3 e 2, y per gli 1, z per gli 0.
  // I numeri li detta SOLO l'owner: senza default nel codice, e se manca decideRound lancia.
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

  // Un 3/2 si corregge se il suo bilancio ha giri, e a bilancio finito ferma il lavoro; un 1
  // o uno 0 passa se nello stesso giro si corregge altro; se si ferma non si corregge nulla.
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
    // Gli 1: con un 3/2 da correggere nello stesso giro si correggono pure loro (il giro lo
    // paga il 3/2); da soli seguono il loro bilancio.
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
