// Il tetto di una risposta dei modelli (max_tokens) per famiglia di funzioni (#1097.3): l'utente vince sull'owner, l'owner
// sul codice. Largo apposta, ferma solo il modello che si incarta; un host che non lo regge il router lo scarta, e se non
// ne resta nessuno l'errore lo dice (TETTO_RISPOSTA). Logica pura; prove in tests/unit/lunghezzaRisposte.test.mjs.

(function (global) {
  'use strict';

  const FAMIGLIE = Object.freeze(['conversazioni', 'testi', 'brevi']);
  const DI_SERIE = Object.freeze({ conversazioni: 16384, testi: 16384, brevi: 8192 });
  const LIMITI = Object.freeze([1024, 262144]);
  const NOMI = Object.freeze({
    conversazioni: 'chat e conversazioni',
    testi: 'traduzioni, riscritture e riassunti',
    brevi: 'risposte brevi (spiegazioni, titoli, correttore)',
  });

  const A = () => (global.SN_CONST && global.SN_CONST.ACTIONS) || {};
  // Le funzioni che non scrivono testo (voce, dettatura, vettori, classificatori a domande chiuse) non hanno tetto.
  const SENZA = ['TTS', 'TRANSCRIBE_AUDIO', 'ARCHIVE_EMBED', 'MANAGE_SEARCH_CLASSIFY'];
  const CONVERSAZIONI = ['FILO_CHAT', 'FILO_DASHBOARD', 'HELP', 'EDITOR_CHAT', 'DECKS_CHAT', 'EXPLAIN_DEEP'];
  const BREVI = [
    'EXPLAIN', 'EXPLAIN_LINK', 'DESCRIBE_IMAGE', 'CATEGORIZE', 'SPELLCHECK_SEMANTIC',
    'HELP_INTENT_GUESS', 'HELP_INTENT_JUDGE', 'FILO_TAB_TRIAGE', 'FILO_CHAT_TRIAGE', 'FILO_TAB_SEARCH',
    'DECKS_SEARCH_FILTER', 'SAFEBROWSE_JUDGE', 'GEOBLOCK_CLASSIFY', 'FEEDBACK_TITLE', 'EDITOR_TITLE',
    'MANAGE_SEARCH', 'FILE_NAME', 'EMBED_COOKIE_CHECK', 'PROVIDER_TEST',
  ];
  const valori = (nomi) => nomi.map((n) => A()[n]).filter(Boolean);

  // Una funzione nuova che nessuno ha messo in un elenco prende il tetto dei testi lunghi: largo, mai il più stretto.
  function famigliaDi(action) {
    const a = String(action || '');
    if (!a || valori(SENZA).includes(a)) return null;
    if (valori(CONVERSAZIONI).includes(a)) return 'conversazioni';
    if (valori(BREVI).includes(a)) return 'brevi';
    return 'testi';
  }

  function numeroIn(v) {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
    const n = typeof v === 'number' ? v : Number(String(v).trim().replace(/[.\s]/g, '').replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    return Math.round(Math.min(LIMITI[1], Math.max(LIMITI[0], n)));
  }

  // Un valore vuoto vuol dire «come i predefiniti». `da` dice chi l'ha deciso, per la pagina che lo mostra.
  function tetti(utente, owner) {
    const u = utente && typeof utente === 'object' ? utente : {};
    const o = owner && typeof owner === 'object' ? owner : {};
    const out = { da: {} };
    for (const f of FAMIGLIE) {
      const vu = numeroIn(u[f]);
      const vo = numeroIn(o[f]);
      out[f] = vu ?? vo ?? DI_SERIE[f];
      out.da[f] = vu != null ? 'utente' : (vo != null ? 'predefiniti' : 'codice');
    }
    return out;
  }

  // Il max_tokens da mandare per una funzione, o null se la funzione non ne ha.
  function perAzione(action, utente, owner) {
    const f = famigliaDi(action);
    return f ? tetti(utente, owner)[f] : null;
  }

  // Solo le famiglie note, coi valori nei limiti: quello che si salva (owner o utente).
  function pulisci(o) {
    const src = o && typeof o === 'object' ? o : {};
    const out = {};
    for (const f of FAMIGLIE) out[f] = numeroIn(src[f]);
    return out;
  }

  global.SN_LUNGHEZZA_RISPOSTE = { FAMIGLIE, DI_SERIE, LIMITI, NOMI, famigliaDi, numeroIn, tetti, perAzione, pulisci };
})(typeof globalThis !== 'undefined' ? globalThis : self);
