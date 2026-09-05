// Capacità dei modelli e requisiti delle funzioni.
//
// Serve a tre cose:
//   1. Etichettare ogni modello nel picker per CATEGORIA (testo, sintesi vocale,
//      immagini, embedding, …).
//   2. Ordinare i modelli per "recency" (i più recenti in cima).
//   3. Validare l'abbinamento modello↔funzione: una funzione che vuole testo in
//      output non può ricevere un modello di sola sintesi vocale, e viceversa.
//
// Le capacità si ricavano da provider + id (nome del modello), più — quando
// disponibili — i metadati dell'API:
//   - OpenRouter espone architecture.input_modalities/output_modalities e
//     `created` (timestamp): precisi, li usiamo direttamente.
//   - Senza metadati (una riga del registro personale scritta a mano) si
//     deduce dal nome (-tts, kokoro, whisper, embedding…); una voce del
//     registro può anche dichiarare le proprie modalità (inputs/outputs), e
//     allora vale quello.
//
// Convenzione IIFE su globalThis come gli altri moduli shared/*.

(function (global) {
  'use strict';

  // Modalità usate in inputs/outputs.
  const M = { TEXT: 'text', IMAGE: 'image', AUDIO: 'audio', VIDEO: 'video', EMBED: 'embedding' };

  function lc(s) { return String(s == null ? '' : s).toLowerCase(); }
  function uniq(arr) { return Array.from(new Set(arr)); }

  // Normalizza una lista di modalità "stile OpenRouter" nelle nostre.
  function normModalities(list) {
    const out = [];
    for (const m of list || []) {
      const v = lc(m);
      if (v.includes('audio') || v.includes('speech')) out.push(M.AUDIO);
      else if (v.includes('image')) out.push(M.IMAGE);
      else if (v.includes('video')) out.push(M.VIDEO);
      else if (v.includes('embed')) out.push(M.EMBED);
      else out.push(M.TEXT);
    }
    return uniq(out.length ? out : [M.TEXT]);
  }

  // Capacità di un modello: { inputs:[], outputs:[] } con valori da M.
  // `meta` è opzionale (l'oggetto grezzo dell'API per quel modello).
  function capabilitiesFor(provider, modelId, meta) {
    const id = lc(modelId);

    // OpenRouter con metadati di modalità → precisi.
    const arch = meta && (meta.architecture || meta);
    if (arch && (arch.input_modalities || arch.output_modalities)) {
      return {
        inputs: normModalities(arch.input_modalities || ['text']),
        outputs: normModalities(arch.output_modalities || ['text']),
      };
    }

    // Euristiche sul nome (righe senza metadati).
    if (/embedding|embed/.test(id)) return { inputs: [M.TEXT], outputs: [M.EMBED] };
    // Trascrizione (dettatura): ascolta un audio, risponde col testo. Prima
    // della sintesi vocale, perché "speech-to-text" contiene "speech".
    if (/whisper|parakeet|voxtral|canary|(^|[-_/])asr([-_]|$)|transcri|speech-to-text/.test(id)) {
      return { inputs: [M.AUDIO], outputs: [M.TEXT] };
    }
    // Sintesi vocale o musica → audio in output. (lyria = musica)
    if (/(^|[-_/])tts([-_]|$)|-tts|\btts\b|speech|lyria|kokoro|orpheus|(^|[-_/])csm-|mai-voice|aura-2|fish-audio/.test(id)) {
      return { inputs: [M.TEXT], outputs: [M.AUDIO] };
    }
    // Generazione immagini.
    if (/(image|imagen|nano-banana)/.test(id)) {
      return { inputs: [M.TEXT, M.IMAGE], outputs: [M.IMAGE] };
    }
    // Generazione video.
    if (/(^|[-_/])veo|video/.test(id)) {
      return { inputs: [M.TEXT, M.IMAGE], outputs: [M.VIDEO] };
    }

    // Modello di testo. Per un modello OpenRouter di cui non abbiamo i
    // metadati di modalità le capacità reali sono IGNOTE: tanti modelli
    // accettano immagini (es. vision) ma il nome non lo rivela. Lo marchiamo
    // `uncertain` così il gate di compatibilità NON blocca l'utente che lo
    // sceglie (vedi modelMatchesAction): a runtime, se davvero non legge le
    // immagini, scatta il fallback. Default categoria resta "testo" (cosmetico).
    const inputs = [M.TEXT];
    const uncertain = provider === 'openrouter';
    return { inputs, outputs: [M.TEXT], uncertain };
  }

  // Categoria principale (chiave i18n caps_cat_*) per le etichette del picker.
  function categoryKey(provider, modelId, meta) {
    const caps = capabilitiesFor(provider, modelId, meta);
    if (caps.outputs.includes(M.EMBED)) return 'embedding';
    if (caps.outputs.includes(M.AUDIO)) return 'tts';
    if (caps.outputs.includes(M.VIDEO)) return 'video';
    if (caps.outputs.includes(M.IMAGE) && !caps.outputs.includes(M.TEXT)) return 'image';
    // Ascolta e basta (niente immagini): è un modello di dettatura.
    if (caps.inputs.includes(M.AUDIO) && !caps.inputs.includes(M.IMAGE) && !caps.uncertain) return 'stt';
    if (caps.inputs.includes(M.IMAGE) || caps.inputs.includes(M.AUDIO)) return 'multimodal';
    return 'text';
  }

  function categoryLabel(provider, modelId, meta) {
    const key = categoryKey(provider, modelId, meta);
    const t = global.SN_I18N && global.SN_I18N.t;
    return t ? t('caps_cat_' + key) : key;
  }

  // Requisiti di una funzione: { output, inputs:[] }. Default = testo in output,
  // nessun input speciale. Le eccezioni sono le funzioni multimodali.
  function requirementsFor(action) {
    const A = (global.SN_CONST && global.SN_CONST.ACTIONS) || {};
    switch (action) {
      case A.DESCRIBE_IMAGE:
      case A.TRANSCRIBE_IMAGE:
        return { output: M.TEXT, inputs: [M.IMAGE] };
      case A.TRANSCRIBE_AUDIO:
        return { output: M.TEXT, inputs: [M.AUDIO] };
      case A.TTS:
        return { output: M.AUDIO, inputs: [] };
      // Indicizzazione dell'archivio schede: serve un modello che produca
      // VETTORI, non parole. Un modello di testo qui non funzionerebbe, e un
      // modello di indicizzazione non funziona per le funzioni di testo: la
      // validazione impedisce entrambi gli scambi.
      case A.ARCHIVE_EMBED:
        return { output: M.EMBED, inputs: [] };
      default:
        return { output: M.TEXT, inputs: [] };
    }
  }

  // Verifica che un modello soddisfi i requisiti di una funzione.
  // Ritorna { ok:true } oppure { ok:false, reason:'<testo i18n>' }.
  function modelMatchesAction(provider, modelId, action, meta) {
    const caps = capabilitiesFor(provider, modelId, meta);
    const req = requirementsFor(action);
    const t = (global.SN_I18N && global.SN_I18N.t) || ((k) => k);

    // Capacità non note (modello OpenRouter senza metadati di modalità): non
    // blocchiamo. È coerente con la regola "nel dubbio non bloccare" già usata
    // per i nickname sconosciuti — un blocco falso impedirebbe di usare un
    // modello valido (es. una vision di OpenRouter per "Descrizione immagini").
    if (caps.uncertain) return { ok: true };

    if (!caps.outputs.includes(req.output)) {
      const key = req.output === M.AUDIO ? 'caps_block_output_audio'
        : req.output === M.EMBED ? 'caps_block_output_embedding'
          : 'caps_block_output_text';
      return { ok: false, reason: t(key) };
    }
    for (const inp of req.inputs) {
      if (!caps.inputs.includes(inp)) {
        const key = inp === M.AUDIO ? 'caps_block_input_audio' : 'caps_block_input_image';
        return { ok: false, reason: t(key) };
      }
    }
    return { ok: true };
  }

  // Chiave di ordinamento "più recente = più grande". L'ordinamento avviene
  // SEMPRE dentro lo stesso provider (liste separate), quindi le scale diverse
  // tra provider non si mischiano.
  //   - OpenRouter: `created` (unix).
  //   - Altri fornitori: numero di versione dall'id (3.5 > 3.1 > 3 > 2.5), con
  //     la data eventualmente presente in `version` come spareggio fine.
  function recencyKey(provider, modelId, meta) {
    if (provider === 'openrouter') {
      const c = meta && meta.created;
      return typeof c === 'number' ? c : 0;
    }
    const verMatch = lc(modelId).match(/(\d+(?:\.\d+)?)/);
    let key = verMatch ? parseFloat(verMatch[1]) : 0;
    const dm = lc((meta && meta.version) || '').match(/(\d{4})[-_](\d{2})/);
    if (dm) key += (parseInt(dm[1], 10) * 12 + parseInt(dm[2], 10)) / 1e6;
    return key;
  }

  // Ordina una lista di { id, provider, meta } per recency decrescente, con il
  // nome come spareggio stabile.
  function sortByRecency(items) {
    return items.slice().sort((a, b) => {
      const ka = recencyKey(a.provider, a.id, a.meta);
      const kb = recencyKey(b.provider, b.id, b.meta);
      if (kb !== ka) return kb - ka;
      return String(a.id).localeCompare(String(b.id));
    });
  }

  global.SN_MODEL_CAPS = {
    M,
    capabilitiesFor,
    categoryKey,
    categoryLabel,
    requirementsFor,
    modelMatchesAction,
    recencyKey,
    sortByRecency,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
