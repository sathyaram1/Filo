// Tabella azione → nome dell'icona, in un posto solo: chi disegna una riga chiede
// `SN_ACTION_ICONS.svg(type)` invece di tenersi una tabella di emoji sua.
// Tipo sconosciuto → logo di Filo: meglio il marchio che un buco.

(function (global) {
  'use strict';

  const AZIONI = {
    NAVIGA: 'openTab',
    APRI_FILE: 'folder',
    RINOMINA_FILE: 'pencil',
    TIMER: 'timer',
    SVEGLIA: 'alarm',
    CANCELLA_SVEGLIA: 'alarmOff',
    MODIFICA_SVEGLIA: 'alarmShift',
    SALVA_APPUNTO: 'note',
    SALVA_LEZIONE: 'pin',
    INVIA_FEEDBACK: 'feedback',
    CERCA_WEB: 'searchWeb',
    // #525 — rileggere le conversazioni di prima: l'icona è quella della
    // cronologia, che è esattamente quello che sta facendo.
    CERCA_CHAT: 'history',
    CERCA_SALVATE: 'saveForLater',
    APRI_SALVATA: 'openTab',
    ONBOARDING: 'checklist',
    CAPACITA_DETTAGLIO: 'clipboard',
    LEGGI_FILE: 'readDocument',
    LEGGI_DOCUMENTO: 'readDocument',
    LEGGI_PAGINA: 'readPage',
    CERCA_DOCUMENTI: 'search',
    LEGGI_TRASPARENZA: 'transparency',
    LEGGI_IMPOSTAZIONI: 'options',
    TOGLI_PERMESSO_SITO: 'eraser',
    EVENTO_CALENDARIO: 'calendar',
    PULISCI_TAB: 'broom',
    CANCELLA_ARCHIVIO: 'trash',
    CANCELLA_MEMORIA: 'eraser',
    DIMENTICA: 'eraser',
    TOGLI_CHAT: 'trash',
    RIMETTI_CHAT: 'restore',
    CORREGGI_MEMORIA: 'pencil',
    CANCELLA_PAGINE: 'eraser',
    IMPOSTA_PREFERENZA: 'options',
    IMPOSTA_ESTETICA: 'palette',
    ESEGUI_COMANDO: 'terminal',
    PROXY_TAB: 'globe',
    RIMUOVI_PROXY: 'globeOff',
    RIMUOVI_PROXY_TUTTE: 'globeOff',
    REGOLA_PROXY_DOMINIO: 'globePinned',
    RIMUOVI_REGOLA_PROXY: 'globeOff',
    TIENI_APERTA: 'pin',
    NON_TENERE_APERTA: 'eraser',
    COMANDO_FINESTRA: 'windowFrame',
    SPOSTA_ICONA: 'pin',
    INSTALLA_AGGIORNAMENTO: 'download',
    RIMEDIO_CREDITI: 'credits',
    CARTA_HOME: 'home',
    ZOOM_PAGINA: 'zoomPagina',
    VOLUME: 'volume',
    BLUETOOTH: 'bluetooth',
    WIFI: 'wifi',
    STILE_PAGINA: 'brush',
    RIPRISTINA_STILE_PAGINA: 'undo',
    ANNULLA_CAMBIO: 'undo',
    VEDI_SCHERMO: 'screenshot',
  };

  const PREVISTE = {
    LEGGI_POSTA: 'mailOpen',
    INVIA_POSTA: 'mailSend',
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

  // Aprire un'app mostra l'icona di QUELL'app: la griglia resta per le app non censite qui.
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

  // `azione` è facoltativo: serve dove l'icona dipende dai parametri (oggi solo APRI_APP).
  function nome(type, azione) {
    const k = String(type || '').toUpperCase();
    if (k === 'APRI_APP' && azione && typeof azione === 'object') {
      const app = String(azione.app ?? azione.id ?? azione.nome ?? azione.name ?? '').trim().toLowerCase();
      if (Object.prototype.hasOwnProperty.call(APP, app)) return APP[app];
    }
    return AZIONI[k] || PREVISTE[k] || STATI[k] || RIPIEGO;
  }

  // Stringa SVG pronta per innerHTML: mai input utente, quindi sicura.
  // '' se la libreria delle icone non è caricata su questa pagina.
  function svg(type, size, azione) {
    const I = global.SN_ICONS;
    const fn = I && I[nome(type, azione)];
    return typeof fn === 'function' ? fn(size || 14) : '';
  }

  global.SN_ACTION_ICONS = { AZIONI, PREVISTE, STATI, APP, RIPIEGO, nome, svg };
})(typeof globalThis !== 'undefined' ? globalThis : self);
