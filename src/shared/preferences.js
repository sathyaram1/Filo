// Mappa "linguaggio naturale → preferenza dell'app" per IMPOSTA_PREFERENZA: quali preferenze Filo può
// toccare dalla chat, come se ne leggono i valori e, per ognuna, costo e difesa abbassata (#530).
// Regole: tests/unit/preferences.test.mjs (rischio obbligatorio, testo libero mai tagliato) e vociImpostazioni.test.mjs (`scrive`, `aiuto`).

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

  // Maschera la chiave API nell'etichetta di conferma: i primi e gli ultimi caratteri bastano
  // a riconoscere QUALE chiave si sta impostando, senza stampare il segreto nel popup.
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
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, '');
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : NaN;
  }
  // Il verso opposto, per i numeri interi che l'utente legge: 1.500 ms, 1.200 caratteri.
  const cifre = (n) => Number(n).toLocaleString('it-IT', { useGrouping: true, maximumFractionDigits: 0 });
  const conVirgola = (n) => Number(n).toLocaleString('it-IT', { useGrouping: true, maximumFractionDigits: 2 });
  const decimali = (n) => Number(n).toLocaleString('it-IT', { useGrouping: true, minimumFractionDigits: 1, maximumFractionDigits: 2 });

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
  // «Torna com'era di serie» detto per una voce: non è il nome di una voce, né lo è un sì/no.
  const VOCE_AUTOMATICA = /^(?:auto|automatic[ao]|nessun[ao]?|niente|default|predefinit[ao]|di serie|standard|originale|normale|quella di serie)$/;
  function voceAutomatica(v) {
    if (typeof v === 'boolean' || typeof v === 'number') return true;
    const s = String(v == null ? '' : v).trim().toLowerCase().replace(/[.!]+$/, '');
    return VOCE_AUTOMATICA.test(s) || parsePrefBool(s) !== null;
  }
  // Lo stesso tetto del campo nelle Preferenze.
  const NOTIF_SEC_MAX = 120;
  const VOCE_MAX = 200;

  function tettoStile() {
    const C = global.SN_CONST;
    return C && C.AGENT_STYLE_MAX ? `al massimo ${C.AGENT_STYLE_MAX} caratteri` : 'con un tetto di lunghezza';
  }

  // Una voce che vale solo con un interruttore principale acceso: chiesta con quello spento, Filo lo dice (#835),
  // così «blocca x.com» non promette un blocco che non c'è.
  const PRINCIPALI = {
    bloccoSiti: { percorso: 'security.siteBlock.enabled', nome: 'il blocco dei siti in blacklist', chiave: 'blocco_siti' },
    sitiPericolosi: { percorso: 'security.safeBrowse.enabled', nome: 'l\'avviso sui siti pericolosi', chiave: 'navigazione_sicura' },
  };
  function principaleSpento(sotto, attuali) {
    const m = sotto && PRINCIPALI[sotto];
    if (!m || !attuali || dentro(attuali, m.percorso) !== false) return '';
    return `${m.nome} è spento: finché non si riaccende (chiave ${m.chiave}) questo cambio non ha effetto`;
  }

  // Un interruttore della pagina Sicurezza: a parole sì/no, costo 2 col rischio in chiaro (#949). Spegnerlo
  // abbassa una difesa (#530), tranne dove `spentoAllenta` è falso.
  function interruttore({ keys, percorso, nome, risk, aiuto, stati = ['attivo', 'disattivato'], spentoAllenta = true, sotto = '' }) {
    return {
      keys,
      scrive: [percorso],
      aiuto: aiuto || 'true | false',
      costo: 2,
      allenta: (r) => spentoAllenta && dentro(r.partial, percorso) === false,
      avviso: (r, at) => (dentro(r.partial, percorso) === true ? principaleSpento(sotto, at) : ''),
      risk,
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: nidifica(percorso, b), label: `${nome} → ${b ? stati[0] : stati[1]}` };
      },
    };
  }

  // I limiti dei due tetti stanno con la loro regola (filoContesto.js), che nel main è già caricata.
  function contestoFilo() {
    if (!global.SN_FILO_CONTESTO && typeof require === 'function') require('./filoContesto.js');
    return global.SN_FILO_CONTESTO;
  }

  function lunghezzaRisposte() {
    if (!global.SN_LUNGHEZZA_RISPOSTE && typeof require === 'function') require('./lunghezzaRisposte.js');
    return global.SN_LUNGHEZZA_RISPOSTE;
  }

  // Il tetto delle risposte di una famiglia di funzioni (#1097.3): «16 mila», «32k», «predefinito».
  function setterLunghezza(famiglia, nome, keys) {
    return {
      scrive: [`lunghezzaRisposte.${famiglia}`],
      aiuto: `token 1.024-262.144, o "predefinito" (quanto può essere lunga una risposta per ${nome}; oltre si ferma e lo dice)`,
      keys,
      costo: 2,
      risk: 'Un tetto più alto lascia finire le risposte lunghe, ma un modello che si incarta costa di più prima di fermarsi, e qualche fornitore che non regge il tetto viene scartato; uno più basso costa meno e interrompe prima le risposte lunghe.',
      build(v) {
        const nomeTetto = `Lunghezza massima delle risposte per ${nome}`;
        if (predefinito(v)) return { partial: { lunghezzaRisposte: { [famiglia]: null } }, label: `${nomeTetto} → come i predefiniti` };
        const s = String(v == null ? '' : v).trim().toLowerCase();
        let n = parseItalianNumber(s);
        if (!Number.isFinite(n)) return null;
        if (/\d\s*(k|mila)\b/.test(s)) n *= 1000;
        const token = lunghezzaRisposte().numeroIn(n);
        return { partial: { lunghezzaRisposte: { [famiglia]: token } }, label: `${nomeTetto} → ${token.toLocaleString('it-IT', { useGrouping: true })} token` };
      },
    };
  }

  // Le funzioni che hanno un modello scelto da chi usa Filo, coi nomi con cui si possono dire: quello delle Opzioni,
  // quello del censimento, l'id. «chat» da sola è la chat con Filo: è quella che si intende quasi sempre.
  function funzioniConModello() {
    if (!global.SN_MODEL_USAGE && typeof require === 'function') require('./modelUsage.js');
    const U = global.SN_MODEL_USAGE;
    if (!U || typeof U.list !== 'function') return [];
    const MC = global.SN_MODEL_CHAIN;
    const I18n = global.SN_I18N;
    const opzioni = new Map(MC && typeof MC.actionLabels === 'function' ? MC.actionLabels() : []);
    return U.list().filter((e) => e.from === 'user' && e.ref).map((e) => {
      const chiave = opzioni.get(e.ref);
      const tradotta = chiave && I18n ? I18n.t(chiave) : '';
      const nome = tradotta && tradotta !== chiave ? tradotta : e.label;
      return { action: e.ref, nome, nomi: [nome, e.label, e.id, e.ref].filter(Boolean) };
    });
  }
  const FUNZIONE_DETTA = { chat: 'filo_chat', 'chat con filo': 'filo_chat', 'chat di filo': 'filo_chat', 'chat della home': 'filo_chat' };
  function funzioneDetta(raw) {
    const pk = pianoChiave(raw);
    if (!pk) return { nessuna: true };
    const tutte = funzioniConModello();
    const alias = FUNZIONE_DETTA[pk];
    if (alias) { const f = tutte.find((x) => x.action === alias); if (f) return { f }; }
    const esatte = tutte.filter((x) => x.nomi.some((n) => pianoChiave(n) === pk));
    if (esatte.length === 1) return { f: esatte[0] };
    const dentro = tutte.filter((x) => x.nomi.some((n) => pianoChiave(n).includes(pk)));
    if (dentro.length === 1) return { f: dentro[0] };
    if (dentro.length > 1) return { ambigue: dentro };
    return { nessuna: true };
  }
  // «Chat con Filo: claude, deepseek» → { action, nome, refs }, { rifiuto } o null. Il separatore è il primo «→», «=»
  // o «:» che ha a sinistra una funzione: gli id di OpenRouter possono contenere i due punti.
  function modelloDiFunzione(v) {
    const testo = String(v == null ? '' : v).trim();
    if (!testo) return null;
    let ambigue = null;
    for (const sep of ['→', '=>', '=', ':']) {
      let idx = testo.indexOf(sep);
      while (idx > 0) {
        const f = funzioneDetta(testo.slice(0, idx));
        if (f.f) {
          const refs = testo.slice(idx + sep.length).split(',').map((x) => x.trim()).filter(Boolean);
          if (!refs.length) return null;
          if (refs.some((x) => x.length > 200)) return null;
          return { action: f.f.action, nome: f.f.nome, refs };
        }
        if (f.ambigue && !ambigue) ambigue = f.ambigue;
        idx = testo.indexOf(sep, idx + sep.length);
      }
    }
    const elenco = `Le funzioni sono: ${funzioniConModello().map((x) => `«${x.nome}»`).join(', ')}. Riprova col nome di quella che l'utente intende, o chiediglielo.`;
    if (ambigue) {
      return { rifiuto: `la funzione detta può essere più d'una: ${ambigue.map((x) => `«${x.nome}»`).join(', ')}`, perModello: elenco };
    }
    if (/[→=:]/.test(testo)) return { rifiuto: 'non trovo la funzione di cui cambiare il modello', perModello: elenco };
    return null;
  }

  // Le scorciatoie di Spiega, Traduci, Salva per dopo e Aiuto (#842), come le cambiano le Preferenze: lettura e
  // controlli stanno in SN_TASTI. «Traduci: Ctrl+Maiusc+Y», «Aiuto: di serie», «tutte di serie».
  const NOMI_AZIONE_FILO = {
    'explain-selection': ['spiega', 'spiegazione', 'spiegare', 'approfondisci', 'approfondimento'],
    'translate-selection': ['traduci', 'traduzione', 'tradurre'],
    'save-for-later': ['salva per dopo', 'salvare per dopo', 'salva'],
    'open-help-sidebar': ['aiuto', 'assistente laterale', 'barra dell aiuto'],
  };
  const DI_SERIE = /^(?:(?:tutte|tutti|le scorciatoie|scorciatoie)\s+)?(?:di serie|come di serie|predefinit[aeio]|default|originali?|standard|come prima|ripristina(?:te)?|azzera(?:te)?|reset)$/;
  function azioneFiloDetta(testo) {
    const t = pianoChiave(testo).replace(/[«»"']/g, ' ').replace(/\s+/g, ' ').trim();
    const trovate = Object.keys(NOMI_AZIONE_FILO).filter((id) => NOMI_AZIONE_FILO[id].some((n) => (` ${t} `).includes(` ${n} `)));
    return trovate.length === 1 ? trovate[0] : null;
  }
  function tastiDiFilo() {
    if (!global.SN_TASTI && typeof require === 'function') require('./tasti.js');
    return global.SN_TASTI;
  }
  function scorciatoiaFiloDetta(v) {
    const T = tastiDiFilo();
    const testo = String(v == null ? '' : v).trim();
    if (!T || !testo || testo.length > 200) return null;
    const nomeDi = (id) => T.AZIONI_FILO.find((a) => a.id === id).nome;
    if (DI_SERIE.test(pianoChiave(testo)) || VOCE_AUTOMATICA.test(pianoChiave(testo))) {
      // Quella il cui tasto di serie è ormai di un modulo dell'Editor resta com'è, e si dice perché.
      const serie = Object.fromEntries(T.AZIONI_FILO.map((a) => [a.id, a.serie]));
      const no = T.AZIONI_FILO.map((a) => [a, T.rifiutoScorciatoiaFilo(a.id, a.serie, undefined, serie)]).filter(([, r]) => r);
      const buone = T.AZIONI_FILO.filter((a) => !no.some(([x]) => x === a));
      if (!buone.length) return { rifiuto: no.map(([a, r]) => `«${a.nome}»: ${T.testoRifiutoFilo(r)}`).join(' ') };
      const tranne = no.length ? ` (tranne ${no.map(([a, r]) => `«${a.nome}»: ${T.testoRifiutoFilo(r)}`).join(' ')})` : '';
      return {
        partial: { scorciatoie: Object.fromEntries(buone.map((a) => [a.id, ''])) },
        label: `Scorciatoie di ${buone.map((a) => a.nome).join(', ').replace(/, ([^,]*)$/, ' e $1')} → di serie${tranne}`,
      };
    }
    const sep = testo.search(/[:=→]/);
    if (sep <= 0) return null;
    const id = azioneFiloDetta(testo.slice(0, sep));
    if (!id) {
      return {
        rifiuto: 'non capisco di quale azione cambiare la scorciatoia',
        perModello: `Le azioni sono ${T.AZIONI_FILO.map((a) => `«${a.nome}»`).join(', ')}: scrivi "<azione>: <combinazione>".`,
      };
    }
    const combo = testo.slice(sep + 1).replace(/^>/, '').trim();
    if (DI_SERIE.test(pianoChiave(combo)) || VOCE_AUTOMATICA.test(pianoChiave(combo))) {
      const serie = T.AZIONI_FILO.find((a) => a.id === id).serie;
      const presa = T.rifiutoScorciatoiaFilo(id, serie);
      if (presa) return { rifiuto: T.testoRifiutoFilo(presa) };
      return { partial: { scorciatoie: { [id]: '' } }, label: `Scorciatoia di «${nomeDi(id)}» → ${T.etichettaFilo(serie)}, quella di serie` };
    }
    const d = T.scorciatoiaDaScritta(combo);
    if (!d) return null;
    const no = d.rifiuto || T.rifiutoScorciatoiaFilo(id, d.accel);
    if (no) return { rifiuto: T.testoRifiutoFilo(no) };
    return {
      partial: { scorciatoie: { [id]: T.valoreDaSalvare(id, d.accel) } },
      label: `Scorciatoia di «${nomeDi(id)}» → ${T.etichettaFilo(d.accel)}`,
    };
  }

  // «predefinito», «di serie», «come prima»: torna al valore dei Modelli predefiniti.
  function predefinito(v) {
    if (v === null) return true;
    const s = String(v == null ? '' : v).trim().toLowerCase();
    return ['predefinito', 'predefiniti', 'di serie', 'default', 'come i predefiniti', 'automatico', 'azzera', 'reset'].includes(s);
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
  // La riduzione delle pagine (Sicurezza, Altro): «https://www.Sito.it/x» → «sito.it» (#843).
  function dominioDa(raw) {
    const N = nomiSito();
    return N ? N.daScritto(raw) : '';
  }
  function stessoSito() {
    return global.SN_STESSO_SITO || (typeof require === 'function' ? require('./stessoSito.js') : null);
  }
  function dominiGoogle() {
    return global.SN_DOMINI_GOOGLE || (typeof require === 'function' ? require('./dominiGoogle.js') : null);
  }
  function eseguibili() {
    if (!global.SN_ESEGUIBILI && typeof require === 'function') require('./eseguibili.js');
    return global.SN_ESEGUIBILI || null;
  }
  // #876 — i siti fidati si salvano come li usa Filo, uguali alla pagina Sicurezza: mail.google.com vale google.com, e fra
  // i programmi fidati una piattaforma che ospita i siti di chiunque (github.io) non entra, col perché.
  const RIDUZIONI = {
    'security.cookies.trustedSites': (d) => {
      const S = stessoSito();
      const E = eseguibili();
      const G = dominiGoogle();
      if (S && E && S.piattaforma(d)) return { piattaforma: d, rifiuto: E.testoPiattaforma(d) };
      return { sito: (G && G.sitiDeiFidati([d])[0]) || (S && S.sitoDellaVoce(d)) || d };
    },
    'security.downloads.trustedSites': (d) => {
      const E = eseguibili();
      const v = E ? E.sitoFidabile(d) : null;
      if (v && v.piattaforma) return { piattaforma: v.piattaforma, rifiuto: E.testoPiattaforma(v.piattaforma) };
      return { sito: (v && v.sito) || d };
    },
  };
  // La voce che un elenco salva per `x`: per chi toglie o confronta una voce salvata prima della riduzione.
  function vocePer(percorso, x) {
    const riduci = RIDUZIONI[percorso];
    const d = dominioDa(x);
    if (!riduci || !d) return x;
    const r = riduci(d);
    return (r && r.sito) || d;
  }
  function opElenco(v, riduci) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return null;
    if (SVUOTA.test(s)) return { op: 'sostituisci', voci: [] };
    let op = 'aggiungi';
    let resto = s;
    for (const [nome, re] of OP_ELENCO) {
      const m = s.match(re);
      if (m) { op = nome; resto = s.slice(m[0].length); break; }
    }
    const N = nomiSito();
    const pezzi = N ? N.pezziDi(resto, CONGIUNZIONI) : [];
    if (!pezzi.length) return null;
    const voci = [];
    const errati = [];
    const rifiuti = [];
    for (const p of pezzi) {
      let d = dominioDa(p);
      // Togliere una piattaforma salvata prima che la si rifiutasse deve riuscire: lì resta com'è.
      const r = d && riduci ? riduci(d) : null;
      if (r && r.rifiuto && op !== 'togli') { if (!rifiuti.includes(r.rifiuto)) rifiuti.push(r.rifiuto); continue; }
      if (r && r.sito) d = r.sito;
      if (!d) errati.push(p);
      else if (!voci.includes(d)) voci.push(d);
    }
    if (errati.length) {
      const mostra = (x) => `«${x.length > 60 ? `${x.slice(0, 59)}…` : x}»`;
      return { rifiuto: `${errati.map(mostra).join(', ')} non ${errati.length > 1 ? 'sono domini' : 'è un dominio'}: scrivi il sito con la sua estensione, come facebook.com` };
    }
    if (rifiuti.length) return { rifiuto: rifiuti.join(' ') };
    return { op, voci };
  }
  // `allentaSe` (#530): il verso che abbassa una difesa. 'togli' per un elenco che protegge (un sito tolto
  // torna libero), 'aggiungi' per un elenco di eccezioni; senza l'elenco di adesso «solo …» vale come abbassare.
  function elenco({ keys, percorso, nome, risk, aiuto, allentaSe = null, sotto = '' }) {
    return {
      keys,
      scrive: [percorso],
      aiuto: `"aggiungi <siti>" | "togli <siti>" | "solo <siti>" | "svuota" (${aiuto}; più siti separati da virgole)`,
      costo: 2,
      avviso: (r, at) => (r.elenco && r.elenco.op !== 'togli' && r.elenco.voci.length ? principaleSpento(sotto, at) : ''),
      allenta: (r, at) => {
        const e = r.elenco;
        if (!allentaSe || !e) return false;
        if (e.op !== 'sostituisci') return e.op === allentaSe;
        const prima = at ? dentro(at, percorso) : null;
        if (!Array.isArray(prima)) return true;
        return allentaSe === 'togli' ? prima.some((x) => !e.voci.includes(x)) : e.voci.some((x) => !prima.includes(x));
      },
      risk,
      build(v) {
        const o = opElenco(v, RIDUZIONI[percorso]);
        if (!o || o.rifiuto) return o;
        const lista = o.voci.map(sitoLeggibile).join(', ');
        const label = o.op === 'aggiungi' ? `${nome} → aggiungi ${lista}`
          : o.op === 'togli' ? `${nome} → togli ${lista}`
            : (o.voci.length ? `${nome} → solo ${lista}` : `${nome} → svuota l'elenco`);
        return { partial: nidifica(percorso, o.voci), label, elenco: { percorso, op: o.op, voci: o.voci, nome } };
      },
    };
  }
  // #843 — spegnere Filo su un sito si disfa con una parola e non spegne protezioni (lì tacciono menu, correttore e
  // azioni sulla pagina): costo 1 nei due versi. Un sito alla volta: a costo 1 l'elenco intero non si riscrive.
  function sitiFiloSpento() {
    const base = elenco({
      keys: ['siti_filo_spento', 'domini_esclusi', 'siti dove filo è spento', 'spegni filo sul sito', 'riaccendi filo sul sito',
        'filo spento sul sito', 'domini esclusi', 'siti esclusi', 'blocklist', 'siti dove filo non interviene'],
      percorso: 'blocklist',
      nome: 'Siti dove Filo è spento',
      aiuto: 'siti dove Filo non mette il suo menu del tasto destro, il correttore e le sue azioni sulla pagina; «aggiungi» spegne '
        + 'Filo su quel sito e sui suoi sottodomini, «togli» lo riaccende. Per il sito aperto: «questo sito» (la scheda web davanti)',
      risk: 'Cambia i siti dove Filo si spegne: lì il tasto destro apre il menu del sito, e non ci sono il correttore né le '
        + 'azioni di Filo sulla pagina.',
    });
    return {
      ...base,
      aiuto: base.aiuto.replace(' | "solo <siti>" | "svuota"', ''),
      costo: 1,
      build(v) {
        const o = opElenco(v);
        if (!o || o.rifiuto) return o;
        if (o.op === 'sostituisci') {
          return {
            rifiuto: 'l\'elenco dei siti dove Filo è spento si cambia un sito alla volta',
            perModello: 'Usa «aggiungi <sito>» per spegnere Filo su un sito e «togli <sito>» per riaccenderlo (più siti separati da '
              + 'virgole): l\'elenco intero non si riscrive. Per svuotarlo togli i siti che contiene.',
          };
        }
        const lista = o.voci.map(sitoLeggibile).join(', ');
        const label = o.op === 'aggiungi' ? `Filo spento su ${lista}` : `Filo riacceso su ${lista}`;
        return { partial: nidifica('blocklist', o.voci), label, elenco: { percorso: 'blocklist', op: o.op, voci: o.voci, nome: 'Siti dove Filo è spento' } };
      },
    };
  }

  // Si salva la forma «xn--» con cui il sito si confronta; a una persona si mostra münchen.de, come fa la pagina.
  function sitoLeggibile(x) {
    const N = nomiSito();
    return N && N.leggibile ? N.leggibile(x) : x;
  }
  const sitoLeggibileDi = sitoLeggibile;
  // In Automatico un sito dove Filo ti ha visto entrare è «connesso» come un fidato: «non restare connesso su X»
  // in chat lo toglie da tutti e due gli elenchi, come la voce del menu della scheda (#759).
  const TOGLIE_ANCHE = {
    'security.cookies.trustedSites': (correnti) => {
      const m = dentro(correnti, 'security.cookies.mode');
      return m === 'privacy' || m === 'manual' ? null : 'security.cookies.loggedSites';
    },
  };
  // L'elenco nuovo a partire da quello di adesso: { partial } da salvare, o { invariato } col perché.
  function applicaElenco(e, correnti) {
    const sitoLeggibile = e.percorso === 'documenti.cartelle' ? nomeCartella : sitoLeggibileDi;
    const attuale = (Array.isArray(dentro(correnti, e.percorso)) ? dentro(correnti, e.percorso) : [])
      .filter((x) => typeof x === 'string' && x.trim());
    // Una voce salvata prima della riduzione (mail.google.com) è la stessa di quella ridotta (google.com).
    const presente = (voci, x) => voci.includes(x) || voci.includes(vocePer(e.percorso, x));
    let nuovo;
    if (e.op === 'aggiungi') nuovo = attuale.concat(e.voci.filter((x) => !attuale.some((a) => a === x || vocePer(e.percorso, a) === x)));
    else if (e.op === 'togli') nuovo = attuale.filter((x) => !presente(e.voci, x));
    else nuovo = e.voci.slice();
    const abbinato = e.op === 'togli' && TOGLIE_ANCHE[e.percorso] ? TOGLIE_ANCHE[e.percorso](correnti) : null;
    const primaAbbinato = abbinato && Array.isArray(dentro(correnti, abbinato)) ? dentro(correnti, abbinato) : [];
    const dopoAbbinato = primaAbbinato.filter((x) => !presente(e.voci, x));
    if (abbinato && dopoAbbinato.length !== primaAbbinato.length) {
      const partial = nidifica(e.percorso, nuovo);
      const seg = abbinato.split('.');
      const padre = seg.slice(0, -1).reduce((o, k) => { o[k] = o[k] || {}; return o[k]; }, partial);
      padre[seg[seg.length - 1]] = dopoAbbinato;
      return { partial, lista: nuovo };
    }
    if (nuovo.length === attuale.length && nuovo.every((x, i) => x === attuale[i])) {
      const ha = attuale.length ? `adesso contiene: ${attuale.map(sitoLeggibile).join(', ')}` : 'adesso è vuoto';
      const voci = e.voci.map(sitoLeggibile).join(', ');
      const perche = e.op === 'aggiungi' ? `${voci} ${e.voci.length > 1 ? 'ci sono' : 'c\'è'} già`
        : e.op === 'togli' ? `${voci} non ${e.voci.length > 1 ? 'ci sono' : 'c\'è'}` : 'è già così';
      return { invariato: `nell'elenco «${e.nome}» ${perche} (${ha})` };
    }
    return { partial: nidifica(e.percorso, nuovo), lista: nuovo };
  }

  // ── Cartelle dei documenti (#947) ──────────────────────────────────────────
  // Le cartelle in cui Filo cerca i documenti per contenuto. Le tre di sistema si dicono a parole e restano parole (il
  // main le risolve su ogni piattaforma); le altre sono percorsi interi o con ~. Un percorso può contenere spazi e
  // virgole, quindi più cartelle si separano col punto e virgola.
  const CARTELLE_DI_SERIE = {
    documenti: 'documenti', documents: 'documenti', download: 'download', downloads: 'download', scaricati: 'download',
    scaricamenti: 'download', scrivania: 'scrivania', desktop: 'scrivania',
  };
  const NOMI_CARTELLE_DI_SERIE = { documenti: 'Documenti', download: 'Download', scrivania: 'Scrivania' };
  function voceCartella(raw) {
    let s = String(raw == null ? '' : raw).trim().replace(/^["'«(]+|["'»)]+$/g, '').trim()
      .replace(/^(?:la\s+)?cartella\s+/i, '').trim();
    if (!s) return '';
    const chiave = CARTELLE_DI_SERIE[s.toLowerCase()];
    if (chiave) return chiave;
    if (s.length > 1) s = s.replace(/[\\/]+$/, '');
    // Nel main «~» diventa la cartella personale: così «togli ~/Lavoro» trova la cartella scelta dalla pagina.
    if (/^~([\\/]|$)/.test(s)) {
      let casa = '';
      try { casa = typeof require === 'function' ? require('node:os').homedir() : ''; } catch (_) { casa = ''; }
      return casa ? casa + s.slice(1) : s;
    }
    if (/^[a-zA-Z]:[\\/]/.test(s) || /^[\\/]/.test(s)) return s;
    return '';
  }
  function nomeCartella(v) { return NOMI_CARTELLE_DI_SERIE[v] || v; }
  function elencoCartelle() {
    const percorso = 'documenti.cartelle';
    const nome = 'Cartelle dei documenti';
    return {
      keys: ['cartelle_documenti', 'cartelle dei documenti', 'cartelle documenti', 'dove cercare i documenti',
        'cartelle della ricerca nei documenti', 'ricerca nei documenti'],
      scrive: [percorso],
      aiuto: '"aggiungi <cartella>" | "togli <cartella>" | "solo <cartella>" | "svuota" (le cartelle in cui Filo cerca i '
        + 'documenti per contenuto; di serie Documenti, Download e Scrivania; le altre col percorso intero o con ~, più '
        + 'cartelle separate da punto e virgola; svuotato, Filo non legge più nessun documento; «togli» fa dimenticare anche '
        + 'una cartella dove l\'utente ha cercato una volta, coi documenti che Filo ne ha già letto)',
      costo: 2,
      // Una cartella in più è un posto in più dove Filo legge: abbassa una difesa come aggiungere un sito fidato.
      allenta: (r) => !!r.elenco && r.elenco.op !== 'togli' && r.elenco.voci.length > 0,
      risk: 'Cambia le cartelle in cui Filo cerca i tuoi documenti quando li chiedi a parole. Filo ne legge il testo e '
        + 'lo tiene sul computer in un indice; a un modello arrivano solo i pochi documenti candidati di una ricerca. '
        + 'Una cartella tolta esce subito dall\'indice.',
      build(v) {
        const s = String(v == null ? '' : v).trim();
        if (!s) return null;
        if (SVUOTA.test(s)) {
          return { partial: nidifica(percorso, []), label: `${nome} → svuota l'elenco`, elenco: { percorso, op: 'sostituisci', voci: [], nome } };
        }
        let op = 'aggiungi';
        let resto = s;
        for (const [n, re] of OP_ELENCO) {
          const m = s.match(re);
          if (m) { op = n; resto = s.slice(m[0].length); break; }
        }
        const voci = [];
        const errati = [];
        for (const pezzo of resto.split(/\s*[;\n]\s*/).map((x) => x.trim()).filter(Boolean)) {
          const c = voceCartella(pezzo);
          if (!c) errati.push(pezzo);
          else if (!voci.includes(c)) voci.push(c);
        }
        if (errati.length) {
          const mostra = (x) => `«${x.length > 60 ? `${x.slice(0, 59)}…` : x}»`;
          return { rifiuto: `${errati.map(mostra).join(', ')} non ${errati.length > 1 ? 'sono cartelle' : 'è una cartella'}: `
            + 'scrivi il percorso intero (o con ~ per la cartella personale), oppure Documenti, Download o Scrivania' };
        }
        if (!voci.length) return null;
        const lista = voci.map(nomeCartella).join(', ');
        const label = op === 'aggiungi' ? `${nome} → aggiungi ${lista}`
          : op === 'togli' ? `${nome} → togli ${lista}` : `${nome} → solo ${lista}`;
        // Un percorso lo scrive il modello e può contenere quasi ogni carattere: nel popup sta nel riquadro (#592.7).
        const campo = `${nome}, ${op === 'aggiungi' ? 'aggiungi' : op === 'togli' ? 'togli' : 'solo'}`;
        return { partial: nidifica(percorso, voci), label, campo, valore: lista, elenco: { percorso, op, voci, nome } };
      },
    };
  }

  // I sei parametri del colore delle tab, uno per uno come nella pagina (#949). Range e nomi li dà tabColor.js.
  function metaColoreTab(chiave) {
    const TC = global.SN_TAB_COLOR;
    return TC && Array.isArray(TC.IDENTITY_PARAM_META) ? TC.IDENTITY_PARAM_META.find((m) => m.key === chiave) : null;
  }
  const PARAMETRI_COLORE_TAB = ['saturazione_tab', 'luminosita_tab', 'opacita_tab', 'soglia_saturazione', 'peso_centralita', 'bucket_tinta'];
  function parametroColoreTab(chiave) {
    return {
      costo: 1,
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

  // Volume 0-100. Accetta anche le parole con cui lo si chiede a voce; null se
  // non è né una parola nota né un numero, così non si spegne niente per sbaglio.
  function parseVolume(raw) {
    const s = String(raw == null ? '' : raw).trim().toLowerCase();
    const parole = { muto: 0, muta: 0, zero: 0, silenzio: 0, basso: 30, bassa: 30, piano: 30, medio: 60, media: 60, alto: 100, alta: 100, massimo: 100, forte: 100 };
    const n = Object.prototype.hasOwnProperty.call(parole, s)
      ? parole[s]
      : parseInt(s.replace('%', ''), 10);
    if (!Number.isFinite(n)) return null;
    return Math.min(100, Math.max(0, n));
  }

  // Una soglia dell'avviso dei crediti (#818): fuori dai limiti è un rifiuto col numero, mai un taglio.
  function setterSogliaCrediti(k, aiuto, keys, etichetta) {
    return {
      scrive: [`avvisoCrediti.${k}`], aiuto, keys, costo: 1,
      build(v) {
        const C = global.SN_CONST;
        if (predefinito(v)) {
          const d = C.DEFAULT_SETTINGS.avvisoCrediti[k];
          return { partial: { avvisoCrediti: { [k]: d } }, label: etichetta(d) };
        }
        const n = parseItalianNumber(String(v == null ? '' : v).replace(/[^0-9.,-]/g, ''));
        if (!Number.isFinite(n)) return null;
        const [min, max] = C.AVVISO_CREDITI_LIMITI[k];
        if (n < min || n > max) return { rifiuto: `${conVirgola(n)} è fuori dai limiti: da ${conVirgola(min)} a ${conVirgola(max)}` };
        return { partial: { avvisoCrediti: { [k]: n } }, label: etichetta(n) };
      },
    };
  }

  // Un tempo della barra laterale in millisecondi ("300", "300 ms", "0,5 secondi"); fuori dai limiti è un
  // rifiuto col numero, mai un taglio. Un numero sotto 10 senza unità sono secondi: nessuno chiede 1 ms.
  // I tempi del correttore (#1446): come quelli della barra, «mezzo secondo» o «800 ms»; fuori dai limiti si rifiuta col numero.
  function msCorrettore(v, campo, etichetta) {
    const s = String(v == null ? '' : v).trim().toLowerCase();
    let n = parseItalianNumber(s.replace(/[^0-9.,-]/g, ''));
    if (!Number.isFinite(n)) return null;
    const ms = /\bms\b|millisecond/.test(s);
    if ((/\bs(ec|econd[oi])?\b/.test(s) && !ms) || (!ms && !/[a-z]/.test(s) && n > 0 && n < 100)) n *= 1000;
    n = Math.round(n);
    const { min, max } = global.SN_CONST.CORRETTORE_TEMPI[campo];
    if (n < min || n > max) return { rifiuto: `${cifre(n)} ms è fuori dai limiti: da ${cifre(min)} a ${cifre(max)} ms` };
    return { partial: { correttore: { [campo]: n } }, label: etichetta(cifre(n)) };
  }

  // Quante volte serve per imparare, nella correzione automatica (#1447): un numero intero dentro i limiti.
  function volteCorrettore(v, campo, etichetta) {
    const n = parseItalianNumber(String(v == null ? '' : v).trim().toLowerCase().replace(/[^0-9.,-]/g, ''));
    if (!Number.isFinite(n)) return null;
    const volte = Math.round(n);
    const { min, max } = global.SN_CONST.CORRETTORE_SOGLIE[campo];
    if (volte < min || volte > max) return { rifiuto: `${cifre(volte)} volte è fuori dai limiti: da ${cifre(min)} a ${cifre(max)}` };
    return { partial: { correttore: { [campo]: volte } }, label: etichetta(cifre(volte)) };
  }

  function msBarra(v, campo, etichetta) {
    const s = String(v == null ? '' : v).trim().toLowerCase();
    let n = parseItalianNumber(s.replace(/[^0-9.,-]/g, ''));
    if (!Number.isFinite(n)) return null;
    const ms = /\bms\b|millisecond/.test(s);
    if ((/\bs(ec|econd[oi])?\b/.test(s) && !ms) || (!ms && !/[a-z]/.test(s) && n > 0 && n < 10)) n *= 1000;
    n = Math.round(n);
    const [min, max] = global.SN_CONST.BARRA_LATERALE_LIMITI[campo];
    if (n < min || n > max) return { rifiuto: `${cifre(n)} ms è fuori dai limiti: da ${cifre(min)} a ${cifre(max)} ms` };
    return { partial: { barraLaterale: { [campo]: n } }, label: etichetta(cifre(n)) };
  }

  // Il minimo è un secondo: un numero sotto 100 senza unità sono secondi («mettilo a 5»).
  function msAvvisoSchermoPieno(v) {
    const s = String(v == null ? '' : v).trim().toLowerCase();
    let n = parseItalianNumber(s.replace(/[^0-9.,-]/g, ''));
    if (!Number.isFinite(n)) return null;
    const ms = /\bms\b|millisecond/.test(s);
    if ((/\bs(ec|econd[oi])?\b/.test(s) && !ms) || (!ms && !/[a-z]/.test(s) && n > 0 && n < 100)) n *= 1000;
    n = Math.round(n);
    const [min, max] = global.SN_CONST.AVVISO_SCHERMO_PIENO_LIMITI.durataMs;
    if (n < min || n > max) return { rifiuto: `${cifre(n)} ms è fuori dai limiti: da ${cifre(min)} a ${cifre(max)} ms` };
    return { partial: { avvisoSchermoPieno: { durataMs: n } }, label: `Avviso del sito a schermo intero → ${cifre(n)} ms` };
  }

  // Quanto stringe un modo: scendere di rigore abbassa una difesa. Il valore attuale ignoto vale il più stretto.
  const RIGORE_COOKIE = { manual: 0, default: 1, privacy: 2 };
  const RIGORE_IMPRONTA = { off: 0, default: 1, privacy: 2 };
  function scende(rigore, nuovo, attuale) {
    const prima = Object.prototype.hasOwnProperty.call(rigore, attuale) ? rigore[attuale] : 2;
    return rigore[nuovo] < prima;
  }

  // Ogni voce: sinonimi di chiave + build(valore) → { partial, label }; `partial` si fonde nelle impostazioni.
  // `costo` (0-3) è il costo di sbagliare quando la cambia FILO dalla chat; `allenta(r, attuali)` dice se il
  // valore abbassa una difesa (vuole «conferma» a ogni livello); `elencoFisso` la mette nell'elenco fisso.
  // `risk` è obbligatorio dal costo 2 o con `allenta`: è il rischio che il popup mostra.
  const PREF_SETTERS = [
    {
      scrive: ['theme'],
      aiuto: '"sistema" | "chiaro" | "scuro"',
      costo: 1,
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
      costo: 1,
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
      aiuto: 'true | false (Filo scrive per primo nella home quando succede qualcosa)',
      costo: 1,
      keys: ['scrive_per_primo', 'filo scrive per primo', 'scrive per primo', 'commento_home', 'commento nella home', 'commento home', 'messaggio home', 'messaggio nella home', 'showhomemessage', 'commento'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { showHomeMessage: b }, label: `Filo scrive per primo → ${b ? 'sì' : 'no'}` };
      },
    },
    // Ora, batteria, rete, Bluetooth e volume nella home (#873, #874): una voce per chiave, le altre restano come sono.
    ...[
      ['ora', "l'ora", ['orologio']],
      ['batteria', 'la batteria', []],
      ['rete', 'la rete', ['wifi', 'wi-fi', 'connessione']],
      ['bluetooth', 'il Bluetooth', []],
      ['volume', 'il volume', ['audio']],
    ].map(([voce, nome, sinonimi]) => ({
      scrive: [`homeSistema.${voce}`],
      aiuto: `true | false (${nome} nella colonna destra della home)`,
      costo: 1,
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
      // Entra in ogni prompt conversazionale e ci resta, come una lezione: costo 2, e
      // quando si chiede il popup mostra il testo esatto (#592). Anche toglierlo, che lo perde.
      costo: 2,
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
          return { rifiuto: `lo stile è lungo ${cifre(n)} caratteri e il massimo è ${cifre(C.AGENT_STYLE_MAX)}` };
        }
        return { partial: { agentStyle: s }, label: "Stile dell'agente", testo: s };
      },
    },
    {
      scrive: ['autoArchive.enabled'],
      aiuto: 'true | false (riordino e archiviazione automatici delle schede)',
      costo: 1,
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
      costo: 1,
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
      costo: 1,
      keys: ['ore_inattivita', 'ore inattivita', 'ore di inattivita', 'ore_inattivita_archivio', 'idlehours', 'ore inattività'],
      build(v) {
        // Con la virgola: «1,5» è un'ora e mezza, non 15. La pagina tiene ore intere.
        // L'unità detta conta: «2 giorni» sono 48 ore, non 2; senza cifra «una settimana» è una.
        const s = String(v == null ? '' : v).trim().toLowerCase();
        const per = /settiman/.test(s) ? 168 : /giorn/.test(s) ? 24 : /\bmin/.test(s) ? 1 / 60 : 1;
        let n = /\d/.test(s) ? parseItalianNumber(s) : (/mezz/.test(s) ? 0.5 : (per !== 1 || /\bor[ae]\b/.test(s) ? 1 : NaN));
        if (!Number.isFinite(n)) return null;
        n *= per;
        if (n <= 0) return { rifiuto: `le ore di inattività vanno da 1 a 168, e ${String(v).trim()} è fuori` };
        n = Math.min(168, Math.max(1, Math.round(n)));
        return { partial: { autoArchive: { idleHours: n } }, label: `Archivia dopo ${n} ${n === 1 ? 'ora' : 'ore'} di inattività` };
      },
    },
    {
      scrive: ['barraLaterale.spinta'],
      costo: 1,
      aiuto: 'true | false (la barra laterale si apre spingendo il mouse sul bordo sinistro)',
      keys: ['barra_spinta', 'barra spinta', 'apertura dal bordo', 'apri la barra dal bordo', 'spinta sul bordo', 'bordo sinistro'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { barraLaterale: { spinta: b } }, label: `Barra laterale spingendo sul bordo → ${b ? 'si apre' : 'non si apre'}` };
      },
    },
    {
      scrive: ['barraLaterale.attesaMs'],
      costo: 1,
      aiuto: 'millisecondi 100-3000 (attesa sul bordo prima che la barra laterale si apra)',
      keys: ['barra_attesa', 'barra attesa', 'attesa sul bordo', 'attesa della spinta', 'ritardo apertura barra'],
      build(v) { return msBarra(v, 'attesaMs', (n) => `Attesa sul bordo prima che la barra si apra → ${n} ms`); },
    },
    {
      scrive: ['barraLaterale.uscitaMs'],
      costo: 1,
      aiuto: 'millisecondi 100-5000 (dopo quanto la barra laterale si chiude quando il mouse esce)',
      keys: ['barra_uscita', 'barra uscita', 'chiusura della barra', 'ritardo chiusura barra', 'barra resta aperta'],
      build(v) { return msBarra(v, 'uscitaMs', (n) => `La barra si chiude ${n} ms dopo che il mouse esce`); },
    },
    {
      scrive: ['barraLaterale.striscia'],
      costo: 1,
      aiuto: 'true | false (la striscia sottile sul bordo sinistro che indica la barra laterale)',
      keys: ['barra_striscia', 'barra striscia', 'striscia sul bordo', 'striscia', 'indizio della barra'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { barraLaterale: { striscia: b } }, label: `Striscia della barra laterale → ${b ? 'visibile' : 'nascosta'}` };
      },
    },
    {
      scrive: ['barraLaterale.schede'],
      costo: 1,
      aiuto: 'true | false (a schermo intero le schede compaiono portando il mouse sul bordo alto, e spariscono allontanandolo)',
      keys: ['barra_schede', 'schede a schermo intero', 'schede dal bordo alto', 'mostra le schede a schermo intero', 'schede in alto a schermo intero'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { barraLaterale: { schede: b } }, label: `Schede dal bordo alto a schermo intero → ${b ? 'compaiono' : 'restano nascoste'}` };
      },
    },
    {
      scrive: ['avvisoSchermoPieno.durataMs'],
      costo: 1,
      aiuto: 'millisecondi 1000-10000 (quanto resta l\'avviso col nome del sito quando una pagina va a schermo intero; non si spegne)',
      keys: ['avviso_schermo_pieno', 'avviso schermo pieno', 'avviso schermo intero', 'avviso a schermo intero',
        'durata avviso schermo intero', 'avviso del sito a schermo intero', 'esc per uscire'],
      build(v) { return msAvvisoSchermoPieno(v); },
    },
    {
      scrive: ['terminal.enabled'],
      aiuto: 'true | false',
      keys: ['modalita_terminale', 'modalità terminale', 'modalita terminale', 'terminale', 'terminal'],
      // La modalità terminale dà a Filo accesso alla shell: conferma esplicita.
      costo: 2,
      allenta: (r) => r.partial.terminal.enabled === true,
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
      scrive: ['schermo.guarda'],
      aiuto: 'true | false (Filo guarda una finestra o lo schermo quando glielo chiedi in chat)',
      keys: ['guarda_schermo', 'filo può guardare lo schermo', 'filo puo guardare lo schermo', 'guardare lo schermo',
        'guarda lo schermo', 'vedi schermo', 'vedi_schermo', 'guarda le finestre'],
      costo: 2,
      // Accenderla vuole sempre un OK, a ogni livello di autonomia: un clic, non la parola (#778). Non abbassa una
      // difesa: anche accesa, la prima occhiata a ogni finestra di un'altra app chiede.
      chiede: (r) => r.partial.schermo.guarda === true,
      risk: 'Da accesa, quando glielo chiedi in chat Filo cattura l\'immagine di una finestra o dello schermo e la fa leggere '
        + 'a un modello che vede le immagini, insieme alla tua domanda. Quello che si vede in quella finestra arriva quindi al modello. '
        + 'La prima volta che guarda una finestra di un\'altra app, a ogni tua richiesta, ti chiede l\'OK dicendoti quale. '
        + 'Filo guarda soltanto: non clicca, non scrive e non salva l\'immagine. Da spenta, non guarda niente fuori dalla chat.',
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { schermo: { guarda: b } }, label: `Guardare lo schermo → ${b ? 'acceso' : 'spento'}` };
      },
    },
    {
      scrive: ['nomiSensati.scaricamenti'],
      aiuto: 'true | false (nome sensato da solo ai file scaricati col nome che non dice niente)',
      keys: ['nomi_sensati_scaricamenti', 'nome sensato agli scaricamenti', 'nomi sensati', 'rinomina scaricamenti',
        'rinomina i file scaricati', 'nomi dei file scaricati', 'nomisensati'],
      // Da accesa il contenuto dei file scaricati va a un modello senza una richiesta per ciascuno: conferma.
      costo: 2,
      allenta: (r) => r.partial.nomiSensati.scaricamenti === true,
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
      scrive: ['aggiornamenti.automatici'],
      aiuto: 'true | false (scarica e installa da solo le versioni nuove; spento avvisa e aspetta «Installa»)',
      keys: ['aggiornamenti_automatici', 'aggiornamenti automatici', 'installa gli aggiornamenti da solo',
        'aggiornamento automatico', 'aggiornati da solo', 'aggiornamenti', 'autoupdate', 'auto update'],
      // Spento lascia aperti i problemi di sicurezza già corretti: chi lo spegne lo sa prima.
      costo: 2,
      allenta: (r) => r.partial.aggiornamenti.automatici === false,
      risk: 'Decide se Filo scarica e installa da solo le versioni nuove. Da spento, a ogni avvio controlla '
        + 'comunque e ti avvisa nella home, ma non scarica niente finché non premi «Installa». Fino ad allora '
        + 'restano aperti anche i problemi di sicurezza già corretti nelle versioni nuove.',
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { aggiornamenti: { automatici: b } }, label: `Installa gli aggiornamenti da solo → ${b ? 'acceso' : 'spento'}` };
      },
    },
    {
      scrive: ['aggiornamenti.installa'],
      aiuto: '"apertura" | "chiusura", o true per "in silenzio" (solo su Windows: una versione nuova di Filo già scaricata si installa la prossima volta che lo apri, con la barra di avanzamento, oppure in silenzio quando lo chiudi)',
      keys: ['installazione_aggiornamenti', 'installazione aggiornamenti', 'installazione degli aggiornamenti',
        'quando installare gli aggiornamenti', 'aggiornamenti silenziosi', 'aggiornamento silenzioso', 'aggiornamenti in silenzio',
        'installa aggiornamenti'],
      costo: 1,
      build(v) {
        const s = String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
        const map = {
          avvio: 'avvio', apertura: 'avvio', 'all\'apertura': 'avvio', 'all\'avvio': 'avvio', 'con la barra': 'avvio',
          visibile: 'avvio', predefinito: 'avvio', predefinita: 'avvio', 'di serie': 'avvio',
          chiusura: 'chiusura', 'alla chiusura': 'chiusura', 'quando chiudo': 'chiusura', 'in silenzio': 'chiusura',
          silenzioso: 'chiusura', silenziosa: 'chiusura', silenzio: 'chiusura',
        };
        const silenzio = parsePrefBool(v);
        const modo = map[s] || (silenzio === null ? null : (silenzio ? 'chiusura' : 'avvio'));
        if (!modo) return null;
        const A = global.SN_AGGIORNAMENTI;
        const altrove = A && A.sceltaNonVale ? A.sceltaNonVale() : null;
        if (altrove) return { rifiuto: altrove };
        return {
          partial: { aggiornamenti: { installa: modo } },
          label: `Installazione degli aggiornamenti → ${modo === 'avvio' ? 'all\'apertura, con la barra' : 'in silenzio alla chiusura'}`,
        };
      },
    },
    // #1124 — il sito riceve l'email solo quando l'utente la sceglie: accendere e spegnere non cede niente.
    {
      scrive: ['propostaEmail.attiva'],
      aiuto: 'true | false (nei campi email o nome utente dei siti propone l\'email dell\'account Filo; il sito la riceve solo se la scegli)',
      keys: ['proposta_email', 'proposta email', 'proponi email', 'proponi la mia email', 'suggerisci email',
        'suggerimento email', 'email nei siti', 'email nei campi', 'autocompila email', 'autocompilazione email',
        'compila email', 'email dell\'account nei siti'],
      costo: 1,
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { propostaEmail: { attiva: b } }, label: `La tua email proposta nei siti → ${b ? 'attiva' : 'spenta'}` };
      },
    },
    {
      scrive: ['propostaEmail.incognito'],
      aiuto: 'true | false (la stessa proposta dell\'email anche nelle finestre in incognito; di serie spenta)',
      keys: ['proposta_email_incognito', 'proposta email incognito', 'proposta email in incognito',
        'email in incognito', 'suggerisci email in incognito', 'proponi email in incognito'],
      costo: 1,
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { propostaEmail: { incognito: b } }, label: `La tua email proposta anche in incognito → ${b ? 'attiva' : 'spenta'}` };
      },
    },
    {
      scrive: ['terminal.shell'],
      aiuto: (ctx) => ctx.shellPref,
      keys: ['shell_terminale', 'shell terminale', 'shell'],
      costo: 2,
      risk: 'Sceglie quale shell usa Filo per eseguire i comandi del terminale (su Windows '
        + 'PowerShell, Prompt dei comandi o Bash; su Mac e Linux sh o Bash). Cambia come '
        + 'vengono interpretati i comandi che Filo lancia.',
      build(v) {
        const s = String(v == null ? '' : v).trim().toLowerCase();
        // 'sh' e 'zsh' sono i nomi che ha senso pronunciare su Mac e Linux, dove powershell e cmd
        // non esistono: il main ricade comunque su /bin/sh, ma la richiesta per nome deve arrivare.
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
      costo: 1,
      keys: ['velocita_voce', 'velocità voce', 'velocita voce', 'velocità lettura', 'velocita lettura', 'ttsrate'],
      build(v) {
        let n = parseItalianNumber(v);
        if (!Number.isFinite(n)) return null;
        n = Math.max(0.5, Math.min(2, n));
        return { partial: { tts: { rate: n } }, label: `Velocità lettura → ${decimali(n)}×` };
      },
    },
    {
      scrive: ['tts.pitch'],
      aiuto: 'numero 0-2 (tono della lettura ad alta voce)',
      costo: 1,
      keys: ['tono_voce', 'tono voce', 'tono lettura', 'ttspitch'],
      build(v) {
        let n = parseItalianNumber(v);
        if (!Number.isFinite(n)) return null;
        n = Math.max(0, Math.min(2, n));
        return { partial: { tts: { pitch: n } }, label: `Tono lettura → ${decimali(n)}` };
      },
    },
    {
      // La voce TTS è una stringa URI (voiceURI o nome del sistema): si imposta
      // passando la stringa esatta come valore (il sistema la riconosce all'avvio).
      // Reversibile (puoi cambiarla di nuovo) → costo 1.
      scrive: ['tts.voice'],
      aiuto: 'il nome di una voce installata nel sistema (voce di riserva della lettura)',
      costo: 1,
      keys: ['voce', 'voce lettura', 'voce tts', 'ttsvoice', 'voce del sistema'],
      build(v) {
        const s = String(v == null ? '' : v).trim();
        if (!s) return null;
        if (voceAutomatica(v)) return { partial: { tts: { voice: '' } }, label: 'Voce di lettura → automatica' };
        return { partial: { tts: { voice: s } }, label: `Voce di lettura → "${s}"`, campo: 'Voce di lettura', valore: s };
      },
    },
    {
      // Voce del MODELLO di lettura (quella naturale): si indica per nome
      // ("Sara", "Nicola") o per id ("if_sara"); "automatica" torna a seguire
      // la lingua del testo. Reversibile → costo 1.
      scrive: ['tts.modelVoice'],
      aiuto: '"automatica" o il nome di una voce naturale, come "Sara" o "Nicola" (voce della lettura ad alta voce)',
      costo: 1,
      keys: ['voce_modello', 'voce del modello', 'voce naturale', 'voce modello', 'ttsmodelvoice'],
      build(v) {
        const s = String(v == null ? '' : v).trim();
        if (!s) return null;
        const low = s.toLowerCase();
        if (voceAutomatica(v) || low === 'lingua') {
          return { partial: { tts: { modelVoice: '' } }, label: 'Voce naturale → automatica (segue la lingua del testo)' };
        }
        const Voices = global.SN_TTS_VOICES;
        if (Voices) {
          // Si cerca fra TUTTI i cataloghi: quale modello legge non lo sa questa pagina, e una voce
          // di un altro modello viene comunque ignorata al momento della lettura.
          const hit = Voices.allVoices().find((x) => x.id === low || x.id.toLowerCase() === low
            || x.label.toLowerCase() === low || x.label.toLowerCase().split(' ')[0] === low);
          if (hit) return { partial: { tts: { modelVoice: hit.id } }, label: `Voce naturale → ${hit.label} (${Voices.LANG_LABELS[hit.lang] || hit.lang})` };
        }
        // Come «Altra voce: scrivi il nome…» della pagina: un nome fuori catalogo si salva com'è scritto.
        const nome = testoVisibile(s);
        if (!nome) return null;
        if (nome.length > VOCE_MAX) return { rifiuto: `il nome della voce è lungo ${cifre(nome.length)} caratteri e il massimo è ${VOCE_MAX}` };
        return { partial: { tts: { modelVoice: nome } }, label: `Voce naturale → "${nome}" (nome scritto a mano)`, campo: 'Voce naturale scritta a mano', valore: nome };
      },
    },

    // ── Funzionalità (interruttori) — reversibili, nessun rischio → costo 1 ──
    // Il correttore (#1446): «Errori» e «Suggerimenti», la parte del modello degli errori, le ripetizioni, i tempi.
    {
      scrive: ['featureFlags.spellcheck'],
      aiuto: 'true | false (gli ERRORI del correttore: parole sbagliate, grammatica, fatti sbagliati, con l\'onda sotto; spento toglie anche la sottolineatura del browser)',
      costo: 1,
      keys: ['correttore', 'correttore ortografico', 'correttore_ortografico', 'controllo ortografico', 'spellcheck', 'correzione', 'errori', 'errori del correttore', 'segna errori', 'zigzag blu', 'sottolineatura rossa'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { featureFlags: { spellcheck: b } }, label: `Errori del correttore → ${b ? 'attivi' : 'spenti'}` };
      },
    },
    {
      scrive: ['featureFlags.spellcheckContext'],
      aiuto: 'true | false (i SUGGERIMENTI del correttore, che decide l\'utente: frasi poco chiare, date e giorni che non tornano, contraddizioni con la pagina, coi puntini sotto)',
      costo: 1,
      keys: ['suggerimenti', 'suggerimenti del correttore', 'coerenza', 'controllo coerenza', 'controllo di coerenza', 'coerenza col contesto', 'puntini ocra', 'sottolineatura ocra', 'incoerenze', 'contraddizioni'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { featureFlags: { spellcheckContext: b } }, label: `Suggerimenti del correttore → ${b ? 'attivi' : 'spenti'}` };
      },
    },
    {
      scrive: ['correttore.modelloErrori'],
      aiuto: 'true | false (un modello controlla gli errori del correttore; spento restano solo quelli che Filo trova da sé, sbiaditi i dubbi, e non si spende)',
      costo: 1,
      keys: ['modello errori', 'controllo rapido', 'correttore col modello', 'correttore senza modello', 'correttore senza ai', 'modello del correttore'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { correttore: { modelloErrori: b } }, label: `Controllo degli errori col modello → ${b ? 'attivo' : 'spento'}` };
      },
    },
    {
      scrive: ['correttore.ripetizioni'],
      aiuto: 'true | false (il correttore segna le parole ripetute per sbaglio, come «il il»)',
      costo: 1,
      keys: ['ripetizioni', 'parole ripetute', 'il il', 'segna ripetizioni'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { correttore: { ripetizioni: b } }, label: `Parole ripetute nel correttore → ${b ? 'segnate' : 'non segnate'}` };
      },
    },
    {
      scrive: ['correttore.segnaposti'],
      aiuto: 'true | false (i SEGNAPOSTO del correttore: l\'utente scrive delle x al posto di un dato che non ricorda, «nel 14xx», e Filo lo trova e lo propone sopra le x)',
      costo: 1,
      keys: ['segnaposto', 'segnaposti', 'dati mancanti', 'riempi le x', 'xx', 'dato da trovare', 'completa i dati'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { correttore: { segnaposti: b } }, label: `Segnaposto del correttore → ${b ? 'attivi' : 'spenti'}` };
      },
    },
    {
      scrive: ['correttore.segnapostiWeb'],
      aiuto: 'true | false (per un segnaposto con un dato che cambia nel tempo, come prezzi e quotazioni, il correttore cerca anche sul web, circa 0,8 centesimi a ricerca; spento cerca solo su Wikipedia)',
      costo: 1,
      keys: ['cerca sul web per i segnaposto', 'ricerca web segnaposto', 'segnaposto sul web', 'segnaposti web'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { correttore: { segnapostiWeb: b } }, label: `Ricerca sul web per i segnaposto → ${b ? 'attiva' : 'spenta'}` };
      },
    },
    {
      scrive: ['correttore.pausaRapidoMs'],
      costo: 1,
      aiuto: 'millisecondi 200-5000 (pausa nello scrivere prima del controllo degli errori)',
      keys: ['pausa errori', 'attesa correttore', 'pausa del correttore', 'controllo rapido dopo'],
      build(v) { return msCorrettore(v, 'pausaRapidoMs', (n) => `Controllo degli errori dopo ${n} ms di pausa`); },
    },
    {
      scrive: ['correttore.ogniRapidoMs'],
      costo: 1,
      aiuto: 'millisecondi 1000-60000 (mentre si scrive senza pause, ogni quanto parte il controllo degli errori)',
      keys: ['ogni quanto errori', 'controllo rapido ogni', 'frequenza correttore'],
      build(v) { return msCorrettore(v, 'ogniRapidoMs', (n) => `Controllo degli errori al più ogni ${n} ms mentre scrivi`); },
    },
    {
      scrive: ['correttore.pausaRagionatoMs'],
      costo: 1,
      aiuto: 'millisecondi 1000-30000 (pausa nello scrivere prima del controllo dei suggerimenti)',
      keys: ['pausa suggerimenti', 'controllo ragionato dopo', 'attesa suggerimenti'],
      build(v) { return msCorrettore(v, 'pausaRagionatoMs', (n) => `Controllo dei suggerimenti dopo ${n} ms di pausa`); },
    },
    {
      scrive: ['correttore.automatica'],
      aiuto: 'true | false (la correzione automatica a fine parola: «perchè» → «perché», «marco» → «Marco»; si annulla subito dopo con la scorciatoia di annulla o col tasto destro sulla parola)',
      costo: 1,
      keys: ['correzione automatica', 'autocorrezione', 'autocorrect', 'correggi da solo', 'correggi in automatico', 'correzione a fine parola', 'maiuscole dei nomi'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { correttore: { automatica: b } }, label: `Correzione automatica → ${b ? 'attiva' : 'spenta'}` };
      },
    },
    {
      scrive: ['correttore.accettiPerImparare'],
      costo: 1,
      aiuto: 'volte 1-100 (quante volte una correzione scelta dal tasto destro per la stessa parola serve perché diventi automatica)',
      keys: ['correzioni accettate', 'accetti per imparare', 'volte per correzione automatica', 'quante volte accettare'],
      build(v) { return volteCorrettore(v, 'accettiPerImparare', (n) => `Una correzione scelta ${n} volte diventa automatica`); },
    },
    {
      scrive: ['correttore.annulliPerImparare'],
      costo: 1,
      aiuto: 'volte 1-100 (quante volte una correzione automatica annullata per la stessa parola serve perché non torni più)',
      keys: ['correzioni annullate', 'annulli per imparare', 'quante volte annullare'],
      build(v) { return volteCorrettore(v, 'annulliPerImparare', (n) => `Una correzione automatica annullata ${n} volte non torna più`); },
    },
    {
      scrive: ['correttore.riscrittePerImparare'],
      costo: 1,
      aiuto: 'volte 1-100 (quante volte una parola che il correttore non conosce, scritta uguale e non corretta, serve perché non sia più segnata)',
      keys: ['parole imparate', 'riscritte per imparare', 'quante volte riscrivere', 'impara le parole'],
      build(v) { return volteCorrettore(v, 'riscrittePerImparare', (n) => `Una parola scritta uguale ${n} volte non è più segnata`); },
    },
    {
      scrive: ['featureFlags.help'],
      aiuto: 'true | false (l\'Aiuto nelle pagine: la sua voce nel tasto destro e la sua scorciatoia)',
      costo: 1,
      keys: ['sidebar_aiuto', 'sidebar aiuto', 'pannello aiuto', 'aiuto', 'help', 'assistente aiuto', 'aiuto nelle pagine', 'assistente di pagina', 'assistente della pagina'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { featureFlags: { help: b } }, label: `Aiuto nelle pagine → ${b ? 'acceso' : 'spento'}` };
      },
    },
    {
      scrive: ['featureFlags.categorize'],
      aiuto: 'true | false (categorie automatiche delle pagine)',
      costo: 1,
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
      costo: 1,
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
      costo: 1,
      keys: ['salta_pubblicita', 'salta pubblicità', 'salta pubblicita', 'salta le pubblicità', 'salta le pubblicita',
        'salta annunci', 'salta gli annunci', 'pubblicità dei video', 'pubblicita dei video', 'skip ads', 'salta ads'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { security: { adSkip: { enabled: b } } }, label: `Salta le pubblicità dei video → ${b ? 'attivo' : 'disattivato'}` };
      },
    },

    // ── Sicurezza / privacy — costo 2; spegnere una protezione abbassa una difesa ──
    {
      scrive: ['security.protectIpLeak'],
      aiuto: 'true | false (anti-leak WebRTC)',
      keys: ['protezione_ip', 'protezione ip', 'proteggi ip', 'protezione ip locale', 'webrtc', 'protezione webrtc', 'ip locale'],
      costo: 2,
      allenta: (r) => r.partial.security.protectIpLeak === false,
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
      costo: 2,
      allenta: (r) => r.partial.security.blockPopups === false,
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
      aiuto: 'true | false (avviso sui siti pericolosi; spento ferma la lista nera di Google, l\'età del dominio e il giudizio AI, '
        + 'restano gli avvisi che Filo decide da solo dall\'indirizzo)',
      keys: ['navigazione_sicura', 'navigazione sicura', 'rilevamento siti pericolosi', 'siti pericolosi', 'safe browsing', 'safebrowsing', 'protezione phishing', 'rilevamento phishing'],
      costo: 2,
      allenta: (r) => r.partial.security.safeBrowse.enabled === false,
      risk: 'Controlla il rilevamento dei siti pericolosi (phishing e malware). Spegnerlo toglie l’avviso sui siti '
        + 'nella lista nera di Google, il controllo dell’età del dominio e il giudizio AI; restano solo gli avvisi '
        + 'che Filo decide da solo dall’indirizzo, come quello su un sosia di un marchio.',
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
      costo: 2,
      allenta: (r) => r.partial.security.downloads.confirmExecutables === false,
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
      costo: 2,
      allenta: (r, at) => scende(RIGORE_COOKIE, r.partial.security.cookies.mode, at && at.security && at.security.cookies && at.security.cookies.mode),
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
      costo: 2,
      allenta: (r, at) => scende(RIGORE_IMPRONTA, r.partial.security.fingerprint.mode, at && at.security && at.security.fingerprint && at.security.fingerprint.mode),
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

    // ── Modelli / provider / chiavi / costi — costo 2; cambiare chi elabora i dati o alzare la spesa abbassa una difesa ──
    {
      scrive: ['useDefaultModels'],
      aiuto: 'true | false',
      keys: ['modelli_predefiniti', 'modelli predefiniti', 'usa modelli predefiniti', 'modelli di default', 'configurazione predefinita modelli'],
      costo: 2,
      allenta: (r) => r.partial.useDefaultModels === false,
      risk: 'Decide se Filo usa i modelli AI predefiniti o la tua configurazione personalizzata. '
        + 'Cambia quali modelli elaborano le tue richieste, con effetti su qualità e costi.',
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { useDefaultModels: b }, label: `Modelli predefiniti → ${b ? 'attivi' : 'disattivati'}` };
      },
    },
    {
      // Il modello di una funzione (#819), come la griglia di Opzioni → Modelli. Che esista, che sia adatto e quanto
      // costa lo controlla il main prima della conferma: qui c'è solo la lettura della frase.
      scrive: ['models.*'],
      aiuto: '"<funzione>: <modello>[, <ripiego>…]", la funzione col nome che ha in Opzioni → Modelli, il modello col nome del registro dei modelli o un id di OpenRouter (es. "Chat con Filo: claude")',
      keys: ['modello_funzione', 'modello di una funzione', 'modello della funzione', 'modello per la funzione',
        'modello per una funzione', 'cambia modello', 'modello per'],
      // I fornitori esclusi restano esclusi con qualunque modello: cambiarlo cambia costo e qualità, non abbassa difese.
      costo: 2,
      risk: 'Cambia il modello che elabora le richieste di questa funzione: qualità, velocità e costo cambiano, '
        + 'e i dati vanno al fornitore di quel modello.',
      build(v) {
        const r = modelloDiFunzione(v);
        if (!r) return null;
        if (r.rifiuto) return r;
        return {
          partial: { models: { [r.action]: r.refs.join(', ') } },
          label: `Modello per «${r.nome}» → ${r.refs.join(', ')}`,
          modelloFunzione: { action: r.action, refs: r.refs, nome: r.nome },
        };
      },
    },
    {
      scrive: ['scorciatoie.explain-selection', 'scorciatoie.translate-selection', 'scorciatoie.save-for-later', 'scorciatoie.open-help-sidebar'],
      // Uguale su ogni sistema: la descrizione finisce negli strumenti della chat, che sono gli stessi per tutti.
      aiuto: () => {
        const T = tastiDiFilo();
        const esempio = T ? `"Traduci: ${T.etichettaFilo('Ctrl+Shift+Y', 'win32')}", su Mac "Traduci: ${T.etichettaFilo('Ctrl+Shift+Y', 'darwin')}"` : '"Traduci: Ctrl+Shift+Y"';
        return `"<azione>: <combinazione>", azione fra Spiega, Traduci, Salva per dopo e Aiuto (es. ${esempio}); "<azione>: di serie" la rimette com'era, "tutte di serie" tutte e quattro`;
      },
      keys: ['scorciatoia', 'scorciatoie', 'scorciatoia da tastiera', 'scorciatoie da tastiera', 'tasto di scelta rapida',
        'scorciatoia di spiega', 'scorciatoia di traduci', 'scorciatoia di salva per dopo', 'scorciatoia di aiuto'],
      costo: 1,
      build: scorciatoiaFiloDetta,
    },
    {
      scrive: ['openWeightsOnly'],
      aiuto: 'true | false (spegne tutti i modelli proprietari, Anthropic compresa, e lascia solo modelli a pesi aperti serviti da fornitori indipendenti)',
      keys: ['solo_pesi_aperti', 'solo pesi aperti', 'modelli a pesi aperti', 'solo modelli a pesi aperti',
        'solo modelli aperti', 'modelli aperti', 'modelli proprietari', 'niente modelli proprietari',
        'disattiva modelli proprietari', 'open weights'],
      costo: 2,
      allenta: (r) => r.partial.openWeightsOnly === false,
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
      // Vale solo con una chiave OpenRouter propria: senza, il main lo rifiuta prima della conferma (SENZA_CHIAVE_PROPRIA).
      scrive: ['ownKeyAllProviders'],
      aiuto: 'true | false (con una chiave OpenRouter propria, le richieste pagate con lei possono andare anche ai fornitori che Filo esclude; coi crediti di Filo l\'esclusione vale sempre)',
      keys: ['fornitori_esclusi', 'fornitori esclusi', 'usa anche i fornitori esclusi', 'con la mia chiave usa anche i fornitori esclusi',
        'fornitori esclusi con la mia chiave', 'lista di esclusione', 'lista dei fornitori esclusi', 'esclusione dei fornitori'],
      costo: 2,
      allenta: (r) => r.partial.ownKeyAllProviders === true,
      risk: 'Le richieste pagate con la tua chiave OpenRouter potranno andare anche ai fornitori che Filo esclude '
        + '(come Google, OpenAI o xAI), che riceveranno i testi che mandi. Coi crediti di Filo restano esclusi.',
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return {
          partial: { ownKeyAllProviders: b },
          label: `Fornitori esclusi con la tua chiave → ${b ? 'usati' : 'esclusi'}`,
        };
      },
    },
    {
      scrive: ['ordineHost'],
      aiuto: '"velocità" | "latenza" | "prezzo" | "filo" (come OpenRouter sceglie chi serve ogni modello: "velocità"=più token al secondo, "latenza"=prima parola più rapida, "prezzo"=il più economico, "filo"=torna alla scelta di Filo; vale anche per i modelli predefiniti, e i fornitori esclusi restano esclusi)',
      keys: ['ordine_host', 'ordine host', 'host dei modelli', 'host', 'ordinamento host', 'host più veloci',
        'velocità dei modelli', 'modelli più veloci', 'chat più veloce', 'host più economici', 'provider sort'],
      costo: 2,
      risk: 'Cambia quali host servono i modelli: più veloci di solito costano di più, più economici rispondono più lentamente.',
      build(v) {
        const s = String(v == null ? '' : v).trim().toLowerCase();
        if (!s) return null;
        let sort = null;
        if (/(filo|auto|predefinit|default|standard|ripristin|reset|nessun)/.test(s)) sort = '';
        else if (/(latenz|latency|pront|prima parola|reattiv)/.test(s)) sort = 'latency';
        else if (/(prezz|price|econom|costo|cost|risparm|meno car)/.test(s)) sort = 'price';
        else if (/(veloc|throughput|rapid|svelt|token)/.test(s)) sort = 'throughput';
        if (sort === null) return null;
        const nomi = { '': 'scelti da Filo', throughput: 'più veloci', latency: 'risposta più pronta', price: 'più economici' };
        return { partial: { ordineHost: sort }, label: `Host dei modelli → ${nomi[sort]}` };
      },
    },
    {
      scrive: ['provider'],
      aiuto: '"openrouter"',
      keys: ['provider', 'fornitore', 'provider ai', 'provider modelli'],
      costo: 2,
      allenta: () => true,
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
      costo: 2,
      allenta: () => true,
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
      costo: 2,
      allenta: () => true,
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
      costo: 2,
      allenta: (r, at) => {
        const tetto = (v) => (Number(v) > 0 ? Number(v) : Infinity);
        const prima = at && at.monthlyLimitEur;
        return prima == null || tetto(r.partial.monthlyLimitEur) > tetto(prima);
      },
      risk: 'Imposta il tetto di spesa mensile per le richieste AI. Alzarlo può far aumentare i '
        + 'costi; abbassarlo può bloccare le richieste una volta raggiunto il limite.',
      build(v) {
        let n = parseItalianNumber(v);
        if (!Number.isFinite(n) || n < 0) return null;
        n = Math.min(10000, n);
        const eur = n.toLocaleString('it-IT', { useGrouping: true, minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
        return { partial: { monthlyLimitEur: n }, label: `Limite di spesa mensile → ${eur} €` };
      },
    },
    {
      scrive: ['costoModelli.soglia'],
      aiuto: 'numero di volte (0-1000): avvisa quando il modello scelto per una funzione costa almeno tante volte il predefinito; 0 o "mai" per non avvisare',
      keys: ['avviso_modelli_costosi', 'avviso modelli costosi', 'avviso sui modelli costosi', 'soglia avviso costo modelli',
        'avviso costo modello', 'avviso costo modelli', 'modelli costosi', 'soglia modelli costosi'],
      costo: 1,
      risk: 'Decide quando Filo ti avvisa che il modello scelto per una funzione consuma molti più crediti del predefinito.',
      build(v) {
        const s = String(v == null ? '' : v).trim().toLowerCase();
        let n = ['mai', 'spento', 'spenta', 'off', 'no', 'nessuno', 'disattiva', 'disattivato'].includes(s) ? 0 : parseItalianNumber(s);
        if (predefinito(v)) n = 5;
        if (!Number.isFinite(n) || n < 0) return null;
        n = Math.min(1000, n);
        const volte = n.toLocaleString('it-IT', { useGrouping: true, maximumFractionDigits: 1 });
        return {
          partial: { costoModelli: { soglia: n } },
          label: n > 0 ? `Avviso sui modelli costosi → oltre ${volte} volte il predefinito` : 'Avviso sui modelli costosi → mai',
        };
      },
    },

    // ── Colore identità delle tab — cosmetico, reversibile → costo 1 ──
    // Mappa le richieste verbali ("voglio colori più vivaci nelle tab", "rendile
    // più neutre", "niente colore", "Poste è verde non gialla") sui sei parametri
    // di src/shared/tabColor.js. I valori sono preset ASSOLUTI (non delta: il
    // setter non vede lo stato corrente), così il risultato è deterministico e
    // l'utente vede subito cambiare il colore delle tab. Il merge in storage è
    // profondo su `tabColor`, quindi un preset parziale lascia intatti gli altri
    // parametri. La regolazione fine dei singoli numeri sta nelle Preferenze.
    {
      aiuto: '"più vivaci" | "più neutre" | "nessuno" | "più preciso" | "predefinito" (colore identità delle tab: "vivaci"=tinte accese, "neutre"=tinte spente, "nessuno"=tab senza colore, "più preciso"=estrai meglio quando la tab prende il colore sbagliato, "predefinito"=ripristina; i sei valori uno per uno hanno le loro chiavi qui sotto)',
      costo: 1,
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

    // ── Suoneria timer — reversibile, innocuo → costo 1 ──
    {
      scrive: ['timerRingtone'],
      aiuto: '"standard" | "delicata" | "urgente" | "carillon"',
      keys: ['suoneria_timer', 'suoneria timer', 'suoneria', 'ringtone', 'timer ringtone', 'suono timer', 'tono timer'],
      costo: 1,
      build(v) {
        const tone = tonoDa(v);
        if (!tone) return null;
        return { partial: { timerRingtone: tone }, label: `Suoneria timer → ${TONI_ETICHETTE[tone]}` };
      },
    },

    // ── Volume della suoneria — reversibile, innocuo → costo 1 ──
    // Niente chiave «volume» secca: i volumi sono due (suoneria e notifiche) e
    // una chiave così generica se li prendeva tutti, azzerando la suoneria a
    // chi chiedeva le notifiche. Resta la prima per ordine, quindi un «volume»
    // senza altro resta la suoneria, che è il caso che si chiede davvero.
    {
      scrive: ['timerRingtoneVolume'],
      aiuto: 'numero 0-100 (volume di timer e sveglie; 0 = muta)',
      keys: ['volume_suoneria', 'volume suoneria', 'volume timer', 'volume sveglia',
        'ringtone volume', 'volume della suoneria'],
      costo: 1,
      build(v) {
        const vol = parseVolume(v);
        if (vol === null) return null;
        return { partial: { timerRingtoneVolume: vol }, label: `Volume suoneria → ${vol}%` };
      },
    },

    // ── Avvisi in basso a destra (barra e pagine) — reversibili, innocui → costo 1 ──
    {
      scrive: ['notifications.durationSec'],
      aiuto: 'secondi 0-120 (quanto restano gli avvisi in basso a destra, nella barra e nelle pagine; quelli brevi e quelli con un pulsante restano in proporzione; 0 = finché l\'utente non li chiude)',
      costo: 1,
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
      costo: 1,
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
    // Il suono degli avvisi nasce spento: un volume sopra zero senza accenderlo prometterebbe un suono che non si sente.
    {
      scrive: ['notifications.soundVolume'],
      aiuto: 'numero 0-100 (volume del suono degli avvisi)',
      keys: ['volume_notifiche', 'volume notifiche', 'volume delle notifiche', 'volume notifica',
        'volume del suono delle notifiche', 'notification volume'],
      costo: 1,
      build(v) {
        const vol = parseVolume(v);
        if (vol === null) return null;
        const notifications = vol > 0 ? { soundVolume: vol, soundEnabled: true } : { soundVolume: vol };
        return { partial: { notifications }, label: `Volume delle notifiche → ${vol}%` };
      },
    },

    // ── Anteprima delle schede (#430) — reversibile, innocua → costo 1 ──
    {
      scrive: ['tabPreview.enabled', 'tabPreview.size'],
      aiuto: 'true | false | "piccola" | "media" | "grande" (carta con l\'anteprima di una scheda al passaggio del mouse sulla barra)',
      costo: 1,
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
      sotto: 'bloccoSiti',
      nome: 'Liste pubbliche come blacklist',
      stati: ['in uso', 'spente'],
      aiuto: 'true | false (tratta come bloccati anche i siti di pubblicità e tracciamento delle liste pubbliche)',
      risk: 'Decide se Filo tratta come bloccati anche i siti di pubblicità e tracciamento delle liste pubbliche, oltre '
        + 'a quelli che hai messo tu. Spegnerlo lascia aprire quei siti.',
    }),
    interruttore({
      keys: ['controlli_rete_siti', 'controlli di rete', 'controlli rete', 'età del dominio', 'eta del dominio'],
      percorso: 'security.safeBrowse.networkSignals',
      sotto: 'sitiPericolosi',
      nome: 'Controlli di rete sui siti',
      stati: ['attivi', 'spenti'],
      aiuto: 'true | false (chiede a servizi pubblici l\'età del dominio e del certificato, per riconoscere le truffe)',
      risk: 'Quando un sito ha già un indizio sospetto, Filo ne manda il nome a due servizi pubblici (rdap.org e crt.sh) '
        + 'per sapere da quanto esistono il dominio e il suo certificato: un sito nato da pochi giorni è un forte segnale '
        + 'di truffa. Spenti, quel nome non esce dal computer, ma l’avviso su un sito appena nato per ingannarti diventa meno probabile.',
    }),
    interruttore({
      keys: ['giudizio_ai_siti', 'giudizio ai', 'giudizio ai sui siti', 'giudizio ai sui casi sospetti'],
      percorso: 'security.safeBrowse.llmJudge',
      sotto: 'sitiPericolosi',
      nome: 'Giudizio AI sui siti sospetti',
      aiuto: 'true | false (un modello valuta gli indizi di identità di un sito rimasto dubbio)',
      risk: 'Quando un sito resta dubbio, Filo ne manda il nome e gli indizi (età, certificato, da dove arriva il link, '
        + 'se chiede password o pagamento) al modello AI scelto per il giudizio dei siti, mai il testo della pagina. '
        + 'Spento, niente esce dal computer, ma un sito sospetto può aprirsi senza avviso.',
    }),
    interruttore({
      keys: ['link_sospetti_isolati', 'finestra isolata', 'link sospetti', 'apri i link sospetti in una finestra isolata',
        'link accorciati', 'destinazione dei link accorciati'],
      percorso: 'security.safeBrowse.sandbox',
      nome: 'Link accorciati in una finestra isolata',
      stati: ['sì', 'no'],
      aiuto: 'true | false (puntatore fermo su un link accorciato: Filo lo apre in una finestra nascosta per scoprire la destinazione prima del clic)',
      risk: 'Controlla la finestra nascosta e isolata in cui Filo apre un link accorciato su cui tieni fermo il puntatore, '
        + 'per scoprire la destinazione prima del clic. Spenta, Filo cerca ancora il link nella lista nera, ma dove porta '
        + 'lo scopre solo quando lo apri.',
    }),
    interruttore({
      keys: ['segnalazione_automatica', 'segnalazione automatica', 'segnalazione automatica dei problemi', 'segnalazioni automatiche', 'feedback automatico'],
      percorso: 'security.autoFeedback',
      spentoAllenta: false,
      nome: 'Segnalazione automatica dei problemi',
      stati: ['attiva', 'disattivata'],
      aiuto: 'true | false (segnala in forma anonima a chi sviluppa Filo quando non riesce a fare una cosa; tenerla attiva vale 10 crediti al giorno)',
      risk: 'Decide se Filo manda da solo una segnalazione anonima e generica a chi lo sviluppa quando non riesce a fare '
        + 'una cosa: mai indirizzi né testi delle conversazioni. Spegnerla toglie anche i 10 crediti extra al giorno.',
    }),
    interruttore({
      keys: ['contatori', 'contatori anonimi', 'contatori d\'uso', 'contatori giornalieri', 'statistiche d\'uso',
        'statistiche anonime', 'telemetria', 'dati d\'uso anonimi', 'contatori.attivi'],
      percorso: 'contatori.attivi',
      spentoAllenta: false,
      nome: 'Contatori anonimi d\'uso',
      stati: ['accesi', 'spenti'],
      aiuto: 'true | false (ogni ora manda a chi sviluppa Filo solo numeri e nomi da elenchi fissi: usi e attese di funzioni '
        + 'e azioni, impostazioni cambiate, ricerche nei pannelli, proposte del correttore, conferme, annulli, errori visti, '
        + 'scelte dell\'intervista; spenti, non si conta niente e non parte niente, nemmeno lo spegnimento)',
      risk: 'Decide se Filo manda ogni ora a chi lo sviluppa dei numeri senza contenuto (usi e attese di funzioni e azioni, '
        + 'impostazioni cambiate, ricerche nei pannelli, correttore, conferme, annulli, errori visti, intervista, versione e '
        + 'sistema), con uno pseudonimo che cambia ogni mese: mai testi, indirizzi, titoli, nomi di file o parole.',
    }),
    elenco({
      keys: ['siti_bloccati', 'siti bloccati', 'blacklist', 'domini in blacklist', 'elenco dei siti bloccati', 'lista dei siti bloccati'],
      percorso: 'security.siteBlock.blacklist',
      allentaSe: 'togli',
      sotto: 'bloccoSiti',
      nome: 'Siti bloccati',
      aiuto: 'siti che Filo non apre',
      risk: 'Cambia l’elenco dei siti che Filo non apre. Un sito tolto si riapre da ogni strada; uno aggiunto non si apre '
        + 'più finché non scegli «Apri comunque».',
    }),
    elenco({
      keys: ['siti_fidati_programmi', 'siti fidati per i programmi', 'siti fidati programmi', 'siti fidati download'],
      percorso: 'security.downloads.trustedSites',
      allentaSe: 'aggiungi',
      nome: 'Siti fidati per i programmi',
      aiuto: 'siti da cui un programma scende senza chiedere',
      risk: 'Cambia i siti da cui un programma scaricato non chiede conferma: da un sito in elenco un programma scende '
        + 'e si apre senza domande.',
    }),
    elenco({
      keys: ['siti_fidati_cookie', 'siti fidati cookie', 'siti fidati per i cookie', 'resta connesso', 'siti dove resto connesso',
        'siti connessi', 'resta connesso su', 'resta connesso qui', 'non restare connesso'],
      percorso: 'security.cookies.trustedSites',
      allentaSe: 'aggiungi',
      nome: 'Siti fidati dove resti connesso',
      aiuto: 'siti dove si resta connessi anche con la privacy massima dei cookie, e i cui contenuti incorporati in '
        + 'Automatico tengono i cookie: «resta connesso su X» è aggiungi X, «togli X dai siti connessi» è togli X',
      risk: 'Cambia i siti che fanno eccezione alla privacy massima dei cookie: lì i dati restano fra una visita e '
        + 'l’altra, così resti connesso, e il sito ti riconosce.',
    }),
    elenco({
      keys: ['siti_con_banner', 'siti con banner', 'banner visibili', 'siti dove vedo i banner', 'mostra i banner dei cookie'],
      percorso: 'security.cookies.bannerSites',
      allentaSe: 'aggiungi',
      nome: 'Siti dove vedi i banner dei cookie',
      aiuto: 'siti dove Filo non rifiuta i banner dei cookie e li lascia vedere',
      risk: 'Cambia i siti dove Filo lascia i banner dei cookie a te invece di rifiutarli da solo: lì una scelta '
        + 'sbagliata sul banner fa accettare i cookie di tracciamento.',
    }),
    elenco({
      keys: ['siti_con_accesso', 'siti con accesso', 'siti dove sono entrato', 'siti dove ho un account', 'siti con account'],
      percorso: 'security.cookies.loggedSites',
      allentaSe: 'aggiungi',
      nome: 'Siti dove sei entrato',
      aiuto: 'siti dove Filo ha visto un tuo accesso: i loro cookie restano anche nei contenuti incorporati altrove',
      risk: 'Cambia i siti i cui contenuti incorporati in altre pagine tengono i loro cookie: togliere un sito da qui '
        + 'fa durare i suoi cookie solo per la visita, aggiungerlo glieli fa tenere come a un sito dove sei entrato.',
    }),
    elenco({
      keys: ['contenuti_incorporati_cookie', 'cookie dei contenuti incorporati', 'cookie dei riquadri', 'riquadri con i cookie', 'cookie riattivati'],
      percorso: 'security.cookies.embedSites',
      allentaSe: 'aggiungi',
      nome: 'Contenuti incorporati con i cookie riattivati',
      aiuto: 'servizi (post, video, mappe) a cui hai riattivato i cookie quando i loro contenuti dentro altri siti non si vedevano',
      risk: 'Cambia i servizi i cui contenuti incorporati in altre pagine tengono i loro cookie: aggiungerne uno lo lascia '
        + 'ricordare di te fra una visita e l’altra, toglierlo fa durare i suoi cookie solo per la visita.',
    }),
    elencoCartelle(),
    sitiFiloSpento(),
    // #975 — non abbassa niente: cambia quale menu arriva per primo, e l'altro resta a Shift. Costo 1, come un tema.
    {
      ...elenco({
        keys: ['menu_del_sito', 'menu del sito', 'siti col menu del sito', 'menu del sito col tasto destro', 'tasto destro del sito'],
        percorso: 'menuDelSito.siti',
        nome: 'Siti dove il tasto destro apre il menu del sito',
        aiuto: 'siti col loro menu del tasto destro (Google Docs, Figma…) dove il tasto destro apre il menu del sito e quello di Filo '
          + 'resta a Shift + tasto destro; per un sito aperto di cui non vedi l\'indirizzo: «questo sito» (la scheda web davanti) '
          + 'o «scheda: <titolo come in TAB APERTE>»',
        risk: 'Cambia su quali siti il tasto destro apre il menu del sito invece di quello di Filo; '
          + 'il menu di Filo resta a Shift + tasto destro.',
      }),
      costo: 1,
    },

    // ── Microfono delle chat — reversibile, innocuo → costo 1 ──
    {
      scrive: ['dictation.autoSend'],
      aiuto: '"invia da solo" | "lascia il testo da correggere" (col tasto microfono delle chat: finito di parlare la richiesta parte da sola dopo un attimo per annullare, oppure il testo resta nella casella)',
      costo: 1,
      keys: ['invio_vocale', 'invio vocale', 'invio della dettatura', 'invio dettatura', 'microfono delle chat',
        'microfono chat', 'dictation.autosend'],
      // Le parole delle due scelte di Preferenze valgono quanto un sì/no; un «non» le rovescia.
      build(v) {
        const s = String(v == null ? '' : v).trim().toLowerCase();
        const nega = /\b(non|mai)\b/.test(s);
        let b;
        if (/(da sol|automatic|subito|appena finisco)/.test(s)) b = !nega;
        else if (/(lascia|corregg|a mano|manual|rilegg|controll)/.test(s)) b = nega;
        else b = parsePrefBool(v);
        if (b === null) return null;
        return {
          partial: { dictation: { autoSend: b } },
          label: `Microfono delle chat → ${b ? 'invia da solo' : 'lascia il testo da correggere'}`,
        };
      },
    },
    {
      scrive: ['dictation.silenceSec'],
      aiuto: 'secondi 1-8 (quanto silenzio chiude l\'ascolto del microfono delle chat; di più per chi si ferma a pensare)',
      costo: 1,
      keys: ['pausa_microfono', 'pausa microfono', 'pausa del microfono', 'silenzio microfono', 'dictation.silencesec'],
      build(v) {
        const n = parseItalianNumber(v);
        if (!Number.isFinite(n)) return null;
        const { silenceSec } = global.SN_CONST.dictationTimes({ silenceSec: n });
        return { partial: { dictation: { silenceSec } }, label: `Pausa che chiude il microfono → ${String(silenceSec).replace('.', ',')} s` };
      },
    },
    {
      scrive: ['dictation.cancelSec'],
      aiuto: 'secondi 0-10 (l\'attimo per annullare prima che la richiesta detta parta da sola; 0 = parte subito)',
      costo: 1,
      keys: ['attesa_invio_vocale', 'attesa invio vocale', 'tempo per annullare', 'annulla invio vocale', 'dictation.cancelsec'],
      build(v) {
        const n = parseItalianNumber(v);
        if (!Number.isFinite(n)) return null;
        const { cancelSec } = global.SN_CONST.dictationTimes({ cancelSec: n });
        return { partial: { dictation: { cancelSec } }, label: `Tempo per annullare l'invio vocale → ${String(cancelSec).replace('.', ',')} s` };
      },
    },
    // ── #868: quanto filo la chat ha davanti (vince il minore dei due tetti) ──
    {
      scrive: ['contestoFilo.giorni'],
      aiuto: 'giorni 0,5-365, o "predefinito" (quanti giorni di conversazioni, da tutte le schede, la chat ha davanti a ogni messaggio)',
      keys: ['giorni_ricordati', 'giorni ricordati', 'giorni di memoria della chat', 'giorni di conversazione', 'giorni del contesto',
        'memoria della chat in giorni', 'contestofilo.giorni'],
      costo: 2,
      risk: 'Più giorni: Filo ricorda più conversazioni senza cercarle, ma ogni messaggio costa di più e la risposta può arrivare più tardi. Meno giorni: costa meno, e il resto lo ritrova cercando.',
      build(v) {
        if (predefinito(v)) return { partial: { contestoFilo: { giorni: null } }, label: 'Giorni di conversazioni che la chat ricorda → come i predefiniti' };
        const s = String(v == null ? '' : v).trim().toLowerCase();
        let n = parseItalianNumber(s.replace(/^(un|una|uno)\b/, '1'));
        if (!Number.isFinite(n)) return null;
        if (/\bor[ae]\b/.test(s)) n /= 24;
        else if (/settiman/.test(s)) n *= 7;
        else if (/\bmes[ei]\b/.test(s)) n *= 30;
        const giorni = contestoFilo().numeroIn(n, contestoFilo().LIMITI.giorni);
        return { partial: { contestoFilo: { giorni } }, label: `Giorni di conversazioni che la chat ricorda → ${String(giorni).replace('.', ',')}` };
      },
    },
    {
      scrive: ['contestoFilo.token'],
      aiuto: 'token 2.000-2.000.000, o "predefinito" (il tetto in token di quello che la chat ha davanti; vince il minore fra questo e i giorni)',
      keys: ['token_ricordati', 'token ricordati', 'tetto del contesto', 'tetto di token', 'token del contesto', 'contestofilo.token'],
      costo: 2,
      risk: 'Un tetto più alto fa ricordare più conversazioni a ogni messaggio, e ogni messaggio costa di più; uno più basso costa meno e ricorda meno senza cercare.',
      build(v) {
        if (predefinito(v)) return { partial: { contestoFilo: { token: null } }, label: 'Tetto in token della chat → come i predefiniti' };
        const s = String(v == null ? '' : v).trim().toLowerCase();
        let n = parseItalianNumber(s);
        if (!Number.isFinite(n)) return null;
        if (/\d\s*(k|mila)\b/.test(s)) n *= 1000;
        else if (/\d\s*(m|milion[ei])\b/.test(s)) n *= 1000000;
        const token = Math.round(contestoFilo().numeroIn(n, contestoFilo().LIMITI.token));
        return { partial: { contestoFilo: { token } }, label: `Tetto in token della chat → ${token.toLocaleString('it-IT', { useGrouping: true })}` };
      },
    },
    {
      scrive: ['contestoFilo.cache'],
      aiuto: '"5 minuti", "un\'ora" o "predefinito" (quanto il modello tiene da parte le istruzioni fisse della chat; vale coi modelli Anthropic)',
      keys: ['durata_cache', 'durata della cache', 'cache della chat', 'durata della cache della chat', 'cache del prompt', 'contestofilo.cache'],
      costo: 2,
      risk: 'Un\'ora: metterle da parte costa il doppio, ma le rilegge a prezzo basso anche chi scrive un messaggio ogni tanto. Cinque minuti: metterle da parte costa meno, e dopo una pausa più lunga si ripagano per intero.',
      build(v) {
        if (predefinito(v)) return { partial: { contestoFilo: { cache: null } }, label: 'Durata della cache della chat → come i predefiniti' };
        const s = String(v == null ? '' : v).trim().toLowerCase();
        const cache = contestoFilo().durataIn(s)
          || (/\b(1|un|una)\s*(h|or[ae])\b|un'ora|\b60\s*(m|min)/.test(s) ? '1h' : null)
          || (/\b5\s*(m|min|minuti)?\b|cinque\s*minuti/.test(s) ? '5m' : null);
        if (!cache) return null;
        return { partial: { contestoFilo: { cache } }, label: `Durata della cache della chat → ${cache === '1h' ? 'un\'ora' : '5 minuti'}` };
      },
    },
    // ── #1097.3: quanto può essere lunga una risposta, per famiglia di funzioni ──
    setterLunghezza('conversazioni', 'la chat e le conversazioni', ['lunghezza_risposte_chat', 'lunghezza delle risposte della chat',
      'risposte della chat', 'tetto delle risposte della chat', 'lunghezzarisposte.conversazioni']),
    setterLunghezza('testi', 'traduzioni, riscritture e riassunti', ['lunghezza_risposte_testi', 'lunghezza delle traduzioni',
      'lunghezza dei riassunti', 'tetto delle traduzioni', 'lunghezzarisposte.testi']),
    setterLunghezza('brevi', 'le risposte brevi (spiegazioni, titoli, correttore)', ['lunghezza_risposte_brevi', 'lunghezza delle spiegazioni',
      'tetto delle risposte brevi', 'lunghezzarisposte.brevi']),
    // ── #1004: cosa delle pagine va ai modelli senza che l'utente lo chieda ──
    {
      scrive: ['riassuntoSchede.enabled'],
      aiuto: 'true | false (riassunto e indice delle schede chiuse per ritrovarle nel filo della home anche per significato; spento, di una scheda chiusa non va niente ai modelli e la si ritrova per parole)',
      costo: 1,
      keys: ['riassunto_schede_chiuse', 'riassunto delle schede chiuse', 'riassunto schede chiuse', 'riassunti delle schede chiuse',
        'riassunto delle schede', 'riassunto schede', 'riassuntoschede'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { riassuntoSchede: { enabled: b } }, label: `Riassunto delle schede chiuse → ${b ? 'attivo' : 'spento'}` };
      },
    },
    // ── #818: l'avviso prima che i crediti finiscano, e il pre-calcolo della spiegazione ──
    {
      scrive: ['avvisoCrediti.attivo'],
      aiuto: 'true | false (Filo avvisa, una volta per calo, quando i crediti stanno per finire e propone come farli durare)',
      costo: 1,
      keys: ['avviso_crediti', 'avviso crediti', 'avviso dei crediti', 'avviso prima che i crediti finiscano',
        'avvisami quando i crediti stanno per finire', 'avvisocrediti.attivo'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { avvisoCrediti: { attivo: b } }, label: `Avviso prima che i crediti finiscano → ${b ? 'attivo' : 'spento'}` };
      },
    },
    setterSogliaCrediti('giorni', 'giorni 0-30, o "predefinito" (avvisa quando, al ritmo di questi giorni e con la quota di ogni notte, i crediti durano al più tanto; 0 spegne questa condizione)',
      ['soglia_giorni_crediti', 'giorni dell\'avviso dei crediti', 'avvisa quando i crediti durano', 'soglia in giorni dei crediti', 'avvisocrediti.giorni'],
      (n) => `Avviso dei crediti quando durano al più → ${conVirgola(n)} ${n === 1 ? 'giorno' : 'giorni'}`),
    setterSogliaCrediti('percento', 'percentuale 0-100, o "predefinito" (avvisa quando il saldo scende sotto questa parte dei crediti d\'ingresso; 0 spegne questa condizione)',
      ['soglia_percento_crediti', 'percentuale dell\'avviso dei crediti', 'soglia in percentuale dei crediti', 'avvisocrediti.percento'],
      (n) => `Avviso dei crediti sotto il → ${conVirgola(n)}% di quelli d'ingresso`),
    {
      scrive: ['spiegaAnticipata.enabled'],
      aiuto: 'true | false (prepara la spiegazione appena si seleziona un testo, così al tasto destro è già pronta; spenta, parte solo dal tasto destro e consuma meno crediti)',
      costo: 1,
      keys: ['spiegazione_anticipata', 'spiegazione anticipata', 'spiega in anticipo', 'prepara la spiegazione',
        'spiegazione alla selezione', 'pre-calcolo delle spiegazioni', 'spieganticipata', 'spiegaanticipata.enabled'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { spiegaAnticipata: { enabled: b } }, label: `Spiegazione preparata alla selezione → ${b ? 'attiva' : 'spenta'}` };
      },
    },
    {
      scrive: ['descriviImmagini.enabled'],
      aiuto: 'true | false (ogni screenshot, intero o di una parte, e ogni immagine copiata da una pagina va intera al modello delle immagini, che ne scrive il nome del file e la riga della cronologia appunti; spenta, l\'immagine non parte e il file si chiama con data e ora. Da una pagina delicata non parte mai)',
      costo: 1,
      keys: ['descrizione_immagini', 'descrizione automatica delle immagini', 'descrivi le immagini', 'descrivi gli screenshot',
        'nome degli screenshot', 'nomi degli screenshot', 'descrizione degli screenshot', 'descrizione delle immagini copiate',
        'descriviimmagini', 'descriviimmagini.enabled'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { descriviImmagini: { enabled: b } }, label: `Descrizione di screenshot e immagini copiate → ${b ? 'attiva' : 'spenta'}` };
      },
    },
    {
      scrive: ['security.riquadriRotti.modello'],
      aiuto: 'true | false (un contenuto incorporato di un altro sito rimasto vuoto, che Filo non riconosce da solo, va in foto a un modello per capire se sono i cookie rifiutati; spento, nessuna foto parte e quel riquadro si riattiva col tasto destro)',
      costo: 1,
      keys: ['riquadri_rotti_modello', 'contenuti incorporati rotti', 'riconoscimento dei contenuti incorporati rotti',
        'riconosci con un modello i contenuti incorporati rotti', 'riquadri rotti', 'riquadri rotti dai cookie', 'foto dei riquadri'],
      build(v) {
        const b = parsePrefBool(v);
        if (b === null) return null;
        return { partial: { security: { riquadriRotti: { modello: b } } }, label: `Contenuti incorporati rotti guardati da un modello → ${b ? 'sì' : 'no'}` };
      },
    },
    interruttore({
      keys: ['pagine_delicate', 'pagine delicate', 'non mandare ai modelli le pagine delicate', 'proteggi le pagine delicate',
        'pagine riservate'],
      percorso: 'security.pagineDelicate.enabled',
      nome: 'Pagine delicate tenute lontane dai modelli',
      stati: ['sì', 'no'],
      aiuto: 'true | false (posta, banche, sanità, pubblica amministrazione, pagine con un campo password o carta e i siti delicati '
        + 'scelti dall\'utente: riassunto e pulizia automatica delle schede non ne mandano il testo ai modelli, la chat ne vede '
        + 'solo il nome del sito, screenshot e immagini copiate da lì non vanno al modello delle immagini neanche incollati '
        + 'altrove, la spiegazione parte solo dal tasto destro; il correttore resta acceso e manda quello che l\'utente scrive, '
        + 'non la pagina; acceso di serie)',
      risk: 'Decide se le funzioni che partono da sole mandano ai modelli anche le pagine delicate: posta, banca, sanità, '
        + 'pubblica amministrazione, pagine dove hai visto un campo password o carta. Spegnerlo fa arrivare al modello '
        + 'saldi, movimenti, mail e referti delle schede che chiudi; la chat torna a vedere i titoli delle schede di banca '
        + 'e posta, gli screenshot e le immagini copiate da quelle pagine tornano al modello delle immagini, e la '
        + 'spiegazione si prepara anche lì appena selezioni un testo.',
    }),
    elenco({
      keys: ['siti_delicati', 'siti delicati', 'elenco dei siti delicati', 'pagine delicate aggiunte', 'sito delicato'],
      percorso: 'security.pagineDelicate.siti',
      allentaSe: 'togli',
      nome: 'Siti delicati aggiunti da te',
      aiuto: 'siti che Filo tratta come delicati oltre a posta, banche, sanità e pubblica amministrazione: niente di loro va ai modelli nei lavori automatici. '
        + 'Per un sito aperto di cui non vedi l\'indirizzo: «questo sito» (la scheda web davanti) o «scheda: <titolo come in TAB APERTE>»',
      risk: 'Cambia i siti che Filo tratta come delicati oltre a quelli di serie: delle loro pagine le funzioni che partono '
        + 'da sole (riassunto e pulizia delle schede, screenshot, spiegazione preparata) non mandano niente ai modelli. Un '
        + 'sito tolto torna a mandarlo.',
    }),
    elenco({
      keys: ['siti_non_delicati', 'siti non delicati', 'sito non delicato', 'non delicati'],
      percorso: 'security.pagineDelicate.nonDelicati',
      allentaSe: 'aggiungi',
      nome: 'Siti non delicati per te',
      aiuto: 'siti che Filo aveva segnato come delicati perché ci ha visto un campo password o carta, e che per l\'utente non lo '
        + 'sono (es. google.com dopo un accesso): tornano a mandare ai modelli quello che parte da solo. Non toglie posta, '
        + 'banche, sanità, pubblica amministrazione né i siti delicati aggiunti dall\'utente',
      risk: 'Toglie un sito da quelli che Filo tratta come delicati perché ci ha visto un campo password o carta: delle sue '
        + 'pagine le funzioni che partono da sole (riassunto e pulizia delle schede, screenshot, spiegazione preparata) '
        + 'tornano a mandare ai modelli.',
    }),

    // Il livello di autonomia lo cambia solo l'utente, in Preferenze: dalla chat è nell'elenco fisso.
    // Sta in fondo perché i sinonimi corti («auto») trovino prima le voci di sopra.
    {
      scrive: [],
      aiuto: '"conservativo" | "default" | "automatico" (lo sceglie solo l\'utente in Preferenze: dalla chat non si cambia)',
      keys: ['autonomia', 'livello di autonomia', 'livello autonomia', 'livello_autonomia', 'quanto fa da solo'],
      costo: 3,
      elencoFisso: 'regole',
      dove: 'Il livello di autonomia lo sceglie l\'utente in Preferenze, sotto «Autonomia di Filo»: aprigli la pagina lì '
        + 'con NAVIGA filo://preferences/preferences.html#autonomia',
      build(v) {
        const A = global.SN_AUTONOMIA;
        const s = String(v == null ? '' : v).trim().toLowerCase();
        const lv = A && A.LIVELLI.find((l) => l.id === s || l.nome.toLowerCase() === s);
        return { partial: {}, label: `Autonomia di Filo → ${lv ? lv.nome : (s || '?')}` };
      },
    },
  ];

  // Le righe «chiave: valori» della descrizione di IMPOSTA_PREFERENZA: escono da qui, dove sta il setter,
  // così una voce nuova arriva alla chat da sola (#949).
  function righeDescrizione(ctx = {}) {
    return PREF_SETTERS.map((s) => {
      const aiuto = typeof s.aiuto === 'function' ? s.aiuto(ctx) : s.aiuto;
      return `• ${s.keys[0]}: ${aiuto}${s.costo >= 2 ? ' [conferma]' : ''}`;
    });
  }

  // Il nome con cui la pagina mostra la voce di un setter: è quello che legge l'utente, la chiave è per il modello.
  function nomeVoce(setter) {
    const K = global.SN_CAMBI;
    const v = K && K.voce && Array.isArray(setter.scrive) ? K.voce(setter.scrive[0]) : null;
    return v && v.nome ? v.nome : setter.keys[0].replace(/_/g, ' ');
  }
  const PAROLE_VUOTE = new Set(['per', 'dei', 'del', 'della', 'delle', 'degli', 'gli', 'con', 'nei', 'nel', 'nella', 'sui', 'sul', 'che', 'una', 'uno']);
  // Quante delle parole dette oltre la chiave che ha vinto («download» in «siti fidati per i download») toccano
  // questa voce, fra le sue chiavi e il nome con cui la pagina la mostra.
  function quanteNeTocca(setter, parole, tolta) {
    const testi = setter.keys.map(pianoChiave).filter((pk) => pk !== tolta).concat(pianoChiave(nomeVoce(setter)));
    return parole.filter((w) => {
      const r = w.length > 5 ? w.slice(0, w.length - 2) : w;
      return testi.some((t) => t.includes(r));
    }).length;
  }
  // Le voci che le parole toccano di più: una sola, o le pari merito.
  function piuToccate(setters, parole, tolta) {
    let punti = 0;
    let scelte = [];
    for (const s of setters) {
      const n = quanteNeTocca(s, parole, tolta);
      if (n > punti) { punti = n; scelte = [s]; } else if (n === punti && n) scelte.push(s);
    }
    return { punti, scelte };
  }

  // La voce indicata da una chiave: { setter }, { ambigui: [setter…] } se ne indica più d'una, o null.
  // Esatta prima; detta a metà vale solo se indica una voce sola: «pubblicità» è sia il blocco sia il salto dei
  // video. Vince la chiave più lunga contenuta in quella detta («adblocker» → adblock), ma se è il nome comune di
  // più voci («siti fidati»: programmi e cookie) decidono le altre parole dette; se non bastano, è ambigua.
  function risolviChiave(rawKey) {
    const key = String(rawKey == null ? '' : rawKey).trim().toLowerCase();
    if (!key) return null;
    const diretto = PREF_SETTERS.find((s) => s.keys.includes(key));
    if (diretto) return { setter: diretto };
    const nk = pianoChiave(key);
    const esatto = PREF_SETTERS.find((s) => s.keys.some((k) => pianoChiave(k) === nk));
    if (esatto) return { setter: esatto };
    // Il nome che la lettura delle impostazioni mostra («blocco di pubblicità e tracker») vale come la chiave.
    const perNome = PREF_SETTERS.filter((s) => pianoChiave(nomeVoce(s)) === nk);
    if (perNome.length === 1) return { setter: perNome[0] };
    let migliore = null;
    let vinta = '';
    let pari = false;
    for (const setter of PREF_SETTERS) {
      for (const k of setter.keys) {
        const pk = pianoChiave(k);
        if (!pk || !nk.includes(pk)) continue;
        if (pk.length > vinta.length) { migliore = setter; vinta = pk; pari = false; } else if (pk.length === vinta.length && setter !== migliore) pari = true;
      }
    }
    if (migliore && !pari) {
      const fratelli = PREF_SETTERS.filter((s) => s !== migliore && s.keys.some((k) => { const pk = pianoChiave(k); return pk !== vinta && pk.includes(vinta); }));
      if (!fratelli.length) return { setter: migliore };
      const resto = nk.replace(vinta, ' ').split(' ').filter((w) => w.length >= 3 && !PAROLE_VUOTE.has(w));
      const tutti = [migliore, ...fratelli];
      const { scelte } = piuToccate(tutti, resto, vinta);
      return scelte.length === 1 ? { setter: scelte[0] } : { ambigui: scelte.length ? scelte : tutti };
    }
    const candidati = migliore
      ? PREF_SETTERS.filter((s) => s.keys.some((k) => pianoChiave(k).length === vinta.length && nk.includes(pianoChiave(k))))
      : PREF_SETTERS.filter((s) => s.keys.some((k) => pianoChiave(k).includes(nk)));
    if (candidati.length === 1) return { setter: candidati[0] };
    if (candidati.length) return { ambigui: candidati };
    // Nessuna chiave combacia per intero: decidono le parole («siti fidati dei programmi»), almeno due, e una voce sola.
    const parole = nk.split(' ').filter((w) => w.length >= 3 && !PAROLE_VUOTE.has(w));
    const { punti, scelte } = piuToccate(PREF_SETTERS, parole, '');
    if (punti < 2) return null;
    return scelte.length === 1 ? { setter: scelte[0] } : { ambigui: scelte };
  }

  // Trova il setter giusto per una chiave e costruisce il partial. Ritorna { partial, label, costo, allenta, elencoFisso, dove,
  // risk, testo?, avviso? }; `attuali` = le impostazioni correnti, se note: senza, un cambio di rigore vale come abbassare.
  // Oppure { rifiuto, perModello? } se va rifiutato spiegando perché (`rifiuto` lo legge l'utente, `perModello` dice al
  // modello come rimediare), o null se chiave/valore non validi (il perché lo dà spiegaNonValida).
  function buildPreferencePartial(rawKey, rawVal, { attuali = null } = {}) {
    const r = risolviChiave(rawKey);
    if (!r) return null;
    if (r.ambigui) {
      return {
        rifiuto: `«${String(rawKey).trim().slice(0, 60)}» può voler dire più impostazioni: ${[...new Set(r.ambigui.map(nomeVoce))].map((n) => `«${n}»`).join(', ')}`,
        perModello: `Le chiavi sono ${r.ambigui.map((s) => s.keys[0]).join(', ')}: usa quella che l'utente ha chiesto, o chiedigli quale.`,
      };
    }
    const setter = r.setter;
    const b = setter.build(rawVal);
    if (b && b.rifiuto) return b.perModello ? { rifiuto: b.rifiuto, perModello: b.perModello } : { rifiuto: b.rifiuto };
    if (!b) return null;
    let allenta = false;
    try { allenta = typeof setter.allenta === 'function' ? !!setter.allenta(b, attuali) : false; } catch (_) { allenta = true; }
    let chiede = false;
    try { chiede = typeof setter.chiede === 'function' ? !!setter.chiede(b, attuali) : false; } catch (_) { chiede = true; }
    let avviso = '';
    try { avviso = attuali && typeof setter.avviso === 'function' ? String(setter.avviso(b, attuali) || '') : ''; } catch (_) { avviso = ''; }
    return {
      ...b,
      costo: setter.costo,
      allenta,
      ...(chiede ? { chiede: true } : {}),
      ...(avviso ? { avviso } : {}),
      elencoFisso: setter.elencoFisso || '',
      dove: setter.dove || '',
      risk: setter.risk || '',
    };
  }

  // Perché una chiave o un valore non si applicano (buildPreferencePartial ha reso null): { rifiuto, perModello }.
  function spiegaNonValida(rawKey, rawVal) {
    const r = risolviChiave(rawKey);
    const detta = String(rawKey == null ? '' : rawKey).trim().slice(0, 60);
    if (!r || !r.setter) {
      return {
        rifiuto: `«${detta}» non è un'impostazione che Filo conosce`,
        perModello: 'Usa una chiave dell\'elenco di IMPOSTA_PREFERENZA; per cercarla c\'è LEGGI_IMPOSTAZIONI.',
      };
    }
    const aiuto = typeof r.setter.aiuto === 'function' ? r.setter.aiuto({}) : r.setter.aiuto;
    const valore = typeof rawVal === 'string' ? rawVal.trim().slice(0, 60) : String(rawVal);
    return {
      rifiuto: `«${valore}» non è un valore che «${nomeVoce(r.setter)}» accetta`,
      perModello: `Valori ammessi per ${r.setter.keys[0]}: ${aiuto || 'vedi l\'elenco di IMPOSTA_PREFERENZA'}. Riprova con uno di questi se è chiaro quale vuole l'utente, altrimenti chiediglielo.`,
    };
  }
  function pianoChiave(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Una lezione è la sorella dello stile (#592): il popup mostra il testo che si
  // salva, e oltre il tetto torna un rifiuto col perché, mai un taglio.
  // `cosa`: come il rifiuto chiama il testo, perché una correzione di una riga del profilo non è una lezione.
  function lezioneDaAzione(a, { cosa = 'la lezione' } = {}) {
    const testo = testoVisibile(a && (a.testo ?? a.text ?? a.lezione));
    if (!testo) return { testo: '' };
    const C = global.SN_CONST;
    const n = C.agentStyleLength(testo);
    if (n > C.LESSON_MAX) return { testo, rifiuto: `${cosa} è lunga ${cifre(n)} caratteri e il massimo è ${cifre(C.LESSON_MAX)}` };
    return { testo };
  }

  // Il setter di un'impostazione, dal percorso che scrive: è la chiave con cui la chat la cambia.
  function setterDi(percorso) {
    return PREF_SETTERS.find((s) => Array.isArray(s.scrive) && s.scrive.includes(percorso)) || null;
  }

  // Il setter che una chiave detta in chat sceglie, o null (anche quando è ambigua).
  function setterDellaChiave(rawKey) {
    const r = risolviChiave(rawKey);
    return (r && r.setter) || null;
  }

  // Il rifiuto dell'interruttore dei fornitori esclusi chiesto senza una chiave propria (#962): lo legge l'utente.
  const SENZA_CHIAVE_PROPRIA = 'serve una tua chiave OpenRouter, da mettere nella pagina Crediti. Senza, le richieste '
    + 'le pagano i crediti di Filo, e lì i fornitori esclusi restano esclusi';

  global.SN_PREF = {
    buildPreferencePartial, parsePrefBool, parseItalianNumber, PREF_SETTERS, lezioneDaAzione,
    applicaElenco, righeDescrizione, setterDi, setterDellaChiave, spiegaNonValida, PARAMETRI_COLORE_TAB,
    SENZA_CHIAVE_PROPRIA, tonoDa, TONI_ETICHETTE,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
