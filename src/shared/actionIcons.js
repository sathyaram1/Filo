// Icona di ogni AZIONE dell'agente Filo: la tabella azione → nome in SN_ICONS.
//
// Il blocco di attività della chat (#521) racconta ogni passo con «icona +
// due parole». L'icona di un'azione sta in UN posto solo: qui. Chi disegna
// una riga chiede `SN_ACTION_ICONS.svg(type, size)` e non tiene emoji né
// glifi in tabelle sue.
//
// Tre tabelle:
//   - AZIONI:   le azioni registrate oggi in actionLevels.js (una sentinella
//               negli unit test diventa rossa se un'azione resta senza icona);
//   - PREVISTE: poteri che l'agente non ha ancora ma avrà a breve (posta,
//               pagina, voce, memoria…). I nomi sono indicativi: quando
//               l'azione nasce davvero, la si sposta in AZIONI col nome vero;
//   - STATI:    non azioni ma momenti del lavoro (ragiona, fatto, avviso,
//               bloccato) che il blocco mostra in testa.
//
// Un'azione senza icona (tipo sconosciuto) riceve il logo di Filo: meglio
// una riga con il marchio che una riga con un buco.

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

  const RIPIEGO = 'filoLogo';

  function nome(type) {
    const k = String(type || '').toUpperCase();
    return AZIONI[k] || PREVISTE[k] || STATI[k] || RIPIEGO;
  }

  // La stringa SVG pronta per innerHTML (mai input utente: sicuro), oppure ''
  // se la libreria delle icone non è caricata su questa pagina.
  function svg(type, size) {
    const I = global.SN_ICONS;
    const fn = I && I[nome(type)];
    return typeof fn === 'function' ? fn(size || 14) : '';
  }

  global.SN_ACTION_ICONS = { AZIONI, PREVISTE, STATI, RIPIEGO, nome, svg };
})(typeof globalThis !== 'undefined' ? globalThis : self);
