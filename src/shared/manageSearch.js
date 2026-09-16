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

  // Salta i feedback senza id: non sarebbero selezionabili.
  function buildCandidates(feedbacks) {
    const list = Array.isArray(feedbacks) ? feedbacks : [];
    const out = [];
    for (const fb of list) {
      const id = fb && (fb._id || fb.id);
      if (!id) continue;
      const text = String((fb && fb.text) || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
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

  global.SN_MANAGE_SEARCH = {
    MAX_TEXT,
    buildCandidates,
    buildPrompt,
    buildMessages,
    parseRanking,
    keywordSearch,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
