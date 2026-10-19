// Logica PURA della ricerca «a senso» della dashboard di gestione (filo://manage/),
// separata dalla UI per provarla senza aprire Electron. `keywordSearch` è il RIPIEGO
// per quando il modello non c'è.

(function (global) {
  'use strict';

  // Quanto testo di ogni feedback passa al modello: abbastanza per capirne il senso,
  // senza gonfiare contesto e costo con testi lunghissimi.
  const MAX_TEXT = 500;

  // Nome esplicito o ripiego calcolato dal testo, stesso criterio del resto della dashboard.
  function titleOf(fb) {
    const name = fb && fb.name;
    if (name && String(name).trim()) return String(name).trim();
    const FB = global.SN_FEEDBACK;
    if (FB && typeof FB.fallbackName === 'function') {
      const fn = FB.fallbackName(fb && fb.text);
      if (fn) return String(fn);
    }
    return '(senza titolo)';
  }

  // Riduce la lista di feedback ai campi utili alla ricerca. Salta quelli senza
  // id (non selezionabili) e normalizza/tronca il testo.
  function buildCandidates(feedbacks, maxText) {
    const list = Array.isArray(feedbacks) ? feedbacks : [];
    const tetto = Number(maxText) > 0 ? Number(maxText) : MAX_TEXT;
    const out = [];
    for (const fb of list) {
      const id = fb && (fb._id || fb.id);
      if (!id) continue;
      const text = String((fb && fb.text) || '').replace(/\s+/g, ' ').trim().slice(0, tetto);
      out.push({ id: String(id), title: titleOf(fb), text });
    }
    return out;
  }

  // Chiede una risposta SOLO JSON, così parseRanking la può leggere.
  function buildPrompt(query, candidates) {
    const q = String(query || '').trim();
    const list = Array.isArray(candidates) ? candidates : [];
    const lines = list.map((c, i) =>
      `${i + 1}. id=${c.id}\n   titolo: ${c.title}\n   testo: ${c.text || '(vuoto)'}`
    ).join('\n\n');
    return [
      'Sei il motore di ricerca semantica della dashboard dei feedback di Filo.',
      "L'utente descrive con parole sue un feedback che vuole ritrovare, spesso con un ricordo vago e non con le parole esatte usate all'epoca.",
      "Capisci il SIGNIFICATO e l'intento della ricerca (non solo le parole) e ordina i feedback dal più pertinente al meno pertinente.",
      '',
      `RICERCA: ${q}`,
      '',
      'FEEDBACK:',
      lines || '(nessun feedback)',
      '',
      'Rispondi SOLO con un array JSON, dal più pertinente al meno pertinente, includendo solo i feedback davvero attinenti (ometti quelli chiaramente non pertinenti).',
      'Ogni elemento ha la forma {"id":"<id del feedback>","reason":"<perché è pertinente, breve, in italiano>"}.',
      'Non scrivere nulla fuori dal JSON.',
    ].join('\n');
  }

  function buildMessages(query, candidates) {
    return [{ role: 'user', content: buildPrompt(query, candidates) }];
  }

  function stripFence(t) {
    let s = String(t == null ? '' : t).trim();
    if (s.startsWith('```')) s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    return s;
  }

  // Tollera testo prima e dopo e i recinti markdown.
  function extractJson(text) {
    const s = stripFence(text);
    try { return JSON.parse(s); } catch (_) { /* proviamo a ritagliare */ }
    const aStart = s.indexOf('[');
    const aEnd = s.lastIndexOf(']');
    if (aStart >= 0 && aEnd > aStart) {
      try { return JSON.parse(s.slice(aStart, aEnd + 1)); } catch (_) {}
    }
    const oStart = s.indexOf('{');
    const oEnd = s.lastIndexOf('}');
    if (oStart >= 0 && oEnd > oStart) {
      try { return JSON.parse(s.slice(oStart, oEnd + 1)); } catch (_) {}
    }
    return null;
  }

  // Filtra agli id realmente esistenti e toglie i duplicati; se la risposta non è
  // interpretabile torna [] e il chiamante ripiega sulle parole.
  function parseRanking(modelText, validIds) {
    const valid = validIds instanceof Set
      ? validIds
      : new Set((Array.isArray(validIds) ? validIds : []).map(String));
    let parsed = extractJson(modelText);
    if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
      parsed = parsed.results || parsed.feedbacks || parsed.ranking || parsed.items || parsed.matches || null;
    }
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    const out = [];
    for (const el of parsed) {
      let id = null;
      let reason = '';
      if (typeof el === 'string') {
        id = el;
      } else if (el && typeof el === 'object') {
        id = el.id != null ? el.id : (el.feedbackId != null ? el.feedbackId : el._id);
        reason = el.reason || el.motivo || el.why || '';
      }
      if (id == null) continue;
      id = String(id);
      if (!valid.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, reason: String(reason || '').trim() });
    }
    return out;
  }

  // Ripiego per PAROLE: titolo peso 3, testo peso 1, e solo i feedback con almeno una
  // parola in comune. Usato quando il modello non c'è o la sua risposta non è valida.
  function keywordSearch(feedbacks, query) {
    const tokens = String(query || '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 2);
    const list = Array.isArray(feedbacks) ? feedbacks : [];
    if (!tokens.length) return [];
    const scored = [];
    for (const fb of list) {
      const id = fb && (fb._id || fb.id);
      if (!id) continue;
      const title = titleOf(fb).toLowerCase();
      const text = String((fb && fb.text) || '').toLowerCase();
      let score = 0;
      const matched = [];
      for (const tok of tokens) {
        if (title.includes(tok)) { score += 3; if (!matched.includes(tok)) matched.push(tok); }
        else if (text.includes(tok)) { score += 1; if (!matched.includes(tok)) matched.push(tok); }
      }
      if (score > 0) {
        scored.push({
          id: String(id), score,
          reason: matched.length ? `Contiene: ${matched.join(', ')}` : '',
        });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => ({ id: s.id, reason: s.reason }));
  }

  // ── Classificatore (#1118) ─────────────────────────────────────────────────
  // Un classificatore (Jev) non ordina un elenco: risponde a domande chiuse con una probabilità. A ogni feedback si
  // fa la stessa domanda, «è quello che cerca?», e le richieste partono in parallelo. Ogni domanda porta il SUO
  // feedback e la ricerca sta nello stato condiviso: così nessuna risposta dipende dal trovare il feedback giusto in
  // un elenco. Un tetto di richieste al minuto c'è, quindi ne vanno più d'uno per richiesta.
  const CLASSIFIER = Object.freeze({ BATCH: 16, PARALLEL: 8, THRESHOLD: 0.5, MAX_TEXT: 1000 });

  const CLASSIFIER_CONTEXT = 'Chi gestisce Filo cerca, fra i feedback che ha ricevuto, quello descritto in «ricerca». '
    + 'Lo descrive con parole sue: spesso è un ricordo vago, non le parole scritte nel feedback.';
  const CLASSIFIER_QUESTION = 'Il feedback qui sotto è quello che la ricerca descrive, o parla della stessa cosa?';
  const CLASSIFIER_CRITERIA = Object.freeze({
    true: 'Parla di quello che la ricerca descrive, anche con parole diverse.',
    false: 'Parla d\'altro, o con la ricerca ha in comune solo qualche parola.',
  });

  function tokensOf(query) {
    return String(query || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2);
  }

  // Prima i feedback che hanno parole in comune con la ricerca: sono i più probabili, e così i primi risultati
  // arrivano subito. Gli altri restano nell'ordine della lista.
  function classifierOrder(candidates, query) {
    const list = Array.isArray(candidates) ? candidates.slice() : [];
    const tokens = tokensOf(query);
    if (!tokens.length) return list;
    const score = (c) => {
      const t = String((c && c.title) || '').toLowerCase();
      const x = String((c && c.text) || '').toLowerCase();
      let n = 0;
      for (const tok of tokens) n += t.includes(tok) ? 3 : (x.includes(tok) ? 1 : 0);
      return n;
    };
    return list.map((c, i) => ({ c, i, s: score(c) }))
      .sort((a, b) => (b.s - a.s) || (a.i - b.i))
      .map((e) => e.c);
  }

  // Le richieste per il classificatore: [{ state, questions, ids }], dove `ids[k]` è il feedback della domanda
  // `f<k+1>`. I nomi delle domande li sceglie Filo, mai l'id di un feedback.
  function buildDecisionRequests(query, candidates, batch) {
    const q = String(query || '').trim();
    const per = Math.max(1, Math.floor(Number(batch) || CLASSIFIER.BATCH));
    const list = (Array.isArray(candidates) ? candidates : []).filter((c) => c && c.id != null && c.id !== '');
    const out = [];
    for (let i = 0; i < list.length; i += per) {
      const gruppo = list.slice(i, i + per);
      const questions = {};
      gruppo.forEach((c, k) => {
        const testo = String(c.text || '').replace(/\s+/g, ' ').trim().slice(0, CLASSIFIER.MAX_TEXT);
        questions[`f${k + 1}`] = {
          type: 'noul',
          instructions: `${CLASSIFIER_QUESTION}\n\nTitolo: ${String(c.title || '(senza titolo)')}\nTesto: ${testo || '(vuoto)'}`,
          criteria: { ...CLASSIFIER_CRITERIA },
        };
      });
      out.push({ state: { contesto: CLASSIFIER_CONTEXT, ricerca: q }, questions, ids: gruppo.map((c) => String(c.id)) });
    }
    return out;
  }

  // La probabilità che la risposta sia «sì», fra 0 e 1; null se la risposta non ne porta una.
  function probabilityOf(answer) {
    if (answer === true) return 1;
    if (answer === false) return 0;
    if (typeof answer === 'number') return Number.isFinite(answer) ? Math.min(1, Math.max(0, answer)) : null;
    if (!answer || typeof answer !== 'object') return null;
    for (const k of ['noul', 'probability', 'value', 'score']) {
      const v = answer[k];
      if (typeof v === 'number' && Number.isFinite(v)) return Math.min(1, Math.max(0, v));
      if (typeof v === 'boolean') return v ? 1 : 0;
    }
    return null;
  }

  // Le risposte di una richiesta → { hits: [{ id, p }] sopra la soglia, letti, senza: quanti non hanno risposta }.
  function hitsFromAnswers(request, answers, threshold) {
    const soglia = Number.isFinite(Number(threshold)) ? Number(threshold) : CLASSIFIER.THRESHOLD;
    const ids = (request && Array.isArray(request.ids)) ? request.ids : [];
    const a = answers && typeof answers === 'object' ? answers : {};
    const hits = [];
    let senza = 0;
    ids.forEach((id, k) => {
      const nome = `f${k + 1}`;
      const p = Object.prototype.hasOwnProperty.call(a, nome) ? probabilityOf(a[nome]) : null;
      if (p == null) { senza++; return; }
      if (p >= soglia) hits.push({ id, p });
    });
    return { hits, letti: ids.length - senza, senza };
  }

  // Dal più probabile al meno; a parità resta l'ordine in cui sono arrivati.
  function rankHits(hits) {
    return (Array.isArray(hits) ? hits : []).map((h, i) => ({ h, i }))
      .sort((a, b) => (b.h.p - a.h.p) || (a.i - b.i))
      .map((e) => e.h);
  }

  global.SN_MANAGE_SEARCH = {
    MAX_TEXT,
    CLASSIFIER,
    buildCandidates,
    buildPrompt,
    buildMessages,
    parseRanking,
    keywordSearch,
    classifierOrder,
    buildDecisionRequests,
    probabilityOf,
    hitsFromAnswers,
    rankHits,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
