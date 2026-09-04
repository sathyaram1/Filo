// Voci del modello di lettura ad alta voce.
//
// Il modello di lettura a pesi aperti (Kokoro) ha un catalogo fisso di voci,
// una manciata per lingua; l'id della voce è quello che l'endpoint accetta nel
// campo `voice`. La prima lettera dell'id dice la lingua (a = inglese
// americano, b = inglese britannico, e = spagnolo, f = francese, h = hindi,
// i = italiano, j = giapponese, p = portoghese, z = cinese), la seconda il
// genere (f/m). Il catalogo è quello che il router riporta nel campo
// `supported_voices` del modello: se un giorno cambia modello, cambia questa
// tabella, e le Preferenze cambiano da sole.
//
// Convenzione IIFE su globalThis come gli altri moduli shared/*.

(function (global) {
  'use strict';

  const LANG_OF_PREFIX = {
    a: 'en', b: 'en', e: 'es', f: 'fr', h: 'hi', i: 'it', j: 'ja', p: 'pt', z: 'zh',
  };

  const IDS = [
    'af_alloy', 'af_aoede', 'af_bella', 'af_heart', 'af_jessica', 'af_kore', 'af_nicole',
    'af_nova', 'af_river', 'af_sarah', 'af_sky', 'am_adam', 'am_echo', 'am_eric',
    'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa',
    'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily', 'bm_daniel', 'bm_fable',
    'bm_george', 'bm_lewis',
    'ef_dora', 'em_alex', 'em_santa',
    'ff_siwis',
    'hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi',
    'if_sara', 'im_nicola',
    'jf_alpha', 'jf_gongitsune', 'jf_nezumi', 'jf_tebukuro', 'jm_kumo',
    'pf_dora', 'pm_alex', 'pm_santa',
    'zf_xiaobei', 'zf_xiaoni', 'zf_xiaoxiao', 'zf_xiaoyi', 'zm_yunjian', 'zm_yunxi',
    'zm_yunxia', 'zm_yunyang',
  ];

  // Voce preferita per lingua: la prima che suona più naturale nel catalogo.
  const DEFAULT_BY_LANG = {
    it: 'if_sara', en: 'af_heart', es: 'ef_dora', fr: 'ff_siwis', hi: 'hf_alpha',
    ja: 'jf_alpha', pt: 'pf_dora', zh: 'zf_xiaoxiao',
  };

  const LANG_LABELS = {
    it: 'italiano', en: 'inglese', es: 'spagnolo', fr: 'francese', hi: 'hindi',
    ja: 'giapponese', pt: 'portoghese', zh: 'cinese',
  };

  function labelOf(id) {
    const name = id.split('_')[1] || id;
    const pretty = name.charAt(0).toUpperCase() + name.slice(1);
    const variant = id[0] === 'b' ? ' (UK)' : (id[0] === 'a' ? ' (US)' : '');
    return pretty + variant;
  }

  const VOICES = IDS.map((id) => ({
    id,
    lang: LANG_OF_PREFIX[id[0]] || 'en',
    gender: id[1] === 'm' ? 'm' : 'f',
    label: labelOf(id),
  }));

  // 'it-IT' → 'it'. PURA.
  function langOf(tag) {
    return String(tag == null ? '' : tag).trim().toLowerCase().split(/[-_]/)[0];
  }

  function isKnownVoice(id) {
    return VOICES.some((v) => v.id === id);
  }

  // Voce di partenza per una lingua; se la lingua non è nel catalogo si legge
  // in inglese, che è la lingua che il modello conosce meglio. PURA.
  function defaultVoiceFor(lang) {
    return DEFAULT_BY_LANG[langOf(lang)] || DEFAULT_BY_LANG.en;
  }

  // Lingua di una voce ('if_sara' → 'it'). PURA.
  function langOfVoice(id) {
    const v = VOICES.find((x) => x.id === id);
    return v ? v.lang : '';
  }

  // Voci raggruppate per lingua, per una tendina: [{ lang, label, voices }].
  function groupedByLang() {
    const order = Object.keys(DEFAULT_BY_LANG);
    return order.map((lang) => ({
      lang,
      label: LANG_LABELS[lang] || lang,
      voices: VOICES.filter((v) => v.lang === lang),
    }));
  }

  global.SN_TTS_VOICES = { VOICES, defaultVoiceFor, langOf, langOfVoice, isKnownVoice, groupedByLang, LANG_LABELS };
})(typeof globalThis !== 'undefined' ? globalThis : self);
