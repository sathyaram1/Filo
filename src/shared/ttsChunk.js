// Logica PURA della lettura ad alta voce a blocchi e della parola da evidenziare
// (niente DOM né rete: la usa src/content/tts.js). Si spezza in chunk perché la sintesi
// produce TUTTO l'audio prima di rispondere: suonando una frase corta mentre si prepara
// la successiva, l'attesa prima della PRIMA parola crolla.

(function (global) {
  'use strict';

  // Gli offset di carattere [start, end) servono al content script per ricostruire i
  // Range DOM corrispondenti.
  function tokenize(text) {
    const tokens = [];
    const s = String(text == null ? '' : text);
    const re = /\S+/g;
    let m;
    while ((m = re.exec(s))) {
      tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
    }
    return tokens;
  }

  // Chiude una frase: punteggiatura forte, eventualmente seguita da una virgoletta o
  // parentesi di chiusura.
  function endsSentence(word) {
    return /[.!?…।。！？]["'»”’)\]]?$/.test(String(word || ''));
  }

  // Ritorna { from, to (indici token, inclusivi), start, end (offset nel testo) }.
  // Cap morbido: si taglia solo a fine frase; cap duro: taglio forzato anche a metà,
  // per non far crescere troppo il primo pezzo. Il primo chunk ha un cap più piccolo
  // (firstCap), così la prima parola si sente prima possibile.
  function chunkTokens(tokens, opts) {
    const o = opts || {};
    const firstCap = o.firstCap || 140;
    const softCap = o.softCap || 220;
    const hardCap = o.hardCap || 420;
    const chunks = [];
    if (!tokens || !tokens.length) return chunks;

    let from = 0;
    for (let i = 0; i < tokens.length; i++) {
      const cap = chunks.length === 0 ? firstCap : softCap;
      const len = tokens[i].end - tokens[from].start;
      const last = i === tokens.length - 1;
      const closeHere =
        last ||
        (endsSentence(tokens[i].text) && len >= cap) ||
        len >= hardCap;
      if (closeHere) {
        chunks.push({ from, to: i, start: tokens[from].start, end: tokens[i].end });
        from = i + 1;
      }
    }
    return chunks;
  }

  // È una STIMA: l'API TTS non dà tempi per-parola, quindi l'evidenziazione distribuisce
  // le parole in proporzione alla loro lunghezza nel testo.
  function tokenIndexAtFraction(tokens, from, to, fraction) {
    if (!tokens || !tokens.length) return -1;
    const a = Math.max(0, Math.min(from, tokens.length - 1));
    const b = Math.max(a, Math.min(to, tokens.length - 1));
    const f = Math.max(0, Math.min(1, Number(fraction) || 0));
    const span = tokens[b].end - tokens[a].start;
    const target = tokens[a].start + f * span;
    let idx = a;
    for (let k = a; k <= b; k++) {
      if (tokens[k].start <= target) idx = k; else break;
    }
    return idx;
  }

  // Ripiego voce-del-browser: `onboundary` dà l'indice di carattere nel testo pronunciato.
  function charIndexToToken(tokens, charIndex) {
    if (!tokens || !tokens.length) return -1;
    const c = Number(charIndex) || 0;
    let idx = 0;
    for (let k = 0; k < tokens.length; k++) {
      if (tokens[k].start <= c) idx = k; else break;
    }
    return idx;
  }

  global.SN_TTS_CHUNK = {
    tokenize,
    endsSentence,
    chunkTokens,
    tokenIndexAtFraction,
    charIndexToToken,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
