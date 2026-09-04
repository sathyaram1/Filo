// Logica PURA per la lettura ad alta voce a "blocchi" (chunk) e per mappare
// l'avanzamento della riproduzione alla parola corrente (evidenziazione).
//
// Sta in shared/ perché è logica senza DOM né rete: il content script
// (src/content/tts.js) la usa per spezzare il testo selezionato in frasi e per
// sapere quale parola evidenziare; i test unitari (tests/unit/ttsChunk.test.mjs)
// la esercitano senza aprire Electron.
//
// Perché spezzare in chunk: il modello di sintesi vocale sintetizza TUTTO l'audio
// prima di rispondere, quindi su un testo lungo l'attesa iniziale è di parecchi
// secondi. Sintetizzando prima una frase corta e suonandola mentre si prepara
// la successiva, il tempo che precede la PRIMA parola crolla.

(function (global) {
  'use strict';

  // Tokenizza una stringa in "parole" (run di non-spazi), con gli offset di
  // carattere [start, end) nella stringa originale. Gli offset servono al
  // content script per ricostruire i Range DOM corrispondenti.
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

  // Una parola "chiude una frase" se finisce con punteggiatura forte
  // (eventualmente seguita da una virgoletta/parentesi di chiusura).
  function endsSentence(word) {
    return /[.!?…।。！？]["'»”’)\]]?$/.test(String(word || ''));
  }

  // Raggruppa i token (parole) in chunk da sintetizzare separatamente.
  // Ritorna un array di { from, to, start, end }:
  //   - from/to: indici (inclusivi) nel vettore token
  //   - start/end: offset di carattere nel testo completo (per fare lo slice)
  //
  // Strategia: si accumulano parole finché o (a) si supera il cap "morbido" E
  // l'ultima parola chiude una frase, oppure (b) si supera il cap "duro"
  // (taglio forzato anche a metà frase, per non far crescere troppo il primo
  // pezzo). Il PRIMO chunk usa un cap più piccolo (firstCap) così la prima
  // parola si sente prima possibile.
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

  // Dato l'avanzamento di un chunk (frazione 0..1 della durata dell'audio),
  // stima quale token sta venendo letto. Mappa la frazione a un offset di
  // carattere dentro lo span del chunk e ritorna l'indice globale dell'ultima
  // parola iniziata prima di quell'offset. È una STIMA: l'API TTS non dà tempi
  // per-parola, quindi l'evidenziazione approssima distribuendo le parole in
  // modo proporzionale alla loro lunghezza nel testo.
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

  // Per il fallback voce-del-browser: l'evento `onboundary` dà l'indice di
  // carattere nel testo pronunciato. Ritorna l'indice della parola che contiene
  // (o precede immediatamente) quel carattere.
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
