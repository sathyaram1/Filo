// La trascrizione di un audio o di un video intero (#1815): decodifica a 16 kHz mono, pezzi contigui per il modello della
// dettatura, tetti col loro numero. Gira dove c'è WebAudio (la finestra nascosta del main); i pezzi sono logica pura,
// sentinella in tests/unit/trascriviMedia.test.mjs. Chi chiama il modello è src/main/services/trascriviMedia.js.

(function (global) {
  'use strict';

  const RATE = 16000;
  // La finestra su cui lavorano i modelli tipo Whisper: un pezzo più lungo lo taglierebbero loro, a caso.
  const PEZZO_S = 30;
  // Il taglio cade sul tratto più silenzioso degli ultimi secondi del pezzo, così una parola non resta a metà.
  const CERCA_S = 5;
  const FINESTRA_S = 0.2;
  // Un resto più corto si attacca al pezzo prima: da solo sarebbe una chiamata per un respiro.
  const RESTO_MIN_S = 2;
  // Tetti per la memoria della decodifica (16 kHz per canale, in float): tre ore di podcast ci stanno con margine.
  const MAX_BYTE = 150 * 1024 * 1024;
  const MAX_S = 3 * 3600;

  function energia(c, da, a) {
    let s = 0;
    for (let i = da; i < a; i++) s += c[i] * c[i];
    return s;
  }

  // [{ da, a }] in campioni: contigui, dal primo all'ultimo, ognuno al più PEZZO_S + RESTO_MIN_S secondi.
  function pezzi(campioni, rate = RATE, opz = {}) {
    const n = campioni ? campioni.length : 0;
    if (!n || !(rate > 0)) return [];
    const passo = Math.max(1, Math.round((opz.pezzoS || PEZZO_S) * rate));
    const cerca = Math.min(passo - 1, Math.round((opz.cercaS ?? CERCA_S) * rate));
    const fin = Math.max(1, Math.round(FINESTRA_S * rate));
    const restoMin = Math.round((opz.restoMinS ?? RESTO_MIN_S) * rate);
    const out = [];
    let da = 0;
    while (n - da > passo) {
      // A parità di silenzio vince il taglio più tardi: un audio senza pause si taglia ogni PEZZO_S esatti.
      let taglio = da + passo;
      let minima = Infinity;
      for (let fine = da + passo; fine - fin >= da + passo - cerca; fine -= Math.max(1, fin >> 1)) {
        const e = energia(campioni, fine - fin, fine);
        if (e < minima) { minima = e; taglio = fine; }
      }
      if (n - taglio < restoMin) break;
      out.push({ da, a: taglio });
      da = taglio;
    }
    out.push({ da, a: n });
    return out;
  }

  // Il WAV PCM 16 bit di un pezzo, in base64: lo stesso formato degli spezzoni della dettatura.
  function wavDelPezzo(campioni, rate, pezzo) {
    const Seg = global.SN_DICTATION_SEGMENTER;
    const parte = campioni.subarray(pezzo.da, pezzo.a);
    return Seg.bytesToBase64(Seg.pcm16ToWav(Seg.floatToInt16(parte), rate));
  }

  function errore(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  const mb = (b) => Math.round(b / (1024 * 1024)).toLocaleString('it-IT', { useGrouping: true });
  const ore = (s) => (s / 3600).toLocaleString('it-IT', { maximumFractionDigits: 1, useGrouping: true });

  // I messaggi arrivano a chi usa Filo così come sono (SN_CHAT_ERRORS li lascia passare): dicono il numero e cosa fare.
  function troppoGrande(byte) {
    return errore('MEDIA_TROPPO', `Il file è di ${mb(byte)} MB: Filo ne trascrive fino a ${mb(MAX_BYTE)} MB alla volta. Taglialo in parti più corte e trascrivile una per una.`);
  }
  function troppoLungo(secondi) {
    return errore('MEDIA_TROPPO', `L'audio dura ${ore(secondi)} ore: Filo ne trascrive fino a ${ore(MAX_S)} ore alla volta. Taglialo in parti più corte e trascrivile una per una.`);
  }

  // Byte di un file audio o video → campioni mono a 16 kHz. decodeAudioData riporta al ritmo del contesto e in Chromium
  // legge ogg/opus, mp3, aac/mp4, webm e wav, anche la traccia audio di un video.
  async function decodifica(byte) {
    const Ctx = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    if (!Ctx) throw errore('MEDIA_ILLEGGIBILE', 'Qui manca il decodificatore audio.');
    if (byte.byteLength > MAX_BYTE) throw troppoGrande(byte.byteLength);
    const copia = byte.buffer.slice(byte.byteOffset, byte.byteOffset + byte.byteLength);
    let buf;
    try {
      buf = await new Ctx(1, 1, RATE).decodeAudioData(copia);
    } catch (_) {
      throw errore('MEDIA_ILLEGGIBILE', 'Il file non contiene un audio che si possa leggere: forse non è un audio o un video, o il formato non è supportato.');
    }
    if (buf.duration > MAX_S) throw troppoLungo(buf.duration);
    const canali = buf.numberOfChannels;
    const mono = new Float32Array(buf.length);
    for (let c = 0; c < canali; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) mono[i] += d[i] / canali;
    }
    return mono;
  }

  global.SN_TRASCRIVI_MEDIA = {
    RATE, PEZZO_S, RESTO_MIN_S, MAX_BYTE, MAX_S,
    pezzi, wavDelPezzo, decodifica, troppoGrande, troppoLungo, errore,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
