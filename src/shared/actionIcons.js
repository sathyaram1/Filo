// Icona di ogni azione dell'agente Filo: la tabella azione → nome in SN_ICONS, in un posto solo. Chi disegna una riga chiede `SN_ACTION_ICONS.svg(type, size)`, senza tabelle di emoji proprie.
// Tre tabelle: AZIONI (quelle di actionLevels.js: una sentinella negli unit test diventa rossa se una resta senza icona), PREVISTE (poteri non ancora nati, nomi indicativi, da spostare in AZIONI quando arrivano), STATI (momenti del lavoro, non azioni).
// Tipo sconosciuto → logo di Filo: meglio una riga col marchio che una riga con un buco.

(function (global) {
  'use strict';

  const AZIONI = {
    NAVIGA: 'openTab',
    APRI_FILE: 'folder',
    TIMER: 'timer',
    SVEGLIA: 'alarm',
    CANCELLA_SVEGLIA: 'alarmOff',
    MODIFICA_SVEGLIA: 'alarmShift',
    SALVA_APPUNTO: 'note',
    SALVA_LEZIONE: 'pin',
    INVIA_FEEDBACK: 'feedback',
    CERCA_WEB: 'searchWeb',
    ONBOARDING: 'checklist',
    CAPACITA_DETTAGLIO: 'clipboard',
    LEGGI_FILE: 'readDocument',
    LEGGI_DOCUMENTO: 'readDocument',
    LEGGI_TRASPARENZA: 'transparency',
    EVENTO_CALENDARIO: 'calendar',
    PULISCI_TAB: 'broom',
    CANCELLA_ARCHIVIO: 'trash',
    CANCELLA_MEMORIA: 'eraser',
    IMPOSTA_PREFERENZA: 'options',
    IMPOSTA_ESTETICA: 'palette',
    ESEGUI_COMANDO: 'terminal',
    PROXY_TAB: 'globe',
    RIMUOVI_PROXY: 'globeOff',
    RIMUOVI_PROXY_TUTTE: 'globeOff',
    REGOLA_PROXY_DOMINIO: 'globePinned',
    RIMUOVI_REGOLA_PROXY: 'globeOff',
    COMANDO_FINESTRA: 'windowFrame',
    STILE_PAGINA: 'brush',
    RIPRISTINA_STILE_PAGINA: 'undo',
  };

  const PREVISTE = {
    LEGGI_POSTA: 'mailOpen',
    INVIA_POSTA: 'mailSend',
    LEGGI_PAGINA: 'readPage',
    SCREENSHOT: 'screenshot',
    CLICCA: 'click',
    SCRIVI_NELLA_PAGINA: 'typeText',
    MODIFICA_FILE: 'pencil',
    CREA_FILE: 'fileNew',
    ALLEGA: 'attach',
    SCATTA_FOTO: 'camera',
    ASCOLTA: 'mic',
    LEGGI_AD_ALTA_VOCE: 'readAloud',
    RICORDA: 'memory',
    COPIA: 'copy',
    PROMEMORIA: 'bell',
    NOTIFICA: 'bell',
    AUTOMAZIONE: 'repeat',
    CHIEDI: 'question',
    TRADUCI: 'translate',
    SCARICA: 'download',
    CONDIVIDI: 'share',
    // APRI_APP: l'icona è quella dell'app aperta (vedi APP), non la griglia.
    APRI_APP: 'apps',
    CHIUDI_SCHEDA: 'close',
    CERCA_SCHEDE: 'tabs',
    CERCA_CRONOLOGIA: 'history',
    POSIZIONE: 'location',
    PIANO: 'list',
    GENERA: 'sparkles',
  };

  const STATI = {
    RAGIONAMENTO: 'reasoning',
    FATTO: 'check',
    AVVISO: 'warning',
    BLOCCATO: 'blocked',
  };

  // Aprire un'app mostra l'icona di QUELL'app (parere dell'owner): la griglia del menu App resta solo per un'app non censita qui.
  // Chiavi: come l'azione nomina l'app (`app`, `id` o `nome`), in minuscolo.
  const APP = {
    mazzi: 'decks', deck: 'decks', decks: 'decks', board: 'decks',
    editor: 'editor', appunti: 'note', note: 'note',
    cronologia: 'history', history: 'history',
    crediti: 'credits', credits: 'credits',
    trasparenza: 'transparency', transparency: 'transparency',
    download: 'download', downloads: 'download', scaricati: 'download',
    feedback: 'feedback', segnalazioni: 'feedback',
    opzioni: 'options', options: 'options', preferenze: 'options', preferences: 'options',
    home: 'home', redteam: 'redteam',
  };

  const RIPIEGO = 'filoLogo';

  // `azione` è facoltativo: serve alle azioni la cui icona dipende dai parametri (oggi solo APRI_APP).
  function nome(type, azione) {
    const k = String(type || '').toUpperCase();
    if (k === 'APRI_APP' && azione && typeof azione === 'object') {
      const app = String(azione.app ?? azione.id ?? azione.nome ?? azione.name ?? '').trim().toLowerCase();
      if (Object.prototype.hasOwnProperty.call(APP, app)) return APP[app];
    }
    return AZIONI[k] || PREVISTE[k] || STATI[k] || RIPIEGO;
  }

  // Stringa SVG pronta per innerHTML (mai input utente: sicuro), oppure '' se la libreria delle icone non è caricata su questa pagina.
  function svg(type, size, azione) {
    const I = global.SN_ICONS;
    const fn = I && I[nome(type, azione)];
    return typeof fn === 'function' ? fn(size || 14) : '';
  }

  global.SN_ACTION_ICONS = { AZIONI, PREVISTE, STATI, APP, RIPIEGO, nome, svg };
})(typeof globalThis !== 'undefined' ? globalThis : self);
