// Mappa "linguaggio naturale → preferenza dell'app" usata quando Filo modifica
// le impostazioni su richiesta dell'utente dalla chat (azione IMPOSTA_PREFERENZA).
//
// È volutamente un modulo condiviso (IIFE su globalThis): la conoscenza di
// QUALI preferenze sono modificabili e COME interpretarne i valori è la stessa
// esposta dalla pagina Preferenze, e deve restare testabile senza Electron.
//
// Espone SN_PREF = { buildPreferencePartial, parsePrefBool, PREF_SETTERS }.
// `buildPreferencePartial(chiave, valore)` → { partial, label, level, risk }
// oppure null se chiave/valore non sono validi. Solo le preferenze qui elencate
// sono scrivibili. Dal #146.5 l'elenco copre TUTTE le impostazioni della pagina
// Opzioni (modelli, provider, chiavi API, sicurezza/privacy, limite di spesa,
// funzionalità) oltre a quelle estetiche/comportamentali: ognuna dichiara il
// proprio `level` (1 = applica subito, 2 = popup di conferma). Le impostazioni
// sensibili (sicurezza, modelli, chiavi, provider, costi) sono di livello 2.
//
// REGOLA (#183): ogni setter di livello 2 DEVE dichiarare anche `risk` — una
// frase in chiaro che spiega cosa controlla l'impostazione e quali sono gli
// eventuali rischi. È il testo che il popup di conferma mostra all'utente
// (lo compone actionLevels.describe). Un setter di livello 2 senza `risk` è
// un bug: il test tests/unit/preferences.test.mjs lo intercetta.

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

  // Interpreta un numero scritto in linguaggio naturale tollerando il formato
  // italiano (punto = separatore delle migliaia, virgola = decimale) SENZA
  // rompere il formato inglese (punto decimale). Nasce dal bug: "2.500 euro"
  // veniva letto come 2,50 perché il punto delle migliaia finiva per fare da
  // separatore decimale. Regole di disambiguazione (nell'ordine):
  //   • se c'è una virgola → è SEMPRE il decimale, e ogni punto è migliaia:
  //       "2.500,50" → 2500.50   "1.234,5" → 1234.5   "2,50" → 2.5
  //   • se ci sono SOLO punti e la stringa è fatta di gruppi da 3 cifre
  //     (es. "2.500", "1.000", "1.234.567") → sono separatori di migliaia:
  //       "2.500" → 2500   "1.000" → 1000
  //   • altrimenti il punto è decimale (formato inglese), invariato:
  //       "1.5" → 1.5   "2.50" → 2.5   "0.9" → 0.9
  // Ritorna un numero finito oppure NaN.
  function parseItalianNumber(raw) {
    let s = String(raw == null ? '' : raw).trim().replace(/[^0-9.,-]/g, '');
    if (!s) return NaN;
    if (s.includes(',')) {
      // virgola = decimale, punto = migliaia (formato italiano completo)
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
      // solo punti come raggruppamento delle migliaia (gruppi esatti da 3)
      s = s.replace(/\./g, '');
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : NaN;
  }

  // Ogni voce: sinonimi di chiave + build(valore) → { partial, label }.
  // `partial` è il pezzo di settings da fondere (deepMerge preserva i campi
  // annidati vicini); `label` è la conferma leggibile per l'utente.
  // `level` (opzionale, default 1) è il livello di sicurezza quando è FILO a
  // cambiare la preferenza via chat (#146.2, vedi actionLevels.js): 1 applica
  // subito, 2 chiede conferma con popup. `risk` (obbligatorio quando level=2,
  // #183) è la spiegazione in chiaro mostrata nel popup: cosa controlla
  // l'impostazione e quali rischi comporta toccarla.
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
          let n = parseItalianNumber(s.replace('%', ''));
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
      risk: 'Questa impostazione decide se Filo può eseguire comandi nella shell del tuo computer. '
        + 'È un permesso potente: una volta attivo, Filo può lanciare comandi (quelli rischiosi '
        + 'chiederanno comunque una conferma a parte). Attivalo solo se ti fidi di quello che gli chiedi.',
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { terminal: { enabled: b } }, label: `Modalità terminale → ${b ? 'attiva' : 'disattivata'}` };
      },
    },
    {
      keys: ['shell_terminale', 'shell terminale', 'shell'],
      level: 2,
      risk: 'Sceglie quale shell usa Filo per eseguire i comandi del terminale (PowerShell, '
        + 'Prompt dei comandi o Bash). Cambia come vengono interpretati i comandi che Filo lancia.',
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
        let n = parseItalianNumber(v);
        if (!Number.isFinite(n)) return null;
        n = Math.max(0.5, Math.min(2, n));
        return { partial: { tts: { rate: n } }, label: `Velocità lettura → ${n.toFixed(1)}×` };
      },
    },
    {
      keys: ['tono_voce', 'tono voce', 'tono lettura', 'ttspitch'],
      build(v) {
        let n = parseItalianNumber(v);
        if (!Number.isFinite(n)) return null;
        n = Math.max(0, Math.min(2, n));
        return { partial: { tts: { pitch: n } }, label: `Tono lettura → ${n.toFixed(1)}` };
      },
    },
    {
      // La voce TTS è una stringa URI (voiceURI o nome del sistema): si imposta
      // passando la stringa esatta come valore (il sistema la riconosce all'avvio).
      // Reversibile (puoi cambiarla di nuovo) → livello 1.
      keys: ['voce', 'voce lettura', 'voce tts', 'ttsvoice', 'voce del sistema'],
      build(v) {
        const s = String(v == null ? '' : v).trim();
        if (!s) return null;
        return { partial: { tts: { voice: s } }, label: `Voce di lettura → "${s}"` };
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
      risk: 'Controlla la protezione che impedisce ai siti di scoprire il tuo indirizzo IP locale '
        + 'tramite WebRTC. Disattivarla espone più informazioni sulla tua rete ai siti che visiti.',
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { security: { protectIpLeak: b } }, label: `Protezione IP locale (WebRTC) → ${b ? 'attiva' : 'disattivata'}` };
      },
    },
    {
      keys: ['blocco_popup', 'blocco popup', 'blocca popup', 'popup', 'finestre popup'],
      level: 2,
      risk: 'Controlla il blocco delle finestre popup. Disattivarlo permette ai siti di aprire '
        + 'finestre da soli, anche pubblicitarie o ingannevoli.',
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { security: { blockPopups: b } }, label: `Blocco popup → ${b ? 'attivo' : 'disattivato'}` };
      },
    },
    {
      keys: ['navigazione_sicura', 'navigazione sicura', 'rilevamento siti pericolosi', 'siti pericolosi', 'safe browsing', 'safebrowsing', 'protezione phishing', 'rilevamento phishing'],
      level: 2,
      risk: 'Controlla il rilevamento dei siti pericolosi (phishing e malware). Disattivarlo '
        + 'toglie l’avviso prima che tu apra un sito potenzialmente dannoso.',
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { security: { safeBrowse: { enabled: b } } }, label: `Rilevamento siti pericolosi → ${b ? 'attivo' : 'disattivato'}` };
      },
    },
    {
      keys: ['gestione_cookie', 'gestione cookie', 'gestione dei cookie', 'cookie', 'banner cookie', 'banner dei cookie'],
      level: 2,
      risk: 'Decide come Filo gestisce i cookie dei siti. Le modalità più permissive aumentano '
        + 'il tracciamento pubblicitario; quelle più strette possono farti perdere i login già attivi.',
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
      risk: 'Controlla la protezione contro il fingerprinting, cioè il riconoscimento del tuo '
        + 'browser tra un sito e l’altro. Cambiarla incide sulla tua privacy e su come i siti ti identificano.',
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
      risk: 'Decide se Filo usa i modelli AI predefiniti o la tua configurazione personalizzata. '
        + 'Cambia quali modelli elaborano le tue richieste, con effetti su qualità e costi.',
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { useDefaultModels: b }, label: `Modelli predefiniti → ${b ? 'attivi' : 'disattivati'}` };
      },
    },
    {
      keys: ['solo_pesi_aperti', 'solo pesi aperti', 'modelli a pesi aperti', 'solo modelli a pesi aperti',
        'solo modelli aperti', 'modelli aperti', 'modelli proprietari', 'niente modelli proprietari',
        'disattiva modelli proprietari', 'open weights'],
      level: 2,
      risk: 'Spegne tutti i modelli proprietari (Anthropic compresa) e lascia lavorare solo modelli '
        + 'a pesi aperti serviti da fornitori indipendenti. Alcune funzioni cambiano modello e quelle '
        + 'senza equivalente aperto smettono di funzionare finché non lo rispegni.',
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return {
          partial: { openWeightsOnly: b },
          label: `Solo modelli a pesi aperti → ${b ? 'attivo' : 'disattivato'}`,
        };
      },
    },
    {
      keys: ['provider', 'fornitore', 'provider ai', 'provider modelli'],
      level: 2,
      risk: 'Cambia il fornitore AI che elabora le tue richieste (OpenRouter o Google Gemini). '
        + 'Le richieste e i relativi costi passeranno dal nuovo provider, con la sua chiave API.',
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
      risk: 'Imposta la chiave API di OpenRouter. È una credenziale che autorizza spese sul tuo '
        + 'account: confermala solo se questa chiave arriva davvero da te.',
      build(v) {
        const s = String(v == null ? '' : v).trim();
        if (!s) return null;
        return { partial: { apiKeys: { openrouter: s } }, label: `Chiave OpenRouter → ${maskKey(s)}` };
      },
    },
    {
      keys: ['chiave_gemini', 'chiave gemini', 'chiave google', 'api key gemini', 'chiave api gemini', 'gemini key'],
      level: 2,
      risk: 'Imposta la chiave API di Google Gemini. È una credenziale che autorizza spese sul tuo '
        + 'account: confermala solo se questa chiave arriva davvero da te.',
      build(v) {
        const s = String(v == null ? '' : v).trim();
        if (!s) return null;
        return { partial: { apiKeys: { gemini: s } }, label: `Chiave Google Gemini → ${maskKey(s)}` };
      },
    },
    {
      keys: ['chiave_tavily', 'chiave tavily', 'api key tavily', 'chiave ricerca', 'chiave api tavily', 'tavily key'],
      level: 2,
      risk: 'Imposta la chiave API di Tavily, il servizio di ricerca web. È una credenziale '
        + 'collegata al tuo account Tavily: confermala solo se arriva davvero da te.',
      build(v) {
        const s = String(v == null ? '' : v).trim();
        if (!s) return null;
        return { partial: { apiKeys: { tavily: s } }, label: `Chiave Tavily → ${maskKey(s)}` };
      },
    },
    {
      keys: ['limite_spesa', 'limite di spesa', 'limite spesa', 'limite di spesa mensile', 'limite mensile', 'budget mensile', 'spesa massima', 'limite costi', 'budget'],
      level: 2,
      risk: 'Imposta il tetto di spesa mensile per le richieste AI. Alzarlo può far aumentare i '
        + 'costi; abbassarlo può bloccare le richieste una volta raggiunto il limite.',
      build(v) {
        let n = parseItalianNumber(v);
        if (!Number.isFinite(n) || n < 0) return null;
        n = Math.min(10000, n);
        const eur = Number.isInteger(n) ? String(n) : n.toFixed(2);
        return { partial: { monthlyLimitEur: n }, label: `Limite di spesa mensile → ${eur}€` };
      },
    },

    // ── Colore identità delle tab — cosmetico, reversibile → livello 1 ──
    // Mappa le richieste verbali ("voglio colori più vivaci nelle tab", "rendile
    // più neutre", "niente colore", "Poste è verde non gialla") sui sei parametri
    // di src/shared/tabColor.js. I valori sono preset ASSOLUTI (non delta: il
    // setter non vede lo stato corrente), così il risultato è deterministico e
    // l'utente vede subito cambiare il colore delle tab. Il merge in storage è
    // profondo su `tabColor`, quindi un preset parziale lascia intatti gli altri
    // parametri. La regolazione fine dei singoli numeri sta nelle Preferenze.
    {
      keys: ['colore_tab', 'colore delle tab', 'colore tab', 'colori tab', 'colori delle tab',
        'colore schede', 'colori schede', 'tinta tab', 'tinta delle tab', 'vivacita tab', 'vivacità tab'],
      build(v) {
        const s = String(v == null ? '' : v).trim().toLowerCase();
        if (!s) return null;
        const TC = global.SN_TAB_COLOR;
        if (/(nessun|niente|senza colore|togli|spegn|spent|via il colore|incolore|0)/.test(s)) {
          return { partial: { tabColor: { opacita_tab: 0 } }, label: 'Colore delle tab → nessuno' };
        }
        if (/(vivac|vivid|acces|caric|forte|forti|intens|brillant|sgargian|più colore|piu colore|più colorat|piu colorat)/.test(s)) {
          return { partial: { tabColor: { saturazione_tab: 1, opacita_tab: 0.9 } }, label: 'Colore delle tab → più vivace' };
        }
        if (/(neutr|spent|tenu|delicat|sobri|smorzat|pastell|meno colore|meno colorat|legger)/.test(s)) {
          return { partial: { tabColor: { saturazione_tab: 0.5, opacita_tab: 0.35 } }, label: 'Colore delle tab → più neutro' };
        }
        if (/(precis|sensibil|sbagliat|corregg|verde non gial|tinta giust|esatt|migliora estr)/.test(s)) {
          return { partial: { tabColor: { soglia_saturazione: 0.4, peso_centralita: 7 } }, label: 'Colore delle tab → estrazione più precisa' };
        }
        if (/(default|predefinit|normal|standard|ripristin|reset|originale)/.test(s) && TC) {
          return { partial: { tabColor: TC.defaultParams() }, label: 'Colore delle tab → predefinito' };
        }
        return null;
      },
    },

    // ── Suoneria timer — reversibile, innocuo → livello 1 ──
    {
      keys: ['suoneria_timer', 'suoneria timer', 'suoneria', 'ringtone', 'timer ringtone', 'suono timer', 'tono timer'],
      level: 1,
      build(v) {
        const s = String(v == null ? '' : v).trim().toLowerCase();
        const map = {
          standard: 'default', default: 'default', normale: 'default',
          delicata: 'gentle', gentle: 'gentle', dolce: 'gentle', morbida: 'gentle',
          urgente: 'urgent', urgent: 'urgent', forte: 'urgent', acuto: 'urgent',
          carillon: 'chime', chime: 'chime', campanello: 'chime', campana: 'chime',
        };
        const tone = map[s];
        if (!tone) return null;
        const labelMap = { default: 'Standard', gentle: 'Delicata', urgent: 'Urgente', chime: 'Carillon' };
        return { partial: { timerRingtone: tone }, label: `Suoneria timer → ${labelMap[tone]}` };
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
      return r ? { ...r, level: setter.level || 1, risk: setter.risk || '' } : null;
    };
    for (const setter of PREF_SETTERS) {
      if (setter.keys.includes(key)) return withLevel(setter);
    }
    for (const setter of PREF_SETTERS) {
      if (setter.keys.some((k) => key.includes(k) || k.includes(key))) return withLevel(setter);
    }
    return null;
  }

  global.SN_PREF = { buildPreferencePartial, parsePrefBool, parseItalianNumber, PREF_SETTERS };
})(typeof globalThis !== 'undefined' ? globalThis : self);
