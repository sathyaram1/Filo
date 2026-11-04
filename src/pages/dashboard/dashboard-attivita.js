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
// working, addRow, addCommand, azioneSenzaRiga, absorbBubble, aggiungiNota, dropNote,
// fineGiro, fineDiretta, endTurn, taglia, finish, remove). Il filo che lo
// disegna sta in filo-attesa.js. Il container è esplicito apposta: chi disegna un blocco decide
// dove, invece di scoprire a posteriori che finisce sempre nelle bolle.
//
// Forma del modulo: IIFE che si registra su globalThis e NON tocca il DOM al
// caricamento — solo dentro `init`.
(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;

  // Dipendenze dalla pagina, riempite da init().
  let send = null;
  let allegaFile = null;
  let iconaDelSito = () => Promise.resolve('');
  let applyCommandCwd = () => {};
  let paroleUtente = () => [];
  let apriProposta = () => {};
  let archiviaAzione = () => {};
  let chatAttuale = () => '';
  let sceltaAutonomiaEl = () => null;
  let sceltaContatoriEl = () => null;
  let prosegui = () => {};
  // #778 — mentre i popup di una risposta si aprono in fila, la ripresa aspetta l'ultimo: un turno partito a metà
  // fila troverebbe le altre richieste ancora senza risposta, e le rifarebbe.
  // `chat`: la conversazione in cui è nato il bottone; la pagina riprende solo se è ancora quella a schermo (#1373).
  // `voci`: com'è andata ogni conferma della fila, che la ripresa porta al modello tutte insieme.
  let filaPopup = 0;
  let riprendiDopoFila = null;
  let vociDopoOk = [];
  // `gruppo`: i bottoni di conferma di una stessa risposta (#1685). Come negli harness di Anthropic, il lavoro riprende
  // quando ognuno ha avuto la sua risposta, con gli esiti di tutti; se sono stati solo no, non riprende.
  function proseguiQuandoLibero(chat = '', voce = null, gruppo = null, a = null) {
    if (gruppo) {
      if (a) gruppo.pendenti.delete(a);
      if (voce) gruppo.voci.push(voce);
      if (gruppo.pendenti.size || !gruppo.voci.length) return;
      vociDopoOk.push(...gruppo.voci);
      gruppo.voci = [];
    } else if (voce) vociDopoOk.push(voce);
    // Senza un esito da portare (un no, anche al bottone ridato di una chat riaperta) il lavoro non riparte.
    else return;
    if (filaPopup > 0) riprendiDopoFila = { chat };
    else riprendiOra(chat);
  }
  function riprendiOra(chat) {
    const voci = vociDopoOk;
    vociDopoOk = [];
    prosegui(chat, voci);
  }
  // La stessa voce che l'archivio ha appena scritto, se c'è: il modello che riparte legge la riga della chat riaperta.
  function voceDellaConferma(a) {
    if (a && a._voce) return { ...a._voce };
    try { return global.SN_ESITO.voceArchivio(a); } catch (_) { return null; }
  }

  function isType(a, t) {
    return a && String(a.type || '').toUpperCase() === t;
  }

  // ===== Blocco di attività della domanda (#521, #578) =====
  // UNO per messaggio dell'utente, sopra la risposta. Mentre Filo lavora a sinistra corre un filo: niente scritte
  // di stato, solo la trama del ragionamento e un nodo per ogni pensiero che ha fatto nascere delle azioni. Quando
  // comincia la risposta il filo si avvolge in un gomitolo col riassunto e la durata; un clic lo srotola.
  // Regole: patterns/il-filo-dell-attesa.md. Senza niente da raccontare il blocco si toglie da solo.
  function createActivity(container) {
    const Filo = global.SN_FILO_ATTESA;
    const wrap = document.createElement('div');
    wrap.className = 'dash-activity';
    wrap.dataset.phase = 'wait';
    wrap.dataset.filo = 'disteso';
    wrap.setAttribute('aria-busy', 'true');
    wrap.setAttribute('aria-label', 'Filo sta lavorando');
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'dash-activity-head';
    head.setAttribute('aria-expanded', 'true');
    head.hidden = true;
    const label = document.createElement('span');
    label.className = 'dash-activity-label';
    head.append(label);
    const body = document.createElement('div');
    body.className = 'dash-activity-body';
    wrap.append(head, body);
    container.appendChild(wrap);
    container.scrollTop = container.scrollHeight;

    const startedAt = Date.now();
    let phase = 'wait';
    // Ragionamento del turno per lo storico del thread: l'ultimo blocco chiuso torna con endTurn.
    let turnReasoning = '';
    let turnStartedAt = 0;
    let lastTurn = { text: '', ms: 0 };
    let sawReasoning = false;
    // Le azioni del lavoro col loro esito, nell'ordine: da qui nasce il riassunto. La stessa azione che torna
    // (confermata dopo, o finita col bottone) aggiorna la sua voce invece di contarsi due volte.
    const doneTypes = [];
    let fallito = false;
    // Le sezioni: un pensiero e le azioni che ne sono nate. `viva` è quella che riceve adesso.
    const segs = [];
    let viva = null;
    let aperta = null;
    let fermato = false;
    // Un rifiuto della regola (#530) si legge senza cercarlo: a fine lavoro il blocco resta srotolato, sul suo nodo.
    let tieniAperto = false;
    let nodoDaAprire = null;
    let inDiretta = true;
    let fineLavoro = 0;
    let anonime = 0;

    const followThread = () => {
      const near = container.scrollHeight - container.scrollTop - container.clientHeight < 48;
      if (near) container.scrollTop = container.scrollHeight;
    };
    const setPhase = (p) => {
      phase = p;
      wrap.dataset.phase = p;
      if (p === 'done') { wrap.removeAttribute('aria-busy'); wrap.removeAttribute('aria-label'); }
    };
    const filo = Filo.crea({ wrap, body, apri: (el) => { const s = segs.find((x) => x.el === el); if (s) apri(s); } });

    function apri(seg, forza = null) {
      if (seg.stato === 'coda') return;
      const v = forza === null ? aperta !== seg : forza;
      // Un nodo che è solo un bottone sotto la risposta (un link aperto) non ha niente da mostrare dentro.
      if (v && !seg.cot && !seg.corpo.querySelector('.dash-activity-note') && !seg.esiti.childElementCount) return;
      if (aperta && aperta !== seg) { aperta.corpo.hidden = true; aperta.el.classList.remove('dash-activity-seg-aperta'); aperta.testa.setAttribute('aria-expanded', 'false'); }
      // A metà dello srotolamento la tendina ha l'altezza di prima: la sezione aperta ci finirebbe sotto, tagliata.
      if (body.style.maxHeight && body.style.maxHeight !== '0px') body.style.maxHeight = '';
      aperta = v ? seg : null;
      seg.corpo.hidden = !v;
      seg.el.classList.toggle('dash-activity-seg-aperta', v);
      seg.testa.setAttribute('aria-expanded', v ? 'true' : 'false');
      if (v) seg.corpo.scrollTop = seg.stato === 'pensa' ? seg.corpo.scrollHeight : 0;
      filo.sveglia();
      followThread();
    }

    function nuovaSeg(stato) {
      const el = document.createElement('div');
      el.className = 'dash-activity-seg';
      const testa = document.createElement('button');
      testa.type = 'button';
      testa.className = 'dash-activity-seg-head';
      testa.setAttribute('aria-expanded', 'false');
      const eti = document.createElement('span');
      eti.className = 'dash-activity-seg-label';
      testa.append(eti);
      const trama = document.createElement('div');
      trama.className = 'dash-activity-trama';
      trama.tabIndex = 0;
      trama.setAttribute('role', 'button');
      trama.setAttribute('aria-label', 'Il ragionamento in corso');
      const tramaTesto = document.createElement('span');
      trama.append(tramaTesto);
      const corpo = document.createElement('div');
      corpo.className = 'dash-activity-seg-body';
      corpo.hidden = true;
      const esiti = document.createElement('div');
      esiti.className = 'dash-activity-esiti';
      corpo.append(esiti);
      el.append(testa, trama, corpo);
      // La coda (l'ultimo pensiero) resta l'ultima: chi arriva dopo la risposta le passa davanti.
      const coda = segs.find((s) => s.stato === 'coda');
      body.insertBefore(el, coda ? coda.el : null);
      const seg = { el, testa, eti, trama, tramaTesto, corpo, esiti, cot: null, testo: '', voci: [], attese: new Set(), nodo: null, esito: null, stato: '' };
      testa.addEventListener('click', () => apri(seg));
      trama.addEventListener('click', () => apri(seg));
      trama.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apri(seg); }
      });
      if (coda) segs.splice(segs.indexOf(coda), 0, seg); else segs.push(seg);
      statoSeg(seg, stato);
      return seg;
    }
    function statoSeg(seg, stato) {
      seg.stato = stato;
      seg.el.dataset.stato = stato;
      if (stato === 'coda') { seg.corpo.hidden = false; if (aperta === seg) aperta = null; }
    }
    // Il pensiero ha fatto nascere delle azioni: il filo si annoda sulla sua riga.
    function annoda(seg, testo) {
      if (seg.stato !== 'agisce') {
        if (seg.stato === 'coda') seg.corpo.hidden = aperta !== seg;
        statoSeg(seg, 'agisce');
      }
      if (testo) scrivi(seg, testo);
      if (!seg.nodo) seg.nodo = filo.nodo(seg.el, seg.eti.textContent);
    }
    function scrivi(seg, t) {
      if (seg.eti.textContent === t) return;
      seg.eti.textContent = t;
      if (seg.nodo) seg.nodo.titolo(t);
    }
    const completa = (seg) => seg.voci.length > 0 && seg.voci.length >= seg.attese.size;
    // Tutti gli esiti del nodo sono arrivati (o il giro è finito): il titolo diventa quello vero e il nodo tiene
    // o cede. Cede solo se nessuna delle sue azioni è andata: il filo non mente sull'esito.
    function chiudiNodo(seg) {
      if (!seg.voci.length) return;
      scrivi(seg, Filo.titoloNodo(seg.voci.map((x) => x.voce)));
      if (seg.esito || !seg.nodo) return;
      seg.esito = seg.voci.every((x) => x.voce.esito === 'fallita') ? 'cede' : 'tiene';
      if (seg.esito === 'cede') seg.nodo.cede(); else seg.nodo.tiene();
    }
    function togliSeg(seg) {
      const i = segs.indexOf(seg);
      if (i >= 0) segs.splice(i, 1);
      if (viva === seg) viva = null;
      if (aperta === seg) aperta = null;
      seg.el.remove();
    }
    function chiudiSeg(seg) {
      if (!seg) return;
      if (seg.stato === 'agisce') chiudiNodo(seg);
      if (viva === seg) viva = null;
    }
    // Il gomitolo e la riga col riassunto.
    function riassunto() {
      const ms = (fineLavoro || Date.now()) - startedAt;
      const fatto = summarizeActivity(doneTypes, sawReasoning);
      const qualcosa = doneTypes.some((v) => global.SN_ESITO.conta(v.esito));
      if (fermato) return `Fermato · ${qualcosa ? `${fatto.charAt(0).toLowerCase()}${fatto.slice(1)} · ` : ''}${fmtActivityDuration(ms)}`;
      return `${fatto} · ${fmtActivityDuration(ms)}`;
    }
    // Una riga arrivata a lavoro finito (l'impostazione confermata dopo la risposta) rifà il riassunto, non il cronometro.
    function rifaiTesta() {
      label.textContent = fallito && !fermato ? `Tentativo non riuscito · ${riassunto()}` : riassunto();
    }
    // Ritorna la voce di prima con il suo esito quando l'azione era già contata, altrimenti null.
    function contaAzione(type, a, failed) {
      const E = global.SN_ESITO;
      const tipo = String(type || '').toUpperCase();
      let esito = E.FATTO;
      if (failed) esito = E.FALLITO;
      else if (a && tipo !== 'FERMATA') esito = E.esitoAzione(a);
      const gia = a ? doneTypes.find((v) => v.a === a || (a._callId && v.a && v.a._callId === a._callId)) : null;
      if (!gia) { doneTypes.push({ type: tipo, esito, a }); return null; }
      const prima = gia.esito;
      gia.type = tipo;
      gia.esito = esito;
      gia.a = a;
      return { prima, voce: gia };
    }
    const haCose = () => sawReasoning || segs.some((s) => s.testo || s.corpo.querySelector('.dash-activity-note, .dash-activity-row, .dash-activity-cmd'));
    let tendina = 0;
    function tendi(aperto, dur) {
      const mio = ++tendina;
      if (aperto) {
        body.hidden = false;
        if (dur <= 0) { body.style.maxHeight = ''; body.style.opacity = ''; return; }
        body.style.maxHeight = '0px';
        body.style.opacity = '0';
        requestAnimationFrame(() => {
          if (mio !== tendina) return;
          body.style.maxHeight = `${body.scrollHeight}px`;
          body.style.opacity = '';
        });
        setTimeout(() => { if (mio === tendina) body.style.maxHeight = ''; filo.sveglia(); }, dur + 40);
      } else {
        if (dur <= 0) { body.hidden = true; return; }
        body.style.maxHeight = `${body.scrollHeight}px`;
        void body.offsetHeight;
        body.style.maxHeight = '0px';
        body.style.opacity = '0';
        setTimeout(() => { if (mio === tendina) body.hidden = true; }, dur + 40);
      }
    }
    function mostraTesta() {
      label.textContent = riassunto();
      if (!head.hidden) return;
      head.hidden = false;
      requestAnimationFrame(() => { wrap.dataset.testa = '1'; });
    }
    function avvolgi() {
      if (wrap.dataset.filo === 'gomitolo') return;
      if (!haCose()) { wrap.classList.add('dash-activity-vuoto'); return; }
      wrap.classList.remove('dash-activity-vuoto');
      mostraTesta();
      wrap.dataset.filo = 'gomitolo';
      head.setAttribute('aria-expanded', 'false');
      head.title = 'Mostra cosa ha fatto Filo';
      const dur = filo.avvolgi(1);
      tendi(false, dur);
    }
    function srotola() {
      wrap.dataset.filo = phase === 'done' || phase === 'answer' ? 'srotolato' : 'disteso';
      head.setAttribute('aria-expanded', 'true');
      head.title = 'Riavvolgi';
      body.hidden = false;
      const dur = filo.durataGomitolo();
      if (dur > 0) { body.style.maxHeight = '0px'; body.style.opacity = '0'; }
      filo.avvolgi(0);
      tendi(true, dur);
      followThread();
    }
    head.addEventListener('click', () => { if (wrap.dataset.filo === 'gomitolo') srotola(); else avvolgi(); });
    // Il testo che sembrava la risposta era una nota: il lavoro riprende, il gomitolo si srotola.
    function torna() {
      wrap.classList.remove('dash-activity-vuoto');
      if (phase !== 'answer') return;
      if (viva && viva.stato === 'coda') { statoSeg(viva, 'pensa'); viva.corpo.hidden = aperta !== viva; }
      if (wrap.dataset.filo === 'gomitolo') srotola();
      wrap.dataset.filo = 'disteso';
      head.hidden = true;
      delete wrap.dataset.testa;
      filo.riapri();
    }
    // Dove va un esito che arriva: nella sezione viva se sta pensando o agendo, altrimenti in una nuova.
    function bersaglio() {
      if (viva && (viva.stato === 'agisce' || viva.stato === 'pensa')) return viva;
      return nuovaSeg('agisce');
    }
    function trova(a) {
      if (!a) return null;
      for (const s of segs) {
        const x = s.voci.find((v) => v.a === a || (a._callId && v.a && v.a._callId === a._callId));
        if (x) return { seg: s, x };
      }
      return null;
    }
    // Un esito registrato nel nodo. `a` è l'azione, quando c'è: la stessa azione confermata dopo aggiorna la sua voce.
    function registra(voce, a = null) {
      if (inDiretta && !fermato) torna();
      const gia = trova(a);
      let seg;
      if (gia) {
        seg = gia.seg;
        gia.x.voce = voce;
        gia.x.a = a;
      } else {
        seg = bersaglio();
        annoda(seg);
        seg.voci.push({ voce, a });
      }
      if (completa(seg) || !inDiretta || phase === 'done') chiudiNodo(seg);
      if (phase !== 'done' && !fermato && inDiretta) setPhase('act');
      return seg;
    }
    function esitoDi(a, failed, tipo) {
      if (String(tipo || '').toUpperCase() === 'FERMATA') return 'fallita';
      if (a && a._confirm) return 'chiesta';
      return failed ? 'fallita' : 'ok';
    }
    function aggiungiEsito(seg, el) {
      seg.esiti.appendChild(el);
      filo.sveglia();
      followThread();
    }

    return {
      el: wrap,
      // Un pezzo di ragionamento vero dal modello: scorre come trama sulla riga viva.
      pushReasoning(text) {
        if (phase === 'done' || fermato || !text) return;
        if (inDiretta) torna();
        sawReasoning = true;
        if (!turnReasoning) turnStartedAt = Date.now();
        turnReasoning += text;
        let seg = viva;
        if (!seg || (seg.stato !== 'pensa' && seg.stato !== 'coda')) {
          chiudiSeg(seg);
          seg = viva = nuovaSeg('pensa');
        }
        if (!seg.cot) {
          seg.cot = document.createElement('div');
          seg.cot.className = 'dash-activity-reasoning';
          seg.corpo.insertBefore(seg.cot, seg.corpo.firstChild);
        }
        seg.testo += text;
        seg.cot.textContent = seg.testo;
        seg.tramaTesto.textContent = seg.testo.replace(/\s+/g, ' ').trim().slice(-90);
        if (aperta === seg) seg.corpo.scrollTop = seg.corpo.scrollHeight;
        if (seg.stato === 'pensa') { setPhase('reason'); filo.pensa(); }
        followThread();
      },
      // È partito il testo di una risposta: l'ultimo pensiero diventa la coda e il filo si avvolge. Se poi arriva
      // un'azione, quel testo era una nota e il lavoro riprende (torna).
      answerStarted() {
        closeTurnReasoning();
        if (fermato || phase === 'done') return;
        if (viva && viva.stato === 'agisce' && !completa(viva)) return;
        if (viva && viva.stato === 'pensa') statoSeg(viva, 'coda');
        else chiudiSeg(viva);
        fineLavoro = Date.now();
        setPhase('answer');
        filo.chiudi();
        if (tieniAperto) mostraTesta(); else avvolgi();
      },
      // Il modello ha nominato un'azione (`callId`) o ne dice l'avanzamento: la riga lo dice subito, il filo si
      // annoda e si tende. Le azioni chiamate insieme fanno un nodo solo.
      working(text, callId) {
        if (phase === 'done' || fermato || !text) return;
        closeTurnReasoning();
        torna();
        let seg = viva;
        const nuova = callId !== undefined;
        if (!seg || seg.stato === 'fermato' || (seg.stato === 'agisce' && nuova && completa(seg))) {
          chiudiSeg(seg);
          seg = viva = nuovaSeg('agisce');
        }
        if (nuova) seg.attese.add(callId || `#${++anonime}`);
        annoda(seg, completa(seg) ? '' : text);
        setPhase('act');
        filo.agisce();
        followThread();
      },
      // Fine di un giro con azioni: il nodo si chiude anche se qualche esito non è arrivato.
      fineGiro() {
        if (viva && viva.stato === 'agisce') chiudiNodo(viva);
      },
      // Il turno è tornato dal main: da qui in poi le righe raccontano, non fanno ripartire il filo.
      fineDiretta() { inDiretta = false; },
      // Una riga di azione: icona e due parole («Timer avviato · 5 min»), dentro il nodo della sua azione.
      // `failed`: la riga resta (è successo qualcosa) ma il riassunto non la conta.
      addRow(type, rowIcon, text, failed = false, cambi = null, a = null, title = '') {
        closeTurnReasoning();
        const gia = contaAzione(type, a, failed);
        const seg = registra({ tipo: type, testo: text, esito: esitoDi(a, failed, type) }, a);
        const riga = makeActivityRow(rowIcon, text, cambi, title);
        // La proposta finita col bottone diventa il suo esito nella stessa riga: due frasi che si contraddicono no.
        if (gia && gia.prima === global.SN_ESITO.PROPOSTO && gia.voce.riga && gia.voce.riga.isConnected) gia.voce.riga.replaceWith(riga);
        else aggiungiEsito(seg, riga);
        if (a) (gia ? gia.voce : doneTypes[doneTypes.length - 1]).riga = riga;
        if (phase === 'done') rifaiTesta();
      },
      // Esito di un comando eseguito subito (livello 1): riga di comando e output, nel suo nodo.
      addCommand(out, spiegazione = '', a = null) {
        closeTurnReasoning();
        contaAzione('ESEGUI_COMANDO', a, false);
        const seg = registra({ tipo: 'ESEGUI_COMANDO', testo: `Eseguito · ${spiegazione || (out && out.command) || 'comando'}`, esito: 'ok' }, a);
        const el = renderCommandResult(out, spiegazione);
        el.classList.add('dash-activity-cmd');
        aggiungiEsito(seg, el);
        if (phase === 'done') rifaiTesta();
      },
      // Un'azione che in chat è un bottone (un link aperto) o che il registro ha scartato: il nodo la conta e la
      // nomina, la riga non c'è.
      azioneSenzaRiga(a, { scartata = false } = {}) {
        if (!a) return;
        const tipo = String(a.type || '').toUpperCase();
        const fallita = scartata || a._executed === false;
        const o = a._output || {};
        let dettaglio = '';
        try { if (tipo === 'NAVIGA') dettaglio = new URL(String(a.url || o.url || '')).hostname.replace(/^www\./, ''); } catch (_) {}
        if (tipo === 'APRI_FILE') dettaglio = String(a.percorso || a.path || '').split(/[\\/]/).pop();
        const testo = fallita ? (FAILED_LABELS[tipo] || 'Azione non riuscita') : '';
        registra({ tipo, testo, dettaglio, esito: a._confirm ? 'chiesta' : (fallita ? 'fallita' : 'ok') }, a);
      },
      // La bolla di un giro che NON era l'ultimo («Provo subito tutti e tre…») diventa una nota del suo nodo.
      absorbBubble(bubble) {
        if (!bubble || !bubble.isConnected) return;
        const text = (bubble.textContent || '').trim();
        bubble.remove();
        this.aggiungiNota(text);
      },
      // Il testo di un giro venuto dopo una parte di risposta (#1167): la bolla resta, la nota entra qui.
      aggiungiNota(testo) {
        const text = String(testo || '').trim();
        if (!text) return;
        const note = document.createElement('div');
        note.className = 'dash-activity-note';
        note.textContent = text;
        const seg = viva && viva.stato === 'agisce' ? viva : bersaglio();
        seg.corpo.insertBefore(note, seg.esiti);
        filo.sveglia();
        followThread();
      },
      // La nota che il main ha promosso a risposta non resta anche qui: una frase sola, nella bolla.
      dropNote(text) {
        const t = String(text || '').trim();
        if (!t) return;
        const notes = body.querySelectorAll('.dash-activity-note');
        const last = notes[notes.length - 1];
        if (last && (last.textContent || '').trim() === t) last.remove();
      },
      endTurn() {
        closeTurnReasoning();
        const t = lastTurn;
        lastTurn = { text: '', ms: 0 };
        return t;
      },
      // Fermato dall'utente: il filo si taglia, la riga in corso resta col ragionamento a metà e il blocco NON si
      // richiude, perché chi ferma vuole vedere cosa era stato fatto.
      taglia() {
        if (fermato || phase === 'done') return;
        fermato = true;
        closeTurnReasoning();
        if (!fineLavoro) fineLavoro = Date.now();
        if (viva && (viva.stato === 'pensa' || viva.stato === 'coda') && wrap.dataset.filo !== 'gomitolo') {
          statoSeg(viva, 'fermato');
          scrivi(viva, global.SN_CHAT_ERRORS.FERMATO_QUI);
          apri(viva, true);
        }
        filo.taglia();
        wrap.dataset.fermato = '1';
        wrap.classList.remove('dash-activity-vuoto');
        if (wrap.dataset.filo !== 'gomitolo') {
          wrap.dataset.filo = 'srotolato';
          head.setAttribute('aria-expanded', 'true');
          head.title = 'Riavvolgi';
          mostraTesta();
        }
        setPhase('done');
        followThread();
      },
      get fermato() { return fermato; },
      // Fine di tutto il lavoro: la riga diventa il riassunto. `failed`: interrotto da un guasto, il blocco resta
      // e lo dice.
      finish({ failed = false } = {}) {
        closeTurnReasoning();
        inDiretta = false;
        fallito = !!failed;
        for (const s of [...segs]) {
          if (s.stato !== 'agisce') continue;
          if (s.voci.length) { chiudiNodo(s); continue; }
          // #1188 — senza un'azione nominata non c'è niente che non sia partito: era il posto di una nota, poi
          // diventata la risposta. Vuota se ne va, con una nota resta com'è.
          if (!s.attese.size) { if (!s.testo && !s.corpo.querySelector('.dash-activity-note') && !s.esiti.childElementCount) togliSeg(s); continue; }
          // Nominata ma mai partita (fermata prima, o persa per strada): il nodo non tiene e la riga lo dice.
          scrivi(s, fermato ? global.SN_CHAT_ERRORS.FERMATO_QUI : 'Non partita');
          if (s.nodo && !s.esito) { s.esito = 'cede'; s.nodo.cede(); }
        }
        if (viva && viva.stato === 'pensa') statoSeg(viva, fermato ? 'fermato' : 'coda');
        viva = null;
        if (!haCose() && !fermato) { filo.distruggi(); wrap.remove(); setPhase('done'); return; }
        if (!fineLavoro) fineLavoro = Date.now();
        setPhase('done');
        if (fermato) {
          filo.taglia();
          label.textContent = riassunto();
          return;
        }
        filo.chiudi();
        wrap.classList.remove('dash-activity-vuoto');
        // Srotolato dall'utente mentre arrivava la risposta: la sua scelta resta.
        if (tieniAperto && wrap.dataset.filo === 'gomitolo') srotola();
        else if (tieniAperto) {
          wrap.dataset.filo = 'srotolato';
          head.setAttribute('aria-expanded', 'true');
          head.title = 'Riavvolgi';
        }
        if (wrap.dataset.filo === 'srotolato') mostraTesta(); else avvolgi();
        if (tieniAperto && nodoDaAprire) apri(nodoDaAprire, true);
        label.textContent = failed ? `Tentativo non riuscito · ${riassunto()}` : riassunto();
        if (failed) wrap.dataset.failed = '1';
      },
      remove() { filo.distruggi(); wrap.remove(); },
      mostra(a) {
        tieniAperto = true;
        const g = trova(a);
        if (g) nodoDaAprire = g.seg;
        if (phase !== 'done') return;
        if (wrap.dataset.filo === 'gomitolo') srotola();
        if (nodoDaAprire) apri(nodoDaAprire, true);
      },
    };

    function closeTurnReasoning() {
      if (!turnReasoning) return;
      lastTurn = { text: turnReasoning, ms: Date.now() - turnStartedAt };
      turnReasoning = '';
    }
  }

  // «Ha cercato sul web, impostato una sveglia e letto un documento»: il
  // riassunto delle azioni, nell'ordine in cui sono avvenute, con i doppioni
  // contati. Senza azioni resta il solo ragionamento.
  const ACTIVITY_VERBS = {
    // Un'azione fermata perché avrebbe portato fuori un segreto (#810): si vede anche a blocco chiuso.
    FERMATA: (n) => (n > 1 ? `fermato ${n} azioni` : 'fermato un\'azione'),
    CERCA_WEB: (n) => (n > 1 ? `cercato sul web ${n} volte` : 'cercato sul web'),
    CERCA_CHAT: (n) => (n > 1 ? `cercato nel filo ${n} volte` : 'cercato nel filo'),
    RICORDO_FILO: () => 'ripescato un ricordo dal filo',
    LEGGI_DOCUMENTO: (n) => (n > 1 ? `letto ${n} documenti` : 'letto un documento'),
    LEGGI_PAGINA: (n) => (n > 1 ? `letto ${n} pagine` : 'letto una pagina'),
    VEDI_SCHERMO: (n) => (n > 1 ? `guardato lo schermo ${n} volte` : 'guardato lo schermo'),
    CERCA_DOCUMENTI: (n) => (n > 1 ? `cercato fra i tuoi documenti ${n} volte` : 'cercato fra i tuoi documenti'),
    CERCA_SALVATE: (n) => (n > 1 ? `cercato fra le pagine salvate ${n} volte` : 'cercato fra le pagine salvate'),
    APRI_SALVATA: (n) => (n > 1 ? `aperto ${n} pagine salvate` : 'aperto una pagina salvata'),
    RINOMINA_FILE: () => 'dato un nome ai file',
    LEGGI_FILE: (n) => (n > 1 ? `letto ${n} file` : 'letto un file'),
    LEGGI_TRASPARENZA: () => 'riletto la trasparenza',
    CAPACITA_DETTAGLIO: () => 'verificato cosa sa fare',
    LEGGI_IMPOSTAZIONI: () => 'letto le impostazioni',
    TOGLI_PERMESSO_SITO: () => 'tolto un permesso a un sito',
    TIMER: (n) => (n > 1 ? `avviato ${n} timer` : 'avviato un timer'),
    SVEGLIA: (n) => (n > 1 ? `impostato ${n} sveglie` : 'impostato una sveglia'),
    CANCELLA_SVEGLIA: () => 'cancellato una sveglia',
    MODIFICA_SVEGLIA: () => 'spostato una sveglia',
    EVENTO_CALENDARIO: (n) => (n > 1 ? `aggiunto ${n} eventi al calendario` : 'aggiunto un evento al calendario'),
    ESEGUI_COMANDO: (n) => (n > 1 ? `eseguito ${n} comandi` : 'eseguito un comando'),
    IMPOSTA_PREFERENZA: (n) => (n > 1 ? `cambiato ${n} impostazioni` : 'cambiato un\'impostazione'),
    IMPOSTA_ESTETICA: (n) => (n > 1 ? `cambiato ${n} dettagli dell'aspetto` : 'cambiato l\'aspetto'),
    ANNULLA_CAMBIO: (n) => (n > 1 ? `rimesso com'era ${n} cambi` : 'rimesso com\'era un cambio'),
    SALVA_APPUNTO: (n) => (n > 1 ? `salvato ${n} appunti` : 'salvato un appunto'),
    SALVA_LEZIONE: (n) => (n > 1 ? `memorizzato ${n} cose` : 'memorizzato una cosa'),
    DIMENTICA: (n) => (n > 1 ? `dimenticato ${n} cose` : 'dimenticato una cosa'),
    TOGLI_CHAT: (n) => (n > 1 ? `tolto ${n} conversazioni` : 'tolto una conversazione'),
    RIMETTI_CHAT: (n) => (n > 1 ? `rimesso ${n} conversazioni nel filo` : 'rimesso una conversazione nel filo'),
    CORREGGI_MEMORIA: (n) => (n > 1 ? `corretto ${n} cose` : 'corretto una cosa'),
    CANCELLA_MEMORIA: () => 'cancellato la memoria',
    NAVIGA: (n) => (n > 1 ? `aperto ${n} pagine` : 'aperto una pagina'),
    ONBOARDING: () => 'proseguito con l\'accoglienza',
    PROXY_TAB: () => 'aperto la scheda da un altro paese',
    RIMUOVI_PROXY: () => 'riportato la scheda in Italia',
    RIMUOVI_PROXY_TUTTE: () => 'riportato le schede in Italia',
    REGOLA_PROXY_DOMINIO: () => 'salvato una regola sul paese',
    RIMUOVI_REGOLA_PROXY: () => 'tolto una regola sul paese',
    TIENI_APERTA: () => 'salvato un sito da tenere aperto',
    NON_TENERE_APERTA: () => 'tolto un sito da tenere aperto',
    STILE_PAGINA: () => 'cambiato l\'aspetto della pagina',
    RIPRISTINA_STILE_PAGINA: () => 'rimesso la pagina com\'era',
    COMANDO_FINESTRA: () => 'azionato un comando della finestra',
    ACCOUNT: () => 'sistemato l\'accesso',
    SPOSTA_ICONA: () => 'spostato un\'icona',
    PANNELLO_APP: () => 'sistemato il pannello degli strumenti',
    INSTALLA_AGGIORNAMENTO: () => 'chiesto la versione nuova di Filo',
    RIMEDIO_CREDITI: () => 'lavorato sui crediti',
    PULSANTE_PREFERENZE: () => 'usato un pulsante delle Preferenze',
    CARTA_HOME: (n) => (n > 1 ? `sistemato ${n} carte della home` : 'sistemato una carta della home'),
    CANCELLA_PAGINE: () => 'cancellato pagine visitate',
    ZOOM_PAGINA: () => 'cambiato lo zoom',
    VOLUME: () => 'cambiato il volume',
    BLUETOOTH: () => 'comandato il Bluetooth',
    WIFI: () => 'comandato il Wi-Fi',
    ORDINA_DESKTOP: (n) => (n > 1 ? `sistemato le icone del desktop ${n} volte` : 'sistemato le icone del desktop'),
    INVIA_FEEDBACK: () => 'preparato una segnalazione',
    PULISCI_TAB: () => 'riordinato le schede',
    CHIUDI_SCHEDE: (n) => (n > 1 ? `chiuso schede ${n} volte` : 'chiuso delle schede'),
    CANCELLA_ARCHIVIO: () => 'eliminato schede dall\'archivio',
  };
  // Le azioni che Filo propone e l'utente finisce col bottone: finché il click non arriva il riassunto dice la
  // proposta; dopo (e nell'archivio, che le tiene solo fatte) vale il verbo di sempre.
  const ACTIVITY_VERBS_PROPOSTI = {
    EVENTO_CALENDARIO: (n) => (n > 1 ? `proposto ${n} eventi` : 'proposto un evento'),
  };
  // `voci`: le azioni del turno col loro esito, o i soli nomi di una chat
  // archiviata (che tiene solo ciò che è successo). Un esito che non si può
  // vantare — conferma mai data, tentativo fallito — non entra nel riassunto.
  // `hasReasoning`: il modello ha davvero ragionato. Senza, un blocco che
  // contiene solo una frase intermedia non può intitolarsi «Ragionamento».
  function summarizeActivity(voci, hasReasoning = true) {
    const E = global.SN_ESITO;
    const counts = new Map();
    for (const v of E.voci(voci)) {
      if (!E.conta(v.esito)) continue;
      const c = counts.get(v.type) || { proposte: 0, altre: 0 };
      if (v.esito === E.PROPOSTO && ACTIVITY_VERBS_PROPOSTI[v.type]) c.proposte += 1;
      else c.altre += 1;
      counts.set(v.type, c);
    }
    const parts = [];
    for (const [t, c] of counts) {
      if (c.proposte) parts.push(ACTIVITY_VERBS_PROPOSTI[t](c.proposte));
      if (c.altre && ACTIVITY_VERBS[t]) parts.push(ACTIVITY_VERBS[t](c.altre));
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
  function makeActivityRow(rowIcon, text, cambi = null, title = '') {
    const el = document.createElement('div');
    el.className = 'dash-action-step dash-activity-row';
    const ids = Array.isArray(cambi) ? cambi.filter(Boolean) : [];
    if (ids.length) el.dataset.cambi = ids.join(' ');
    if (title) el.title = title;
    const ic = document.createElement('span');
    ic.className = 'dash-activity-row-icon';
    ic.setAttribute('aria-hidden', 'true');
    ic.textContent = rowIcon || '';
    const tx = document.createElement('span');
    tx.textContent = String(text || '').trim();
    el.append(ic, tx);
    return el;
  }

  // Le parole del diario stanno in src/shared/righeAttivita.js: la chat riaperta le legge uguali (#1294).
  const RA = global.SN_RIGHE_ATTIVITA;
  const {
    pulito, FAILED_LABELS, rigaLetturaPagina, indirizzoLetto, rifiutataDallaRegola, sceltaContatori, sceltaAutonomia,
    testoRicercaDocumenti, testoRinominati,
  } = RA;
  const rigaAttivita = (a) => RA.riga(a);
  // Aspetta una risposta dell'utente, da un popup o dal pannello dell'azione: non è un'azione fallita, e il suo bottone resta.
  function aspettaUtente(a) { return !!(a && (a._confirm || a._domanda)); }

  function activityRowFor(a) {
    const row = rigaAttivita(a);
    if (!row || row.failed) return row;
    const ids = (Array.isArray(a._cambi) ? a._cambi : []).map((c) => (typeof c === 'string' ? c : c && c.id)).filter(Boolean);
    return ids.length ? { ...row, cambi: ids } : row;
  }
  // L'esito di un comando che è partito davvero: un comando bloccato o rifiutato si racconta come riga.
  function esitoDiComando(a) {
    return isType(a, 'ESEGUI_COMANDO') && !a._confirm && !!a._output && !a._output.blocked && !rifiutataDallaRegola(a);
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
    if (esitoDiComando(a)) {
      activity.addCommand(a._output, spiegazioneDi(a), a);
      return true;
    }
    const row = activityRowFor(a);
    if (row) {
      activity.addRow(row.tipo || a.type, row.icon, row.text, !!row.failed, row.cambi, a, row.title || '');
      if (rifiutataDallaRegola(a) && activity.mostra) activity.mostra(a);
      return true;
    }
    // Un link aperto resta un bottone sotto la risposta, ma il nodo del filo lo conta e lo nomina.
    if (activity.azioneSenzaRiga) activity.azioneSenzaRiga(a);
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

  // Lo stile proposto nell'intervista di benvenuto si imposta senza riquadro (#592.2): la chat lo dice in una riga
  // col suo Annulla, fuori dal blocco di attività.
  function stileAccoglienza(a) {
    const o = a && a._output;
    return isType(a, 'IMPOSTA_PREFERENZA') && a._executed !== false && !!o && typeof o.stile === 'string' && !!o.stile.trim();
  }

  function rigaStileAccoglienza(a) {
    const o = a._output;
    const cambio = (Array.isArray(a._cambi) ? a._cambi : []).find((c) => c && c.id);
    const riga = document.createElement('div');
    riga.className = 'dash-stile-accoglienza';
    const testo = document.createElement('span');
    testo.className = 'dash-stile-accoglienza-testo';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dash-action-btn';
    btn.textContent = 'Annulla';
    btn.title = 'Torna a come scrivevo prima';
    const mostra = () => {
      testo.textContent = o.annullato ? 'Stile annullato: scrivo come prima.' : `Userò questo stile: «${o.stile.trim()}»`;
      // Senza un cambio (lo stile era già quello) non c'è niente da rimettere.
      btn.hidden = !!o.annullato || !cambio;
    };
    btn.addEventListener('click', async () => {
      if (btn.disabled || !cambio) return;
      btn.disabled = true;
      let r = null;
      try { r = await send({ type: MSG.CAMBI_ANNULLA, id: cambio.id }); } catch (_) { r = null; }
      btn.disabled = false;
      // Già annullato dal segno sul messaggio: il risultato è quello voluto.
      if (r && (r.ok || r.error === 'già annullato')) { o.annullato = true; mostra(); return; }
      btn.textContent = 'Annulla non riuscito: riprova';
      btn.title = (r && r.error) || '';
    });
    mostra();
    riga.append(testo, btn);
    return riga;
  }

  // #1297 — quello che Filo impara su chi è l'utente nel benvenuto: la stessa riga dello stile. Annulla la toglie dalla
  // memoria come «dimentica» (resta fra le nascoste del quaderno, da dove si rimette).
  function lezioneAccoglienza(a) {
    const r = a && a._output && a._output.ricordo;
    return isType(a, 'SALVA_LEZIONE') && a._executed !== false && !!r && typeof r.text === 'string' && !!r.text.trim();
  }

  function rigaLezioneAccoglienza(a) {
    const o = a._output;
    const riga = document.createElement('div');
    riga.className = 'dash-stile-accoglienza dash-lezione-accoglienza';
    const testo = document.createElement('span');
    testo.className = 'dash-stile-accoglienza-testo';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dash-action-btn';
    btn.textContent = 'Annulla';
    btn.title = 'Non ricordarlo';
    const mostra = () => {
      testo.textContent = o.dimenticato === 'si' ? 'Non me lo ricordo più.'
        : (o.dimenticato === 'tardi' ? 'Ormai è nel tuo profilo: lo togli dal quaderno delle memorie.'
          : `Mi ricorderò: «${o.ricordo.text.trim()}»`);
      btn.hidden = !!o.dimenticato;
    };
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      let r = null;
      try { r = await send({ type: MSG.FILO_MEMORY_FORGET, lezione: { ts: o.ricordo.ts, text: o.ricordo.text }, da: 'chat' }); } catch (_) { r = null; }
      btn.disabled = false;
      if (r && r.ok) { o.dimenticato = r.tolta ? 'si' : 'tardi'; mostra(); return; }
      btn.textContent = 'Annulla non riuscito: riprova';
      btn.title = (r && r.error) || '';
    });
    mostra();
    riga.append(testo, btn);
    return riga;
  }

  // Una pagina che il modello voleva aprire e che la lista dei siti bloccati ha fermato: la
  // notifica se ne va in pochi secondi, e la chat le tiene il suo «Apri comunque» (#590).
  function apribileComunque(a) {
    const o = a && a._output;
    return isType(a, 'NAVIGA') && a._executed === false && !!o && o.blocked === 'site' && /^https?:\/\//i.test(String(o.url || ''));
  }

  // #874 — un comando del sistema fermato da un permesso che manca: la frase sta nella riga, il tasto apre il posto
  // delle impostazioni dove si concede (l'indirizzo lo sceglie il main da un elenco suo, qui passa solo la chiave).
  function permessoDaConcedere(a) {
    const o = a && a._output;
    return (isType(a, 'VOLUME') || isType(a, 'BLUETOOTH') || isType(a, 'WIFI') || isType(a, 'VEDI_SCHERMO') || isType(a, 'ORDINA_DESKTOP')) && a._executed === false
      && !!o && typeof o.apri === 'string' && !!o.apri;
  }

  function bottonePermesso(a) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dash-action-btn';
    btn.textContent = 'Apri le impostazioni';
    btn.title = String(a._output.dove || a._output.frase || '');
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      await send({ type: MSG.SISTEMA_APRI_IMPOSTAZIONI, chiave: a._output.apri }).catch(() => null);
      setTimeout(() => { btn.disabled = false; }, 1500);
    });
    return btn;
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
      if (row) chip.before(makeActivityRow(row.icon, row.text, row.cambi, row.title || ''));
      chip.replaceWith(bottoneApriComunque(a));
    }
    return true;
  }

  // Riga e bottone insieme anche quando lo decide l'ESITO: il comando non
  // partito (il riquadro dice perché), l'evento da aggiungere, la home già qui.
  function rigaEBottone(a) {
    const type = String(a.type || '').toUpperCase();
    if (ROW_AND_BUTTON.includes(type) && a._executed !== false) return true;
    if (type === 'ESEGUI_COMANDO' && a._output && a._output.blocked) return true;
    if (type === 'COMANDO_FINESTRA' && a._output && a._output.already) return true;
    // Ciò che Filo lascia finire all'UTENTE (l'evento): la riga dice che l'ha
    // proposto, il bottone è come si accetta. Senza il bottone non si raggiunge.
    if (a._output && a._output.proposta) return true;
    return false;
  }

  // `shown`: gli id delle chiamate già raccontate in diretta nel blocco di
  // attività (evento 'done'): a fine turno non si ripetono.
  // `chat`: la conversazione del turno. Un OK dato dopo resta lì, anche se intanto la scheda è passata a un'altra (#1294).
  function renderActions(container, actions, { onAck, autoConfirm = false, activity = null, shown = null, chat = '' } = {}) {
    if (!actions || !actions.length) return;
    for (const a of actions) {
      const f = a && a._callId && isType(a, 'NAVIGA') ? fermateInAttesa.get(a._callId) : null;
      if (f) { fermateInAttesa.delete(a._callId); segnaFermata(a, f); }
    }
    const wrap = document.createElement('div');
    wrap.className = 'dash-bubble-actions';
    const gruppo = { pendenti: new Set(), voci: [] };
    if (actions.some((a) => isType(a, 'ESEGUI_COMANDO') && a._primaVolta)) wrap.appendChild(notaPrimaVolta());
    let hasAck = false;
    for (const a of actions) {
      const told = a && a._callId && shown && shown.has(a._callId);
      // `anche` = ha la riga nel diario E il bottone in chat. Oltre all'appunto
      // (riga che racconta, bottone che porta all'editor) vale per tutto ciò
      // che aspetta una conferma: la riga dice che Filo l'ha chiesta, il
      // bottone è come si risponde.
      const anche = aspettaUtente(a) || rigaEBottone(a)
        || apribileComunque(a) || permessoDaConcedere(a) || stileAccoglienza(a) || lezioneAccoglienza(a) || sceltaAutonomia(a) || sceltaContatori(a)
        || salvateDaMostrare(a).length > 0;
      if (activity) {
        if (told) {
          // Già in cronologia; resta solo l'eventuale bottone (link, conferma).
          if (!anche && (activityRowFor(a) || esitoDiComando(a))) continue;
        } else if (tellActionInActivity(activity, a) && !anche) {
          continue;
        }
      } else {
        const row = activityRowFor(a);
        if (row) {
          wrap.appendChild(makeActivityRow(row.icon, row.text, row.cambi, row.title || ''));
          if (!anche) continue;
        }
      }
      // Un'azione senza niente da cliccare (`_traccia`) o non riuscita non
      // diventa MAI un bottone: un chip che al click non fa niente è un vicolo
      // cieco (era il caso di un link con un indirizzo non ammesso). La sua
      // riga sta già nel diario. Un'azione IN ATTESA DI CONFERMA non è
      // «fallita»: non è ancora partita, e il suo bottone è tutto il punto.
      if (!aspettaUtente(a) && !apribileComunque(a) && !permessoDaConcedere(a) && !rigaEBottone(a)
        && ((a._traccia && !anche) || a._executed === false)) continue;
      const btn = renderActionButton(a, { onAck, activity, chat, gruppo });
      if (btn) wrap.appendChild(btn);
      if (String(a.type || '').toUpperCase() === 'SALVA_APPUNTO') hasAck = true;
    }
    if (!wrap.childElementCount && !(hasAck && onAck)) return;
    // Per l'appunto salvato (già eseguito server-side) aggiungiamo un tasto ✓
    // che chiude la conversazione. Timer e sveglie non lo hanno più: la loro
    // riga nel blocco di attività dice già tutto.
    if (hasAck && onAck) {
      const ok = bottoneChiudi(onAck, '✓', 'Chiudi la conversazione');
      ok.classList.add('dash-action-btn-primary');
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
          filaPopup += 1;
          try {
            for (const auto of autos) {
              try { await auto._runConfirm?.(); } catch (_) {}
            }
          } finally {
            filaPopup -= 1;
            if (!filaPopup && riprendiDopoFila) { const { chat: c } = riprendiDopoFila; riprendiDopoFila = null; riprendiOra(c); }
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
    // Dal box arriva la fotografia dei token di quando si è aperto: si scrive
    // il solo token cambiato, sopra lo stato fresco (la mappa si salva intera).
    const persist = (overrides, token) => {
      clearTimeout(persistTimer);
      persistTimer = setTimeout(async () => {
        let themeTokens = { ...overrides };
        if (token) {
          let fresco = {};
          try { fresco = { ...((await self.SN_STORAGE.getSettings()).themeTokens || {}) }; } catch (_) {}
          if (overrides[token] === undefined) delete fresco[token];
          else fresco[token] = overrides[token];
          themeTokens = fresco;
        }
        send({ type: MSG.UPDATE_SETTINGS, settings: { themeTokens } });
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
      send({ type: MSG.OPEN_URL, url: PREF_TERMINALE, via: 'chat' });
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
      // Chi non sa che quell'interruttore esiste non ha modo di capire perché
      // il comando non è partito: il riquadro lo dice e porta dov'è.
      wrap.classList.add('dash-cmd-blocked');
      const testo = document.createElement('div');
      testo.textContent = out.command
        ? `«${out.command}» non è partito: la modalità terminale è spenta, e finché lo è Filo non esegue comandi sul tuo computer.`
        : 'Il comando non è partito: la modalità terminale è spenta, e finché lo è Filo non esegue comandi sul tuo computer.';
      const apri = document.createElement('button');
      apri.type = 'button';
      apri.className = 'dash-action-btn dash-cmd-blocked-btn';
      apri.textContent = 'Apri Preferenze';
      apri.title = 'Preferenze → Modalità terminale';
      apri.addEventListener('click', () => send({ type: MSG.OPEN_URL, url: PREF_TERMINALE, via: 'chat' }));
      wrap.append(testo, apri);
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
  const percorsoLocale = (p) => !!window.SN_NOMI_FILE && window.SN_NOMI_FILE.percorsoLocale(p);
  // Se il bottone non porta il «dove» coi nomi di Filo (una chat riaperta): le ultime due cartelle; il percorso intero sta
  // nel suggerimento.
  function cartellaBreve(p) {
    const pezzi = String(p || '').split(/[\\/]+/).filter(Boolean);
    pezzi.pop();
    return pezzi.slice(-2).join(' › ');
  }
  function esitoSulFile(btn, testo) {
    const R = window.SN_RINOMINA_UI;
    if (R && R.esito) R.esito(btn, testo, { errore: true });
    else btn.title = testo;
  }
  async function apriFileDaChat(btn, a) {
    const percorso = String(a.percorso || a.path || '');
    let r = null;
    try { r = await send({ type: MSG.FILE_APRI, percorso }); } catch (_) { r = null; }
    if (!r || !r.ok) esitoSulFile(btn, (r && r.frase) || 'Il file non si è aperto');
  }
  async function mostraNellaCartella(btn, a) {
    const percorso = String(a.percorso || a.path || '');
    let r = null;
    try { r = await send({ type: MSG.FILE_MOSTRA_CARTELLA, percorso }); } catch (_) { r = null; }
    if (!r || !r.ok) esitoSulFile(btn, (r && r.frase) || 'La cartella non si è aperta');
    else if (r.mancaIlFile) esitoSulFile(btn, 'Il file non c’è più in quella cartella: forse è stato spostato o rinominato');
  }
  // #947 — il documento trovato: un clic lo apre col programma del sistema, il tasto destro ha le azioni di un file,
  // e si trascina nel campo dove si scrive a Filo (o fuori, in un altro programma, col suo percorso).
  // Un file o una pagina presi da una risposta e lasciati dove nessuno li prende (#1471): il rilascio preso lo conta
  // chi lo prende.
  function contaFineTrascinamento(e, origine) {
    const ev = global.SN_GESTI && global.SN_GESTI.fine(e, origine);
    if (ev && send) Promise.resolve(send({ type: MSG.CONTATORI_EVENTO, ...ev })).catch(() => {});
  }
  function bottoneFile(a) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dash-action-btn dash-file-btn';
    btn.draggable = true;
    const icona = document.createElement('span');
    icona.className = 'dash-file-btn-icona';
    icona.setAttribute('aria-hidden', 'true');
    const ICONE = window.SN_ICONS;
    if (ICONE && typeof ICONE.readDocument === 'function') icona.innerHTML = ICONE.readDocument(15);
    const nome = document.createElement('span');
    nome.className = 'dash-file-btn-nome';
    // L'etichetta la sceglie il modello, e può aver letto un documento ostile: il nome che si apre è quello vero (#1499).
    const etichetta = document.createElement('span');
    etichetta.className = 'dash-file-btn-etichetta';
    const dove = document.createElement('span');
    dove.className = 'dash-file-btn-dove';
    btn.append(icona, nome, etichetta, dove);
    const disegna = () => {
      const p = String(a.percorso || a.path || '');
      const vero = nomeDelPercorso(p);
      nome.textContent = vero || 'File';
      const detta = String(a.etichetta || a.label || '').trim();
      const uguale = (x) => x.toLowerCase() === vero.toLowerCase() || x.toLowerCase() === vero.replace(/\.[^.]+$/, '').toLowerCase();
      etichetta.textContent = detta && !uguale(detta) ? detta : '';
      etichetta.hidden = !etichetta.textContent;
      const doveFilo = a._output && typeof a._output.dove === 'string' ? a._output.dove : '';
      dove.textContent = doveFilo || cartellaBreve(p);
      dove.hidden = !dove.textContent;
      btn.title = `Apri · ${p}`;
      btn.dataset.percorso = p;
    };
    disegna();
    btn.addEventListener('click', () => apriFileDaChat(btn, a));
    btn.addEventListener('dragstart', (e) => {
      const p = String(a.percorso || a.path || '');
      if (!e.dataTransfer || !p) return;
      e.dataTransfer.setData('application/x-filo-file', p);
      e.dataTransfer.setData('text/plain', p);
      e.dataTransfer.effectAllowed = 'copy';
      global.SN_GESTI?.marca(e.dataTransfer, 'file_da_chat');
    });
    btn.addEventListener('dragend', (e) => contaFineTrascinamento(e, 'file_da_chat'));
    menuDelFile(btn, a, { disegna, locale: true });
    return btn;
  }
  function menuDelFile(btn, a, { disegna = null, locale = false } = {}) {
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
      if (disegna) { disegna(); return; }
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
        if (locale && percorso) {
          voci.push(['Mostra nella cartella', () => mostraNellaCartella(btn, a)]);
          if (allegaFile) voci.push(['Metti nel messaggio', () => allegaFile(String(a.percorso || a.path || ''))]);
        }
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

  // #845 — le pagine salvate che la risposta nomina: il clic fa quello della lista «Aperti per dopo» (la apre e la
  // toglie), il tasto destro ha le sue voci, e si trascinano come un link.
  function salvateDaMostrare(a) {
    const o = a && a._output;
    if (!isType(a, 'CERCA_SALVATE') || a._executed === false || !o || !Array.isArray(o.pagine) || !Array.isArray(o.nominate)) return [];
    return o.nominate.map((id) => o.pagine.find((p) => p && p.id === id)).filter((p) => p && /^https?:\/\//i.test(String(p.url || '')));
  }
  async function apriSalvataDaChat(btn, p, { tieni = false } = {}) {
    if (btn.dataset.inCorso) return;
    btn.dataset.inCorso = '1';
    const msg = { type: MSG.APRI_PAGINA_SALVATA, id: p.id, tieni };
    let r = null;
    try { r = await send(msg); } catch (_) { r = null; }
    // Un indirizzo che la porta delle uscite vuole confermato si conferma qui, come i collegamenti della chat.
    if (r && r.conferma) {
      const Ui = window.SN_CONFIRM_UI;
      const ok = Ui ? await Ui.confirm({ title: 'Filo chiede conferma', text: String(r.conferma), parti: r.parti }) : window.confirm(String(r.conferma));
      r = null;
      if (ok) { try { r = await send({ ...msg, confermato: true }); } catch (_) { r = null; } }
      if (!ok) { delete btn.dataset.inCorso; return; }
    }
    delete btn.dataset.inCorso;
    // Già aperta da un'altra strada, o tolta dalla lista: resta un link, e si apre come gli altri della chat.
    if (!r || !r.ok) { apriProposta(p.url, btn); return; }
    if (!r.tolta) return;
    btn.classList.add('dash-salvata-aperta');
    btn.title = `Riapri ${p.title || p.url} · non è più in «Aperti per dopo»`;
  }
  // Il posto dell'icona resta finché il main la cerca; se non la trova resta il solo nome, e l'icona arriva quando una
  // scheda di quel sito la trova (#848), senza ridisegnare la riga. Il sito si legge come nel main: www.x.it è x.it.
  const sitoDi = (url) => {
    try {
      const u = new URL(String(url || ''));
      return /^https?:$/.test(u.protocol) ? u.host.replace(/^www\./, '') : '';
    } catch (_) { return ''; }
  };
  function iconaSitoEl(url) {
    const img = document.createElement('img');
    img.className = 'dash-action-favicon';
    img.alt = '';
    const sito = sitoDi(url);
    if (sito) img.dataset.sito = sito;
    img.onerror = () => { img.removeAttribute('src'); img.hidden = true; };
    iconaDelSito(url).then((dato) => {
      if (img.getAttribute('src')) return;
      if (dato) img.src = dato; else img.hidden = true;
    });
    return img;
  }
  function iconaDellaScheda(sito, dato) {
    if (typeof sito !== 'string' || !sito || typeof dato !== 'string' || !/^data:image\//i.test(dato)) return;
    for (const img of document.querySelectorAll('img.dash-action-favicon[data-sito]')) {
      if (img.dataset.sito !== sito || img.getAttribute('src')) continue;
      img.hidden = false;
      img.src = dato;
    }
  }

  function bottoneSalvata(p) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dash-action-btn dash-action-link-chip dash-salvata-btn';
    btn.draggable = true;
    btn.dataset.pageId = String(p.id || '');
    btn.dataset.url = String(p.url || '');
    btn.title = `Apri ${p.title || p.url} e toglila da «Aperti per dopo»`;
    btn.appendChild(iconaSitoEl(p.url));
    let sito = '';
    try { sito = new URL(p.url).hostname.replace(/^www\./, ''); } catch (_) {}
    const titolo = pulito(p.title) || sito || p.url;
    btn.appendChild(document.createTextNode(`↗ ${titolo.length > 70 ? `${titolo.slice(0, 69)}…` : titolo}`));
    btn.addEventListener('click', () => apriSalvataDaChat(btn, p));
    btn.addEventListener('dragstart', (e) => {
      if (!e.dataTransfer) return;
      e.dataTransfer.setData('text/uri-list', p.url);
      e.dataTransfer.setData('text/plain', p.url);
      e.dataTransfer.effectAllowed = 'copy';
      global.SN_GESTI?.marca(e.dataTransfer, 'pagina_salvata');
    });
    btn.addEventListener('dragend', (e) => contaFineTrascinamento(e, 'pagina_salvata'));
    const R = window.SN_RINOMINA_UI;
    const apriMenu = (e) => {
      if (!R || typeof R.menu !== 'function') return;
      e.preventDefault();
      const rect = btn.getBoundingClientRect();
      const x = e.type === 'contextmenu' && e.clientX ? e.clientX : rect.left;
      const y = e.type === 'contextmenu' && e.clientY ? e.clientY : rect.bottom;
      R.menu(x, y, [
        ['Apri', () => apriSalvataDaChat(btn, p)],
        ['Apri e tienila in lista', () => apriSalvataDaChat(btn, p, { tieni: true })],
        ['Copia link', () => { navigator.clipboard.writeText(p.url).catch(() => {}); }],
        ['Apri «Aperti per dopo»', () => send({ type: MSG.OPEN_HOME, highlight: p.id }).catch(() => {})],
      ], { ancora: btn });
    };
    btn.addEventListener('contextmenu', apriMenu);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) apriMenu(e);
    });
    return btn;
  }
  function bottoniSalvate(a) {
    const pagine = salvateDaMostrare(a);
    if (!pagine.length) return null;
    const box = document.createElement('span');
    box.className = 'dash-salvate';
    for (const p of pagine) box.appendChild(bottoneSalvata(p));
    return box;
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

  // Quel che l'utente finisce col bottone (l'evento aggiunto al calendario) vale come una conferma data nel
  // popup: lo sanno il diario, l'archivio e il modello al turno dopo. Un secondo click non lo conta due volte.
  function segnaCompiuta(a, activity, esito = {}, chat = '') {
    if (!a || (a._output && a._output.fatto)) return;
    segnaConfermata(a, { ...(a._output || {}), ...esito, proposta: false, fatto: true }, activity, null, { chat });
  }

  // Chiude la conversazione una volta sola, e lo dice: il filo resta a schermo, quindi senza il segno il clic non si vede.
  function bottoneChiudi(onAck, etichetta, titolo) {
    const btn = document.createElement('button');
    btn.className = 'dash-action-btn';
    btn.type = 'button';
    btn.textContent = etichetta;
    btn.title = titolo;
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      btn.disabled = true;
      onAck();
      btn.textContent = '✓ Conversazione chiusa';
      btn.title = 'Il prossimo messaggio comincia una conversazione nuova';
    });
    return btn;
  }

  function renderActionButton(a, { onAck, activity = null, chat = '', gruppo = null } = {}) {
    const type = String(a.type || '').toUpperCase();
    // In attesa di conferma come le altre, ma la si dà dalla loro UI: il
    // bottone del riordino, il pannello con l'elenco da eliminare.
    if (permessoDaConcedere(a)) return bottonePermesso(a);
    // I pannelli sono conferme della stessa risposta come i bottoni: la ripresa aspetta anche loro (#1685).
    if ((type === 'PULISCI_TAB' || type === 'CANCELLA_ARCHIVIO') && gruppo) gruppo.pendenti.add(a);
    if (type === 'PULISCI_TAB') return renderBottoneRiordino(a, activity, chat, gruppo);
    if (type === 'CANCELLA_ARCHIVIO') return renderDeleteArchivePanel(a, activity, chat, gruppo);
    // Azione sospesa in attesa di conferma (#146.2): il main non l'ha eseguita
    // (livello 2 o 3) e ha allegato spiegazione + livello. Il bottone apre il
    // popup OK/Annulla (2) o il box "digita conferma" (3); solo dopo il sì
    // dell'utente l'azione parte davvero via MSG.FILO_CONFIRM_ACTION.
    if (a._confirm && a._confirm.level >= 2) {
      if (gruppo) gruppo.pendenti.add(a);
      if (!a._rigaChiesta) a._rigaChiesta = primaRigaConferma(a);
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
      const shortLabel = global.SN_ESITO.primaRigaConferma(fullText) || 'Esegui';
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
      const AUTO_CONFIRM_TYPES = ['IMPOSTA_PREFERENZA', 'IMPOSTA_ESTETICA', 'INVIA_FEEDBACK', 'SALVA_LEZIONE', 'DIMENTICA', 'CORREGGI_MEMORIA', 'RINOMINA_FILE', 'BLUETOOTH', 'WIFI', 'INSTALLA_AGGIORNAMENTO', 'VEDI_SCHERMO', 'CHIUDI_SCHEDE', 'PULSANTE_PREFERENZE'];
      // Una difesa abbassata (#530) vuole la parola, ma non è distruttiva: il box si apre da solo come il popup.
      if (AUTO_CONFIRM_TYPES.includes(type) && (a._confirm.level === 2 || a._confirm.avviso)) {
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
        const opts = { title: 'Filo chiede conferma', text: a._confirm.text || '', parti: a._confirm.parti, avviso: a._confirm.avviso || '' };
        const ok = Ui
          ? await (a._confirm.level >= 3 ? Ui.confirmTyped(opts) : Ui.confirm(opts))
          : window.confirm(opts.text); // fallback se il modulo non è caricato
        if (!ok) {
          // Il no non fa partire niente e non richiama il modello (come negli harness di Anthropic): lo leggerà al
          // messaggio dopo, per non riproporla (#1373). I contatori lo contano (#1461).
          a._rifiutata = true;
          try { Promise.resolve(send({ type: MSG.FILO_CONFIRM_RIFIUTATA, action: a })).catch(() => {}); } catch (_) {}
          // Il no resta nella conversazione del bottone, al posto della domanda: riaperta, chat e modello lo sanno.
          const no = voceDellaConferma(a);
          if (no) try { archiviaAzione(type, [], a, { chat, voce: { ...no, proposta: primaRigaConferma(a) } }); } catch (_) {}
          proseguiQuandoLibero(chat, null, gruppo, a);
          return;
        }
        delete a._rifiutata;
        btn.disabled = true;
        // Catturare e far leggere una finestra prende qualche secondo: il bottone dice che Filo ci sta lavorando.
        if (type === 'VEDI_SCHERMO') btn.textContent = 'Guardo la finestra…';
        // Le parole di un'altra conversazione non sbloccano niente in questa (#810).
        const qui = !chat || chat === chatAttuale();
        const chiesta = primaRigaConferma(a);
        const r = await send({ type: MSG.FILO_CONFIRM_ACTION, action: a, parole: qui ? paroleUtente() : [], chatId: chat || chatAttuale() || '' });
        // #1373 — la conferma è una pausa del lavoro, non la sua fine: com'è andata (fatta o no) torna al modello, che
        // continua o chiude. Un segreto fermato non torna: il modello cercherebbe un'altra strada per farlo uscire.
        const riprende = !!(r && !r.rejected && !(r.output && r.output.blocked === 'segreto'));
        // Anche un OK finito male cambia il turno: il modello deve leggere l'esito, non la conferma ancora in corso.
        a._rispostaDopo = true;
        try {
          esitoDellaConferma(r, { chiesta, chat });
        } finally {
          proseguiQuandoLibero(chat, riprende ? voceDellaConferma(a) : null, gruppo, a);
        }
      }
      // Il resto della conferma, dopo la risposta del main: diario, bottone, archivio.
      function esitoDellaConferma(r, { chiesta, chat: c }) {
        // Nemmeno l'OK fa uscire un segreto (#810): la riga dice cosa è stato fermato.
        if (r && r.output && r.output.blocked === 'segreto') {
          a._output = r.output;
          a._executed = false;
          delete a._confirm;
          const row = activityRowFor(a);
          if (activity && row) activity.addRow(row.tipo || a.type, row.icon, row.text, !!row.failed, row.cambi, a, row.title || '');
          btn.textContent = `🔒 ${row ? row.text : 'Fermata'}`;
          archiviaEsito(a, { chat: c });
          return;
        }
        // L'utente ha detto sì: da qui in poi l'azione è FATTA. Lo deve sapere
        // il diario (una riga come per le azioni di livello 1) e lo deve sapere
        // il MODELLO al turno dopo — l'oggetto è lo stesso che sta nello
        // storico della conversazione, quindi basta segnarlo qui. Senza,
        // a «l'hai attivato?» il modello poteva solo tirare a indovinare.
        if (r && r.executed) segnaConfermata(a, r.output, activity, r.cambi, { chat: c, fatto: r.fatto });
        // #778, #553 — guardare una finestra o leggere una pagina dopo l'OK: anche non riuscita, la riga lo dice e Filo
        // riprende da solo per rispondere (la ripresa la decide chi ha chiamato).
        if ((type === 'VEDI_SCHERMO' || type === 'LEGGI_PAGINA') && r && !r.rejected && !r.executed && (type === 'VEDI_SCHERMO' || r.output)) {
          segnaNonRiuscita(a, r.output, activity, btn, { chat: c, chiesta });
          return;
        }
        if (!(r && r.executed)) nonRiuscita(a, r, activity, { chat: c, chiesta });
        const row = activityRowFor(a);
        // #146.6 — comando confermato (livello 2/3): mostra l'output in chat.
        if (isCmd) {
          segnaComando((r && r.executed) ? '✓' : '✗');
          const out = r && r.output;
          // L'esito di un comando confermato è un passo del lavoro: nel diario, come quello di sola lettura.
          if (out && !out.blocked && !out.no && activity && r.executed) activity.addCommand(out, spiegazioneDi(a), a);
          else if (out && !out.no) btn.after(renderCommandResult(out, spiegazioneDi(a)));
          if (out) applyCommandCwd([{ _output: out }]);
          return;
        }
        const fatto = r && typeof r.fatto === 'string' ? r.fatto.trim() : '';
        // Quando non è riuscita il bottone dice PERCHÉ: «Non eseguita» non si può leggere.
        const guasto = row && row.failed ? row.text : 'Non eseguita';
        // A cosa fatta il bottone è una ricevuta: «Filo vuole…» con la spunta davanti diceva fatto e da fare insieme.
        const ricevuta = fatto || (row && !row.failed ? row.text : '') || 'Fatto';
        btn.textContent = (r && r.executed) ? `✓ ${ricevuta.length > 140 ? `${ricevuta.slice(0, 139)}…` : ricevuta}` : `✗ ${guasto.length > 70 ? `${guasto.slice(0, 67)}…` : guasto}`;
        if (fatto.length > 140) btn.title = fatto;
        else if (!(r && r.executed)) btn.title = guasto;
        // #874 — il sistema ha detto no dopo l'OK (un permesso, una rete fuori portata): la frase e, se serve, il tasto.
        if ((type === 'BLUETOOTH' || type === 'WIFI') && r && !r.executed && r.output && r.output.frase) {
          btn.textContent = `✗ ${r.output.frase}`;
          if (r.output.apri) btn.after(bottonePermesso({ ...a, _executed: false, _output: r.output }));
        }
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
        if (r && r.executed && r.output && r.output.sceltaAutonomia === true) {
          const scelta = sceltaAutonomiaEl({ ...a, _output: r.output });
          if (scelta) btn.after(scelta);
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
      btn.appendChild(iconaSitoEl(a.url));
      btn.appendChild(document.createTextNode(bgTabId ? `▸ ${label}` : `↗ ${label}`));
      return btn;
    }
    if (type === 'RINOMINA_FILE') return bottoneRimettiNomi(a);
    if (type === 'CERCA_SALVATE') return bottoniSalvate(a);
    if (stileAccoglienza(a)) return rigaStileAccoglienza(a);
    if (lezioneAccoglienza(a)) return rigaLezioneAccoglienza(a);
    if (sceltaAutonomia(a)) return sceltaAutonomiaEl(a);
    if (sceltaContatori(a)) return sceltaContatoriEl(a);
    if (type === 'APRI_FILE' && percorsoLocale(a.percorso || a.path)) return bottoneFile(a);
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
      btn.addEventListener('click', () => send({ type: MSG.OPEN_URL, url: 'filo://editor/editor.html', via: 'chat' }));
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
    if (type === 'LEGGI_PAGINA') {
      // Traccia, non bottone: la pagina l'ha letta Filo per sé, e la risposta cita i link che contano.
      const traccia = stepTrace(`🌐 ${rigaLetturaPagina(a)}`);
      traccia.title = indirizzoLetto(a);
      return traccia;
    }
    if (type === 'LEGGI_IMPOSTAZIONI') {
      const c = String(a.cerca || '').trim();
      return stepTrace(c ? `⚙ Leggo come è impostato: ${c}` : '⚙ Leggo le impostazioni');
    }
    if (type === 'CERCA_DOCUMENTI') return stepTrace(`🔎 ${testoRicercaDocumenti(a)}`);
    if (type === 'LEGGI_TRASPARENZA') {
      // Traccia del passo intermedio: Filo rilegge le scelte dell'owner messe
      // per iscritto prima di rispondere sul perché di un modello o di un dato.
      return stepTrace('📄 Rileggo la pagina di trasparenza');
    }
    if (type === 'EVENTO_CALENDARIO') {
      // Filo propone, l'utente aggiunge: il main scrive l'evento in un file e
      // lo apre col calendario del computer.
      const ev = (a._output && a._output.evento) || {
        data: a.data || a.date, ora: a.ora || a.orario || a.time,
        titolo: a.titolo || a.title, dettagli: a.dettagli || a.details,
      };
      const btn = document.createElement('button');
      btn.className = 'dash-action-btn dash-action-btn-primary';
      btn.type = 'button';
      btn.textContent = '📅 Aggiungi al calendario';
      btn.title = `${ev.titolo || 'Evento'}${ev.quando ? ` · ${ev.quando}` : ''}`;
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        btn.textContent = '📅 Aggiungo…';
        const r = await send({ type: MSG.CALENDAR_ADD, evento: ev });
        if (r && r.ok) segnaCompiuta(a, activity, { evento: ev, ...(r.aperto ? {} : { nonAperto: true }) }, chat);
        if (r && r.ok && r.aperto) {
          btn.textContent = '✓ Aperto nel calendario';
          // Riapribile: chi chiude per sbaglio la finestra del calendario deve
          // poterlo rimandare, non ritrovarsi un bottone spento.
          btn.disabled = false;
          btn.title = 'Il calendario ha l’evento davanti: salvalo lì. Un altro click lo riapre.';
          return;
        }
        if (r && r.ok) {
          // Nessun programma di calendario ha risposto: il file c'è comunque, e
          // dove sta finito va detto — un bottone che non porta a niente è il
          // difetto che stavamo togliendo.
          btn.textContent = '✓ Evento salvato';
          const nota = document.createElement('div');
          nota.className = 'dash-bubble-note';
          nota.textContent = `Il computer non ha aperto nessun calendario. L’evento è nel file ${r.file}: aprilo col tuo calendario.`;
          btn.after(nota);
          return;
        }
        btn.disabled = false;
        btn.textContent = '📅 Aggiungi al calendario';
        btn.title = `Non è riuscito${r && r.error ? ` (${r.error})` : ''}. Riprova.`;
      });
      return btn;
    }
    if (type === 'COMANDO_FINESTRA' && a._output && a._output.already && onAck) {
      // La home era già questa pagina: ricaricarla porterebbe via lavoro e risposta, quindi la conversazione la chiude
      // l'utente, dopo aver letto. Il nome non promette un ritorno: lo scambio resta nel filo (#831.1).
      return bottoneChiudi(onAck, 'Chiudi la conversazione', 'Lo scambio resta nel filo: il prossimo messaggio ne comincia una nuova');
    }
    return null;
  }

  // Perché il riordino non è potuto partire, o '' se è andato. Un riordino che
  // ha comunque archiviato qualcosa è riuscito, anche se il giudizio è mancato:
  // i doppioni li decide Filo da sé.
  function motivoRiordinoMancato(r, archiviate) {
    if (!r || r.ok === false) return 'Filo non è riuscito a valutare le schede.';
    if (archiviate > 0) return '';
    if (r.giaInCorso) return 'Un riordino è già in corso.';
    if (r.giudizioMancato) return 'Filo non è riuscito a valutare le schede.';
    return '';
  }

  // L'esito del riordino come lo legge l'utente. Una frase sola per le tre
  // strade che lo chiedono (bottone in chat, suggerimento della home,
  // «/pulisci»): tre copie divergono, e il caso mai partito torna a somigliare
  // a quello riuscito su due strade su tre.
  function esitoRiordino(r) {
    const n = (r && r.archived) || 0;
    const motivo = motivoRiordinoMancato(r, n);
    if (motivo) return { ok: false, testo: 'Riordino non riuscito', motivo };
    return {
      ok: true,
      motivo: '',
      testo: n > 0 ? `Archiviate ${n} ${n === 1 ? 'scheda' : 'schede'}` : 'Nessuna scheda da archiviare',
    };
  }

  // Cosa chiedeva la conferma, prima che il sì la tolga: riaperta, la chat dice cosa non è riuscito.
  function primaRigaConferma(a) {
    return global.SN_ESITO.primaRigaConferma(a && a._confirm && a._confirm.text);
  }

  // Com'è andata un'azione decisa dopo il turno entra nell'archivio, nella conversazione dove è nato il bottone (#1294):
  // la cosa fatta coi numeri veri, o il perché del no.
  function archiviaEsito(a, { chat = '', fatto = '', chiesta = '', cambi = [] } = {}) {
    const E = global.SN_ESITO;
    const type = String((a && a.type) || '').toUpperCase();
    const esito = E.esitoAzione(a);
    // La stessa voce che archivia il turno (le parole del diario coi numeri, il perché di un no): una regola sola.
    const voce = E.voceArchivio(a) || { type, esito };
    if (voce.esito === E.FALLITO && chiesta && voce.type !== 'FERMATA') voce.riga = chiesta;
    if (!voce.riga && fatto) voce.riga = fatto;
    // Quale domanda chiude, fra quelle aperte della risposta che l'aveva proposta.
    if (a) a._voce = { ...voce };
    if (a && a._rigaChiesta) voce.proposta = a._rigaChiesta;
    try { archiviaAzione(type, cambi, a, { chat, voce }); } catch (_) {}
  }

  // L'OK è arrivato ma non è successo niente: la riga «Conferma chiesta» diventa il perché, e il riassunto non la
  // conta.
  function nonRiuscita(a, r, activity, { chat = '', chiesta = '' } = {}) {
    delete a._confirm;
    a._executed = false;
    if (r && r.output) a._output = r.output;
    const row = activityRowFor(a);
    if (activity && row) activity.addRow(row.tipo || a.type, row.icon, row.text, true, row.cambi, a);
    archiviaEsito(a, { chat, chiesta });
  }

  // Confermata e fatta: lo sanno il diario e, al turno dopo, il modello (è lo
  // stesso oggetto che sta nello storico della conversazione).
  function segnaConfermata(a, output, activity, cambi, { chat = '', fatto = '' } = {}) {
    a._confirmed = true;
    a._executed = true;
    delete a._confirm;
    delete a._domanda;
    delete a._perche;
    if (output) a._output = output;
    const ids = Array.isArray(cambi) ? cambi : [];
    if (ids.length) {
      a._cambi = ids;
      if (activity && activity.el && global.SN_DASH_CAMBI) global.SN_DASH_CAMBI.segna(activity.el, ids);
    }
    const row = activityRowFor(a);
    if (activity && row) activity.addRow(a.type, row.icon, row.text, !!row.failed, row.cambi, a, row.title || '');
    // Il turno l'aveva archiviata come chiesta: adesso è successa.
    archiviaEsito(a, { chat, fatto, cambi: ids.map((c) => c.id) });
  }

  // Confermata ma non riuscita (la finestra si è chiusa, il modello non ha risposto): il diario e il bottone lo dicono.
  function segnaNonRiuscita(a, output, activity, btn, { chat = '', chiesta = '' } = {}) {
    a._output = output || {};
    a._executed = false;
    delete a._confirm;
    const row = activityRowFor(a);
    if (activity && row) activity.addRow(a.type, row.icon, row.text, true, null, a, row.title || '');
    archiviaEsito(a, { chat, chiesta });
    btn.textContent = `✗ ${row ? row.text : 'Non eseguita'}`;
    if (permessoDaConcedere(a)) btn.after(bottonePermesso(a));
  }

  // Il riordino che la regola non fa partire da solo parte al clic, e chiede come dice `_domanda` (#530).
  function renderBottoneRiordino(a, activity, chat = '', gruppo = null) {
    const btn = document.createElement('button');
    btn.className = 'dash-action-btn dash-action-btn-primary';
    btn.type = 'button';
    btn.textContent = '🧹 Riordina e archivia le schede';
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      if (!(await chiediSecondoRegola(a._domanda, { title: 'Riordino delle schede', text: TESTO_RIORDINO, okLabel: 'Procedi' }, a._perche, 'PULISCI_TAB'))) {
        pannelloSenzaEsito(a, chat, { no: true, gruppo });
        return;
      }
      btn.disabled = true;
      btn.textContent = '🧹 Riordino in corso…';
      const r = await send({ type: MSG.RUN_TAB_TRIAGE });
      const e = esitoRiordino(r);
      if (!e.ok) {
        btn.disabled = false;
        btn.textContent = '🧹 Riordino non riuscito · riprova';
        btn.title = e.motivo;
        pannelloSenzaEsito(a, chat, { motivo: e.motivo, gruppo });
        return;
      }
      btn.textContent = `✓ ${e.testo}`;
      segnaConfermata(a, { archived: r.archived || 0 }, activity, null, { chat });
      proseguiQuandoLibero(chat, voceDellaConferma(a), gruppo, a);
    });
    return btn;
  }

  // Un pannello (riordino, eliminazione dall'archivio) chiuso con un no o finito male: lo sanno la conversazione del
  // bottone e il modello, come per le altre conferme (#1373). Un no non fa ripartire il lavoro; un guasto sì. Il
  // bottone resta: un nuovo tentativo prende il posto di questa voce.
  function pannelloSenzaEsito(a, chat, { no = false, motivo = '' } = {}) {
    const E = global.SN_ESITO;
    const L = global.SN_ACTION_LEVELS;
    const type = String((a && a.type) || '').toUpperCase();
    let riga = '';
    try { riga = L ? E.primaRigaConferma(L.describe(a)) : ''; } catch (_) { riga = ''; }
    const voce = no
      ? { type, esito: E.FALLITO, riga, motivo: E.MOTIVO_NO }
      : { type, esito: E.FALLITO, riga, motivo: String(motivo || '').slice(0, 200), riprova: true };
    a._voce = { ...voce };
    try { archiviaAzione(type, [], a, { chat, voce }); } catch (_) {}
    if (!no) proseguiQuandoLibero(chat, { ...voce });
  }

  // Come chiedere lo dice la regola di autonomia del main (#530), mai il pannello. Senza risposta: la parola.
  // `perche`: la frase della regola quando a far chiedere è ciò che il compito ha letto.
  // `tipo`: l'azione del pannello, perché i contatori sappiano cosa ha scelto la persona (#1461).
  async function chiediSecondoRegola(domanda, opts, perche = '', tipo = '') {
    if (domanda === 'si') return true;
    if (perche) opts = { ...opts, text: `${opts.text}\n\n${perche}` };
    const Ui = window.SN_CONFIRM_UI;
    const ok = Ui ? await (domanda === 'chiede' ? Ui.confirm(opts) : Ui.confirmTyped(opts)) : window.confirm(opts.text);
    if (tipo) Promise.resolve(send({ type: MSG.CONTATORI_EVENTO, misura: 'conferma', chiave: `pannello:${tipo}`, esito: ok ? 'approvata' : 'rifiutata' })).catch(() => {});
    return ok;
  }

  const TESTO_RIORDINO = 'Filo valuterà tutte le schede aperte e archivierà quelle non più utili. '
    + 'Le schede archiviate restano nel filo della home, e le ritrovi cercandole lì.';
  // Il riordino chiesto fuori dalla chat (/pulisci, il suggerimento della home) passa dalla stessa regola della
  // chat: parte nel main, o torna la domanda da fare. `{ annullato }`, o l'esito come lo legge l'utente (`esitoRiordino`).
  async function riordinaSchede() {
    const r = await send({ type: MSG.FILO_RUN_ACTION, action: { type: 'PULISCI_TAB' }, parole: paroleUtente(), interfaccia: true });
    if (r && r.executed) return esitoRiordino({ ok: true, ...(r.output || {}) });
    if (!r || !r.kept) {
      const o = (r && r.output) || {};
      if (o.giaInCorso || o.giudizioMancato) return esitoRiordino(o);
      return { ok: false, testo: 'Riordino non riuscito', motivo: `${String(o.error || 'non è partito').replace(/\.+$/, '')}.` };
    }
    // Chiesto come assistente (#825.3) torna dal popup generico, che dice `needsConfirm` invece di `domanda`.
    const domanda = r.domanda || (r.needsConfirm === 3 ? 'conferma' : 'chiede');
    if (!(await chiediSecondoRegola(domanda, { title: 'Riordino delle schede', text: TESTO_RIORDINO, okLabel: 'Procedi' }, r.perche, 'PULISCI_TAB'))) return { annullato: true };
    return esitoRiordino(await send({ type: MSG.RUN_TAB_TRIAGE }));
  }

  // §5 — pannello di cancellazione retroattiva: propone TUTTE e SOLE le schede
  // archiviate pertinenti (le sceglie il main) e le elimina DEFINITIVAMENTE
  // dopo conferma esplicita.
  function renderDeleteArchivePanel(a, activity, chat = '') {
    // «Svuota l'archivio» (#1294): lo dice il modello con `tutto`, e il pannello propone tutte le schede senza cercare.
    const tutto = a.tutto === true;
    const query = tutto ? '' : String(a.query || a.testo || '').trim();
    const panel = document.createElement('div');
    panel.className = 'dash-delete-panel';
    // La richiesta la scrive il modello: sta nel suo riquadro, sopra le parole di Filo, dove non
    // può chiudere le virgolette e continuare con la voce di Filo (#592.7).
    if (query || tutto) {
      const chiesta = document.createElement('div');
      chiesta.className = 'dash-delete-query';
      chiesta.textContent = tutto ? 'Tutto l’archivio' : query;
      panel.appendChild(chiesta);
    }
    const note = document.createElement('div');
    note.className = 'dash-delete-note';
    panel.appendChild(note);

    async function cerca() {
      panel.querySelectorAll('.dash-delete-list, .dash-action-btn').forEach((el) => el.remove());
      if (!query && !tutto) {
        note.textContent = 'Non so quali schede eliminare: dimmi di cosa parlano.';
        return;
      }
      note.dataset.cerco = '1';
      const cercoTesto = tutto ? 'Leggo l’archivio…' : 'Cerco nell’archivio le schede su questa richiesta…';
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
        r = await send({ type: MSG.ARCHIVIO_DA_CANCELLARE, query, ...(tutto ? { tutto: true } : {}), richiesta });
      } finally {
        try { chrome.runtime.onMessage.removeListener(suAvanzamento); } catch (_) {}
        delete note.dataset.cerco;
      }
      const results = (r && r.ok && Array.isArray(r.results)) ? r.results : null;
      if (!results) {
        // Senza un giudizio completo non si propone niente: un elenco a metà
        // farebbe credere di aver tolto tutto.
        note.textContent = 'Non sono riuscito a capire quali schede riguardano questa richiesta.';
        const again = document.createElement('button');
        again.className = 'dash-action-btn';
        again.type = 'button';
        again.textContent = 'Riprova';
        again.addEventListener('click', () => { cerca(); });
        panel.appendChild(again);
        return;
      }
      if (!results.length) {
        note.textContent = tutto ? 'L’archivio è già vuoto.' : 'Nessuna scheda archiviata riguarda questa richiesta.';
        return;
      }
      const quante = (n) => `${n} ${n === 1 ? 'scheda' : 'schede'}`;
      if (tutto) {
        note.textContent = results.length === 1
          ? 'Nell’archivio c’è 1 scheda. Verrà eliminata DEFINITIVAMENTE:'
          : `Nell’archivio ci sono ${results.length} schede. Verranno eliminate DEFINITIVAMENTE:`;
      } else {
        note.textContent = results.length === 1
          ? 'Trovata 1 scheda pertinente a questa richiesta. Verrà eliminata DEFINITIVAMENTE:'
          : `Trovate ${results.length} schede pertinenti a questa richiesta. Verranno eliminate DEFINITIVAMENTE:`;
      }
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
        const text = `Eliminare definitivamente ${quante(scelta.length)} dall’archivio.`;
        const ok = await chiediSecondoRegola(a._domanda, { title: 'Eliminazione definitiva', text, okLabel: 'Elimina' }, a._perche, 'CANCELLA_ARCHIVIO');
        if (del.disabled) return;
        if (!ok) { pannelloSenzaEsito(a, chat, { no: true }); return; }
        del.disabled = true;
        scelte.forEach((x) => { x.box.disabled = true; });
        del.textContent = 'Elimino…';
        const res = await send({ type: MSG.DELETE_ARCHIVED_TABS, ids: scelta.map((x) => x.id) });
        if (!res || !res.ok) {
          scelte.forEach((x) => { x.box.disabled = false; });
          etichetta();
          note.textContent = 'Eliminazione non riuscita: l’archivio è com’era. Riprova.';
          pannelloSenzaEsito(a, chat, { motivo: 'l’archivio è rimasto com’era' });
          return;
        }
        const removed = res.removed || 0;
        del.remove();
        ul.remove();
        note.textContent = removed === 1
          ? '✓ Eliminata definitivamente 1 scheda.'
          : `✓ Eliminate definitivamente ${quante(removed)}.`;
        segnaConfermata(a, { eliminate: removed }, activity, null, { chat });
        proseguiQuandoLibero(chat, voceDellaConferma(a));
      });
      panel.appendChild(del);
    }
    cerca();
    return panel;
  }

  function init(deps) {
    send = deps.send;
    if (deps.allegaFile) allegaFile = deps.allegaFile;
    if (deps.iconaDelSito) iconaDelSito = deps.iconaDelSito;
    if (deps.applyCommandCwd) applyCommandCwd = deps.applyCommandCwd;
    if (deps.paroleUtente) paroleUtente = deps.paroleUtente;
    if (deps.apriProposta) apriProposta = deps.apriProposta;
    if (deps.archiviaAzione) archiviaAzione = deps.archiviaAzione;
    if (deps.chatAttuale) chatAttuale = deps.chatAttuale;
    if (deps.sceltaAutonomia) sceltaAutonomiaEl = deps.sceltaAutonomia;
    if (deps.sceltaContatori) sceltaContatoriEl = deps.sceltaContatori;
    if (deps.prosegui) prosegui = deps.prosegui;
  }

  // #1294 — una risposta riletta dall'archivio racconta ogni azione con la sua riga, e i file col loro bottone. Oltre
  // `RIGHE_VISTE` voci le riuscite stanno nella frase riassunto, che le elenca al passaggio del mouse.
  const RIGHE_VISTE = 4;
  function esitiArchiviati(voci, { chat = '' } = {}) {
    const E = global.SN_ESITO;
    const lista = (Array.isArray(voci) ? voci : []).filter((v) => v && v.type);
    if (!lista.length) return { righe: null, nota: null };
    const tutte = lista.length <= RIGHE_VISTE;
    const wrap = document.createElement('div');
    wrap.className = 'dash-bubble-actions dash-esiti-archiviati';
    const riuscite = [];
    for (const v of lista) {
      // Il file si racconta col suo bottone, come nella risposta in diretta.
      if (v.type === 'APRI_FILE' && v.file && percorsoLocale(v.file.percorso)) {
        wrap.appendChild(bottoneFile({ type: 'APRI_FILE', percorso: v.file.percorso, etichetta: v.file.etichetta || '', _executed: true }));
        continue;
      }
      // L'evento ancora da aggiungere ritrova il suo bottone, come nella risposta in diretta (#1685).
      if (v.type === 'EVENTO_CALENDARIO' && v.esito === E.PROPOSTO && v.evento) {
        const btn = renderActionButton({ type: 'EVENTO_CALENDARIO', _output: { proposta: true, evento: v.evento } }, { chat });
        if (btn) { wrap.appendChild(btn); continue; }
      }
      // La conferma rimasta senza risposta ritrova il suo bottone: il popup richiede il sì come allora (#1685).
      if (v.esito === E.CHIESTO && v.azione && v.conferma) {
        const btn = renderActionButton({
          ...v.azione, type: v.type, _confirm: { level: v.conferma.livello, text: v.conferma.testo }, _executed: false,
          ...(v.conferma.domanda ? { _domanda: v.conferma.domanda } : {}),
        }, { chat });
        if (btn) { wrap.appendChild(btn); continue; }
      }
      const riga = E.rigaDellaVoce(v);
      if (riga && (tutte || riga.fallita)) wrap.appendChild(makeActivityRow(riga.icona, riga.testo));
      else if (riga) riuscite.push(riga.testo);
    }
    let nota = null;
    if (riuscite.length) {
      nota = document.createElement('div');
      nota.className = 'dash-bubble-note';
      nota.dataset.replay = '1';
      nota.textContent = summarizeActivity(lista, false);
      nota.title = riuscite.join('\n');
    }
    return { righe: wrap.childElementCount ? wrap : null, nota };
  }

  global.SN_DASH_ATTIVITA = {
    init,
    // Il contratto: un blocco di attività appeso a `container`.
    create: createActivity,
    esitiArchiviati,
    renderActions,
    aperturaFermata,
    tellActionInActivity,
    stepTrace,
    isType,
    esitoRiordino,
    // #525 — «Ha aperto una pagina e avviato un timer»: la stessa frase del
    // diario del turno, per chi RIAPRE una chat archiviata.
    summarizeActivity,
    riordinaSchede,
    activityRowFor,
    // Main → la prima icona di una scheda (ICONA_SCHEDA): la prendono le righe di quel sito rimaste senza.
    iconaDellaScheda,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
