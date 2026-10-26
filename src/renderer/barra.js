// La barra laterale disegnata (#871): lo stato lo tiene il main, qui si disegna e si riportano i
// gesti. Solo gesti veri (isTrusted): la vista è sua, ma la regola non costa niente.
// Regole: patterns/globale-nella-barra-contestuale-nel-tasto-destro.md

(function () {
  'use strict';

  const api = window.barra;
  window.SN_RILASCIO_VISTA?.ascolta(document, { percorsoDi: api.percorsoDelFile, manda: (voci) => api.rilascio({ voci }) });
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

  let stato = { aperta: false, icone: [], opzioni: { spinta: true, attesaMs: 250, striscia: true } };
  const opzioni = () => stato.opzioni || {};
  let firma = null;
  let eraAperta = false;
  // «Altro…» in fondo alle icone: le icone che l'utente tiene a portata ma non in vista. Si chiude con la barra.
  let altroAperto = false;

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
    if (!e.isTrusted || trascina) return;
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
  // `ridetto`: lo stesso puntatore, l'icona cambiata dal clic; per i contatori non è un nome letto di nuovo.
  function programmaSuggerimento(el, { ridetto = false } = {}) {
    nascondiSuggerimento();
    suggDi = el;
    suggTimer = setTimeout(() => {
      suggTimer = null;
      // Chiusa nel frattempo, o la vista stretta sotto il puntatore: nessun pointerleave lo direbbe.
      if (!el.isConnected || trascina || !stato.aperta || !el.matches(':hover')) { suggDi = null; return; }
      const r = el.getBoundingClientRect();
      const p = pannello.getBoundingClientRect();
      // L'id dell'icona o della voce fissa: il main conta se il nome letto diventa un clic (#1471).
      api.suggerimento({ testo: el.dataset.sugg || el.getAttribute('aria-label') || '', x: Math.round(p.right + 8), y: Math.round(r.top + r.height / 2 - 11), id: el.dataset.id || el.dataset.comando || '', ridetto });
    }, SUGGERIMENTO_MS);
  }
  // `lasciato`: il puntatore è uscito dall'icona; premuta, il clic che segue è ancora una scelta fatta leggendo.
  function nascondiSuggerimento({ lasciato = false } = {}) {
    if (suggTimer) { clearTimeout(suggTimer); suggTimer = null; }
    suggDi = null;
    api.suggerimento({ testo: '', lasciato });
  }

  // ── le icone del primo gruppo ────────────────────────────────────────────
  function bottone(classe) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = classe;
    b.addEventListener('pointerenter', (e) => { if (e.isTrusted) programmaSuggerimento(b); });
    b.addEventListener('pointerleave', () => { if (suggDi === b) nascondiSuggerimento({ lasciato: true }); });
    b.addEventListener('pointerdown', () => { if (suggDi === b) nascondiSuggerimento(); });
    return b;
  }

  function aggiornaIcona(b, it) {
    const detto = b.dataset.sugg || b.getAttribute('aria-label') || '';
    aspettoIcona(b, it);
    // Il clic ha cambiato cosa fa l'icona (Aiuto → Parla): il puntatore ancora sopra lo legge subito.
    const ora = b.dataset.sugg || b.getAttribute('aria-label') || '';
    if (detto && ora !== detto && b.isConnected && b.matches(':hover') && !trascina) programmaSuggerimento(b, { ridetto: true });
  }

  function aspettoIcona(b, it) {
    b.dataset.id = it.id;
    b.setAttribute('aria-label', it.etichetta);
    // Spenta, il suggerimento dice perché.
    if (it.spenta && it.motivo) b.dataset.sugg = it.motivo;
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

  // Il contagocce vuole il gesto dell'utente, e la pagina non l'ha avuto: lo apre la barra, dove il clic c'è stato, e alla
  // pagina va solo il colore. Rinunciare (Esc) non fa niente; senza contagocce decide la pagina, che lo dice.
  function contagocce(id) {
    let aperto;
    try { aperto = new window.EyeDropper().open(); } catch (_) { api.azione({ id }); return; }
    aperto.then((r) => {
      const colore = String((r && r.sRGBHex) || '');
      if (/^#[0-9a-f]{6}$/i.test(colore)) api.azione({ id, colore });
    }, (err) => { if (!err || err.name !== 'AbortError') api.azione({ id }); });
  }

  function bottoneIcona(it, animaNuove, prima) {
    const b = bottone(it.riserva ? 'ico riserva' : 'ico');
    aggiornaIcona(b, it);
    if (animaNuove && !prima.has(it.id)) b.classList.add('nuova');
    b.addEventListener('click', (e) => {
      if (!e.isTrusted || b.getAttribute('aria-disabled') === 'true') return;
      if (it.id === 'colorPicker' && typeof window.EyeDropper === 'function') contagocce(it.id);
      else api.azione({ id: it.id });
    });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!e.isTrusted) return;
      api.menu({ id: it.id, x: e.clientX, y: e.clientY });
    });
    b.addEventListener('pointerdown', (e) => iniziaTrascina(e, b));
    // L'etichetta di un'azione della pagina dipende dalla pagina («Traduci» o «Mostra originale»): si richiede al passaggio.
    if (it.pagina) b.addEventListener('pointerenter', (e) => { if (e.isTrusted) api.chiedi(); });
    return b;
  }

  // Il cassetto di «Altro…»: aperto mostra sotto di sé le icone tenute da parte; ci si posa sopra un'icona per metterla lì.
  function bottoneAltro(quante) {
    const b = bottone('ico altro');
    b.dataset.altro = '1';
    b.setAttribute('aria-label', 'Altro…');
    b.setAttribute('aria-expanded', altroAperto ? 'true' : 'false');
    b.hidden = !quante;
    b.innerHTML = svg('caretDown', 18);
    b.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      const avevaFuoco = document.activeElement === b;
      altroAperto = !altroAperto;
      firma = null;
      disegnaIcone(Array.isArray(stato.icone) ? stato.icone : [], false);
      const nuovo = nav.querySelector('[data-altro]');
      if (avevaFuoco && nuovo) nuovo.focus();
      // Aperto, il cassetto si porta in vista fino all'ultima icona, senza far uscire sé stesso dall'alto.
      const ultima = nav.lastElementChild;
      if (altroAperto && nuovo && ultima) {
        const serve = ultima.offsetTop - nav.offsetTop + ultima.offsetHeight - nav.clientHeight + 4;
        nav.scrollTop = Math.max(nav.scrollTop, Math.min(serve, nuovo.offsetTop - nav.offsetTop - 4));
      }
    });
    return b;
  }

  function disegnaIcone(icone, animaNuove) {
    const vista = icone.filter((i) => !i.riserva);
    const riserva = icone.filter((i) => i.riserva);
    const ids = `${vista.map((i) => i.id).join('|')}/${riserva.map((i) => i.id).join('|')}/${altroAperto ? 1 : 0}`;
    if (ids === firma) {
      // Stessi pulsanti: si aggiornano al loro posto, così un clic a metà non si perde.
      icone.forEach((it) => { const b = nav.querySelector(`[data-id="${it.id}"]`); if (b) aggiornaIcona(b, it); });
      return;
    }
    const prima = new Set([...nav.querySelectorAll('.ico[data-id]')].map((b) => b.dataset.id));
    firma = ids;
    nav.replaceChildren();
    for (const it of vista) nav.appendChild(bottoneIcona(it, animaNuove, prima));
    nav.appendChild(bottoneAltro(riserva.length));
    if (altroAperto) for (const it of riserva) nav.appendChild(bottoneIcona(it, animaNuove, prima));
    if (suggDi && !suggDi.isConnected) nascondiSuggerimento();
    // L'icona appena arrivata si fa vedere anche se il gruppo scorre: senza, sembra che il trascinamento non abbia fatto niente.
    const arrivata = prima.size ? [...nav.querySelectorAll('.ico[data-id]')].find((b) => !prima.has(b.dataset.id)) : null;
    if (arrivata) {
      // Misure di impaginazione, non del riquadro: l'icona nuova entra rimpicciolita dall'animazione.
      const su = arrivata.offsetTop - nav.offsetTop;
      const giu = su + arrivata.offsetHeight;
      if (giu > nav.scrollTop + nav.clientHeight) nav.scrollTop = giu - nav.clientHeight + 4;
      else if (su < nav.scrollTop) nav.scrollTop = su - 4;
    }
    misura();
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
    // Solo la copia che Filo tiene della foto (#1273): un indirizzo di rete qui non si carica.
    if (a && a.dentro && /^filo:\/\/icone\/[0-9a-f]{40}\.[a-z]+$/.test(a.foto || '')) {
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

  // ── trascinare: si riordina, e sul cassetto di «Altro…» si mette da parte ──
  // Dove cade un'icona rilasciata davanti a `prima` (null: in fondo): fra le icone in vista, o in «Altro…».
  function meta(prima) {
    const cassetto = nav.querySelector('[data-altro]');
    if (prima && prima.dataset.altro) return { target: 'bar', beforeId: null };
    if (prima && prima.dataset.id) return { target: prima.classList.contains('riserva') ? 'secondary' : 'bar', beforeId: prima.dataset.id };
    return { target: cassetto ? 'secondary' : 'bar', beforeId: null };
  }

  function iniziaTrascina(e, b) {
    if (!e.isTrusted || e.button !== 0) return;
    const partenza = { x: e.clientX, y: e.clientY };
    const id = b.dataset.id;
    let fantasma = null;
    let segno = null;
    let cassetto = null;
    try { b.setPointerCapture(e.pointerId); } catch (_) {}

    const dentroPannello = (x) => x <= pannello.getBoundingClientRect().right;
    const primaDi = (y) => {
      for (const altro of nav.querySelectorAll('.ico')) {
        if (altro === b || altro.hidden) continue;
        const r = altro.getBoundingClientRect();
        if (y < r.top + r.height / 2) return altro;
      }
      return null;
    };
    // Sul cassetto chiuso l'icona va in «Altro…»: si accende lui, al posto della linea.
    const mostraSegno = (y) => {
      const prima = primaDi(y);
      const nelCassetto = !prima && cassetto && !altroAperto;
      cassetto?.classList.toggle('mira', !!nelCassetto);
      if (nelCassetto) { togliSegno(); return; }
      if (!segno) { segno = document.createElement('div'); segno.className = 'segno'; }
      if (prima) nav.insertBefore(segno, prima);
      else nav.appendChild(segno);
    };
    const togliSegno = () => { if (segno) { segno.remove(); segno = null; } };

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
        // Il cassetto si fa vedere anche vuoto: è lì che si mette da parte un'icona.
        cassetto = nav.querySelector('[data-altro]');
        if (cassetto) cassetto.hidden = false;
      }
      ev.preventDefault();
      const r = b.getBoundingClientRect();
      fantasma.style.left = `${ev.clientX - r.width / 2}px`;
      fantasma.style.top = `${ev.clientY - r.height / 2}px`;
      // Fuori dal pannello non c'è dove posarla: rilasciata lì, resta dov'era.
      const esce = !dentroPannello(ev.clientX);
      fantasma.classList.toggle('fuori', esce);
      if (esce) { togliSegno(); cassetto?.classList.remove('mira'); } else mostraSegno(ev.clientY);
    };

    const fine = (ev, annullato) => {
      b.removeEventListener('pointermove', muovi);
      b.removeEventListener('pointerup', su);
      b.removeEventListener('pointercancel', annulla);
      try { b.releasePointerCapture(e.pointerId); } catch (_) {}
      if (!trascina) return;
      const prima = segno ? segno.nextElementSibling : null;
      const nelCassetto = !!(cassetto && cassetto.classList.contains('mira'));
      togliSegno();
      if (cassetto) { cassetto.classList.remove('mira'); cassetto.hidden = !(stato.icone || []).some((i) => i.riserva); }
      if (fantasma) { fantasma.remove(); fantasma = null; }
      b.classList.remove('trascinata');
      trascina = null;
      if (!annullato && dentroPannello(ev.clientX)) {
        const dove = nelCassetto ? { target: 'secondary', beforeId: null } : meta(prima);
        const giaLi = dove.beforeId === id
          || (b.nextElementSibling === prima && dove.target === (b.classList.contains('riserva') ? 'secondary' : 'bar'));
        if (!giaLi) api.posa({ id, target: dove.target, beforeId: dove.beforeId });
      } else api.annullato({ id });
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
    stato = s || { aperta: false, icone: [] };
    applicaTema(stato.tema);
    root.classList.toggle('aperta', !!stato.aperta);
    // «Altro…» si richiude con la barra: alla riapertura, così mentre scivola via non cambia sotto gli occhi.
    if (stato.aperta && !eraAperta && altroAperto) { altroAperto = false; firma = null; }
    root.classList.toggle('senza-striscia', opzioni().striscia === false);
    // Il puntatore fermo nella fascia del bordo che la vista non vede: la sorveglia il main, e la striscia lo mostra.
    striscia.classList.toggle('bordo', !stato.aperta && !!stato.bordo);
    striscia.classList.toggle('risposta', !!stato.risposta);
    if (stato.aperta) annullaSpinta();
    else nascondiSuggerimento();
    striscia.setAttribute('aria-label', `Barra laterale (${stato.tasto || ''})`);
    striscia.style.width = `${Number(stato.strisciaPx) || LINEA}px`;
    disegnaIcone(Array.isArray(stato.icone) ? stato.icone : [], eraAperta);
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
