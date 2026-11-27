// Le carte della home (#870): a sinistra quello che accade, a destra quello che l'utente tiene, sotto «altro».
// Timer, avvisi e suggerimenti li riceve da dashboard.js, che li possiede; la disposizione la chiede al main.
// Regole: patterns/le-carte-della-home-hanno-un-contratto-unico.md
(function (global) {
  'use strict';

  let d = null;
  let MSG = null;
  let C = null;
  let accadeEl = null;
  let tieniEl = null;
  let altroEl = null;

  let layout = null;
  // Il primo incontro (#1661) lo decide il main: legge l'accoglienza dal disco anche in incognito.
  let primoIncontro = false;
  let giroPrimo = 0;
  const dati = {
    timers: [],
    notifiche: [],
    suggerimenti: [],
    suggerimentiPronti: false,
    tuttiSuggerimenti: false,
    downloads: [],
    lavori: [],
    cornice: [],
    editor: null,
    mazzi: null,
    impostazioni: null,
    // Bacheca e Deck builder in pausa (#1592): finché il main non risponde, in pausa come per chi non li vede.
    aperte: { bacheca: false, mazzi: false },
  };

  const VOCI_IN_CARTA = 5;
  const SUGGERIMENTI_VISIBILI = 5;
  const URL_EDITOR = 'filo://editor/editor.html';
  const URL_MAZZI = 'filo://decks/decks.html';
  const URL_SCARICAMENTI = 'filo://downloads/downloads.html';
  const URL_PREFERENZE = 'filo://preferences/preferences.html';
  const URL_PREFERENZE_AGGIORNAMENTI = `${URL_PREFERENZE}#sec-aggiornamenti`;
  const URL_CREDITI = 'filo://credits/credits.html';

  // ===== Piccoli attrezzi =====
  function el(tag, cls, testo) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (testo != null) n.textContent = testo;
    return n;
  }
  function icona(nome, size = 16) {
    const ICONS = global.SN_ICONS || {};
    const s = el('span', 'dash-carta-ico');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = typeof ICONS[nome] === 'function' ? ICONS[nome](size) : '';
    return s;
  }
  // La strada la sa il main (#1468): una pagina di Filo aperta da una carta.
  function apri(url) { d.send({ type: MSG.OPEN_URL, url, via: 'carta_home' }); }
  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2).replace('.', ',')} GB`;
  }
  const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  const hhmm = (dt) => `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
  function quando(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const dt = new Date(t);
    const oggi = new Date();
    if (dt.toDateString() === oggi.toDateString()) return hhmm(dt);
    if (dt.toDateString() === new Date(oggi.getTime() - 864e5).toDateString()) return 'ieri';
    return `${dt.getDate()} ${MESI[dt.getMonth()]}`;
  }
  function plurale(n, uno, tanti) { return n === 1 ? `1 ${uno}` : `${n} ${tanti}`; }
  let avvisoTimer = null;
  // Un errore letto sulle carte si conta come nella barra delle schede, per chiave dell'elenco chiuso (#1461).
  function avvisoErrore(testo, chiave) {
    try { Promise.resolve(d.send({ type: MSG.CONTATORI_EVENTO, misura: 'avviso', chiave })).catch(() => {}); } catch (_) {}
    avviso(testo);
  }
  // L'uso di una carta (#1471): le mosse le conta il main, che le scrive. La chiave di una carta di sinistra porta l'id
  // di quello che accade (un download, un timer): il main ne tiene solo il tipo.
  function contaGesto(gesto, campi) {
    try { Promise.resolve(d.send({ type: MSG.CONTATORI_EVENTO, misura: 'gesto', gesto, ...campi })).catch(() => {}); } catch (_) {}
  }
  const contaUso = (art, come) => contaGesto('carta_home', { carta: art.dataset.chiave, colonna: art.dataset.colonna, come });
  // Una carta trascinata e lasciata dove nessuno la prende.
  function contaFine(e) {
    const ev = global.SN_GESTI && global.SN_GESTI.fine(e, 'carta_home');
    if (ev) try { Promise.resolve(d.send({ type: MSG.CONTATORI_EVENTO, ...ev })).catch(() => {}); } catch (_) {}
  }
  function contaRilascio(e, dove) {
    const ev = global.SN_GESTI && global.SN_GESTI.rilascio(e.dataTransfer, dove);
    if (ev) try { Promise.resolve(d.send({ type: MSG.CONTATORI_EVENTO, ...ev })).catch(() => {}); } catch (_) {}
  }
  function avviso(testo) {
    let n = document.getElementById('dashFlash');
    if (!n) {
      n = el('div', 'dash-flash');
      n.id = 'dashFlash';
      n.setAttribute('role', 'status');
      document.body.appendChild(n);
    }
    n.textContent = testo;
    n.classList.add('vista');
    clearTimeout(avvisoTimer);
    avvisoTimer = setTimeout(() => n.classList.remove('vista'), 2600);
  }

  // ===== Sveglie e timer =====
  function ricorrenza(t) {
    const M = global.SN_FILO_MEMORY;
    return (t.repeat && t.repeat.length && M && M.formatRepeat) ? M.formatRepeat(t.repeat) : '';
  }
  // Se si ripete, il giorno della prossima volta dice meno dei giorni in cui suona (#322).
  function quandoSuona(t) {
    const dt = new Date(t.endsAt);
    const rep = ricorrenza(t);
    if (rep) return `${hhmm(dt)} · ${rep}`;
    const ora = new Date();
    if (dt.toDateString() === ora.toDateString()) return hhmm(dt);
    if (dt.toDateString() === new Date(ora.getTime() + 864e5).toDateString()) return `domani, ${hhmm(dt)}`;
    return `${dt.getDate()}/${dt.getMonth() + 1}, ${hhmm(dt)}`;
  }
  function restante(t) {
    const s = (t.paused && Number.isFinite(t.remainingMs))
      ? Math.max(0, Math.round(t.remainingMs / 1000))
      : Math.max(0, Math.round((new Date(t.endsAt).getTime() - Date.now()) / 1000));
    return global.SN_TIME ? global.SN_TIME.fmtCountdown(s) : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  const timerMsg = (type, id) => () => d.send({ type, id }).then(() => d.refreshLive());

  function cartaTimer(t) {
    const sveglia = t.kind === 'alarm';
    const nome = t.label || (sveglia ? 'Sveglia' : 'Timer');
    const rep = ricorrenza(t);
    // Una sveglia che si ripete: «Ferma» la zittisce per oggi, togliere la carta la toglie del tutto.
    const togli = timerMsg(rep || !t.ringing ? MSG.FILO_DELETE_TIMER : MSG.FILO_STOP_TIMER_ALARM, t.id);
    const base = {
      chiave: C.chiaveTimer(t.id), tipo: sveglia ? 'sveglia' : 'timer', icona: sveglia ? 'alarm' : 'timer',
      titolo: nome, togli, chat: t.chat || null, suona: !!t.ringing,
      etichettaTogli: sveglia ? 'Togli la sveglia' : 'Togli il timer',
    };
    if (t.ringing) {
      return {
        ...base,
        stato: sveglia ? (rep ? `suona · ${rep}` : 'suona adesso') : 'scaduto',
        grande: true,
        principale: { etichetta: 'Ferma', forte: true, fai: timerMsg(MSG.FILO_STOP_TIMER_ALARM, t.id) },
        filo: sveglia ? `La sveglia «${nome}» sta suonando.` : `Il timer «${nome}» è scaduto.`,
      };
    }
    if (sveglia) {
      const q = quandoSuona(t);
      return {
        ...base,
        stato: q,
        principale: { etichetta: 'Sposta', fai: () => d.scriviNelCampo(`Sposta la sveglia «${nome}» alle `) },
        filo: `La sveglia «${nome}» suona ${rep ? `alle ${q}` : (q.startsWith('domani') ? q : `alle ${q}`)}.`,
      };
    }
    const resta = restante(t);
    return {
      ...base,
      stato: t.paused ? `${resta} · in pausa` : resta,
      grande: true,
      principale: t.paused
        ? { etichetta: 'Riprendi', fai: timerMsg(MSG.FILO_RESUME_TIMER, t.id) }
        : { etichetta: 'Pausa', fai: timerMsg(MSG.FILO_PAUSE_TIMER, t.id) },
      filo: t.paused ? `Il timer «${nome}» è in pausa: mancano ${resta}.` : `Il timer «${nome}» scade fra ${resta}.`,
    };
  }

  // ===== Scaricamenti =====
  function percento(r) {
    return r.totalBytes > 0 ? Math.min(100, Math.round((r.receivedBytes / r.totalBytes) * 100)) : null;
  }
  async function apriDownload(r, confermato = false) {
    const res = await d.send({ type: MSG.DOWNLOAD_OPEN_FILE, id: r.id, confirmed: confermato });
    if (!res || res.ok !== false) return;
    // Un programma si apre solo col sì dell'utente (#588): le parole le scrive il main.
    if (res.needsConfirm) {
      const ok = global.SN_CONFIRM_UI
        ? await global.SN_CONFIRM_UI.confirm({ title: res.title, text: res.text, parti: res.parti, okLabel: 'Apri comunque' })
        : global.confirm(res.text);
      if (ok) await apriDownload(r, true);
      return;
    }
    if (res.missing) caricaDownloads();
    avvisoErrore(res.error || 'Il file non si apre', 'file_non_aperto');
  }
  const cmdDownload = (type, r) => () => d.send({ type, id: r.id }).then(caricaDownloads);

  function cartaDownload(r) {
    const nome = r.filename || 'download';
    const pct = percento(r);
    const base = {
      chiave: C.chiaveDownload(r.id), tipo: 'download', icona: 'download', titolo: nome,
      togli: () => muovi({ tipo: 'nascondi', chiave: C.chiaveDownload(r.id) }), etichettaTogli: 'Togli dalla home',
      esterno: 'download',
      altreVoci: [{ etichetta: 'Mostra nei Download', fai: () => apri(URL_SCARICAMENTI) }],
    };
    if (r.state === 'progressing' || r.state === 'paused') {
      const fermo = r.state === 'paused';
      let quanto = pct != null ? `${pct}% · ${fmtBytes(r.receivedBytes)} di ${fmtBytes(r.totalBytes)}` : `${fmtBytes(r.receivedBytes)}`;
      // #1488 — un video in streaming dice cosa sta facendo quando non sono byte del file.
      if (r.nota) quanto = pct != null || r.receivedBytes ? `${r.nota.toLowerCase()} · ${quanto}` : r.nota.toLowerCase();
      // #1287 — quanto va veloce e quanto manca, come nel pannello e nella pagina Download.
      let corsa = '';
      try { corsa = global.SN_SCARICAMENTI_AVANZAMENTO.velocitaEResto(r); } catch (_) {}
      if (corsa) quanto = `${quanto} · ${corsa}`;
      const pausa = r.canPause === false ? null : (fermo
        ? { etichetta: 'Riprendi', fai: cmdDownload(MSG.DOWNLOAD_RESUME, r) }
        : { etichetta: 'Pausa', fai: cmdDownload(MSG.DOWNLOAD_PAUSE, r) });
      const annulla = { etichetta: 'Annulla', fai: cmdDownload(MSG.DOWNLOAD_CANCEL, r) };
      return {
        ...base,
        stato: fermo ? `in pausa · ${quanto}` : quanto,
        avanza: pct == null ? -1 : pct,
        principale: pausa || annulla,
        secondaria: pausa ? annulla : null,
        filo: pct != null ? `Sto scaricando «${nome}»: ${pct}% (${fmtBytes(r.receivedBytes)} di ${fmtBytes(r.totalBytes)}).` : `Sto scaricando «${nome}».`,
      };
    }
    if (r.state === 'pending' && r.chiede === 'piuFile') {
      return {
        ...base,
        stato: 'partito da solo: aspetta il tuo sì',
        principale: { etichetta: 'Decidi', fai: () => apri(URL_SCARICAMENTI) },
        filo: `«${nome}» l'ha fatto partire una pagina da sola, senza un tuo clic: lo scarico solo se mi dici di sì, dai Download.`,
      };
    }
    if (r.state === 'pending') {
      return {
        ...base,
        stato: 'è un programma: aspetta il tuo sì',
        principale: { etichetta: 'Decidi', fai: () => apri(URL_SCARICAMENTI) },
        filo: `«${nome}» è un programma: lo scarico solo se mi dici di sì, dai Download.`,
      };
    }
    const cartella = {
      etichetta: 'Cartella',
      fai: () => d.send({ type: MSG.DOWNLOAD_OPEN_FOLDER, id: r.id }).then((res) => {
        if (res && res.ok === false) avvisoErrore(res.error || 'La cartella non si apre', 'cartella_non_aperta');
        else if (res && res.missing && res.avviso) avvisoErrore(res.avviso, 'file_non_aperto');
        caricaDownloads();
      }),
    };
    if (r.state === 'interrupted') {
      // #1287 — «Riprova» rifà lo stesso indirizzo nella stessa carta.
      const riprova = /^https?:/i.test(String(r.url || ''))
        ? { etichetta: 'Riprova', forte: true, fai: () => d.send({ type: MSG.DOWNLOAD_RIPROVA, id: r.id }).then((res) => {
          if (res && res.ok === false) avvisoErrore(res.error || 'Non sono riuscito a far ripartire lo scaricamento', 'download_failed');
          caricaDownloads();
        }) }
        : null;
      // Il perché di un video non salvato (#1488) sta sulla carta e nel filo, non solo nell'avviso.
      const perche = r.nota ? ` ${r.nota}.` : '';
      return { ...base, stato: r.nota ? `interrotto · ${r.nota}` : 'interrotto', principale: riprova || cartella, secondaria: riprova ? cartella : null, filo: `Lo scaricamento di «${nome}» si è interrotto.${perche}` };
    }
    if (r.missing) {
      return { ...base, stato: 'il file non c’è più', principale: cartella, filo: `Avevo scaricato «${nome}», ma il file non è più al suo posto.` };
    }
    const peso = fmtBytes(r.totalBytes || r.receivedBytes);
    return {
      ...base,
      stato: `scaricato · ${peso}`,
      principale: { etichetta: 'Apri', forte: true, fai: () => apriDownload(r) },
      secondaria: cartella,
      filo: `Ho scaricato «${nome}» (${peso}).`,
    };
  }

  // ===== Avvisi e crediti =====
  // Gli avvisi di un aggiornamento da prendere a mano (#1039) portano dove si scarica: il tipo lo scrive solo il main.
  const AVVISI_AGGIORNAMENTO = ['aggiornamento-mac', 'aggiornamento-linux', 'aggiornamento-windows'];
  const URL_SCARICA_FILO = 'https://filo.red';
  function cartaAvviso(n) {
    const allarme = n.kind === 'alert';
    const chiudi = () => d.send({ type: MSG.FILO_DISMISS_NOTIFICATION, id: n.id }).then(() => d.refreshLive());
    const tipo = n.action && n.action.tipo;
    const scarica = AVVISI_AGGIORNAMENTO.includes(tipo);
    // Una versione pronta (#1039): il fallimento lo dice la barra, la carta resta per riprovare.
    const pronto = tipo === 'aggiornamento-pronto';
    const pagina = C.paginaDiAvviso(n);
    let principale = { etichetta: 'Chiudi', fai: chiudi };
    if (pagina) principale = { etichetta: pagina.etichetta, forte: true, fai: () => apri(pagina.url) };
    if (scarica) principale = { etichetta: 'Scarica Filo', forte: true, fai: () => apri(URL_SCARICA_FILO) };
    if (pronto) principale = { etichetta: 'Riavvia e aggiorna', forte: true, fai: () => d.send({ type: MSG.AGGIORNAMENTO_INSTALLA, avvisa: true }) };
    const titolo = n.action && typeof n.action.titolo === 'string' && n.action.titolo.trim();
    const carta = {
      chiave: `avviso:${n.id}`, tipo: 'avviso', icona: pronto ? 'download' : allarme ? 'warning' : 'bell',
      titolo: titolo || (allarme ? 'Avviso' : 'Filo'), stato: n.text, lungo: true,
      principale,
      secondaria: scarica || pronto || pagina ? { etichetta: 'Chiudi', fai: chiudi } : null,
      togli: chiudi, etichettaTogli: 'Chiudi l’avviso',
      filo: n.text,
    };
    // #906 — i giudici fermi: la carta dice uno stato del server e se ne va da sola quando il server lo azzera.
    if (tipo === 'giudici-fermi') return { ...carta, secondaria: null, togli: null, etichettaTogli: null };
    return n.action && n.action.tipo === 'aggiornamento-disponibile' ? cartaAggiornamento(n, carta, chiudi) : carta;
  }
  // #786 — la versione nuova che aspetta il «Installa» dell'utente; cosa le sta succedendo lo dice il main.
  function cartaAggiornamento(n, carta, chiudi) {
    const v = String(n.action.versione || '');
    const a = n.aggiornamento || {};
    const installa = async (b) => {
      if (b) b.disabled = true;
      const r = await d.send({ type: MSG.FILO_INSTALLA_AGGIORNAMENTO });
      if (!r || r.ok === false) {
        if (b) b.disabled = false;
        avvisoErrore((r && r.error) || 'L’aggiornamento non parte', 'aggiornamento_non_avviato');
      }
      d.refreshLive();
    };
    const base = { ...carta, icona: 'download', titolo: 'Aggiornamento' };
    if (a.percento != null) {
      return {
        ...base, stato: `Scarico la versione ${v}: ${a.percento}%`, avanza: a.percento, principale: null,
        filo: `Sto scaricando la versione ${v} di Filo (${a.percento}%). `
          + (a.allApertura ? 'Quando ho finito te lo dico, con «Riavvia e aggiorna».' : 'Si installa quando mi chiudi.'),
      };
    }
    if (a.pronta) {
      return {
        ...base,
        stato: `La versione ${v} è pronta. Si installa ${a.allApertura ? 'la prossima volta che apri Filo' : 'quando chiudi Filo'}.`,
        filo: `La versione ${v} di Filo è scaricata. Si installa ${a.allApertura ? 'la prossima volta che mi apri' : 'quando mi chiudi'}.`,
      };
    }
    return {
      ...base, stato: a.errore ? `C'è la versione ${v} di Filo. ${a.errore}` : n.text,
      principale: { etichetta: 'Installa', forte: true, fai: installa },
      secondaria: { etichetta: 'Chiudi', fai: chiudi },
      altreVoci: [{ etichetta: 'Preferenze sugli aggiornamenti', fai: () => apri(URL_PREFERENZE_AGGIORNAMENTI) }],
    };
  }
  function suggerimentoCrediti() {
    return dati.suggerimenti.find((s) => s && s.carta === 'crediti') || null;
  }
  function cartaCrediti() {
    return {
      chiave: 'crediti', tipo: 'crediti', icona: 'credits', titolo: 'Crediti',
      stato: 'Riscatta l’invito e Filo si accende',
      principale: { etichetta: 'Apri Crediti', forte: true, fai: () => apri(URL_CREDITI) },
      togli: () => muovi({ tipo: 'nascondi', chiave: 'crediti' }), etichettaTogli: 'Togli dalla home',
      filo: 'Per accendermi serve un codice d’invito: lo riscatti nella pagina Crediti, dove puoi anche mettere una tua chiave OpenRouter.',
    };
  }

  // ===== Lavori lunghi in corso (una risposta di Filo, un comando del terminale) =====
  // Quali entrano lo decide il modulo condiviso (la chat li vede uguali); qui si ridisegna quando uno diventa lungo.
  let lavoroTimer = null;
  function programmaLavori() {
    const ora = Date.now();
    const mio = d.chatCorrente();
    const prossimo = dati.lavori.filter((l) => l && !(l.chat && l.chat === mio))
      .map((l) => l.iniziato + C.LAVORO_LUNGO_MS - ora).filter((x) => x > 0);
    clearTimeout(lavoroTimer);
    if (prossimo.length) lavoroTimer = setTimeout(disegna, Math.min(...prossimo) + 50);
  }
  function cartaLavoro(l) {
    const comando = l.tipo === 'comando';
    const carta = {
      chiave: `lavoro:${l.id}`, tipo: 'lavoro', icona: comando ? 'terminal' : 'sparkles',
      titolo: comando ? 'Comando in corso' : 'Filo sta lavorando', stato: l.testo || '…', lungo: true, avanza: -1,
      chat: l.chat || null,
      togli: () => muovi({ tipo: 'nascondi', chiave: `lavoro:${l.id}` }), etichettaTogli: 'Togli dalla home',
      filo: comando ? `Sto ancora eseguendo il comando «${l.testo}».` : `Sto ancora lavorando a «${l.testo}».`,
    };
    carta.principale = { etichetta: 'Vai', forte: true, fai: () => apriCartaNelFilo(carta) };
    return carta;
  }

  // ===== Gli avvisi della barra volati qui (#2390) =====
  // Il modello sta nella shell della finestra: la carta ne mostra testo e azioni, e ogni gesto torna a lei.
  const TITOLO_DA_ICONA = { warning: 'Avviso', download: 'Scaricamento', timer: 'Timer', alarm: 'Sveglia' };
  // `volati`: quelli nella colonna adesso, che «Chiudi tutti» toglie insieme.
  function cartaCornice(a, volati) {
    const allaShell = (azione) => () => d.send({ type: MSG.AVVISI_COLONNA_AZIONE, id: a.id, azione });
    const chiudi = allaShell('chiudi');
    const azioni = (a.azioni || []).map((etichetta, i) => ({ etichetta, fai: allaShell(String(i)) })).filter((x) => x.etichetta);
    const chiudiTutti = () => { for (const x of volati) d.send({ type: MSG.AVVISI_COLONNA_AZIONE, id: x.id, azione: 'chiudi' }); };
    // Il tasto destro è quello dell'avviso nell'angolo: le voci le decide il modulo condiviso.
    const menu = global.SN_FORMA_AVVISO.menu({ azioni: a.azioni, indirizzo: a.indirizzo, quante: volati.length })
      .map((v) => v && { etichetta: v.etichetta, fai: v.azione === 'chiudi-tutti' ? chiudiTutti : allaShell(v.azione) });
    return {
      chiave: `cornice:${a.id}`, tipo: 'cornice', icona: a.icona || 'bell',
      titolo: a.titolo || TITOLO_DA_ICONA[a.icona] || 'Filo', stato: a.testo, lungo: true,
      principale: azioni[0] ? { ...azioni[0], forte: true } : { etichetta: 'Chiudi', fai: chiudi },
      secondaria: azioni[0] ? (azioni[1] || { etichetta: 'Chiudi', fai: chiudi }) : null,
      menu,
      togli: chiudi, etichettaTogli: 'Chiudi l’avviso',
      filo: a.testo,
    };
  }
  // Un avviso che racconta una cosa che ha già la sua carta non diventa una carta in più (SN_CARTE_HOME.sinistra non
  // lo mette): la home fa notare quella, e solo se si vede (in una home dietro un'altra scheda l'avviso aspetta).
  const assorbiti = new Set();
  function assorbi(chiavi) {
    const da = dati.cornice.filter((a) => a.carta && chiavi.has(a.carta) && !assorbiti.has(a.id));
    if (document.visibilityState !== 'visible') return;
    for (const a of da) {
      assorbiti.add(a.id);
      d.send({ type: MSG.AVVISI_COLONNA_AZIONE, id: a.id, azione: 'assorbi' });
      // Al giro dopo: il timer che suona arriva un attimo dopo il suo avviso e rifà la carta.
      setTimeout(() => fattiNotare(a.carta), 400);
    }
  }
  const movimentoRidotto = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };
  function durataMoto(ms) {
    const m = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sn-motion'));
    return Math.round(ms * (Number.isFinite(m) ? m : 1));
  }
  function fattiNotare(chiave) {
    const art = [...accadeEl.querySelectorAll(':scope > .dash-carta')].find((n) => n.dataset.chiave === chiave);
    if (!art) return;
    try { art.scrollIntoView({ block: 'nearest', behavior: movimentoRidotto() ? 'auto' : 'smooth' }); } catch (_) {}
    art.classList.remove('dash-notare');
    // eslint-disable-next-line no-unused-expressions
    art.offsetWidth;
    art.classList.add('dash-notare');
    clearTimeout(art._notare);
    art._notare = setTimeout(() => art.classList.remove('dash-notare'), 2400);
  }
  // Il volo: dall'angolo in basso a destra, dove l'avviso stava, alla sua carta in cima alla colonna. Lo fa una
  // copia sopra la pagina (la colonna taglierebbe la carta vera), che lascia il posto alla carta all'arrivo.
  const VOLO_MS = 560;
  const volate = new Set();
  function volaQui() {
    const ora = Date.now();
    for (const a of dati.cornice) {
      if (!a.vola || volate.has(a.id)) continue;
      volate.add(a.id);
      if (ora - a.vola > 2500 || document.visibilityState !== 'visible' || movimentoRidotto()) continue;
      const art = [...accadeEl.querySelectorAll(':scope > .dash-carta')].find((n) => n.dataset.chiave === `cornice:${a.id}`);
      const ms = durataMoto(VOLO_MS);
      if (art && ms > 0) vola(art, ms);
    }
  }
  function vola(art, ms) {
    const r = art.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const w = Math.min(360, global.innerWidth * 0.8);
    const h = Math.max(44, Math.min(r.height, 120));
    const da = { x: global.innerWidth - 16 - w, y: global.innerHeight - 16 - h };
    const copia = art.cloneNode(true);
    copia.removeAttribute('id');
    copia.classList.add('dash-carta-in-volo');
    copia.setAttribute('aria-hidden', 'true');
    Object.assign(copia.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    document.body.appendChild(copia);
    art.style.visibility = 'hidden';
    const fine = () => { copia.remove(); art.style.visibility = ''; };
    try {
      const anim = copia.animate([
        { transform: `translate(${da.x - r.left}px, ${da.y - r.top}px) scale(${w / r.width}, ${h / r.height})`, opacity: 0.85 },
        { transform: 'translate(0, 0) scale(1, 1)', opacity: 1 },
      ], { duration: ms, easing: 'cubic-bezier(.2, .75, .25, 1)' });
      anim.onfinish = fine;
      anim.oncancel = fine;
    } catch (_) { fine(); }
  }
  async function caricaCornice() {
    const r = await d.send({ type: MSG.AVVISI_COLONNA_LEGGI });
    if (r && r.ok && Array.isArray(r.carte)) riceviCornice(r.carte, { senzaVolo: true });
  }
  // Riaperta o tornata in vista, la home non rifà i voli di prima.
  function riceviCornice(carte, { senzaVolo = false } = {}) {
    dati.cornice = (Array.isArray(carte) ? carte : []).filter((a) => a && a.id);
    if (senzaVolo) for (const a of dati.cornice) volate.add(a.id);
    const vivi = new Set(dati.cornice.map((a) => a.id));
    for (const id of assorbiti) if (!vivi.has(id)) assorbiti.delete(id);
    disegna();
    volaQui();
  }

  // L'ordine (urgenza di Filo, poi quello dell'utente) lo decide il modulo condiviso: la chat lo legge uguale.
  const PER_TIPO = {
    crediti: () => cartaCrediti(), timer: cartaTimer, sveglia: cartaTimer, download: cartaDownload,
    avviso: cartaAvviso, lavoro: cartaLavoro, cornice: cartaCornice,
  };
  function datiSinistra() {
    return {
      timers: dati.timers, notifiche: dati.notifiche, downloads: dati.downloads, lavori: dati.lavori,
      crediti: !!suggerimentoCrediti(), chat: d.chatCorrente(), cornice: dati.cornice,
    };
  }
  function carteSinistra() {
    programmaLavori();
    const voci = C.sinistra(datiSinistra(), layout);
    assorbi(new Set(voci.map((v) => v.chiave)));
    const volati = voci.filter((v) => v.tipo === 'cornice').map((v) => v.ref);
    return voci.map((v) => Object.assign(PER_TIPO[v.tipo](v.ref, volati), { fissa: !!v.fissa }));
  }

  // ===== Le carte di destra =====
  // Il clic chiede alla carta di adesso cosa fare: due documenti con lo stesso titolo che si scambiano di
  // posto non rifanno la carta, e il pulsante deve aprire quello che mostra.
  function voceLista({ testo, coda, titolo, iconaEl }, art, i) {
    const li = el('li');
    const b = el('button', 'dash-carta-voce');
    b.type = 'button';
    if (iconaEl) b.appendChild(iconaEl);
    b.appendChild(el('span', 'dash-carta-voce-testo', testo));
    if (coda) b.appendChild(el('span', 'dash-carta-voce-coda', coda));
    b.title = titolo || testo;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const v = art._carta && art._carta.voci && art._carta.voci[i];
      if (v) { contaUso(art, 'clic'); v.fai(b); }
    });
    // Il tasto destro su un documento parla di quel documento; su «altri…» o «Mostra tutti» vale la carta.
    const menuVoce = (e, x, y) => {
      e.preventDefault();
      e.stopPropagation();
      contaUso(art, 'tasto_destro');
      const v = art._carta && art._carta.voci && art._carta.voci[i];
      if (!v || v.piano) { apriMenu(x, y, vociMenu(art)); return; }
      const voci = [{ etichetta: `Apri «${v.testo}»`, fai: () => v.fai(b) }];
      if (v.filo) voci.push({ etichetta: 'Apri nel filo', fai: () => apriCartaNelFilo({ filo: v.filo }) });
      apriMenu(x, y, voci);
    };
    b.addEventListener('contextmenu', (e) => menuVoce(e, e.clientX, e.clientY));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
      const r = b.getBoundingClientRect();
      menuVoce(e, r.left + 12, r.bottom);
    });
    li.appendChild(b);
    return li;
  }

  function cartaEditor() {
    const e = dati.editor;
    const file = (e && e.file) || [];
    const voci = file.slice(0, VOCI_IN_CARTA).map((f) => {
      const coda = quando(f.modificato);
      return {
        testo: f.titolo, coda,
        fai: () => apri(`${URL_EDITOR}?file=${encodeURIComponent(f.id)}`),
        filo: `Il documento «${f.titolo}» è nell’Editor${coda ? ` (ultima modifica: ${coda})` : ''}.`,
      };
    });
    if (file.length > VOCI_IN_CARTA) voci.push({ testo: `altri ${file.length - VOCI_IN_CARTA} nell’Editor`, fai: () => apri(URL_EDITOR), piano: true });
    const titoli = file.slice(0, 3).map((f) => `«${f.titolo}»`).join(', ');
    return {
      stato: e ? (file.length ? plurale(file.length, 'documento', 'documenti') : 'nessun documento') : '…',
      voci,
      principale: { etichetta: file.length ? 'Apri l’Editor' : 'Scrivi', fai: () => apri(URL_EDITOR) },
      apri: () => apri(URL_EDITOR),
      filo: file.length
        ? `Nell’Editor hai ${plurale(file.length, 'documento', 'documenti')}${titoli ? `; gli ultimi: ${titoli}` : ''}.`
        : 'L’Editor è vuoto: quando vuoi, scriviamo qualcosa insieme.',
    };
  }

  // «Nuovo mazzo» porta a un mazzo nuovo, non alla libreria; un doppio clic non ne crea due.
  let creaMazzo = null;
  function nuovoMazzo() {
    if (creaMazzo) return creaMazzo;
    creaMazzo = d.send({ type: MSG.DECKS_CREATE }).then((r) => {
      apri(r && r.ok && r.deck ? `${URL_MAZZI}#/deck/${encodeURIComponent(r.deck.id)}` : URL_MAZZI);
      return caricaMazzi();
    }).catch(() => {}).finally(() => { creaMazzo = null; });
    return creaMazzo;
  }

  function cartaMazzi() {
    const m = dati.mazzi;
    const mazzi = (m || []).slice().sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    const voci = mazzi.slice(0, VOCI_IN_CARTA).map((x) => {
      const coda = quando(x.updated_at);
      return {
        testo: x.nome || 'Mazzo', coda,
        fai: () => apri(`${URL_MAZZI}#/deck/${encodeURIComponent(x.id)}`),
        filo: `Il mazzo «${x.nome || 'Mazzo'}» è nei Mazzi${coda ? ` (ultima modifica: ${coda})` : ''}.`,
      };
    });
    if (mazzi.length > VOCI_IN_CARTA) voci.push({ testo: `altri ${mazzi.length - VOCI_IN_CARTA} nei Mazzi`, fai: () => apri(URL_MAZZI), piano: true });
    const nomi = mazzi.slice(0, 3).map((x) => `«${x.nome || 'Mazzo'}»`).join(', ');
    return {
      stato: m ? (mazzi.length ? plurale(mazzi.length, 'mazzo', 'mazzi') : 'nessun mazzo') : '…',
      voci,
      principale: mazzi.length ? { etichetta: 'Apri i Mazzi', fai: () => apri(URL_MAZZI) } : { etichetta: 'Nuovo mazzo', fai: nuovoMazzo },
      apri: () => apri(URL_MAZZI),
      filo: mazzi.length ? `Hai ${plurale(mazzi.length, 'mazzo', 'mazzi')}${nomi ? `: ${nomi}` : ''}.` : 'Non hai ancora nessun mazzo.',
    };
  }

  // L'icona del sito se si carica, altrimenti quella del tipo di suggerimento.
  const ICONA_SUGGERIMENTO = { gmail: 'mailOpen', calendar: 'calendar', editor: 'editor', file: 'folder', note: 'note', link: 'globe', web: 'globe' };
  function faviconDi(s) {
    const tipo = String((s.action && s.action.type) || '').toUpperCase();
    const ico = el('span', 'dash-carta-voce-ico');
    ico.setAttribute('aria-hidden', 'true');
    const generica = () => {
      const ICONS = global.SN_ICONS || {};
      // Un nome che l'insieme delle icone conosce vale com'è: col solo elenco, «Apri Opzioni» prendeva il globo dei siti.
      const propria = typeof ICONS[s.icon] === 'function' ? s.icon : '';
      const nome = ICONA_SUGGERIMENTO[s.icon] || propria || (tipo === 'NAVIGA' ? 'globe' : 'sparkles');
      ico.innerHTML = typeof ICONS[nome] === 'function' ? ICONS[nome](14) : '';
    };
    if (tipo !== 'NAVIGA') { generica(); return ico; }
    const img = el('img');
    img.alt = '';
    img.onerror = () => { img.remove(); generica(); };
    ico.appendChild(img);
    // Un suggerimento scritto da un modello che ha letto testo di altri prende l'icona solo dalle copie, mai dal sito,
    // che saprebbe dell'indirizzo prima di ogni clic (#1505). Una pagina salvata dall'utente (home senza modello) no.
    d.iconaDelSito(s.action.url, { soloCopie: s.daSalvate !== true }).then((dato) => { if (dato) img.src = dato; else img.onerror(); });
    return ico;
  }

  function cartaSuggerimenti() {
    const tutti = dati.suggerimenti.filter((s) => s && s.text && s.carta !== 'crediti')
      .sort((a, b) => (b.importance || 0) - (a.importance || 0));
    const visibili = dati.tuttiSuggerimenti ? tutti : tutti.slice(0, SUGGERIMENTI_VISIBILI);
    const voci = visibili.map((s, i) => ({ testo: s.text, iconaEl: faviconDi(s), fai: (b) => d.onSuggestionClick(s, b, i + 1), filo: `Ti suggerisco: ${s.text}` }));
    if (tutti.length > SUGGERIMENTI_VISIBILI) {
      voci.push({
        testo: dati.tuttiSuggerimenti ? 'Mostra meno' : `Mostra tutti (${tutti.length})`, piano: true,
        fai: () => { dati.tuttiSuggerimenti = !dati.tuttiSuggerimenti; disegna(); },
      });
    }
    const senzaChiave = !!suggerimentoCrediti();
    return {
      stato: !dati.suggerimentiPronti ? '…' : (tutti.length ? null : 'niente da suggerire, per ora'),
      voci,
      principale: senzaChiave ? null : { etichetta: 'Aggiorna', fai: () => d.aggiornaSuggerimenti() },
      filo: tutti.length
        ? `Ti suggerisco:\n${visibili.map((s) => `- ${s.text}`).join('\n')}`
        : 'Per ora non ho suggerimenti: chiedimi pure quello che ti serve.',
    };
  }

  function temaScuro(s) {
    const t = (s && s.theme) || 'system';
    if (t === 'system') return global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches;
    return t === 'dark';
  }
  // Una pastiglia scrive solo il campo che cambia: il resto delle impostazioni non passa di qui.
  function pastiglie() {
    const s = dati.impostazioni || {};
    const scuro = temaScuro(s);
    // `voce`: il controllo che la cambia in Preferenze, dove porta il suo tasto destro (#2096).
    return [
      { etichetta: 'Tema scuro', voce: 'theme', acceso: scuro, scrivi: () => ({ theme: scuro ? 'light' : 'dark' }) },
      { etichetta: 'Terminale', voce: 'terminalEnabled', acceso: !!(s.terminal && s.terminal.enabled), scrivi: () => ({ terminal: { enabled: !(s.terminal && s.terminal.enabled) } }) },
      { etichetta: 'Anteprima schede', voce: 'tabPreviewEnabled', acceso: !(s.tabPreview && s.tabPreview.enabled === false), scrivi: () => ({ tabPreview: { enabled: !!(s.tabPreview && s.tabPreview.enabled === false) } }) },
    ];
  }
  function cartaRapide() {
    const p = pastiglie();
    return {
      stato: null,
      pastiglie: p,
      principale: { etichetta: 'Preferenze', fai: () => apri(URL_PREFERENZE) },
      apri: () => apri(URL_PREFERENZE),
      filo: `Impostazioni rapide: ${p.map((x) => `${x.etichetta.toLowerCase()} ${x.acceso ? 'acceso' : 'spento'}`).join(', ')}.`,
    };
  }

  const COSTRUTTORI = { editor: cartaEditor, mazzi: cartaMazzi, suggerimenti: cartaSuggerimenti, rapide: cartaRapide };

  // La carta di una funzione in pausa non c'è, né a destra né fra le tolte: la disposizione salvata resta com'è.
  const inPausa = (id) => id === 'mazzi' && !dati.aperte.mazzi;
  // Con la Bacheca in pausa l'app porta alle sole segnalazioni dell'utente, che restano sue. Il nome corto sta nella cella.
  const appVisibili = () => C.APP.map((a) => (a.id === 'bacheca' && !dati.aperte.bacheca ? C.SEGNALAZIONI : a));

  function carteDestra() {
    return ((layout && layout.destra) || []).filter((id) => !inPausa(id)).map((id) => {
      const def = C.carta(id);
      const corpo = COSTRUTTORI[id]();
      return {
        chiave: id, tipo: id, icona: def.icona, titolo: def.titolo, ...corpo,
        togli: () => muovi({ tipo: 'togli', carta: id }), etichettaTogli: 'Togli dalla home',
        sposta: true,
      };
    });
  }

  // ===== Il contratto unico: titolo, stato, un'azione principale, «apri nel filo» =====
  // Una carta si rifà solo se cambia la sua forma; se cambia solo il testo dello stato si scrive quello, così
  // un clic che cade mentre il conto alla rovescia avanza resta sul suo pulsante.
  function forma(c) {
    return JSON.stringify([c.tipo, c.titolo, c.suona, c.fissa, c.grande, c.lungo, c.avanza != null,
      c.principale && c.principale.etichetta, c.principale && c.principale.forte, c.secondaria && c.secondaria.etichetta,
      (c.voci || []).map((v) => [v.testo, v.coda]), (c.pastiglie || []).map((p) => [p.etichetta, p.acceso]), c.stato == null]);
  }

  function costruisci(c, colonna) {
    const art = el('article', 'dash-carta');
    art.dataset.chiave = c.chiave;
    art.dataset.tipo = c.tipo;
    art.dataset.colonna = colonna;
    if (c.suona) art.dataset.suona = '1';
    if (c.fissa) art.dataset.fissa = '1';
    art.tabIndex = 0;
    art.draggable = true;
    art.setAttribute('aria-label', c.titolo);

    const testa = el('div', 'dash-carta-testa');
    testa.appendChild(icona(c.icona));
    const tit = el('span', 'dash-carta-tit', c.titolo);
    tit.title = c.titolo;
    testa.appendChild(tit);
    art.appendChild(testa);
    const mani = el('div', 'dash-carta-mani');
    const filo = el('button', 'dash-carta-filo', 'apri nel filo');
    filo.type = 'button';
    filo.title = 'Apri nel filo';
    filo.addEventListener('click', (e) => { e.stopPropagation(); contaUso(art, 'clic'); apriNelFilo(art); });
    mani.appendChild(filo);
    if (c.togli) {
      const x = el('button', 'dash-carta-togli', '\u00D7');
      x.type = 'button';
      x.title = c.etichettaTogli || 'Togli';
      x.setAttribute('aria-label', x.title);
      x.addEventListener('click', (e) => { e.stopPropagation(); art._carta.togli(); });
      mani.appendChild(x);
    }
    art.appendChild(mani);

    if (c.stato != null) {
      const st = el('div', `dash-carta-stato${c.grande ? ' grande' : ''}${c.lungo ? ' lungo' : ''}`, c.stato);
      // Uno stato lungo si accorcia a qualche riga: intero sta al passaggio del puntatore, e nel filo.
      if (!c.grande) st.title = c.stato;
      art.appendChild(st);
    }
    if (c.avanza != null) {
      const bar = el('div', 'dash-carta-avanza');
      const i = el('i');
      bar.appendChild(i);
      art.appendChild(bar);
    }
    if (c.voci && c.voci.length) {
      const ul = el('ul', 'dash-carta-voci');
      c.voci.forEach((v, i) => {
        const li = voceLista(v, art, i);
        if (v.piano) li.firstChild.classList.add('piano');
        ul.appendChild(li);
      });
      art.appendChild(ul);
    }
    if (c.pastiglie) {
      const riga = el('div', 'dash-carta-pastiglie');
      c.pastiglie.forEach((p, i) => {
        const b = el('button', `dash-pastiglia${p.acceso ? ' acceso' : ''}`, p.etichetta);
        b.type = 'button';
        b.setAttribute('aria-pressed', p.acceso ? 'true' : 'false');
        b.title = p.acceso ? `${p.etichetta}: acceso` : `${p.etichetta}: spento`;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          const cur = art._carta.pastiglie && art._carta.pastiglie[i];
          if (cur) scriviImpostazione(cur.scrivi());
        });
        riga.appendChild(b);
      });
      art.appendChild(riga);
    }
    if (c.principale || c.secondaria) {
      const piede = el('div', 'dash-carta-piede');
      for (const [a, cls] of [[c.principale, 'principale'], [c.secondaria, 'secondaria']]) {
        if (!a) continue;
        const b = el('button', `dash-carta-az ${cls}${a.forte ? ' forte' : ''}`, a.etichetta);
        b.type = 'button';
        b.addEventListener('click', (e) => { e.stopPropagation(); const cur = art._carta[cls]; if (cur) { contaUso(art, 'clic'); cur.fai(b); } });
        piede.appendChild(b);
      }
      art.appendChild(piede);
    }

    art.addEventListener('click', () => { contaUso(art, 'clic'); usaCarta(art); });
    art.addEventListener('keydown', (e) => {
      if (e.target !== art) return;
      if (e.key === 'Enter') { e.preventDefault(); contaUso(art, 'invio'); usaCarta(art); }
      else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        contaUso(art, 'tasto_destro');
        const r = art.getBoundingClientRect();
        apriMenu(r.left + 12, r.top + 28, vociMenu(art));
      } else if (e.key === 'Delete' && art._carta.togli) { e.preventDefault(); art._carta.togli(); }
    });
    art.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      contaUso(art, 'tasto_destro');
      // Su una pastiglia il menu è suo (#2096): accenderla o spegnerla, e la sua voce in Preferenze.
      const pas = e.target && e.target.closest ? e.target.closest('.dash-pastiglia') : null;
      const i = pas ? [...pas.parentElement.children].indexOf(pas) : -1;
      const p = i >= 0 && art._carta.pastiglie ? art._carta.pastiglie[i] : null;
      apriMenu(e.clientX, e.clientY, p ? vociPastiglia(p) : vociMenu(art));
    });
    agganciaTrascinamento(art);
    return art;
  }

  function aggiornaTesti(art, c) {
    const st = art.querySelector('.dash-carta-stato');
    if (st && st.textContent !== c.stato) {
      st.textContent = c.stato;
      if (!c.grande) st.title = c.stato;
    }
    const i = art.querySelector('.dash-carta-avanza > i');
    if (i) {
      const ind = c.avanza < 0;
      i.parentNode.classList.toggle('indeterminato', ind);
      i.style.width = ind ? '' : `${c.avanza}%`;
    }
  }

  function disegnaColonna(host, carte, colonna) {
    const presenti = new Map([...host.querySelectorAll(':scope > .dash-carta')].map((n) => [n.dataset.chiave, n]));
    const ordine = [];
    for (const c of carte) {
      let art = presenti.get(c.chiave);
      const f = forma(c);
      if (!art || art._forma !== f) {
        const nuovo = costruisci(c, colonna);
        if (art) art.replaceWith(nuovo);
        art = nuovo;
        art._forma = f;
      }
      art._carta = c;
      aggiornaTesti(art, c);
      presenti.delete(c.chiave);
      ordine.push(art);
    }
    for (const vecchia of presenti.values()) vecchia.remove();
    ordine.forEach((art, i) => { if (host.children[i] !== art) host.insertBefore(art, host.children[i] || null); });
  }

  // ===== «altro»: i tasti, e il «+» coi tasti e le carte fuori vista (#2372) =====
  // Si rifà solo quando cambia quello che mostra: il conto alla rovescia ridisegna la home ogni secondo.
  // Nel «+» stanno i tasti messi via, le carte tolte e quelle di sinistra nascoste: ognuno si rimette da solo.
  const ICONA_SINISTRA = { crediti: 'credits', download: 'download', lavoro: 'sparkles', timer: 'timer', sveglia: 'alarm', avviso: 'bell' };
  let formaAltro = '';
  let fuoriAperto = false;
  const Tocco = () => global.SN_DOPPIO_TOCCO;
  const letteraDi = (id) => (Tocco() ? Tocco().diTasto(dati.impostazioni && dati.impostazioni.doppioTocco, id) : null);
  // Il tasto come si vede: la Bacheca in pausa porta alle Segnalazioni.
  function tastoVisto(id) {
    if (id === 'bacheca' && !dati.aperte.bacheca) return { ...C.tasto(id), ...C.SEGNALAZIONI, nomi: [] };
    return C.tasto(id);
  }
  // Clic e Invio su un tasto, ovunque stia (colonna, «+», doppio tocco).
  function usaTasto(id, ancora) {
    const t = tastoVisto(id);
    if (!t) return;
    if (id === 'cerca') { if (d.apriRicerca) d.apriRicerca(); return; }
    if (t.url) { apri(t.url); return; }
    if (t.comando) {
      // Il menu della shell si apre sotto il tasto, ovunque l'utente l'abbia messo (#1491).
      // Dal «+» chiuso o dal doppio tocco il tasto non si vede: il menu si apre sotto il «+».
      const visto = (n) => { const r = n && n.isConnected ? n.getBoundingClientRect() : null; return r && r.width ? r : null; };
      const r = visto(ancora) || visto(altroEl && altroEl.querySelector('#altroPiu'));
      d.send({ type: MSG.SHELL_ACTION, command: t.comando, ...(r ? { anchor: { x: r.left, y: r.bottom } } : {}) });
    }
  }
  const etichettaUso = (t) => (t.id === 'cerca' ? 'Cerca nel filo' : t.comando ? t.titolo : `Apri ${t.titolo}`);

  function voceAltro(v, dove) {
    const cella = el('div', 'dash-altro-cella');
    const b = el('button', 'dash-altro-app');
    b.type = 'button';
    b.dataset.id = v.id;
    if (v.tolta) b.dataset.tolta = '1';
    if (v.tasto) b.dataset.tasto = '1';
    const ic = icona(v.icona, 20);
    b.appendChild(ic);
    b.appendChild(el('span', 'dash-altro-nome', v.titolo));
    const l = v.tasto || v.url ? letteraDi(v.id) : null;
    const uso = v.tasto ? etichettaUso(v) : v.url ? `Apri ${v.titolo}` : 'Rimetti nella home';
    b.title = l ? `${uso} · ${l.lettera}${l.lettera}` : uso;
    b.setAttribute('aria-label', v.titolo);
    const rimetti = () => muovi(v.sinistra ? { tipo: 'mostra', chiave: v.id } : { tipo: 'aggiungi', carta: v.id });
    b.addEventListener('click', () => {
      contaGesto('carta_home', { carta: v.id, colonna: 'altro', come: 'clic' });
      if (v.tasto) usaTasto(v.id, b);
      else if (v.url) apri(v.url);
      else rimetti();
    });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      contaGesto('carta_home', { carta: v.id, colonna: 'altro', come: 'tasto_destro' });
      apriMenu(e.clientX, e.clientY, vociAltro(v, dove, b, rimetti));
    });
    b.addEventListener('keydown', (e) => {
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        const r = b.getBoundingClientRect();
        apriMenu(r.left + 12, r.bottom, vociAltro(v, dove, b, rimetti));
      } else if (e.key === 'Delete' && dove === 'vista') { e.preventDefault(); muovi({ tipo: 'togli', carta: v.id }); }
    });
    cella.appendChild(b);
    b.draggable = true;
    b.addEventListener('dragstart', (e) => {
      chiudiMenu();
      presa = { chiave: v.id, colonna: dove === 'vista' ? 'tasti' : 'altro', sinistra: !!v.sinistra, tasto: !!v.tasto, el: b };
      trascinando = true;
      b.classList.add('presa');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-filo-carta', v.id);
      e.dataTransfer.setData('text/plain', v.titolo);
      global.SN_GESTI?.marca(e.dataTransfer, 'carta_home');
    });
    b.addEventListener('dragend', (e) => { contaFine(e); fineTrascinamento(); });
    if (dove === 'fuori') {
      const piu = el('button', 'dash-altro-rimetti', '+');
      piu.type = 'button';
      piu.title = v.tasto ? 'Rimetti in vista' : 'Rimetti nella home';
      piu.setAttribute('aria-label', `Rimetti ${v.titolo} ${v.tasto ? 'in vista' : 'nella home'}`);
      piu.addEventListener('click', (e) => { e.stopPropagation(); rimetti(); });
      cella.appendChild(piu);
    }
    if (v.id === 'profilo' && d.decoraProfilo) d.decoraProfilo(b, ic);
    return cella;
  }

  function vociAltro(v, dove, b, rimetti) {
    const menu = [];
    if (v.tasto) menu.push({ etichetta: etichettaUso(v), fai: () => usaTasto(v.id, b) });
    else if (v.url) menu.push({ etichetta: `Apri ${v.titolo}`, fai: () => apri(v.url) });
    if (dove === 'vista') {
      const fratelli = [...altroEl.querySelectorAll('.dash-altro-griglia.vista .dash-altro-app[data-tasto="1"]')];
      const at = fratelli.indexOf(b);
      if (at > 0) menu.push({ etichetta: 'Sposta prima', fai: () => muovi({ tipo: 'sposta', carta: v.id, prima: fratelli[at - 1].dataset.id }) });
      if (at >= 0 && at < fratelli.length - 1) menu.push({ etichetta: 'Sposta dopo', fai: () => muovi({ tipo: 'sposta', carta: v.id, prima: fratelli[at + 2] ? fratelli[at + 2].dataset.id : null }) });
      menu.push({ etichetta: 'Metti nel «+»', fai: () => muovi({ tipo: 'togli', carta: v.id }) });
    } else {
      menu.push({ etichetta: v.tasto ? 'Rimetti in vista' : 'Rimetti nella home', fai: rimetti });
    }
    const lettera = vociLettera(v.id, v.titolo);
    if (lettera.length) menu.push(null, ...lettera);
    return menu;
  }

  // ===== Le lettere del doppio tocco, dal tasto destro di un tasto o di una carta =====
  function vociLettera(id, titolo) {
    if (!Tocco() || !C.prendeLettera(id)) return [];
    const l = letteraDi(id);
    if (!l) return [{ etichetta: 'Assegna una lettera', fai: () => aspettaLettera(id, titolo) }];
    return [
      { etichetta: `Cambia lettera (${l.lettera}${l.lettera})`, fai: () => aspettaLettera(id, titolo) },
      { etichetta: 'Togli la lettera', fai: () => scriviImpostazione({ doppioTocco: { lettere: Tocco().togli(dati.impostazioni && dati.impostazioni.doppioTocco, l.lettera).lettere } }) },
    ];
  }
  // La lettera si sceglie premendola: la prossima battuta, Esc o un clic altrove lasciano tutto com'era.
  let attesaLettera = null;
  function fineAttesaLettera() {
    if (!attesaLettera) return;
    global.removeEventListener('keydown', attesaLettera.tasto, true);
    global.removeEventListener('mousedown', attesaLettera.fine, true);
    global.removeEventListener('blur', attesaLettera.fine);
    attesaLettera = null;
  }
  function aspettaLettera(id, titolo) {
    fineAttesaLettera();
    avviso(`Premi la lettera per «${titolo}»`);
    const tasto = (e) => {
      if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].includes(e.key)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      fineAttesaLettera();
      if (e.key === 'Escape') { avviso('Lettera non cambiata'); return; }
      const l = !e.ctrlKey && !e.metaKey && !e.altKey ? Tocco().lettera(e.key) : '';
      if (!l) { avviso('Serve una lettera: niente è cambiato'); return; }
      const r = Tocco().assegna(dati.impostazioni && dati.impostazioni.doppioTocco, l, { tasto: id });
      if (r.rifiuto) { avviso(r.rifiuto); return; }
      scriviImpostazione({ doppioTocco: { lettere: r.lettere } });
      avviso(Tocco().conPrima(`«${l}${l}» nella home: ${titolo}`, r));
    };
    attesaLettera = { tasto, fine: () => fineAttesaLettera() };
    global.addEventListener('keydown', tasto, true);
    // Il clic che ha scelto la voce del menu è già passato: il prossimo chiude l'attesa.
    setTimeout(() => {
      if (!attesaLettera || attesaLettera.tasto !== tasto) return;
      global.addEventListener('mousedown', attesaLettera.fine, true);
      global.addEventListener('blur', attesaLettera.fine);
    }, 0);
  }

  function disegnaAltro() {
    const l = layout || C.predefinita();
    const vista = l.tasti.map((id) => ({ ...tastoVisto(id), tasto: true }));
    const tasti = l.riposti.map((id) => ({ ...tastoVisto(id), tasto: true, tolta: true }));
    const tolte = (l.tolte || []).filter((id) => !inPausa(id)).map((id) => ({ ...C.carta(id), tolta: true }));
    const sinistre = C.nascosteSinistra(datiSinistra(), layout).map((v) => ({
      id: v.chiave, titolo: v.tipo === 'crediti' ? 'Crediti' : v.titolo, icona: ICONA_SINISTRA[v.tipo] || 'bell',
      url: v.tipo === 'crediti' ? URL_CREDITI : null, tolta: true, sinistra: true,
    }));
    const fuori = [...sinistre, ...tolte, ...tasti];
    const lettere = JSON.stringify((dati.impostazioni && dati.impostazioni.doppioTocco && dati.impostazioni.doppioTocco.lettere) || []);
    const f = [fuoriAperto, lettere, ...vista.map((v) => `${v.id}:${v.titolo}`), '|', ...fuori.map((v) => `${v.id}:${v.titolo}`)].join(',');
    if (f === formaAltro && altroEl.childElementCount) return;
    formaAltro = f;
    const fuoco = document.activeElement && altroEl.contains(document.activeElement)
      ? { id: document.activeElement.dataset.id, piu: document.activeElement.id === 'altroPiu' } : null;
    altroEl.replaceChildren();
    altroEl.appendChild(el('div', 'dash-altro-tit', 'altro'));
    const griglia = el('div', 'dash-altro-griglia vista');
    for (const v of vista) griglia.appendChild(voceAltro(v, 'vista'));
    // Il «+» è fisso: non si trascina, non si toglie, e sta sempre in fondo.
    const cellaPiu = el('div', 'dash-altro-cella');
    const piu = el('button', 'dash-altro-app dash-altro-piu');
    piu.type = 'button';
    piu.id = 'altroPiu';
    piu.draggable = false;
    piu.setAttribute('aria-expanded', fuoriAperto ? 'true' : 'false');
    piu.setAttribute('aria-controls', 'altroFuori');
    piu.setAttribute('aria-label', 'Fuori vista');
    piu.title = fuori.length ? `Fuori vista: ${fuori.map((v) => v.titolo).join(', ')}` : 'Fuori vista';
    piu.appendChild(icona('plus', 20));
    piu.appendChild(el('span', 'dash-altro-nome', fuori.length ? String(fuori.length) : ' '));
    piu.addEventListener('click', () => { fuoriAperto = !fuoriAperto; disegnaAltro(); });
    piu.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      apriMenu(e.clientX, e.clientY, [
        { etichetta: fuoriAperto ? 'Chiudi i tasti fuori vista' : 'Mostra i tasti fuori vista', fai: () => { fuoriAperto = !fuoriAperto; disegnaAltro(); } },
        { etichetta: 'Rimetti le carte com’erano', fai: () => muovi({ tipo: 'ripristina' }) },
      ]);
    });
    cellaPiu.appendChild(piu);
    griglia.appendChild(cellaPiu);
    altroEl.appendChild(griglia);
    const pannello = el('div', 'dash-altro-fuori');
    pannello.id = 'altroFuori';
    pannello.hidden = !fuoriAperto;
    if (fuori.length) {
      const g = el('div', 'dash-altro-griglia');
      for (const v of fuori) g.appendChild(voceAltro(v, 'fuori'));
      pannello.appendChild(g);
    } else pannello.appendChild(el('div', 'dash-altro-vuoto', 'niente fuori vista'));
    altroEl.appendChild(pannello);
    if (fuoco) {
      const n = fuoco.piu ? piu : altroEl.querySelector(`.dash-altro-app[data-id="${CSS.escape(fuoco.id || '')}"]`);
      if (n) n.focus({ preventScroll: true });
    }
  }

  let trascinando = false;
  let daRidisegnare = false;
  function disegna() {
    if (!layout || !accadeEl) return;
    if (trascinando) { daRidisegnare = true; return; }
    disegnaColonna(accadeEl, carteSinistra(), 'sinistra');
    disegnaColonna(tieniEl, carteDestra(), 'destra');
    disegnaAltro();
    const ridotta = C.homeRidotta(primoIncontro, layout, !!suggerimentoCrediti());
    tieniEl.hidden = ridotta;
    altroEl.hidden = ridotta;
    accadeEl.dataset.suona = dati.timers.some((t) => t.ringing) ? '1' : '0';
  }

  // ===== Menu del tasto destro =====
  function vociMenu(art) {
    const c = art._carta;
    // Un avviso volato ha il menu che aveva nell'angolo; in più solo quello che ogni carta della home sa fare.
    if (c.menu) return [...c.menu, null, { etichetta: 'Apri nel filo', fai: () => apriNelFilo(art) }];
    const voci = [];
    if (c.principale) voci.push({ etichetta: c.principale.etichetta, fai: () => c.principale.fai() });
    if (c.secondaria) voci.push({ etichetta: c.secondaria.etichetta, fai: () => c.secondaria.fai() });
    for (const v of c.altreVoci || []) voci.push(v);
    if (voci.length) voci.push(null);
    voci.push({ etichetta: 'Apri nel filo', fai: () => apriNelFilo(art) });
    const fratelli = mobili(art.parentNode);
    const at = fratelli.indexOf(art);
    if (at > 0) voci.push({ etichetta: 'Sposta su', fai: () => spostaCarta(art, -1) });
    if (at >= 0 && at < fratelli.length - 1) voci.push({ etichetta: 'Sposta giù', fai: () => spostaCarta(art, 1) });
    // La lettera del doppio tocco di una carta che apre un'app (#2372); «Togli» resta l'ultima voce.
    if (art.dataset.colonna === 'destra') voci.push(...vociLettera(art.dataset.chiave, c.titolo));
    if (c.togli) voci.push({ etichetta: c.etichettaTogli || 'Togli', fai: () => c.togli() });
    return voci;
  }
  // Il menu di una pastiglia delle Impostazioni rapide: le stesse cose del suo clic, più la sua voce in Preferenze.
  function vociPastiglia(p) {
    const voci = [{ etichetta: `${p.acceso ? 'Spegni' : 'Accendi'}: ${p.etichetta.toLowerCase()}`, fai: () => scriviImpostazione(p.scrivi()) }];
    if (p.voce) voci.push({ etichetta: 'Apri la voce in Preferenze', fai: () => apri(`${URL_PREFERENZE}#${p.voce}`) });
    return voci;
  }

  let menuAperto = null;
  function chiudiMenu() {
    if (!menuAperto) return;
    const { nodo, primaDelMenu } = menuAperto;
    menuAperto = null;
    nodo.remove();
    document.removeEventListener('mousedown', fuoriDalMenu, true);
    document.removeEventListener('keydown', tastiMenu, true);
    global.removeEventListener('blur', chiudiMenu);
    global.removeEventListener('resize', chiudiMenu);
    if (primaDelMenu && primaDelMenu.isConnected) try { primaDelMenu.focus({ preventScroll: true }); } catch (_) {}
  }
  function fuoriDalMenu(e) { if (menuAperto && !menuAperto.nodo.contains(e.target)) chiudiMenu(); }
  function tastiMenu(e) {
    if (!menuAperto) return;
    const voci = [...menuAperto.nodo.querySelectorAll('.dash-menu-voce')];
    const at = voci.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); chiudiMenu(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); (voci[at + 1] || voci[0]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (voci[at - 1] || voci[voci.length - 1]).focus(); }
  }
  function apriMenu(x, y, voci) {
    chiudiMenu();
    if (!voci.length) return;
    const nodo = el('div', 'dash-menu');
    nodo.setAttribute('role', 'menu');
    for (const v of voci) {
      if (!v) { nodo.appendChild(el('div', 'dash-menu-sep')); continue; }
      const b = el('button', 'dash-menu-voce', v.etichetta);
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.addEventListener('click', () => { chiudiMenu(); v.fai(); });
      nodo.appendChild(b);
    }
    document.body.appendChild(nodo);
    for (const b of nodo.querySelectorAll('.dash-menu-voce')) if (b.scrollWidth > b.clientWidth) b.title = b.textContent;
    const w = nodo.offsetWidth;
    const h = nodo.offsetHeight;
    nodo.style.left = `${Math.max(4, Math.min(x, global.innerWidth - w - 4))}px`;
    nodo.style.top = `${Math.max(4, Math.min(y, global.innerHeight - h - 4))}px`;
    menuAperto = { nodo, primaDelMenu: document.activeElement };
    const prima = nodo.querySelector('.dash-menu-voce');
    if (prima) prima.focus({ preventScroll: true });
    // I tasti subito: nessun tasto ha aperto il menu, e in una scheda non in vista il timer può tardare un secondo.
    document.addEventListener('keydown', tastiMenu, true);
    setTimeout(() => {
      if (!menuAperto || menuAperto.nodo !== nodo) return;
      document.addEventListener('mousedown', fuoriDalMenu, true);
      global.addEventListener('blur', chiudiMenu);
      global.addEventListener('resize', chiudiMenu);
    }, 0);
  }

  // ===== Spostare, togliere, rimettere =====
  function muovi(mossa) {
    const prova = C.applica(layout, mossa);
    if (prova.errore) return Promise.resolve(false);
    layout = prova.layout;
    disegna();
    return d.send({ type: MSG.CARTE_HOME_MODIFICA, mossa }).then((r) => {
      if (r && r.layout) { layout = C.normalizza(r.layout); disegna(); }
      return !!(r && r.ok);
    });
  }

  // Le carte che si spostano e si scavalcano: non quelle che stanno in cima per regola (i Crediti, ciò che suona).
  function mobili(host) {
    return [...host.querySelectorAll(':scope > .dash-carta')].filter((n) => n.dataset.fissa !== '1');
  }
  // `prima`: la chiave davanti a cui va (null = in fondo).
  function ordinaColonna(colonna, chiave, prima) {
    if (colonna === 'destra') return muovi({ tipo: 'sposta', carta: chiave, prima });
    const chiavi = mobili(accadeEl).map((n) => n.dataset.chiave).filter((k) => k !== chiave);
    const at = prima == null ? -1 : chiavi.indexOf(prima);
    if (at < 0) chiavi.push(chiave); else chiavi.splice(at, 0, chiave);
    // `chiave`: la carta spostata, per i contatori (#1471); la mossa la ignora.
    return muovi({ tipo: 'ordina-sinistra', ordine: chiavi, chiave });
  }
  function spostaCarta(art, passo) {
    const fratelli = mobili(art.parentNode);
    const at = fratelli.indexOf(art);
    const prima = passo < 0 ? fratelli[at - 1] : fratelli[at + 2];
    ordinaColonna(art.dataset.colonna, art.dataset.chiave, prima ? prima.dataset.chiave : null)
      .then(() => { const n = art.parentNode && art.parentNode.querySelector(`:scope > [data-chiave="${CSS.escape(art.dataset.chiave)}"]`); if (n) n.focus({ preventScroll: true }); });
  }

  let presa = null;
  function fineTrascinamento() {
    if (presa && presa.el) presa.el.classList.remove('presa');
    presa = null;
    for (const n of document.querySelectorAll('.sopra-prima, .sopra-dopo')) n.classList.remove('sopra-prima', 'sopra-dopo');
    if (altroEl) altroEl.classList.remove('bersaglio');
    for (const n of document.querySelectorAll('.dash-altro-piu.bersaglio')) n.classList.remove('bersaglio');
    trascinando = false;
    if (daRidisegnare) { daRidisegnare = false; disegna(); }
  }
  function agganciaTrascinamento(art) {
    art.addEventListener('dragstart', (e) => {
      if (e.target !== art) return;
      chiudiMenu();
      presa = { chiave: art.dataset.chiave, colonna: art.dataset.colonna, el: art, fissa: art.dataset.fissa === '1' };
      trascinando = true;
      art.classList.add('presa');
      const c = art._carta;
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData('application/x-filo-carta', art.dataset.chiave);
      // Nel campo di scrittura del filo arriva quello che la carta dice.
      e.dataTransfer.setData('text/plain', c.stato ? `${c.titolo}: ${c.stato}` : c.titolo);
      global.SN_GESTI?.marca(e.dataTransfer, 'carta_home');
    });
    art.addEventListener('dragend', (e) => { contaFine(e); fineTrascinamento(); });
  }
  // Dove va la carta lasciata qui. Sopra un'altra carta ne prende il posto, in qualunque punto la si lasci: chi
  // scende le passa sotto, chi sale o arriva da fuori le passa sopra. Fra due carte decide la metà più vicina.
  // `segno` e `dove`: la carta su cui si disegna la linea, e da che lato.
  function bersaglio(host, e) {
    const tutte = [...host.querySelectorAll(':scope > .dash-carta')];
    const carte = mobili(host).filter((n) => !presa || n !== presa.el);
    const sotto = carte.find((n) => { const r = n.getBoundingClientRect(); return e.clientY >= r.top && e.clientY <= r.bottom; });
    if (sotto) {
      const scende = presa && tutte.includes(presa.el) && tutte.indexOf(presa.el) < tutte.indexOf(sotto);
      if (scende) return { prima: carte[carte.indexOf(sotto) + 1] || null, segno: sotto, dove: 'dopo' };
      return { prima: sotto, segno: sotto, dove: 'prima' };
    }
    for (const n of carte) {
      const r = n.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) return { prima: n, segno: n, dove: 'prima' };
    }
    const ultima = carte[carte.length - 1] || null;
    return { prima: null, segno: ultima, dove: 'dopo' };
  }
  function ammessa(host) {
    if (!presa) return false;
    const daAltro = presa.colonna === 'altro';
    if (host === tieniEl) return presa.colonna === 'destra' || (daAltro && !presa.sinistra && !presa.tasto);
    return host === accadeEl && ((presa.colonna === 'sinistra' && !presa.fissa) || (daAltro && presa.sinistra));
  }
  function agganciaColonna(host) {
    host.addEventListener('dragover', (e) => {
      if (!ammessa(host)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      for (const n of host.querySelectorAll('.sopra-prima, .sopra-dopo')) n.classList.remove('sopra-prima', 'sopra-dopo');
      const b = bersaglio(host, e);
      if (b.segno) b.segno.classList.add(b.dove === 'dopo' ? 'sopra-dopo' : 'sopra-prima');
    });
    host.addEventListener('dragleave', (e) => {
      if (host.contains(e.relatedTarget)) return;
      for (const n of host.querySelectorAll('.sopra-prima, .sopra-dopo')) n.classList.remove('sopra-prima', 'sopra-dopo');
    });
    host.addEventListener('drop', (e) => {
      if (!ammessa(host)) return;
      e.preventDefault();
      contaRilascio(e, 'colonna_home');
      const { chiave, colonna, sinistra } = presa;
      const b = bersaglio(host, e);
      const prima = b.prima ? b.prima.dataset.chiave : null;
      fineTrascinamento();
      if (colonna === 'altro' && sinistra) muovi({ tipo: 'mostra', chiave });
      else if (colonna === 'altro') muovi({ tipo: 'aggiungi', carta: chiave, prima });
      else ordinaColonna(colonna, chiave, prima);
    });
  }
  function agganciaAltro() {
    // Fuori da un'icona, il tasto destro su «altro» rimette la home com'era all'inizio.
    altroEl.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.dash-altro-app, .dash-altro-rimetti')) return;
      e.preventDefault();
      apriMenu(e.clientX, e.clientY, [{ etichetta: 'Rimetti le carte com’erano', fai: () => muovi({ tipo: 'ripristina' }) }]);
    });
    // Dove va quello che si lascia qui: sul «+» o fra quelli fuori vista lo si mette via; fra i tasti in vista un tasto
    // prende il posto davanti a cui lo si lascia; una carta lasciata altrove in «altro» va nel «+» come prima.
    const dove = (e) => {
      if (!presa) return null;
      const t = e.target && e.target.closest ? e.target : null;
      const nelPiu = t && (t.closest('.dash-altro-piu') || t.closest('#altroFuori'));
      if (nelPiu) return presa.colonna === 'destra' || presa.colonna === 'tasti' ? { via: true, el: altroEl.querySelector('#altroPiu') } : null;
      const griglia = t && t.closest('.dash-altro-griglia.vista');
      if (griglia && (presa.colonna === 'tasti' || (presa.colonna === 'altro' && presa.tasto))) return { tasti: griglia };
      return presa.colonna === 'destra' ? { via: true, el: null } : null;
    };
    const pulisci = () => {
      for (const n of altroEl.querySelectorAll('.sopra-prima, .sopra-dopo, .bersaglio')) n.classList.remove('sopra-prima', 'sopra-dopo', 'bersaglio');
      altroEl.classList.remove('bersaglio');
    };
    altroEl.addEventListener('dragover', (e) => {
      const b = dove(e);
      if (!b) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      pulisci();
      if (b.via) (b.el || altroEl).classList.add('bersaglio');
      else {
        const s = bersaglioTasti(b.tasti, e);
        if (s.segno) s.segno.classList.add(s.dove === 'dopo' ? 'sopra-dopo' : 'sopra-prima');
      }
    });
    altroEl.addEventListener('dragleave', (e) => { if (!altroEl.contains(e.relatedTarget)) pulisci(); });
    altroEl.addEventListener('drop', (e) => {
      const b = dove(e);
      if (!b) return;
      e.preventDefault();
      contaRilascio(e, 'altro_home');
      const { chiave, colonna } = presa;
      const s = b.tasti ? bersaglioTasti(b.tasti, e) : null;
      fineTrascinamento();
      if (b.via) muovi({ tipo: 'togli', carta: chiave });
      else if (colonna === 'tasti') muovi({ tipo: 'sposta', carta: chiave, prima: s.prima });
      else muovi({ tipo: 'aggiungi', carta: chiave, prima: s.prima });
    });
  }
  // Fra i tasti in vista: lasciato sopra un tasto, chi va avanti gli passa dopo, chi torna indietro o arriva dal «+» gli
  // passa davanti. Il «+» resta in fondo.
  function bersaglioTasti(griglia, e) {
    const tutti = [...griglia.querySelectorAll('.dash-altro-app[data-tasto="1"]')];
    const altri = tutti.filter((n) => !presa || n !== presa.el);
    const sotto = altri.find((n) => { const r = n.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; });
    if (sotto) {
      const avanti = presa && tutti.includes(presa.el) && tutti.indexOf(presa.el) < tutti.indexOf(sotto);
      if (avanti) { const dopo = altri[altri.indexOf(sotto) + 1]; return { prima: dopo ? dopo.dataset.id : null, segno: sotto, dove: 'dopo' }; }
      return { prima: sotto.dataset.id, segno: sotto, dove: 'prima' };
    }
    const ultimo = altri[altri.length - 1] || null;
    return { prima: null, segno: ultimo, dove: 'dopo' };
  }

  // Clic e Invio fanno la stessa cosa. A sinistra la carta è una conversazione che Filo ha cominciato: si apre nel
  // filo. A destra si apre quello che la carta tiene (l'app), o nel filo se non tiene un'app.
  function usaCarta(art) {
    const c = art && art._carta;
    if (!c) return;
    if (art.dataset.colonna === 'destra' && c.apri) c.apri();
    else apriNelFilo(art);
  }

  // ===== «Apri nel filo» =====
  function apriNelFilo(art) {
    apriCartaNelFilo(art && art._carta);
  }
  function apriCartaNelFilo(c) {
    if (!c) return;
    Promise.resolve(d.apriNelFilo({ chat: c.chat || null, testo: c.filo || '', esterno: c.esterno || '' })).then((r) => {
      if (r === 'accoglienza') avviso('Prima finiamo di presentarci, poi la carta si apre nel filo.');
      else if (r === 'risponde') avviso('Filo sta ancora rispondendo: riprova fra un attimo.');
    });
  }

  function scriviImpostazione(parziale) {
    d.send({ type: MSG.UPDATE_SETTINGS, settings: parziale }).then((r) => {
      if (r && r.ok && r.settings) { dati.impostazioni = r.settings; disegna(); }
    });
  }

  // ===== Dati che la carta chiede da sé =====
  async function caricaLayout() {
    const giro = ++giroPrimo;
    const r = await d.send({ type: MSG.CARTE_HOME_GET });
    layout = C.normalizza(r && r.ok ? r.layout : null);
    if (giro === giroPrimo) primoIncontro = !!(r && r.ok && r.primoIncontro);
    disegna();
  }
  // Finisce con l'accoglienza e dipende da cosa manca a Filo per rispondere. La disposizione di questa risposta no:
  // può essere più vecchia di una mossa annunciata nel frattempo.
  async function caricaPrimoIncontro() {
    const giro = ++giroPrimo;
    const r = await d.send({ type: MSG.CARTE_HOME_GET });
    if (giro !== giroPrimo || !r || !r.ok || !!r.primoIncontro === primoIncontro) return;
    primoIncontro = !!r.primoIncontro;
    disegna();
  }
  async function caricaDownloads() {
    const r = await d.send({ type: MSG.DOWNLOADS_LIST });
    dati.downloads = (r && Array.isArray(r.items)) ? r.items : [];
    disegna();
  }
  async function caricaEditor() {
    const r = await d.send({ type: MSG.EDITOR_RECENTI });
    dati.editor = r && r.ok ? r : { totale: 0, file: [] };
    disegna();
  }
  async function caricaMazzi() {
    const r = await d.send({ type: MSG.DECKS_LIST });
    dati.mazzi = r && r.ok && Array.isArray(r.decks) ? r.decks : [];
    disegna();
  }
  async function caricaLavori() {
    const r = await d.send({ type: MSG.LAVORI_IN_CORSO });
    dati.lavori = r && r.ok && Array.isArray(r.lavori) ? r.lavori : [];
    disegna();
  }
  async function caricaAperte(attendi = false) {
    const r = await d.send({ type: MSG.IN_PAUSA_STATO, attendi });
    if (!r || !r.ok) return;
    dati.aperte = { bacheca: !!(r.bacheca && r.bacheca.visible), mazzi: !!(r.mazzi && r.mazzi.visible) };
    disegna();
  }
  async function caricaImpostazioni() {
    try { dati.impostazioni = await global.SN_STORAGE.getSettings(); } catch (_) { dati.impostazioni = {}; }
    disegna();
  }
  let downloadsTimer = null;
  function ricaricaDownloadsPresto() {
    if (downloadsTimer) return;
    downloadsTimer = setTimeout(() => { downloadsTimer = null; caricaDownloads().catch(() => {}); }, 250);
  }

  function init(deps) {
    d = deps;
    MSG = global.SN_MSG.MSG;
    C = global.SN_CARTE_HOME;
    accadeEl = deps.accadeEl;
    tieniEl = deps.tieniEl;
    altroEl = deps.altroEl;
    agganciaColonna(accadeEl);
    agganciaColonna(tieniEl);
    agganciaAltro();
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg) return;
      if (msg.type === MSG.CARTE_HOME_CAMBIATE && msg.layout) { layout = C.normalizza(msg.layout); disegna(); }
      else if (msg.type === MSG.DOWNLOADS_UPDATED) ricaricaDownloadsPresto();
      else if (msg.type === MSG.LAVORI_CAMBIATI && Array.isArray(msg.lavori)) { dati.lavori = msg.lavori; disegna(); }
      else if (msg.type === MSG.AVVISI_COLONNA && Array.isArray(msg.carte)) riceviCornice(msg.carte);
      else if (msg.type === MSG.FILO_LIVE_UPDATED) caricaEditor().catch(() => {});
      else if (msg.type === MSG.DATI_IMPORTATI) { caricaMazzi().catch(() => {}); caricaPrimoIncontro().catch(() => {}); }
      else if (msg.type === MSG.FILO_ONBOARDING_UPDATED || msg.type === MSG.FILO_READY_CHANGED) caricaPrimoIncontro().catch(() => {});
      else if (msg.type === MSG.SETTINGS_UPDATED && msg.settings) { dati.impostazioni = msg.settings; disegna(); }
      else if (msg.type === MSG.IN_PAUSA_CAMBIATO && Object.prototype.hasOwnProperty.call(dati.aperte, msg.nome)) {
        dati.aperte = { ...dati.aperte, [msg.nome]: msg.visible === true };
        disegna();
      } else if (msg.type === MSG.AUTH_CHANGED) caricaAperte(true).catch(() => {});
      else if (msg.type === MSG.TAB_IN_VISTA && msg.inVista) {
        caricaEditor().catch(() => {});
        caricaMazzi().catch(() => {});
        caricaDownloads().catch(() => {});
        caricaLavori().catch(() => {});
        caricaAperte().catch(() => {});
        caricaPrimoIncontro().catch(() => {});
        // Tornata davanti: un avviso con la sua carta arrivato mentre era dietro adesso si fa notare.
        disegna();
      }
    });
    return Promise.all([caricaLayout(), caricaDownloads(), caricaEditor(), caricaMazzi(), caricaImpostazioni(), caricaLavori(),
      caricaAperte(true), caricaCornice()]).catch(() => {});
  }

  global.SN_DASH_CARTE = {
    init,
    apriEditor: () => apri(URL_EDITOR),
    // Lo stesso menu e lo stesso avviso per le altre parti della home (la barra dei siti, #1803).
    apriMenu,
    avviso,
    aperta: (nome) => dati.aperte[nome] === true,
    // Il doppio tocco (#2372): un tasto fa quello che fa il suo clic, una carta apre la sua app.
    usa(id) {
      const x = C.prendeLettera(id);
      if (!x) return false;
      if (C.tasto(id)) usaTasto(id, altroEl && altroEl.querySelector(`.dash-altro-app[data-id="${CSS.escape(id)}"]`));
      else apri(x.url);
      return true;
    },    setVive({ timers, notifiche }) {
      dati.timers = Array.isArray(timers) ? timers : [];
      dati.notifiche = Array.isArray(notifiche) ? notifiche : [];
      disegna();
    },
    setSuggerimenti(lista, { pronti = true } = {}) {
      dati.suggerimenti = Array.isArray(lista) ? lista : [];
      dati.suggerimentiPronti = pronti;
      disegna();
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
