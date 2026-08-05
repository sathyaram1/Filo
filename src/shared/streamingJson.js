// Estrattore INCREMENTALE del primo campo-stringa (default "text") di un oggetto
// JSON che sta arrivando in streaming. Serve alla chat della home: la risposta
// del modello è un JSON `{ "text": "...", "actions": [...] }` e finora andava
// ricevuta PER INTERO prima di poter mostrare anche solo la prima parola (le
// azioni viaggiano nello stesso blocco). Qui decodifichiamo il valore del campo
// "text" mano a mano che i delta arrivano, emettendo solo i caratteri ormai
// SICURI (mai metà di un escape), così il testo può comparire mentre viene
// scritto e le azioni restano in coda (si parsano a fine turno, invariato).
//
// Logica PURA (nessun Electron / IPC): unit-testata in
// tests/unit/streamingJson.test.mjs.

(function (global) {
  'use strict';

  const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

  // Decodifica il corpo di una stringa JSON a partire da raw[start] (start =
  // indice del carattere SUBITO DOPO la virgoletta di apertura). Ritorna
  //   { text, closed }
  // dove `text` sono i caratteri già decodificati e DEFINITIVI (si ferma prima
  // di un escape troncato, così non emettiamo mai metà di \n o di \uXXXX) e
  // `closed` è true quando ha incontrato la virgoletta di chiusura non-escapata.
  // La funzione è "prefix-stable": allungando `raw` il testo decodificato può
  // solo estendersi, mai cambiare i caratteri già prodotti — è ciò che permette
  // di emettere i delta con una semplice slice.
  function decodeStringPrefix(raw, start) {
    let out = '';
    let i = start;
    const n = raw.length;
    while (i < n) {
      const ch = raw[i];
      if (ch === '"') return { text: out, closed: true };
      if (ch === '\\') {
        if (i + 1 >= n) break; // escape troncato in coda → fermati, non emettere
        const esc = raw[i + 1];
        if (esc === 'u') {
          if (i + 6 > n) break; // servono \uXXXX completi
          const hex = raw.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) break; // \u malformato → fermati (ripiego a fine turno)
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        out += Object.prototype.hasOwnProperty.call(ESCAPES, esc) ? ESCAPES[esc] : esc;
        i += 2;
        continue;
      }
      out += ch;
      i += 1;
    }
    return { text: out, closed: false };
  }

  // Trova l'indice del primo carattere del VALORE del campo `field`, cioè subito
  // dopo la sua virgoletta di apertura. Ritorna -1 se `"field":"` non è ancora
  // arrivato per intero (allora non si emette nulla e si continua ad aspettare).
  // Tollera spazi attorno ai due punti e un eventuale recinto ```json iniziale
  // (il match cerca solo la chiave, ignora ciò che la precede).
  function findFieldStart(raw, field) {
    const re = new RegExp('"' + field + '"\\s*:\\s*"');
    const m = re.exec(raw);
    return m ? m.index + m[0].length : -1;
  }

  // Streamer con stato: push(chunk) accumula il grezzo e ritorna
  //   { delta, done }
  // con `delta` = i NUOVI caratteri visibili decodificati da questo chunk
  // (stringa vuota se non ce ne sono di sicuri) e `done` = true quando la
  // stringa del campo si è chiusa. reset() riparte da zero: serve quando il
  // provider cade a metà e il router ripiega — il testo già scritto va BUTTATO
  // e riscritto dal tentativo nuovo, non accodato (#273 lato client).
  function createTextStreamer(field) {
    const key = field || 'text';
    let raw = '';
    let start = -1;
    let emitted = 0; // quanti caratteri decodificati abbiamo già restituito
    let done = false;
    return {
      push(chunk) {
        if (done) return { delta: '', done: true };
        raw += (chunk == null ? '' : String(chunk));
        if (start < 0) {
          start = findFieldStart(raw, key);
          if (start < 0) return { delta: '', done: false };
        }
        const { text, closed } = decodeStringPrefix(raw, start);
        let delta = '';
        if (text.length > emitted) {
          delta = text.slice(emitted);
          emitted = text.length;
        }
        if (closed) done = true;
        return { delta, done };
      },
      reset() { raw = ''; start = -1; emitted = 0; done = false; },
      // Testo decodificato finora (comodo per test/debug).
      text() { return start < 0 ? '' : decodeStringPrefix(raw, start).text; },
    };
  }

  global.SN_STREAM_JSON = { createTextStreamer, decodeStringPrefix, findFieldStart };
})(typeof globalThis !== 'undefined' ? globalThis : self);
