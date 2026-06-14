// Mappa "linguaggio naturale → preferenza dell'app" usata quando Filo modifica
// le impostazioni su richiesta dell'utente dalla chat (azione IMPOSTA_PREFERENZA).
//
// È volutamente un modulo condiviso (IIFE su globalThis): la conoscenza di
// QUALI preferenze sono modificabili e COME interpretarne i valori è la stessa
// esposta dalla pagina Preferenze, e deve restare testabile senza Electron.
//
// Espone SN_PREF = { buildPreferencePartial, parsePrefBool, PREF_SETTERS }.
// `buildPreferencePartial(chiave, valore)` → { partial, label } oppure null se
// chiave/valore non sono validi. Solo le preferenze qui elencate sono
// scrivibili: niente apiKeys, provider, ecc.

(function (global) {
  'use strict';

  // Interpreta un "sì/no" scritto in linguaggio naturale. true/false o null.
  function parsePrefBool(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    const s = String(v == null ? '' : v).trim().toLowerCase();
    if (['true', 'si', 'sì', 'on', 'attiva', 'attivo', 'attivare', 'attivata', 'attivato', 'mostra', 'mostrare', 'abilita', 'abilitato', 'abilitare', '1', 'yes', 'y'].includes(s)) return true;
    if (['false', 'no', 'off', 'disattiva', 'disattivo', 'disattivare', 'disattivata', 'disattivato', 'nascondi', 'nascondere', 'disabilita', 'disabilitato', 'disabilitare', '0', 'n'].includes(s)) return false;
    return null;
  }

  // Maschera una chiave API per l'etichetta di conferma: mostra i primi/ultimi
  // caratteri (così l'utente riconosce QUALE chiave sta impostando) senza
  // stampare l'intero segreto nel popup. Vedi i setter `chiave_*`.
  function maskKey(k) {
    const s = String(k == null ? '' : k).trim();
    if (s.length <= 8) return '••••';
    return `${s.slice(0, 4)}…${s.slice(-4)}`;
  }

  // Ogni voce: sinonimi di chiave + build(valore) → { partial, label }.
  // `partial` è il pezzo di settings da fondere (deepMerge preserva i campi
  // annidati vicini); `label` è la conferma leggibile per l'utente.
  // `level` (opzionale, default 1) è il livello di sicurezza quando è FILO a
  // cambiare la preferenza via chat (#146.2, vedi actionLevels.js): 1 applica
  // subito, 2 chiede conferma con popup.
  const PREF_SETTERS = [
    {
      keys: ['tema', 'theme', 'aspetto'],
      build(v) {
        const s = String(v == null ? '' : v).trim().toLowerCase();
        const map = {
          scuro: 'dark', dark: 'dark', buio: 'dark', nero: 'dark', notte: 'dark',
          chiaro: 'light', light: 'light', bianco: 'light', giorno: 'light',
          sistema: 'system', system: 'system', auto: 'system', automatico: 'system', 'come il sistema': 'system',
        };
        const theme = map[s];
        if (!theme) return null;
        const label = { dark: 'Scuro', light: 'Chiaro', system: 'Come il sistema' }[theme];
        return { partial: { theme }, label: `Tema → ${label}` };
      },
    },
    {
      keys: ['dimensione_testo', 'dimensione testo', 'dimensione del testo', 'textscale', 'grandezza testo', 'grandezza del testo', 'testo', 'font'],
      build(v) {
        const s = String(v == null ? '' : v).trim().toLowerCase();
        const byLabel = { piccolo: 0.9, normale: 1, medio: 1, grande: 1.1, 'molto grande': 1.25, enorme: 1.5, grandissimo: 1.5 };
        let scale = byLabel[s];
        if (scale === undefined) {
          let n = parseFloat(s.replace('%', '').replace(',', '.'));
          if (Number.isFinite(n)) {
            if (n > 3) n = n / 100; // "110" → 1.1
            const allowed = [0.9, 1, 1.1, 1.25, 1.5];
            scale = allowed.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
          }
        }
        if (scale === undefined) return null;
        return { partial: { textScale: scale }, label: `Dimensione del testo → ${Math.round(scale * 100)}%` };
      },
    },
    {
      keys: ['commento_home', 'commento nella home', 'commento home', 'messaggio home', 'messaggio nella home', 'showhomemessage', 'commento'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { showHomeMessage: b }, label: `Commento nella home → ${b ? 'mostrato' : 'nascosto'}` };
      },
    },
    {
      keys: ['stile_agente', 'stile agente', "stile dell'agente", 'agentstyle', 'stile'],
      build(v) {
        const s = String(v == null ? '' : v).trim();
        if (!s) return null;
        return { partial: { agentStyle: s }, label: "Stile dell'agente aggiornato" };
      },
    },
    {
      keys: ['archiviazione_automatica', 'archiviazione automatica', 'gestione automatica delle schede', 'gestione automatica schede', 'autoarchive', 'archiviazione', 'archivia automaticamente'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { autoArchive: { enabled: b } }, label: `Archiviazione automatica → ${b ? 'attiva' : 'disattivata'}` };
      },
    },
    {
      keys: ['archivia_alla_riapertura', 'riordina alla riapertura', 'archivia alla riapertura', 'autoarchiveonclose'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { autoArchive: { onClose: b } }, label: `Riordino alla riapertura → ${b ? 'attivo' : 'disattivato'}` };
      },
    },
    {
      keys: ['ore_inattivita', 'ore inattivita', 'ore di inattivita', 'ore_inattivita_archivio', 'idlehours', 'ore inattività'],
      build(v) {
        let n = parseInt(String(v == null ? '' : v).replace(/[^0-9]/g, ''), 10);
        if (!Number.isFinite(n) || n < 1) return null;
        n = Math.min(168, n);
        return { partial: { autoArchive: { idleHours: n } }, label: `Archivia dopo ${n} ore di inattività` };
      },
    },
    {
      keys: ['modalita_terminale', 'modalità terminale', 'modalita terminale', 'terminale', 'terminal'],
      // La modalità terminale dà a Filo accesso alla shell: conferma esplicita.
      level: 2,
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { terminal: { enabled: b } }, label: `Modalità terminale → ${b ? 'attiva' : 'disattivata'}` };
      },
    },
    {
      keys: ['shell_terminale', 'shell terminale', 'shell'],
      level: 2,
      build(v) {
        const s = String(v == null ? '' : v).trim().toLowerCase();
        const map = { powershell: 'powershell', ps: 'powershell', cmd: 'cmd', 'prompt dei comandi': 'cmd', prompt: 'cmd', bash: 'bash', wsl: 'bash' };
        const shell = map[s];
        if (!shell) return null;
        return { partial: { terminal: { shell } }, label: `Shell del terminale → ${shell}` };
      },
    },
    {
      keys: ['velocita_voce', 'velocità voce', 'velocita voce', 'velocità lettura', 'velocita lettura', 'ttsrate'],
      build(v) {
        let n = parseFloat(String(v == null ? '' : v).replace(',', '.').replace(/[^0-9.]/g, ''));
        if (!Number.isFinite(n)) return null;
        n = Math.max(0.5, Math.min(2, n));
        return { partial: { tts: { rate: n } }, label: `Velocità lettura → ${n.toFixed(1)}×` };
      },
    },
    {
      keys: ['tono_voce', 'tono voce', 'tono lettura', 'ttspitch'],
      build(v) {
        let n = parseFloat(String(v == null ? '' : v).replace(',', '.').replace(/[^0-9.]/g, ''));
        if (!Number.isFinite(n)) return null;
        n = Math.max(0, Math.min(2, n));
        return { partial: { tts: { pitch: n } }, label: `Tono lettura → ${n.toFixed(1)}` };
      },
    },

    // ── Funzionalità (interruttori) — reversibili, nessun rischio → livello 1 ──
    {
      keys: ['correttore', 'correttore ortografico', 'correttore_ortografico', 'controllo ortografico', 'spellcheck', 'correzione'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { featureFlags: { spellcheck: b } }, label: `Correttore ortografico → ${b ? 'attivo' : 'disattivato'}` };
      },
    },
    {
      keys: ['sidebar_aiuto', 'sidebar aiuto', 'pannello aiuto', 'aiuto', 'help', 'assistente aiuto'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { featureFlags: { help: b } }, label: `Sidebar Aiuto → ${b ? 'attiva' : 'disattivata'}` };
      },
    },
    {
      keys: ['categorizzazione', 'categorie automatiche', 'categorizza', 'categorie'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { featureFlags: { categorize: b } }, label: `Categorizzazione automatica → ${b ? 'attiva' : 'disattivata'}` };
      },
    },
    {
      keys: ['archivia_se_inattivo', 'archivia quando inattivo', 'archiviazione su inattivita', 'archivia se inattivo', 'archiviazione inattivita'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { autoArchive: { onIdle: b } }, label: `Archivia quando inattivo → ${b ? 'attivo' : 'disattivato'}` };
      },
    },

    // ── Sicurezza / privacy — livello 2 (popup di conferma prima di applicare) ──
    {
      keys: ['protezione_ip', 'protezione ip', 'proteggi ip', 'protezione ip locale', 'webrtc', 'protezione webrtc', 'ip locale'],
      level: 2,
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { security: { protectIpLeak: b } }, label: `Protezione IP locale (WebRTC) → ${b ? 'attiva' : 'disattivata'}` };
      },
    },
    {
      keys: ['blocco_popup', 'blocco popup', 'blocca popup', 'popup', 'finestre popup'],
      level: 2,
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { security: { blockPopups: b } }, label: `Blocco popup → ${b ? 'attivo' : 'disattivato'}` };
      },
    },
    {
      keys: ['navigazione_sicura', 'navigazione sicura', 'rilevamento siti pericolosi', 'siti pericolosi', 'safe browsing', 'safebrowsing', 'protezione phishing', 'rilevamento phishing'],
      level: 2,
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { security: { safeBrowse: { enabled: b } } }, label: `Rilevamento siti pericolosi → ${b ? 'attivo' : 'disattivato'}` };
      },
    },
    {
      keys: ['gestione_cookie', 'gestione cookie', 'gestione dei cookie', 'cookie', 'banner cookie', 'banner dei cookie'],
      level: 2,
      build(v) {
        const s = String(v == null ? '' : v).trim().toLowerCase();
        const map = {
          manuale: 'manual', manual: 'manual', 'a mano': 'manual', niente: 'manual', nessuna: 'manual', nessuno: 'manual',
          automatico: 'default', automatica: 'default', default: 'default', predefinito: 'default', auto: 'default', normale: 'default',
          privacy: 'privacy', riservatezza: 'privacy', massima: 'privacy', isolato: 'privacy', isolata: 'privacy',
        };
        const mode = map[s];
        if (!mode) return null;
        const labelMode = { manual: 'Manuale', default: 'Automatico', privacy: 'Privacy' }[mode];
        return { partial: { security: { cookies: { mode } } }, label: `Gestione cookie → ${labelMode}` };
      },
    },
    {
      keys: ['fingerprint', 'anti-fingerprinting', 'anti fingerprinting', 'antifingerprint', 'impronta digitale', 'protezione impronta', 'protezione fingerprint'],
      level: 2,
      build(v) {
        const s = String(v == null ? '' : v).trim().toLowerCase();
        const map = {
          off: 'off', no: 'off', disattivato: 'off', disattivata: 'off', spento: 'off', spenta: 'off', niente: 'off', nessuna: 'off',
          default: 'default', automatico: 'default', automatica: 'default', normale: 'default', settimanale: 'default', auto: 'default', attivo: 'default', attiva: 'default', standard: 'default',
          privacy: 'privacy', riservatezza: 'privacy', massima: 'privacy', massimo: 'privacy', sessione: 'privacy', 'per sessione': 'privacy',
        };
        const mode = map[s];
        if (!mode) return null;
        const labelMode = { off: 'Disattivato', default: 'Standard', privacy: 'Privacy' }[mode];
        return { partial: { security: { fingerprint: { mode } } }, label: `Anti-fingerprinting → ${labelMode}` };
      },
    },

    // ── Modelli / provider / chiavi / costi — livello 2 (conferma) ──
    {
      keys: ['modelli_predefiniti', 'modelli predefiniti', 'usa modelli predefiniti', 'modelli di default', 'configurazione predefinita modelli'],
      level: 2,
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { useDefaultModels: b }, label: `Modelli predefiniti → ${b ? 'attivi' : 'disattivati'}` };
      },
    },
    {
      keys: ['provider', 'fornitore', 'provider ai', 'provider modelli'],
      level: 2,
      build(v) {
        const s = String(v == null ? '' : v).trim().toLowerCase();
        const map = { openrouter: 'openrouter', 'open router': 'openrouter', or: 'openrouter', gemini: 'gemini', google: 'gemini' };
        const provider = map[s];
        if (!provider) return null;
        return { partial: { provider }, label: `Provider → ${provider === 'gemini' ? 'Google Gemini' : 'OpenRouter'}` };
      },
    },
    {
      keys: ['chiave_openrouter', 'chiave openrouter', 'api key openrouter', 'chiave api openrouter', 'openrouter key'],
      level: 2,
      build(v) {
        const s = String(v == null ? '' : v).trim();
        if (!s) return null;
        return { partial: { apiKeys: { openrouter: s } }, label: `Chiave OpenRouter → ${maskKey(s)}` };
      },
    },
    {
      keys: ['chiave_gemini', 'chiave gemini', 'chiave google', 'api key gemini', 'chiave api gemini', 'gemini key'],
      level: 2,
      build(v) {
        const s = String(v == null ? '' : v).trim();
        if (!s) return null;
        return { partial: { apiKeys: { gemini: s } }, label: `Chiave Google Gemini → ${maskKey(s)}` };
      },
    },
    {
      keys: ['chiave_tavily', 'chiave tavily', 'api key tavily', 'chiave ricerca', 'chiave api tavily', 'tavily key'],
      level: 2,
      build(v) {
        const s = String(v == null ? '' : v).trim();
        if (!s) return null;
        return { partial: { apiKeys: { tavily: s } }, label: `Chiave Tavily → ${maskKey(s)}` };
      },
    },
    {
      keys: ['limite_spesa', 'limite di spesa', 'limite spesa', 'limite di spesa mensile', 'limite mensile', 'budget mensile', 'spesa massima', 'limite costi', 'budget'],
      level: 2,
      build(v) {
        let n = parseFloat(String(v == null ? '' : v).replace(',', '.').replace(/[^0-9.]/g, ''));
        if (!Number.isFinite(n) || n < 0) return null;
        n = Math.min(10000, n);
        const eur = Number.isInteger(n) ? String(n) : n.toFixed(2);
        return { partial: { monthlyLimitEur: n }, label: `Limite di spesa mensile → ${eur}€` };
      },
    },
  ];

  // Trova il setter giusto per una chiave (match esatto, poi fuzzy) e costruisce
  // il partial. Ritorna { partial, label } o null se chiave/valore non validi.
  function buildPreferencePartial(rawKey, rawVal) {
    const key = String(rawKey == null ? '' : rawKey).trim().toLowerCase();
    if (!key) return null;
    const withLevel = (setter) => {
      const r = setter.build(rawVal);
      return r ? { ...r, level: setter.level || 1 } : null;
    };
    for (const setter of PREF_SETTERS) {
      if (setter.keys.includes(key)) return withLevel(setter);
    }
    for (const setter of PREF_SETTERS) {
      if (setter.keys.some((k) => key.includes(k) || k.includes(key))) return withLevel(setter);
    }
    return null;
  }

  global.SN_PREF = { buildPreferencePartial, parsePrefBool, PREF_SETTERS };
})(typeof globalThis !== 'undefined' ? globalThis : self);
