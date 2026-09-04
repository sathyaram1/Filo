// Dettatura "in diretta": spezza il flusso del microfono in segmenti di parlato.
//
// Il modello di trascrizione lavora su spezzoni chiusi (non su un flusso), ma
// chi detta vuole vedere il testo comparire mentre parla. Il compromesso: il
// microfono viene ascoltato a blocchi, si riconosce quando c'è voce (energia
// del segnale sopra il rumore di fondo), e:
//   - ogni `interimEveryMs` di parlato si manda lo spezzone corrente com'è →
//     trascrizione PROVVISORIA, mostrata ma non ancora inserita;
//   - a una pausa di `silenceMs`, o quando lo spezzone supera `maxSegmentMs`,
//     lo spezzone si chiude → trascrizione DEFINITIVA, inserita nel campo.
// Il tempo si misura sui campioni (non sull'orologio): stessa sequenza di
// campioni, stessi eventi — così è verificabile in un unit test.
//
// Qui c'è solo logica pura: niente microfono, niente rete. La cattura audio
// sta nel content script (src/content/tts.js), la trascrizione nel main.
//
// Convenzione IIFE su globalThis come gli altri moduli shared/*.

(function (global) {
  'use strict';

  // Ricampiona un buffer float32 mono da `fromRate` a `toRate` facendo la
  // media dei campioni coperti: per la voce a 16 kHz è più che sufficiente.
  function downsample(samples, fromRate, toRate) {
    if (!samples || !samples.length) return new Float32Array(0);
    if (!fromRate || !toRate || fromRate === toRate) return Float32Array.from(samples);
    const ratio = fromRate / toRate;
    const n = Math.floor(samples.length / ratio);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
      let sum = 0;
      for (let j = start; j < end; j++) sum += samples[j];
      out[i] = sum / (end - start);
    }
    return out;
  }

  function floatToInt16(samples) {
    const out = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  // WAV PCM 16-bit mono. Ritorna un Uint8Array (intestazione + campioni).
  function pcm16ToWav(int16, sampleRate) {
    const n = int16.length * 2;
    const buffer = new ArrayBuffer(44 + n);
    const view = new DataView(buffer);
    let off = 0;
    const writeStr = (s) => { for (let i = 0; i < s.length; i++) view.setUint8(off++, s.charCodeAt(i)); };
    const writeU32 = (v) => { view.setUint32(off, v, true); off += 4; };
    const writeU16 = (v) => { view.setUint16(off, v, true); off += 2; };
    writeStr('RIFF'); writeU32(36 + n); writeStr('WAVE');
    writeStr('fmt '); writeU32(16); writeU16(1); writeU16(1);
    writeU32(sampleRate); writeU32(sampleRate * 2); writeU16(2); writeU16(16);
    writeStr('data'); writeU32(n);
    for (let i = 0; i < int16.length; i++) { view.setInt16(off, int16[i], true); off += 2; }
    return new Uint8Array(buffer);
  }

  // Base64 di un Uint8Array, in pagina (btoa) o in Node (Buffer).
  function bytesToBase64(bytes) {
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
      return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
    }
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  function rms(samples) {
    if (!samples.length) return 0;
    let s = 0;
    for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i];
    return Math.sqrt(s / samples.length);
  }

  function concat(chunks, total) {
    const out = new Float32Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }

  // Segmentatore. Opzioni (tutte in millisecondi salvo sampleRate):
  //   sampleRate      frequenza dei campioni che riceve push()
  //   frameMs         granularità dell'analisi (energia calcolata per blocco)
  //   interimEveryMs  ogni quanto parlato mandare una trascrizione provvisoria
  //   silenceMs       pausa che chiude uno spezzone
  //   minSpeechMs     sotto questa quantità di voce lo spezzone si butta
  //   maxSegmentMs    oltre questa durata lo spezzone si chiude comunque
  //   leadMs          silenzio tenuto PRIMA della prima parola (attacco pulito)
  //   onInterim/onFinal({ samples, sampleRate, ms, speechMs })
  function createSegmenter(opts) {
    const o = Object.assign({
      sampleRate: 16000, frameMs: 50, interimEveryMs: 1200, silenceMs: 700,
      minSpeechMs: 400, maxSegmentMs: 15000, leadMs: 300,
      onInterim: null, onFinal: null,
    }, opts || {});
    const frameLen = Math.max(1, Math.round(o.sampleRate * o.frameMs / 1000));

    let pending = new Float32Array(0);   // campioni non ancora analizzati
    let chunks = [];                     // blocchi dello spezzone corrente
    let total = 0;                       // campioni nello spezzone
    let hadSpeech = false;
    let speechMs = 0;
    let silenceRun = 0;
    let sinceInterim = 0;
    let interimDirty = false;            // voce nuova dopo l'ultima provvisoria
    // Rumore di fondo: media mobile dell'energia dei blocchi senza voce. Parte
    // bassa (una stanza silenziosa) e si adatta; la soglia sta sopra di un
    // margine fisso, così un ventilatore non diventa "parlato".
    let noise = 0.004;
    const emitted = { interim: 0, final: 0 };

    function threshold() { return Math.max(0.012, noise * 3.5); }

    function reset() {
      chunks = []; total = 0; hadSpeech = false; speechMs = 0;
      silenceRun = 0; sinceInterim = 0; interimDirty = false;
    }

    function segment() {
      return {
        samples: concat(chunks, total),
        sampleRate: o.sampleRate,
        ms: Math.round(total / o.sampleRate * 1000),
        speechMs,
      };
    }

    function emitFinal() {
      if (!hadSpeech || speechMs < o.minSpeechMs) { reset(); return; }
      const seg = segment();
      emitted.final++;
      reset();
      if (o.onFinal) o.onFinal(seg);
    }

    function emitInterim() {
      const seg = segment();
      emitted.interim++;
      sinceInterim = 0;
      interimDirty = false;
      if (o.onInterim) o.onInterim(seg);
    }

    // Tiene solo la coda dello spezzone (gli ultimi `ms`), quando finora è
    // stato solo silenzio: non serve mandare al modello secondi di niente.
    function trimToTail(ms) {
      const keep = Math.round(o.sampleRate * ms / 1000);
      if (total <= keep) return;
      const all = concat(chunks, total);
      const tail = all.subarray(all.length - keep);
      chunks = [Float32Array.from(tail)];
      total = tail.length;
    }

    function analyze(frame) {
      const e = rms(frame);
      const speech = e > threshold();
      chunks.push(frame);
      total += frame.length;
      if (speech) {
        hadSpeech = true;
        speechMs += o.frameMs;
        silenceRun = 0;
        sinceInterim += o.frameMs;
        interimDirty = true;
      } else {
        // Il rumore di fondo si aggiorna solo fuori dal parlato.
        noise = noise * 0.95 + e * 0.05;
        silenceRun += o.frameMs;
        if (!hadSpeech) { trimToTail(o.leadMs); return; }
      }
      const segMs = total / o.sampleRate * 1000;
      if (hadSpeech && silenceRun >= o.silenceMs) { emitFinal(); return; }
      if (hadSpeech && segMs >= o.maxSegmentMs) { emitFinal(); return; }
      if (hadSpeech && interimDirty && sinceInterim >= o.interimEveryMs) emitInterim();
    }

    // Riceve campioni float32 mono a `sampleRate`.
    function push(samples) {
      if (!samples || !samples.length) return;
      const merged = new Float32Array(pending.length + samples.length);
      merged.set(pending, 0);
      merged.set(samples, pending.length);
      let off = 0;
      while (merged.length - off >= frameLen) {
        analyze(merged.subarray(off, off + frameLen));
        off += frameLen;
      }
      pending = Float32Array.from(merged.subarray(off));
    }

    // Fine registrazione: quello che resta, se contiene voce, è definitivo.
    function flush() {
      if (pending.length) { analyze(pending); pending = new Float32Array(0); }
      emitFinal();
    }

    function state() {
      return { hadSpeech, speechMs, silenceRun, segmentMs: Math.round(total / o.sampleRate * 1000), noise, emitted: { ...emitted } };
    }

    return { push, flush, state, options: o };
  }

  global.SN_DICTATION_SEGMENTER = {
    createSegmenter, downsample, floatToInt16, pcm16ToWav, bytesToBase64, rms,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
