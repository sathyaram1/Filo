// Registro azione→livello di sicurezza (#146.2).
//
// Ogni azione che Filo (l'AI) può intraprendere ha un livello assegnato
// STATICAMENTE qui — mai deciso dall'LLM a runtime:
//
//   1 — completamente reversibile: si esegue subito, senza chiedere nulla.
//   2 — reversibile ma con possibili inconvenienti: popup di conferma che
//       spiega in chiaro la modifica, con OK e Annulla (SN_CONFIRM_UI.confirm).
//   3 — irreversibile: box con attrito maggiore, l'utente deve digitare
//       espressamente "conferma" (SN_CONFIRM_UI.confirmTyped).
//
// Il dispatch (executeFiloAction in src/main/services/handlers.js) RIFIUTA le
// azioni non registrate: ogni nuovo potere di Filo è obbligato a dichiarare
// qui il proprio livello, altrimenti non viene eseguito.
//
// Per IMPOSTA_PREFERENZA il livello dipende dalla preferenza specifica (il
// `level` del setter in src/shared/preferences.js, default 1): cambiare il
// tema è innocuo, abilitare la modalità terminale dà a Filo accesso alla
// shell e merita una conferma.

(function (global) {
  'use strict';

  function prefBuilt(action) {
    const P = global.SN_PREF;
    if (!P) return null;
    const chiave = action.chiave ?? action.key ?? action.nome ?? action.name ?? action.preferenza;
    const valore = action.valore ?? action.value ?? action.valoreNuovo ?? action.val;
    return P.buildPreferencePartial(chiave, valore);
  }

  // Token + valore di un'azione estetica (più sinonimi che un LLM può produrre).
  function estTok(action) {
    return action.token ?? action.nome ?? action.name ?? action.chiave ?? action.elemento;
  }
  function estVal(action) {
    return action.valore ?? action.value ?? action.val ?? action.colore;
  }

  const REGISTRY = {
    NAVIGA: {
      level: 1,
      describe: (a) => `Aprire ${a.url || 'una pagina'}`,
    },
    APRI_FILE: {
      level: 1,
      describe: (a) => `Aprire il file ${a.path || ''}`.trim(),
    },
    TIMER: {
      level: 1,
      describe: (a) => `Avviare il timer "${a.label || a.etichetta || 'Timer'}"`,
    },
    SVEGLIA: {
      level: 1,
      describe: (a) => `Impostare una sveglia ${a.time || a.orario || ''}`.trim(),
    },
    SALVA_APPUNTO: {
      level: 1,
      describe: () => 'Salvare un appunto',
    },
    CERCA_WEB: {
      level: 1,
      describe: (a) => `Cercare sul web "${a.query || ''}"`,
    },
    EVENTO_CALENDARIO: {
      level: 1,
      describe: (a) => `Creare l'evento "${a.title || a.titolo || ''}"`,
    },
    PULISCI_TAB: {
      level: 2,
      describe: () => 'Valutare le schede aperte e archiviare quelle non più utili. '
        + 'Le schede archiviate restano riapribili da “Tab archiviate”.',
    },
    CANCELLA_ARCHIVIO: {
      level: 3,
      describe: (a) => `Eliminare DEFINITIVAMENTE dall'archivio le schede pertinenti a `
        + `“${a.query || a.testo || ''}”.`,
    },
    IMPOSTA_PREFERENZA: {
      // Livello per-preferenza: lo dichiara il setter in preferences.js
      // (default 1). Preferenza sconosciuta/non valida → 2 per prudenza
      // (tanto il dispatch non la eseguirà comunque).
      level: (a) => {
        const built = prefBuilt(a);
        return (built && built.level) || (built ? 1 : 2);
      },
      describe: (a) => {
        const built = prefBuilt(a);
        return built ? `Impostare: ${built.label}` : 'Modificare una preferenza';
      },
    },
  };

  // Livello dell'azione: 1|2|3, oppure null se l'azione NON è registrata
  // (→ il dispatch deve rifiutarla).
  function levelFor(action) {
    if (!action || typeof action !== 'object') return null;
    const entry = REGISTRY[String(action.type || '').toUpperCase()];
    if (!entry) return null;
    const lvl = typeof entry.level === 'function' ? entry.level(action) : entry.level;
    return lvl === 1 || lvl === 2 || lvl === 3 ? lvl : null;
  }

  // Spiegazione in chiaro di cosa Filo sta tentando, per il popup di conferma.
  function describe(action) {
    if (!action || typeof action !== 'object') return '';
    const entry = REGISTRY[String(action.type || '').toUpperCase()];
    if (!entry) return '';
    try { return entry.describe(action) || ''; } catch (_) { return ''; }
  }

  global.SN_ACTION_LEVELS = { REGISTRY, levelFor, describe };
})(typeof globalThis !== 'undefined' ? globalThis : self);
