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
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { terminal: { enabled: b } }, label: `Modalità terminale → ${b ? 'attiva' : 'disattivata'}` };
      },
    },
    {
      keys: ['shell_terminale', 'shell terminale', 'shell'],
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
  ];

  // Trova il setter giusto per una chiave (match esatto, poi fuzzy) e costruisce
  // il partial. Ritorna { partial, label } o null se chiave/valore non validi.
  function buildPreferencePartial(rawKey, rawVal) {
    const key = String(rawKey == null ? '' : rawKey).trim().toLowerCase();
    if (!key) return null;
    for (const setter of PREF_SETTERS) {
      if (setter.keys.includes(key)) return setter.build(rawVal);
    }
    for (const setter of PREF_SETTERS) {
      if (setter.keys.some((k) => key.includes(k) || k.includes(key))) return setter.build(rawVal);
    }
    return null;
  }

  global.SN_PREF = { buildPreferencePartial, parsePrefBool, PREF_SETTERS };
})(typeof globalThis !== 'undefined' ? globalThis : self);
