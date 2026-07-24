// Logica PURA della ricerca "a senso" (semantica) della dashboard di gestione
// (filo://manage/). Vive separata dalla UI per essere unit-testabile senza
// aprire Electron:
//   - buildCandidates: riduce i feedback a { id, title, text } per il prompt;
//   - buildPrompt/buildMessages: costruisce la richiesta per il modello;
//   - parseRanking: interpreta (in modo tollerante) la classifica del modello;
//   - keywordSearch: ricerca per parole, il RIPIEGO quando il modello non c'è.
// IIFE su globalThis, come gli altri moduli condivisi (vedi CLAUDE.md).

(function (global) {
  'use strict';

  // Quanto testo di ogni feedback passiamo al modello: abbastanza per capirne il
  // senso, senza gonfiare il contesto (e il costo) con testi lunghissimi.
  const MAX_TEXT = 500;

  // Titolo mostrabile di un feedback: il nome esplicito, o il ripiego calcolato
  // dal testo (stesso criterio del resto della dashboard, via SN_FEEDBACK).
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

  // Prompt per il modello: descrive il compito (ordinare per SIGNIFICATO, non per
  // parole) e chiede una risposta SOLO JSON, così parseRanking la può leggere.
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

  // Estrae il primo valore JSON (array o oggetto) dalla risposta del modello,
  // tollerando testo prima/dopo e i recinti markdown.
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

  // Interpreta la classifica del modello → [{ id, reason }] nell'ordine dato,
  // filtrando agli id realmente esistenti (`validIds`) e senza duplicati. Se la
  // risposta non è interpretabile torna [] (il chiamante ripiegherà sulle parole).
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

  // Ripiego per PAROLE: tokenizza la query e punteggia titolo (peso 3) e testo
  // (peso 1) di ogni feedback. Torna solo i feedback con almeno una parola in
  // comune, dal più pertinente al meno. Usato quando il modello non è
  // disponibile o la sua risposta non è valida.
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
