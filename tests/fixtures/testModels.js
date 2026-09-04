// Registro e catene di modelli DI PROVA, solo per i test.
//
// L'app non ha più modelli scritti nel codice: quelli veri stanno nella
// configurazione condivisa (Gestione → Modelli predefiniti) o nelle Opzioni
// di chi usa Filo, e una funzione senza modello si ferma dicendolo. I test
// però hanno bisogno di una configurazione nota e stabile: è questa. Viene
// caricata SOLO con NODE_ENV=test (loader.js, internal-preload.js) e fa da
// "registro di build" per defaultsStore e per il seme dello storage.
//
// Convenzione IIFE su globalThis come i moduli shared/*.

(function (global) {
  'use strict';

  const A = (global.SN_CONST && global.SN_CONST.ACTIONS) || {};

  const registry = {
    "claude": {
      "label": "Claude Haiku 4.5",
      "provider": "openrouter",
      "model": "anthropic/claude-haiku-4.5",
      "inputs": [
        "text",
        "image"
      ],
      "outputs": [
        "text"
      ]
    },
    "gemma": {
      "label": "Gemma 4 31B (pesi aperti)",
      "provider": "openrouter",
      "model": "google/gemma-4-31b-it",
      "weights": "open"
    },
    "gemma-lite": {
      "label": "Gemma 4 26B A4B (pesi aperti)",
      "provider": "openrouter",
      "model": "google/gemma-4-26b-a4b-it",
      "weights": "open"
    },
    "deepseek": {
      "label": "DeepSeek V4 Pro (pesi aperti)",
      "provider": "openrouter",
      "model": "deepseek/deepseek-v4-pro",
      "weights": "open",
      "inputs": [
        "text"
      ],
      "outputs": [
        "text"
      ]
    },
    "deepseek-flash": {
      "label": "DeepSeek V4 Flash (pesi aperti, economico)",
      "provider": "openrouter",
      "model": "deepseek/deepseek-v4-flash",
      "weights": "open",
      "inputs": [
        "text"
      ],
      "outputs": [
        "text"
      ]
    },
    "whisper": {
      "label": "Whisper Large v3 Turbo (pesi aperti, dettatura)",
      "provider": "openrouter",
      "model": "openai/whisper-large-v3-turbo",
      "weights": "open",
      "inputs": [
        "audio"
      ],
      "outputs": [
        "text"
      ]
    },
    "nemotron-asr": {
      "label": "Nemotron ASR 0.6B (pesi aperti, dettatura)",
      "provider": "openrouter",
      "model": "nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b",
      "weights": "open",
      "inputs": [
        "audio"
      ],
      "outputs": [
        "text"
      ]
    },
    "kokoro": {
      "label": "Kokoro 82M (pesi aperti, voce)",
      "provider": "openrouter",
      "model": "hexgrad/kokoro-82m",
      "weights": "open",
      "inputs": [
        "text"
      ],
      "outputs": [
        "audio"
      ]
    },
    "qwen-embed": {
      "label": "Qwen3 Embedding 8B (pesi aperti, indicizzazione)",
      "provider": "openrouter",
      "model": "qwen/qwen3-embedding-8b",
      "weights": "open",
      "inputs": [
        "text"
      ],
      "outputs": [
        "embedding"
      ]
    },
    "glm": {
      "label": "GLM 5.3 Flash (pesi aperti, legge le immagini)",
      "provider": "openrouter",
      "model": "z-ai/glm-5.3-flash",
      "weights": "open",
      "inputs": [
        "text",
        "image"
      ],
      "outputs": [
        "text"
      ]
    }
  };

  const models = {
    [A.EXPLAIN]: 'deepseek-flash, gemma-lite',
    [A.EXPLAIN_DEEP]: 'claude, deepseek',
    [A.TRANSLATE_SELECTION]: 'deepseek-flash, gemma-lite',
    [A.TRANSLATE_PAGE]: 'deepseek-flash, gemma-lite',
    [A.HELP]: 'deepseek, gemma',
    [A.CATEGORIZE]: 'deepseek-flash, gemma-lite',
    [A.DESCRIBE_IMAGE]: 'gemma, glm',
    [A.TRANSCRIBE_IMAGE]: 'gemma, glm',
    [A.TRANSCRIBE_AUDIO]: 'whisper, nemotron-asr',
    [A.SPELLCHECK_SEMANTIC]: 'deepseek-flash, gemma-lite',
    [A.SPELLCHECK_WORD]: 'deepseek-flash, gemma-lite',
    [A.EDIT_TEXT]: 'claude, deepseek',
    [A.EXPLAIN_LINK]: 'deepseek-flash, gemma-lite',
    [A.HELP_INTENT_GUESS]: 'deepseek-flash, gemma-lite',
    [A.HELP_INTENT_JUDGE]: 'deepseek-flash, gemma-lite',
    [A.FILO_CHAT]: 'deepseek, gemma',
    [A.FILO_DASHBOARD]: 'deepseek, gemma',
    [A.FILO_LESSON]: 'deepseek-flash, gemma-lite',
    [A.FILO_COMPACT]: 'deepseek, gemma',
    [A.DECKS_CHAT]: 'deepseek, gemma',
    [A.DECKS_OPINION]: 'deepseek, gemma',
    [A.DECKS_AUTOTAG]: 'deepseek-flash, gemma-lite',
    [A.DECKS_SEARCH_FILTER]: 'deepseek-flash, gemma-lite',
    [A.FILO_TAB_TRIAGE]: 'deepseek-flash, gemma-lite',
    [A.FILO_TAB_SUMMARY]: 'deepseek-flash, gemma-lite',
    [A.FILO_TAB_SEARCH]: 'deepseek-flash, gemma-lite',
    [A.TTS]: 'kokoro',
    [A.SAFEBROWSE_JUDGE]: 'deepseek-flash',
    [A.GEOBLOCK_CLASSIFY]: 'deepseek-flash',
    [A.FEEDBACK_TITLE]: 'deepseek-flash',
    [A.EDITOR_TITLE]: 'deepseek-flash, gemma-lite',
    [A.EDITOR_SUMMARY]: 'deepseek-flash, gemma-lite',
    [A.EDITOR_CHAT]: 'deepseek, gemma',
    [A.MANAGE_SEARCH]: 'deepseek-flash, gemma-lite',
    [A.ARCHIVE_EMBED]: 'qwen-embed',
    [A.PROVIDER_TEST]: 'deepseek-flash, gemma-lite',
  };

  global.SN_TEST_MODELS = { registry, models };
})(typeof globalThis !== 'undefined' ? globalThis : self);
