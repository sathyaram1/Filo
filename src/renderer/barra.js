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

  let stato = { aperta: false, icone: [], opzioni: { spinta: true, attesaMs: 250, striscia: true } };
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
  let suggTimer = null;
  function programmaSuggerimento(el) {
    nascondiSuggerimento();
    suggTimer = setTimeout(() => {
      suggTimer = null;
      if (!el.isConnected || trascina) return;
      const r = el.getBoundingClientRect();
      const p = pannello.getBoundingClientRect();
      api.suggerimento({ testo: el.dataset.sugg || el.getAttribute('aria-label') || '', x: Math.round(p.right + 8), y: Math.round(r.top + r.height / 2 - 11) });
    }, SUGGERIMENTO_MS);
  }
  function nascondiSuggerimento() {
    if (suggTimer) { clearTimeout(suggTimer); suggTimer = null; }
    api.suggerimento({ testo: '' });
  }

  // ── le icone del primo gruppo ────────────────────────────────────────────
  function bottone(classe) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = classe;
    b.addEventListener('pointerenter', (e) => { if (e.isTrusted) programmaSuggerimento(b); });
    b.addEventListener('pointerleave', () => { if (suggTimer) { clearTimeout(suggTimer); suggTimer = null; } });
    return b;
  }

  function aggiornaIcona(b, it) {
    b.dataset.id = it.id;
    b.setAttribute('aria-label', it.etichetta);
    b.setAttribute('aria-disabled', it.spenta ? 'true' : 'false');
    b.classList.toggle('accesa', !!it.accesa);
    if (b.dataset.icona !== it.icona) {
      b.dataset.icona = it.icona;
      b.innerHTML = svg(it.icona, 18);
    }
  }

  function disegnaIcone(icone, animaNuove) {
    const ids = icone.map((i) => i.id).join('|');
    if (ids === firma) {
      // Stessi pulsanti: si aggiornano al loro posto, così un clic a metà non si perde.
      icone.forEach((it) => { const b = nav.querySelector(`[data-id="${it.id}"]`); if (b) aggiornaIcona(b, it); });
      return;
    }
    const prima = new Set([...nav.querySelectorAll('.ico')].map((b) => b.dataset.id));
    firma = ids;
    nav.replaceChildren();
    for (const it of icone) {
      const b = bottone('ico');
      aggiornaIcona(b, it);
      if (animaNuove && !prima.has(it.id)) b.classList.add('nuova');
      b.addEventListener('click', (e) => {
        if (!e.isTrusted || b.getAttribute('aria-disabled') === 'true') return;
        api.azione({ id: it.id });
      });
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!e.isTrusted) return;
        api.menu({ id: it.id, x: e.clientX, y: e.clientY });
      });
      b.addEventListener('pointerdown', (e) => iniziaTrascina(e, b));
      // L'etichetta di un'azione della pagina dipende dalla pagina («Traduci» o «Mostra originale»): si richiede al passaggio.
      if (it.pagina) b.addEventListener('pointerenter', (e) => { if (e.isTrusted) api.chiedi(); });
      nav.appendChild(b);
    }
    // L'icona appena arrivata si fa vedere anche se il gruppo scorre: senza, sembra che il trascinamento non abbia fatto niente.
    const arrivata = prima.size ? [...nav.querySelectorAll('.ico')].find((b) => !prima.has(b.dataset.id)) : null;
    if (arrivata) {
      // Misure di impaginazione, non del riquadro: l'icona nuova entra rimpicciolita dall'animazione.
      const su = arrivata.offsetTop - nav.offsetTop;
      const giu = su + arrivata.offsetHeight;
      if (giu > nav.scrollTop + nav.clientHeight) nav.scrollTop = giu - nav.clientHeight + 4;
      else if (su < nav.scrollTop) nav.scrollTop = su - 4;
    }
    misura();
  }

  function misura() {
    const icone = [...nav.querySelectorAll('.ico')].map((b) => {
      const r = b.getBoundingClientRect();
      return { id: b.dataset.id, alto: Math.round(r.top), basso: Math.round(r.bottom) };
    });
    // Il gruppo che scorre sfuma dal lato dove ci sono altre icone: la barra di scorrimento non c'è.
    nav.classList.toggle('altre-sopra', nav.scrollTop > 1);
    nav.classList.toggle('altre-sotto', nav.scrollTop + nav.clientHeight < nav.scrollHeight - 1);
    api.misure({ icone });
  }
  window.addEventListener('resize', misura);
  nav.addEventListener('scroll', misura, { passive: true });

  // ── il sistema: ora e voci fisse ─────────────────────────────────────────
  const FISSE = [
    { comando: 'history', icona: 'history', etichetta: 'Cronologia' },
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

  // ── trascinare: dentro la barra si riordina, fuori si posa nel menu aperto ──
  function iniziaTrascina(e, b) {
    if (!e.isTrusted || e.button !== 0) return;
    const partenza = { x: e.clientX, y: e.clientY };
    const id = b.dataset.id;
    let fantasma = null;
    let segno = null;
    let fuori = false;
    let raf = 0;
    let ultimo = null;
    try { b.setPointerCapture(e.pointerId); } catch (_) {}

    const dentroPannello = (x) => x <= pannello.getBoundingClientRect().right;
    const primaDi = (y) => {
      for (const altro of nav.querySelectorAll('.ico')) {
        if (altro === b) continue;
        const r = altro.getBoundingClientRect();
        if (y < r.top + r.height / 2) return altro;
      }
      return null;
    };
    const mostraSegno = (y) => {
      if (!segno) { segno = document.createElement('div'); segno.className = 'segno'; }
      const prima = primaDi(y);
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
      }
      ev.preventDefault();
      const r = b.getBoundingClientRect();
      fantasma.style.left = `${ev.clientX - r.width / 2}px`;
      fantasma.style.top = `${ev.clientY - r.height / 2}px`;
      const esce = !dentroPannello(ev.clientX);
      fantasma.hidden = esce;
      if (esce) togliSegno(); else mostraSegno(ev.clientY);
      if (esce || fuori) {
        ultimo = { fase: esce ? 'muovi' : 'annulla', id, x: Math.round(ev.clientX), y: Math.round(ev.clientY) };
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (ultimo) api.trascinaFuori(ultimo); ultimo = null; });
      }
      fuori = esce;
    };

    const fine = (ev, annullato) => {
      b.removeEventListener('pointermove', muovi);
      b.removeEventListener('pointerup', su);
      b.removeEventListener('pointercancel', annulla);
      try { b.releasePointerCapture(e.pointerId); } catch (_) {}
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (!trascina) return;
      const prima = segno ? segno.nextElementSibling : null;
      togliSegno();
      if (fantasma) { fantasma.remove(); fantasma = null; }
      b.classList.remove('trascinata');
      trascina = null;
      const x = Math.round(ev.clientX);
      const y = Math.round(ev.clientY);
      if (annullato) {
        if (fuori) api.trascinaFuori({ fase: 'annulla', id, x, y });
      } else if (!dentroPannello(ev.clientX)) {
        api.trascinaFuori({ fase: 'rilascia', id, x, y });
      } else {
        const beforeId = prima && prima.classList.contains('ico') ? prima.dataset.id : null;
        if (beforeId !== id) api.posa({ id, beforeId });
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

  // Un'icona trascinata dal menu del tasto destro: dove cadrebbe.
  let segnoMira = null;
  function disegnaMira(mira, attivo) {
    nav.classList.toggle('mira', !!attivo);
    if (!attivo || !mira) { if (segnoMira) { segnoMira.remove(); segnoMira = null; } return; }
    if (!segnoMira) { segnoMira = document.createElement('div'); segnoMira.className = 'segno'; }
    let prima = null;
    for (const b of nav.querySelectorAll('.ico')) {
      const r = b.getBoundingClientRect();
      if (mira.y < r.top + r.height / 2) { prima = b; break; }
    }
    if (prima) nav.insertBefore(segnoMira, prima);
    else nav.appendChild(segnoMira);
  }

  // ── lo stato dal main ────────────────────────────────────────────────────
  api.onStato((s) => {
    stato = s || { aperta: false, icone: [] };
    applicaTema(stato.tema);
    root.classList.toggle('aperta', !!stato.aperta);
    root.classList.toggle('senza-striscia', opzioni().striscia === false);
    // Il puntatore fermo nella fascia del bordo che la vista non vede: la sorveglia il main, e la striscia lo mostra.
    striscia.classList.toggle('bordo', !stato.aperta && !!stato.bordo);
    if (stato.aperta) annullaSpinta();
    else nascondiSuggerimento();
    striscia.setAttribute('aria-label', `Barra laterale (${stato.tasto || ''})`);
    striscia.style.width = `${Number(stato.strisciaPx) || LINEA}px`;
    disegnaIcone(Array.isArray(stato.icone) ? stato.icone : [], eraAperta);
    disegnaAccount(stato.account || null);
    fissi.redteam.hidden = stato.redteam !== true;
    disegnaMira(stato.mira, stato.trascinamento);
    if (stato.fuoco) {
      const primo = tuttiIBottoni().find((b) => b.getAttribute('aria-disabled') !== 'true');
      if (primo) primo.focus();
    }
    if (stato.aperta && !eraAperta) requestAnimationFrame(misura);
    eraAperta = !!stato.aperta;
  });
  api.pronta();
})();
