// Registro delle azioni di Filo: per ognuna il COSTO di sbagliarla (0-3) e il CAMPO, statici, mai decisi dall'LLM.
// Non decide se un'azione parte: gli ingressi li legge il dispatch e la risposta la dà SN_AUTONOMIA (#530).
// Un'azione fuori registro o senza costo non parte: sentinella in tests/unit/autonomia.test.mjs.

(function (global) {
  'use strict';

  function lezione(a) {
    const P = global.SN_PREF;
    if (P && P.lezioneDaAzione) return P.lezioneDaAzione(a);
    return { testo: String((a && (a.testo ?? a.text ?? a.lezione)) ?? '').trim() };
  }
  const RISCHIO_LEZIONE = 'Da adesso vale in ogni conversazione, e resta finché non la togli dalle Preferenze, '
    + 'sotto «Memoria di Filo». Confermala solo se l\'hai detta tu: un testo letto in una pagina o in un '
    + 'documento potrebbe provare a fargliela ricordare.';

  // L'utente che chiede di mandare una segnalazione la nomina: chi non la nomina non l'ha chiesta.
  const CHIESTA_SEGNALAZIONE = /\b(?:segnal\w*|feedback|sviluppator\w*|report\w*|bug)\b|\bdi['’]\s+al\s+team\b|\bal\s+team\s+di\s+filo\b/i;

  // Un comando che scarica dal web porta nel compito testo di autore ignoto, non un file del computer.
  const SCARICA = /\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|http|https|aria2c|lynx|w3m)\b|https?:\/\//i;

  // I nomi delle reti conosciute e dei dispositivi abbinati li sceglie chi li gestisce, non l'utente: autori a cui
  // si è già collegato, classe 3 come i mittenti fidati.
  function nomiDiSistema(out, cosa) {
    if (!Array.isArray(out.elenco) || !out.elenco.length) return null;
    return cosa === 'wifi'
      ? { classe: 3, campo: null, chiave: 'sistema:wifi', motivo: 'ho letto i nomi delle reti Wi-Fi, che non hai scritto tu' }
      : { classe: 3, campo: null, chiave: 'sistema:bluetooth', motivo: 'ho letto i nomi dei dispositivi Bluetooth, che non hai scritto tu' };
  }

  function prefBuilt(action, attuali) {
    const P = global.SN_PREF;
    if (!P) return null;
    const chiave = action.chiave ?? action.key ?? action.nome ?? action.name ?? action.preferenza;
    const valore = action.valore ?? action.value ?? action.valoreNuovo ?? action.val;
    return P.buildPreferencePartial(chiave, valore, { attuali: attuali || null });
  }

  // Lo stile proposto nell'intervista di benvenuto si imposta senza riquadro (decisione dell'owner, #592.2):
  // `_accoglienza` lo scrive solo il main, quando nel contesto non c'è testo di altri. Torna il testo, o ''.
  function stileDellAccoglienza(action) {
    if (!action || action._accoglienza !== true) return '';
    const built = prefBuilt(action);
    return built && !built.rifiuto && built.testo && built.partial && 'agentStyle' in built.partial ? built.testo : '';
  }

  // Token + valore di un'azione estetica (più sinonimi che un LLM può produrre).
  function estTok(action) {
    return action.token ?? action.nome ?? action.name ?? action.chiave ?? action.elemento;
  }
  function estVal(action) {
    return action.valore ?? action.value ?? action.val ?? action.colore;
  }

  // Etichetta leggibile di un paese per le azioni proxy (#152). Le location
  // curate combaciano con ProxyTab.LOCATIONS; per qualsiasi altro alpha-2 valido
  // ripieghiamo sul codice maiuscolo (il linguaggio naturale può chiedere paesi
  // fuori dalla lista curata).
  const COUNTRY_LABELS = {
    us: 'Stati Uniti', gb: 'Regno Unito', fr: 'Francia', de: 'Germania',
    es: 'Spagna', nl: 'Paesi Bassi', jp: 'Giappone',
  };
  function proxyCountry(action) {
    return action.country ?? action.paese ?? action.codicePaese ?? action.location;
  }
  function countryLabel(c) {
    const code = String(c || '').trim().toLowerCase();
    if (!/^[a-z]{2}$/.test(code)) return '';
    return COUNTRY_LABELS[code] || code.toUpperCase();
  }
  function proxyDomain(action) {
    return action.dominio ?? action.domain ?? action.sito;
  }

  // ── sveglie e timer: da cosa dipende il costo ────────────────────────────
  // `_targets` è l'elenco (già leggibile) di ciò che l'azione colpirebbe
  // DAVVERO: lo calcola il main leggendo la lista, mai l'LLM. Quando manca
  // (registro consultato fuori dal main) i conti tornano null e si ripiega
  // sulla forma della richiesta.
  function targetList(action) {
    return Array.isArray(action && action._targets) ? action._targets : [];
  }
  function targetCount(action) {
    return Array.isArray(action && action._targets) ? action._targets.length : null;
  }
  function wantsAll(action) {
    const v = action && (action.tutte ?? action.tutti ?? action.all);
    if (v === true) return true;
    return /^(true|1|si|sì|yes|tutte|tutti)$/i.test(String(v ?? ''));
  }
  function periodoDetto(action) {
    const vuoto = (v) => v == null || v === '';
    if (action && (!vuoto(action.da) || !vuoto(action.a)) && action._periodo) {
      const quando = (iso) => new Date(iso).toLocaleString('it-IT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
      const { da, a } = action._periodo;
      return da ? `dal ${quando(da)} al ${quando(a)}` : `fino al ${quando(a)}`;
    }
    const ore = Number(action && action.ore);
    if (Number.isFinite(ore) && ore > 0) return ore === 1 ? 'dell’ultima ora' : `delle ultime ${ore} ore`;
    const giorni = Number(action && action.giorni);
    if (Number.isFinite(giorni) && giorni > 0) return giorni === 1 ? 'dell’ultimo giorno' : `degli ultimi ${giorni} giorni`;
    const p = String((action && (action.periodo || action._nomePeriodo)) || '').toLowerCase();
    if (p === 'oggi') return 'di oggi';
    if (p === 'ieri') return 'di ieri';
    if (p === 'tutto') return 'di sempre';
    return 'dell’ultima ora';
  }
  function sitoDetto(action) {
    const s = String((action && (action._sito || action.sito)) || '').trim();
    return s ? ` su ${s}` : '';
  }
  function timerRefLabel(action) {
    const kind = String((action && (action.tipo ?? action.kind)) || '').toLowerCase();
    const cosa = /timer/.test(kind) ? 'i timer' : (/svegli|alarm/.test(kind) ? 'le sveglie' : 'sveglie e timer');
    const etichetta = String((action && (action.etichetta ?? action.label ?? action.nome)) || '').trim();
    if (wantsAll(action) && !etichetta) return `TUTTI ${cosa}`;
    if (etichetta) return `“${etichetta}”`;
    return cosa;
  }
  function repeatLabel(action) {
    const M = global.SN_FILO_MEMORY;
    const raw = action && (action.ripeti ?? action.repeat ?? action.giorni);
    if (!raw || !M || !M.formatRepeat) return '';
    return M.formatRepeat(raw);
  }

  // Il nome che l'utente vede sulla carta, non l'id che il modello manda.
  function descriviCarta(a, fatto) {
    const C = global.SN_CARTE_HOME;
    // Un nome di destra si riconosce solo esatto: «lo scaricamento del file» è una carta di sinistra, non l'Editor.
    const id = C ? C.risolvi(a && a.carta, { esatto: true }) : null;
    const detto = String((a && a.carta) || '').trim();
    // Una chiave («avviso:…») non è un nome da mostrare: la frase resta senza.
    const nome = id ? ` «${C.carta(id).titolo}»` : (detto && !/^[a-z]+:/.test(detto) ? ` «${detto.length > 60 ? `${detto.slice(0, 59)}…` : detto}»` : '');
    const op = String((a && (a.operazione ?? a.op)) || '').toLowerCase();
    if (op === 'ripristina') return fatto ? 'Carte della home rimesse com\'erano all\'inizio' : 'Rimettere le carte della home com\'erano all\'inizio';
    if (op === 'togli' && !id) return fatto ? `Carta${nome} tolta dalla home` : `Togliere la carta${nome} dalla home`;
    if (op === 'togli') return fatto ? `Carta${nome} tolta dalla home: ora è un'icona in «altro»` : `Togliere la carta${nome} dalla home`;
    if (op === 'rimetti' || op === 'aggiungi') return fatto ? `Carta${nome} rimessa nella home` : `Rimettere la carta${nome} nella home`;
    return fatto ? `Carta${nome} spostata nella home` : `Spostare la carta${nome} nella home`;
  }

  // Perché LEGGI_DOCUMENTO esce dal perimetro di lettura ('' se ci sta). Senza
  // classificatore non si sa: si chiede.
  function documentoFuori(a) {
    const C = global.SN_CMD_CLASSIFY;
    if (!C || !C.fuoriPerimetro) return 'non si sa dove legge';
    const p = a && (a.percorso ?? a.path ?? a.file ?? a.documento ?? a.nome);
    return C.fuoriPerimetro(p, a && a._perimetro);
  }

  // Cosa fa un comando, a parole (#892): la scrive il modello e apre bottone e
  // popup, sopra il comando vero. È solo testo, il costo non la legge mai.
  // Via i caratteri invisibili o che rigirano il testo; il tetto si vede (…).
  const SPIEGAZIONE_MAX = 300;
  function spiegazioneComando(a) {
    const v = a && (a.spiegazione ?? a.descrizione);
    let t = (typeof v === 'string' ? v : '')
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
    const segni = Array.from(t);
    if (segni.length > SPIEGAZIONE_MAX) t = `${segni.slice(0, SPIEGAZIONE_MAX - 1).join('').trimEnd()}…`;
    return t || 'Uso il terminale del computer';
  }

  function nomeLeggibile(n) {
    const N = global.SN_NOMI_FILE;
    const s = N ? N.nomeVisibile(n) : String(n == null ? '' : n).replace(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '');
    return s.trim();
  }
  function elencoRinomine(a) {
    const proposte = Array.isArray(a && a._proposte) ? a._proposte : [];
    const saltati = Array.isArray(a && a._saltati) ? a._saltati : [];
    const n = proposte.length;
    const righe = proposte.map((p) => `«${nomeLeggibile(p && p.prima)}» → «${nomeLeggibile(p && p.nome)}»`);
    let t = `${n === 1 ? 'Rinominare questo file' : `Rinominare questi ${n} file`}:\n${righe.join('\n')}`;
    if (saltati.length) {
      t += `\n\nRestano come sono:\n${saltati.map((x) => `«${nomeLeggibile(x && x.nome)}»: ${nomeLeggibile(x && x.perche)}`).join('\n')}`;
    }
    if (a && a._oltre > 0) t += `\n\nNe restano altri ${a._oltre}: chiedimelo di nuovo dopo questi.`;
    return `${t}\n\nL'estensione non cambia e nessun file viene sovrascritto. Dopo puoi rimettere i nomi di prima con «Annulla».`;
  }

  const REGISTRY = {
    NAVIGA: {
      // Aprire un link è di norma innocuo → costo 1, diretto. ECCEZIONE
      // anti-esfiltrazione: se l'URL trasporta FUORI dati sensibili che il
      // modello aveva nel contesto (taint-match) o ha la forma di un payload di
      // esfiltrazione da origine non fidata (fallback strutturale), sale a
      // costo 2, e dove la risposta è chiedere il popup mostra l'URL. Il flag `_exfil` lo calcola il
      // main (src/main/services/handlers.js → src/shared/urlExfil.js); mai l'LLM.
      // La ricerca dell'Aiuto (`cerca`) porta fuori testo della pagina: costo 2, deciso qui una volta sola
      // (#530). Il campo può solo alzare il costo, quindi chi lo forgia non ottiene niente.
      costo: (a) => (a && (a._exfil || a.cerca) ? 2 : 1),
      campo: 'web',
      uscita: (a) => String((a && (a.url ?? a.href ?? a.link)) || ''),
      describe: (a) => {
        const url = a.url || a.href || a.link || 'una pagina';
        if (a && a._exfil) {
          const why = a._exfilReason ? ` che ${a._exfilReason}` : '';
          return `Aprire un link${why}:\n${url}\n\n`
            + 'Potrebbe inviare tuoi dati a un sito esterno. Apri solo se l\'hai chiesto tu.';
        }
        if (a && typeof a.cerca === 'string' && a.cerca.trim()) {
          const t = a.cerca.trim();
          return `Cercare sul web:\n“${t.length > 80 ? `${t.slice(0, 80)}…` : t}”`;
        }
        return `Aprire ${url}`;
      },
    },
    APRI_FILE: {
      costo: 1,
      campo: 'file',
      describe: (a) => `Aprire il file ${a.percorso || a.path || ''}`.trim(),
    },
    TIMER: {
      costo: 1,
      campo: null,
      describe: (a) => `Avviare il timer "${a.label || a.etichetta || 'Timer'}"`,
    },
    // Rinominare file dell'utente (#950): si torna indietro con «Annulla», ma un programma che cercava il file
    // per nome non lo trova più → costo 2. L'elenco vecchio → nuovo lo prepara il main (`_proposte`), mai il modello.
    RINOMINA_FILE: {
      costo: 2,
      campo: 'file',
      describe: (a) => elencoRinomine(a),
      describeDone: (a) => {
        const fatti = a && a._output && Array.isArray(a._output.rinominati) ? a._output.rinominati : null;
        const n = fatti ? fatti.length : (Array.isArray(a && a._proposte) ? a._proposte.length : 0);
        return n === 1 ? 'Rinominato un file (si rimette com\'era con «Annulla»)' : `Rinominati ${n} file (si rimettono com'erano con «Annulla»)`;
      },
    },
    SVEGLIA: {
      costo: 1,
      campo: null,
      describe: (a) => `Impostare una sveglia ${a.time || a.orario || ''}`.trim(),
    },
    // Cancellare e spostare sveglie e timer dalla chat. Il criterio del costo
    // è QUANTE cose sparirebbero, non come la richiesta è formulata: togliere la
    // sveglia che l'utente ha appena nominato è reversibile a costo zero (la
    // richiede di nuovo) → costo 1, si fa e basta. Cancellarne PIÙ D'UNA con
    // un colpo solo no: "leva tutte le sveglie, sono in ferie" porta via anche
    // quella dell'antibiotico, e chi l'ha detto se ne accorge il giorno dopo →
    // costo 2, e quando si chiede il popup elenca cosa sta per sparire. Il conto (`_targets`) lo
    // fa il main, che ha la lista vera; mai l'LLM. Senza il conto ripieghiamo
    // sulla forma della richiesta ("tutte" → 2), che è il caso prudente.
    CANCELLA_SVEGLIA: {
      costo: (a) => (targetCount(a) > 1 || (targetCount(a) == null && wantsAll(a)) ? 2 : 1),
      campo: null,
      describe: (a) => {
        const list = targetList(a);
        if (list.length) {
          return `Filo sta per togliere ${list.length === 1 ? 'questa voce' : `queste ${list.length} voci`}:\n`
            + list.map((t) => `• ${t}`).join('\n')
            + '\n\nUna volta tolte non suoneranno più.';
        }
        const what = timerRefLabel(a);
        return `Togliere ${what}`;
      },
    },
    MODIFICA_SVEGLIA: {
      // Spostare un orario è reversibile (basta rispostarlo) → costo 1.
      // Stesso freno della cancellazione quando il riferimento ne prende più
      // d'una: cambiare in blocco l'orario di cose che l'utente non ha in mente
      // è indistinguibile da un errore di comprensione.
      costo: (a) => (targetCount(a) > 1 ? 2 : 1),
      campo: null,
      describe: (a) => {
        const list = targetList(a);
        const when = String(a.orario ?? a.time ?? a.at ?? '').trim();
        const rip = repeatLabel(a);
        const dove = when ? ` alle ${when}` : '';
        const quando = rip ? ` (${rip})` : '';
        if (list.length > 1) {
          return `Filo sta per spostare${dove}${quando} queste ${list.length} voci:\n`
            + list.map((t) => `• ${t}`).join('\n');
        }
        return `Spostare ${timerRefLabel(a)}${dove}${quando}`;
      },
    },
    SALVA_APPUNTO: {
      costo: 1,
      campo: 'file',
      describe: () => 'Salvare un appunto',
    },
    SALVA_LEZIONE: {
      // Una lezione entra in ogni conversazione e ci resta, come lo stile: se la
      // propone il modello, l'utente ne conferma il testo esatto (#592). Vuota
      // o oltre il tetto → 1: niente da confermare, il dispatch la respinge.
      costo: (a) => { const l = lezione(a); return l.testo && !l.rifiuto ? 2 : 1; },
      campo: null,
      describe: (a) => {
        const l = lezione(a);
        if (!l.testo || l.rifiuto) return 'Ricordare una cosa';
        return `Filo vuole ricordare una cosa.\n\nTesto esatto:\n«${l.testo}»\n\n${RISCHIO_LEZIONE}`;
      },
      describeDone: (a) => `Ricordato: «${lezione(a).testo}»`,
    },
    INVIA_FEEDBACK: {
      // Filo invia un feedback agli sviluppatori a NOME dell'utente (#146.5).
      // Esce dall'app verso un destinatario scelto (Firestore) → costo 2;
      // quando si chiede, il popup mostra il testo che partirebbe.
      costo: 2,
      campo: null,
      uscita: (a) => [a.titolo ?? a.title ?? '', a.testo ?? a.text ?? a.messaggio ?? ''].join('\n'),
      // Il prompt fa proporre a Filo la segnalazione quando ammette una mancanza: se l'utente non ha chiesto
      // di segnalare, l'uscita è fuori dal perimetro del compito e chiede, anche a compito pulito.
      perimetro: (a, ctx) => CHIESTA_SEGNALAZIONE.test(String((ctx && ctx.richiesta) || '')),
      describe: (a) => {
        // Il popup mostra il testo INTERO, mai una versione tagliata: è quello
        // che parte a nome dell'utente, e un consenso su un testo che non si
        // può leggere per intero non è un consenso. Se è lungo, è il popup a
        // scorrere (src/shared/confirmUi.js), non il testo ad accorciarsi.
        const testo = String(a.testo ?? a.text ?? a.messaggio ?? '').trim();
        return `Inviare questo feedback agli sviluppatori di Filo a tuo nome:\n“${testo || '(vuoto)'}”`;
      },
    },
    CERCA_WEB: {
      // Cercare è leggere, e il risultato resta in chat → costo 0. ECCEZIONE anti-esfiltrazione: se
      // la query trasporta FUORI un segreto (memoria, o ciò che il modello ha
      // letto nel turno) sale a costo 2, e il popup mostra la query. Il
      // flag `_exfil` lo calcola il main (→ urlExfil.js); mai l'LLM.
      costo: (a) => (a && a._exfil ? 2 : 0),
      campo: 'web',
      uscita: (a) => String((a && (a.query ?? a.q ?? a.testo ?? a.text)) || ''),
      fonte: (a, out) => (Array.isArray(out.results) && out.results.length
        ? { classe: 5, campo: 'web', chiave: 'web:ricerca', motivo: 'ho fatto una ricerca sul web' } : null),
      describe: (a) => {
        const q = a.query || a.q || a.testo || a.text || '';
        if (a && a._exfil) {
          const why = a._exfilReason ? ` che ${a._exfilReason}` : '';
          return `Cercare sul web un testo${why}:\n"${q}"\n\n`
            + 'Potrebbe inviare tuoi dati a un motore di ricerca. Cerca solo se l\'hai chiesto tu.';
        }
        return `Cercare sul web "${q}"`;
      },
    },
    ONBOARDING: {
      // Filo tiene il conto della micro-intervista di benvenuto (#524): spunta
      // le cose che ha scoperto o detto e dichiara quando l'intervista è
      // finita. Non tocca nulla dell'utente — le impostazioni che l'intervista
      // applica passano dalle LORO azioni (IMPOSTA_PREFERENZA, SALVA_LEZIONE),
      // ognuna col proprio costo — e non ha nulla da annullare: chiudere
      // l'accoglienza è quello che l'utente vuole appena dice "basta così", e
      // dalle Preferenze la si rilancia quando vuole. Costo 1.
      costo: 1,
      campo: null,
      describe: (a) => {
        if (a && (a.fine ?? a.chiudi ?? a.done)) return 'Chiudere l’intervista di benvenuto';
        const ids = Array.isArray(a?.spunta) ? a.spunta : [];
        return `Segnare come fatto nell’intervista di benvenuto${ids.length ? `: ${ids.join(', ')}` : ''}`;
      },
    },
    CAPACITA_DETTAGLIO: {
      // Filo consulta il proprio manifesto delle capacità per rispondere a "puoi
      // fare X?" (#F2). Sola lettura di dati statici interni, nessun effetto
      // collaterale né uscita verso l'esterno: resta in chat → costo 0.
      costo: 0,
      campo: null,
      describe: (a) => {
        const ids = Array.isArray(a.ids) ? a.ids : (a.id ? [a.id] : []);
        return `Verificare cosa sa fare Filo${ids.length ? ` (${ids.join(', ')})` : ''}`;
      },
    },
    // #949 — togliere una risposta ricordata non concede niente: il sito torna a chiedere.
    TOGLI_PERMESSO_SITO: {
      costo: 1,
      campo: null,
      describe: (a) => {
        const sito = String((a && (a.sito ?? a.dominio)) || '').trim().slice(0, 80) || 'un sito';
        const p = String((a && a.permesso) || '').trim().slice(0, 40);
        return `Togliere ${p ? `il permesso «${p}»` : 'i permessi ricordati'} di ${sito}`;
      },
      describeDone: (a) => {
        const tolte = (a && a._output && Array.isArray(a._output.tolte)) ? a._output.tolte : [];
        return tolte.length ? `Tolte le risposte ricordate: ${tolte.join('; ')} (il sito tornerà a chiedere)` : 'Nessuna risposta tolta';
      },
    },
    LEGGI_IMPOSTAZIONI: {
      // #949 — rilegge le impostazioni dell'utente, senza le chiavi: sola lettura, niente esce.
      costo: 0,
      campo: null,
      describe: (a) => {
        const cerca = String((a && (a.cerca ?? a.query ?? a.chiave)) || '').replace(/\s+/g, ' ').trim();
        return cerca ? `Leggere com'è impostato «${cerca.slice(0, 60)}»` : 'Leggere le impostazioni';
      },
      describeDone: (a) => {
        const cerca = String((a && (a.cerca ?? a.query ?? a.chiave)) || '').replace(/\s+/g, ' ').trim();
        return cerca ? `Letto com'è impostato «${cerca.slice(0, 60)}»` : 'Lette le impostazioni';
      },
    },
    CERCA_CHAT: {
      // #525 — Filo rilegge le conversazioni passate con lo stesso utente per
      // riprendere un discorso di ieri. Sola lettura di dati che sono già
      // dell'utente e che sono già passati da questo contesto (le ha scritte
      // lui, con Filo): niente scritture, niente cancellazioni, niente che
      // esca dal computer → costo 0, come LEGGI_FILE. Sono di classe 1: non sporcano il compito.
      costo: 0,
      campo: null,
      describe: (a) => {
        const q = String((a && (a.query ?? a.testo)) || '').trim();
        if (a && a.id && !q) return 'Rileggere una conversazione passata';
        return `Cercare nel filo${q ? ` ("${q}")` : ''}`;
      },
    },
    LEGGI_FILE: {
      // Filo apre per intero un file dell'EDITOR di cui vede solo il riassunto
      // (#379.5). Sola lettura di dati che sono già in parte nel contesto (i
      // riassunti ci stanno sempre), nessuna scrittura e nessuna uscita → costo 0.
      // Mancava dal registro: senza una voce qui il dispatch rifiuta l'azione,
      // quindi la lettura on-demand dei documenti dell'editor non partiva mai.
      costo: 0,
      campo: 'file',
      fonte: (a, out) => (out.text ? { classe: 2, campo: 'file', chiave: `editor:${a.fileId ?? a.id ?? ''}`, motivo: 'ho letto un file dell\'editor' } : null),
      describe: (a) => {
        const id = a && (a.fileId ?? a.id ?? a.file);
        return `Leggere per intero un documento dell'editor${id ? ` (${id})` : ''}`;
      },
    },
    LEGGI_DOCUMENTO: {
      // Filo legge un documento dal DISCO dell'utente — un PDF (bolletta,
      // estratto conto, contratto) o un file di testo — perché l'utente gli ha
      // chiesto di leggerlo. Costo 0: leggere è sempre libero, non modifica niente, non
      // esegue niente, non manda niente fuori dal computer — il testo entra solo
      // nel contesto del modello. Una conferma a ogni documento sarebbe attrito
      // su una cosa che l'utente ha appena chiesto, e una conferma che si accetta
      // sempre smette di essere un controllo. Fuori dal perimetro di lettura
      // (#587: altri dischi, file nascosti, profilo) costo 2, come `cat`. Quello che legge
      // sporca il compito: classe 4, o 5 se il file è scaricato.
      costo: (a) => (documentoFuori(a) ? 2 : 0),
      campo: 'file',
      fonte: (a, out) => {
        if (!out.text) return null;
        return out.scaricato
          ? { classe: 5, campo: 'file', chiave: `file:${out.documentRead || ''}`, motivo: 'ho letto un file scaricato' }
          : { classe: 4, campo: 'file', chiave: `file:${out.documentRead || ''}`, motivo: 'ho letto un documento dal tuo disco' };
      },
      describe: (a) => {
        const p = a && (a.percorso ?? a.path ?? a.file ?? a.documento);
        const perche = documentoFuori(a);
        return `Leggere il documento ${p || ''}`.trim() + (perche ? `\nPerché te lo chiedo: ${perche}` : '');
      },
    },
    LEGGI_TRASPARENZA: {
      // Filo rilegge i propri documenti di trasparenza per rispondere a "perché
      // usi questo modello?", "che fine fanno i miei dati?". Sola lettura di
      // testo statico incluso nell'app, nessuna uscita verso l'esterno → 1.
      costo: 0,
      campo: null,
      describe: (a) => `Rileggere la pagina di trasparenza${a && a.doc ? ` (${a.doc})` : ''}`,
    },
    EVENTO_CALENDARIO: {
      costo: 1,
      campo: null,
      describe: (a) => `Creare l'evento "${a.title || a.titolo || ''}"`,
    },
    // La prima riga di describe è quella che il diario mostra mentre si aspetta il clic.
    PULISCI_TAB: {
      costo: 2,
      campo: null,
      describe: () => 'Riordinare le schede e archiviare quelle non più utili.\n'
        + 'Le schede archiviate restano riapribili da “Tab archiviate”.',
      describeDone: (a) => {
        const n = Number(a && a._output && a._output.archived) || 0;
        return n ? `Schede riordinate: archiviate ${n} non più utili` : 'Schede riordinate: nessuna da archiviare';
      },
    },
    CANCELLA_ARCHIVIO: {
      costo: 3,
      campo: null,
      describe: (a) => `Eliminare dall'archivio le schede su “${a.query || a.testo || ''}”.\n`
        + 'Vengono eliminate DEFINITIVAMENTE: non si possono recuperare.',
      describeDone: (a) => {
        const n = Number(a && a._output && a._output.eliminate) || 0;
        return `Eliminate DEFINITIVAMENTE dall'archivio ${n} ${n === 1 ? 'scheda' : 'schede'} su “${a.query || a.testo || ''}”`;
      },
    },
    // #866 — come in ogni browser: il popup dice quante pagine e di quale periodo, il conto lo fa il main (`_n`).
    // Non tornano più: costo 3, che a Normale con il compito pulito chiede un OK (#530).
    CANCELLA_PAGINE: {
      costo: 3,
      campo: null,
      describe: (a) => {
        const n = Number(a && a._n);
        const quali = Number.isFinite(n) ? (n === 1 ? 'la pagina visitata' : `le ${n} pagine visitate`) : 'le pagine visitate';
        return `Cancellare ${quali}${sitoDetto(a)} ${periodoDetto(a)}.\nFilo non le ricorderà più. Chat e schede chiuse restano.`;
      },
      describeDone: (a) => {
        const n = Number(a && a._output && a._output.cancellate) || 0;
        return n ? `Cancellate ${n === 1 ? '1 pagina visitata' : `${n} pagine visitate`}${sitoDetto(a)} ${periodoDetto(a)}` : `Nessuna pagina visitata${sitoDetto(a)} ${periodoDetto(a)}`;
      },
    },
    CANCELLA_MEMORIA: {
      // Cancella tutti i moduli di memoria di Filo (PROFILO, PREFERENZE, espansioni)
      // e il buffer delle lezioni non ancora compattate. Irreversibile: il profilo
      // utente che Filo ha costruito nel tempo va perso. Cancellare dati in modo definitivo
      // sta nell'elenco fisso: Filo non lo fa a nessun livello, e dice all'utente dove farlo da sé.
      costo: 3,
      campo: null,
      elenco: () => 'cancella-definitivo',
      dove: 'Le righe della memoria le può togliere l\'utente, una per una, in Preferenze sotto «Memoria di Filo».',
      describe: () => 'Eliminare DEFINITIVAMENTE tutta la memoria di Filo: '
        + 'profilo utente, preferenze apprese e lezioni non ancora salvate. '
        + 'Filo ripartirà senza ricordare nulla di te.',
    },
    DIMENTICA: {
      // Toglie dalla memoria le righe indicate a voce: le stesse della × nelle
      // Preferenze. Il main risolve la frase in `_righe` prima del gate, mai
      // l'LLM; nessuna riga → 1, il dispatch lo dice. Oltre tre è quasi un
      // «dimentica tutto» → costo 3.
      costo: (a) => {
        const n = Array.isArray(a && a._righe) ? a._righe.length : 0;
        return n === 0 ? 1 : n > 3 ? 3 : 2;
      },
      campo: null,
      describe: (a) => {
        const righe = Array.isArray(a && a._righe) ? a._righe : [];
        if (!righe.length) return 'Dimenticare una cosa';
        return `Filo sta per dimenticare ${righe.length === 1 ? 'questa riga' : `queste ${righe.length} righe`} della sua memoria:\n`
          + righe.map((r) => `• ${r}`).join('\n')
          + '\n\nNon entreranno più nelle conversazioni.';
      },
      describeDone: (a) => `Dimenticato: ${(a._righe || []).map((r) => `«${r}»`).join(', ')}`,
    },
    IMPOSTA_PREFERENZA: {
      // Costo, difesa abbassata ed elenco fisso li dichiara il setter in preferences.js. Preferenza sconosciuta,
      // valore non valido o `rifiuto` → 1: il dispatch la respinge col perché, niente OK a vuoto. Un elenco che
      // resterebbe com'è (`_invariato`, lo mette il main, #949): niente da confermare.
      costo: (a) => {
        if (a && a._invariato) return 1;
        if (stileDellAccoglienza(a)) return 1;
        const built = prefBuilt(a);
        return built && !built.rifiuto ? built.costo : 1;
      },
      campo: null,
      elenco: (a) => { const built = prefBuilt(a); return (built && !built.rifiuto && built.elencoFisso) || ''; },
      difesa: (a, ctx) => {
        if (a && a._invariato) return false;
        const built = prefBuilt(a, ctx && ctx.impostazioni);
        return !!(built && !built.rifiuto && built.allenta);
      },
      dove: (a) => { const built = prefBuilt(a); return (built && built.dove) || ''; },
      describe: (a) => {
        const built = prefBuilt(a);
        if (!built || built.rifiuto) return 'Modificare una preferenza';
        // Il popup di conferma spiega COSA Filo sta per fare e, per le
        // impostazioni sensibili (costo 2 o difesa), anche i RISCHI (#183). Il `risk`
        // arriva dal setter in preferences.js, che deve dichiararlo.
        // Un testo libero si mostra per intero: si conferma quello (#592). La
        // prima riga resta corta perché fa anche da bottone.
        const base = `Filo vuole impostare: ${built.label}.`;
        const testo = built.testo ? `\n\nTesto esatto:\n«${built.testo}»` : '';
        return built.risk ? `${base}${testo}\n\n${built.risk}` : `${base}${testo}`;
      },
      // A cosa fatta (esito allo strumento): niente «vuole», niente rischi.
      describeDone: (a) => {
        const stile = stileDellAccoglienza(a);
        if (stile) return `Userò questo stile: «${stile}»`;
        const built = prefBuilt(a);
        return built && !built.rifiuto ? `Impostazione applicata: ${built.label}` : 'Preferenza modificata';
      },
    },
    IMPOSTA_ESTETICA: {
      // Cambio di un token estetico (colore, font, raggio, opacità) su richiesta
      // in chat (#146.4). Reversibile → costo 1: si applica subito, e nella
      // bolla compare un controllo per raffinarlo. ECCEZIONE: se la modifica
      // rende il testo ~uguale allo sfondo (illeggibilità estrema) il costo
      // sale a 2. Il flag `_illegible` lo calcola
      // il main process (ha i token correnti); mai l'LLM.
      costo: (a) => (a && a._illegible ? 2 : 1),
      campo: null,
      describe: (a) => {
        const T = global.SN_THEME_TOKENS;
        const t = T && T.get(estTok(a));
        const label = (t && t.label) || estTok(a) || 'un elemento';
        const val = estVal(a);
        if (a && a._illegible) {
          return `Cambiare “${label}” a ${val || 'questo valore'} renderebbe il testo `
            + `quasi illeggibile (colore troppo vicino allo sfondo). Applico comunque?`;
        }
        return `Cambiare “${label}”${val ? ` a ${val}` : ''}`;
      },
    },
    ESEGUI_COMANDO: {
      // Filo lancia un comando nel terminale (#146.6). Il costo NON è fisso:
      // dipende dal comando EFFETTIVO, classificato dal main (mai dall'LLM) in
      // src/shared/cmdClassify.js. 1 = sola lettura; 2 = modifica recuperabile;
      // 3 = cancellazioni, comandi pericolosi e qualsiasi comando non riconosciuto.
      // Una sequenza di comandi (`&&`/`||`/`;`) prende il costo massimo dei suoi pezzi.
      // L'uscita sporca il compito: classe 4, o 5 se il comando scarica dal web.
      // Comando assente o classificatore non caricato → 3 per massima cautela.
      costo: (a) => {
        const C = global.SN_CMD_CLASSIFY;
        const cmd = String((a && (a.comando ?? a.command ?? a.cmd)) || '').trim();
        if (!cmd || !C) return 3;
        const lvl = C.classify(cmd, a._perimetro);
        return lvl === 1 || lvl === 2 || lvl === 3 ? lvl : 3;
      },
      campo: 'terminale',
      fonte: (a, out) => {
        if (out.blocked) return null;
        const t = `${typeof out.stdout === 'string' ? out.stdout : ''}${typeof out.stderr === 'string' ? out.stderr : ''}`;
        if (!t.trim()) return null;
        const cmd = String((a && (a.comando ?? a.command ?? a.cmd)) || '');
        return SCARICA.test(cmd)
          ? { classe: 5, campo: 'terminale', chiave: 'web:comando', motivo: 'ho scaricato una pagina dal web con un comando' }
          : { classe: 4, campo: 'terminale', chiave: 'terminale:uscita', motivo: 'ho letto l\'uscita di un comando' };
      },
      describe: (a) => {
        const cmd = String((a && (a.comando ?? a.command ?? a.cmd)) || '').trim();
        // DOVE il comando agisce non si legge nel comando: la cartella di lavoro
        // è persistente e la sposta l'assistente da sé (`cd` è costo 1, non
        // chiede niente). Senza dirlo, `wget http://x/authorized_keys` ha lo
        // stesso identico testo nella home — dove è innocuo — e dentro ~/.ssh,
        // dove sovrascrive una chiave. La cartella la inietta il main come
        // `_cwd` (mai l'LLM); il costo non ci si appoggia mai.
        const cwd = String((a && a._cwd) || '').trim();
        const C = global.SN_CMD_CLASSIFY;
        let perche = '';
        try { perche = (cmd && C && C.classifyDetail) ? C.classifyDetail(cmd, a._perimetro).motivo : ''; } catch (_) {}
        return `${spiegazioneComando(a)}\n\nIl comando, nel terminale:\n${cmd || '(comando vuoto)'}`
          + (cwd ? `\nCartella di lavoro: ${cwd}` : '')
          + (perche ? `\nPerché te lo chiedo: ${perche}` : '');
      },
    },
    // ── proxy per-tab via linguaggio naturale (#152) ──────────────────────────
    // Tutte costo 1: instradare una scheda da un altro paese (o salvare una
    // regola per dominio) è completamente reversibile — "torna in Italia" /
    // "togli la regola" annullano. La separazione del cookie jar è inerente al
    // proxy e l'utente l'ha chiesta esplicitamente; il flusso AUTOMATICO da
    // geo-block (che invece propone quando ci sono login attivi) vive altrove.
    PROXY_TAB: {
      costo: 1,
      campo: 'web',
      describe: (a) => `Aprire questa scheda da ${countryLabel(proxyCountry(a)) || 'un altro paese'}`,
    },
    RIMUOVI_PROXY: {
      costo: 1,
      campo: 'web',
      describe: () => 'Riportare questa scheda alla connessione diretta (Italia)',
    },
    RIMUOVI_PROXY_TUTTE: {
      costo: 1,
      campo: 'web',
      describe: () => 'Riportare tutte le schede instradate da un altro paese alla connessione diretta',
    },
    REGOLA_PROXY_DOMINIO: {
      costo: 1,
      campo: 'web',
      describe: (a) => `Aprire sempre ${proxyDomain(a) || 'questo sito'} da ${countryLabel(proxyCountry(a)) || 'un altro paese'}`,
    },
    RIMUOVI_REGOLA_PROXY: {
      costo: 1,
      campo: 'web',
      describe: (a) => `Togliere la regola "apri sempre da un altro paese" per ${proxyDomain(a) || 'questo sito'}`,
    },
    // ── comandi della finestra / barra di Filo via chat (#419) ────────────────
    // L'agente della home aziona i controlli del browser stesso (schermo intero,
    // riduci a icona, menu Impostazioni/App/Account, home) — la stessa cosa che
    // sa già fare l'assistente di pagina. Tutti costo 1: azionare un controllo
    // della finestra è benigno e completamente reversibile (uno schermo intero si
    // toglie, un menu si richiude). "close" è ESCLUSO di proposito: l'AI non
    // chiude finestra né schede.
    COMANDO_FINESTRA: {
      costo: 1,
      campo: null,
      describe: (a) => {
        const cmd = String((a && (a.comando ?? a.command ?? a.cmd)) || '').trim().toLowerCase();
        const labels = {
          fullscreen: 'Mettere o togliere lo schermo intero',
          minimize: 'Ridurre a icona la finestra di Filo',
          home: 'Aprire la home di Filo',
          settings: 'Aprire il menu Impostazioni',
          apps: 'Aprire il menu App',
          account: 'Aprire il menu Account',
        };
        return labels[cmd] || 'Azionare un comando della finestra di Filo';
      },
    },
    // #870 — le carte della home, come le dispone l'utente trascinandole. Costo 1: ogni mossa si annulla con
    // quella opposta, e una carta tolta resta in «altro», da cui si rimette.
    CARTA_HOME: {
      costo: 1,
      campo: null,
      describe: (a) => descriviCarta(a, false),
      describeDone: (a) => descriviCarta(a, true),
    },
    // ── estetica del CONTENUTO della pagina via chat (#185) ───────────────────
    // Filo cambia l'aspetto del testo della pagina che l'utente sta guardando
    // ("scrivi in grassetto tutti i titoli"). Costo 1: si applica subito, vale
    // SOLO per quella pagina (CSS iniettato live) ed è completamente reversibile
    // (basta ricaricare la pagina, o "togli le modifiche" → RIPRISTINA_STILE_PAGINA).
    // Il CSS prodotto dall'LLM viene SANIFICATO dal main (src/shared/pageRestyle.js)
    // prima dell'iniezione: niente at-rule, url(), graffe o markup.
    STILE_PAGINA: {
      costo: 1,
      campo: 'web',
      describe: (a) => {
        const d = a && (a.descrizione ?? a.description);
        if (d) return `Cambiare l'aspetto della pagina: ${String(d).trim()}`;
        return 'Cambiare l\'aspetto del testo della pagina';
      },
    },
    RIPRISTINA_STILE_PAGINA: {
      costo: 1,
      campo: 'web',
      describe: () => 'Togliere le modifiche di stile applicate alla pagina',
    },
    // ── la disposizione delle icone a parole (#871) ──────────────────────────
    // Costo 1: è lo stesso trascinamento che l'utente fa col mouse, e si disfa allo stesso modo.
    SPOSTA_ICONA: {
      costo: 1,
      campo: null,
      describe: (a) => {
        const D = global.SN_DISPOSIZIONE_ICONE;
        const id = String((a && (a.icona ?? a.id)) || '').trim();
        const nome = D && D.noto(id) ? D.nome(id) : (id || 'un\'icona');
        const dove = { barra: 'nella barra laterale', menu: 'nella riga del tasto destro', altro: 'in «Altro…» del tasto destro' };
        const d = dove[String((a && a.dove) || '').trim().toLowerCase()];
        return d ? `Spostare «${nome}» ${d}` : `Spostare «${nome}»`;
      },
      describeDone: (a) => {
        const D = global.SN_DISPOSIZIONE_ICONE;
        const id = String((a && (a.icona ?? a.id)) || '').trim();
        const nome = D && D.noto(id) ? D.nome(id) : id;
        const dove = { barra: 'nella barra laterale', menu: 'nella riga del tasto destro', altro: 'in «Altro…» del tasto destro' };
        return `«${nome}» ora sta ${dove[String((a && a.dove) || '').trim().toLowerCase()] || 'al suo nuovo posto'}`;
      },
    },
    // ── rimettere com'era un cambio di stato (#867) ─────────────────────────
    // Il costo è quello del cambio da rimettere: `_livelloCambio` lo scrive il main dal registro,
    // sempre, prima del cancello (mai dall'azione del modello). Rimettere com'era un cambio sensibile può
    // riabbassare una difesa (la protezione dell'IP spenta): chiede quanto chiederebbe spegnerla.
    ANNULLA_CAMBIO: {
      costo: (a) => (a && a._livelloCambio === 1 ? 1 : 2),
      campo: null,
      difesa: (a) => !(a && a._livelloCambio === 1),
      describe: (a) => {
        const f = String((a && a._fraseCambio) || '').trim();
        const base = f ? `Filo vuole rimettere com'era prima di: ${f}.` : 'Filo vuole rimettere com\'era l\'ultimo cambio.';
        if (a && a._livelloCambio === 1) return base;
        return `${base}\n\nTocca un'impostazione di sicurezza, dei modelli o delle spese: conferma solo se l'hai chiesto tu.`;
      },
      describeDone: (a) => {
        const f = String((a && a._fraseCambio) || '').trim();
        return f ? `Rimesso com'era prima di: ${f}` : 'Cambio annullato';
      },
    },
    // ── volume, Bluetooth e Wi-Fi del computer (#874) ───────────────────────
    // Spegnere o staccare quello che sta servendo (le cuffie, la tastiera, la rete della chat stessa) è 2; il resto
    // 1, e 1 anche ciò che è già com'è chiesto (`gia`: niente cade). Il costo legge `_richiestaSistema`, che il main scrive sempre prima del cancello con la stessa funzione che
    // poi esegue (src/main/services/comandiSistema.js): quello che si conferma è quello che parte.
    VOLUME: {
      costo: 1,
      campo: null,
      describe: (a) => {
        const r = (a && a._richiestaSistema) || {};
        if (r.livello != null) return `Portare il volume del computer al ${r.livello}%`;
        if (r.passo != null) return r.passo > 0 ? 'Alzare il volume del computer' : 'Abbassare il volume del computer';
        if (r.muto === true) return 'Mettere muto il computer';
        if (r.muto === false) return 'Togliere il muto al computer';
        return 'Cambiare il volume del computer';
      },
    },
    BLUETOOTH: {
      campo: null,
      costo: (a) => {
        const r = a && a._richiestaSistema;
        if (!r || r.errore) return 2;
        if (r.gia === true) return 1;
        return r.acceso === false || (r.nome && r.collega === false) ? 2 : 1;
      },
      fonte: (a, out) => nomiDiSistema(out, 'bluetooth'),
      describe: (a) => {
        const r = (a && a._richiestaSistema) || {};
        const nome = (a && a._nomeSistema) || r.nome;
        if (r.elenca) return 'Leggere i dispositivi Bluetooth abbinati';
        if (r.nome && r.collega === false) {
          return `Scollegare «${nome}» dal Bluetooth.\n\nSe è una tastiera, un mouse o le cuffie che stai usando, smette di funzionare finché non lo ricolleghi.`;
        }
        if (r.nome) return `Collegare «${nome}» col Bluetooth`;
        if (r.acceso === true) return 'Accendere il Bluetooth';
        if (r.acceso === false) {
          return 'Spegnere il Bluetooth.\n\nCuffie, casse, tastiere e mouse Bluetooth si scollegano finché non lo riaccendi, dal tasto nella home o chiedendolo a Filo.';
        }
        return 'Cambiare il Bluetooth del computer';
      },
      // Dopo una conferma: quello che è successo, senza i rischi che il popup ha già spiegato.
      describeDone: (a) => {
        const r = (a && a._richiestaSistema) || {};
        const nome = (a && a._nomeSistema) || r.nome;
        if (r.nome) return r.collega === false ? `Scollegato «${nome}» dal Bluetooth` : `Collegato «${nome}» col Bluetooth`;
        return r.acceso === false ? 'Bluetooth spento' : r.acceso === true ? 'Bluetooth acceso' : 'Bluetooth cambiato';
      },
    },
    WIFI: {
      campo: null,
      costo: (a) => {
        const r = a && a._richiestaSistema;
        if (!r || r.errore) return 2;
        if (r.gia === true) return 1;
        return r.acceso === false || !!r.nome ? 2 : 1;
      },
      fonte: (a, out) => nomiDiSistema(out, 'wifi'),
      describe: (a) => {
        const r = (a && a._richiestaSistema) || {};
        const nome = (a && a._nomeSistema) || r.nome;
        if (r.elenca) return 'Leggere le reti Wi-Fi che il computer conosce';
        if (r.nome) {
          return `Collegare il computer alla rete Wi-Fi «${nome}».\n\nPer qualche secondo la connessione di adesso cade: scaricamenti e chiamate in corso possono interrompersi.`;
        }
        if (r.acceso === true) return 'Accendere il Wi-Fi';
        if (r.acceso === false) {
          return 'Spegnere il Wi-Fi.\n\nSenza un cavo il computer resta senza rete, e a parole non potrai riaccenderlo: senza rete Filo non ti sente. Si riaccende dal tasto nella home o dal sistema.';
        }
        return 'Cambiare il Wi-Fi del computer';
      },
      describeDone: (a) => {
        const r = (a && a._richiestaSistema) || {};
        const nome = (a && a._nomeSistema) || r.nome;
        if (r.nome) return `Collegato il computer alla rete Wi-Fi «${nome}»`;
        return r.acceso === false ? 'Wi-Fi spento' : r.acceso === true ? 'Wi-Fi acceso' : 'Wi-Fi cambiato';
      },
    },
    // ── zoom della pagina via chat (#686) ────────────────────────────────────
    // Costo 1: è la stessa cosa che fanno Ctrl +/- e Ctrl 0, visibile e
    // reversibile in un tasto.
    // #786 — installare la versione nuova è quello che Filo fa di serie: chiederlo a parole non chiede conferma.
    // #1039 — con una versione già pronta «aggiornati» riavvia Filo, e chiede prima (3: le finestre in incognito si
    // chiudono e non tornano, e «aggiorna» vuol dire anche «ricarica»). `_riavvio` lo scrive il main, mai il modello.
    INSTALLA_AGGIORNAMENTO: {
      costo: (a) => (a && a._riavvio === true ? 3 : 1),
      campo: null,
      describe: (a) => (a && a._riavvio === true
        ? `Riavviare Filo per installare la versione ${a._versione || 'nuova'}.\n\n`
          + (a._conBarra === true ? 'Ci vuole una decina di secondi, con la barra di avanzamento; poi ' : 'Ci vuole qualche secondo; poi ')
          + 'Filo si riapre da solo con le schede di adesso. Le finestre in incognito si chiudono.'
        : 'Cercare la versione nuova di Filo e scaricarla'),
    },
    ZOOM_PAGINA: {
      costo: 1,
      campo: null,
      describe: (a) => {
        const Z = global.SN_ZOOM;
        const perc = Z ? Z.leggiPercentuale(a && (a.percentuale ?? a.percent ?? a.valore)) : null;
        if (perc != null) return `Portare lo zoom della pagina al ${Math.round(perc)}%`;
        const verso = String((a && (a.verso ?? a.direzione ?? a.direction)) || '').trim().toLowerCase();
        if (verso === 'in') return 'Ingrandire la pagina di un passo';
        if (verso === 'out') return 'Rimpicciolire la pagina di un passo';
        if (verso === 'reset') return 'Riportare la pagina alla dimensione reale (100%)';
        return 'Cambiare lo zoom della pagina';
      },
    },
  };

  function voce(action) {
    if (!action || typeof action !== 'object') return null;
    return REGISTRY[String(action.type || '').toUpperCase()] || null;
  }
  function valore(v, action, ctx) { return typeof v === 'function' ? v(action, ctx) : v; }

  // Costo 0-3, oppure null se l'azione non è registrata o non dichiara un costo valido (il dispatch la rifiuta).
  function costoFor(action) {
    const entry = voce(action);
    if (!entry) return null;
    let c = null;
    try { c = valore(entry.costo, action); } catch (_) { c = null; }
    return Number.isInteger(c) && c >= 0 && c <= 3 ? c : null;
  }

  function campoFor(action) {
    const entry = voce(action);
    const c = entry ? valore(entry.campo, action) : null;
    return typeof c === 'string' && c ? c : null;
  }

  // Cosa un'azione già fatta ha portato nel compito (la sua uscita `_output`): una fonte con la sua classe,
  // o null se non ha letto niente di nuovo. Lo stato del compito si calcola da qui, mai dal modello.
  // Testo venuto da fuori che un'azione riporta dal filo (#868: un esito di comando dato in chat, il nome di un file
  // scaricato), da un ricordo, una ricerca o la finestra: sporca il compito come la lettura che era.
  function fonteDaFuori(out) {
    const l = Array.isArray(out.daFuori) ? out.daFuori.filter((x) => x && String(x.testo || '').trim()) : [];
    if (!l.length) return null;
    const comando = (global.SN_FILO_CONTESTO && global.SN_FILO_CONTESTO.ESTERNO_COMANDO) || "dall'output di un comando";
    return l.every((x) => x.fonte === comando)
      ? { classe: 4, campo: 'terminale', chiave: 'terminale:uscita', motivo: 'ho letto l\'uscita di un comando' }
      : { classe: 5, campo: 'web', chiave: 'filo:da-fuori', motivo: 'ho letto un testo arrivato da fuori' };
  }

  function fonteDi(action) {
    const entry = voce(action);
    const out = action && action._output;
    if (!out || typeof out !== 'object') return null;
    let f = null;
    if (entry && typeof entry.fonte === 'function') { try { f = entry.fonte(action, out) || null; } catch (_) { f = null; } }
    const g = fonteDaFuori(out);
    return g && (!f || g.classe > f.classe) ? g : f;
  }

  // Gli ingressi del dispatch per SN_AUTONOMIA. `ctx.richiesta` = cosa ha scritto l'utente nel compito,
  // `ctx.impostazioni` = le impostazioni correnti (per sapere se una preferenza abbassa una difesa).
  function ingressi(action, ctx = {}) {
    const entry = voce(action);
    const costo = costoFor(action);
    if (!entry || costo == null) return null;
    let elenco = '';
    let segreto = '';
    try { elenco = String(valore(entry.elenco, action, ctx) || ''); } catch (_) { elenco = ''; }
    const A = global.SN_AUTONOMIA;
    if (!elenco && typeof entry.uscita === 'function' && A) {
      try { segreto = A.segreto(entry.uscita(action), { richiesta: ctx.richiesta || '' }); } catch (_) { segreto = ''; }
      if (segreto) elenco = 'segreto';
    }
    let difesa = false;
    try { difesa = !!valore(entry.difesa, action, ctx); } catch (_) { difesa = true; }
    let dove = '';
    try { dove = String(valore(entry.dove, action, ctx) || ''); } catch (_) { dove = ''; }
    let dentroPerimetro = true;
    try { dentroPerimetro = typeof entry.perimetro === 'function' ? !!entry.perimetro(action, ctx) : true; } catch (_) { dentroPerimetro = false; }
    return { costo, campo: campoFor(action), elenco, segreto, difesa, dove, dentroPerimetro };
  }

  // Spiegazione in chiaro di cosa Filo sta tentando, per il popup di conferma.
  function describe(action) {
    if (!action || typeof action !== 'object') return '';
    const entry = REGISTRY[String(action.type || '').toUpperCase()];
    if (!entry) return '';
    try { return entry.describe(action) || ''; } catch (_) { return ''; }
  }

  // La stessa cosa a fatto compiuto, per l'esito che torna al modello: dove
  // il registro non distingue («Avviare il timer “pasta”») vale `describe`.
  function describeDone(action) {
    if (!action || typeof action !== 'object') return '';
    const entry = REGISTRY[String(action.type || '').toUpperCase()];
    if (!entry) return '';
    try { return (entry.describeDone ? entry.describeDone(action) : entry.describe(action)) || ''; } catch (_) { return ''; }
  }

  global.SN_ACTION_LEVELS = { REGISTRY, costoFor, campoFor, fonteDi, ingressi, describe, describeDone, spiegazioneComando, stileDellAccoglienza };
})(typeof globalThis !== 'undefined' ? globalThis : self);
