// Che cosa vede una pagina WEB delle impostazioni di Filo.
//
// Le impostazioni sono un oggetto solo, e dentro ci sono i segreti dell'utente:
// le chiavi dei servizi a pagamento (`apiKeys`), le credenziali del proxy
// (`proxy.datacenter` contiene utente e password nell'URL), la chiave di Safe
// Browsing. Quello stesso oggetto viaggia verso i content script che Filo
// carica su OGNI pagina visitata, riquadri incorporati compresi.
//
// Le due strade verso una pagina web erano asimmetriche: la lettura a richiesta
// (GET_SETTINGS, `_storage:get`) toglieva `apiKeys`, la spinta (il broadcast
// SETTINGS_UPDATED a ogni salvataggio) mandava l'oggetto intero. Il proxy non lo
// toglieva nessuna delle due. Qui c'è UNA funzione sola, usata da entrambe le
// strade, così non possono più divergere.
//
// Ed è una lista di campi AMMESSI, non di campi da togliere: il prossimo segreto
// che qualcuno aggiunge alle impostazioni resta fuori da solo, senza che debba
// ricordarsi di aggiungerlo a un elenco di esclusioni. Il prezzo è l'altro lato
// della stessa moneta — un campo nuovo che ai content script serve davvero va
// aggiunto qui, altrimenti non lo vedono: la sentinella in
// tests/unit/settingsScope.test.mjs legge src/content/*.js e diventa rossa se
// un content script usa un campo che questa lista non ammette.
//
// Le pagine filo:// continuano a ricevere l'oggetto intero: sono Filo.
(function (global) {
  'use strict';

  // I campi che i content script delle pagine web usano DAVVERO (l'elenco
  // accanto a ciascuno è dove si vede in src/content/):
  const WEB_SETTINGS_FIELDS = Object.freeze([
    'theme',          // content.js → applyTheme
    'themeTokens',    // content.js → applyThemeTokens (token estetici)
    'tabColor',       // content.js → PageColor.reportTabIdentityColor
    'featureFlags',   // content.js, spellcheck.js → correttore acceso/spento
    'blocklist',      // content.js → siti dove l'utente ha spento Filo
    'tts',            // tts.js → voce, velocità, tono della lettura
    'models',         // tts.js → quale modello detta (menu tasto destro)
    'modelRegistry',  // tts.js → i modelli configurati fra cui scegliere
  ]);

  const FIELD_SET = new Set(WEB_SETTINGS_FIELDS);

  // Un'origine (o l'indirizzo di un frame) è una superficie interna di Filo?
  function isFiloOrigin(origin) {
    return String(origin || '').startsWith('filo://');
  }

  // Le impostazioni come le può vedere una pagina web: solo i campi ammessi,
  // e solo quelli che esistono davvero (un campo assente resta assente, così
  // chi legge continua a cadere sui propri valori di ripiego).
  function settingsForWeb(settings) {
    if (!settings || typeof settings !== 'object') return {};
    const out = {};
    for (const k of WEB_SETTINGS_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(settings, k)) out[k] = settings[k];
    }
    return out;
  }

  // Le impostazioni da consegnare a una certa origine: intere a filo://,
  // ridotte a tutto il resto. È questa che chiamano sia le letture sia la
  // spinta verso le schede.
  function settingsForOrigin(settings, origin) {
    return isFiloOrigin(origin) ? settings : settingsForWeb(settings);
  }

  global.SN_SETTINGS_SCOPE = {
    WEB_SETTINGS_FIELDS,
    isFiloOrigin,
    settingsForWeb,
    settingsForOrigin,
    isWebField: (k) => FIELD_SET.has(k),
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
