// SINGOLA SORGENTE del "manifesto delle capacità" di Filo: l'elenco curato di
// TUTTO ciò che Filo sa fare, visibile all'utente. Serve all'agente dentro
// Filo per rispondere con verità a "puoi fare X?" e per riconoscere "non posso
// fare Y" (vedi TASKS.md → F1/F2/F4), e come base per il feedback autonomo.
//
// Pattern: IIFE su globalThis come patchNotes.js. Caricato dal loader
// (src/main/services/loader.js) e disponibile come globalThis.SN_CAPABILITIES.
//
// REGOLA DI SINCRONIZZAZIONE (anti-stale, come "Patch notes"): ogni volta che
// aggiungi/modifichi/rimuovi una capacità VISIBILE all'utente, aggiorna QUI la
// voce corrispondente. Una voce che mente (descrive una feature che non c'è più,
// o ne manca una nuova) è peggio che assente: l'agente prometterebbe il falso.
//
// Formato di una voce:
//   {
//     id:       'kebab-case-stabile',   // identificatore stabile (non cambiarlo)
//     title:    'Titolo per l’utente',  // breve, in italiano
//     category: 'una di CATEGORIES',
//     desc:     'Cosa fa, in termini utente. Niente nomi di file/funzioni.',
//     invoke:   'Come si attiva (shortcut / voce di menu / pagina).',
//     doesNot:  'Confine: cosa NON fa (opzionale, ma prezioso per F4).',
//   }
//
// `desc`/`invoke`/`doesNot` sono per l'utente finale, non tecnici.

(function (global) {
  'use strict';

  // Categorie: l'indice compatto (vedi index()) le usa per il raggruppamento.
  const CATEGORIES = {
    navigation: 'Navigazione e schede',
    selection: 'Azioni sul testo selezionato',
    writing: 'Scrittura e correzione',
    reading: 'Lettura e traduzione',
    media: 'Immagini e cattura schermo',
    links: 'Link',
    clipboard: 'Appunti',
    save: 'Salva per dopo e archivio',
    assistant: 'Assistente e agente di pagina',
    pages: 'Pagine interne',
    settings: 'Impostazioni',
    credits: 'Crediti',
  };

  const CAPABILITIES = [
    // ─────────────────────────── Navigazione e schede ───────────────────────
    {
      id: 'new-tab', title: 'Apri una nuova scheda', category: 'navigation',
      desc: 'Apre una nuova scheda sulla home di Filo.',
      invoke: 'Pulsante "+" nella barra delle schede, oppure dal menu del tasto destro → "Nuova scheda".',
    },
    {
      id: 'close-tab', title: 'Chiudi la scheda', category: 'navigation',
      desc: 'Chiude la scheda corrente; la pagina chiusa finisce nell’archivio, da cui puoi riaprirla.',
      invoke: 'Pulsante di chiusura sulla scheda, oppure menu del tasto destro → "Chiudi pagina".',
      doesNot: 'Le finestre in incognito e le pagine interne di Filo non vengono archiviate.',
    },
    {
      id: 'navigate-back-forward', title: 'Indietro / Avanti', category: 'navigation',
      desc: 'Torna alla pagina precedente o va a quella successiva nella cronologia della scheda.',
      invoke: 'Frecce nella barra in alto, oppure menu del tasto destro → "Indietro" / "Avanti".',
    },
    {
      id: 'reload', title: 'Ricarica la pagina', category: 'navigation',
      desc: 'Ricarica la pagina corrente.',
      invoke: 'Pulsante di ricarica nella barra in alto, oppure menu del tasto destro → "Ricarica".',
    },
    {
      id: 'home', title: 'Vai alla home', category: 'navigation',
      desc: 'Apre la home di Filo nella scheda corrente, con suggerimenti e aggiornamenti.',
      invoke: 'Pulsante Home nella barra, oppure menu del tasto destro → "Home".',
    },
    {
      id: 'address-bar', title: 'Barra degli indirizzi', category: 'navigation',
      desc: 'Digita un indirizzo per navigare, o un termine per cercare sul web.',
      invoke: 'Barra degli indirizzi in alto.',
    },
    {
      id: 'incognito', title: 'Finestra in incognito', category: 'navigation',
      desc: 'Apre una nuova finestra privata e isolata: la sessione è effimera e non viene archiviata.',
      invoke: 'Menu del tasto destro → "Nuova finestra incognito".',
    },
    {
      id: 'fullscreen', title: 'Schermo intero', category: 'navigation',
      desc: 'Nasconde la barra delle schede e degli indirizzi così la pagina occupa tutta la finestra.',
      invoke: 'Menu del tasto destro → "Schermo intero" / "Esci da schermo intero".',
    },
    {
      id: 'auto-archive', title: 'Archiviazione automatica delle schede', category: 'navigation',
      desc: 'Le schede lasciate inattive a lungo vengono archiviate da sole, per tenere pulita la barra.',
      invoke: 'Automatico; soglia e attivazione si regolano in Preferenze.',
      doesNot: 'Non tocca le finestre in incognito né le pagine interne di Filo.',
    },

    // ─────────────────────── Azioni sul testo selezionato ────────────────────
    {
      id: 'explain-selection', title: 'Spiega il testo selezionato', category: 'selection',
      desc: 'Dà una spiegazione del testo che hai selezionato, direttamente sopra la selezione.',
      invoke: 'Seleziona il testo e usa Alt+E, oppure menu del tasto destro → "Spiegazione". "Approfondisci" apre una spiegazione più estesa.',
    },
    {
      id: 'translate-selection', title: 'Traduci il testo selezionato', category: 'selection',
      desc: 'Traduce il testo selezionato e mostra il risultato in un riquadro.',
      invoke: 'Seleziona il testo e usa Alt+T, oppure menu del tasto destro → "Traduci".',
    },
    {
      id: 'edit-selection', title: 'Riscrivi il testo selezionato', category: 'writing',
      desc: 'Riscrive il testo selezionato secondo la tua richiesta e ti propone la nuova versione da sostituire o copiare. Pulsanti rapidi: più formale, più informale, riassumi, traduci, correggi; oppure scrivi un’istruzione libera.',
      invoke: 'In un campo modificabile, seleziona il testo e dal menu del tasto destro scegli "Modifica".',
    },
    {
      id: 'read-aloud', title: 'Leggi ad alta voce', category: 'reading',
      desc: 'Legge ad alta voce il testo selezionato, evidenziando le parole mentre le pronuncia.',
      invoke: 'Seleziona il testo e dal menu del tasto destro scegli "Leggi". Per fermare: "Interrompi lettura" (anche da un’altra scheda).',
      doesNot: 'La voce, la velocità e il tono si regolano in Preferenze.',
    },
    {
      id: 'search-web', title: 'Cerca sul web', category: 'selection',
      desc: 'Cerca sul web il testo che hai selezionato, aprendo i risultati in una nuova scheda.',
      invoke: 'Seleziona il testo e usa la voce di ricerca nel menu del tasto destro.',
    },

    // ─────────────────────── Scrittura e correzione ──────────────────────────
    {
      id: 'spellcheck', title: 'Correttore mentre scrivi', category: 'writing',
      desc: 'Mentre scrivi in un campo di testo, segnala gli errori: zigzag rosso per l’ortografia (suggerimenti del sistema) e zigzag blu per gli errori di contesto rilevati dall’AI.',
      invoke: 'Automatico quando scrivi in un’area di testo; clic destro su una parola segnalata per i suggerimenti.',
      doesNot: 'Il correttore contestuale (blu) lavora su testi né troppo corti né enormi e può essere disattivato.',
    },
    {
      id: 'spellcheck-manage', title: 'Gestisci correttore e dizionario', category: 'writing',
      desc: 'Gestisci le correzioni automatiche (errore → correzione) e il dizionario personale di parole da non segnalare.',
      invoke: 'Pagina filo://spellcheck/spellcheck.html.',
    },
    {
      id: 'editor', title: 'Editor di testo', category: 'writing',
      desc: 'Un editor per scrivere e impaginare testo con moduli a blocchi; il contenuto viene salvato da solo.',
      invoke: 'Menu del tasto destro → "Editor", oppure filo://editor/editor.html.',
    },

    // ─────────────────────── Lettura e traduzione ───────────────────────────
    {
      id: 'translate-page', title: 'Traduci l’intera pagina', category: 'reading',
      desc: 'Traduce tutto il testo della pagina mantenendo impaginazione, link e immagini; puoi tornare all’originale.',
      invoke: 'Menu del tasto destro → "Traduci la pagina" / "Mostra originale".',
    },

    // ─────────────────── Immagini e cattura schermo ──────────────────────────
    {
      id: 'explain-image', title: 'Spiega un’immagine', category: 'media',
      desc: 'Descrive un’immagine della pagina, direttamente lì sotto.',
      invoke: 'Clic destro su un’immagine → "Spiega immagine".',
    },
    {
      id: 'copy-download-image', title: 'Copia o scarica un’immagine', category: 'media',
      desc: 'Copia l’immagine negli appunti o la scarica sul computer.',
      invoke: 'Clic destro su un’immagine → "Copia immagine" / scarica.',
    },
    {
      id: 'search-image', title: 'Cerca un’immagine sul web', category: 'media',
      desc: 'Cerca sul web a partire da un’immagine della pagina (ricerca per immagine).',
      invoke: 'Clic destro su un’immagine → cerca immagine.',
    },
    {
      id: 'screenshot', title: 'Cattura schermo', category: 'media',
      desc: 'Cattura la pagina visibile come immagine. Puoi anche selezionare solo una porzione dello schermo.',
      invoke: 'Menu del tasto destro → "Screenshot" o "Screenshot di una parte".',
    },
    {
      id: 'ocr', title: 'Trascrivi testo da una porzione', category: 'media',
      desc: 'Selezioni un’area dello schermo e ne estrae il testo, copiandolo negli appunti.',
      invoke: 'Menu del tasto destro → "Trascrivi".',
    },
    {
      id: 'color-picker', title: 'Contagocce colore', category: 'media',
      desc: 'Preleva il colore di un punto qualsiasi dello schermo e ne copia il codice negli appunti.',
      invoke: 'Menu del tasto destro → "Color picker".',
      doesNot: 'Disponibile solo dove il sistema lo supporta.',
    },
    {
      id: 'qr-code', title: 'QR code della pagina', category: 'media',
      desc: 'Genera un QR code dell’indirizzo della pagina corrente, da scaricare o condividere.',
      invoke: 'Menu del tasto destro → "QR code della pagina".',
    },

    // ─────────────────────────────── Link ────────────────────────────────────
    {
      id: 'explain-link', title: 'Spiega un link', category: 'links',
      desc: 'Spiega dove porta un link senza aprirlo, e segnala se sembra sospetto (phishing).',
      invoke: 'Clic destro su un link → "Spiega link".',
      doesNot: 'Non apre il link; l’analisi di sicurezza è basata su indizi nell’indirizzo, non su un database in tempo reale.',
    },
    {
      id: 'save-link', title: 'Salva un link per dopo', category: 'links',
      desc: 'Mette da parte un link nella lista "Aperti per dopo".',
      invoke: 'Clic destro su un link → "Salva link per dopo".',
    },
    {
      id: 'share-copy-link', title: 'Condividi o copia un link', category: 'links',
      desc: 'Condivide un link col sistema operativo o ne copia l’indirizzo.',
      invoke: 'Clic destro su un link → "Condividi link" / "Copia URL".',
    },

    // ────────────────────────────── Appunti ──────────────────────────────────
    {
      id: 'paste-clipboard', title: 'Incolla con cronologia', category: 'clipboard',
      desc: 'Incolla testo o immagini dagli appunti; puoi anche scegliere da una cronologia ricercabile di ciò che hai copiato di recente.',
      invoke: 'In un campo modificabile, menu del tasto destro → "Incolla"; la freccia apre la cronologia.',
    },
    {
      id: 'copy-cut', title: 'Copia e taglia', category: 'clipboard',
      desc: 'Copia o taglia il testo selezionato.',
      invoke: 'Menu del tasto destro → "Copia" / "Taglia".',
    },

    // ──────────────────────── Salva per dopo e archivio ──────────────────────
    {
      id: 'save-for-later', title: 'Salva la pagina per dopo', category: 'save',
      desc: 'Mette da parte la pagina corrente (titolo, indirizzo, anteprima) e chiude la scheda, per riprenderla quando vuoi.',
      invoke: 'Alt+S, oppure menu del tasto destro → "Salva per dopo".',
      doesNot: 'Salva i riferimenti e un’anteprima, non lo stato della pagina (moduli compilati, sessione).',
    },
    {
      id: 'open-for-later', title: 'Aperti per dopo', category: 'save',
      desc: 'La lista delle pagine e dei link che hai messo da parte, pronti da riaprire.',
      invoke: 'Menu del tasto destro → "Aperti per dopo".',
    },
    {
      id: 'archive', title: 'Archivio delle schede chiuse', category: 'save',
      desc: 'Ritrova le schede chiuse, raggruppate per giorno; puoi cercarle anche per contenuto e riaprirle.',
      invoke: 'Pagina filo://archive/archive.html (dalla home → "Tab archiviate").',
    },
    {
      id: 'history', title: 'Cronologia delle richieste AI', category: 'save',
      desc: 'L’elenco delle richieste fatte all’AI (spiegazioni, traduzioni, aiuto…), filtrabile e ricercabile, con possibilità di svuotarla.',
      invoke: 'Pagina filo://history/history.html.',
    },

    // ──────────────────── Assistente e agente di pagina ──────────────────────
    {
      id: 'help-sidebar', title: 'Assistente di pagina (Aiuto)', category: 'assistant',
      desc: 'Apre un assistente laterale che vede la pagina e ti aiuta passo passo: può evidenziare elementi, suggerire dove cliccare, aprire menu nascosti e proporre cosa scrivere in un campo (lo invii tu).',
      invoke: 'Alt+H.',
      doesNot: 'Non invia i moduli al posto tuo: ogni azione che modifica la pagina richiede una tua conferma.',
    },
    {
      id: 'web-search-assistant', title: 'Ricerca sul web dell’assistente', category: 'assistant',
      desc: 'Durante l’aiuto, l’assistente può fare alcune ricerche sul web per rispondere meglio.',
      invoke: 'Automatico all’interno dell’assistente di pagina.',
    },
    {
      id: 'feedback', title: 'Manda un feedback', category: 'assistant',
      desc: 'Segnala un problema o una richiesta a chi sviluppa Filo, anche con immagini allegate, e segui le risposte in un thread.',
      invoke: 'Menu del tasto destro → "Feedback", oppure filo://feedback/feedback.html.',
    },

    // ─────────────────────────── Pagine interne ──────────────────────────────
    {
      id: 'home-page', title: 'Home di Filo', category: 'pages',
      desc: 'La pagina iniziale con azioni suggerite, un messaggio in evidenza e gli aggiornamenti recenti.',
      invoke: 'filo://home/home.html (pulsante Home o nuova scheda).',
    },
    {
      id: 'patch-notes', title: 'Recap degli aggiornamenti', category: 'pages',
      desc: 'All’avvio di una nuova versione, un riquadro riassume le novità e le correzioni in parole semplici.',
      invoke: 'Compare da solo all’avvio dopo un aggiornamento.',
    },

    // ───────────────────────────── Impostazioni ──────────────────────────────
    {
      id: 'options-models', title: 'Modelli e chiavi AI', category: 'settings',
      desc: 'Imposta le chiavi dei servizi AI (OpenRouter, Google Gemini, Tavily), scegli i modelli per ciascuna azione e un limite di spesa mensile. Puoi anche affidarti ai modelli predefiniti di Filo.',
      invoke: 'Menu del tasto destro → "Opzioni Filo", oppure filo://options/options.html.',
      doesNot: 'Le chiavi sono salvate cifrate in locale.',
    },
    {
      id: 'preferences', title: 'Preferenze', category: 'settings',
      desc: 'Tema (chiaro/scuro/sistema), dimensione del testo delle pagine interne, archiviazione automatica delle schede, stile dell’assistente, voce/velocità/tono della lettura, e notifiche.',
      invoke: 'Pagina filo://preferences/preferences.html.',
    },
    {
      id: 'security', title: 'Sicurezza e privacy', category: 'settings',
      desc: 'Protezione dalla fuga del tuo indirizzo IP, blocco dei popup, gestione dei cookie (manuale / predefinita / privacy massima) e lista dei siti fidati.',
      invoke: 'Pagina filo://security/security.html.',
    },
    {
      id: 'theme', title: 'Tema chiaro / scuro', category: 'settings',
      desc: 'Sceglie l’aspetto chiaro, scuro o automatico per le pagine di Filo.',
      invoke: 'Preferenze → Tema.',
    },

    // ────────────────────────────── Crediti ──────────────────────────────────
    {
      id: 'credits', title: 'Crediti e consumi', category: 'credits',
      desc: 'Mostra il saldo dei crediti, quando si ricaricano e un grafico di come li hai spesi tra le varie azioni.',
      invoke: 'Pagina filo://credits/credits.html.',
    },
  ];

  // ── API ────────────────────────────────────────────────────────────────────

  // Indice COMPATTO (id + titolo + categoria), pensato per stare sempre in
  // contesto all'agente senza pesare: il dettaglio si recupera con get(id).
  function index() {
    return CAPABILITIES.map((c) => ({ id: c.id, title: c.title, category: c.category }));
  }

  // Dettaglio completo di una capacità per id (o undefined).
  function get(id) {
    return CAPABILITIES.find((c) => c.id === id);
  }

  // Tutte le capacità di una categoria.
  function byCategory(category) {
    return CAPABILITIES.filter((c) => c.category === category);
  }

  // Tutte le capacità (copia per non far mutare l'originale).
  function all() {
    return CAPABILITIES.slice();
  }

  // ── Rendering per il prompt dell'agente (F2) ────────────────────────────────
  //
  // Indice COMPATTO da tenere sempre in contesto all'agente di chat: una riga per
  // capacità (titolo + id stabile), raggruppata per categoria. Pesa poco (~44
  // righe) e basta all'agente per capire SE Filo sa fare una cosa; per il COME
  // esatto (invoke) e i limiti (doesNot) c'è renderDetailForPrompt(ids), che
  // l'agente recupera on-demand con l'azione CAPACITA_DETTAGLIO. L'id tra []
  // serve all'agente per chiedere il dettaglio della voce giusta.
  function renderIndexForPrompt() {
    const lines = [];
    for (const [cat, label] of Object.entries(CATEGORIES)) {
      const items = CAPABILITIES.filter((c) => c.category === cat);
      if (!items.length) continue;
      lines.push(`${label}:`);
      for (const c of items) lines.push(`  - ${c.title} [${c.id}]`);
    }
    return lines.join('\n');
  }

  // Dettaglio completo (cosa fa / come si attiva / limiti) di una o più capacità
  // per id, formattato per essere reinserito nel contesto dell'agente come
  // OSSERVAZIONE (dati, non istruzioni). Gli id sconosciuti vengono segnalati
  // esplicitamente così l'agente non finge di averli trovati.
  function renderDetailForPrompt(ids) {
    const list = Array.isArray(ids) ? ids : (ids ? [ids] : []);
    if (!list.length) return '(nessuna capacità richiesta)';
    const blocks = [];
    for (const rawId of list) {
      const id = String(rawId || '').trim();
      const c = get(id);
      if (!c) {
        blocks.push(`• "${id}": nessuna capacità con questo id (Filo non sa fare questa cosa).`);
        continue;
      }
      let b = `• ${c.title} [${c.id}]\n  Cosa fa: ${c.desc}\n  Come si attiva: ${c.invoke}`;
      if (c.doesNot) b += `\n  Limiti: ${c.doesNot}`;
      blocks.push(b);
    }
    return blocks.join('\n\n');
  }

  global.SN_CAPABILITIES = {
    CATEGORIES, CAPABILITIES, index, get, byCategory, all,
    renderIndexForPrompt, renderDetailForPrompt,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
