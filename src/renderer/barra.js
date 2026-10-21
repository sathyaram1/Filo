// La barra laterale disegnata (#871): lo stato lo tiene il main, qui si disegna e si riportano i
// gesti. Solo gesti veri (isTrusted): la vista è sua, ma la regola non costa niente.
// Regole: patterns/globale-nella-barra-contestuale-nel-tasto-destro.md

(function () {
  'use strict';

  const api = window.barra;
  const ICONS = window.SN_ICONS || {};
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const striscia = $('striscia');
  const pannello = $('pannello');
  const nav = $('nav');
  const fisse = $('fisse');
  const ora = $('ora');

  const SUGGERIMENTO_MS = 350;
  const SOGLIA_TRASCINA = 4;

  const svg = (nome, px) => (typeof ICONS[nome] === 'function' ? ICONS[nome](px) : '');

  let stato = { aperta: false, icone: [], altro: [], altroAperto: false, opzioni: { spinta: true, attesaMs: 250, striscia: true } };
  const opzioni = () => stato.opzioni || {};
  let firma = null;
  let eraAperta = false;

  // ── tema ─────────────────────────────────────────────────────────────────
  let varsScritte = [];
  function applicaTema(vars) {
    for (const k of varsScritte) root.style.removeProperty(k);
    varsScritte = [];
    for (const [k, v] of Object.entries(vars || {})) {
      if (!/^--[a-z][a-z0-9-]*$/.test(k) || typeof v !== 'string' || !v) continue;
      root.style.setProperty(k, v);
      varsScritte.push(k);
    }
  }

  // ── la spinta sul bordo ──────────────────────────────────────────────────
  let spinta = null;
  function annullaSpinta() {
    if (spinta) { clearTimeout(spinta); spinta = null; }
    striscia.classList.remove('spinge');
  }
  // Il bordo va SPINTO, non sfiorato: il puntatore resta sulla linea per l'attesa scelta in Preferenze. Oltre la
  // linea la striscia si clicca soltanto: lì è già pagina, e fermarsi non è spingere.
  const LINEA = 4;
  striscia.addEventListener('pointermove', (e) => {
    if (!e.isTrusted || stato.aperta || opzioni().spinta === false) return;
    if (e.clientX >= LINEA) { annullaSpinta(); return; }
    // Chi trascina una scheda o seleziona del testo passa di qui con un tasto premuto: non spinge.
    if (e.buttons) { annullaSpinta(); return; }
    if (spinta) return;
    striscia.classList.add('spinge');
    spinta = setTimeout(() => { spinta = null; api.spinta(); }, Number(opzioni().attesaMs) || 250);
  });
  striscia.addEventListener('pointerleave', annullaSpinta);
  striscia.addEventListener('pointerdown', annullaSpinta);
  striscia.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    annullaSpinta();
    api.apri();
  });

  // ── puntatore dentro e fuori ─────────────────────────────────────────────
  let trascina = null;
  pannello.addEventListener('pointerenter', (e) => { if (e.isTrusted) api.dentro(); });
  pannello.addEventListener('pointerleave', (e) => {
    if (!e.isTrusted || trascina || colore) return;
    nascondiSuggerimento();
    api.fuori();
  });
  // Il margine trasparente dell'ombra (e le fasce sopra e sotto il pannello) è della pagina: i gesti che ci
  // cadono tornano alla scheda, e un clic lì, arrivato alla pagina, chiude la barra come ogni clic sulla pagina.
  window.SN_VUOTO.collega({
    inoltra: (gesto) => api.inoltra(gesto),
    onCursore: api.onCursore,
    // La rotella sulla striscia scorre la pagina: la striscia si clicca, non si scorre.
    proprio: (e, tipo) => !!trascina || !!(e.target && e.target.closest
      && (e.target.closest('#pannello') || (tipo !== 'rotella' && e.target.closest('#striscia')))),
    // La vista tocca i bordi sinistro e basso della finestra, e in alto la fila delle schede: solo a destra c'è la pagina.
    versoLaPagina: (e) => e.clientX >= innerWidth - 1,
  });

  // Il tasto destro sulle voci che non sono icone del registro: le loro scelte le compone il main.
  function menuDi(el, dati) {
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!e.isTrusted) return;
      nascondiSuggerimento();
      api.menu(Object.assign({ x: Math.round(e.clientX), y: Math.round(e.clientY) }, dati));
    });
  }
  menuDi(striscia, { striscia: true });

  // ── suggerimenti ─────────────────────────────────────────────────────────
  // L'etichetta vive quanto il puntatore sull'icona, a barra aperta e con l'icona ferma (#1201):
  // patterns/un-riquadro-che-si-riempie-dopo-va-rimisurato-dopo-la-posa.md.
  let suggTimer = null;
  let suggDi = null;
  function programmaSuggerimento(el) {
    nascondiSuggerimento();
    suggDi = el;
    suggTimer = setTimeout(() => {
      suggTimer = null;
      // Chiusa nel frattempo, o la vista stretta sotto il puntatore: nessun pointerleave lo direbbe.
      if (!el.isConnected || trascina || !stato.aperta || !el.matches(':hover')) { suggDi = null; return; }
      const r = el.getBoundingClientRect();
      const p = pannello.getBoundingClientRect();
      api.suggerimento({ testo: el.dataset.sugg || el.getAttribute('aria-label') || '', x: Math.round(p.right + 8), y: Math.round(r.top + r.height / 2 - 11) });
    }, SUGGERIMENTO_MS);
  }
  function nascondiSuggerimento() {
    if (suggTimer) { clearTimeout(suggTimer); suggTimer = null; }
    suggDi = null;
    api.suggerimento({ testo: '' });
  }

  // ── le icone del primo gruppo, e il loro «Altro…» ────────────────────────
  function bottone(classe) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = classe;
    b.addEventListener('pointerenter', (e) => { if (e.isTrusted) programmaSuggerimento(b); });
    b.addEventListener('pointerleave', () => { if (suggDi === b) nascondiSuggerimento(); });
    b.addEventListener('pointerdown', () => { if (suggDi === b) nascondiSuggerimento(); });
    return b;
  }

  function aggiornaIcona(b, it) {
    const detto = b.dataset.sugg || b.getAttribute('aria-label') || '';
    aspettoIcona(b, it);
    // Il clic ha cambiato cosa fa l'icona (Aiuto → Parla): il puntatore ancora sopra lo legge subito.
    const ora = b.dataset.sugg || b.getAttribute('aria-label') || '';
    if (detto && ora !== detto && b.isConnected && b.matches(':hover') && !trascina) programmaSuggerimento(b);
  }

  function aspettoIcona(b, it) {
    b.dataset.id = it.id;
    b.setAttribute('aria-label', it.etichetta);
    // Spenta, il suggerimento dice perché.
    if (it.spenta && it.motivo) b.dataset.sugg = it.motivo;
    else if (it.perche) b.dataset.sugg = `${it.etichetta}: ${it.perche}`;
    else if (it.tasto) b.dataset.sugg = `${it.etichetta} (${it.tasto})`;
    else delete b.dataset.sugg;
    b.setAttribute('aria-disabled', it.spenta ? 'true' : 'false');
    b.classList.toggle('accesa', !!it.accesa);
    b.classList.toggle('ascolta', !!it.ascolta);
    b.classList.toggle('risposta', !!it.risposta);
    if (it.ascolta) b.setAttribute('aria-pressed', 'true');
    else b.removeAttribute('aria-pressed');
    if (b.dataset.icona !== it.icona) {
      b.dataset.icona = it.icona;
      b.innerHTML = svg(it.icona, 18);
    }
  }

  // Il contagocce vuole il gesto vero, che qui c'è e nella pagina no: si apre dalla barra, che resta finché si sceglie.
  let colore = false;
  function prendiColore(id) {
    if (typeof window.EyeDropper !== 'function') { api.azione({ id }); return; }
    colore = true;
    new window.EyeDropper().open()
      .then((r) => { if (r && r.sRGBHex) api.azione({ id, colore: String(r.sRGBHex) }); }, () => {})
      .finally(() => {
        colore = false;
        if (!pannello.matches(':hover')) api.fuori();
      });
  }

  // Il confine fra le icone in vista e quelle messe da parte: si apre e si chiude col clic, e si apre da solo
  // quando ci si ferma sopra trascinando un'icona.
  const tastoAltro = bottone('ico altro-tasto');
  tastoAltro.dataset.sugg = 'Altro…';
  tastoAltro.innerHTML = svg('caretDown', 16);
  tastoAltro.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    api.altro({ aperto: !stato.altroAperto });
  });

  let altroEraAperto = false;
  function disegnaTastoAltro(aperto, quante) {
    tastoAltro.setAttribute('aria-expanded', aperto ? 'true' : 'false');
    const nome = aperto ? 'Nascondi «Altro…»' : (quante ? `Altro… (${quante})` : 'Altro…');
    tastoAltro.setAttribute('aria-label', nome);
    tastoAltro.dataset.sugg = nome;
  }

  function nuovaIcona(it, zona) {
    const b = bottone('ico');
    b.dataset.zona = zona;
    aggiornaIcona(b, it);
    b.addEventListener('click', (e) => {
      if (!e.isTrusted || b.getAttribute('aria-disabled') === 'true') return;
      if (it.contagocce) prendiColore(it.id);
      else api.azione({ id: it.id });
    });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!e.isTrusted) return;
      api.menu({ id: it.id, x: e.clientX, y: e.clientY });
    });
    b.addEventListener('pointerdown', (e) => iniziaTrascina(e, b));
    b.addEventListener('animationend', () => b.classList.remove('nuova'));
    // L'etichetta di un'azione della pagina dipende dalla pagina («Traduci» o «Mostra originale»): si richiede al passaggio.
    if (it.pagina) b.addEventListener('pointerenter', (e) => { if (e.isTrusted) api.chiedi(); });
    return b;
  }

  function disegnaIcone(icone, altro, aperto, animaNuove) {
    const ids = `${icone.map((i) => i.id).join('|')}#${aperto ? altro.map((i) => i.id).join('|') : '-'}`;
    disegnaTastoAltro(aperto, altro.length);
    if (ids === firma) {
      // Stessi pulsanti: si aggiornano al loro posto, così un clic a metà non si perde.
      for (const it of [...icone, ...(aperto ? altro : [])]) {
        const b = nav.querySelector(`.ico[data-id="${it.id}"]`);
        if (b) aggiornaIcona(b, it);
      }
      return;
    }
    const esistenti = new Map([...nav.querySelectorAll('.ico[data-id]')].map((b) => [b.dataset.id, b]));
    const prima = new Set(esistenti.keys());
    firma = ids;
    // I bottoni che restano sono gli stessi: quello che si sta trascinando tiene il puntatore («Altro…» che si apre a
    // metà gesto), e un clic a metà non si perde.
    const icona = (it, zona) => {
      const b = esistenti.get(it.id) || nuovaIcona(it, zona);
      b.dataset.zona = zona;
      aggiornaIcona(b, it);
      return b;
    };
    const figli = icone.map((it) => icona(it, 'bar'));
    figli.push(tastoAltro);
    if (aperto) for (const it of altro) figli.push(icona(it, 'secondary'));
    if (animaNuove) for (const b of figli) if (b.dataset.id && !prima.has(b.dataset.id)) b.classList.add('nuova');
    metti(figli);
    if (suggDi && !suggDi.isConnected) nascondiSuggerimento();
    const appenaAperto = aperto && !altroEraAperto;
    altroEraAperto = aperto;
    if (appenaAperto && altro.length) {
      // «Altro…» appena aperto: se il gruppo scorre, si vede quanto più si può di lui, con la piega in cima.
      const fondo = figli[figli.length - 1];
      const giu = fondo.offsetTop - nav.offsetTop + fondo.offsetHeight + 4;
      nav.scrollTop = Math.min(tastoAltro.offsetTop - nav.offsetTop - 4, Math.max(nav.scrollTop, giu - nav.clientHeight));
    } else {
      // L'icona appena arrivata si fa vedere anche se il gruppo scorre: senza, sembra che il trascinamento non abbia fatto niente.
      const arrivata = prima.size ? figli.find((b) => b.dataset.id && !prima.has(b.dataset.id)) : null;
      if (arrivata) mostraNelGruppo(arrivata);
    }
    misura();
  }

  // Mette i figli nell'ordine voluto spostando solo chi è fuori posto: un nodo spostato perde la cattura del puntatore.
  // Il segno di un trascinamento in corso resta dov'è: lo rimette il movimento dopo.
  function metti(figli) {
    const voluti = new Set(figli);
    for (const el of [...nav.children]) if (!voluti.has(el) && !el.classList.contains('segno')) el.remove();
    let prec = null;
    for (const el of figli) {
      let atteso = prec ? prec.nextElementSibling : nav.firstElementChild;
      while (atteso && atteso.classList.contains('segno')) atteso = atteso.nextElementSibling;
      if (atteso !== el) nav.insertBefore(el, atteso);
      prec = el;
    }
  }

  // Misure di impaginazione, non del riquadro: l'icona nuova entra rimpicciolita dall'animazione.
  function mostraNelGruppo(el) {
    const su = el.offsetTop - nav.offsetTop;
    const giu = su + el.offsetHeight;
    if (giu > nav.scrollTop + nav.clientHeight) nav.scrollTop = giu - nav.clientHeight + 4;
    else if (su < nav.scrollTop) nav.scrollTop = su - 4;
  }

  // Il gruppo che scorre sfuma dal lato dove ci sono altre icone: la barra di scorrimento non c'è.
  function misura() {
    nav.classList.toggle('altre-sopra', nav.scrollTop > 1);
    nav.classList.toggle('altre-sotto', nav.scrollTop + nav.clientHeight < nav.scrollHeight - 1);
  }
  window.addEventListener('resize', misura);
  nav.addEventListener('scroll', () => {
    if (suggDi && nav.contains(suggDi)) nascondiSuggerimento();
    misura();
  }, { passive: true });

  // ── il sistema: ora e voci fisse ─────────────────────────────────────────
  const FISSE = [
    { comando: 'history', icona: 'memory', etichetta: 'Memorie' },
    { comando: 'apps', icona: 'apps', etichetta: 'App' },
    { comando: 'redteam', icona: 'redteam', etichetta: 'Red-team' },
    { comando: 'account', icona: 'user', etichetta: 'Profilo' },
    { comando: 'settings', icona: 'options', etichetta: 'Impostazioni' },
  ];
  const fissi = {};
  for (const f of FISSE) {
    const b = bottone('ico piccola');
    b.dataset.comando = f.comando;
    if (f.comando === 'redteam') b.hidden = true;
    b.setAttribute('aria-label', f.etichetta);
    b.innerHTML = svg(f.icona, 16);
    b.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      const r = b.getBoundingClientRect();
      api.sistema({ comando: f.comando, y: Math.round(r.top) });
    });
    menuDi(b, { comando: f.comando });
    fisse.appendChild(b);
    fissi[f.comando] = b;
  }

  let firmaAccount = '';
  function disegnaAccount(a) {
    const b = fissi.account;
    const f = a ? `${a.dentro}|${a.foto}|${a.etichetta}` : '';
    if (f === firmaAccount) return;
    firmaAccount = f;
    const nome = a && a.dentro ? (a.etichetta || 'Profilo') : 'Accedi';
    b.setAttribute('aria-label', a && a.dentro ? `Profilo: ${nome}` : nome);
    b.dataset.sugg = nome;
    if (a && a.dentro && /^https:\/\//.test(a.foto || '')) {
      const img = document.createElement('img');
      img.className = 'avatar';
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => { b.innerHTML = svg('user', 16); };
      img.src = a.foto;
      b.replaceChildren(img);
    } else {
      b.innerHTML = svg('user', 16);
    }
  }

  function scriviOra() {
    const d = new Date();
    ora.textContent = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    ora.dataset.sugg = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    setTimeout(scriviOra, 60000 - (Date.now() % 60000) + 50);
  }
  ora.addEventListener('pointerenter', (e) => { if (e.isTrusted) programmaSuggerimento(ora); });
  menuDi(ora, { ora: true });
  ora.addEventListener('pointerleave', () => { if (suggTimer) { clearTimeout(suggTimer); suggTimer = null; } nascondiSuggerimento(); });
  scriviOra();

  // ── tastiera ─────────────────────────────────────────────────────────────
  const tuttiIBottoni = () => [...pannello.querySelectorAll('.ico:not([hidden])')];
  pannello.addEventListener('keydown', (e) => {
    const lista = tuttiIBottoni();
    const i = lista.indexOf(document.activeElement);
    let j = -1;
    if (e.key === 'ArrowDown') j = i < 0 ? 0 : Math.min(lista.length - 1, i + 1);
    else if (e.key === 'ArrowUp') j = i < 0 ? 0 : Math.max(0, i - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = lista.length - 1;
    if (j < 0) return;
    e.preventDefault();
    lista[j].focus();
  });

  // ── trascinare: dentro la barra si riordina, oltre «Altro…» si mette da parte ──
  const APRI_ALTRO_MS = 450;
  function iniziaTrascina(e, b) {
    if (!e.isTrusted || e.button !== 0) return;
    const partenza = { x: e.clientX, y: e.clientY };
    const id = b.dataset.id;
    let fantasma = null;
    let segno = null;
    let attesaAltro = null;
    try { b.setPointerCapture(e.pointerId); } catch (_) {}

    const dentroPannello = (x, y) => {
      const r = pannello.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    const voci = () => [...nav.children].filter((el) => el !== b && el.classList.contains('ico'));
    const primaDi = (y) => voci().find((el) => { const r = el.getBoundingClientRect(); return y < r.top + r.height / 2; }) || null;
    // Il posto dove cade, detto come lo scrive il main: davanti a un'icona della barra, in fondo alla barra (davanti
    // al tasto «Altro…»), o fra quelle messe da parte; a «Altro…» chiuso, in cima a loro.
    const posto = (prima) => {
      if (prima === tastoAltro) return { target: 'bar', beforeId: null };
      if (prima) return { target: prima.dataset.zona === 'secondary' ? 'secondary' : 'bar', beforeId: prima.dataset.id };
      const altro = Array.isArray(stato.altro) ? stato.altro.filter((x) => x.id !== id) : [];
      return { target: 'secondary', beforeId: stato.altroAperto || !altro.length ? null : altro[0].id };
    };
    const mostraSegno = (y) => {
      if (!segno) { segno = document.createElement('div'); segno.className = 'segno'; }
      const prima = primaDi(y);
      if (prima) nav.insertBefore(segno, prima);
      else nav.appendChild(segno);
      const sopraAltro = !stato.altroAperto && !prima;
      tastoAltro.classList.toggle('mira', sopraAltro);
      // Fermi sopra «Altro…» chiuso: si apre, così si sceglie il posto fra le icone messe da parte.
      if (sopraAltro && !attesaAltro) attesaAltro = setTimeout(() => { attesaAltro = null; if (trascina) api.altro({ aperto: true }); }, APRI_ALTRO_MS);
      else if (!sopraAltro && attesaAltro) { clearTimeout(attesaAltro); attesaAltro = null; }
      return prima;
    };
    const togliSegno = () => {
      if (segno) { segno.remove(); segno = null; }
      tastoAltro.classList.remove('mira');
      if (attesaAltro) { clearTimeout(attesaAltro); attesaAltro = null; }
    };

    const muovi = (ev) => {
      if (!ev.isTrusted) return;
      if (!trascina) {
        if (Math.hypot(ev.clientX - partenza.x, ev.clientY - partenza.y) < SOGLIA_TRASCINA) return;
        trascina = { id };
        nascondiSuggerimento();
        b.classList.add('trascinata');
        fantasma = b.cloneNode(true);
        fantasma.classList.remove('trascinata');
        fantasma.classList.add('fantasma');
        document.body.appendChild(fantasma);
      }
      ev.preventDefault();
      const r = b.getBoundingClientRect();
      fantasma.style.left = `${ev.clientX - r.width / 2}px`;
      fantasma.style.top = `${ev.clientY - r.height / 2}px`;
      const dentro = dentroPannello(ev.clientX, ev.clientY);
      fantasma.classList.toggle('fuori', !dentro);
      if (dentro) mostraSegno(ev.clientY); else togliSegno();
    };

    const fine = (ev, annullato) => {
      b.removeEventListener('pointermove', muovi);
      b.removeEventListener('pointerup', su);
      b.removeEventListener('pointercancel', annulla);
      try { b.releasePointerCapture(e.pointerId); } catch (_) {}
      if (!trascina) return;
      const prima = segno ? segno.nextElementSibling : null;
      const caduta = !!segno && !annullato && dentroPannello(ev.clientX, ev.clientY);
      togliSegno();
      if (fantasma) { fantasma.remove(); fantasma = null; }
      b.classList.remove('trascinata');
      trascina = null;
      if (caduta) {
        const p = posto(prima);
        const zona = b.dataset.zona === 'secondary' ? 'secondary' : 'bar';
        const lista = [...nav.querySelectorAll(`.ico[data-zona="${zona}"]`)];
        const seguente = lista[lista.indexOf(b) + 1];
        const fermo = p.target === zona && (p.beforeId || null) === (seguente ? seguente.dataset.id : null);
        if (!fermo) api.posa({ id, target: p.target, beforeId: p.beforeId });
      }
      // Il clic che segue il rilascio non è un clic sull'icona.
      const ingoia = (ce) => { ce.stopPropagation(); ce.preventDefault(); };
      window.addEventListener('click', ingoia, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', ingoia, true), 50);
      if (!pannello.matches(':hover')) api.fuori();
    };
    const su = (ev) => { if (ev.isTrusted) fine(ev, false); };
    const annulla = (ev) => fine(ev, true);
    b.addEventListener('pointermove', muovi);
    b.addEventListener('pointerup', su);
    b.addEventListener('pointercancel', annulla);
  }

  // ── lo stato dal main ────────────────────────────────────────────────────
  api.onStato((s) => {
    stato = s || { aperta: false, icone: [], altro: [] };
    applicaTema(stato.tema);
    root.classList.toggle('aperta', !!stato.aperta);
    root.classList.toggle('senza-striscia', opzioni().striscia === false);
    // Il puntatore fermo nella fascia del bordo che la vista non vede: la sorveglia il main, e la striscia lo mostra.
    striscia.classList.toggle('bordo', !stato.aperta && !!stato.bordo);
    striscia.classList.toggle('risposta', !!stato.risposta);
    if (stato.aperta) annullaSpinta();
    else nascondiSuggerimento();
    striscia.setAttribute('aria-label', `Barra laterale (${stato.tasto || ''})`);
    striscia.style.width = `${Number(stato.strisciaPx) || LINEA}px`;
    disegnaIcone(Array.isArray(stato.icone) ? stato.icone : [], Array.isArray(stato.altro) ? stato.altro : [], !!stato.altroAperto, eraAperta);
    disegnaAccount(stato.account || null);
    fissi.redteam.hidden = stato.redteam !== true;
    if (stato.fuoco) {
      const primo = tuttiIBottoni().find((b) => b.getAttribute('aria-disabled') !== 'true');
      if (primo) primo.focus();
    }
    if (stato.aperta && !eraAperta) requestAnimationFrame(misura);
    eraAperta = !!stato.aperta;
  });
  api.pronta();
})();
