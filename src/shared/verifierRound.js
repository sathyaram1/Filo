// Il giro del verificatore che corregge — la parte PURA (spec «Il verificatore
// corregge: un agente per giro», feedback #561, decisa con l'owner il
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
  const MAX_FINDING_TEXT = 2000;

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
  const FINDING_LINE = /^\s*(?:[-*•]\s*)?(?:\*\*)?\[\s*([0-3])\s*(\?)?\s*\](?:\*\*)?\s*(.*)$/;

  /**
   * Legge la critica scritta dal verificatore. PURA.
   * @returns {{ summary: string, findings: Array<{level:number, text:string, decision:boolean}> }}
   */
  function parseFindings(text) {
    const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
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
      parts.push(`Il verificatore corregge ${d.fix.length === list.length ? 'tutti i rilievi' : `${d.fix.length} su ${list.length}`}; poi un altro verificatore ricontrolla.`);
    } else {
      parts.push('Nessun rilievo da correggere adesso: il lavoro prosegue e i rilievi vanno in un feedback derivato.');
    }
    parts.push(formatFindings(list));
    return parts.join('\n');
  }

  global.SN_VERIFIER_ROUND = {
    LEVELS, MAX_FINDINGS, MAX_FINDING_TEXT, CAP_KEYS, CAP_MIN, CAP_MAX,
    capKeyOf, countKeyOf, parseFindings, normalizeFindings, maxLevel,
    normalizeCaps, normalizeCounts, decideRound,
    formatFinding, formatFindings, hasDecision, roundNote,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
