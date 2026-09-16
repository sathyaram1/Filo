// Censimento dei punti in cui Filo usa un modello, e SORGENTE DI VERITÀ della lista di
// funzioni in Opzioni → Modelli (modelChainEditor.js): un punto che non è qui non compare
// da nessuna parte, quindi non può nascondersi. Ogni volta che aggiungi, sposti o togli un
// punto, aggiornalo nello stesso commit: il test incrocia l'elenco col codice reale.
// Campi meno ovvi di una voce: `id` stabile (non si riusa e non si cambia); `from` è da dove
// viene il modello — 'user' (Opzioni → Modelli), 'owner' (Gestione → Modelli di supporto:
// girano sui server di Filo), 'none' (non ne usa nessuno, scritto qui apposta perché
// sembrerebbe di sì), 'code' (deciso dal codice e non cambiabile: DEVE restare vuoto, è
// l'invariante che il test verifica); `ref` è il nome interno per 'user' e lo slot per
// 'owner'; `where` è dove si imposta, in parole per l'utente.

(function (global) {
  'use strict';

  const A = (global.SN_CONST && global.SN_CONST.ACTIONS) || {};

  // Testo per l'utente: niente percorsi di file.
  const WHERE_USER = 'Opzioni → Modelli';
  const WHERE_OWNER = 'Gestione → Modelli di supporto (riservato a chi gestisce Filo)';

  function user(id, label, area, action, note) {
    return { id, label, area, from: 'user', ref: action, where: WHERE_USER, note: note || '' };
  }
  function owner(id, label, area, slot, note) {
    return { id, label, area, from: 'owner', ref: slot, where: WHERE_OWNER, note: note || '' };
  }
  function none(id, label, area, note) {
    return { id, label, area, from: 'none', ref: '', where: '', note: note || '' };
  }

  // Ordinato per area, così si legge come un indice.
  const ENTRIES = [
    user('explain', 'Spiega la selezione', 'Pagine web', A.EXPLAIN),
    user('explain-deep', 'Approfondisci la selezione', 'Pagine web', A.EXPLAIN_DEEP),
    user('explain-link', 'Spiega un link', 'Pagine web', A.EXPLAIN_LINK),
    user('translate-selection', 'Traduci la selezione', 'Pagine web', A.TRANSLATE_SELECTION),
    user('translate-page', 'Traduci la pagina', 'Pagine web', A.TRANSLATE_PAGE),
    user('edit-text', 'Riscrivi il testo selezionato', 'Pagine web', A.EDIT_TEXT),
    user('categorize', 'Categorizza una pagina', 'Pagine web', A.CATEGORIZE),
    user('describe-image', 'Descrivi un\'immagine', 'Pagine web', A.DESCRIBE_IMAGE),
    user('transcribe-image', 'Leggi il testo di un\'immagine', 'Pagine web', A.TRANSCRIBE_IMAGE),
    user('spellcheck-word', 'Correttore ortografico — parola', 'Scrittura', A.SPELLCHECK_WORD),
    user('spellcheck-semantic', 'Correttore ortografico — frase', 'Scrittura', A.SPELLCHECK_SEMANTIC),
    user('transcribe-audio', 'Dettatura dal microfono', 'Scrittura', A.TRANSCRIBE_AUDIO),
    user('tts', 'Lettura ad alta voce', 'Scrittura', A.TTS),

    user('help', 'Sidebar Aiuto', 'Aiuto', A.HELP),
    user('help-intent-guess', 'Aiuto — sintesi dell\'intento', 'Aiuto', A.HELP_INTENT_GUESS),
    user('help-intent-judge', 'Aiuto — controllo dell\'intento', 'Aiuto', A.HELP_INTENT_JUDGE),

    user('filo-chat', 'Chat con Filo', 'Home', A.FILO_CHAT),
    user('filo-dashboard', 'Generazione della home', 'Home', A.FILO_DASHBOARD),
    user('filo-lesson', 'Cosa vale la pena ricordare dopo una conversazione', 'Memoria', A.FILO_LESSON),
    user('filo-compact', 'Riordino dei ricordi', 'Memoria', A.FILO_COMPACT),

    user('tab-triage', 'Riordino automatico delle schede', 'Schede', A.FILO_TAB_TRIAGE),
    user('tab-summary', 'Riassunto di una scheda alla chiusura', 'Schede', A.FILO_TAB_SUMMARY),
    user('archive-embed', 'Indicizzazione delle schede archiviate', 'Schede', A.ARCHIVE_EMBED,
      'Modello di indicizzazione (produce vettori, non parole): senza, la ricerca fra le schede archiviate resta quella per parole.'),
    user('tab-search', 'Ricerca fra le schede archiviate', 'Schede', A.FILO_TAB_SEARCH),

    user('editor-title', 'Editor — titolo del documento', 'Editor', A.EDITOR_TITLE),
    user('editor-summary', 'Editor — riassunto del documento', 'Editor', A.EDITOR_SUMMARY),
    user('editor-chat', 'Editor — chat col documento', 'Editor', A.EDITOR_CHAT),

    user('decks-chat', 'Mazzi — ricerca carte in chat', 'Mazzi', A.DECKS_CHAT),
    user('decks-opinion', 'Mazzi — parere su una carta', 'Mazzi', A.DECKS_OPINION),
    user('decks-autotag', 'Mazzi — etichette automatiche', 'Mazzi', A.DECKS_AUTOTAG),
    user('decks-search-filter', 'Mazzi — filtro dei risultati di ricerca', 'Mazzi', A.DECKS_SEARCH_FILTER),

    user('safebrowse-judge', 'Giudizio sui siti pericolosi', 'Sicurezza', A.SAFEBROWSE_JUDGE),
    user('geoblock-classify', 'Riconoscimento dei blocchi geografici', 'Sicurezza', A.GEOBLOCK_CLASSIFY),

    user('feedback-title', 'Titolo automatico di un feedback', 'Feedback', A.FEEDBACK_TITLE),
    user('manage-search', 'Ricerca fra i feedback', 'Feedback', A.MANAGE_SEARCH),

    user('provider-test', 'Prova di un fornitore («Prova» accanto alla chiave)', 'Diagnostica', A.PROVIDER_TEST),

    owner('sanitizer', 'Sanificatore dei feedback', 'Feedback (server)', 'sanitizer'),
    owner('judge1', 'Giudice 1 dei feedback', 'Feedback (server)', 'judge1'),
    owner('judge2', 'Giudice 2 dei feedback', 'Feedback (server)', 'judge2'),
    owner('judge3', 'Giudice 3 dei feedback', 'Feedback (server)', 'judge3'),
    owner('judge-dynamic', 'Giudice dinamico dei feedback', 'Feedback (server)', 'judgeDynamic'),
    owner('judge-redteam', 'Giudice degli attacchi (red-team)', 'Feedback (server)', 'judgeRedTeam'),
    owner('judge-priority', 'Giudice della priorità dei feedback', 'Feedback (server)', 'judgePriority'),

    // Stanno nell'elenco apposta: senza, si continuerebbe a cercare dove si imposta un modello
    // che non c'è.
    none('cmd-classify', 'Livello di sicurezza di un comando da terminale', 'Sicurezza',
      'Deciso da regole fisse, mai da un modello: un modello convinto a sbagliare eseguirebbe comandi pericolosi.'),
    none('tab-duplicates', 'Riconoscimento delle schede doppie', 'Schede',
      'Confronto esatto degli indirizzi: non serve un modello e il risultato non deve dipendere da uno.'),
    none('page-style-sanitize', 'Controllo dello stile che Filo applica a una pagina', 'Pagine web',
      'Il modello propone lo stile, ma cosa è ammesso lo decidono regole fisse.'),
    none('feedback-groomer', 'Accorpamento dei feedback doppi', 'Feedback',
      'Confronti testuali deterministici.'),
    none('web-search', 'Ricerca sul web della sidebar Aiuto', 'Aiuto',
      'È un motore di ricerca, non un modello; i risultati vengono poi letti dal modello dell\'Aiuto.'),
  ];

  function list() {
    return ENTRIES.map((e) => ({ ...e }));
  }

  // È la lista che genera la griglia di Opzioni → Modelli: elenco e griglia non possono
  // divergere perché sono la stessa cosa.
  function userActions() {
    return ENTRIES.filter((e) => e.from === 'user' && e.ref).map((e) => e.ref);
  }

  function ownerSlots() {
    return ENTRIES.filter((e) => e.from === 'owner' && e.ref).map((e) => e.ref);
  }

  // Deve essere sempre vuoto: è l'invariante di questo censimento.
  function hardcoded() {
    return ENTRIES.filter((e) => e.from === 'code').map((e) => e.id);
  }

  function byArea() {
    const out = [];
    const index = new Map();
    for (const e of ENTRIES) {
      if (!index.has(e.area)) {
        const group = { area: e.area, entries: [] };
        index.set(e.area, group);
        out.push(group);
      }
      index.get(e.area).entries.push({ ...e });
    }
    return out;
  }

  function byId(id) {
    const e = ENTRIES.find((x) => x.id === id);
    return e ? { ...e } : null;
  }

  global.SN_MODEL_USAGE = {
    ENTRIES,
    list,
    byArea,
    byId,
    userActions,
    ownerSlots,
    hardcoded,
    WHERE_USER,
    WHERE_OWNER,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
