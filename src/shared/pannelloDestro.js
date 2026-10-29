// Il pannello di destra di un'app di Filo, nella sua pagina (#1433): striscia sul bordo, elementi scelti, «+» col
// catalogo, trascinamenti, lucchetto. Gli elementi li disegna l'app; quali sono e come li conserva il main.
// Regole: patterns/globale-nella-barra-contestuale-nel-tasto-destro.md

(function (global) {
  'use strict';

  const LARGHEZZA = 272;
  // Sotto questo foglio libero il lucchetto non tiene aperto il pannello: spinto, il testo andrebbe a capo a ogni parola.
  const MIN_FOGLIO = 320;
  // Chi parte da un elemento e si muove meno di così sta cliccando, non trascinando.
  const SOGLIA_TRASCINA = 5;

  const MSG = () => (global.SN_MSG && global.SN_MSG.MSG) || {};
  const icona = (nome, size = 16) => (global.SN_ICONS && global.SN_ICONS[nome] ? global.SN_ICONS[nome](size) : '');
  const manda = (msg) => {
    try { return Promise.resolve(chrome.runtime.sendMessage(msg)).catch(() => null); } catch (_) { return Promise.resolve(null); }
  };
  const opzioniDi = (v) => (global.SN_CONST && global.SN_CONST.opzioniPannelloDestro
    ? global.SN_CONST.opzioniPannelloDestro(v)
    : { spinta: true, attesaMs: 250, uscitaMs: 400, striscia: true, bloccato: false });

  // opts: { app, elementi: { [id]: { disegna(host), icona?(size), voci?() → [{ etichetta, fa }] } }, scorrimento() → el,
  //         appartiene?(target) → bool (riquadri dell'app aperti dal pannello), riquadroAperto?() → bool, suCambio?(api),
  //         mossa?(evento: 'aggiunto' | 'tolto' | 'spostato', id) }
  function crea(opts) {
    const P = global.SN_PANNELLI_APP;
    const app = String(opts && opts.app || '');
    const cat = P && P.catalogo(app);
    if (!cat) return null;
    const definiti = opts.elementi || {};
    let stato = P.normalizza(app, null);
    let opzioni = opzioniDi(null);
    let aperto = false;
    let motivo = '';
    let dentro = false;
    let espanso = false;
    let bordo = false;
    let risposta = false;
    let timerUscita = null;
    let menuEl = null;
    let trascina = null;
    const nodi = new Map();
    const html = document.documentElement;

    // ── il DOM ──────────────────────────────────────────────────────────────
    const striscia = document.createElement('div');
    striscia.className = 'pd-striscia';
    const pannello = document.createElement('aside');
    pannello.className = 'pd-pannello';
    pannello.setAttribute('aria-label', `Strumenti dell'${cat.nome}`);
    pannello.innerHTML = `
      <div class="pd-testa">
        <button type="button" class="pd-lucchetto"></button>
      </div>
      <div class="pd-corpo">
        <div class="pd-elementi" role="list"></div>
        <button type="button" class="pd-piu"></button>
        <div class="pd-catalogo" role="list" hidden></div>
      </div>`;
    const lucchetto = pannello.querySelector('.pd-lucchetto');
    const elencoEl = pannello.querySelector('.pd-elementi');
    const piu = pannello.querySelector('.pd-piu');
    const catalogoEl = pannello.querySelector('.pd-catalogo');
    document.body.appendChild(striscia);
    document.body.appendChild(pannello);
    html.style.setProperty('--pd-larghezza', `${LARGHEZZA}px`);

    const tasto = () => (global.SN_TASTI ? global.SN_TASTI.etichettaPannello() : 'Ctrl+\\');
    const siScrive = (t) => !!(t && t.nodeType === 1 && t.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
    // Un clic dove non si scrive lascia il cursore della pagina dov'è: gli strumenti lavorano sulla sua selezione.
    for (const el of [striscia, pannello]) el.addEventListener('mousedown', (e) => { if (!siScrive(e.target)) e.preventDefault(); });

    // ── posa: a sinistra della barra di scorrimento, e dell'Aiuto se è aperto lì ──
    function aiutoADestra() {
      const a = document.querySelector('html > .sn-sidebar');
      if (!a || a.classList.contains('sn-sidebar-nascosta')) return 0;
      const r = a.getBoundingClientRect();
      if (!r.width || r.right < window.innerWidth - 420) return 0;
      return Math.max(0, window.innerWidth - r.left + 8);
    }
    function barraDiScorrimento() {
      const sc = opts.scorrimento && opts.scorrimento();
      if (!sc) return 0;
      const r = sc.getBoundingClientRect();
      return Math.max(0, Math.round(window.innerWidth - (r.left + sc.clientLeft + sc.clientWidth)));
    }
    let accanto = 0;
    let stretto = false;
    const tiene = () => opzioni.bloccato && !stretto;
    // Quanto, dal bordo destro, il puntatore attraversa (l'Aiuto accanto) per arrivare al pannello: il main lo sa.
    let transito = 0;
    function posa() {
      const barra = barraDiScorrimento();
      const aiuto = aiutoADestra();
      accanto = Math.max(0, aiuto - barra);
      html.style.setProperty('--pd-barra', `${barra}px`);
      html.style.setProperty('--pd-destra', `${Math.max(barra, aiuto)}px`);
      html.classList.toggle('pd-accanto', aiuto > barra);
      const eraStretto = stretto;
      stretto = window.innerWidth - Math.max(barra, aiuto) - LARGHEZZA < MIN_FOGLIO;
      if (stretto !== eraStretto && opzioni.bloccato) {
        // Bloccato in una finestra stretta si comporta da sbloccato, e torna a tenere aperto appena c'è spazio.
        if (stretto && aperto && !dentro) chiudi();
        else if (!stretto && !aperto) apri('bloccato');
        else disegnaStato();
      }
      spingi();
      const t = accanto ? Math.round(aiuto) : 0;
      if (t !== transito) { transito = t; riferisci(); }
    }
    const nelTransito = (t) => !!(accanto && t && t.nodeType === 1 && t.closest && t.closest('html > .sn-sidebar'));
    // Bloccato spinge il foglio fin dove il pannello comincia: accanto all'Aiuto, anche della larghezza dell'Aiuto.
    function spingi() {
      html.style.setProperty('--pd-spinta', aperto && tiene() ? `${LARGHEZZA + accanto}px` : '0px');
    }
    window.addEventListener('resize', posa);
    try {
      const guardaAiuto = new MutationObserver(posa);
      guardaAiuto.observe(html, { childList: true });
      const segui = () => {
        const a = document.querySelector('html > .sn-sidebar');
        if (a && !a.dataset.pdSeguita) {
          a.dataset.pdSeguita = '1';
          guardaAiuto.observe(a, { attributes: true, attributeFilter: ['class', 'style'] });
          if (typeof ResizeObserver === 'function') new ResizeObserver(posa).observe(a);
          // L'Aiuto entra scivolando: misurato a metà, la striscia resterebbe sotto di lui.
          for (const ev of ['transitionend', 'animationend']) a.addEventListener(ev, (e) => { if (e.target === a) posa(); });
        }
      };
      new MutationObserver(segui).observe(html, { childList: true });
      segui();
    } catch (_) {}

    // ── gli elementi scelti, al loro posto: chi resta è lo stesso nodo ───────
    function nodoDi(id) {
      let n = nodi.get(id);
      if (n) return n;
      n = document.createElement('section');
      n.className = 'pd-elemento';
      n.dataset.elemento = id;
      n.setAttribute('role', 'listitem');
      n.innerHTML = `<span class="pd-maniglia" title="Trascina per spostare">⠿</span><div class="pd-contenuto"></div>`;
      const host = n.querySelector('.pd-contenuto');
      try { definiti[id] && definiti[id].disegna(host); } catch (e) { console.warn('[Filo] elemento del pannello', id, e); }
      n.querySelector('.pd-maniglia').addEventListener('mousedown', (e) => iniziaTrascina(e, id, 'elenco', n));
      // Espanso il pannello si dispone: ogni strumento si prende da dove lo si afferra, i suoi comandi aspettano.
      n.addEventListener('mousedown', (e) => { if (espanso) iniziaTrascina(e, id, 'elenco', n); });
      n.addEventListener('contextmenu', (e) => {
        if (e.target.closest('input, textarea')) return;
        e.preventDefault();
        apriMenu(e.clientX, e.clientY, vociElemento(id));
      });
      nodi.set(id, n);
      return n;
    }

    function disegnaElenco() {
      const voluti = stato.elementi.filter((id) => definiti[id]);
      for (const [id, n] of nodi) if (!voluti.includes(id)) { n.remove(); nodi.delete(id); }
      voluti.forEach((id, i) => {
        const n = nodoDi(id);
        if (elencoEl.children[i] !== n) elencoEl.insertBefore(n, elencoEl.children[i] || null);
      });
      disegnaCatalogo();
      piu.innerHTML = espanso ? icona('close', 16) || '×' : icona('plus', 16) || '+';
      piu.title = espanso ? 'Fatto' : 'Tutti gli strumenti';
      piu.setAttribute('aria-expanded', espanso ? 'true' : 'false');
      pannello.classList.toggle('pd-espanso', espanso);
      catalogoEl.hidden = !espanso;
      elencoEl.classList.toggle('pd-vuoto', !voluti.length);
    }

    function disegnaCatalogo() {
      const fuori = cat.elementi.filter((e) => definiti[e.id] && !stato.elementi.includes(e.id));
      const prima = [...catalogoEl.children].map((n) => n.dataset.elemento).join('|');
      if (prima === fuori.map((e) => e.id).join('|')) return;
      catalogoEl.innerHTML = '';
      for (const e of fuori) {
        const v = document.createElement('div');
        v.className = 'pd-voce';
        v.dataset.elemento = e.id;
        v.tabIndex = 0;
        v.setAttribute('role', 'listitem');
        v.title = `Aggiungi «${e.nome}» al pannello`;
        const ic = definiti[e.id].icona ? definiti[e.id].icona(16) : '';
        v.innerHTML = `<span class="pd-voce-icona"></span><span class="pd-voce-nome"></span>`;
        v.querySelector('.pd-voce-icona').innerHTML = ic;
        v.querySelector('.pd-voce-nome').textContent = e.nome;
        v.addEventListener('mousedown', (ev) => iniziaTrascina(ev, e.id, 'catalogo', v));
        v.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); metti(e.id); } });
        v.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          apriMenu(ev.clientX, ev.clientY, [{ etichetta: 'Aggiungi al pannello', fa: () => metti(e.id) }]);
        });
        catalogoEl.appendChild(v);
      }
      if (!fuori.length) {
        const n = document.createElement('div');
        n.className = 'pd-catalogo-pieno';
        n.textContent = 'Ci sono già tutti.';
        catalogoEl.appendChild(n);
      }
    }

    // ── le mosse passano dal main, che le annuncia a ogni pagina ─────────────
    function applica(r) {
      if (r && r.ok && r.stato) { stato = P.normalizza(app, r.stato); disegnaElenco(); avvisaApp(); }
      return r;
    }
    function aggiungi(id, primaDi = null) {
      return manda({ type: MSG().PANNELLO_APP_MODIFICA, app, op: 'posa', id, primaDi }).then(applica);
    }
    function togli(id) {
      return manda({ type: MSG().PANNELLO_APP_MODIFICA, app, op: 'togli', id }).then(applica);
    }
    function configura(id, config) {
      return manda({ type: MSG().PANNELLO_APP_MODIFICA, app, op: 'configura', id, config }).then(applica);
    }
    // Le mosse dell'utente in questo pannello, per i contatori dell'app: non quelle che annuncia il main né quelle
    // che chiede l'app stessa, che le conta da sé.
    function metti(id, primaDi = null) {
      try { opts.mossa && opts.mossa(stato.elementi.includes(id) ? 'spostato' : 'aggiunto', id); } catch (_) {}
      return aggiungi(id, primaDi);
    }
    function leva(id) {
      try { opts.mossa && opts.mossa('tolto', id); } catch (_) {}
      return togli(id);
    }
    function sposta(id, verso) {
      const l = stato.elementi;
      const i = l.indexOf(id);
      if (i < 0) return;
      if (verso < 0 && i > 0) metti(id, l[i - 1]);
      else if (verso > 0 && i < l.length - 1) metti(id, l[i + 2] || null);
    }

    function vociElemento(id) {
      const l = stato.elementi;
      const i = l.indexOf(id);
      const voci = [];
      try { for (const v of (definiti[id].voci ? definiti[id].voci() : [])) voci.push(v); } catch (_) {}
      if (i > 0) voci.push({ etichetta: 'Sposta su', fa: () => sposta(id, -1) });
      if (i >= 0 && i < l.length - 1) voci.push({ etichetta: 'Sposta giù', fa: () => sposta(id, 1) });
      voci.push({ etichetta: 'Togli dal pannello', fa: () => leva(id) });
      return voci;
    }

    // ── trascinare: dentro, fuori, e fra gli elementi (dal pannello espanso) ─
    function iniziaTrascina(e, id, da, nodo) {
      if (e.button !== 0 || (da === 'elenco' && !espanso)) return;
      e.preventDefault();
      trascina = { id, da, nodo, x0: e.clientX, y0: e.clientY, partito: false, fantasma: null, primaDi: undefined };
      document.addEventListener('mousemove', muoviTrascina, true);
      document.addEventListener('mouseup', fineTrascina, true);
    }
    function dovePosa(x, y) {
      const r = pannello.getBoundingClientRect();
      const sopraElenco = x >= r.left && x <= r.right && y >= r.top
        && y <= Math.max(elencoEl.getBoundingClientRect().bottom + 24, piu.getBoundingClientRect().bottom);
      if (!sopraElenco) return { fuori: true };
      const figli = [...elencoEl.children].filter((n) => n !== trascina.nodo);
      for (const n of figli) {
        const b = n.getBoundingClientRect();
        if (y < b.top + b.height / 2) return { primaDi: n.dataset.elemento };
      }
      return { primaDi: null };
    }
    function muoviTrascina(e) {
      const t = trascina;
      if (!t) return;
      if (!t.partito) {
        if (Math.hypot(e.clientX - t.x0, e.clientY - t.y0) < SOGLIA_TRASCINA) return;
        t.partito = true;
        t.fantasma = document.createElement('div');
        t.fantasma.className = 'pd-fantasma';
        t.fantasma.innerHTML = `<span class="pd-voce-icona"></span><span></span>`;
        t.fantasma.firstChild.innerHTML = definiti[t.id] && definiti[t.id].icona ? definiti[t.id].icona(16) : '';
        t.fantasma.lastChild.textContent = P.nome(app, t.id);
        document.body.appendChild(t.fantasma);
        t.nodo.classList.add('pd-in-volo');
        html.classList.add('pd-trascina');
      }
      t.fantasma.style.left = `${e.clientX + 10}px`;
      t.fantasma.style.top = `${e.clientY + 6}px`;
      const d = dovePosa(e.clientX, e.clientY);
      t.dove = d;
      for (const n of elencoEl.querySelectorAll('.pd-mira')) n.classList.remove('pd-mira');
      elencoEl.classList.toggle('pd-mira-fondo', !d.fuori && d.primaDi === null);
      if (!d.fuori && d.primaDi) nodi.get(d.primaDi)?.classList.add('pd-mira');
      t.fantasma.classList.toggle('pd-toglie', t.da === 'elenco' && d.fuori);
    }
    function fineTrascina() {
      const t = trascina;
      trascina = null;
      document.removeEventListener('mousemove', muoviTrascina, true);
      document.removeEventListener('mouseup', fineTrascina, true);
      if (!t) return;
      html.classList.remove('pd-trascina');
      for (const n of elencoEl.querySelectorAll('.pd-mira')) n.classList.remove('pd-mira');
      elencoEl.classList.remove('pd-mira-fondo');
      t.nodo.classList.remove('pd-in-volo');
      if (t.fantasma) t.fantasma.remove();
      // Un clic su una voce del catalogo la mette in fondo: chi non trascina arriva allo stesso posto.
      if (!t.partito) { if (t.da === 'catalogo') metti(t.id); return; }
      const d = t.dove || { fuori: true };
      if (t.da === 'catalogo' && !d.fuori) metti(t.id, d.primaDi);
      else if (t.da === 'elenco' && d.fuori) leva(t.id);
      else if (t.da === 'elenco') metti(t.id, d.primaDi);
    }

    // ── menu proprio (patterns/menu-contestuale-proprio-nelle-pagine-filo-preventdefault.md) ──
    function chiudiMenu() {
      if (!menuEl) return;
      menuEl.remove();
      menuEl = null;
      document.removeEventListener('mousedown', fuoriDalMenu, true);
    }
    function fuoriDalMenu(e) { if (menuEl && !menuEl.contains(e.target)) chiudiMenu(); }
    function apriMenu(x, y, voci) {
      chiudiMenu();
      if (!voci.length) return;
      const m = document.createElement('div');
      m.className = 'sn-select-pop pd-menu';
      m.setAttribute('role', 'menu');
      for (const v of voci) {
        const o = document.createElement('div');
        o.className = 'sn-select-option';
        o.setAttribute('role', 'menuitem');
        o.textContent = v.etichetta;
        o.addEventListener('click', () => { chiudiMenu(); try { v.fa(); } catch (_) {} });
        m.appendChild(o);
      }
      document.body.appendChild(m);
      const w = m.offsetWidth;
      const h = m.offsetHeight;
      m.style.left = `${Math.max(4, Math.min(x, window.innerWidth - w - 4))}px`;
      m.style.top = `${Math.max(4, Math.min(y, window.innerHeight - h - 4))}px`;
      menuEl = m;
      setTimeout(() => { if (menuEl === m) document.addEventListener('mousedown', fuoriDalMenu, true); }, 0);
    }

    function scriviOpzioni(parziale) {
      return manda({ type: MSG().UPDATE_SETTINGS, settings: { pannelloDestro: parziale } });
    }
    function vociStriscia() {
      return [
        { etichetta: 'Apri il pannello degli strumenti', fa: () => apri('clic') },
        { etichetta: opzioni.striscia ? 'Nascondi la striscia sul bordo' : 'Mostra la striscia sul bordo', fa: () => scriviOpzioni({ striscia: !opzioni.striscia }) },
        { etichetta: opzioni.spinta ? 'Non aprirlo spingendo sul bordo' : 'Aprilo spingendo sul bordo', fa: () => scriviOpzioni({ spinta: !opzioni.spinta }) },
        { etichetta: 'Regola il pannello…', fa: () => manda({ type: MSG().OPEN_URL, url: 'filo://preferences/preferences.html#sec-pannello' }) },
      ];
    }

    // ── aperto, chiuso, bloccato ────────────────────────────────────────────
    function riferisci() {
      manda({ type: MSG().PANNELLO_APP_STATO, app, aperto, dentro, motivo, transito });
    }
    function disegnaStato() {
      const spinge = aperto && tiene();
      html.classList.toggle('pd-aperto', aperto);
      html.classList.toggle('pd-bloccato', spinge);
      html.classList.toggle('pd-senza-striscia', !opzioni.striscia);
      spingi();
      pannello.setAttribute('aria-hidden', aperto ? 'false' : 'true');
      pannello.inert = !aperto;
      striscia.classList.toggle('pd-bordo', bordo && !aperto);
      striscia.classList.toggle('pd-risposta', risposta);
      striscia.title = `Strumenti (${tasto()})`;
      lucchetto.innerHTML = icona(opzioni.bloccato ? 'lock' : 'lockOpen', 16);
      lucchetto.title = opzioni.bloccato ? 'Sblocca: si apre sopra la pagina' : 'Tieni aperto';
      lucchetto.setAttribute('aria-pressed', opzioni.bloccato ? 'true' : 'false');
      lucchetto.classList.toggle('pd-acceso', opzioni.bloccato);
    }

    function apri(perche = 'clic') {
      fermaUscita();
      const gia = aperto;
      aperto = true;
      if (!gia || perche === 'tasto' || perche === 'bloccato') motivo = perche;
      if (!gia) dentro = false;
      if (risposta) rispostaInAttesa(false);
      posa();
      disegnaStato();
      riferisci();
      avvisaApp();
    }
    function chiudi() {
      fermaUscita();
      chiudiMenu();
      if (!aperto) return;
      aperto = false;
      motivo = '';
      dentro = false;
      espanso = false;
      disegnaElenco();
      disegnaStato();
      riferisci();
      avvisaApp();
    }
    function commuta(perche = 'clic') { if (aperto) chiudi(); else apri(perche); }

    function fermaUscita() { if (timerUscita) { clearTimeout(timerUscita); timerUscita = null; } }
    // La striscia è sua: aperto con un clic, il pannello scivola sotto il puntatore fermo, che resta sopra di lei.
    const suoi = (t) => !!(t && t.nodeType === 1 && (t === striscia || pannello.contains(t) || (menuEl && menuEl.contains(t))
      || (opts.appartiene && opts.appartiene(t))));
    // L'unica regola per l'uscita del puntatore: non chiude chi ci sta lavorando (dentro, un trascinamento, un menu, la
    // tastiera in un suo campo); il tasto, la chat e il lucchetto lo tengono finché si clicca fuori.
    const scriveQui = () => siScrive(document.activeElement) && suoi(document.activeElement);
    const restaAperto = () => dentro || tiene() || motivo === 'tasto' || motivo === 'chat' || !!trascina || !!menuEl || scriveQui();
    function programmaUscita() {
      if (timerUscita || restaAperto()) return;
      timerUscita = setTimeout(() => {
        timerUscita = null;
        if (aperto && !restaAperto()) chiudi();
      }, opzioni.uscitaMs);
    }

    document.addEventListener('mouseover', (e) => {
      if (!aperto) return;
      if (suoi(e.target)) {
        fermaUscita();
        if (!dentro) { dentro = true; riferisci(); }
      } else if (nelTransito(e.target)) {
        // Sopra l'Aiuto accanto si passa per andare al pannello o venirne: si chiude uscendo sul foglio o con un clic.
        fermaUscita();
        if (dentro) { dentro = false; riferisci(); }
      } else if (dentro || motivo === 'clic') {
        dentro = false;
        programmaUscita();
      }
    }, true);
    // Il puntatore esce dalla pagina (verso il bordo, la fila delle schede, fuori dalla finestra).
    document.addEventListener('mouseout', (e) => {
      if (aperto && !e.relatedTarget && dentro) { dentro = false; programmaUscita(); }
    }, true);
    // Un clic sulla pagina, barra di scorrimento compresa, chiude il pannello che non è bloccato.
    document.addEventListener('mousedown', (e) => {
      if (!aperto || tiene() || e.button !== 0) return;
      if (suoi(e.target) || e.target === striscia) return;
      chiudi();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !aperto || tiene() || e.defaultPrevented) return;
      if (menuEl) { chiudiMenu(); return; }
      if (opts.riquadroAperto && opts.riquadroAperto()) return;
      chiudi();
    });

    striscia.addEventListener('click', () => apri('clic'));
    striscia.addEventListener('contextmenu', (e) => { e.preventDefault(); apriMenu(e.clientX - 220, e.clientY, vociStriscia()); });
    lucchetto.addEventListener('click', () => {
      const b = !opzioni.bloccato;
      opzioni = { ...opzioni, bloccato: b };
      if (b) motivo = 'bloccato';
      disegnaStato();
      avvisaApp();
      scriviOpzioni({ bloccato: b });
    });
    pannello.querySelector('.pd-testa').addEventListener('contextmenu', (e) => {
      if (e.target.closest('.pd-lucchetto')) return;
      e.preventDefault();
      apriMenu(e.clientX, e.clientY, [
        { etichetta: opzioni.bloccato ? 'Sblocca il pannello' : 'Tieni aperto il pannello', fa: () => lucchetto.click() },
        { etichetta: 'Chiudi il pannello', fa: () => chiudi() },
        { etichetta: 'Regola il pannello…', fa: () => manda({ type: MSG().OPEN_URL, url: 'filo://preferences/preferences.html#sec-pannello' }) },
      ]);
    });
    piu.addEventListener('click', () => { espanso = !espanso; disegnaElenco(); });

    function rispostaInAttesa(v) {
      if (risposta === !!v) return;
      risposta = !!v;
      disegnaStato();
      manda({ type: MSG().RISPOSTA_IN_ATTESA, fonte: 'app', attesa: risposta });
    }

    let api = null;
    function avvisaApp() { try { opts.suCambio && opts.suCambio(api); } catch (_) {} }

    function impostazioni(v) {
      const prima = opzioni.bloccato;
      opzioni = opzioniDi(v);
      // Bloccato altrove (Preferenze, la chat): resta aperto e spinge anche qui.
      if (tiene() && !prima && !aperto) apri('bloccato');
      disegnaStato();
      if (prima !== opzioni.bloccato) avvisaApp();
    }

    chrome.runtime.onMessage.addListener((msg) => {
      const M = MSG();
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === M.PANNELLO_APP_CAMBIATO && msg.app === app && msg.stato) {
        stato = P.normalizza(app, msg.stato);
        disegnaElenco();
        avvisaApp();
      } else if (msg.type === M.PANNELLO_APP_COMANDO) {
        if (msg.azione === 'apri') apri(String(msg.motivo || 'clic'));
        else if (msg.azione === 'commuta') commuta(String(msg.motivo || 'tasto'));
        else if (msg.azione === 'chiudi') {
          // Chi se ne va senza entrare lo chiude solo se non è bloccato; il tasto e la chat lo chiudono comunque.
          if (msg.motivo === 'uscita' && restaAperto()) return;
          chiudi();
        } else if (msg.azione === 'bordo') { bordo = !!msg.acceso; disegnaStato(); }
      } else if (msg.type === M.SETTINGS_UPDATED && msg.settings) {
        impostazioni(msg.settings.pannelloDestro);
      }
    });

    api = {
      app,
      apri, chiudi, commuta, aggiungi, togli, configura, rispostaInAttesa, posa,
      aperto: () => aperto,
      bloccato: () => opzioni.bloccato,
      espanso: () => espanso,
      elementi: () => stato.elementi.slice(),
      config: (id) => ({ ...(stato.config[id] || {}) }),
      host: (id) => { const n = nodi.get(id); return n ? n.querySelector('.pd-contenuto') : null; },
      nodo: pannello,
      striscia,
    };

    disegnaElenco();
    disegnaStato();
    posa();
    riferisci();
    Promise.resolve(global.SN_STORAGE && global.SN_STORAGE.getSettings ? global.SN_STORAGE.getSettings() : null)
      .then((s) => impostazioni(s && s.pannelloDestro)).catch(() => {});
    manda({ type: MSG().PANNELLO_APP_LEGGI, app }).then(applica);
    return api;
  }

  global.SN_PANNELLO_DESTRO = Object.freeze({ crea, LARGHEZZA });
})(typeof globalThis !== 'undefined' ? globalThis : this);
