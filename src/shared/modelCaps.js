// Capacità dei modelli e requisiti delle funzioni: categoria nel picker, ordinamento per
// recency, validazione dell'abbinamento modello↔funzione. Si ricavano dai metadati dell'API
// quando ci sono, altrimenti dal nome o dalle modalità dichiarate nel registro personale.

(function (global) {
  'use strict';

  const M = { TEXT: 'text', IMAGE: 'image', AUDIO: 'audio', VIDEO: 'video', EMBED: 'embedding' };

  function lc(s) { return String(s == null ? '' : s).toLowerCase(); }
  function uniq(arr) { return Array.from(new Set(arr)); }

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

  // `meta` è l'oggetto grezzo dell'API per quel modello, quando c'è.
  function capabilitiesFor(provider, modelId, meta) {
    const id = lc(modelId);

    const arch = meta && (meta.architecture || meta);
    if (arch && (arch.input_modalities || arch.output_modalities)) {
      return {
        inputs: normModalities(arch.input_modalities || ['text']),
        outputs: normModalities(arch.output_modalities || ['text']),
      };
    }

    // Euristiche sul nome (righe senza metadati).
    if (/embedding|embed/.test(id)) return { inputs: [M.TEXT], outputs: [M.EMBED] };
    // Trascrizione prima della sintesi vocale: «speech-to-text» contiene «speech».
    if (/whisper|parakeet|voxtral|canary|(^|[-_/])asr([-_]|$)|transcri|speech-to-text/.test(id)) {
      return { inputs: [M.AUDIO], outputs: [M.TEXT] };
    }
    // Sintesi vocale o musica → audio in output (lyria = musica).
    if (/(^|[-_/])tts([-_]|$)|-tts|\btts\b|speech|lyria|kokoro|orpheus|(^|[-_/])csm-|mai-voice|aura-2|fish-audio/.test(id)) {
      return { inputs: [M.TEXT], outputs: [M.AUDIO] };
    }
    if (/(image|imagen|nano-banana)/.test(id)) {
      return { inputs: [M.TEXT, M.IMAGE], outputs: [M.IMAGE] };
    }
    if (/(^|[-_/])veo|video/.test(id)) {
      return { inputs: [M.TEXT, M.IMAGE], outputs: [M.VIDEO] };
    }

    // Modello OpenRouter senza metadati: capacità IGNOTE (tanti accettano immagini senza dirlo
    // nel nome). Si marca `uncertain` così il gate non blocca, e a runtime scatta il fallback.
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

  // Default: testo in output, nessun input speciale; le eccezioni sono le multimodali.
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
      // L'indicizzazione dell'archivio schede vuole VETTORI, non parole: la validazione
      // impedisce entrambi gli scambi (testo qui, indicizzazione nelle funzioni di testo).
      case A.ARCHIVE_EMBED:
        return { output: M.EMBED, inputs: [] };
      default:
        return { output: M.TEXT, inputs: [] };
    }
  }

  // { ok:true } oppure { ok:false, reason:'<testo i18n>' }.
  function modelMatchesAction(provider, modelId, action, meta) {
    const caps = capabilitiesFor(provider, modelId, meta);
    const req = requirementsFor(action);
    const t = (global.SN_I18N && global.SN_I18N.t) || ((k) => k);

    // Capacità non note: non si blocca, come per i nickname sconosciuti — un blocco falso
    // impedirebbe di usare un modello valido, per esempio una vision senza modalità dichiarate.
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

  // Chiave di ordinamento «più recente = più grande», sempre dentro lo stesso provider così
  // le scale non si mischiano: OpenRouter usa `created`, gli altri la versione dall'id.
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

  // Il nome è lo spareggio stabile.
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
