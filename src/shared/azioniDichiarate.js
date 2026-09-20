// #517 — Un'azione RACCONTATA a parole e mai eseguita.
//
// Il caso: il modello chiude il turno scrivendo «Ti ho messo una sveglia alle
// 19:00 per ognuna di quelle notti» senza aver chiamato nessuno strumento. Il
// testo arriva all'utente, la sveglia no, e nessuno se ne accorge: l'utente lo
// scopre la mattina in cui non suona. Il prompt già vieta di dichiarare azioni
// non emesse, ma è una promessa affidata al modello, e finora il fallimento era
// completamente muto.
//
// Qui sta la parte deterministica del presidio: riconoscere, nel testo, la
// DICHIARAZIONE di aver già fatto una cosa che si può fare solo chiamando uno
// strumento, e dire se in questo turno quello strumento è stato chiamato.
// Chi lo usa (handleFiloChat) fa due cose con la risposta: rimanda il turno
// indietro una volta (il modello chiama lo strumento o riscrive la frase) e,
// se la dichiarazione resta senza azione, AVVISA l'utente invece di lasciargli
// credere che sia fatto.
//
// Logica PURA (nessun Electron / IPC): unit-testata in
// tests/unit/azioniDichiarate.test.mjs.
//
// Due scelte, per non gridare al lupo:
//  1. si riconosce solo la PRIMA PERSONA al passato («ho messo», «ti ho
//     aperto»): «la sveglia delle 7 è impostata» è un dato dello STATO, non una
//     rivendicazione, e un participio da solo farebbe scattare il presidio su
//     una constatazione vera;
//  2. una dichiarazione preceduta, nella stessa proposizione, da una negazione o
//     da un'ipotesi («non ho messo…», «se ho aperto la pagina sbagliata…»),
//     o che sta dentro una domanda, non conta.
//
// Un avviso che accusa Filo di non aver fatto una cosa che ha fatto è peggio
// del silenzio: si smette di leggerlo, e il presidio torna muto. Quindi ogni
// famiglia elenca TUTTI i modi che Filo ha davvero di fare quella cosa (aprire
// un programma, per esempio, passa da un comando di shell: non esiste uno
// strumento «apri un programma»), e quello che Filo fa SENZA azioni non ha
// famiglia del tutto: quello che impara lo scrive in memoria un passaggio che
// parte da solo dopo il turno, quindi «l'ho memorizzato» è vero e non si tocca.

(function (global) {
  'use strict';

  // Fine di parola SICURA anche dopo una vocale accentata. `\b` in JavaScript
  // guarda `\w`, che è solo ASCII: dopo la à di «modalità» non c'è nessun
  // confine, e una regola scritta `modalità\b` non può fare match su niente —
  // nasce spenta e nessuno se ne accorge. Una sentinella negli unit test
  // impedisce che ne ricompaia una (tests/unit/azioniDichiarate.test.mjs).
  const FINE = '(?![\\wàèéìíòóùú])';
  const INIZIO = '(?<![\\wàèéìíòóùú])';
  // L'apostrofo si scrive in due modi e il modello usa tutti e due.
  const AP = "['’]";

  // Ogni famiglia: come il modello DICE di aver fatto la cosa (`frasi`), quali
  // azioni la reggono davvero (`tipi`) e cosa va detto all'utente quando la
  // dichiarazione resta senza azione (`avviso`).
  //
  // I `tipi` sono GENEROSI di proposito: basta che nel turno ci sia un'azione
  // plausibilmente collegata perché la frase sia considerata coperta. Un'azione
  // c'è o non c'è; quando c'è, l'utente la vede nel diario del lavoro e può
  // giudicare da sé. Il presidio serve al caso muto: nel turno non c'è NIENTE.
  const FAMIGLIE = [
    {
      id: 'sveglia',
      tipi: ['SVEGLIA', 'MODIFICA_SVEGLIA'],
      avviso: 'la sveglia non c\'è',
      frasi: [
        /\bho (?:messo|impostato|programmato|fissato|creato|aggiunto|piazzato|attivato|settato|puntato)\b[^.!?\n]{0,48}\bsvegli[ae]\b/i,
        /\bfatto[,:!]?\s+(?:la |una )?svegli[ae]\b[^.!?\n]{0,24}\b(?:impostat|programmat|messa|fissat|pronta)/i,
      ],
    },
    {
      id: 'timer',
      tipi: ['TIMER', 'SVEGLIA'],
      avviso: 'il timer non è partito',
      frasi: [
        /\bho (?:avviato|fatto partire|messo|impostato|acceso|creato|lanciato|fatto scattare)\b[^.!?\n]{0,48}\b(?:timer|conto alla rovescia)\b/i,
        /\bfatto[,:!]?\s+(?:il |un )?timer\b[^.!?\n]{0,24}\b(?:avviat|partit|impostat|in corso|acceso)/i,
      ],
    },
    {
      id: 'sveglia-tolta',
      tipi: ['CANCELLA_SVEGLIA', 'MODIFICA_SVEGLIA'],
      avviso: 'la sveglia (o il timer) c\'è ancora',
      frasi: [
        /\bho (?:cancellato|tolto|rimosso|eliminato|annullato|disattivato|spento|levato)\b[^.!?\n]{0,48}\b(?:svegli[ae]|timer)\b/i,
      ],
    },
    {
      id: 'sveglia-spostata',
      tipi: ['MODIFICA_SVEGLIA', 'SVEGLIA', 'CANCELLA_SVEGLIA'],
      avviso: 'la sveglia è rimasta com\'era',
      frasi: [
        /\bho (?:spostato|anticipato|posticipato|cambiato|modificato|rimandato)\b[^.!?\n]{0,48}\b(?:svegli[ae]|timer)\b/i,
      ],
    },
    {
      id: 'appunto',
      tipi: ['SALVA_APPUNTO', 'SALVA_LEZIONE', 'EVENTO_CALENDARIO', 'SVEGLIA', 'TIMER'],
      avviso: 'l\'appunto non c\'è',
      frasi: [
        /\bho (?:salvato|scritto|creato|aggiunto|annotato|preso|buttato giù)\b[^.!?\n]{0,48}\b(?:appunt[oi]|not[ae]|promemoria)\b/i,
        /\bme (?:lo|la|ne) sono (?:segnat|appuntat|annotat)[oa]\b/i,
        new RegExp(`\\b(?:te |ve )?l${AP}ho (?:salvat|scritt|annotat|mess)[oa]\\b[^.!?\\n]{0,32}\\b(?:appunt[oi]|not[ae]|promemoria)\\b`, 'i'),
      ],
    },
    {
      id: 'apertura',
      // Un programma o una cartella si aprono con un comando di shell: senza
      // ESEGUI_COMANDO qui, «ho aperto il blocco note» — fatto davvero —
      // faceva comparire all'utente «non si è aperto niente».
      tipi: ['NAVIGA', 'APRI_FILE', 'COMANDO_FINESTRA', 'ESEGUI_COMANDO', 'LEGGI_DOCUMENTO', 'LEGGI_FILE', 'PROXY_TAB', 'REGOLA_PROXY_DOMINIO'],
      avviso: 'non si è aperto niente',
      frasi: [
        /\bho apert[oa]\b/i,
        new RegExp(`\\bl${AP}ho apert[oa]\\b`, 'i'),
        new RegExp(`\\bte (?:l${AP}|lo |la )ho apert[oa]\\b`, 'i'),
      ],
    },
    {
      id: 'ricerca',
      tipi: ['CERCA_WEB', 'NAVIGA', 'ESEGUI_COMANDO', 'LEGGI_DOCUMENTO', 'CAPACITA_DETTAGLIO'],
      avviso: 'la ricerca non è partita',
      frasi: [
        /\bho (?:cercato|guardato|controllato|verificato)\b[^.!?\n]{0,32}\b(?:sul web|su internet|online|in rete|su google)\b/i,
        /\bho fatto una ricerca\b/i,
      ],
    },
    {
      id: 'comando',
      tipi: ['ESEGUI_COMANDO'],
      avviso: 'il comando non è partito',
      frasi: [
        /\bho (?:eseguito|lanciato|fatto girare|avviato)\b[^.!?\n]{0,32}\bcomand[oi]\b/i,
        /\bcomando (?:eseguito|lanciato)\b/i,
      ],
    },
    {
      id: 'lettura',
      // CONTESTO_FILE non è uno strumento: è il segno che in questo turno il
      // modello aveva già in mano i riassunti dei file dell'editor. Con quelli
      // davanti, «ho letto il file della bolletta» è vero senza nessuna azione.
      tipi: ['LEGGI_DOCUMENTO', 'LEGGI_FILE', 'LEGGI_TRASPARENZA', 'ESEGUI_COMANDO', 'CERCA_WEB', 'CONTESTO_FILE'],
      avviso: 'il documento non l\'ha letto',
      frasi: [
        /\bho lett[oa]\b[^.!?\n]{0,48}\b(?:documento|file|pdf|bolletta|contratto|estratto conto|fattura|appunto)\b/i,
      ],
    },
    {
      id: 'impostazione',
      tipi: ['IMPOSTA_PREFERENZA', 'IMPOSTA_ESTETICA', 'COMANDO_FINESTRA', 'STILE_PAGINA', 'RIPRISTINA_STILE_PAGINA'],
      avviso: 'l\'impostazione è rimasta com\'era',
      frasi: [
        new RegExp('\\bho (?:impostato|attivato|disattivato|acceso|spento|cambiato|modificato|applicato|messo)\\b[^.!?\\n]{0,48}'
          + `\\b(?:tema|impostazione|preferenza|modalità|opzione|carattere|font|zoom|limite di spesa|colore|sfondo)${FINE}`, 'i'),
      ],
    },
    {
      id: 'segnalazione',
      tipi: ['INVIA_FEEDBACK'],
      avviso: 'la segnalazione non è partita',
      frasi: [
        /\bho (?:inviato|mandato|spedito|girato)\b[^.!?\n]{0,32}\b(?:segnalazione|feedback)\b/i,
        /\bho segnalato\b[^.!?\n]{0,32}\b(?:agli sviluppatori|al team|a chi sviluppa)\b/i,
      ],
    },
    {
      id: 'calendario',
      tipi: ['EVENTO_CALENDARIO', 'SVEGLIA'],
      avviso: 'l\'evento non è in calendario',
      frasi: [
        /\bho (?:aggiunto|messo|creato|segnato|inserito)\b[^.!?\n]{0,32}\b(?:in calendario|nel calendario|l'evento|un evento)\b/i,
      ],
    },
    {
      id: 'schede',
      tipi: ['PULISCI_TAB', 'CANCELLA_ARCHIVIO'],
      avviso: 'le schede sono rimaste com\'erano',
      frasi: [
        /\bho (?:archiviato|chiuso|ripulito|eliminato|cancellato)\b[^.!?\n]{0,32}\b(?:le schede|le tab|dall'archivio|la cronologia)\b/i,
      ],
    },
    {
      id: 'memoria-cancellata',
      tipi: ['CANCELLA_MEMORIA'],
      avviso: 'la memoria è ancora lì',
      frasi: [
        /\bho (?:cancellato|azzerato|eliminato|resettato|svuotato)\b[^.!?\n]{0,32}\b(?:la memoria|le memorie|il profilo|tutto quello che sapevo)\b/i,
      ],
    },
    {
      id: 'proxy',
      tipi: ['PROXY_TAB', 'REGOLA_PROXY_DOMINIO', 'RIMUOVI_PROXY', 'RIMUOVI_PROXY_TUTTE', 'RIMUOVI_REGOLA_PROXY'],
      avviso: 'il proxy è rimasto com\'era',
      frasi: [
        /\bho (?:messo|attivato|applicato|tolto|rimosso|disattivato)\b[^.!?\n]{0,32}\bil proxy\b/i,
        /\bho instradato\b/i,
      ],
    },
  ];

  // Negazioni e ipotesi: se stanno nella stessa proposizione, PRIMA della
  // dichiarazione, non c'è nessuna rivendicazione da verificare.
  const SMENTITE = /\b(?:non|senza|nessun\w*|mai|invece|prima|se|quando|appena|vuoi|vorresti|posso|potrei|dovrei|devo|volevo|avrei|potevo)\b/i;
  // Dove finisce la proposizione che precede un punto del testo.
  const STACCHI = /[.!?;:,\n—]|\b(?:ma|però|mentre|quindi|così|perché|siccome)\b/gi;

  function proposizionePrima(testo, indice) {
    const prima = testo.slice(0, indice);
    let taglio = -1;
    STACCHI.lastIndex = 0;
    let m;
    while ((m = STACCHI.exec(prima))) taglio = m.index + m[0].length - 1;
    return prima.slice(taglio + 1);
  }

  // La dichiarazione è dentro una domanda? («Ho aperto la pagina giusta?»)
  function dentroUnaDomanda(testo, indice) {
    const dopo = testo.slice(indice);
    const fine = dopo.search(/[.!?\n]/);
    return fine >= 0 && dopo[fine] === '?';
  }

  // La prima dichiarazione VALIDA di una famiglia, o null. Ritorna la frase
  // così com'è scritta (serve sia al modello, per sapere cosa rimangiarsi, sia
  // all'utente): tagliata a 160 caratteri, che è già una frase lunga.
  function dichiarazione(testo, famiglia) {
    for (const re of famiglia.frasi) {
      const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
      let m;
      while ((m = rx.exec(testo))) {
        if (!m[0]) { rx.lastIndex += 1; continue; }
        if (SMENTITE.test(proposizionePrima(testo, m.index))) continue;
        if (dentroUnaDomanda(testo, m.index)) continue;
        return frasePiena(testo, m.index, m.index + m[0].length);
      }
    }
    return null;
  }

  // Dalla dichiarazione alla frase intera in cui sta: «ho messo» da solo non
  // dice niente, «Ti ho messo una sveglia alle 19:00» sì.
  function frasePiena(testo, da, a) {
    const prima = testo.slice(0, da);
    const inizio = Math.max(
      prima.lastIndexOf('.'), prima.lastIndexOf('!'), prima.lastIndexOf('?'), prima.lastIndexOf('\n'),
    ) + 1;
    const dopo = testo.slice(a);
    const fine = dopo.search(/[.!?\n]/);
    const frase = testo.slice(inizio, fine >= 0 ? a + fine + 1 : testo.length).trim();
    return frase.length > 160 ? `${frase.slice(0, 157)}…` : frase;
  }

  function insiemeDiTipi(azioni) {
    const out = new Set();
    for (const a of (Array.isArray(azioni) ? azioni : [])) {
      const t = String((a && (a.type || a.tipo)) || '').toUpperCase();
      if (t) out.add(t);
    }
    return out;
  }

  // I tipi di azione già usciti nei turni PRECEDENTI della conversazione: se la
  // sveglia l'aveva messa due messaggi fa, «sì, te l'ho messa alle 7» è vero.
  function tipiDallaCronologia(cronologia) {
    const out = new Set();
    for (const m of (Array.isArray(cronologia) ? cronologia : [])) {
      if (!m || m.role !== 'filo') continue;
      for (const t of insiemeDiTipi(m.actions)) out.add(t);
    }
    return out;
  }

  // rileva(testo, azioni | Set di tipi) → [{ id, avviso, tipi, frase }]
  // Una voce per famiglia dichiarata e non retta da nessuna azione.
  function rileva(testo, azioni) {
    const t = String(testo || '');
    if (!t.trim()) return [];
    const presenti = (azioni instanceof Set) ? azioni : insiemeDiTipi(azioni);
    const out = [];
    for (const fam of FAMIGLIE) {
      if (fam.tipi.some((x) => presenti.has(x))) continue;
      const frase = dichiarazione(t, fam);
      if (frase) out.push({ id: fam.id, avviso: fam.avviso, tipi: fam.tipi.slice(), frase });
    }
    return out;
  }

  // Il testo non è una risposta in prosa ma il formato macchina (il JSON del
  // vecchio protocollo, o il nome di uno strumento con i suoi argomenti): quello
  // che arriva in chat non è una risposta, e le azioni che conteneva non sono
  // partite. Si riconosce solo quando NESSUNO strumento è stato chiamato e il
  // recupero del formato vecchio ha già fallito: lì è un turno buttato.
  function formatoSospetto(testo) {
    const t = String(testo || '').trim().replace(/^```(?:json)?\s*/i, '');
    if (!t) return false;
    if (/^\{[\s\S]*$/.test(t) && /"(?:text|actions|type)"\s*:/.test(t)) return true;
    if (/"actions"\s*:\s*\[/.test(t)) return true;
    if (/^[A-Z][A-Z_]{3,}\s*(?:\{|\()/.test(t)) return true;
    return false;
  }

  // La spinta che torna al modello quando la risposta dichiara un'azione mai
  // chiamata. Non la vede l'utente: è un messaggio di sistema dentro il turno.
  function spintaAzioniMancanti(fantasmi) {
    const righe = (Array.isArray(fantasmi) ? fantasmi : []).map((f) => `- «${f.frase}» (strumenti: ${f.tipi.join(', ')})`);
    return 'La tua risposta dice che hai già fatto questo:\n'
      + `${righe.join('\n')}\n`
      + 'In questo turno però non hai chiamato nessuno strumento che lo faccia: non è successo, '
      + 'e così com\'è la tua risposta dice all\'utente una cosa falsa.\n'
      + 'Adesso fai UNA di queste tre cose:\n'
      + '1. se va fatto ORA, chiama lo strumento giusto e poi rispondi;\n'
      + '2. se l\'avevi già fatto in un turno PRECEDENTE di questa conversazione, NON rifarlo: '
      + 'riscrivi la risposta dicendo che era già fatto;\n'
      + '3. se non si può fare, riscrivi la risposta senza dire che è fatto, e spiega all\'utente cosa manca.\n'
      + 'Non ripetere la risposta di prima uguale: questo messaggio non lo vede l\'utente.';
  }

  // La spinta per una risposta arrivata in formato macchina invece che in prosa.
  function spintaFormato() {
    return 'La tua ultima risposta non è arrivata come testo per l\'utente: sembra il formato interno '
      + '(JSON, o il nome di uno strumento con i suoi argomenti). Scritta così non esegue niente e '
      + 'in chat comparirebbe come un blocco di codice.\n'
      + 'Riprova: le azioni si CHIAMANO come strumenti (tool call), la risposta per l\'utente è prosa '
      + 'e basta, senza JSON. Se le azioni ti servono, chiamale adesso.';
  }

  // La riga che l'utente legge sotto la risposta quando la dichiarazione è
  // rimasta senza azione anche dopo il ritentativo.
  function avvisoPerUtente(fantasmi) {
    const lista = (Array.isArray(fantasmi) ? fantasmi : []).map((f) => f.avviso).filter(Boolean);
    if (!lista.length) return '';
    const cose = lista.length === 1
      ? lista[0]
      : `${lista.slice(0, -1).join(', ')} e ${lista[lista.length - 1]}`;
    return `Filo ha scritto di averlo già fatto, ma non l'ha fatto: ${cose}. Se ti serve, chiediglielo di nuovo.`;
  }

  global.SN_AZIONI_DICHIARATE = {
    FAMIGLIE,
    rileva,
    insiemeDiTipi,
    tipiDallaCronologia,
    formatoSospetto,
    spintaAzioniMancanti,
    spintaFormato,
    avvisoPerUtente,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
