// Blocco di attività della domanda (#521) e tutto ciò che Filo mostra sotto
// una risposta: le righe del diario, i bottoni delle azioni, l'esito dei
// comandi.
//
// Il contratto con la home è uno solo:
//
//     const activity = SN_DASH_ATTIVITA.create(container);
//
// `create` appende il blocco al container che gli si dà e ritorna l'oggetto
// `activity` che il turno di Filo si passa di mano in mano (pushReasoning,
// working, addRow, addCommand, absorbBubble, dropNote, endTurn, finish,
// remove). Il container è esplicito apposta: chi disegna un blocco decide
// dove, invece di scoprire a posteriori che finisce sempre nelle bolle.
//
// Forma del modulo: IIFE che si registra su globalThis e NON tocca il DOM al
// caricamento — solo dentro `init`.
(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;

  // Dipendenze dalla pagina, riempite da init().
  let send = null;
  let faviconUrl = () => '';
  let applyCommandCwd = () => {};
  let paroleUtente = () => [];
  let apriProposta = () => {};
  let archiviaAzione = () => {};

  function isType(a, t) {
    return a && String(a.type || '').toUpperCase() === t;
  }

  // ===== Blocco di attività della domanda (#521) =====
  // UNO per messaggio dell'utente, sopra la risposta finale. Raccoglie tutto
  // ciò che Filo fa prima di rispondere, anche su più turni automatici
  // (ragiona, cerca, legge, ragiona ancora, risponde). Filo non «ragiona e
  // basta»: agisce, e il blocco è «Filo sta facendo qualcosa».
  //
  // Chiuso di default, sempre: il 90 % delle volte l'utente vuole che il lavoro
  // sia invisibile. La riga in testa dice cosa succede ADESSO — rotella e
  // «Aspetto la risposta…», poi «Sta ragionando · …ultima frase», poi «Cerco
  // sul web: …» — e a lavoro finito diventa il riassunto («Ha cercato sul web e
  // letto un documento · 1 min 20 s»). Un click apre la cronologia completa:
  // ragionamento, azioni, note intermedie, esiti dei comandi, nell'ordine in
  // cui sono avvenuti. Niente frasi inventate: le vecchie righe «Consulto la
  // memoria…» erano teatro, non stato.
  //
  // Se alla fine non c'è niente da raccontare, il blocco si toglie da solo.
  function createActivity(container) {
    const wrap = document.createElement('div');
    wrap.className = 'dash-activity';
    wrap.dataset.phase = 'wait';
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'dash-activity-head';
    head.setAttribute('aria-expanded', 'false');
    head.title = 'Mostra cosa ha fatto Filo';
    const icon = document.createElement('span');
    icon.className = 'dash-activity-icon';
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'dash-activity-label';
    label.textContent = 'Aspetto la risposta…';
    head.append(icon, label);
    const body = document.createElement('div');
    body.className = 'dash-activity-body';
    body.hidden = true;
    wrap.append(head, body);
    container.appendChild(wrap);
    container.scrollTop = container.scrollHeight;

    const startedAt = Date.now();
    let phase = 'wait';
    let open = false;
    let items = 0;
    // Ragionamento del turno in corso (un blocco per turno nella cronologia).
    let reasoningEl = null;
    let turnReasoning = '';
    // Il modello ha ragionato almeno una volta in questo lavoro: senza, il
    // riassunto non può chiamarsi «Ragionamento».
    let sawReasoning = false;
    let turnStartedAt = 0;
    let lastTurn = { text: '', ms: 0 };
    // Quante voci c'erano quando è partito il testo del turno (vedi answerStarted).
    let turnMark = null;
    // Tipi delle azioni compiute, nell'ordine: da qui nasce il riassunto.
    const doneTypes = [];

    const followBody = () => {
      const near = body.scrollHeight - body.scrollTop - body.clientHeight < 32;
      if (near) body.scrollTop = body.scrollHeight;
    };
    const followThread = () => {
      const near = container.scrollHeight - container.scrollTop - container.clientHeight < 48;
      if (near) container.scrollTop = container.scrollHeight;
    };
    const setOpen = (v) => {
      open = !!v;
      body.hidden = !open;
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      head.title = open ? 'Nascondi' : 'Mostra cosa ha fatto Filo';
      // Aperto a lavoro finito si legge dall'inizio; aperto mentre lavora si
      // guarda l'ultima cosa.
      if (open) body.scrollTop = phase === 'done' ? 0 : body.scrollHeight;
      followThread();
    };
    head.addEventListener('click', () => setOpen(!open));
    const setPhase = (p, text) => {
      phase = p;
      wrap.dataset.phase = p;
      label.textContent = text;
    };
    const lastSentence = (t) => {
      const parts = String(t || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s+/);
      return parts[parts.length - 1] || '';
    };
    const append = (el) => {
      body.appendChild(el);
      items += 1;
      followBody();
      followThread();
    };
    // Chiude il blocco di ragionamento del turno (se c'era) e lo mette da parte
    // per lo storico del thread.
    const closeTurnReasoning = () => {
      if (!turnReasoning) return;
      lastTurn = { text: turnReasoning, ms: Date.now() - turnStartedAt };
      turnReasoning = '';
      reasoningEl = null;
    };

    return {
      el: wrap,
      // Un pezzo di ragionamento vero dal modello.
      pushReasoning(text) {
        if (phase === 'done' || !text) return;
        sawReasoning = true;
        if (!reasoningEl) {
          reasoningEl = document.createElement('div');
          reasoningEl.className = 'dash-activity-reasoning';
          turnStartedAt = Date.now();
          append(reasoningEl);
        }
        turnReasoning += text;
        reasoningEl.textContent = turnReasoning;
        setPhase('reason', `Sta ragionando · ${lastSentence(turnReasoning)}`);
        followBody();
        followThread();
      },
      // È partito il testo di una risposta (finale o intermedia). Da qui in poi
      // le righe del turno (azioni, comandi) vengono DOPO il testo: se poi
      // quel testo entra in cronologia come nota, va messo qui, non in coda.
      answerStarted() {
        closeTurnReasoning();
        turnMark = body.childElementCount;
        if (phase !== 'done') setPhase('act', 'Scrivo la risposta…');
      },
      // Il modello ha appena nominato un'azione: la riga in testa lo dice
      // subito («Cerco sul web…»), la riga vera arriva con l'esito.
      working(text) {
        if (phase === 'done' || !text) return;
        closeTurnReasoning();
        setPhase('act', text);
      },
      // Una riga di azione: icona e due parole («Timer avviato · 5 min»).
      // `failed`: la riga resta (è successo qualcosa) ma il riassunto non la
      // conta — «Ha avviato un timer» su un timer non avviato è una bugia.
      addRow(type, rowIcon, text, failed = false, cambi = null) {
        closeTurnReasoning();
        if (!failed) doneTypes.push(String(type || '').toUpperCase());
        append(makeActivityRow(rowIcon, text, cambi));
        if (phase !== 'done') setPhase('act', text);
      },
      // Esito di un comando eseguito subito (livello 1): riga di comando e
      // output, nella cronologia — non nella bolla della risposta.
      addCommand(out, spiegazione = '') {
        closeTurnReasoning();
        doneTypes.push('ESEGUI_COMANDO');
        const el = renderCommandResult(out, spiegazione);
        el.classList.add('dash-activity-cmd');
        append(el);
        if (phase !== 'done') setPhase('act', `Eseguito · ${spiegazione || (out && out.command) || 'comando'}`);
      },
      // La bolla di un turno che NON era l'ultimo («Provo subito tutti e tre…»)
      // entra nella cronologia come nota e sparisce dalla conversazione: per
      // l'utente conta la risposta, non il commento a metà lavoro.
      absorbBubble(bubble) {
        if (!bubble || !bubble.isConnected) return;
        const text = (bubble.textContent || '').trim();
        bubble.remove();
        if (!text) return;
        const note = document.createElement('div');
        note.className = 'dash-activity-note';
        note.textContent = text;
        // Nell'ordine vero: il testo è stato scritto PRIMA delle azioni del turno.
        const at = (turnMark !== null && turnMark <= body.childElementCount) ? body.children[turnMark] || null : null;
        body.insertBefore(note, at);
        items += 1;
        turnMark = null;
        followBody();
        followThread();
      },
      // La nota che il main ha promosso a risposta (ultimo giro muto: la frase
      // scritta insieme alle azioni era la risposta) non resta anche qui: una
      // frase sola, nella bolla, non due.
      dropNote(text) {
        const t = String(text || '').trim();
        if (!t) return;
        const notes = body.querySelectorAll('.dash-activity-note');
        const last = notes[notes.length - 1];
        if (last && (last.textContent || '').trim() === t) { last.remove(); items -= 1; }
      },
      // Fine di un turno: chiude il ragionamento del turno e lo restituisce
      // (per lo storico del thread).
      endTurn() {
        closeTurnReasoning();
        const t = lastTurn;
        lastTurn = { text: '', ms: 0 };
        return t;
      },
      // Fine di tutto il lavoro: la riga diventa il riassunto; senza niente
      // dentro, il blocco non ha ragione di restare.
      // `failed`: il lavoro si è interrotto per un errore. Il blocco resta (il
      // ragionamento aiuta a capire cosa stava tentando) ma lo dice in riga,
      // così dopo un «Riprova» non sembra un lavoro riuscito impilato sopra
      // l'altro.
      finish({ failed = false } = {}) {
        closeTurnReasoning();
        if (!items) { wrap.remove(); setPhase('done', ''); return; }
        const summary = `${summarizeActivity(doneTypes, sawReasoning)} · ${fmtActivityDuration(Date.now() - startedAt)}`;
        setPhase('done', failed ? `Tentativo non riuscito · ${summary}` : summary);
        if (failed) wrap.dataset.failed = '1';
        head.title = open ? 'Nascondi' : 'Mostra cosa ha fatto Filo';
      },
      remove() { wrap.remove(); },
      // Il blocco sta subito sotto la bolla dell'utente che l'ha chiesto: da qui la si ritrova.
      el: wrap,
    };
  }

  // «Ha cercato sul web, impostato una sveglia e letto un documento»: il
  // riassunto delle azioni, nell'ordine in cui sono avvenute, con i doppioni
  // contati. Senza azioni resta il solo ragionamento.
  const ACTIVITY_VERBS = {
    // Un'azione fermata perché avrebbe portato fuori un segreto (#810): si vede anche a blocco chiuso.
    FERMATA: (n) => (n > 1 ? `fermato ${n} azioni` : 'fermato un\'azione'),
    CERCA_WEB: (n) => (n > 1 ? `cercato sul web ${n} volte` : 'cercato sul web'),
    CERCA_CHAT: (n) => (n > 1 ? `riletto ${n} conversazioni di prima` : 'riletto una conversazione di prima'),
    LEGGI_DOCUMENTO: (n) => (n > 1 ? `letto ${n} documenti` : 'letto un documento'),
    RINOMINA_FILE: () => 'dato un nome ai file',
    LEGGI_FILE: (n) => (n > 1 ? `letto ${n} file` : 'letto un file'),
    LEGGI_TRASPARENZA: () => 'riletto la trasparenza',
    CAPACITA_DETTAGLIO: () => 'verificato cosa sa fare',
    TIMER: (n) => (n > 1 ? `avviato ${n} timer` : 'avviato un timer'),
    SVEGLIA: (n) => (n > 1 ? `impostato ${n} sveglie` : 'impostato una sveglia'),
    CANCELLA_SVEGLIA: () => 'cancellato una sveglia',
    MODIFICA_SVEGLIA: () => 'spostato una sveglia',
    EVENTO_CALENDARIO: (n) => (n > 1 ? `creato ${n} eventi` : 'creato un evento'),
    ESEGUI_COMANDO: (n) => (n > 1 ? `eseguito ${n} comandi` : 'eseguito un comando'),
    IMPOSTA_PREFERENZA: (n) => (n > 1 ? `cambiato ${n} impostazioni` : 'cambiato un\'impostazione'),
    IMPOSTA_ESTETICA: (n) => (n > 1 ? `cambiato ${n} dettagli dell'aspetto` : 'cambiato l\'aspetto'),
    ANNULLA_CAMBIO: (n) => (n > 1 ? `rimesso com'era ${n} cambi` : 'rimesso com\'era un cambio'),
    SALVA_APPUNTO: (n) => (n > 1 ? `salvato ${n} appunti` : 'salvato un appunto'),
    SALVA_LEZIONE: (n) => (n > 1 ? `memorizzato ${n} cose` : 'memorizzato una cosa'),
    DIMENTICA: (n) => (n > 1 ? `dimenticato ${n} cose` : 'dimenticato una cosa'),
    NAVIGA: (n) => (n > 1 ? `aperto ${n} pagine` : 'aperto una pagina'),
    ONBOARDING: () => 'proseguito con l\'accoglienza',
    PROXY_TAB: () => 'aperto la scheda da un altro paese',
    RIMUOVI_PROXY: () => 'riportato la scheda in Italia',
    RIMUOVI_PROXY_TUTTE: () => 'riportato le schede in Italia',
    REGOLA_PROXY_DOMINIO: () => 'salvato una regola sul paese',
    RIMUOVI_REGOLA_PROXY: () => 'tolto una regola sul paese',
    STILE_PAGINA: () => 'cambiato l\'aspetto della pagina',
    RIPRISTINA_STILE_PAGINA: () => 'rimesso la pagina com\'era',
    COMANDO_FINESTRA: () => 'azionato un comando della finestra',
    CARTA_HOME: (n) => (n > 1 ? `sistemato ${n} carte della home` : 'sistemato una carta della home'),
    INVIA_FEEDBACK: () => 'preparato una segnalazione',
    PULISCI_TAB: () => 'riordinato le schede',
    CANCELLA_ARCHIVIO: () => 'eliminato schede dall\'archivio',
  };
  // `hasReasoning`: il modello ha davvero ragionato. Senza, un blocco che
  // contiene solo una frase intermedia non può intitolarsi «Ragionamento».
  function summarizeActivity(types, hasReasoning = true) {
    const counts = new Map();
    for (const t of types) counts.set(t, (counts.get(t) || 0) + 1);
    const parts = [];
    for (const [t, n] of counts) {
      const fn = ACTIVITY_VERBS[t];
      if (fn) parts.push(fn(n));
    }
    if (!parts.length) return hasReasoning ? 'Ragionamento' : 'Come ha lavorato';
    const ultima = parts[parts.length - 1];
    const e = /^e/i.test(ultima) ? 'ed' : 'e';
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} ${e} ${ultima}` : parts[0];
    return `Ha ${list}`;
  }
  function fmtActivityDuration(ms) {
    const s = Math.max(1, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    if (!m) return `${s} s`;
    return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  }

  // Riga di attività: la stessa forma sia dentro il blocco del turno sia — per
  // chi disegna una risposta senza blocco (replay, altre superfici) — fra le
  // azioni della bolla. Tiene la classe della traccia (#376): non è un bottone
  // e non deve sembrarlo.
  // `cambi`: gli id degli eventi del filo che la riga racconta; il tasto destro e lo stato
  // «annullato» li leggono da lì (dashboard-cambi.js).
  function makeActivityRow(rowIcon, text, cambi = null) {
    const el = document.createElement('div');
    el.className = 'dash-action-step dash-activity-row';
    const ids = Array.isArray(cambi) ? cambi.filter(Boolean) : [];
    if (ids.length) el.dataset.cambi = ids.join(' ');
    const ic = document.createElement('span');
    ic.className = 'dash-activity-row-icon';
    ic.setAttribute('aria-hidden', 'true');
    ic.textContent = rowIcon || '';
    const tx = document.createElement('span');
    tx.textContent = String(text || '').trim();
    el.append(ic, tx);
    return el;
  }

  // Le azioni che si raccontano con una riga (icona + due parole) invece che
  // con un bottone: sono già eseguite dal main o sono passi intermedi, e
  // cliccarle non farebbe niente (#376). Una sola tabella, così l'icona di
  // un'azione sta in un posto solo. Ciò che è cliccabile — un link da aprire,
  // una conferma da dare, l'esito di un comando — resta un bottone sotto la
  // risposta e NON passa di qui.
  // Il testo scritto dal modello prima di finire in una riga: senza caratteri
  // di controllo (un byte nullo nell'etichetta finiva tale e quale nel diario).
  function pulito(v) {
    return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  }
  function frasiCambi(a) {
    const l = Array.isArray(a && a._cambi) ? a._cambi : [];
    return l.map((c) => pulito(c && c.frase)).filter(Boolean).join('; ');
  }
  const ACTIVITY_ROWS = {
    TIMER: (a) => {
      const sec = Number(a.seconds || a.secondi || 0);
      // #323 — durata umana fedele all'intento: "30 sec", "2 h", "1 h 30 min".
      const dur = (self.SN_TIME ? self.SN_TIME.fmtDurationLabel(sec) : `${Math.round(sec / 60)} min`);
      const name = pulito(a.label || a.etichetta);
      return { icon: '⏱', text: `Timer avviato · ${name ? `${name} · ` : ''}${dur}` };
    },
    SVEGLIA: (a) => {
      const when = pulito(a.time || a.orario);
      const name = pulito(a.label || a.etichetta);
      return { icon: '⏰', text: `Sveglia impostata${when ? ` · ${when}` : ''}${name ? ` · ${name}` : ''}` };
    },
    // Il main descrive cosa ha tolto o spostato («Sveglia “lezione” 07:55»):
    // se si può aggiungere una sveglia dalla chat, si deve vedere anche
    // quando la si toglie.
    CANCELLA_SVEGLIA: (a) => {
      const list = (a._output && Array.isArray(a._output.removed)) ? a._output.removed : [];
      return { icon: '⏰', text: `Cancellata · ${list.join(', ') || (a.etichetta || a.label || '')}` };
    },
    MODIFICA_SVEGLIA: (a) => {
      const list = (a._output && Array.isArray(a._output.updated)) ? a._output.updated : [];
      return { icon: '⏰', text: `Spostata · ${list.join(', ') || (a.etichetta || a.label || '')}` };
    },
    EVENTO_CALENDARIO: (a) => ({ icon: '📅', text: `Evento creato · ${a.title || a.titolo || ''}` }),
    // Impostazione applicata subito (livello 1, es. il tema): prima non
    // lasciava traccia in chat, come se non fosse successo niente.
    // La frase è quella dell'evento del filo, col nome della pagina Preferenze (#557, #867); senza
    // evento il valore era già quello.
    IMPOSTA_PREFERENZA: (a) => {
      const f = frasiCambi(a);
      if (f) return { icon: '⚙', text: `Impostato · ${f}` };
      const etichetta = pulito(a._output && a._output.etichetta);
      return { icon: '⚙', text: etichetta ? `Già così · ${etichetta}` : 'Impostazione già così' };
    },
    ANNULLA_CAMBIO: (a) => {
      const f = pulito(a._output && a._output.frase);
      return { icon: '↩', text: `Rimesso com’era${f ? ` · prima di: ${f}` : ''}` };
    },
    // Passi intermedi (#368/#376): la ricerca è già partita nel main e i
    // risultati rientrano nel turno successivo, dove compare la risposta.
    CERCA_WEB: (a) => ({ icon: '🔎', text: `Cerco sul web: ${a.query || ''}` }),
    CERCA_CHAT: (a) => {
      const q = String(a.query || a.testo || '').trim();
      if (a.id && !q) return { icon: '💬', text: 'Rileggo una conversazione di prima' };
      return { icon: '💬', text: `Cerco fra le chat di prima: ${q}` };
    },
    CAPACITA_DETTAGLIO: () => ({ icon: '📖', text: 'Verifico cosa so fare' }),
    LEGGI_FILE: (a) => {
      const title = (a._output && a._output.title) || '';
      return { icon: '📄', text: title ? `Leggo: ${title}` : 'Leggo un file' };
    },
    LEGGI_DOCUMENTO: (a) => {
      const nome = (a._output && a._output.name) || '';
      return { icon: '📄', text: nome ? `Leggo il documento: ${nome}` : 'Leggo il documento' };
    },
    LEGGI_TRASPARENZA: () => ({ icon: '📄', text: 'Rileggo la pagina di trasparenza' }),
    RINOMINA_FILE: (a) => ({ icon: '✎', text: testoRinominati(a._output) }),
    // Le azioni che non lasciano niente da cliccare in chat: prima sparivano
    // del tutto, e l'utente non sapeva dove fosse finito il suo appunto.
    SALVA_APPUNTO: (a) => {
      const dove = String(a.contesto || a.context || a.argomento || '').trim();
      return { icon: '📝', text: `Appunto salvato${dove ? ` · ${dove}` : ''}` };
    },
    SALVA_LEZIONE: (a) => {
      const t = String(a.testo || a.text || a.lezione || '').trim();
      return { icon: '🧠', text: `Memorizzato · ${t.length > 60 ? `${t.slice(0, 57)}…` : t}` };
    },
    DIMENTICA: (a) => {
      const tolte = (a._output && Array.isArray(a._output.dimenticate)) ? a._output.dimenticate : [];
      const t = tolte.join(', ') || String(a.testo || '').trim();
      return { icon: '🧠', text: `Dimenticato · ${t.length > 80 ? `${t.slice(0, 77)}…` : t}` };
    },
    ONBOARDING: (a) => {
      if (a && (a.fine ?? a.chiudi ?? a.done)) return { icon: '👋', text: 'Accoglienza conclusa' };
      const ids = Array.isArray(a && a.spunta) ? a.spunta : [];
      return { icon: '👋', text: `Accoglienza · ${ids.join(', ') || 'passo fatto'}` };
    },
    IMPOSTA_ESTETICA: (a) => {
      const tok = a.token || a.nome || a.name || a.chiave || a.elemento || '';
      // Il nome leggibile sta nel registro dei token: `button.bg` non dice
      // niente a chi ha chiesto di cambiare l'aspetto (#726).
      const T = window.SN_THEME_TOKENS;
      const t = T && T.get && T.get(tok);
      const val = a.valore ?? a.value ?? a.val ?? a.colore;
      const f = frasiCambi(a);
      if (f) return { icon: '🎨', text: `Aspetto · ${f.replace(/^aspetto, /, '')}` };
      return { icon: '🎨', text: `Aspetto · ${(t && t.label) || tok}${val ? ` = ${val}` : ''}` };
    },
    PROXY_TAB: (a) => ({ icon: '🌍', text: `Scheda aperta da · ${String(a.country || a.paese || '').toUpperCase()}` }),
    RIMUOVI_PROXY: () => ({ icon: '🌍', text: 'Scheda riportata in Italia' }),
    RIMUOVI_PROXY_TUTTE: () => ({ icon: '🌍', text: 'Tutte le schede riportate in Italia' }),
    REGOLA_PROXY_DOMINIO: (a) => ({ icon: '🌍', text: `Regola · ${a.dominio || a.domain || a.sito || 'questo sito'} sempre da ${String(a.country || a.paese || '').toUpperCase()}` }),
    RIMUOVI_REGOLA_PROXY: (a) => ({ icon: '🌍', text: `Regola tolta · ${a.dominio || a.domain || a.sito || 'questo sito'}` }),
    STILE_PAGINA: (a) => {
      const d = String(a.descrizione || a.description || '').trim();
      return { icon: '🖌', text: `Aspetto della pagina · ${d || 'modificato'}` };
    },
    RIPRISTINA_STILE_PAGINA: () => ({ icon: '🖌', text: 'Aspetto della pagina ripristinato' }),
    PULISCI_TAB: (a) => {
      const n = Number(a._output && a._output.archived) || 0;
      return { icon: '🧹', text: n ? `Schede riordinate · ${n} ${n === 1 ? 'archiviata' : 'archiviate'}` : 'Schede riordinate · nessuna da archiviare' };
    },
    CANCELLA_ARCHIVIO: (a) => {
      const n = Number(a._output && a._output.eliminate) || 0;
      return { icon: '🗑', text: `Eliminate dall’archivio · ${n} ${n === 1 ? 'scheda' : 'schede'}` };
    },
    // Il nome è quello della carta toccata davvero (#870): a sinistra lo dice l'esito, a destra lo si risolve come il
    // main. Le parole del modello da sole ingannano: «l'avviso del documento» contiene un nome dell'Editor.
    CARTA_HOME: (a) => {
      const C = self.SN_CARTE_HOME;
      const o = a._output || {};
      const corto = (t) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > 60 ? `${x.slice(0, 59)}…` : x; };
      let nome = '';
      const toccate = Array.isArray(o.tolte) && o.tolte.length ? o.tolte : (Array.isArray(o.rimesse) && o.rimesse.length ? o.rimesse : null);
      if (toccate) nome = toccate.length === 1 ? corto(toccate[0].titolo) : `${toccate.length} carte`;
      else if (o.spostata) nome = corto(o.spostata);
      else if (Array.isArray(o.destra) && !o.error && C) { const id = C.risolvi(a.carta); nome = id ? C.carta(id).titolo : ''; }
      const op = String(a.operazione || '').toLowerCase();
      const cosa = { togli: 'Carta tolta', rimetti: 'Carta rimessa', aggiungi: 'Carta rimessa', sposta: 'Carta spostata' }[op];
      if (op === 'ripristina') return { icon: '🏠', text: 'Carte della home rimesse com\'erano' };
      return { icon: '🏠', text: `${cosa || 'Carta della home'}${nome ? ` · ${nome}` : ''}` };
    },
    COMANDO_FINESTRA: (a) => {
      const labels = {
        fullscreen: 'Schermo intero', minimize: 'Finestra ridotta a icona', home: 'Home aperta',
        settings: 'Impostazioni aperte', apps: 'Menu App aperto', account: 'Menu Account aperto',
      };
      const cmd = String(a.comando || a.command || a.cmd || '').toLowerCase();
      return { icon: '🪟', text: labels[cmd] || 'Comando della finestra' };
    },
  };
  // Che cosa NON è andato a buon fine, detto come lo direbbe l'utente: la riga
  // del diario resta (è successo qualcosa), ma non promette il contrario.
  const FAILED_LABELS = {
    TIMER: 'Timer non avviato', SVEGLIA: 'Sveglia non impostata',
    CANCELLA_SVEGLIA: 'Niente da cancellare', MODIFICA_SVEGLIA: 'Niente da spostare',
    SALVA_APPUNTO: 'Appunto non salvato', SALVA_LEZIONE: 'Non memorizzato',
    DIMENTICA: 'Niente da dimenticare',
    CERCA_WEB: 'Ricerca non riuscita', LEGGI_FILE: 'File non letto', RINOMINA_FILE: 'Nessun file rinominato',
    CERCA_CHAT: 'Conversazione non ritrovata',
    LEGGI_DOCUMENTO: 'Documento non letto', LEGGI_TRASPARENZA: 'Documento non disponibile',
    CAPACITA_DETTAGLIO: 'Verifica non riuscita', NAVIGA: 'Link non aperto',
    IMPOSTA_PREFERENZA: 'Impostazione non applicata', IMPOSTA_ESTETICA: 'Aspetto non cambiato',
    ANNULLA_CAMBIO: 'Niente annullato',
    STILE_PAGINA: 'Aspetto della pagina non cambiato', RIPRISTINA_STILE_PAGINA: 'Aspetto della pagina non ripristinato',
    PROXY_TAB: 'Scheda non instradata', RIMUOVI_PROXY: 'Proxy non tolto',
    RIMUOVI_PROXY_TUTTE: 'Proxy non tolti', REGOLA_PROXY_DOMINIO: 'Regola non salvata',
    RIMUOVI_REGOLA_PROXY: 'Regola non tolta', COMANDO_FINESTRA: 'Comando non eseguito',
    CARTA_HOME: 'Carta della home non cambiata',
    EVENTO_CALENDARIO: 'Evento non creato', ONBOARDING: 'Accoglienza non aggiornata',
  };
  function activityRowFor(a) {
    const row = rigaAttivita(a);
    if (!row || row.failed) return row;
    const ids = (Array.isArray(a._cambi) ? a._cambi : []).map((c) => (typeof c === 'string' ? c : c && c.id)).filter(Boolean);
    return ids.length ? { ...row, cambi: ids } : row;
  }
  function rigaAttivita(a) {
    if (!a) return null;
    // In attesa di conferma: il bottone lo mostra la chat, ma nel diario resta
    // la traccia che Filo l'ha CHIESTO — se no un turno fatto di sola richiesta
    // di conferma non lascia nessun blocco, e alla conferma non c'è più dove
    // scrivere che è stata data.
    if (a._confirm) {
      // Due parole, non l'intera spiegazione: quella sta nel popup, che è
      // aperto davanti all'utente proprio in quel momento.
      let prima = String(a._confirm.text || '').split('\n')[0].replace(/\s*:\s*$/, '').trim();
      if (prima.length > 60) prima = `${prima.slice(0, 57)}…`;
      return { icon: '❔', text: `Conferma chiesta · ${prima || String(a.type || '').toLowerCase()}`, failed: true };
    }
    const type = String(a.type || '').toUpperCase();
    // Un segreto che sarebbe uscito (#810): cosa è stato fermato e da dove veniva, frase del main.
    const fermata = a._output && a._output.blocked === 'segreto' ? String(a._output.frase || '').trim() : '';
    if (fermata) return { icon: '🔒', text: fermata.charAt(0).toUpperCase() + fermata.slice(1), tipo: 'FERMATA' };
    // Non riuscita: la riga lo DICE, invece di raccontare un successo che non
    // c'è stato (un documento inesistente diceva «Leggo il documento…»).
    if (a._executed === false) {
      const perche = motivoFallimento(a);
      return { icon: '⚠', text: `${FAILED_LABELS[type] || 'Azione non riuscita'}${perche ? ` · ${perche}` : ''}`, failed: true };
    }
    const fn = ACTIVITY_ROWS[type];
    if (fn) return fn(a);
    // Azione eseguita di cui la tabella non sa niente: meglio una riga generica
    // che il silenzio — il diario deve dire tutto quello che Filo ha fatto.
    if (a._traccia) return { icon: '•', text: type.toLowerCase().replace(/_/g, ' ') };
    return null;
  }
  // La ragione del fallimento, quando il main la conosce.
  function motivoFallimento(a) {
    const o = a && a._output;
    if (!o) return '';
    if (o.blocked === 'scheme') return 'indirizzo non ammesso';
    if (o.blocked === 'site') {
      const quali = o.reason === 'lists' ? 'di pubblicità e tracciamento' : 'bloccati';
      return `${o.host || 'il sito'} è fra i siti ${quali}`;
    }
    if (o.restyle === 'no-page') return 'nessuna pagina web aperta';
    if (o.proxy === 'non_disponibile') return 'non ancora disponibile';
    if (o.proxy === 'no_web_tab') return 'nessuna pagina web aperta';
    if (o.found === false) return 'non trovato';
    if (o.ok === false && o.detail) return String(o.detail);
    if (o.error) return String(o.error);
    return '';
  }

  // Una riga o un esito di comando nel blocco di attività, per un'azione già
  // eseguita dal main. Ritorna true se l'azione è stata raccontata così (e
  // quindi non è un bottone). Serve sia in diretta (evento 'done' mentre il
  // turno lavora) sia a fine turno per le azioni arrivate senza evento.
  function tellActionInActivity(activity, a) {
    if (!activity || !a) return false;
    // Comando già eseguito (livello 1): il suo esito è un passo del lavoro e
    // va nella cronologia del blocco, non sotto la risposta. Se è stato
    // bloccato (terminale spento) resta in vista: è un problema da leggere.
    if (isType(a, 'ESEGUI_COMANDO') && !a._confirm && a._output && !a._output.blocked) {
      activity.addCommand(a._output, spiegazioneDi(a));
      return true;
    }
    const row = activityRowFor(a);
    if (row) { activity.addRow(row.tipo || a.type, row.icon, row.text, !!row.failed, row.cambi); return true; }
    return false;
  }

  // Le azioni che hanno SIA una riga nel diario SIA un bottone che porta
  // altrove: l'appunto salvato dice cosa ha scritto Filo (riga) e apre il
  // posto dove l'ha scritto (bottone). Per tutte le altre vale l'aut-aut: o si
  // racconta o si clicca.
  // Sono le sole due che hanno un bottone che PORTA DA QUALCHE PARTE: l'editor
  // dove l'appunto è finito, e il controllo per scegliere la tinta esatta.
  // Aggiungerne una qui è obbligatorio quando le si dà una riga: senza, la riga
  // si mangia il bottone e la funzione sparisce dalla chat.
  const ROW_AND_BUTTON = ['SALVA_APPUNTO', 'IMPOSTA_ESTETICA', 'RINOMINA_FILE'];

  // Una pagina che il modello voleva aprire e che la lista dei siti bloccati ha fermato: la
  // notifica se ne va in pochi secondi, e la chat le tiene il suo «Apri comunque» (#590).
  function apribileComunque(a) {
    const o = a && a._output;
    return isType(a, 'NAVIGA') && a._executed === false && !!o && o.blocked === 'site' && /^https?:\/\//i.test(String(o.url || ''));
  }

  function bottoneApriComunque(a) {
    const o = a._output;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dash-action-btn';
    // Il nome del sito sta sul bottone: con due aperture fermate, o col testo che una pagina ha dettato
    // al modello, è l'unica cosa che dice quale sito si sta aprendo.
    btn.textContent = `Apri comunque ${o.host || o.url}`;
    btn.title = `Apri ${o.host || o.url} anche se è fra i siti bloccati`;
    // Un doppio clic apre una scheda sola; chiusa quella, il bottone riapre.
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      await send({ type: MSG.APRI_COMUNQUE, url: o.url });
      setTimeout(() => { btn.disabled = false; }, 2000);
    });
    return btn;
  }

  // Blocchi arrivati mentre il turno della loro azione era ancora in corso: li prende renderActions.
  const fermateInAttesa = new Map();

  function segnaFermata(a, { host, reason, url }) {
    a._executed = false;
    a._output = { blocked: 'site', host: host || '', reason: reason || '', url: url || '', dopo: true };
  }

  // La pagina aperta dall'azione `callId` si è spostata da sé su un sito bloccato dopo l'attesa:
  // l'azione nello storico lo dice al modello al turno dopo, e il suo chip diventa «Apri comunque».
  function aperturaFermata(actions, data = {}) {
    const callId = data.callId;
    if (!callId) return false;
    const a = (actions || []).find((x) => x && x._callId === callId && isType(x, 'NAVIGA'));
    if (!a) { fermateInAttesa.set(callId, data); return false; }
    segnaFermata(a, data);
    const chip = document.querySelector(`[data-call-id="${CSS.escape(String(callId))}"]`);
    if (chip && apribileComunque(a)) {
      const row = activityRowFor(a);
      if (row) chip.before(makeActivityRow(row.icon, row.text, row.cambi));
      chip.replaceWith(bottoneApriComunque(a));
    }
    return true;
  }

  // `shown`: gli id delle chiamate già raccontate in diretta nel blocco di
  // attività (evento 'done'): a fine turno non si ripetono.
  function renderActions(container, actions, { onAck, autoConfirm = false, activity = null, shown = null } = {}) {
    if (!actions || !actions.length) return;
    for (const a of actions) {
      const f = a && a._callId && isType(a, 'NAVIGA') ? fermateInAttesa.get(a._callId) : null;
      if (f) { fermateInAttesa.delete(a._callId); segnaFermata(a, f); }
    }
    const wrap = document.createElement('div');
    wrap.className = 'dash-bubble-actions';
    if (actions.some((a) => isType(a, 'ESEGUI_COMANDO') && a._primaVolta)) wrap.appendChild(notaPrimaVolta());
    let hasAck = false;
    for (const a of actions) {
      const told = a && a._callId && shown && shown.has(a._callId);
      // `anche` = ha la riga nel diario E il bottone in chat. Oltre all'appunto
      // (riga che racconta, bottone che porta all'editor) vale per tutto ciò
      // che aspetta una conferma: la riga dice che Filo l'ha chiesta, il
      // bottone è come si risponde.
      const anche = a._confirm
        || (ROW_AND_BUTTON.includes(String(a.type || '').toUpperCase()) && a._executed !== false)
        || apribileComunque(a);
      if (activity) {
        if (told) {
          // Già in cronologia; resta solo l'eventuale bottone (link, conferma).
          if (!anche && (activityRowFor(a) || (isType(a, 'ESEGUI_COMANDO') && !a._confirm && a._output && !a._output.blocked))) continue;
        } else if (tellActionInActivity(activity, a) && !anche) {
          continue;
        }
      } else {
        const row = activityRowFor(a);
        if (row) {
          wrap.appendChild(makeActivityRow(row.icon, row.text, row.cambi));
          if (!anche) continue;
        }
      }
      // Un'azione senza niente da cliccare (`_traccia`) o non riuscita non
      // diventa MAI un bottone: un chip che al click non fa niente è un vicolo
      // cieco (era il caso di un link con un indirizzo non ammesso). La sua
      // riga sta già nel diario. Un'azione IN ATTESA DI CONFERMA non è
      // «fallita»: non è ancora partita, e il suo bottone è tutto il punto.
      if (!a._confirm && !apribileComunque(a) && ((a._traccia && !anche) || a._executed === false)) continue;
      const btn = renderActionButton(a, { onAck, activity });
      if (btn) wrap.appendChild(btn);
      if (String(a.type || '').toUpperCase() === 'SALVA_APPUNTO') hasAck = true;
    }
    if (!wrap.childElementCount && !(hasAck && onAck)) return;
    // Per l'appunto salvato (già eseguito server-side) aggiungiamo un tasto ✓
    // che torna alla dashboard (spec). Timer e sveglie non lo hanno più: la
    // loro riga nel blocco di attività dice già tutto.
    if (hasAck && onAck) {
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'dash-action-btn dash-action-btn-primary';
      ok.textContent = '✓';
      ok.title = 'Chiudi e torna alla dashboard';
      ok.addEventListener('click', onAck);
      wrap.appendChild(ok);
    }
    container.appendChild(wrap);
    // #159/#183 — le modifiche alle impostazioni di livello 2 NON sono chip
    // inerti da cliccare: il popup di conferma (che spiega cosa Filo sta per
    // fare e i rischi) si apre DA SOLO. Se nella stessa risposta ci sono più
    // impostazioni sensibili, i popup si aprono UNO ALLA VOLTA — niente
    // stacking di modali: aspettiamo che l'utente chiuda l'uno prima di aprire
    // il successivo. Le azioni distruttive (livello 3) o esterne (feedback)
    // restano a click esplicito (non marcate data-auto-confirm).
    if (autoConfirm) {
      const autos = Array.from(wrap.querySelectorAll('[data-auto-confirm="1"]'));
      if (autos.length) {
        setTimeout(async () => {
          for (const auto of autos) {
            try { await auto._runConfirm?.(); } catch (_) {}
          }
        }, 0);
      }
    }
  }

  // #146.4 — bottone di raffinamento estetico. Filo ha già applicato un valore
  // ragionevole al token (IMPOSTA_ESTETICA, livello 1); questo bottone apre il
  // box (color picker / slider, secondo il tipo del token) per scegliere il
  // valore esatto, con anteprima live e persistenza. La logica del box vive nel
  // modulo condiviso SN_AESTHETIC_REFINER; qui colleghiamo solo le dipendenze
  // (applica live = pageBootstrap; persisti = UPDATE_SETTINGS debounced).
  function buildAestheticRefiner(a) {
    const R = window.SN_AESTHETIC_REFINER;
    const Tokens = window.SN_THEME_TOKENS;
    if (!R || !Tokens) return null;
    let persistTimer = null;
    const persist = (overrides) => {
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        send({ type: MSG.UPDATE_SETTINGS, settings: { themeTokens: overrides } });
      }, 200);
    };
    const applyLive = (overrides) => {
      try { window.SN_PAGE_BOOTSTRAP.applyThemeTokens(overrides); } catch (_) {}
    };
    const resolveTheme = () => (document.documentElement.dataset.snTheme === 'dark' ? 'dark' : 'light');
    // Risolve le dipendenze al click, leggendo gli override più freschi dallo
    // storage (Filo potrebbe averne cambiati altri nel frattempo).
    const resolve = async () => {
      let overrides = {};
      try {
        const settings = await self.SN_STORAGE.getSettings();
        overrides = { ...(settings.themeTokens || {}) };
      } catch (_) {}
      return { Tokens, theme: resolveTheme(), overrides, applyLive, persist, doc: document };
    };
    return R.buildButton(a, { Tokens, resolve });
  }

  // Cosa fa il comando a parole (#892): il main l'ha già ripulita, qui resta testo.
  function spiegazioneDi(a) {
    return a && typeof a.spiegazione === 'string' ? a.spiegazione.trim() : '';
  }

  const PREF_TERMINALE = 'filo://preferences/preferences.html#sec-terminal';

  // La prima volta che Filo propone o esegue un comando (#892): cosa succede e
  // dove si spegne. Disegnata, è detta: da qui il main non la allega più.
  function notaPrimaVolta() {
    Promise.resolve().then(() => global.SN_STORAGE.setRaw(global.SN_CONST.STORAGE_KEYS.FILO_TERMINALE_SPIEGATO, true)).catch(() => {});
    const nota = document.createElement('div');
    nota.className = 'dash-cmd-primavolta';
    nota.append('Per questo uso il terminale del computer: quello che legge parte subito, quello che cambia qualcosa te lo chiedo prima. Si spegne in ');
    const link = document.createElement('a');
    link.href = PREF_TERMINALE;
    link.textContent = 'Preferenze';
    link.title = 'Apri le Preferenze del terminale';
    link.addEventListener('click', (e) => {
      e.preventDefault();
      send({ type: MSG.OPEN_URL, url: PREF_TERMINALE });
    });
    nota.append(link, '.');
    return nota;
  }

  // Esito di un comando da terminale mostrato in chat (#146.6): cosa fa a
  // parole, la riga di comando + stdout/stderr in monospazio, con note per
  // uscita/timeout/troncamento, o l'avviso "modalità terminale disattivata".
  function renderCommandResult(out, spiegazione = '') {
    const wrap = document.createElement('div');
    wrap.className = 'dash-cmd-result';
    if (!out) return wrap;
    if (out.blocked === 'disabled') {
      wrap.classList.add('dash-cmd-blocked');
      wrap.textContent = 'Modalità terminale disattivata: attivala nelle impostazioni perché Filo possa eseguire comandi.';
      return wrap;
    }
    if (out.blocked === 'empty') {
      wrap.classList.add('dash-cmd-blocked');
      wrap.textContent = 'Comando vuoto.';
      return wrap;
    }
    if (spiegazione) {
      const cosa = document.createElement('div');
      cosa.className = 'dash-cmd-cosa';
      cosa.textContent = spiegazione;
      wrap.appendChild(cosa);
    }
    const cmdLine = document.createElement('div');
    cmdLine.className = 'dash-cmd-line';
    cmdLine.textContent = `$ ${out.command || ''}`;
    wrap.appendChild(cmdLine);
    const body = (out.stdout || '') + (out.stderr ? (out.stdout ? '\n' : '') + out.stderr : '');
    if (body.trim()) {
      const pre = document.createElement('pre');
      pre.className = 'dash-cmd-output';
      if (out.stderr && !out.stdout) pre.classList.add('dash-cmd-output-err');
      pre.textContent = body;
      wrap.appendChild(pre);
    } else {
      // Comando senza output (tipicamente un `cd`): non lasciare una scatola
      // vuota e invisibile — mostra SEMPRE una risposta. Per i cambi di
      // cartella diciamo dove sei finito ("sei in <percorso>"); per gli altri
      // comandi muti un neutro "(nessun output)".
      const empty = document.createElement('pre');
      empty.className = 'dash-cmd-output dash-cmd-output-empty';
      const isCd = /^\s*(cd|chdir)\b/i.test(out.command || '');
      empty.textContent = (isCd && out.cwd) ? `sei in ${out.cwd}` : '(nessun output)';
      wrap.appendChild(empty);
    }
    const notes = [];
    if (typeof out.code === 'number' && out.code !== 0) notes.push(`uscita ${out.code}`);
    if (out.timedOut) notes.push('interrotto per timeout');
    if (out.truncated) notes.push('output troncato');
    if (notes.length) {
      const note = document.createElement('div');
      note.className = 'dash-cmd-note';
      note.textContent = notes.join(' · ');
      wrap.appendChild(note);
    }
    return wrap;
  }

  // #376 — traccia di un PASSO INTERMEDIO (cerco sul web, leggo un file,
  // verifico cosa so fare). Racconta cosa sta facendo Filo, ma non è un bottone:
  // niente pill né bordo, così l'unica cosa cliccabile nella conversazione resta
  // il risultato vero (il link aperto). Prima queste tracce avevano la stessa
  // forma dei bottoni e l'utente ne contava due per una singola azione.
  function stepTrace(text) {
    const el = document.createElement('div');
    el.className = 'dash-action-step';
    el.textContent = String(text || '').trim();
    return el;
  }

  // #950 — un file trovato da Filo: dal tasto destro si apre o gli si dà un nome sensato, e il riferimento in
  // chat segue il nome nuovo (un clic dopo apre il file, non il percorso che non c'è più).
  const nomeDelPercorso = (p) => String(p || '').split(/[\\/]/).pop();
  function menuDelFile(btn, a) {
    const R = window.SN_RINOMINA_UI;
    if (!R) return;
    const aggiorna = (r) => {
      if (!r || !r.a) return;
      const vecchio = String(a.percorso || a.path || '');
      const etichetta = String(a.etichetta || a.label || '');
      a.percorso = r.a;
      if (a.path) a.path = r.a;
      if (etichetta && (etichetta === vecchio || etichetta === nomeDelPercorso(vecchio))) {
        if (a.etichetta) a.etichetta = r.nome; else a.label = r.nome;
      }
      btn.href = r.a;
      btn.textContent = a.etichetta || a.label || r.a;
    };
    const apriMenu = (e) => {
      e.preventDefault();
      const rect = btn.getBoundingClientRect();
      const x = e.type === 'contextmenu' && e.clientX ? e.clientX : rect.left;
      const y = e.type === 'contextmenu' && e.clientY ? e.clientY : rect.bottom;
      R.disponibile().then((disp) => {
        const percorso = String(a.percorso || a.path || '');
        const nome = nomeDelPercorso(percorso);
        const voci = [['Apri', () => btn.click()]];
        if (disp && percorso && R.tipoSupportato(nome)) {
          voci.push([R.VOCE, () => R.apri({ ancora: btn, percorso, nome, suRinominato: aggiorna, suRimesso: aggiorna })]);
        }
        if (R.nomeDiPrima(percorso)) voci.push([R.VOCE_RIMETTI, () => R.rimetti({ ancora: btn, percorso, suRimesso: aggiorna })]);
        R.menu(x, y, voci, { ancora: btn });
      });
    };
    btn.addEventListener('contextmenu', apriMenu);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) apriMenu(e);
    });
  }

  function testoRinominati(o) {
    const n = o && Array.isArray(o.rinominati) ? o.rinominati.length : 0;
    const no = o && Array.isArray(o.falliti) ? o.falliti.length : 0;
    const quanti = n === 1 ? 'Rinominato un file' : `Rinominati ${n} file`;
    return no ? `${quanti} · ${no} non riusciti` : quanti;
  }
  function motivoNessunaRinomina(o) {
    const f = o && Array.isArray(o.falliti) && o.falliti[0];
    return f && f.perche ? `Non rinominati: ${f.perche}` : 'Non rinominati';
  }
  // «Annulla» dopo una rinomina dalla chat: rimette i nomi di prima di TUTTI i file del lotto.
  function bottoneRimettiNomi(a) {
    const o = a && a._output;
    const fatti = o && Array.isArray(o.rinominati) ? o.rinominati : [];
    if (!fatti.length) return null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dash-action-btn';
    btn.textContent = o.rimessi ? '↺ Nomi di prima rimessi' : '↺ Annulla';
    btn.title = fatti.length === 1 ? `Rimetti «${fatti[0].prima}»` : `Rimetti i nomi di prima ai ${fatti.length} file`;
    btn.disabled = !!o.rimessi;
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      let r = null;
      try { r = await send({ type: MSG.FILE_RIMETTI_NOMI, coppie: fatti.map((x) => ({ attuale: x.a, prima: x.prima })) }); } catch (_) { r = null; }
      const esiti = r && Array.isArray(r.esiti) ? r.esiti : [];
      const ok = esiti.filter((e) => e && e.ok).length;
      if (ok && ok === fatti.length) {
        o.rimessi = true;
        btn.textContent = '↺ Nomi di prima rimessi';
        return;
      }
      btn.disabled = false;
      const primo = esiti.find((e) => e && !e.ok);
      btn.textContent = ok ? `↺ Rimessi ${ok} su ${fatti.length}: riprova` : '↺ Annulla non riuscito: riprova';
      if (primo && primo.frase) btn.title = primo.frase;
      // Quelli già rimessi non si rimettono due volte: alla prossima pressione restano solo gli altri.
      const rimasti = fatti.filter((x, i) => !(esiti[i] && esiti[i].ok));
      o.rinominati = rimasti;
    });
    return btn;
  }

  function renderActionButton(a, { onAck, activity = null } = {}) {
    const type = String(a.type || '').toUpperCase();
    // In attesa di conferma come le altre, ma la si dà dalla loro UI: il
    // bottone del riordino, il pannello con l'elenco da eliminare.
    if (type === 'PULISCI_TAB') return renderBottoneRiordino(a, activity);
    if (type === 'CANCELLA_ARCHIVIO') return renderDeleteArchivePanel(a, activity);
    // Azione sospesa in attesa di conferma (#146.2): il main non l'ha eseguita
    // (livello 2 o 3) e ha allegato spiegazione + livello. Il bottone apre il
    // popup OK/Annulla (2) o il box "digita conferma" (3); solo dopo il sì
    // dell'utente l'azione parte davvero via MSG.FILO_CONFIRM_ACTION.
    if (a._confirm && a._confirm.level >= 2) {
      const btn = document.createElement('button');
      btn.className = 'dash-action-btn dash-action-btn-primary';
      btn.type = 'button';
      // Il comando sul bottone è accorciato; intero sta nel popup e al passaggio del mouse.
      const cmdText = String(a.comando || a.command || a.cmd || '').trim();
      const isCmd = type === 'ESEGUI_COMANDO';
      const short = cmdText.length > 60 ? `${cmdText.slice(0, 57)}…` : cmdText;
      // Il testo completo (cosa fa + rischi, #183) vive nel popup. Sul bottone —
      // che resta solo come ripiego se l'utente annulla — basta la prima riga.
      const fullText = String(a._confirm.text || '');
      // I due punti finali annunciano il testo che segue nel popup ("…a tuo
      // nome:"): sul bottone, dove quel testo non c'è, restano appesi nel vuoto.
      const shortLabel = (fullText.split('\n')[0] || 'Esegui').replace(/\s*:\s*$/, '');
      // Un comando dice prima a parole cosa fa, e sotto il comando vero (#892).
      const cosa = isCmd ? spiegazioneDi(a) : '';
      const segnaComando = (simbolo) => {
        if (!cosa) { btn.textContent = `${simbolo} ${short}`; return; }
        const riga = document.createElement('span');
        riga.className = 'dash-cmd-btn-cosa';
        riga.textContent = `${simbolo} ${cosa}`;
        const codice = document.createElement('code');
        codice.className = 'dash-cmd-btn-codice';
        codice.textContent = short;
        btn.replaceChildren(riga, codice);
      };
      if (isCmd) {
        if (cosa) btn.classList.add('dash-cmd-btn');
        if (short !== cmdText) btn.title = cmdText;
        segnaComando('▶');
      } else {
        btn.textContent = shortLabel;
      }
      // #159/#414 — le azioni di livello 2 che Filo PROPONE da sé aprono il
      // popup di conferma da sole: marchiamo il bottone perché renderActions lo
      // possa aprire automaticamente. Oltre alle impostazioni (preferenza/
      // estetica) c'è la segnalazione agli sviluppatori: è Filo a proporla dopo
      // aver ammesso una mancanza, quindi lasciarla come chip da cliccare
      // aggiungeva un passaggio in più prima ancora di poter leggere cosa
      // partirebbe a nome dell'utente. Il popup non invia nulla: mostra il testo
      // e aspetta l'OK, esattamente come nella sidebar (che già fa così).
      // Le azioni distruttive (livello 3) e i comandi restano a click esplicito.
      const AUTO_CONFIRM_TYPES = ['IMPOSTA_PREFERENZA', 'IMPOSTA_ESTETICA', 'INVIA_FEEDBACK', 'SALVA_LEZIONE', 'DIMENTICA', 'RINOMINA_FILE'];
      if (AUTO_CONFIRM_TYPES.includes(type) && a._confirm.level === 2) {
        btn.dataset.autoConfirm = '1';
      }
      // La conferma (popup + esecuzione) è una funzione a sé, così renderActions
      // può aprirla DA SOLA — anche in sequenza quando ci sono più azioni di
      // livello 2 nella stessa risposta (#183) — oltre che al click manuale.
      // Ritorna una Promise che si risolve quando il popup è chiuso, perché
      // l'auto-apertura sequenziale possa attendere l'una prima della successiva.
      async function runConfirm() {
        if (btn.disabled) return;
        const Ui = window.SN_CONFIRM_UI;
        const opts = { title: 'Filo chiede conferma', text: a._confirm.text || '' };
        const ok = Ui
          ? await (a._confirm.level >= 3 ? Ui.confirmTyped(opts) : Ui.confirm(opts))
          : window.confirm(opts.text); // fallback se il modulo non è caricato
        if (!ok) return;
        btn.disabled = true;
        const r = await send({ type: MSG.FILO_CONFIRM_ACTION, action: a, parole: paroleUtente() });
        // Nemmeno l'OK fa uscire un segreto (#810): la riga dice cosa è stato fermato.
        if (r && r.output && r.output.blocked === 'segreto') {
          a._output = r.output;
          a._executed = false;
          delete a._confirm;
          const row = activityRowFor(a);
          if (activity && row) activity.addRow(row.tipo || a.type, row.icon, row.text, !!row.failed, row.cambi);
          btn.textContent = `🔒 ${row ? row.text : 'Fermata'}`;
          return;
        }
        // L'utente ha detto sì: da qui in poi l'azione è FATTA. Lo deve sapere
        // il diario (una riga come per le azioni di livello 1) e lo deve sapere
        // il MODELLO al turno dopo — l'oggetto è lo stesso che sta nello
        // storico della conversazione, quindi basta segnarlo qui. Senza,
        // a «l'hai attivato?» il modello poteva solo tirare a indovinare.
        if (r && r.executed) segnaConfermata(a, r.output, activity, r.cambi);
        // #146.6 — comando confermato (livello 2/3): mostra l'output in chat.
        if (isCmd) {
          segnaComando((r && r.executed) ? '✓' : '✗');
          if (r && r.output) btn.after(renderCommandResult(r.output));
          if (r && r.output) applyCommandCwd([{ _output: r.output }]);
          return;
        }
        btn.textContent = (r && r.executed) ? `✓ ${shortLabel}` : '✗ Non eseguita';
        // #950 — i file rinominati: il bottone dice quanti, e accanto c'è la strada per rimetterli com'erano.
        if (type === 'RINOMINA_FILE') {
          btn.textContent = (r && r.executed) ? `✓ ${testoRinominati(r.output)}` : `✗ ${motivoNessunaRinomina(r && r.output)}`;
          if (r && r.executed) btn.after(bottoneRimettiNomi(a));
        }
        // #146.4 — modifica estetica illeggibile (livello 2): confermata ed
        // applicata, offriamo subito il box per correggere il valore.
        if (r && r.executed && type === 'IMPOSTA_ESTETICA') {
          const refiner = buildAestheticRefiner(a);
          if (refiner) btn.after(refiner);
        }
      }
      btn._runConfirm = runConfirm;
      btn.addEventListener('click', runConfirm);
      return btn;
    }
    if (type === 'ESEGUI_COMANDO') {
      // Livello 1 (sola lettura) già eseguito dal main, oppure esito bloccato
      // (terminale spento): mostriamo direttamente il risultato in chat.
      return renderCommandResult(a._output, spiegazioneDi(a));
    }
    if (type === 'IMPOSTA_ESTETICA') {
      // Livello 1 (caso normale): Filo l'ha già applicata server-side. Mostriamo
      // direttamente il bottone di raffinamento.
      return buildAestheticRefiner(a);
    }
    if (type === 'NAVIGA' && apribileComunque(a)) return bottoneApriComunque(a);
    if (type === 'NAVIGA') {
      // #162 — il link è già stato aperto direttamente dal main (executeFiloAction
      // apre la scheda). Questo chip resta come riferimento per RIAPRIRLO, ma deve
      // SEMPRE avere un'etichetta leggibile: il favicon da solo, senza testo, era
      // il bottone "misterioso" del feedback. Mostriamo favicon + nome del sito.
      let label = String(a.label || a.etichetta || '').trim();
      if (!label) {
        try { label = new URL(a.url).hostname.replace(/^www\./, ''); } catch (_) { label = a.url || 'Apri'; }
      }
      // #376 — aperto in SECONDO PIANO: la scheda esiste già e sta suonando
      // dietro. Il chip allora non è più "riapri" ma "portami lì": attiva
      // QUELLA scheda invece di aprirne un doppione sullo stesso indirizzo.
      const bgTabId = (a._output && a._output.background && a._output.tabId) || '';
      const btn = document.createElement(bgTabId ? 'button' : 'a');
      if (bgTabId) {
        btn.type = 'button';
        btn.dataset.bgTab = bgTabId;
        btn.title = `Vai alla scheda — ${label} è aperta in secondo piano`;
        btn.addEventListener('click', async () => {
          const r = await send({ type: MSG.FOCUS_TAB, id: bgTabId });
          // Se quella scheda nel frattempo è stata chiusa, il riferimento deve
          // comunque funzionare: riapre il link invece di non fare nulla.
          if (!r || !r.ok) apriProposta(a.url || '', btn);
        });
      } else {
        btn.href = a.url || '#';
        btn.target = '_blank';
        btn.rel = 'noopener';
        btn.title = `Riapri ${label}`;
      }
      btn.className = 'dash-action-btn dash-action-link-chip';
      if (a._callId) btn.dataset.callId = String(a._callId);
      const favUrl = faviconUrl(a.url);
      if (favUrl) {
        const img = document.createElement('img');
        img.className = 'dash-action-favicon';
        img.src = favUrl;
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        img.onerror = () => img.remove();
        btn.appendChild(img);
      }
      btn.appendChild(document.createTextNode(bgTabId ? `▸ ${label}` : `↗ ${label}`));
      return btn;
    }
    if (type === 'RINOMINA_FILE') return bottoneRimettiNomi(a);
    if (type === 'APRI_FILE') {
      const btn = document.createElement('a');
      btn.className = 'dash-action-btn';
      const filePath = a.percorso || a.path || '';
      btn.href = filePath || '#';
      btn.target = '_blank';
      btn.rel = 'noopener';
      btn.textContent = a.etichetta || a.label || (filePath || 'File');
      menuDelFile(btn, a);
      return btn;
    }
    if (type === 'TIMER') {
      const btn = document.createElement('button');
      btn.className = 'dash-action-btn';
      btn.type = 'button';
      btn.disabled = true;
      const sec = Number(a.seconds || a.secondi || 0);
      // #323 — durata umana fedele all'intento: "30 sec", "2 h", "1 h 30 min".
      // Niente arrotondamento ai minuti (un timer di 30 secondi non è "0 min").
      const dur = (self.SN_TIME ? self.SN_TIME.fmtDurationLabel(sec)
        : `${Math.round(sec / 60)} min`);
      btn.textContent = `⏱ ${a.label || a.etichetta || 'Timer'} · ${dur}`;
      return btn;
    }
    if (type === 'SALVA_APPUNTO') {
      // Ora che gli appunti vivono SOLO nei file dell'editor, la conferma non
      // può restare un chip inerte: sarebbe un vicolo cieco (l'utente sa che
      // Filo ha scritto, ma non ha da dove andare a leggere). Il chip resta la
      // ricevuta dell'azione — già eseguita — e in più apre l'editor, cioè il
      // posto dove l'appunto è finito.
      const btn = document.createElement('button');
      btn.className = 'dash-action-btn';
      btn.type = 'button';
      btn.dataset.action = 'openNotes';
      btn.textContent = '✎ Salvato';
      btn.title = 'Apri l’editor';
      btn.addEventListener('click', () => send({ type: MSG.OPEN_URL, url: 'filo://editor/editor.html' }));
      return btn;
    }
    if (type === 'SVEGLIA') {
      const btn = document.createElement('button');
      btn.className = 'dash-action-btn';
      btn.type = 'button';
      btn.disabled = true;
      btn.textContent = `⏰ ${a.time || a.orario || ''} ${a.label || ''}`.trim();
      return btn;
    }
    if (type === 'CERCA_WEB') {
      // Traccia del passo intermedio: rende trasparente che Filo sta cercando sul
      // web (#368). La ricerca è già partita nel main e i risultati rientrano nel
      // turno successivo (auto-continue), dove compare la risposta con i link
      // REALI. NON è un bottone: prima aveva la forma di una pill e l'utente si
      // ritrovava "due bottoni" per una cosa sola (#376).
      return stepTrace(`🔎 Cerco sul web: ${a.query || ''}`.trim());
    }
    if (type === 'CAPACITA_DETTAGLIO') {
      // Traccia del passo intermedio: Filo sta consultando il proprio manifesto
      // delle capacità (#F2) prima di rispondere.
      return stepTrace('📖 Verifico cosa so fare');
    }
    if (type === 'LEGGI_FILE') {
      // Traccia del passo intermedio: Filo apre un file dell'editor per leggerlo
      // per intero (#379.5). Il contenuto rientra nel turno successivo
      // (auto-continue), dove compare la risposta.
      const title = (a._output && a._output.title) || '';
      return stepTrace(title ? `📄 Leggo: ${title}` : '📄 Leggo un file');
    }
    if (type === 'LEGGI_DOCUMENTO') {
      // Traccia del passo intermedio: Filo apre un documento dal disco (un PDF,
      // un file di testo). Il contenuto rientra nel turno successivo
      // (auto-continue), dove compare la risposta.
      const nome = (a._output && a._output.name) || '';
      return stepTrace(nome ? `📄 Leggo il documento: ${nome}` : '📄 Leggo il documento');
    }
    if (type === 'LEGGI_TRASPARENZA') {
      // Traccia del passo intermedio: Filo rilegge le scelte dell'owner messe
      // per iscritto prima di rispondere sul perché di un modello o di un dato.
      return stepTrace('📄 Rileggo la pagina di trasparenza');
    }
    if (type === 'EVENTO_CALENDARIO') {
      const btn = document.createElement('button');
      btn.className = 'dash-action-btn';
      btn.type = 'button';
      btn.disabled = true;
      btn.textContent = `📅 ${a.title || a.titolo || ''}`;
      return btn;
    }
    return null;
  }

  // Confermata e fatta: lo sanno il diario e, al turno dopo, il modello (è lo
  // stesso oggetto che sta nello storico della conversazione).
  function segnaConfermata(a, output, activity, cambi) {
    a._confirmed = true;
    a._executed = true;
    delete a._confirm;
    if (output) a._output = output;
    const ids = Array.isArray(cambi) ? cambi : [];
    if (ids.length) {
      a._cambi = ids;
      if (activity && activity.el && global.SN_DASH_CAMBI) global.SN_DASH_CAMBI.segna(activity.el, ids);
    }
    const row = activityRowFor(a);
    if (activity && row) activity.addRow(a.type, row.icon, row.text, !!row.failed, row.cambi);
    // L'archivio delle chat ha salvato il turno senza le azioni in attesa: questa adesso è successa.
    try { archiviaAzione(String(a.type || '').toUpperCase(), ids.map((c) => c.id)); } catch (_) {}
  }

  // La pulizia parte SOLO al click, con conferma, mai da sola (spec §2.1).
  function renderBottoneRiordino(a, activity) {
    const btn = document.createElement('button');
    btn.className = 'dash-action-btn dash-action-btn-primary';
    btn.type = 'button';
    btn.textContent = '🧹 Riordina e archivia le schede';
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      // Livello 2 (#146.2): popup Filo che spiega la modifica, non il
      // window.confirm nativo (PATTERNS.md: niente default del browser).
      const text = 'Filo valuterà tutte le schede aperte e archivierà quelle non più utili. '
        + 'Le schede archiviate restano riapribili da “Tab archiviate”.';
      const ok = window.SN_CONFIRM_UI
        ? await window.SN_CONFIRM_UI.confirm({ title: 'Riordino delle schede', text, okLabel: 'Procedi' })
        : window.confirm(`${text} Procedo?`);
      if (!ok) return;
      btn.disabled = true;
      btn.textContent = '🧹 Riordino in corso…';
      const r = await send({ type: MSG.RUN_TAB_TRIAGE });
      if (!r || !r.ok) {
        btn.disabled = false;
        btn.textContent = '🧹 Riordino non riuscito · riprova';
        return;
      }
      const n = r.archived || 0;
      btn.textContent = n > 0
        ? `✓ Archiviate ${n} ${n === 1 ? 'scheda' : 'schede'}`
        : '✓ Nessuna scheda da archiviare';
      segnaConfermata(a, { archived: n }, activity);
    });
    return btn;
  }

  // §5 — pannello di cancellazione retroattiva: propone TUTTE e SOLE le schede
  // archiviate pertinenti (le sceglie il main) e le elimina DEFINITIVAMENTE
  // dopo conferma esplicita.
  function renderDeleteArchivePanel(a, activity) {
    const query = String(a.query || a.testo || '').trim();
    const panel = document.createElement('div');
    panel.className = 'dash-delete-panel';
    const note = document.createElement('div');
    note.className = 'dash-delete-note';
    panel.appendChild(note);

    async function cerca() {
      panel.querySelectorAll('.dash-delete-list, .dash-action-btn').forEach((el) => el.remove());
      if (!query) {
        note.textContent = 'Non so quali schede eliminare: dimmi di cosa parlano.';
        return;
      }
      note.dataset.cerco = '1';
      const cercoTesto = `Cerco nell’archivio: “${query}”…`;
      note.textContent = cercoTesto;
      // Con un archivio grande il giudizio dura: il main dice quante schede ha già guardato.
      const richiesta = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const suAvanzamento = (m) => {
        if (!m || m.type !== MSG.ARCHIVIO_DA_CANCELLARE_AVANZAMENTO || m.richiesta !== richiesta) return;
        if (note.dataset.cerco !== '1') return;
        note.textContent = `${cercoTesto} ${m.fatte} di ${m.totali} schede guardate`;
      };
      try { chrome.runtime.onMessage.addListener(suAvanzamento); } catch (_) {}
      let r = null;
      try {
        r = await send({ type: MSG.ARCHIVIO_DA_CANCELLARE, query, richiesta });
      } finally {
        try { chrome.runtime.onMessage.removeListener(suAvanzamento); } catch (_) {}
        delete note.dataset.cerco;
      }
      const results = (r && r.ok && Array.isArray(r.results)) ? r.results : null;
      if (!results) {
        // Senza un giudizio completo non si propone niente: un elenco a metà
        // farebbe credere di aver tolto tutto.
        note.textContent = `Non sono riuscito a capire quali schede riguardano “${query}”.`;
        const again = document.createElement('button');
        again.className = 'dash-action-btn';
        again.type = 'button';
        again.textContent = 'Riprova';
        again.addEventListener('click', () => { cerca(); });
        panel.appendChild(again);
        return;
      }
      if (!results.length) {
        note.textContent = `Nessuna scheda archiviata riguarda “${query}”.`;
        return;
      }
      const quante = (n) => `${n} ${n === 1 ? 'scheda' : 'schede'}`;
      note.textContent = results.length === 1
        ? `Trovata 1 scheda pertinente a “${query}”. Verrà eliminata DEFINITIVAMENTE:`
        : `Trovate ${results.length} schede pertinenti a “${query}”. Verranno eliminate DEFINITIVAMENTE:`;
      // Le sceglie un modello: chi conferma deve poter togliere quella presa per sbaglio.
      const ul = document.createElement('ul');
      ul.className = 'dash-delete-list';
      const scelte = [];
      for (const it of results) {
        const li = document.createElement('li');
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = true;
        const titolo = document.createElement('span');
        titolo.textContent = it.title || it.url || '(senza titolo)';
        li.title = [it.title, it.url].filter(Boolean).join('\n');
        label.append(box, titolo);
        li.appendChild(label);
        ul.appendChild(li);
        scelte.push({ it, box });
      }
      panel.appendChild(ul);

      const del = document.createElement('button');
      del.className = 'dash-action-btn dash-action-btn-danger';
      del.type = 'button';
      const spuntate = () => scelte.filter((x) => x.box.checked).map((x) => x.it);
      const etichetta = () => {
        const n = spuntate().length;
        del.textContent = `🗑 Elimina definitivamente ${quante(n)}`;
        del.disabled = n === 0;
      };
      ul.addEventListener('change', etichetta);
      etichetta();
      del.addEventListener('click', async () => {
        if (del.disabled) return;
        const scelta = spuntate();
        if (!scelta.length) return;
        // Livello 3 (#146.2): eliminazione irreversibile → l'utente deve
        // digitare espressamente "conferma".
        const text = `Eliminare definitivamente ${quante(scelta.length)} dall’archivio.`;
        const ok = window.SN_CONFIRM_UI
          ? await window.SN_CONFIRM_UI.confirmTyped({ title: 'Eliminazione definitiva', text, okLabel: 'Elimina' })
          : window.confirm(`${text} L’operazione non è reversibile.`);
        if (!ok || del.disabled) return;
        del.disabled = true;
        scelte.forEach((x) => { x.box.disabled = true; });
        del.textContent = 'Elimino…';
        const res = await send({ type: MSG.DELETE_ARCHIVED_TABS, ids: scelta.map((x) => x.id) });
        if (!res || !res.ok) {
          scelte.forEach((x) => { x.box.disabled = false; });
          etichetta();
          note.textContent = 'Eliminazione non riuscita: l’archivio è com’era. Riprova.';
          return;
        }
        const removed = res.removed || 0;
        del.remove();
        ul.remove();
        note.textContent = removed === 1
          ? '✓ Eliminata definitivamente 1 scheda.'
          : `✓ Eliminate definitivamente ${quante(removed)}.`;
        segnaConfermata(a, { eliminate: removed }, activity);
      });
      panel.appendChild(del);
    }
    cerca();
    return panel;
  }

  function init(deps) {
    send = deps.send;
    if (deps.faviconUrl) faviconUrl = deps.faviconUrl;
    if (deps.applyCommandCwd) applyCommandCwd = deps.applyCommandCwd;
    if (deps.paroleUtente) paroleUtente = deps.paroleUtente;
    if (deps.apriProposta) apriProposta = deps.apriProposta;
    if (deps.archiviaAzione) archiviaAzione = deps.archiviaAzione;
  }

  global.SN_DASH_ATTIVITA = {
    init,
    // Il contratto: un blocco di attività appeso a `container`.
    create: createActivity,
    renderActions,
    aperturaFermata,
    tellActionInActivity,
    stepTrace,
    isType,
    // #525 — «Ha aperto una pagina e avviato un timer»: la stessa frase del
    // diario del turno, per chi RIAPRE una chat archiviata. Lì i bottoni non
    // si rimettono (un'azione da confermare non si può ri-offrire giorni
    // dopo): resta il racconto di cosa Filo ha fatto.
    summarizeActivity,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
