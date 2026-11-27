// Cercare nel filo dalla home senza passare dalla chat (#869): parole nei messaggi, nelle pagine visitate e nel contenuto
// delle schede chiuse. Il suo tasto (#2372) le dà la colonna destra: il risultato sotto il puntatore o le frecce si
// mostra al centro, una pagina si riapre. Cosa trova lo decide il main (src/shared/filoCoda.js); non tocca il DOM al caricamento.
(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;
  let d = null;
  let host = null;
  let campo = null;
  let pannello = null;
  let giro = 0;
  let attesa = null;
  let voci = [];
  let scelta = -1;
  let aperta = false;
  // Il centro segue la ricerca finché l'utente non lo scorre a mano: da lì lo muovono solo puntatore e frecce.
  let manuale = false;
  let ultimaBattuta = 0;
  let seguiTimer = null;
  let mostrato = null;
  let passaggio = null;
  // La ricerca in corso, per i contatori (#1461): dall'apertura del pannello alla scelta, la posizione della voce, o niente.
  let sessione = null;
  function contaRicerca(evento) {
    try { Promise.resolve(d.send({ type: MSG.CONTATORI_EVENTO, misura: 'ricerca', pannello: 'cerca-filo', ...evento })).catch(() => {}); } catch (_) {}
  }
  // La ricerca nei propri dati, per i contatori della home (#1473): quanti risultati, quale si apre, a che posto e dopo
  // quanto. Le parole cercate restano qui, e nemmeno la loro lunghezza esce.
  const H = () => global.SN_CONTATORI_HOME_PAGINA || { RIPETUTA_MS: 10000, ASSESTATA_MS: 800 };
  let corrente = null;
  let ultimaVuota = 0;
  let assestata = null;
  function contaHome(misura, campi) {
    try { Promise.resolve(d.send({ type: MSG.CONTATORI_EVENTO, misura, ...campi })).catch(() => {}); } catch (_) {}
  }
  function contaCorrente() {
    clearTimeout(assestata);
    const c = corrente;
    if (!c || c.contata) return;
    c.contata = true;
    const ripetuta = ultimaVuota > 0 && c.t - ultimaVuota <= H().RIPETUTA_MS;
    ultimaVuota = c.n === 0 ? c.t : 0;
    contaHome('ricerca-home', { risultati: c.n, ...(ripetuta ? { ripetuta: true } : {}) });
  }
  // `n`: i risultati a schermo. La stessa ricerca ridisegnata (il fuoco che torna nel campo) non è una ricerca nuova.
  function nuovaCorrente(q, n) {
    clearTimeout(assestata);
    if (corrente && !corrente.contata && corrente.q !== q) corrente = null;
    const stessa = corrente && corrente.q === q;
    corrente = { q, n, t: Date.now(), contata: !!(stessa && corrente.contata) };
    if (!corrente.contata) assestata = setTimeout(contaCorrente, H().ASSESTATA_MS);
  }
  function tipoDi(r) {
    if (r.k === 'nascosta') return 'conversazione_nascosta';
    if (r.k === 'pagina') return r.archivio ? 'scheda_chiusa' : 'pagina';
    return 'messaggio';
  }

  function icona(nome, size = 14) {
    const I = global.SN_ICONS;
    return I && typeof I[nome] === 'function' ? I[nome](size) : '';
  }
  function el(tag, cls, testo) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (testo != null) n.textContent = testo;
    return n;
  }
  function quando(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const giorno = global.SN_DASH_CODA ? global.SN_DASH_CODA.nomeDelGiorno(t) : '';
    const x = new Date(t);
    return `${giorno} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`.trim();
  }

  // Svuota i risultati; la colonna resta alla ricerca finché non la si chiude.
  function svuotaRisultati() {
    contaCorrente();
    if (sessione && !sessione.scelto) contaRicerca({ esito: 'vuota' });
    sessione = null;
    clearTimeout(seguiTimer);
    pannello.hidden = true;
    pannello.replaceChildren();
    voci = [];
    scelta = -1;
    mostrato = null;
    campo.setAttribute('aria-expanded', 'false');
  }

  // Il tasto la apre: la colonna diventa la ricerca e il fuoco va nel suo campo. `q`: la frase chiesta a parole.
  function apri(q) {
    if (!host) return;
    if (!aperta) {
      aperta = true;
      manuale = false;
      host.hidden = false;
      if (d.colonna) d.colonna.classList.add('in-ricerca');
    }
    if (typeof q === 'string' && q.trim()) {
      campo.value = q.trim();
      ultimaBattuta = Date.now();
      cerca().catch(() => {});
    }
    campo.focus({ preventScroll: true });
  }
  // Esc o il tasto la chiudono: la colonna torna com'era e si riscrive nella chat.
  function chiudi() {
    if (!aperta) return;
    aperta = false;
    clearTimeout(attesa);
    ++giro;
    svuotaRisultati();
    campo.value = '';
    host.hidden = true;
    if (d.colonna) d.colonna.classList.remove('in-ricerca');
    if (d.coda.richiudiPagine) d.coda.richiudiPagine();
    if (d.chat) d.chat.focus({ preventScroll: true });
  }

  // Il risultato al centro: un messaggio al suo punto del filo, una pagina sulla sua riga di pagine.
  function mostra(b) {
    const r = b && b._risultato;
    if (!r || r.k === 'significato' || r.k === 'nascosta' || mostrato === b) return;
    mostrato = b;
    if (d.mostraFilo) d.mostraFilo();
    if (r.k === 'pagina') { if (d.coda.vaiAPagina) d.coda.vaiAPagina({ url: r.url, ts: r.ts }).catch(() => {}); return; }
    // La riga di pagine aperta da un risultato di prima si richiude anche passando a un messaggio.
    if (d.coda.richiudiPagine) d.coda.richiudiPagine();
    d.coda.vaiA({ chat: r.chat, i: r.i, app: !!r.app, ts: r.ts }).catch(() => {});
  }
  // Dopo una pausa nello scrivere il centro va sul primo risultato, il più probabile.
  function seguiDopoLaPausa() {
    clearTimeout(seguiTimer);
    if (manuale || !voci.length) return;
    const pausa = d.pausaMs ? d.pausaMs() : 500;
    const primo = voci.find((b) => b._risultato && !['significato', 'nascosta'].includes(b._risultato.k));
    if (!primo) return;
    seguiTimer = setTimeout(() => { if (aperta && !manuale && scelta < 0) mostra(primo); }, Math.max(0, ultimaBattuta + pausa - Date.now()));
  }

  function voce(r) {
    const b = el('button', `dash-cerca-voce dash-cerca-${r.k === 'pagina' || r.k === 'nascosta' ? r.k : 'msg'}`);
    b.type = 'button';
    b.setAttribute('role', 'option');
    const ic = el('span', 'dash-cerca-ico');
    ic.innerHTML = icona(r.k === 'pagina' ? 'globe' : (r.role === 'user' ? 'user' : 'filoLogo'), 13);
    const corpo = el('span', 'dash-cerca-corpo');
    if (r.k === 'pagina') {
      corpo.append(el('span', 'dash-cerca-titolo', r.titolo || global.SN_FILO_CODA.sito(r.url)));
      corpo.append(el('span', 'dash-cerca-sotto', r.estratto || global.SN_FILO_CODA.sito(r.url)));
      const dove = global.SN_FILO_CODA.daAprire(r);
      b.title = dove && dove.sito ? `${dove.url} · indirizzo troppo lungo, si apre il sito` : r.url;
    } else if (r.k === 'nascosta') {
      ic.innerHTML = icona('eyeOff', 13);
      corpo.append(el('span', 'dash-cerca-titolo', r.titolo || r.testo));
      corpo.append(el('span', 'dash-cerca-sotto', r.testo));
      b.title = 'Rimetti la conversazione nel filo';
    } else {
      corpo.append(el('span', 'dash-cerca-titolo', r.testo));
      corpo.append(el('span', 'dash-cerca-sotto', r.role === 'user' ? 'tu' : 'Filo'));
    }
    b.append(ic, corpo, el('span', 'dash-cerca-quando', quando(r.ts)));
    b._risultato = r;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => { usa(r).catch(() => {}); });
    // Un passaggio veloce sopra l'elenco non trascina il centro avanti e indietro.
    b.addEventListener('mouseenter', () => { clearTimeout(passaggio); passaggio = setTimeout(() => mostra(b), 90); });
    b.addEventListener('mouseleave', () => clearTimeout(passaggio));
    return b;
  }

  async function usa(r) {
    if (r.k === 'significato') return significato(r);
    const i = voci.findIndex((v) => v._risultato === r);
    if (sessione) {
      contaRicerca({ esito: 'scelta', attesaMs: Date.now() - sessione.t0, posizione: i >= 0 ? i + 1 : null });
      sessione.scelto = true;
    }
    if (corrente && i >= 0) {
      const c = corrente;
      contaCorrente();
      contaHome('ricerca-home-aperta', { tipo: tipoDi(r), posizione: i + 1, ms: Date.now() - c.t });
    }
    if (r.k === 'nascosta') return rimetti(r);
    if (r.k === 'pagina') {
      const dove = global.SN_FILO_CODA.daAprire(r);
      if (!dove) return;
      // Una scheda chiusa si riapre com'era (scroll, paese); se la sua voce non c'è più, come una pagina qualunque.
      const riaperta = r.archivio ? await d.send({ type: MSG.REOPEN_ARCHIVED_TAB, id: r.archivio })
        : !dove.sito ? await d.send({ type: MSG.REOPEN_ARCHIVED_TAB, url: dove.url, perIndirizzo: true }) : null;
      if (!riaperta || !riaperta.ok) d.send({ type: MSG.OPEN_URL, url: dove.url });
      return;
    }
    mostrato = null;
    if (d.mostraFilo) d.mostraFilo();
    await d.coda.vaiA({ chat: r.chat, i: r.i, app: !!r.app, ts: r.ts });
  }

  // #1295 — una conversazione nascosta si rimette nel filo e ci si va.
  async function rimetti(r) {
    const res = await d.send({ type: MSG.FILO_CHAT_NASCONDI, id: r.chat, nascosta: false });
    if (!res || !res.ok) return;
    if (d.coda.rimettiChat) await d.coda.rimettiChat(r.chat);
    if (d.mostraFilo) d.mostraFilo();
    await d.coda.vaiA({ chat: r.chat, i: r.i, ts: r.ts });
    if (aperta && campo.value.trim().length >= 2) await cerca();
  }

  async function togli(r) {
    const res = await d.send({ type: MSG.FILO_CODA_TOGLI_PAGINE, url: r.url });
    if (!res || !res.ok) return;
    if (d.coda.togliIndirizzo) d.coda.togliIndirizzo(r.url);
    if (!pannello.hidden) await cerca();
  }

  // La ricerca per significato fra le schede chiuse (quella che faceva la Cronologia, #872): spende una chiamata ai
  // vettori, quindi parte solo a richiesta, e i risultati si aggiungono sotto quelli per parole.
  function vocePerSignificato(q) {
    const b = el('button', 'dash-cerca-voce dash-cerca-significato');
    b.type = 'button';
    b.setAttribute('role', 'option');
    const ic = el('span', 'dash-cerca-ico');
    ic.innerHTML = icona('sparkles', 13);
    const corpo = el('span', 'dash-cerca-corpo');
    corpo.append(el('span', 'dash-cerca-titolo', 'Cerca per significato fra le schede chiuse'));
    b.append(ic, corpo);
    b.title = 'Trova anche le pagine che parlano di questo con altre parole';
    b._risultato = { k: 'significato', q, el: b };
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => { usa(b._risultato).catch(() => {}); });
    return b;
  }

  async function significato(r) {
    const mio = giro;
    const b = r.el;
    if (!b || b.disabled) return;
    b.disabled = true;
    b.querySelector('.dash-cerca-titolo').textContent = 'Cerco per significato…';
    const res = await d.send({ type: MSG.SEARCH_ARCHIVED_TABS, query: r.q });
    if (mio !== giro || !b.isConnected) return;
    const gia = new Set(voci.map((v) => v._risultato && v._risultato.url).filter(Boolean));
    const nuove = (res && res.ok && Array.isArray(res.results) ? res.results : [])
      .filter((t) => t && /^https?:\/\//i.test(String(t.url || '')) && !gia.has(t.url));
    const i = voci.indexOf(b);
    if (i >= 0) voci.splice(i, 1);
    const dopo = nuove.map((t) => voce({ k: 'pagina', url: t.url, titolo: t.title || '', ts: t.closedAt || t.openedAt || '', estratto: t.summary || t.snippet || '', ...(t.id ? { archivio: t.id } : {}), ...(t.urlTagliato ? { urlTagliato: true } : {}) }));
    if (dopo.length) {
      b.replaceWith(...dopo);
      voci.splice(i >= 0 ? i : voci.length, 0, ...dopo);
    } else {
      b.replaceWith(el('div', 'dash-cerca-niente', res && res.noEmbed
        ? 'Senza un modello per i vettori cerco solo per parole'
        : 'Niente di più per significato'));
    }
  }

  function disegna(res, q) {
    pannello.replaceChildren();
    const messaggi = Array.isArray(res.messaggi) ? res.messaggi : [];
    const pagine = Array.isArray(res.pagine) ? res.pagine : [];
    voci = [];
    scelta = -1;
    if (!messaggi.length && !pagine.length) {
      pannello.append(el('div', 'dash-cerca-niente', `Niente nel filo per «${q}»`));
    } else {
      for (const r of [...messaggi, ...pagine]) {
        const b = voce(r);
        voci.push(b);
        pannello.append(b);
      }
      const altri = (Number(res.tanti) || 0) - voci.length;
      if (altri > 0) pannello.append(el('div', 'dash-cerca-niente', `e altri ${altri}: aggiungi una parola per trovarli`));
      if (res.allargata && Array.isArray(res.termini)) {
        pannello.insertBefore(el('div', 'dash-cerca-niente', `Niente con tutte le parole: ecco cosa c'è con «${res.termini.join(' ')}»`), pannello.firstChild);
      }
    }
    const nascoste = Array.isArray(res.nascoste) ? res.nascoste : [];
    if (nascoste.length) {
      pannello.append(el('div', 'dash-cerca-niente dash-cerca-gruppo', nascoste.length === 1 ? 'In una conversazione nascosta' : `In ${nascoste.length} conversazioni nascoste`));
      for (const r of nascoste) {
        const b = voce(r);
        voci.push(b);
        pannello.append(b);
      }
    }
    if (q.length >= 3) {
      const s = vocePerSignificato(q);
      voci.push(s);
      pannello.append(s);
    }
    pannello.hidden = false;
    campo.setAttribute('aria-expanded', 'true');
    nuovaCorrente(q, voci.filter((b) => b._risultato && b._risultato.k !== 'significato').length);
    if (!sessione) {
      sessione = { t0: Date.now(), scelto: false };
      contaRicerca({ esito: 'aperta' });
    }
    mostrato = null;
    seguiDopoLaPausa();
  }

  async function cerca() {
    const q = campo.value.trim();
    const mio = ++giro;
    if (q.length < 2) { svuotaRisultati(); return; }
    const res = await d.send({ type: MSG.FILO_CERCA, q });
    if (mio !== giro || !res || !res.ok) return;
    disegna(res, q);
  }

  // Tutte le conversazioni nascoste, anche senza ricordarne una parola (#1295): dal tasto destro sul campo.
  async function mostraNascoste() {
    campo.focus();
    const mio = ++giro;
    const res = await d.send({ type: MSG.FILO_CERCA, nascoste: 'tutte' });
    if (mio !== giro || !res || !res.ok) return;
    contaCorrente();
    corrente = null;
    const tutte = Array.isArray(res.nascoste) ? res.nascoste : [];
    pannello.replaceChildren();
    voci = [];
    scelta = -1;
    pannello.append(el('div', 'dash-cerca-niente dash-cerca-gruppo', !tutte.length ? 'Nessuna conversazione nascosta'
      : (tutte.length === 1 ? 'Una conversazione nascosta' : `${tutte.length} conversazioni nascoste`)));
    for (const r of tutte) {
      const b = voce(r);
      voci.push(b);
      pannello.append(b);
    }
    pannello.hidden = false;
    campo.setAttribute('aria-expanded', 'true');
  }

  function evidenzia(i) {
    if (!voci.length) return;
    scelta = (i + voci.length) % voci.length;
    voci.forEach((b, j) => b.classList.toggle('scelta', j === scelta));
    voci[scelta].scrollIntoView({ block: 'nearest' });
    clearTimeout(seguiTimer);
    mostra(voci[scelta]);
  }

  function vociMenu(target) {
    const e = target && target.nodeType === 1 ? target : (target && target.parentElement) || null;
    if (e && e.closest && e.closest('.dash-cerca-campo')) {
      return [{ type: 'item', icon: icona('eyeOff', 16), label: 'Mostra le conversazioni nascoste', azione: 'chat-archive', onClick: () => { mostraNascoste().catch(() => {}); } }];
    }
    const b = e && e.closest ? e.closest('.dash-cerca-voce') : null;
    if (!b || !b._risultato) return [];
    const r = b._risultato;
    if (r.k === 'nascosta') {
      return [
        { type: 'item', icon: icona('restore', 16), label: 'Rimetti la conversazione nel filo', azione: 'chat-archive', onClick: () => { usa(r).catch(() => {}); } },
        { type: 'item', icon: icona('copy', 16), label: 'Copia il testo', onClick: () => { copiaIntero(r); } },
      ];
    }
    if (r.k === 'pagina') {
      const dove = global.SN_FILO_CODA.daAprire(r);
      return [
        { type: 'item', icon: icona('globe', 16), label: dove && dove.sito ? 'Apri il sito' : 'Riapri la pagina', onClick: () => { usa(r).catch(() => {}); } },
        { type: 'item', icon: icona('copy', 16), label: dove && dove.sito ? 'Copia l’indirizzo del sito' : 'Copia l’indirizzo', onClick: () => { navigator.clipboard.writeText(dove && dove.sito ? dove.url : r.url).catch(() => {}); } },
        { type: 'item', icon: icona('trash', 16), label: 'Togli dal filo', onClick: () => { togli(r).catch(() => {}); } },
      ];
    }
    return [
      { type: 'item', icon: icona('filoLogo', 16), label: 'Vai a questo punto del filo', azione: 'chat-archive', onClick: () => { usa(r).catch(() => {}); } },
      { type: 'item', icon: icona('copy', 16), label: 'Copia il testo', onClick: () => { copiaIntero(r); } },
    ];
  }

  // L'estratto coi puntini è l'anteprima della riga: negli appunti va il messaggio intero (#869.2).
  function copiaIntero(r) {
    navigator.clipboard.writeText(typeof r.intero === 'string' && r.intero ? r.intero : r.testo).catch(() => {});
  }

  function init(deps) {
    d = deps;
    host = deps.host;
    if (!host) return;
    // Non un <label>: il clic sul riquadro premerebbe la lente, che chiude.
    const box = el('div', 'dash-cerca-campo');
    box.addEventListener('mousedown', (e) => { if (e.target === box) { e.preventDefault(); campo.focus(); } });
    // La lente è il tasto della ricerca rimasto in cima alla colonna: un clic la chiude, come Esc.
    const ic = el('button', 'dash-cerca-lente');
    ic.type = 'button';
    ic.id = 'cercaChiudi';
    ic.title = 'Chiudi la ricerca';
    ic.setAttribute('aria-label', 'Chiudi la ricerca');
    ic.setAttribute('aria-pressed', 'true');
    ic.innerHTML = icona('search', 16);
    ic.addEventListener('click', (e) => { e.preventDefault(); chiudi(); });
    campo = el('input', 'dash-cerca-input');
    campo.id = 'cercaInput';
    campo.type = 'search';
    campo.placeholder = 'Cerca nel filo';
    campo.autocomplete = 'off';
    campo.spellcheck = false;
    campo.setAttribute('aria-label', 'Cerca nel filo');
    campo.setAttribute('aria-expanded', 'false');
    box.append(ic, campo);
    pannello = el('div', 'dash-cerca-risultati');
    pannello.id = 'cercaRisultati';
    pannello.setAttribute('role', 'listbox');
    pannello.hidden = true;
    host.append(box, pannello);
    campo.addEventListener('input', () => {
      ultimaBattuta = Date.now();
      clearTimeout(seguiTimer);
      clearTimeout(attesa);
      attesa = setTimeout(() => { cerca().catch(() => {}); }, 180);
    });
    // Col pannello ancora aperto (il fuoco torna da un menu) la scelta fatta con le frecce resta dov'era.
    campo.addEventListener('focus', () => { if (pannello.hidden && campo.value.trim().length >= 2) cerca().catch(() => {}); });
    // Esc chiude anche col fuoco su un risultato o sulla lente.
    host.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !aperta) return;
      e.preventDefault();
      e.stopPropagation();
      chiudi();
    });
    // Lo scorrimento a mano del centro ferma il centro che segue la battitura.
    for (const n of [d.bubblesEl].filter(Boolean)) {
      for (const ev of ['wheel', 'touchstart', 'pointerdown']) n.addEventListener(ev, () => { if (aperta) { manuale = true; clearTimeout(seguiTimer); } }, { passive: true });
    }
    campo.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); evidenzia(scelta + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); evidenzia(scelta - 1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const b = voci[scelta >= 0 ? scelta : 0];
        if (b) usa(b._risultato).catch(() => {});
      }
    });
    // Il risultato scelto con le frecce ha il suo menu anche da tastiera (#1295): Shift+F10 nel campo apre quello, non
    // il menu del campo. Il menu di Filo cede il passo a chi ha già preso il tasto destro.
    campo.addEventListener('contextmenu', (e) => {
      const M = global.SN_MENU;
      if (scelta < 0 || !voci[scelta] || !M || !(M.daTastiera && M.daTastiera())) return;
      const items = vociMenu(voci[scelta]);
      if (!items.length) return;
      e.preventDefault();
      const r = voci[scelta].getBoundingClientRect();
      M.open({ x: r.left + 12, y: r.bottom, items });
    });
    global.SN_VOCI_PAGINA = Array.isArray(global.SN_VOCI_PAGINA) ? global.SN_VOCI_PAGINA : [];
    if (!global.SN_VOCI_PAGINA.includes(vociMenu)) global.SN_VOCI_PAGINA.push(vociMenu);
    // La C del doppio Ctrl (#2377): nella home la apre il comando, da un'altra scheda si arriva con ?cerca.
    try {
      global.chrome.runtime.onMessage.addListener((m) => {
        if (m && m.type === MSG.SHORTCUT_TRIGGERED && m.command === 'cerca-nel-filo') apri();
      });
    } catch (_) {}
    try {
      const u = new URL(global.location.href);
      if (u.searchParams.has('cerca')) {
        u.searchParams.delete('cerca');
        global.history.replaceState(global.history.state, '', u.pathname + u.search + u.hash);
        apri();
      }
    } catch (_) {}
  }

  global.SN_DASH_CERCA = { init, apri, chiudi, aperta: () => aperta };
})(typeof globalThis !== 'undefined' ? globalThis : window);
