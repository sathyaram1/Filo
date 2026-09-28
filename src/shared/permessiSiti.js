// I permessi che un sito chiede (fotocamera, posizione, notifiche…): quali sono innocui, come si nominano, cosa decide.
// Logica pura: la applica il main (services/permessiSiti.js), la mostrano la barra e la pagina Sicurezza.
// Regole e casi limite: tests/unit/permessiSiti.test.mjs.

(function (global) {
  'use strict';

  // L'ordine è quello in cui si mostrano. `ricorda: false`: vale per quella volta sola, mai salvata.
  // `continuo`: una volta aperto il flusso resta alla pagina; toglierlo vale dalla richiesta dopo.
  const TIPI = {
    camera: { nome: 'Fotocamera', icona: 'camera', verbo: 'usare la fotocamera', continuo: true },
    microfono: { nome: 'Microfono', icona: 'mic', verbo: 'usare il microfono', continuo: true },
    schermo: { nome: 'Schermo', icona: 'screenshot', verbo: 'vedere il tuo schermo', ricorda: false },
    posizione: { nome: 'Posizione', icona: 'location', verbo: 'sapere dove ti trovi', continuo: true },
    notifiche: { nome: 'Notifiche', icona: 'bell', verbo: 'mandarti notifiche' },
    appunti: { nome: 'Appunti', icona: 'clipboard', verbo: 'leggere quello che hai copiato' },
    midi: { nome: 'Strumenti MIDI', icona: 'lock', verbo: 'usare i tuoi strumenti MIDI' },
    midiCompleto: { nome: 'Controllo MIDI', icona: 'lock', verbo: 'controllare e riprogrammare i tuoi strumenti MIDI' },
    presenza: { nome: 'Presenza', icona: 'lock', verbo: 'sapere quando non sei al computer' },
    schermi: { nome: 'Schermi collegati', icona: 'lock', verbo: 'vedere i tuoi schermi e aprirci finestre' },
    casse: { nome: 'Uscita audio', icona: 'lock', verbo: 'scegliere da dove esce l’audio' },
    cookie: { nome: 'Cookie dentro altri siti', icona: 'lock', verbo: 'usare i suoi cookie mentre è dentro un altro sito' },
    app: { nome: 'Aprire altre app', icona: 'lock', verbo: 'aprire un’altra app del computer' },
    file: { nome: 'Modificare file', icona: 'lock', verbo: 'modificare i file che gli apri' },
    cartelle: { nome: 'Leggere cartelle', icona: 'lock', verbo: 'leggere i file di una cartella che scegli' },
    altro: { nome: 'Altri permessi', icona: 'lock', verbo: 'usare un permesso che Filo non conosce' },
  };

  // Concessi senza chiedere: nessuno legge o manda fuori qualcosa dell'utente.
  const INNOCUI = new Set(['clipboard-sanitized-write', 'fullscreen', 'pointerLock', 'keyboardLock', 'mediaKeySystem']);

  // Gli stessi che Filo consegna al sistema da sé per i link (tabs.js, OS_DELEGATED_SCHEMES).
  const SCHEMI_ESTERNI_INNOCUI = new Set(['mailto:', 'tel:', 'sms:']);

  const SEMPLICI = {
    geolocation: 'posizione',
    notifications: 'notifiche',
    'clipboard-read': 'appunti',
    'deprecated-sync-clipboard-read': 'appunti',
    'display-capture': 'schermo',
    midi: 'midi',
    midiSysex: 'midiCompleto',
    'idle-detection': 'presenza',
    'window-management': 'schermi',
    'speaker-selection': 'casse',
    'storage-access': 'cookie',
    'top-level-storage-access': 'cookie',
    openExternal: 'app',
  };

  function eTipo(t) { return Object.prototype.hasOwnProperty.call(TIPI, t); }
  function ricordabile(t) { return eTipo(t) && TIPI[t].ricorda !== false; }

  function schema(url) {
    try { return new URL(String(url || '')).protocol.toLowerCase(); } catch (_) { return ''; }
  }

  function eFilo(url) { return schema(url) === 'filo:'; }

  // Solo le origini che il browser garantisce: http(s). Il resto (data:, file:, about:) non ha un sito da ricordare.
  function origineDi(url) {
    let u;
    try { u = new URL(String(url || '')); } catch (_) { return ''; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.origin;
  }

  function hostDi(origine) {
    try { return new URL(String(origine || '')).host; } catch (_) { return String(origine || ''); }
  }

  // Una richiesta di Electron → i tipi che l'utente deve approvare. `innocuo` passa senza chiedere.
  function tipiRichiesta(permesso, dettagli) {
    const d = dettagli || {};
    if (INNOCUI.has(permesso)) return { innocuo: true, tipi: [] };
    if (permesso === 'media') {
      const m = Array.isArray(d.mediaTypes) ? d.mediaTypes : [];
      const tipi = [];
      if (m.includes('video')) tipi.push('camera');
      if (m.includes('audio')) tipi.push('microfono');
      // Senza tracce chieste è la condivisione dello schermo (getDisplayMedia passa di qui prima).
      return { innocuo: false, tipi: tipi.length ? tipi : ['schermo'] };
    }
    if (permesso === 'openExternal' && SCHEMI_ESTERNI_INNOCUI.has(schema(d.externalURL))) {
      return { innocuo: true, tipi: [] };
    }
    if (permesso === 'fileSystem') {
      if (d.fileAccessType === 'writable') return { innocuo: false, tipi: ['file'] };
      return d.isDirectory ? { innocuo: false, tipi: ['cartelle'] } : { innocuo: true, tipi: [] };
    }
    if (Object.prototype.hasOwnProperty.call(SEMPLICI, permesso)) return { innocuo: false, tipi: [SEMPLICI[permesso]] };
    return { innocuo: false, tipi: ['altro'] };
  }

  // Il controllo silenzioso (Notification.permission, permissions.query): vero solo con un sì già dato.
  function consentitoAlControllo(permesso, dettagli, scelte) {
    const d = dettagli || {};
    if (INNOCUI.has(permesso)) return true;
    const si = (t) => !!scelte && scelte[t] === 'consenti';
    if (permesso === 'media') {
      if (d.mediaType === 'video') return si('camera');
      if (d.mediaType === 'audio') return si('microfono');
      return si('camera') || si('microfono');
    }
    if (permesso === 'speaker-selection') return si('casse') || si('microfono');
    const { innocuo, tipi } = tipiRichiesta(permesso, d);
    if (innocuo) return true;
    return tipi.length > 0 && tipi.every((t) => ricordabile(t) && si(t));
  }

  // Un no ricordato vince su tutto; manca un sì → si chiede solo quello che manca.
  function decidi(scelte, tipi) {
    const mancanti = [];
    for (const t of tipi || []) {
      const s = scelte ? scelte[t] : undefined;
      if (s === 'nega' && ricordabile(t)) return { esito: 'nega', tipo: t };
      if (s !== 'consenti' || !ricordabile(t)) mancanti.push(t);
    }
    return mancanti.length ? { esito: 'chiedi', tipi: mancanti } : { esito: 'consenti' };
  }

  function verbi(tipi) {
    const t = (tipi || []).filter(eTipo);
    if (t.length === 2 && t.includes('camera') && t.includes('microfono')) return 'usare la fotocamera e il microfono';
    const v = t.map((x) => TIPI[x].verbo);
    if (v.length <= 1) return v[0] || TIPI.altro.verbo;
    return `${v.slice(0, -1).join(', ')} e ${v[v.length - 1]}`;
  }

  function domanda(origine, tipi) {
    return `${hostDi(origine)} vuole ${verbi(tipi)}`;
  }

  function statoLeggibile(tipo, scelta) {
    const nome = eTipo(tipo) ? TIPI[tipo].nome : tipo;
    return `${nome}: ${scelta === 'consenti' ? 'consentito' : 'bloccato'}`;
  }

  // Quello che arriva dal disco (o da un backup importato) si rilegge da capo: chiavi e valori li ha scritti qualcun altro.
  function normalizza(grezzo) {
    const out = Object.create(null);
    if (!grezzo || typeof grezzo !== 'object' || Array.isArray(grezzo)) return out;
    for (const chiave of Object.keys(grezzo)) {
      const origine = origineDi(chiave);
      if (!origine || origine !== chiave) continue;
      const voce = grezzo[chiave];
      if (!voce || typeof voce !== 'object' || Array.isArray(voce)) continue;
      const scelte = Object.create(null);
      for (const t of Object.keys(voce)) {
        const s = voce[t];
        if (ricordabile(t) && (s === 'consenti' || s === 'nega')) scelte[t] = s;
      }
      if (Object.keys(scelte).length) out[origine] = scelte;
    }
    return out;
  }

  const api = {
    TIPI, INNOCUI, eTipo, ricordabile, eFilo, origineDi, hostDi,
    tipiRichiesta, consentitoAlControllo, decidi, verbi, domanda, statoLeggibile, normalizza,
  };
  global.SN_PERMESSI_SITI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
