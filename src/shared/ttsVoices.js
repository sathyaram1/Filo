// Voci della lettura ad alta voce. Ogni modello ha il SUO catalogo coi SUOI nomi:
// mandargli la voce di un altro è un 400 secco e la lettura ripiega senza dire perché.
// Un modello fuori catalogo non è un errore: gli si manda la voce scritta a mano o nessuna.
(function (global) {
  'use strict';

  // Kokoro: id = prefisso di due lettere (lingua/varietà + genere) + nome.
  const KOKORO_LANG_OF_PREFIX = {
    a: 'en', b: 'en', e: 'es', f: 'fr', h: 'hi', i: 'it', j: 'ja', p: 'pt', z: 'zh',
  };
  const KOKORO_IDS = [
    'if_sara', 'im_nicola',
    'af_heart', 'af_alloy', 'af_aoede', 'af_bella', 'af_jessica', 'af_kore', 'af_nicole',
    'af_nova', 'af_river', 'af_sarah', 'af_sky', 'am_adam', 'am_echo', 'am_eric',
    'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa',
    'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily', 'bm_daniel', 'bm_fable',
    'bm_george', 'bm_lewis',
    'ef_dora', 'em_alex', 'em_santa',
    'ff_siwis',
    'hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi',
    'jf_alpha', 'jf_gongitsune', 'jf_nezumi', 'jf_tebukuro', 'jm_kumo',
    'pf_dora', 'pm_alex', 'pm_santa',
    'zf_xiaoxiao', 'zf_xiaobei', 'zf_xiaoni', 'zf_xiaoyi', 'zm_yunjian', 'zm_yunxi',
    'zm_yunxia', 'zm_yunyang',
  ];
  function kokoroLabel(id) {
    const name = id.split('_')[1] || id;
    const pretty = name.charAt(0).toUpperCase() + name.slice(1);
    const variant = id[0] === 'b' ? ' (UK)' : (id[0] === 'a' ? ' (US)' : '');
    return pretty + variant;
  }
  const KOKORO_VOICES = KOKORO_IDS.map((id) => ({
    id,
    lang: KOKORO_LANG_OF_PREFIX[id[0]] || 'en',
    gender: id[1] === 'm' ? 'm' : 'f',
    label: kokoroLabel(id),
  }));

  // MAI-Voice, servito da Azure: `<lingua>-<Regione>-<Nome>Neural`. La prima voce di ogni
  // lingua è quella di partenza.
  const REGION_LABELS = {
    'en-US': 'US', 'en-GB': 'UK', 'es-MX': 'Messico', 'pt-PT': 'Portogallo',
  };
  const AZURE_LIST = [
    ['it-IT-ElsaNeural', 'f'], ['it-IT-IsabellaNeural', 'f'], ['it-IT-DiegoNeural', 'm'],
    ['it-IT-GiuseppeMultilingualNeural', 'm'],
    ['en-US-AvaNeural', 'f'], ['en-US-AndrewNeural', 'm'], ['en-US-EmmaNeural', 'f'],
    ['en-US-BrianNeural', 'm'], ['en-US-JennyNeural', 'f'],
    ['en-GB-SoniaNeural', 'f'], ['en-GB-RyanNeural', 'm'],
    ['es-ES-ElviraNeural', 'f'], ['es-ES-AlvaroNeural', 'm'], ['es-MX-DaliaNeural', 'f'],
    ['fr-FR-DeniseNeural', 'f'], ['fr-FR-HenriNeural', 'm'],
    ['de-DE-KatjaNeural', 'f'], ['de-DE-ConradNeural', 'm'],
    ['pt-BR-FranciscaNeural', 'f'], ['pt-BR-AntonioNeural', 'm'], ['pt-PT-RaquelNeural', 'f'],
    ['ja-JP-NanamiNeural', 'f'], ['ja-JP-KeitaNeural', 'm'],
    ['zh-CN-XiaoxiaoNeural', 'f'], ['zh-CN-YunxiNeural', 'm'],
    ['hi-IN-SwaraNeural', 'f'], ['hi-IN-MadhurNeural', 'm'],
    ['nl-NL-ColetteNeural', 'f'], ['pl-PL-ZofiaNeural', 'f'], ['ru-RU-SvetlanaNeural', 'f'],
    ['ko-KR-SunHiNeural', 'f'], ['ar-SA-ZariyahNeural', 'f'], ['tr-TR-EmelNeural', 'f'],
  ];
  const AZURE_VOICES = AZURE_LIST.map(([id, gender]) => {
    const m = /^([a-z]{2})-([A-Z]{2})-([A-Za-z]+?)(Multilingual)?Neural$/.exec(id);
    const lang = m ? m[1] : 'en';
    const region = m ? `${m[1]}-${m[2]}` : '';
    const name = m ? m[3] : id;
    const suffix = REGION_LABELS[region] ? ` (${REGION_LABELS[region]})` : '';
    return { id, lang, gender, label: name + suffix };
  });

  // Aura-2: id = `aura-2-<nome>-<lingua>`. Sottoinsieme del catalogo: il router elenca il
  // resto quando gli si manda una voce che non conosce.
  const AURA2_LIST = [
    ['cinzia', 'it', 'f'], ['cesare', 'it', 'm'], ['demetra', 'it', 'f'], ['dionisio', 'it', 'm'],
    ['thalia', 'en', 'f'], ['andromeda', 'en', 'f'], ['helena', 'en', 'f'], ['apollo', 'en', 'm'],
    ['arcas', 'en', 'm'], ['asteria', 'en', 'f'], ['athena', 'en', 'f'], ['luna', 'en', 'f'],
    ['orion', 'en', 'm'],
    ['celeste', 'es', 'f'], ['alvaro', 'es', 'm'], ['agustina', 'es', 'f'], ['antonia', 'es', 'f'],
    ['carina', 'es', 'f'], ['diana', 'es', 'f'],
    ['agathe', 'fr', 'f'],
    ['aurelia', 'de', 'f'], ['elara', 'de', 'f'],
    ['ama', 'ja', 'f'], ['ebisu', 'ja', 'm'],
    ['beatrix', 'nl', 'f'], ['cornelia', 'nl', 'f'], ['daphne', 'nl', 'f'],
  ];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const AURA2_VOICES = AURA2_LIST.map(([name, lang, gender]) => ({
    id: `aura-2-${name}-${lang}`, lang, gender, label: cap(name),
  }));

  // Deepgram Flux (deepgram/flux-tts): solo inglese.
  const FLUX_LIST = [
    ['alexis', 'f'], ['bree', 'f'], ['brittany', 'f'], ['brooke', 'f'], ['bruce', 'm'],
    ['cliff', 'm'], ['cole', 'm'], ['colin', 'm'], ['conor', 'm'], ['donovan', 'm'],
    ['drew', 'm'], ['elise', 'f'], ['gemma', 'f'], ['haley', 'f'], ['hannah', 'f'],
    ['heather', 'f'], ['jack', 'm'], ['kai', 'm'], ['kelsey', 'f'], ['kit', 'f'],
    ['maeve', 'f'], ['marcelo', 'm'], ['marcus', 'm'], ['meena', 'f'], ['meghan', 'f'],
    ['miles', 'm'], ['naveen', 'm'], ['paige', 'f'], ['priya', 'f'], ['rufus', 'm'],
    ['sean', 'm'], ['sharon', 'f'], ['sienna', 'f'], ['tanner', 'm'], ['wade', 'm'], ['wes', 'm'],
  ];
  const FLUX_VOICES = FLUX_LIST.map(([name, gender]) => ({
    id: `flux-${name}-en`, lang: 'en', gender, label: cap(name),
  }));

  // Orpheus (canopylabs/orpheus-*): solo inglese.
  const ORPHEUS_VOICES = [
    ['tara', 'f'], ['leah', 'f'], ['jess', 'f'], ['leo', 'm'], ['dan', 'm'],
    ['mia', 'f'], ['zac', 'm'], ['zoe', 'f'],
  ].map(([id, gender]) => ({ id, lang: 'en', gender, label: cap(id) }));

  // Sesame CSM (sesame/csm-1b): solo inglese.
  const SESAME_VOICES = [
    { id: 'conversational_a', lang: 'en', gender: 'f', label: 'Voce A' },
    { id: 'conversational_b', lang: 'en', gender: 'm', label: 'Voce B' },
  ];

  // `match` riconosce il modello dal suo id sul router; `required` dice se PRETENDE una voce
  // (Fish Audio la sceglie da sé e non ha nomi da elencare).
  const CATALOGS = [
    { id: 'kokoro', name: 'Kokoro', match: /^hexgrad\/kokoro/i, voices: KOKORO_VOICES, required: true },
    { id: 'azure', name: 'MAI-Voice', match: /^microsoft\/mai-voice/i, voices: AZURE_VOICES, required: true },
    { id: 'aura2', name: 'Aura-2', match: /^deepgram\/aura-2/i, voices: AURA2_VOICES, required: true },
    { id: 'flux', name: 'Flux', match: /^deepgram\/flux/i, voices: FLUX_VOICES, required: true },
    { id: 'orpheus', name: 'Orpheus', match: /^canopylabs\/orpheus/i, voices: ORPHEUS_VOICES, required: true },
    { id: 'sesame', name: 'Sesame CSM', match: /^sesame\//i, voices: SESAME_VOICES, required: true },
    { id: 'fish', name: 'Fish Audio', match: /^fish-audio\//i, voices: [], required: false },
  ];

  const LANG_LABELS = {
    it: 'italiano', en: 'inglese', es: 'spagnolo', fr: 'francese', de: 'tedesco',
    pt: 'portoghese', hi: 'hindi', ja: 'giapponese', zh: 'cinese', nl: 'olandese',
    pl: 'polacco', ru: 'russo', ko: 'coreano', ar: 'arabo', tr: 'turco',
  };
  // Ordine nelle tendine: prima l'italiano, poi l'inglese, poi le altre come nel catalogo.
  const LANG_ORDER_HEAD = ['it', 'en'];

  // 'it-IT' → 'it'.
  function langOf(tag) {
    return String(tag == null ? '' : tag).trim().toLowerCase().split(/[-_]/)[0];
  }

  function catalogFor(modelId) {
    const id = String(modelId == null ? '' : modelId).trim();
    if (!id) return null;
    return CATALOGS.find((c) => c.match.test(id)) || null;
  }

  function voicesFor(modelId) {
    const c = catalogFor(modelId);
    return c ? c.voices : [];
  }

  function allVoices() {
    return CATALOGS.flatMap((c) => c.voices);
  }

  // '' se non è in nessun catalogo: o è un nome scritto a mano, o non è una voce.
  function catalogOfVoice(id) {
    const v = String(id == null ? '' : id).trim();
    if (!v) return '';
    const c = CATALOGS.find((k) => k.voices.some((x) => x.id === v));
    return c ? c.id : '';
  }

  function isKnownVoice(id, modelId) {
    const v = String(id == null ? '' : id).trim();
    if (modelId !== undefined) return voicesFor(modelId).some((x) => x.id === v);
    return catalogOfVoice(v) !== '';
  }

  // Lingua di una voce: 'if_sara' → 'it', 'it-IT-ElsaNeural' → 'it'.
  function langOfVoice(id) {
    const v = allVoices().find((x) => x.id === id);
    return v ? v.lang : '';
  }

  function labelOfVoice(id) {
    const v = allVoices().find((x) => x.id === id);
    return v ? v.label : String(id == null ? '' : id);
  }

  // Voce di partenza: la prima di quella lingua, se non c'è la prima inglese (quella che ogni
  // modello conosce meglio), altrimenti la prima del catalogo. '' se il modello non la vuole.
  function defaultVoiceFor(lang, modelId) {
    const c = modelId === undefined ? CATALOGS[0] : catalogFor(modelId);
    if (!c || !c.required || !c.voices.length) return '';
    const want = langOf(lang);
    const hit = (want && c.voices.find((v) => v.lang === want))
      || c.voices.find((v) => v.lang === 'en')
      || c.voices[0];
    return hit.id;
  }

  // Scelta a mano: vale se il modello la conosce; se è di un ALTRO catalogo si ignora (è un
  // 400 sicuro); se nessun catalogo la conosce passa tale e quale. Niente → voce di partenza.
  function resolveVoice({ chosen, lang, modelId, learned } = {}) {
    const want = String(chosen == null ? '' : chosen).trim();
    const c = catalogFor(modelId);
    const list = Array.isArray(learned) && learned.length ? learned : null;
    if (want) {
      if (c && c.voices.some((v) => v.id === want)) return want;
      if (list && list.includes(want)) return want;
      if (!catalogOfVoice(want)) return want; // nome scritto a mano
      // voce di un altro modello: si ignora
    }
    if (c) return defaultVoiceFor(lang, modelId);
    if (list) return pickFromList(list, lang);
    return '';
  }

  // Voci ammesse elencate dal router in un errore («Supported voices: a, b, c»); [] se il
  // messaggio non le elenca.
  function voicesFromError(message) {
    // L'elenco finisce alla prima virgoletta (arriva dentro un JSON) o a capo; un punto in coda
    // non è parte dell'ultimo nome.
    const m = /supported voices?\s*:\s*([^"\n]+)/i.exec(String(message == null ? '' : message));
    if (!m) return [];
    return m[1].split(',').map((s) => s.trim().replace(/[.\s'\\]+$/g, '')).filter(Boolean);
  }

  // Il modello pretende una voce e non gliene abbiamo mandata nessuna.
  function isVoiceRequiredError(message) {
    return /explicit voice is required|voice is required/i.test(String(message == null ? '' : message));
  }

  // Da un elenco di nomi, quella della lingua chiesta (suffisso `-it` o prefisso `it-`),
  // altrimenti l'inglese, altrimenti la prima.
  function pickFromList(list, lang) {
    const arr = (list || []).filter(Boolean);
    if (!arr.length) return '';
    const byLang = (l) => arr.find((v) => new RegExp(`(^|-)${l}(-|$)`, 'i').test(v));
    const want = langOf(lang);
    return (want && byLang(want)) || byLang('en') || arr[0];
  }

  // Voci per lingua, per una tendina: [{ lang, label, voices }]. Senza modello, Kokoro.
  function groupedByLang(modelId) {
    const voices = modelId === undefined ? KOKORO_VOICES : voicesFor(modelId);
    const langs = [];
    for (const v of voices) if (!langs.includes(v.lang)) langs.push(v.lang);
    const order = LANG_ORDER_HEAD.filter((l) => langs.includes(l))
      .concat(langs.filter((l) => !LANG_ORDER_HEAD.includes(l)));
    return order.map((lang) => ({
      lang,
      label: LANG_LABELS[lang] || lang,
      voices: voices.filter((v) => v.lang === lang),
    }));
  }

  global.SN_TTS_VOICES = {
    CATALOGS, VOICES: KOKORO_VOICES, LANG_LABELS,
    catalogFor, voicesFor, allVoices, catalogOfVoice, isKnownVoice, langOfVoice, labelOfVoice,
    defaultVoiceFor, resolveVoice, voicesFromError, isVoiceRequiredError, pickFromList,
    langOf, groupedByLang,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
