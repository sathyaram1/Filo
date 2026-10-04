// Mappa "linguaggio naturale → preferenza dell'app" usata quando Filo modifica
// le impostazioni su richiesta dell'utente dalla chat (azione IMPOSTA_PREFERENZA).
//
// È volutamente un modulo condiviso (IIFE su globalThis): la conoscenza di
// QUALI preferenze sono modificabili e COME interpretarne i valori è la stessa
// esposta dalla pagina Preferenze, e deve restare testabile senza Electron.
//
// Espone SN_PREF = { buildPreferencePartial, parsePrefBool, PREF_SETTERS, lezioneDaAzione, applicaElenco,
// righeDescrizione, setterDi }. Ogni setter dichiara `scrive` (i percorsi di cui è la chiave) e `aiuto` (la riga
// che la chat legge nella descrizione dello strumento): sentinella in tests/unit/vociImpostazioni.test.mjs.
// `buildPreferencePartial(chiave, valore)` → { partial, label, level, risk },
// { rifiuto } col perché, oppure null se chiave/valore non sono validi. Solo le
// preferenze qui elencate sono scrivibili. Dal #146.5 l'elenco copre TUTTE le
// impostazioni della pagina Opzioni (modelli, provider, chiavi API,
// sicurezza/privacy, limite di spesa, funzionalità) oltre a quelle
// estetiche/comportamentali: ognuna dichiara il
// proprio `level` (1 = applica subito, 2 = popup di conferma). Le impostazioni
// sensibili (sicurezza, modelli, chiavi, provider, costi) sono di livello 2.
//
// REGOLA (#183): ogni setter di livello 2 DEVE dichiarare anche `risk` — una
// frase in chiaro che spiega cosa controlla l'impostazione e quali sono gli
// eventuali rischi. È il testo che il popup di conferma mostra all'utente
// (lo compone actionLevels.describe). Un setter di livello 2 senza `risk` è
// un bug: il test tests/unit/preferences.test.mjs lo intercetta.
//
// REGOLA (#592): un testo libero che finisce in un prompt è di livello 2, porta
// il `testo` esatto al popup e oltre il tetto torna un `rifiuto`, mai un taglio
// (sentinella in tests/unit/preferences.test.mjs).

(function (global) {
  'use strict';

  // Interpreta un "sì/no" scritto in linguaggio naturale. true/false o null.
  function parsePrefBool(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    const s = String(v == null ? '' : v).trim().toLowerCase();
    if (['true', 'si', 'sì', 'on', 'attiva', 'attivo', 'attivare', 'attivata', 'attivato', 'mostra', 'mostrare', 'abilita', 'abilitato', 'abilitare',
      'accendi', 'accendere', 'acceso', 'accesa', '1', 'yes', 'y'].includes(s)) return true;
    if (['false', 'no', 'off', 'disattiva', 'disattivo', 'disattivare', 'disattivata', 'disattivato', 'nascondi', 'nascondere', 'disabilita', 'disabilitato', 'disabilitare',
      'spegni', 'spegnere', 'spento', 'spenta', '0', 'n'].includes(s)) return false;
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

  // Un testo libero che finisce in un popup di conferma, ridotto a quello che si
  // legge: quello che l'utente conferma è quello che si salva (#592).
  function testoVisibile(v) {
    return global.SN_CONST.testoLeggibile(v);
  }
  const NESSUNO_STILE = ['nessuno', 'nessuna', 'niente', 'predefinito', 'default', 'togli', 'toglilo', 'rimuovi',
    'cancella', 'azzera', 'reset', 'nessuno stile', 'nessuno (predefinito)'];

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

  // I toni della suoneria e degli avvisi: gli id sono quelli di SN_SOUNDS (sounds.js).
  const TONI = {
    standard: 'default', default: 'default', normale: 'default',
    delicata: 'gentle', gentle: 'gentle', dolce: 'gentle', morbida: 'gentle',
    urgente: 'urgent', urgent: 'urgent', forte: 'urgent', acuto: 'urgent',
    carillon: 'chime', chime: 'chime', campanello: 'chime', campana: 'chime',
  };
  const TONI_ETICHETTE = { default: 'Standard', gentle: 'Delicata', urgent: 'Urgente', chime: 'Carillon' };
  function tonoDa(v) {
    return TONI[String(v == null ? '' : v).trim().toLowerCase()] || null;
  }
  // Lo stesso tetto del campo nelle Preferenze.
  const NOTIF_SEC_MAX = 120;

  function tettoStile() {
    const C = global.SN_CONST;
    return C && C.AGENT_STYLE_MAX ? `al massimo ${C.AGENT_STYLE_MAX} caratteri` : 'con un tetto di lunghezza';
  }

  // Un interruttore della pagina Sicurezza: a parole sì/no, livello 2 col rischio in chiaro (#949).
  function interruttore({ keys, percorso, nome, risk, aiuto, stati = ['attivo', 'disattivato'] }) {
    return {
      keys,
      scrive: [percorso],
      aiuto: aiuto || 'true | false',
      level: 2,
      risk,
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: nidifica(percorso, b), label: `${nome} → ${b ? stati[0] : stati[1]}` };
      },
    };
  }

  function nidifica(percorso, valore) {
    const seg = String(percorso).split('.');
    const out = {};
    let nodo = out;
    for (let i = 0; i < seg.length - 1; i++) { nodo[seg[i]] = {}; nodo = nodo[seg[i]]; }
    nodo[seg[seg.length - 1]] = valore;
    return out;
  }
  function dentro(o, percorso) {
    return String(percorso).split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
  }

  // ── Elenchi di siti (#949) ─────────────────────────────────────────────────
  // Il setter dice cosa fare all'elenco («aggiungi x.it», «togli y.com», «solo …», «svuota»); chi
  // conosce l'elenco di adesso (il main) lo applica con applicaElenco. Un dominio non valido è un
  // rifiuto col suo nome, mai una voce scartata in silenzio.
  const OP_ELENCO = [
    ['aggiungi', /^(?:\+|(?:aggiungi|aggiungere|aggiungo|metti|inserisci|includi|blocca)\b)\s*:?\s*/i],
    ['togli', /^(?:-|(?:togli|togliere|tolgo|rimuovi|rimuovere|leva|elimina|cancella|sblocca|escludi)\b)\s*:?\s*/i],
    ['sostituisci', /^(?:=|(?:solo|soltanto|sostituisci(?:\s+con)?|imposta|elenco)\b)\s*:?\s*/i],
  ];
  const SVUOTA = /^(?:svuota(?:\s+l'?elenco)?|nessuno|nessuna|niente|vuoto|vuota|azzera|togli\s+tutt[oi]|rimuovi\s+tutt[oi]|cancella\s+tutt[oi])[.!]?$/i;
  const CONGIUNZIONI = new Set(['e', 'ed', 'and', 'poi', 'anche', 'il', 'lo', 'la', 'sito', 'siti', 'dominio', 'domini']);
  function nomiSito() {
    return global.SN_NOMI_SITO || (typeof require === 'function' ? require('./nomiSito.js') : null);
  }
  function dominioDa(raw) {
    let s = String(raw || '').trim().toLowerCase().replace(/^["'«(]+|["'»),.;]+$/g, '').replace(/^([a-z]+:\/\/)?\*?\.+/, '$1');
    if (!s) return '';
    if (s.includes('://')) { try { s = new URL(s).hostname; } catch (_) { return ''; } }
    s = s.split('/')[0].split('?')[0].split(':')[0].replace(/^\.+|\.+$/g, '').replace(/^www\./, '');
    const N = nomiSito();
    return N && N.valido(s) ? s : '';
  }
  function opElenco(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return null;
    if (SVUOTA.test(s)) return { op: 'sostituisci', voci: [] };
    let op = 'aggiungi';
    let resto = s;
    for (const [nome, re] of OP_ELENCO) {
      const m = s.match(re);
      if (m) { op = nome; resto = s.slice(m[0].length); break; }
    }
    const pezzi = resto.split(/[\s,;]+/).map((x) => x.trim()).filter((x) => x && !CONGIUNZIONI.has(x.toLowerCase()));
    if (!pezzi.length) return null;
    const voci = [];
    const errati = [];
    for (const p of pezzi) {
      const d = dominioDa(p);
      if (!d) errati.push(p);
      else if (!voci.includes(d)) voci.push(d);
    }
    if (errati.length) {
      const mostra = (x) => `«${x.length > 60 ? `${x.slice(0, 59)}…` : x}»`;
      return { rifiuto: `${errati.map(mostra).join(', ')} non ${errati.length > 1 ? 'sono domini' : 'è un dominio'}: scrivi il sito con la sua estensione, come facebook.com` };
    }
    return { op, voci };
  }
  function elenco({ keys, percorso, nome, risk, aiuto }) {
    return {
      keys,
      scrive: [percorso],
      aiuto: `"aggiungi <siti>" | "togli <siti>" | "solo <siti>" | "svuota" (${aiuto}; più siti separati da virgole)`,
      level: 2,
      risk,
      build(v) {
        const o = opElenco(v);
        if (!o || o.rifiuto) return o;
        const lista = o.voci.join(', ');
        const label = o.op === 'aggiungi' ? `${nome} → aggiungi ${lista}`
          : o.op === 'togli' ? `${nome} → togli ${lista}`
            : (o.voci.length ? `${nome} → solo ${lista}` : `${nome} → svuota l'elenco`);
        return { partial: nidifica(percorso, o.voci), label, elenco: { percorso, op: o.op, voci: o.voci, nome } };
      },
    };
  }
  // L'elenco nuovo a partire da quello di adesso: { partial } da salvare, o { invariato } col perché.
  function applicaElenco(e, correnti) {
    const attuale = (Array.isArray(dentro(correnti, e.percorso)) ? dentro(correnti, e.percorso) : [])
      .filter((x) => typeof x === 'string' && x.trim());
    let nuovo;
    if (e.op === 'aggiungi') nuovo = attuale.concat(e.voci.filter((x) => !attuale.includes(x)));
    else if (e.op === 'togli') nuovo = attuale.filter((x) => !e.voci.includes(x));
    else nuovo = e.voci.slice();
    if (nuovo.length === attuale.length && nuovo.every((x, i) => x === attuale[i])) {
      const ha = attuale.length ? `adesso contiene: ${attuale.join(', ')}` : 'adesso è vuoto';
      const perche = e.op === 'aggiungi' ? `${e.voci.join(', ')} ${e.voci.length > 1 ? 'ci sono' : 'c\'è'} già`
        : e.op === 'togli' ? `${e.voci.join(', ')} non ${e.voci.length > 1 ? 'ci sono' : 'c\'è'}` : 'è già così';
      return { invariato: `nell'elenco «${e.nome}» ${perche} (${ha})` };
    }
    return { partial: nidifica(e.percorso, nuovo), lista: nuovo };
  }

  // I sei parametri del colore delle tab, uno per uno come nella pagina (#949). Range e nomi li dà tabColor.js.
  function metaColoreTab(chiave) {
    const TC = global.SN_TAB_COLOR;
    return TC && Array.isArray(TC.IDENTITY_PARAM_META) ? TC.IDENTITY_PARAM_META.find((m) => m.key === chiave) : null;
  }
  const PARAMETRI_COLORE_TAB = ['saturazione_tab', 'luminosita_tab', 'opacita_tab', 'soglia_saturazione', 'peso_centralita', 'bucket_tinta'];
  function parametroColoreTab(chiave) {
    return {
      keys: [chiave, chiave.replace(/_/g, ' '), `${chiave.replace(/_/g, ' ')} delle tab`],
      scrive: [`tabColor.${chiave}`],
      aiuto: () => {
        const m = metaColoreTab(chiave);
        return m ? `numero ${m.min}-${m.max} (${m.label.toLowerCase()} del colore delle tab, predefinito ${m.def})` : 'numero';
      },
      build(v) {
        const m = metaColoreTab(chiave);
        if (!m) return null;
        const s = String(v == null ? '' : v).trim().toLowerCase();
        let n = /^(predefinit|default|normale|standard|ripristin)/.test(s) ? m.def : parseItalianNumber(s);
        if (!Number.isFinite(n)) return null;
        if (n < m.min || n > m.max) return { rifiuto: `${m.label.toLowerCase()} va da ${m.min} a ${m.max}, e ${s} è fuori` };
        if (m.step >= 1) n = Math.round(n);
        return { partial: { tabColor: { [chiave]: n } }, label: `Colore delle tab, ${m.label.toLowerCase()} → ${String(n).replace('.', ',')}` };
      },
    };
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
      scrive: ['theme'],
      aiuto: '"sistema" | "chiaro" | "scuro"',
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
      scrive: ['textScale'],
      aiuto: '"piccolo" | "normale" | "grande" | "molto grande" | "enorme" (o una percentuale)',
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
      scrive: ['showHomeMessage'],
      aiuto: 'true | false (commento di Filo al centro della home)',
      keys: ['commento_home', 'commento nella home', 'commento home', 'messaggio home', 'messaggio nella home', 'showhomemessage', 'commento'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { showHomeMessage: b }, label: `Commento nella home → ${b ? 'mostrato' : 'nascosto'}` };
      },
    },
    // Ora, batteria, rete e Bluetooth nella home (#873): una voce per chiave, le altre restano come sono.
    ...[
      ['ora', "l'ora", ['orologio']],
      ['batteria', 'la batteria', []],
      ['rete', 'la rete', ['wifi', 'wi-fi', 'connessione']],
      ['bluetooth', 'il Bluetooth', []],
    ].map(([voce, nome, sinonimi]) => ({
      keys: [`${voce}_home`, `${voce} nella home`, `${voce} home`, ...sinonimi.map((x) => `${x}_home`)],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { homeSistema: { [voce]: b } }, label: `Home → ${b ? 'mostra' : 'nascondi'} ${nome}` };
      },
    })),
    {
      scrive: ['agentStyle'],
      aiuto: () => `testo libero, ${tettoStile()} (come deve scrivere Filo; "nessuno" lo toglie)`,
      keys: ['stile_agente', 'stile agente', "stile dell'agente", 'agentstyle', 'stile'],
      // Entra in ogni prompt conversazionale e ci resta: proposto dal modello,
      // passa dal popup col testo esatto (#592). Anche toglierlo, che lo perde.
      level: 2,
      risk: 'Lo stile di scrittura decide come Filo ti scrive in ogni conversazione (chat, Aiuto, spiegazioni, '
        + 'editor) e resta finché non lo cambi. Confermalo solo se l\'hai chiesto tu: un testo letto in una '
        + 'pagina o in un documento potrebbe provare a cambiarlo.',
      build(v) {
        const s = testoVisibile(v);
        if (!s || NESSUNO_STILE.includes(s.toLowerCase().replace(/[.!]+$/, ''))) {
          return { partial: { agentStyle: '' }, label: "Stile dell'agente → nessuno (risposte predefinite)" };
        }
        const C = global.SN_CONST;
        const n = C.agentStyleLength(s);
        if (n > C.AGENT_STYLE_MAX) {
          return { rifiuto: `lo stile è lungo ${n} caratteri e il massimo è ${C.AGENT_STYLE_MAX}` };
        }
        return { partial: { agentStyle: s }, label: "Stile dell'agente", testo: s };
      },
    },
    {
      scrive: ['autoArchive.enabled'],
      aiuto: 'true | false (riordino e archiviazione automatici delle schede)',
      keys: ['archiviazione_automatica', 'archiviazione automatica', 'gestione automatica delle schede', 'gestione automatica schede', 'autoarchive', 'archiviazione', 'archivia automaticamente'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { autoArchive: { enabled: b } }, label: `Archiviazione automatica → ${b ? 'attiva' : 'disattivata'}` };
      },
    },
    {
      scrive: ['autoArchive.onClose'],
      aiuto: 'true | false (riordina anche alla riapertura di Filo)',
      keys: ['archivia_alla_riapertura', 'riordina alla riapertura', 'archivia alla riapertura', 'autoarchiveonclose'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { autoArchive: { onClose: b } }, label: `Riordino alla riapertura → ${b ? 'attivo' : 'disattivato'}` };
      },
    },
    {
      scrive: ['autoArchive.idleHours'],
      aiuto: 'numero 1-168 (dopo quante ore di inattività archiviare)',
      keys: ['ore_inattivita', 'ore inattivita', 'ore di inattivita', 'ore_inattivita_archivio', 'idlehours', 'ore inattività'],
      build(v) {
        let n = parseInt(String(v == null ? '' : v).replace(/[^0-9]/g, ''), 10);
        if (!Number.isFinite(n) || n < 1) return null;
        n = Math.min(168, n);
        return { partial: { autoArchive: { idleHours: n } }, label: `Archivia dopo ${n} ore di inattività` };
      },
    },
    {
      scrive: ['terminal.enabled'],
      aiuto: 'true | false',
      keys: ['modalita_terminale', 'modalità terminale', 'modalita terminale', 'terminale', 'terminal'],
      // La modalità terminale dà a Filo accesso alla shell: conferma esplicita.
      level: 2,
      risk: 'Questa impostazione decide se Filo può eseguire comandi nella shell del tuo computer, cioè nel terminale. '
        + 'Da acceso, quello che legge parte subito, quello che cambia qualcosa ti chiede prima un OK, '
        + 'e per cancellare o per un comando che non riconosce devi scrivere «conferma». '
        + 'Da spento, Filo non esegue nessun comando.',
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { terminal: { enabled: b } }, label: `Modalità terminale → ${b ? 'attiva' : 'disattivata'}` };
      },
    },
    {
      scrive: ['nomiSensati.scaricamenti'],
      aiuto: 'true | false (nome sensato da solo ai file scaricati col nome che non dice niente)',
      keys: ['nomi_sensati_scaricamenti', 'nome sensato agli scaricamenti', 'nomi sensati', 'rinomina scaricamenti',
        'rinomina i file scaricati', 'nomi dei file scaricati', 'nomisensati'],
      // Da accesa il contenuto dei file scaricati va a un modello senza una richiesta per ciascuno: conferma.
      level: 2,
      risk: 'Da accesa, ogni file che scarichi con un nome che non dice niente («scan_00231.pdf», «IMG_2026…») '
        + 'viene letto da un modello (l\'inizio del testo o una miniatura) e rinominato con un nome che dice cosa '
        + 'contiene. L\'avviso che compare ha «Annulla». I nomi scelti da qualcuno restano com\'erano.',
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { nomiSensati: { scaricamenti: b } }, label: `Nome sensato ai file scaricati → ${b ? 'attivo' : 'spento'}` };
      },
    },
    {
      scrive: ['terminal.shell'],
      aiuto: (ctx) => ctx.shellPref,
      keys: ['shell_terminale', 'shell terminale', 'shell'],
      level: 2,
      risk: 'Sceglie quale shell usa Filo per eseguire i comandi del terminale (su Windows '
        + 'PowerShell, Prompt dei comandi o Bash; su Mac e Linux sh o Bash). Cambia come '
        + 'vengono interpretati i comandi che Filo lancia.',
      build(v) {
        const s = String(v == null ? '' : v).trim().toLowerCase();
        // 'sh' e 'zsh' sono i nomi che ha senso pronunciare su Mac e Linux: là
        // powershell/cmd non esistono e il main ricade comunque su /bin/sh —
        // ma se l'utente li chiede per nome, la richiesta deve arrivare.
        const map = {
          powershell: 'powershell', ps: 'powershell',
          cmd: 'cmd', 'prompt dei comandi': 'cmd', prompt: 'cmd',
          bash: 'bash', wsl: 'bash',
          sh: 'sh', zsh: 'sh', 'shell di sistema': 'sh',
        };
        const shell = map[s];
        if (!shell) return null;
        return { partial: { terminal: { shell } }, label: `Shell del terminale → ${shell}` };
      },
    },
    {
      scrive: ['tts.rate'],
      aiuto: 'numero 0.5-2 (velocità della lettura ad alta voce)',
      keys: ['velocita_voce', 'velocità voce', 'velocita voce', 'velocità lettura', 'velocita lettura', 'ttsrate'],
      build(v) {
        let n = parseItalianNumber(v);
        if (!Number.isFinite(n)) return null;
        n = Math.max(0.5, Math.min(2, n));
        return { partial: { tts: { rate: n } }, label: `Velocità lettura → ${n.toFixed(1)}×` };
      },
    },
    {
      scrive: ['tts.pitch'],
      aiuto: 'numero 0-2 (tono della lettura ad alta voce)',
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
      scrive: ['tts.voice'],
      aiuto: 'il nome di una voce installata nel sistema (voce di riserva della lettura)',
      keys: ['voce', 'voce lettura', 'voce tts', 'ttsvoice', 'voce del sistema'],
      build(v) {
        const s = String(v == null ? '' : v).trim();
        if (!s) return null;
        return { partial: { tts: { voice: s } }, label: `Voce di lettura → "${s}"` };
      },
    },
    {
      // Voce del MODELLO di lettura (quella naturale): si indica per nome
      // ("Sara", "Nicola") o per id ("if_sara"); "automatica" torna a seguire
      // la lingua del testo. Reversibile → livello 1.
      scrive: ['tts.modelVoice'],
      aiuto: '"automatica" o il nome di una voce naturale, come "Sara" o "Nicola" (voce della lettura ad alta voce)',
      keys: ['voce_modello', 'voce del modello', 'voce naturale', 'voce modello', 'ttsmodelvoice'],
      build(v) {
        const s = String(v == null ? '' : v).trim();
        if (!s) return null;
        const low = s.toLowerCase();
        if (['auto', 'automatica', 'automatico', 'lingua', 'nessuna', 'default'].includes(low)) {
          return { partial: { tts: { modelVoice: '' } }, label: 'Voce naturale → automatica (segue la lingua del testo)' };
        }
        const Voices = global.SN_TTS_VOICES;
        if (Voices) {
          // Si cerca fra TUTTI i cataloghi: quale modello legge non lo sa
          // questa pagina, e una voce di un altro modello viene comunque
          // ignorata al momento della lettura (resolveVoice).
          const hit = Voices.allVoices().find((x) => x.id === low || x.id.toLowerCase() === low
            || x.label.toLowerCase() === low || x.label.toLowerCase().split(' ')[0] === low);
          if (!hit) return null;
          return { partial: { tts: { modelVoice: hit.id } }, label: `Voce naturale → ${hit.label} (${Voices.LANG_LABELS[hit.lang] || hit.lang})` };
        }
        return { partial: { tts: { modelVoice: s } }, label: `Voce naturale → "${s}"` };
      },
    },

    // ── Funzionalità (interruttori) — reversibili, nessun rischio → livello 1 ──
    {
      scrive: ['featureFlags.spellcheck'],
      aiuto: 'true | false (correttore ortografico AI)',
      keys: ['correttore', 'correttore ortografico', 'correttore_ortografico', 'controllo ortografico', 'spellcheck', 'correzione'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { featureFlags: { spellcheck: b } }, label: `Correttore ortografico → ${b ? 'attivo' : 'disattivato'}` };
      },
    },
    {
      scrive: ['featureFlags.help'],
      aiuto: 'true | false (barra laterale dell\'Aiuto)',
      keys: ['sidebar_aiuto', 'sidebar aiuto', 'pannello aiuto', 'aiuto', 'help', 'assistente aiuto'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { featureFlags: { help: b } }, label: `Sidebar Aiuto → ${b ? 'attiva' : 'disattivata'}` };
      },
    },
    {
      scrive: ['featureFlags.categorize'],
      aiuto: 'true | false (categorie automatiche delle pagine)',
      keys: ['categorizzazione', 'categorie automatiche', 'categorizza', 'categorie'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { featureFlags: { categorize: b } }, label: `Categorizzazione automatica → ${b ? 'attiva' : 'disattivata'}` };
      },
    },
    {
      scrive: ['autoArchive.onIdle'],
      aiuto: 'true | false (archivia quando Filo resta inattivo)',
      keys: ['archivia_se_inattivo', 'archivia quando inattivo', 'archiviazione su inattivita', 'archivia se inattivo', 'archiviazione inattivita'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { autoArchive: { onIdle: b } }, label: `Archivia quando inattivo → ${b ? 'attivo' : 'disattivato'}` };
      },
    },
    // #737 — sta nella pagina Sicurezza accanto all'ad-block, ma non apre né chiude niente: si applica subito.
    {
      scrive: ['security.adSkip.enabled'],
      aiuto: 'true | false (preme da solo il «Salta» delle pubblicità dei video, per esempio su YouTube)',
      keys: ['salta_pubblicita', 'salta pubblicità', 'salta pubblicita', 'salta le pubblicità', 'salta le pubblicita',
        'salta annunci', 'salta gli annunci', 'pubblicità dei video', 'pubblicita dei video', 'skip ads', 'salta ads'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { security: { adSkip: { enabled: b } } }, label: `Salta le pubblicità dei video → ${b ? 'attivo' : 'disattivato'}` };
      },
    },

    // ── Sicurezza / privacy — livello 2 (popup di conferma prima di applicare) ──
    {
      scrive: ['security.protectIpLeak'],
      aiuto: 'true | false (anti-leak WebRTC)',
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
      scrive: ['security.blockPopups'],
      aiuto: 'true | false',
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
      scrive: ['security.safeBrowse.enabled'],
      aiuto: 'true | false (avviso sui siti pericolosi)',
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
      scrive: ['security.downloads.confirmExecutables'],
      aiuto: 'true | false (chiede prima di scaricare o aprire un programma)',
      keys: ['conferma_programmi', 'conferma programmi', 'conferma prima di scaricare un programma',
        'chiedi prima di scaricare un programma', 'avviso programmi scaricati', 'download eseguibili',
        'scaricamento programmi', 'file eseguibili'],
      level: 2,
      risk: 'Controlla l’avviso prima che un programma (.exe, .msi, .dmg, .iso, .sh…) entri nella cartella '
        + 'Download e prima che “Apri file” lo esegua. Disattivarlo fa scendere e aprire i programmi '
        + 'senza domande, anche quelli di un sito sbagliato.',
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return {
          partial: { security: { downloads: { confirmExecutables: b } } },
          label: `Conferma prima di scaricare un programma → ${b ? 'attiva' : 'disattivata'}`,
        };
      },
    },
    {
      scrive: ['security.cookies.mode'],
      aiuto: '"manuale" | "automatico" | "privacy"',
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
      scrive: ['security.fingerprint.mode'],
      aiuto: '"off" | "default" | "privacy" (anti-fingerprinting)',
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
      scrive: ['useDefaultModels'],
      aiuto: 'true | false',
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
      scrive: ['openWeightsOnly'],
      aiuto: 'true | false (spegne tutti i modelli proprietari, Anthropic compresa, e lascia solo modelli a pesi aperti serviti da fornitori indipendenti)',
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
      scrive: ['provider'],
      aiuto: '"openrouter"',
      keys: ['provider', 'fornitore', 'provider ai', 'provider modelli'],
      level: 2,
      risk: 'Cambia il fornitore AI che elabora le tue richieste. '
        + 'Le richieste e i relativi costi passeranno dal nuovo provider, con la sua chiave API.',
      build(v) {
        const s = String(v == null ? '' : v).trim().toLowerCase();
        const map = { openrouter: 'openrouter', 'open router': 'openrouter', or: 'openrouter' };
        const provider = map[s];
        if (!provider) return null;
        return { partial: { provider }, label: 'Provider → OpenRouter' };
      },
    },
    {
      scrive: ['apiKeys.openrouter'],
      aiuto: 'la chiave API di OpenRouter come testo',
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
      scrive: ['apiKeys.tavily'],
      aiuto: 'la chiave API di Tavily come testo',
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
      scrive: ['monthlyLimitEur'],
      aiuto: 'numero in euro (limite di spesa mensile)',
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
      aiuto: '"più vivaci" | "più neutre" | "nessuno" | "più preciso" | "predefinito" (colore identità delle tab: "vivaci"=tinte accese, "neutre"=tinte spente, "nessuno"=tab senza colore, "più preciso"=estrai meglio quando la tab prende il colore sbagliato, "predefinito"=ripristina; i sei valori uno per uno hanno le loro chiavi qui sotto)',
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
      scrive: ['timerRingtone'],
      aiuto: '"standard" | "delicata" | "urgente" | "carillon"',
      keys: ['suoneria_timer', 'suoneria timer', 'suoneria', 'ringtone', 'timer ringtone', 'suono timer', 'tono timer'],
      level: 1,
      build(v) {
        const tone = tonoDa(v);
        if (!tone) return null;
        return { partial: { timerRingtone: tone }, label: `Suoneria timer → ${TONI_ETICHETTE[tone]}` };
      },
    },

    // ── Avvisi in basso a destra (barra e pagine) — reversibili, innocui → livello 1 ──
    {
      scrive: ['notifications.durationSec'],
      aiuto: 'secondi 0-120 (quanto restano gli avvisi in basso a destra, nella barra e nelle pagine; quelli brevi e quelli con un pulsante restano in proporzione; 0 = finché l\'utente non li chiude)',
      keys: ['durata_notifiche', 'durata notifiche', 'durata delle notifiche', 'durata notifica', 'durata della notifica',
        'durata avvisi', 'durata degli avvisi', 'durata toast', 'tempo notifiche', 'notifications.durationsec'],
      build(v) {
        const s = String(v == null ? '' : v).trim().toLowerCase();
        // Una cifra decide sempre («resta 8 secondi» è 8); le parole del «per sempre» contano solo senza cifre,
        // e «non restano» chiede il contrario.
        let n;
        if (/\d/.test(s)) {
          n = parseItalianNumber(s);
          if (/min/.test(s)) n *= 60;
        } else if (/\bnon\s+rest/.test(s)) return null;
        else if (/(sempre|infinit|finch[eé]|resta|non spar|le chiudo|la chiudo)/.test(s)) n = 0;
        else return null;
        if (!Number.isFinite(n) || n < 0) return null;
        n = Math.round(n);
        if (n > NOTIF_SEC_MAX) {
          return { rifiuto: `la durata massima è ${NOTIF_SEC_MAX} secondi; con 0 gli avvisi restano finché non li chiudi` };
        }
        return {
          partial: { notifications: { durationSec: n } },
          label: n === 0 ? 'Avvisi → restano finché non li chiudi' : `Durata degli avvisi → ${n} s`,
        };
      },
    },
    {
      scrive: ['notifications.soundEnabled', 'notifications.sound'],
      aiuto: 'true | false | "standard" | "delicata" | "urgente" | "carillon" (suono degli avvisi della barra; un tono lo accende con quel tono)',
      keys: ['suono_notifiche', 'suono notifiche', 'suono delle notifiche', 'suono notifica', 'suono della notifica',
        'suono avvisi', 'suono degli avvisi', 'tono notifiche', 'notifications.sound'],
      // Un sì/no lo accende o lo spegne; un tono lo accende con quel tono.
      build(v) {
        const tone = tonoDa(v);
        if (tone) {
          return { partial: { notifications: { soundEnabled: true, sound: tone } }, label: `Suono degli avvisi → ${TONI_ETICHETTE[tone]}` };
        }
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { notifications: { soundEnabled: b } }, label: `Suono degli avvisi → ${b ? 'acceso' : 'spento'}` };
      },
    },

    // ── Anteprima delle schede (#430) — reversibile, innocua → livello 1 ──
    {
      scrive: ['tabPreview.enabled', 'tabPreview.size'],
      aiuto: 'true | false | "piccola" | "media" | "grande" (carta con l\'anteprima di una scheda al passaggio del mouse sulla barra)',
      keys: ['anteprima_schede', 'anteprima delle schede', 'anteprima schede', 'anteprima delle tab', 'anteprima tab', 'tabpreview'],
      // In fondo all'elenco: una chiave vaga («tab», «schede») resta di chi la prendeva prima.
      // Un sì/no la accende o la spegne; una misura la accende a quella misura.
      build(v) {
        const s = String(v == null ? '' : v).trim().toLowerCase();
        const MISURE = { piccola: 'piccola', piccole: 'piccola', 'più piccola': 'piccola', small: 'piccola',
          media: 'media', normale: 'media', medie: 'media', medium: 'media',
          grande: 'grande', grandi: 'grande', 'più grande': 'grande', large: 'grande' };
        if (MISURE[s]) {
          const size = MISURE[s];
          return { partial: { tabPreview: { enabled: true, size } }, label: `Anteprima delle schede → ${size}` };
        }
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { tabPreview: { enabled: b } }, label: `Anteprima delle schede → ${b ? 'accesa' : 'spenta'}` };
      },
    },

    // ── #949: le voci che mancavano. In fondo, così una chiave vaga resta di chi la prendeva prima ──
    ...PARAMETRI_COLORE_TAB.map(parametroColoreTab),
    interruttore({
      keys: ['blocco_pubblicita', 'blocco pubblicità', 'blocco pubblicita', 'blocco della pubblicità', 'blocco delle pubblicità',
        'blocca pubblicità', 'blocca la pubblicità', 'blocca pubblicità e tracker', 'blocco pubblicità e tracker', 'adblock',
        'ad block', 'ad-block', 'blocco annunci', 'blocco tracker', 'blocca tracker'],
      percorso: 'security.adblock.enabled',
      nome: 'Blocco di pubblicità e tracker',
      aiuto: 'true | false (blocca pubblicità e tracker con le liste pubbliche; attivo di serie)',
      risk: 'Controlla il blocco delle pubblicità e dei tracker: le richieste verso i domini delle liste pubbliche '
        + 'si fermano prima di partire. Spegnerlo fa caricare annunci e script che seguono cosa fai da un sito all’altro.',
    }),
    interruttore({
      keys: ['blocco_siti', 'blocco siti', 'blocco dei siti', 'blocca siti', 'blocco siti in blacklist', 'blacklist attiva'],
      percorso: 'security.siteBlock.enabled',
      nome: 'Blocco dei siti in blacklist',
      aiuto: 'true | false (i siti in blacklist non si aprono finché l\'utente non sceglie «Apri comunque»)',
      risk: 'Controlla il blocco dei siti in blacklist: un sito in elenco non si apre da nessuna strada finché non '
        + 'scegli «Apri comunque». Spegnerlo fa aprire anche i siti che hai messo in elenco.',
    }),
    interruttore({
      keys: ['liste_pubbliche_blocco', 'liste pubbliche', 'liste pubbliche come blacklist', 'usa le liste pubbliche'],
      percorso: 'security.siteBlock.useAdblockLists',
      nome: 'Liste pubbliche come blacklist',
      stati: ['in uso', 'spente'],
      aiuto: 'true | false (tratta come bloccati anche i siti di pubblicità e tracciamento delle liste pubbliche)',
      risk: 'Decide se Filo tratta come bloccati anche i siti di pubblicità e tracciamento delle liste pubbliche, oltre '
        + 'a quelli che hai messo tu. Spegnerlo lascia aprire quei siti.',
    }),
    interruttore({
      keys: ['controlli_rete_siti', 'controlli di rete', 'controlli rete', 'età del dominio', 'eta del dominio'],
      percorso: 'security.safeBrowse.networkSignals',
      nome: 'Controlli di rete sui siti',
      stati: ['attivi', 'spenti'],
      aiuto: 'true | false (chiede a servizi pubblici l\'età del dominio e del certificato, per riconoscere le truffe)',
      risk: 'Controlla le richieste a servizi pubblici sull’età del dominio e del certificato, un forte segnale di truffa. '
        + 'Spegnerle rende meno probabile l’avviso su un sito nato da pochi giorni per ingannarti.',
    }),
    interruttore({
      keys: ['giudizio_ai_siti', 'giudizio ai', 'giudizio ai sui siti', 'giudizio ai sui casi sospetti'],
      percorso: 'security.safeBrowse.llmJudge',
      nome: 'Giudizio AI sui siti sospetti',
      aiuto: 'true | false (un modello valuta gli indizi di identità di un sito rimasto dubbio)',
      risk: 'Controlla il giudizio di un modello AI sui siti che restano dubbi. Spegnerlo toglie un controllo: '
        + 'un sito sospetto può aprirsi senza avviso.',
    }),
    interruttore({
      keys: ['link_sospetti_isolati', 'finestra isolata', 'link sospetti', 'apri i link sospetti in una finestra isolata'],
      percorso: 'security.safeBrowse.sandbox',
      nome: 'Link sospetti in una finestra isolata',
      stati: ['sì', 'no'],
      aiuto: 'true | false (segue prima in una finestra nascosta i link accorciati o con molti redirect)',
      risk: 'Controlla la finestra isolata in cui Filo segue prima i link accorciati o con molti redirect. Spegnerla '
        + 'fa aprire quei link direttamente, senza sapere prima dove portano.',
    }),
    interruttore({
      keys: ['segnalazione_automatica', 'segnalazione automatica', 'segnalazione automatica dei problemi', 'segnalazioni automatiche', 'feedback automatico'],
      percorso: 'security.autoFeedback',
      nome: 'Segnalazione automatica dei problemi',
      stati: ['attiva', 'disattivata'],
      aiuto: 'true | false (segnala in forma anonima a chi sviluppa Filo quando non riesce a fare una cosa; tenerla attiva vale 10 crediti al giorno)',
      risk: 'Decide se Filo manda da solo una segnalazione anonima e generica a chi lo sviluppa quando non riesce a fare '
        + 'una cosa: mai indirizzi né testi delle conversazioni. Spegnerla toglie anche i 10 crediti extra al giorno.',
    }),
    elenco({
      keys: ['siti_bloccati', 'siti bloccati', 'blacklist', 'domini in blacklist', 'elenco dei siti bloccati', 'lista dei siti bloccati'],
      percorso: 'security.siteBlock.blacklist',
      nome: 'Siti bloccati',
      aiuto: 'siti che Filo non apre',
      risk: 'Cambia l’elenco dei siti che Filo non apre. Un sito tolto si riapre da ogni strada; uno aggiunto non si apre '
        + 'più finché non scegli «Apri comunque».',
    }),
    elenco({
      keys: ['siti_fidati_programmi', 'siti fidati per i programmi', 'siti fidati programmi', 'siti fidati download'],
      percorso: 'security.downloads.trustedSites',
      nome: 'Siti fidati per i programmi',
      aiuto: 'siti da cui un programma scende senza chiedere',
      risk: 'Cambia i siti da cui un programma scaricato non chiede conferma: da un sito in elenco un programma scende '
        + 'e si apre senza domande.',
    }),
    elenco({
      keys: ['siti_fidati_cookie', 'siti fidati', 'siti fidati cookie', 'resta connesso', 'siti dove resto connesso'],
      percorso: 'security.cookies.trustedSites',
      nome: 'Siti fidati dove resti connesso',
      aiuto: 'siti dove si resta connessi anche con la privacy massima dei cookie',
      risk: 'Cambia i siti che fanno eccezione alla privacy massima dei cookie: lì i dati restano fra una visita e '
        + 'l’altra, così resti connesso, e il sito ti riconosce.',
    }),
    elenco({
      keys: ['siti_con_banner', 'siti con banner', 'banner visibili', 'siti dove vedo i banner', 'mostra i banner dei cookie'],
      percorso: 'security.cookies.bannerSites',
      nome: 'Siti dove vedi i banner dei cookie',
      aiuto: 'siti dove Filo non rifiuta i banner dei cookie e li lascia vedere',
      risk: 'Cambia i siti dove Filo lascia i banner dei cookie a te invece di rifiutarli da solo: lì una scelta '
        + 'sbagliata sul banner fa accettare i cookie di tracciamento.',
    }),
    elenco({
      keys: ['domini_esclusi', 'domini esclusi', 'siti esclusi', 'blocklist', 'siti dove filo non interviene'],
      percorso: 'blocklist',
      nome: 'Domini dove Filo non interviene',
      aiuto: 'siti dove Filo non aggiunge niente alle pagine',
      risk: 'Cambia i siti dove Filo non interviene sulle pagine: lì non aggiunge niente alla pagina, '
        + 'né i suoi menu né i suoi aiuti.',
    }),
  ];

  // Le righe «chiave: valori» della descrizione di IMPOSTA_PREFERENZA: escono da qui, dove sta il setter,
  // così una voce nuova arriva alla chat da sola (#949).
  function righeDescrizione(ctx = {}) {
    return PREF_SETTERS.map((s) => {
      const aiuto = typeof s.aiuto === 'function' ? s.aiuto(ctx) : s.aiuto;
      return `• ${s.keys[0]}: ${aiuto}${s.level === 2 ? ' [conferma]' : ''}`;
    });
  }

  // Trova il setter giusto per una chiave (match esatto, poi fuzzy) e costruisce
  // il partial. Ritorna { partial, label, level, risk, testo? }, { rifiuto } se il
  // valore va rifiutato spiegando perché, o null se chiave/valore non validi.
  function buildPreferencePartial(rawKey, rawVal) {
    const key = String(rawKey == null ? '' : rawKey).trim().toLowerCase();
    if (!key) return null;
    const withLevel = (setter) => {
      const r = setter.build(rawVal);
      if (r && r.rifiuto) return { rifiuto: r.rifiuto };
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

  // Una lezione è la sorella dello stile (#592): il popup mostra il testo che si
  // salva, e oltre il tetto torna un rifiuto col perché, mai un taglio.
  function lezioneDaAzione(a) {
    const testo = testoVisibile(a && (a.testo ?? a.text ?? a.lezione));
    if (!testo) return { testo: '' };
    const C = global.SN_CONST;
    const n = C.agentStyleLength(testo);
    if (n > C.LESSON_MAX) return { testo, rifiuto: `la lezione è lunga ${n} caratteri e il massimo è ${C.LESSON_MAX}` };
    return { testo };
  }

  // Il setter di un'impostazione, dal percorso che scrive: è la chiave con cui la chat la cambia.
  function setterDi(percorso) {
    return PREF_SETTERS.find((s) => Array.isArray(s.scrive) && s.scrive.includes(percorso)) || null;
  }

  global.SN_PREF = {
    buildPreferencePartial, parsePrefBool, parseItalianNumber, PREF_SETTERS, lezioneDaAzione,
    applicaElenco, righeDescrizione, setterDi, PARAMETRI_COLORE_TAB,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
