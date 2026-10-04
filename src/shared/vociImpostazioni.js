// Le voci delle pagine delle impostazioni, una fonte sola (#949): per ogni controllo il percorso che scrive.
// Da qui la pagina sa cosa salva e riallinea, e la chat sa leggere (LEGGI_IMPOSTAZIONI) e cambiare ogni voce.
// Regole: tests/unit/vociImpostazioni.test.mjs (ogni controllo della pagina ha la sua voce e la sua chiave).

(function (global) {
  'use strict';

  // `campi`: id del controllo → percorso nelle impostazioni. `gruppi`: le sezioni che la pagina costruisce
  // da codice, con il percorso jolly delle loro voci. `fuori`: i controlli che non scrivono un'impostazione,
  // col perché.
  const PAGINE = {
    preferences: {
      titolo: 'Preferenze',
      campi: {
        theme: 'theme',
        textScale: 'textScale',
        showHomeMessage: 'showHomeMessage',
        tabPreviewEnabled: 'tabPreview.enabled',
        tabPreviewSize: 'tabPreview.size',
        autoArchiveEnabled: 'autoArchive.enabled',
        autoArchiveOnClose: 'autoArchive.onClose',
        autoArchiveIdleHours: 'autoArchive.idleHours',
        agentStylePreset: 'agentStyle',
        agentStyleText: 'agentStyle',
        ttsModelVoice: 'tts.modelVoice',
        ttsModelVoiceCustom: 'tts.modelVoice',
        ttsRate: 'tts.rate',
        ttsPitch: 'tts.pitch',
        ttsVoice: 'tts.voice',
        notifDuration: 'notifications.durationSec',
        notifSoundEnabled: 'notifications.soundEnabled',
        notifSound: 'notifications.sound',
        timerRingtone: 'timerRingtone',
        terminalEnabled: 'terminal.enabled',
        terminalShell: 'terminal.shell',
      },
      gruppi: { tokenCode: 'themeTokens.*', tabColorCode: 'tabColor.*' },
      fuori: {},
    },
    security: {
      titolo: 'Sicurezza',
      campi: {
        'sec-protect-ip': 'security.protectIpLeak',
        'sec-block-popups': 'security.blockPopups',
        'sec-adblock': 'security.adblock.enabled',
        'sec-adskip': 'security.adSkip.enabled',
        'sec-siteblock': 'security.siteBlock.enabled',
        'sec-siteblock-lists': 'security.siteBlock.useAdblockLists',
        'sec-siteblock-blacklist': 'security.siteBlock.blacklist',
        'sec-dl-exe': 'security.downloads.confirmExecutables',
        'sec-dl-trusted': 'security.downloads.trustedSites',
        'sec-safebrowse': 'security.safeBrowse.enabled',
        'sec-safebrowse-network': 'security.safeBrowse.networkSignals',
        'sec-safebrowse-llm': 'security.safeBrowse.llmJudge',
        'sec-safebrowse-sandbox': 'security.safeBrowse.sandbox',
        'sec-auto-feedback': 'security.autoFeedback',
        'cookie-mode-manual': 'security.cookies.mode',
        'cookie-mode-default': 'security.cookies.mode',
        'cookie-mode-privacy': 'security.cookies.mode',
        'cookie-wl-input': 'security.cookies.trustedSites',
        'fp-mode-off': 'security.fingerprint.mode',
        'fp-mode-default': 'security.fingerprint.mode',
        'fp-mode-privacy': 'security.fingerprint.mode',
      },
      gruppi: { 'sec-cookies-banners': 'security.cookies.bannerSites' },
      fuori: {},
    },
    options: {
      titolo: 'Modelli',
      campi: {
        useDefaultModels: 'useDefaultModels',
        openWeightsOnly: 'openWeightsOnly',
        apiKey: 'apiKeys.openrouter',
        apiKeyTavily: 'apiKeys.tavily',
        monthlyLimit: 'monthlyLimitEur',
      },
      gruppi: {},
      fuori: {},
    },
    altro: {
      titolo: 'Altro',
      campi: { blocklist: 'blocklist' },
      gruppi: {},
      fuori: {},
    },
  };

  // Quando la chiave manca: il valore che la pagina mostra e che il main applica. Il resto viene dai default.
  const ASSENTE = { 'security.autoFeedback': true };

  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  function dentro(o, percorso) {
    return String(percorso).split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
  }
  function jolly(percorso) {
    return String(percorso).endsWith('.*');
  }
  // Le voci di un percorso jolly: i token estetici, i sei parametri del colore delle tab.
  function espandi(percorso) {
    if (!jolly(percorso)) return [percorso];
    const base = percorso.slice(0, -2);
    if (base === 'themeTokens') {
      const T = global.SN_THEME_TOKENS;
      return T && T.names ? T.names().map((n) => `themeTokens.${n}`) : [];
    }
    if (base === 'tabColor') {
      const TC = global.SN_TAB_COLOR;
      return TC && Array.isArray(TC.IDENTITY_PARAM_META) ? TC.IDENTITY_PARAM_META.map((m) => `tabColor.${m.key}`) : [];
    }
    return [];
  }

  function campi(pagina) {
    return { ...((PAGINE[pagina] && PAGINE[pagina].campi) || {}) };
  }

  function leggi(settings, percorso) {
    const v = dentro(settings, percorso);
    if (v !== undefined && v !== null) return v;
    if (has(ASSENTE, percorso)) return ASSENTE[percorso];
    const C = global.SN_CONST;
    const d = C && C.DEFAULT_SETTINGS ? dentro(C.DEFAULT_SETTINGS, percorso) : undefined;
    return d === undefined ? v : d;
  }

  // ── Le voci per la chat ────────────────────────────────────────────────────
  // Come la chat la cambia: la chiave di IMPOSTA_PREFERENZA, o il token di IMPOSTA_ESTETICA.
  function chiaveDi(percorso) {
    if (percorso.startsWith('themeTokens.')) return { come: `IMPOSTA_ESTETICA token ${percorso.slice(12)}`, chiave: '', conferma: false };
    const P = global.SN_PREF;
    const s = P && P.setterDi ? P.setterDi(percorso) : null;
    return s ? { come: `chiave ${s.keys[0]}`, chiave: s.keys[0], conferma: s.level === 2 } : { come: '', chiave: '', conferma: false };
  }
  function minuscola(s) {
    return s.charAt(0).toLowerCase() + s.slice(1);
  }
  function nomeDi(percorso) {
    if (percorso.startsWith('themeTokens.')) {
      const T = global.SN_THEME_TOKENS;
      const t = T && T.get ? T.get(percorso.slice(12)) : null;
      return `aspetto, ${t && t.label ? minuscola(t.label) : percorso.slice(12)}`;
    }
    const K = global.SN_CAMBI;
    const v = K && K.voce ? K.voce(percorso) : null;
    return v && v.nome ? v.nome : percorso;
  }

  // Ogni voce leggibile: quelle delle pagine, nell'ordine della pagina, poi quelle che la chat cambia
  // senza che stiano in una di queste pagine.
  function voci() {
    const out = [];
    const visti = new Set();
    const aggiungi = (percorso, pagina) => {
      if (visti.has(percorso)) return;
      visti.add(percorso);
      const k = chiaveDi(percorso);
      out.push({
        percorso,
        pagina,
        titolo: pagina ? PAGINE[pagina].titolo : 'Altre impostazioni',
        nome: nomeDi(percorso),
        ...k,
      });
    };
    for (const [pagina, def] of Object.entries(PAGINE)) {
      for (const p of [...Object.values(def.campi), ...Object.values(def.gruppi || {})]) {
        for (const q of espandi(p)) aggiungi(q, pagina);
      }
    }
    const P = global.SN_PREF;
    for (const s of (P && P.PREF_SETTERS) || []) for (const p of s.scrive || []) aggiungi(p, null);
    return out;
  }

  const NON_CERCARE = new Set(['come', 'cosa', 'che', 'con', 'per', 'sono', 'quale', 'quali', 'impostato', 'impostata',
    'impostati', 'impostate', 'impostazione', 'impostazioni', 'attivo', 'attiva', 'attivi', 'acceso', 'accesa', 'spento',
    'spenta', 'adesso', 'filo', 'mio', 'mia', 'miei', 'mie', 'hai', 'dimmi', 'della', 'delle', 'dello', 'degli', 'dei',
    'del', 'nel', 'nella', 'una', 'uno', 'gli', 'le', 'il', 'la', 'di', 'da']);
  function piano(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[_.\-'’«»"]/g, ' ');
  }
  function radice(w) {
    return w.length > 5 ? w.slice(0, w.length - 2) : w;
  }
  function sinonimi(percorso) {
    const P = global.SN_PREF;
    const s = P && P.setterDi ? P.setterDi(percorso) : null;
    return s ? s.keys.join(' ') : '';
  }
  function cercaVoci(tutte, cerca) {
    const parole = piano(cerca).split(/\s+/).filter((w) => w.length >= 3 && !NON_CERCARE.has(w)).map(radice);
    if (!parole.length) return tutte;
    return tutte.filter((v) => {
      const testo = piano(`${v.nome} ${v.come} ${v.percorso} ${v.titolo} ${sinonimi(v.percorso)}`);
      return parole.some((w) => testo.includes(w));
    });
  }

  // Il valore come lo legge una persona. I segreti non escono mai.
  const MAX_ELENCO = 100;
  function valoreLeggibile(percorso, settings, { tema = 'light', sistema = '' } = {}) {
    const v = leggi(settings, percorso);
    if (percorso.startsWith('themeTokens.')) {
      const T = global.SN_THEME_TOKENS;
      const nome = percorso.slice(12);
      const over = (settings && settings.themeTokens) || {};
      const eff = T && T.effectiveValue ? T.effectiveValue(nome, over, tema) : v;
      const t = T && T.get ? T.get(nome) : null;
      const cat = t && t.category && has(over, t.category) && T.get(t.category);
      const da = has(over, nome) ? 'personalizzato' : (cat ? `segue ${minuscola(cat.label)}` : 'predefinito');
      return `${eff == null ? 'predefinito' : eff} (${da})`;
    }
    const K = global.SN_CAMBI;
    const voce = K && K.voce ? K.voce(percorso) : null;
    if (voce && voce.segreto) return v ? 'inserita (il valore non si mostra)' : 'non inserita';
    if (Array.isArray(v)) {
      const l = v.filter((x) => typeof x === 'string' && x.trim());
      if (!l.length) return 'elenco vuoto';
      const altri = l.length > MAX_ELENCO ? ` e altri ${l.length - MAX_ELENCO} (chiedi con una parola del sito per vederli)` : '';
      return `${l.length} ${l.length === 1 ? 'voce' : 'voci'}: ${l.slice(0, MAX_ELENCO).join(', ')}${altri}`;
    }
    if (voce && voce.testo) return String(v || '').trim() ? `«${String(v).trim()}»` : 'nessuno';
    if (percorso === 'terminal.shell' && sistema && sistema !== 'win32' && !['bash', 'sh'].includes(v)) return 'shell di sistema (sh)';
    if (K && K.valore) return K.valore(percorso, v);
    return typeof v === 'boolean' ? (v ? 'sì' : 'no') : String(v == null ? 'nessuno' : v);
  }

  // Le righe che LEGGI_IMPOSTAZIONI restituisce al modello, divise per pagina.
  function righePerModello(settings, { cerca = '', tema = 'light', sistema = '' } = {}) {
    const tutte = voci();
    let scelte = cercaVoci(tutte, cerca);
    const nessuna = !!String(cerca || '').trim() && !scelte.length;
    if (nessuna) scelte = tutte;
    const righe = [];
    let titolo = null;
    for (const v of scelte) {
      if (v.titolo !== titolo) {
        titolo = v.titolo;
        righe.push(v.pagina ? `${titolo} (pagina)` : `${titolo} (si cambiano dalla chat o dalle loro pagine)`);
      }
      const chiave = v.come ? ` [${v.come}${v.conferma ? ', chiede conferma' : ''}]` : '';
      righe.push(`- ${v.nome}: ${valoreLeggibile(v.percorso, settings, { tema, sistema })}${chiave}`);
    }
    return { righe, trovate: nessuna ? 0 : scelte.length, totale: tutte.length };
  }

  // ── Le pagine aperte seguono un cambio arrivato da altrove (la chat, un'altra scheda) ──
  // `salta(id)`: i campi che l'utente sta toccando. `elenco(id, valore)`: come la pagina scrive un elenco.
  function riallineaPagina(pagina, settings, { doc = global.document, salta = () => false, elenco = null } = {}) {
    const def = PAGINE[pagina];
    const cambiati = [];
    if (!def || !settings || !doc) return cambiati;
    for (const [id, percorso] of Object.entries(def.campi)) {
      const el = doc.getElementById(id);
      if (!el || salta(id, percorso, el)) continue;
      const v = leggi(settings, percorso);
      if (el.type === 'checkbox') {
        if (el.checked !== !!v) { el.checked = !!v; cambiati.push(id); }
      } else if (el.type === 'radio') {
        if (el.value === String(v) && !el.checked) { el.checked = true; cambiati.push(id); }
      } else {
        const testo = Array.isArray(v) ? (elenco ? elenco(id, v) : v.join('\n')) : String(v == null ? '' : v);
        if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === testo)) continue;
        if (el.value !== testo) { el.value = testo; cambiati.push(id); }
      }
    }
    return cambiati;
  }

  global.SN_VOCI_IMPOSTAZIONI = {
    PAGINE, campi, leggi, espandi, voci, cercaVoci, valoreLeggibile, righePerModello, riallineaPagina,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
