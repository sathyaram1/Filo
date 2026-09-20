// Il compito come oggetto del motore: cosa ha letto, cosa gli è permesso fare (#533).
// Regola unica: le USCITE si dichiarano prima di leggere roba scritta da altri.
// Logica pura e serializzabile; chi la applica è executeFiloAction.

(function (global) {
  'use strict';

  // Quanto ci si può fidare di ciò che è entrato nel contesto. Numeri perché
  // di un compito conta la fonte PEGGIORE letta, non l'ultima.
  const FONTI = { filo: 0, utente: 1, esterno: 2 };
  const FONTE_PEGGIORE = 'esterno';

  // Le famiglie di uscita: è questo che un compito dichiara, non il nome dello
  // strumento. L'etichetta la legge l'utente nel popup, quindi è una frase sua.
  const USCITE = {
    sveglie: { label: 'mettere e togliere sveglie e timer' },
    appunti: { label: 'scrivere appunti' },
    memoria: { label: 'scrivere nella memoria di Filo' },
    // Cancellare tutta la memoria non è «scrivere nella memoria»: chi legge
    // «scrivere» e dice sì non sta concedendo di buttare via il profilo di
    // anni (#533, secondo giro di verifica). Famiglia sua, frase sua.
    oblio: { label: 'cancellare tutta la memoria di Filo' },
    schede: { label: 'aprire, archiviare o eliminare schede' },
    impostazioni: { label: 'cambiare le impostazioni di Filo' },
    aspetto: { label: 'cambiare l’aspetto di Filo o della pagina' },
    rete: { label: 'cambiare da quale paese si naviga' },
    terminale: { label: 'eseguire comandi sul computer' },
    segnalazioni: { label: 'inviare segnalazioni agli sviluppatori' },
    // Fuori dall'elenco che il modello può dichiarare: la contabilità
    // dell'intervista di benvenuto la apre Filo, non una richiesta dell'utente.
    accoglienza: { label: 'tenere il conto dell’intervista di benvenuto', interna: true },
  };

  const USCITE_DICHIARABILI = Object.keys(USCITE).filter((k) => !USCITE[k].interna);

  // Classe di ogni strumento. `ingresso` e `proposta` non si dichiarano mai:
  // leggere di più non aggiunge pericolo a un compito già contaminato, e
  // proporre in chat costa zero perché a premere il bottone è l'utente.
  const CLASSI = {
    CERCA_WEB: { classe: 'ingresso', fonte: 'esterno' },
    LEGGI_DOCUMENTO: { classe: 'ingresso', fonte: 'esterno' },
    LEGGI_FILE: { classe: 'ingresso', fonte: 'utente' },
    LEGGI_SCHEDE: { classe: 'ingresso', fonte: 'esterno' },
    LEGGI_TRASPARENZA: { classe: 'ingresso', fonte: 'filo' },
    CAPACITA_DETTAGLIO: { classe: 'ingresso', fonte: 'filo' },

    EVENTO_CALENDARIO: { classe: 'proposta' },
    APRI_FILE: { classe: 'proposta' },

    DICHIARA_USCITE: { classe: 'motore' },
    CHIEDI_USCITA: { classe: 'motore' },

    TIMER: { classe: 'uscita', uscita: 'sveglie' },
    SVEGLIA: { classe: 'uscita', uscita: 'sveglie' },
    CANCELLA_SVEGLIA: { classe: 'uscita', uscita: 'sveglie' },
    MODIFICA_SVEGLIA: { classe: 'uscita', uscita: 'sveglie' },
    SALVA_APPUNTO: { classe: 'uscita', uscita: 'appunti' },
    // Una LEZIONE non è un contenuto: è una regola su come Filo deve
    // comportarsi d'ora in poi, che entra in ogni conversazione futura come
    // roba dell'utente e che la compattazione porta dentro il suo profilo per
    // sempre. Una regola ricavata da testo scritto da altri è l'attacco, non
    // un caso d'uso: nessun permesso la rende buona, nemmeno un sì dell'utente
    // (#533, quarto giro di verifica). Quindi da un compito che ha letto roba
    // esterna questo strumento non esiste, punto; il contenuto trovato
    // leggendo si salva con SALVA_APPUNTO, che ha la sua cura.
    SALVA_LEZIONE: { classe: 'uscita', uscita: 'memoria', maiDaEsterno: true },
    CANCELLA_MEMORIA: { classe: 'uscita', uscita: 'oblio' },
    NAVIGA: { classe: 'uscita', uscita: 'schede' },
    PULISCI_TAB: { classe: 'uscita', uscita: 'schede' },
    CANCELLA_ARCHIVIO: { classe: 'uscita', uscita: 'schede' },
    IMPOSTA_PREFERENZA: { classe: 'uscita', uscita: 'impostazioni' },
    IMPOSTA_ESTETICA: { classe: 'uscita', uscita: 'aspetto' },
    STILE_PAGINA: { classe: 'uscita', uscita: 'aspetto' },
    RIPRISTINA_STILE_PAGINA: { classe: 'uscita', uscita: 'aspetto' },
    COMANDO_FINESTRA: { classe: 'uscita', uscita: 'aspetto' },
    PROXY_TAB: { classe: 'uscita', uscita: 'rete' },
    RIMUOVI_PROXY: { classe: 'uscita', uscita: 'rete' },
    RIMUOVI_PROXY_TUTTE: { classe: 'uscita', uscita: 'rete' },
    REGOLA_PROXY_DOMINIO: { classe: 'uscita', uscita: 'rete' },
    RIMUOVI_REGOLA_PROXY: { classe: 'uscita', uscita: 'rete' },
    // Un comando è un'uscita, ma quello che STAMPA torna dentro al contesto:
    // il contenuto di un file scaricato, la risposta di un sito. È testo
    // scritto da altri come una pagina web, e da lì in poi il perimetro deve
    // mordere (#533, secondo giro di verifica). `ritorna` dice proprio questo:
    // l'azione riporta indietro roba di quella classe.
    ESEGUI_COMANDO: { classe: 'uscita', uscita: 'terminale', ritorna: 'esterno' },
    INVIA_FEEDBACK: { classe: 'uscita', uscita: 'segnalazioni' },
    ONBOARDING: { classe: 'uscita', uscita: 'accoglienza' },
  };

  // Il registro non si tiene corto da solo: un compito lungo lascia tutte le
  // sue righe, e quando davvero esagera il conto delle omesse resta scritto.
  const MAX_RIGHE = 500;

  function normType(type) {
    return String(type || '').trim().toUpperCase();
  }

  // Strumento senza classe → trattato come uscita di una famiglia che nessuno
  // può dichiarare: un potere nuovo non passa per dimenticanza. La sentinella
  // in tests/unit/ lo fa vedere a chi scrive, non all'utente.
  function classeDi(type) {
    const t = normType(type);
    return CLASSI[t] || { classe: 'uscita', uscita: `sconosciuta:${t || '?'}` };
  }

  function uscitaDi(type) {
    const c = classeDi(type);
    return c.classe === 'uscita' ? c.uscita : null;
  }

  // Un'uscita interna non l'ha autorizzata l'utente: è contabilità di Filo, e
  // in un elenco di permessi si legge come una cosa che lui ha concesso.
  function uscitaInterna(uscita) {
    const u = USCITE[String(uscita || '')];
    return !!(u && u.interna);
  }

  // La richiesta così come l'ha scritta l'utente, su una riga sola e corta:
  // serve a riconoscere una riga fra le altre, non a rileggere la chat.
  const MAX_RICHIESTA = 120;
  function etichettaRichiesta(testo) {
    const t = String(testo == null ? '' : testo)
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return '';
    return t.length > MAX_RICHIESTA ? `${t.slice(0, MAX_RICHIESTA - 1)}…` : t;
  }

  function etichettaUscita(uscita) {
    const u = USCITE[String(uscita || '')];
    return u ? u.label : `un’azione che Filo non sa descrivere (${uscita})`;
  }

  /**
   * `dichiarazione` dice chi fissa il perimetro: 'modello' dove il modello ha un
   * passo di dichiarazione e può chiedere di allargare, 'fissa' dove il
   * perimetro lo scrive la superficie (l'assistente di pagina) e a chiedere per
   * conto suo è il motore.
   */
  function nuovo({ id, origine = 'chat', dichiarazione = 'modello', perimetro = null, sempre = null, livello, richiesta = '' } = {}) {
    const dich = dichiarazione === 'fissa' ? 'fissa' : 'modello';
    const fissato = dich === 'fissa';
    return {
      id: String(id || `c${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
      origine: String(origine) === 'automazione' ? 'automazione' : 'chat',
      // Com'era scritta la richiesta: senza, il registro è una fila di righe
      // identiche e «cosa poteva fare in ciascuna» non ha un «ciascuna».
      richiesta: etichettaRichiesta(richiesta),
      dichiarazione: dich,
      livello: livello || null,
      perimetro: Array.isArray(perimetro) ? perimetro.filter((u) => u in USCITE) : (fissato ? [] : null),
      // Uscite che il compito ha per NASCITA, dall'autorità che l'ha aperto e
      // non dalla richiesta: restano anche se il modello non dichiara nulla.
      sempre: (Array.isArray(sempre) ? sempre : []).filter((u) => u in USCITE),
      dichiarato: fissato || Array.isArray(perimetro),
      fonte: 'filo',
      contaminato: false,
      allargamenti: [],
      registro: [],
      omesse: 0,
    };
  }

  /**
   * Il compito del messaggio DOPO, nella stessa conversazione. Se quello prima
   * aveva letto roba scritta da altri, quel testo è ancora davanti al modello
   * (Filo l'ha riportato nella sua risposta, che resta in chat): ricominciare a
   * mani libere vorrebbe dire che basta un messaggio qualunque dell'utente per
   * riavere tutto. Il nuovo compito eredita la contaminazione e le uscite che
   * la richiesta di partenza aveva DICHIARATO, non i permessi che l'utente
   * aveva concesso uno per uno: quelli valevano per quella richiesta, e per
   * riaverli si ripassa da lui.
   * Se il compito prima era pulito, questo nasce pulito: niente cambia.
   */
  function erede(prec, { richiesta = '', sempre = null, livello } = {}) {
    const fresco = nuovo({ origine: (prec && prec.origine) || 'chat', richiesta, sempre, livello });
    if (!prec || !prec.contaminato) return fresco;
    fresco.contaminato = true;
    fresco.fonte = prec.fonte || FONTE_PEGGIORE;
    // SOLO il perimetro dichiarato, non i permessi che l'utente aveva dato:
    // quel sì valeva per quella richiesta, e questa è un'altra (#533, secondo
    // giro di verifica). Se al modello serve ancora, lo richiede.
    fresco.perimetro = Array.isArray(prec.perimetro) ? prec.perimetro.slice() : [];
    fresco.dichiarato = true;
    fresco.ereditato = true;
    scrivi(fresco, { tipo: 'eredita', da: prec.id, uscite: fresco.perimetro.slice() });
    return fresco;
  }

  function scrivi(c, riga) {
    if (!c) return;
    if (c.registro.length >= MAX_RIGHE) { c.omesse += 1; return; }
    c.registro.push({ ts: Date.now(), ...riga });
  }

  // Dichiarare DOPO aver letto materiale esterno non vale: a quel punto
  // l'elenco potrebbe essere stato suggerito proprio da chi ha scritto la
  // pagina. Un compito che non dichiara e poi legge resta a mani vuote.
  function dichiara(c, uscite) {
    if (!c) return { ok: false, motivo: 'nessun-compito' };
    if (c.contaminato) {
      scrivi(c, { tipo: 'dichiarazione-tardiva', uscite: [] });
      return { ok: false, motivo: 'tardiva', perimetro: c.perimetro || [] };
    }
    if (c.dichiarato) return { ok: false, motivo: 'gia-dichiarato', perimetro: c.perimetro || [] };
    const richieste = Array.isArray(uscite) ? uscite.map((u) => String(u || '').trim()) : [];
    const buone = richieste.filter((u) => USCITE_DICHIARABILI.includes(u));
    const ignorate = richieste.filter((u) => !USCITE_DICHIARABILI.includes(u));
    c.perimetro = Array.from(new Set(buone));
    c.dichiarato = true;
    scrivi(c, { tipo: 'dichiarazione', uscite: c.perimetro.slice(), ignorate });
    return { ok: true, perimetro: c.perimetro.slice(), ignorate };
  }

  // Il perimetro si allarga di UNA uscita e solo per QUESTO compito: è la
  // risposta a un sì dell'utente, non una preferenza che resta. Il sì sta in
  // `allargamenti`, non nel perimetro dichiarato: così il messaggio dopo
  // eredita quello che la richiesta di partenza comportava e NON il permesso
  // che l'utente aveva dato una volta sola (#533, secondo giro di verifica).
  function allarga(c, uscita, motivo) {
    if (!c) return { ok: false, motivo: 'nessun-compito' };
    const u = String(uscita || '').trim();
    if (!(u in USCITE)) return { ok: false, motivo: 'sconosciuta' };
    if (!Array.isArray(c.perimetro)) c.perimetro = [];
    c.dichiarato = true;
    if (!c.allargamenti.some((a) => a.uscita === u)) {
      c.allargamenti.push({ uscita: u, motivo: String(motivo || '') });
    }
    scrivi(c, { tipo: 'allargamento', uscita: u, motivo: String(motivo || '') });
    return { ok: true, perimetro: usciteVive(c) };
  }

  // Tutto ciò che questo compito può fare adesso: quello che ha dichiarato,
  // quello che ha per nascita, e i sì che l'utente gli ha dato durante.
  function usciteVive(c) {
    if (!c) return [];
    const perimetro = Array.isArray(c.perimetro) ? c.perimetro : [];
    const sempre = Array.isArray(c.sempre) ? c.sempre : [];
    const concessi = (Array.isArray(c.allargamenti) ? c.allargamenti : []).map((a) => a.uscita);
    return Array.from(new Set([...perimetro, ...sempre, ...concessi]));
  }

  function registraLettura(c, { type, fonte, dettaglio } = {}) {
    if (!c) return;
    const f = fonte && (fonte in FONTI) ? fonte : classeDi(type).fonte || 'esterno';
    if (FONTI[f] > FONTI[c.fonte]) c.fonte = f;
    if (f === FONTE_PEGGIORE && !c.contaminato) {
      c.contaminato = true;
      // Chi non ha dichiarato niente prima di leggere resta con «solo chat»:
      // rispondere e proporre, nient'altro.
      if (!c.dichiarato) { c.perimetro = []; c.dichiarato = true; }
    }
    scrivi(c, { tipo: 'lettura', azione: normType(type), fonte: f, dettaglio: dettaglio || '' });
  }

  function registraAzione(c, { type, esito, uscita } = {}) {
    scrivi(c, { tipo: 'azione', azione: normType(type), esito: String(esito || ''), uscita: uscita || uscitaDi(type) });
  }

  /**
   * Il verdetto del motore su una singola azione. `ok:false` con
   * `motivo:'fuori-perimetro'` è la sola porta da cui si passa all'allargamento.
   */
  function consentito(c, type) {
    const t = normType(type);
    const k = classeDi(t);
    if (k.classe !== 'uscita') return { ok: true, classe: k.classe };
    // Finché niente di esterno è entrato nel contesto, l'unica autorità in
    // gioco è l'utente che ha scritto: il perimetro non serve ancora.
    if (!c || !c.contaminato) return { ok: true, classe: 'uscita', uscita: k.uscita };
    // Uscite che da un compito contaminato non si ottengono per nessuna
    // strada: né dichiarandole prima, né chiedendole all'utente durante.
    // `secco` dice a chi applica di rifiutare e basta, senza popup.
    if (k.maiDaEsterno) {
      return {
        ok: false,
        motivo: 'mai-da-esterno',
        secco: true,
        classe: 'uscita',
        uscita: k.uscita,
        etichetta: etichettaUscita(k.uscita),
        puoChiedere: false,
      };
    }
    if (usciteVive(c).includes(k.uscita)) {
      return { ok: true, classe: 'uscita', uscita: k.uscita };
    }
    return {
      ok: false,
      motivo: 'fuori-perimetro',
      classe: 'uscita',
      uscita: k.uscita,
      etichetta: etichettaUscita(k.uscita),
      puoChiedere: c.dichiarazione === 'modello',
    };
  }

  // L'elenco che il motore accetta, non un consiglio scritto nel prompt: ciò
  // che non è qui dentro il modello non lo vede proprio.
  function strumentiPermessi(c, nomi) {
    const tutti = Array.isArray(nomi) ? nomi : Object.keys(CLASSI);
    if (!c || !c.contaminato) return tutti.filter((n) => classeDi(n).classe !== 'motore' || n === 'DICHIARA_USCITE');
    return tutti.filter((n) => {
      const t = normType(n);
      if (t === 'DICHIARA_USCITE') return false; // dopo la prima lettura è tardi
      if (t === 'CHIEDI_USCITA') return c.dichiarazione === 'modello';
      return consentito(c, t).ok;
    });
  }

  // Cosa ha letto e cosa gli è stato rifiutato, ricavati dal registro: la
  // pagina Sicurezza deve poter dire non solo cosa era permesso, ma anche
  // perché quel compito era limitato e cosa si è fermato (#533, secondo giro
  // di verifica). Nomi di strumenti, non frasi: le frasi le fa chi mostra.
  function letture(c) {
    if (!c || !Array.isArray(c.registro)) return [];
    return Array.from(new Set(c.registro.filter((r) => r.tipo === 'lettura').map((r) => r.azione)));
  }
  function rifiutate(c) {
    if (!c || !Array.isArray(c.registro)) return [];
    return Array.from(new Set(c.registro
      .filter((r) => r.tipo === 'azione' && String(r.esito || '').startsWith('rifiutata'))
      .map((r) => r.azione)));
  }

  function riassunto(c) {
    if (!c) return null;
    return {
      id: c.id,
      origine: c.origine,
      richiesta: c.richiesta || '',
      dichiarazione: c.dichiarazione,
      perimetro: Array.isArray(c.perimetro) ? c.perimetro.slice() : null,
      uscite: usciteVive(c),
      sempre: c.sempre.slice(),
      dichiarato: !!c.dichiarato,
      contaminato: !!c.contaminato,
      ereditato: !!c.ereditato,
      fonte: c.fonte,
      allargamenti: c.allargamenti.slice(),
      letture: letture(c),
      rifiutate: rifiutate(c),
      registro: c.registro.slice(),
      omesse: c.omesse,
    };
  }

  global.SN_COMPITI = {
    FONTI, USCITE, USCITE_DICHIARABILI, CLASSI, MAX_RIGHE,
    classeDi, uscitaDi, etichettaUscita, uscitaInterna, etichettaRichiesta, MAX_RICHIESTA, usciteVive,
    nuovo, erede, dichiara, allarga, registraLettura, registraAzione, letture, rifiutate,
    consentito, strumentiPermessi, riassunto,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
