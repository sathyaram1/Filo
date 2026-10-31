// Pagina Novità (#1956): tutte le versioni uscite, dalla più recente, con filtro per testo e tasto destro su ogni riga.
// I dati li dà il main (NOVITA_ELENCO); filtro ed evidenziazione stanno in SN_NOVITA, la pagina disegna e basta.
// Prove: tests/novita.spec.mjs.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const N = window.SN_NOVITA;
  const ICONS = window.SN_ICONS || {};
  const $ = (id) => document.getElementById(id);
  const icona = (nome, size) => (typeof ICONS[nome] === 'function' ? ICONS[nome](size) : undefined);

  let versioni = [];
  let current = '';
  let mostrato = null;
  // Le segnalazioni che questo computer sa aprire: le sue, e tutte per l'owner.
  const porte = { mie: new Set(), owner: false };
  const datiDi = new WeakMap();

  function send(msg) {
    try { return Promise.resolve(chrome.runtime.sendMessage(msg)).catch(() => null); } catch (_) { return Promise.resolve(null); }
  }

  let flashTimer = null;
  function flash(text) {
    let el = $('nv-flash');
    if (!el) {
      el = document.createElement('div');
      el.id = 'nv-flash';
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);'
        + 'background:var(--sn-fg);color:var(--sn-bg);padding:8px 14px;border-radius:8px;'
        + 'font-size:13px;z-index:9999;opacity:0;transition:opacity calc(.15s * var(--sn-motion, 1)) ease;pointer-events:none;';
      document.body.appendChild(el);
    }
    el.textContent = text;
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.style.opacity = '0'; }, 1600);
  }

  async function copia(testo, conferma) {
    try {
      await navigator.clipboard.writeText(testo);
      flash(conferma);
    } catch (_) {
      try {
        const ta = document.createElement('textarea');
        ta.value = testo; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
        flash(conferma);
      } catch (e) { flash('Copia non riuscita'); }
    }
  }

  const apribile = (n) => !!n && (porte.owner || porte.mie.has(n));
  function apriSegnalazione(n) {
    const url = porte.mie.has(n)
      ? `filo://board/board.html#segnalazione=${n}`
      : `filo://manage/manage.html#feedback=${n}`;
    send({ type: MSG.OPEN_URL, url });
  }

  // ── Disegno ────────────────────────────────────────────────────────────────

  function nuovaRiga(r, v) {
    const li = document.createElement('li');
    li.className = 'nv-riga';
    li.tabIndex = -1;
    li.appendChild(document.createTextNode(r.testo));
    if (apribile(r.segnalazione)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nv-segn';
      b.textContent = `#${r.segnalazione}`;
      b.title = porte.mie.has(r.segnalazione) ? 'Apri la tua segnalazione' : 'Apri la segnalazione';
      b.tabIndex = -1;
      b.addEventListener('click', () => apriSegnalazione(r.segnalazione));
      li.appendChild(b);
    }
    datiDi.set(li, { riga: r, versione: v });
    return li;
  }

  function gruppo(titolo, righe, tipo, v) {
    if (!righe.length) return null;
    const g = document.createElement('div');
    g.className = `nv-gruppo nv-${tipo}`;
    const h = document.createElement('div');
    h.className = 'nv-gruppo-titolo';
    h.textContent = titolo;
    const ul = document.createElement('ul');
    ul.className = 'nv-righe';
    for (const r of righe) ul.appendChild(nuovaRiga(r, v));
    g.append(h, ul);
    return g;
  }

  function nuovaVersione(v) {
    const sec = document.createElement('section');
    sec.className = 'nv-versione';
    sec.dataset.versione = v.version;
    const testa = document.createElement('div');
    testa.className = 'nv-intesta';
    const num = document.createElement('span');
    num.className = 'nv-numero';
    num.textContent = v.version;
    const data = document.createElement('span');
    data.className = 'nv-data';
    data.textContent = N.dataLeggibile(v.date);
    testa.append(num, data);
    if (v.version === current) {
      const tua = document.createElement('span');
      tua.className = 'nv-tua';
      tua.textContent = 'installata';
      testa.appendChild(tua);
    }
    const intera = versioni.find((x) => x.version === v.version) || v;
    datiDi.set(testa, { versione: intera });
    const corpo = document.createElement('div');
    corpo.className = 'nv-corpo';
    for (const g of [gruppo('Nuove funzioni', v.features, 'features', intera), gruppo('Correzioni', v.fixes, 'fixes', intera)]) {
      if (g) corpo.appendChild(g);
    }
    sec.append(testa, corpo);
    return sec;
  }

  function evidenzia(termini) {
    if (!window.CSS || !CSS.highlights || typeof Highlight !== 'function') return;
    CSS.highlights.delete('nv-trovato');
    if (!termini.length) return;
    const ranges = [];
    for (const li of $('elenco').querySelectorAll('.nv-riga')) {
      const nodo = li.firstChild;
      if (!nodo || nodo.nodeType !== 3) continue;
      for (const [a, b] of N.tratti(nodo.data, termini)) {
        const r = new Range();
        r.setStart(nodo, a);
        r.setEnd(nodo, b);
        ranges.push(r);
      }
    }
    if (ranges.length) CSS.highlights.set('nv-trovato', new Highlight(...ranges));
  }

  const virgolette = (s) => `«${s}»`;

  function disegna() {
    const q = $('cerca').value;
    const ris = N.filtra(versioni, q);
    mostrato = ris;
    const elenco = $('elenco');
    const frag = document.createDocumentFragment();
    for (const v of ris.versioni) frag.appendChild(nuovaVersione(v));
    elenco.replaceChildren(frag);
    primaFermata();

    const filtrato = ris.termini.length > 0;
    const nv = ris.versioni.length;
    $('conta').textContent = filtrato
      ? `${ris.righe} ${ris.righe === 1 ? 'riga' : 'righe'} in ${nv} ${nv === 1 ? 'versione' : 'versioni'}`
      : `${nv} ${nv === 1 ? 'versione' : 'versioni'}`;

    const avviso = $('avviso');
    const simili = ris.termini.filter((t) => t.simili && t.simili.length);
    if (ris.righe && simili.length) {
      avviso.replaceChildren();
      simili.forEach((t, i) => {
        if (i) avviso.appendChild(document.createTextNode(' '));
        avviso.appendChild(document.createTextNode(`Nessuna riga contiene ${virgolette(t.termine)}: queste hanno `));
        t.simili.slice(0, 3).forEach((p, j) => {
          if (j) avviso.appendChild(document.createTextNode(j === Math.min(3, t.simili.length) - 1 ? ' o ' : ', '));
          const b = document.createElement('b');
          b.textContent = p;
          avviso.appendChild(b);
        });
        avviso.appendChild(document.createTextNode('.'));
      });
      avviso.hidden = false;
    } else {
      avviso.hidden = true;
    }

    const vuoto = $('vuoto');
    if (!versioni.length) {
      vuoto.textContent = 'Non c’è ancora nessuna novità da leggere.';
      vuoto.hidden = false;
    } else if (!ris.righe) {
      vuoto.replaceChildren(document.createTextNode(`Nessuna novità contiene ${virgolette(q.trim().slice(0, 80))}. `));
      const togli = document.createElement('button');
      togli.type = 'button';
      togli.className = 'sn-btn sn-btn-secondary';
      togli.id = 'togliFiltro';
      togli.textContent = 'Mostra tutte';
      togli.addEventListener('click', () => { $('cerca').value = ''; aggiorna(); $('cerca').focus(); });
      vuoto.appendChild(togli);
      vuoto.hidden = false;
    } else {
      vuoto.hidden = true;
    }
    evidenzia(ris.termini);
  }

  // Il filtro resta nell'indirizzo: ricaricando, o tornando indietro, la ricerca è ancora lì.
  function ricordaNellIndirizzo(q) {
    const url = q.trim() ? `${location.pathname}?q=${encodeURIComponent(q)}` : location.pathname;
    try { history.replaceState(null, '', url); } catch (_) {}
  }

  let attesa = null;
  function aggiorna() {
    clearTimeout(attesa);
    ricordaNellIndirizzo($('cerca').value);
    disegna();
  }
  $('cerca').addEventListener('input', () => {
    clearTimeout(attesa);
    attesa = setTimeout(aggiorna, 90);
  });

  // ── Tastiera: l'elenco è una fermata sola del Tab, le frecce si muovono dentro ──

  const righeInVista = () => [...$('elenco').querySelectorAll('.nv-riga')];
  function primaFermata() {
    const r = righeInVista();
    r.forEach((li, i) => { li.tabIndex = i === 0 ? 0 : -1; });
  }
  function vaiA(li) {
    if (!li) return;
    for (const x of righeInVista()) x.tabIndex = -1;
    li.tabIndex = 0;
    li.focus();
  }
  $('elenco').addEventListener('keydown', (e) => {
    const li = e.target.closest && e.target.closest('.nv-riga');
    if (!li) return;
    const tutte = righeInVista();
    const i = tutte.indexOf(li);
    let dest = null;
    if (e.key === 'ArrowDown') dest = tutte[i + 1];
    else if (e.key === 'ArrowUp') dest = i > 0 ? tutte[i - 1] : null;
    else if (e.key === 'Home') dest = tutte[0];
    else if (e.key === 'End') dest = tutte[tutte.length - 1];
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C') && !String(getSelection() || '')) {
      e.preventDefault();
      const d = datiDi.get(li);
      if (d) copia(d.riga.testo, 'Riga copiata');
      return;
    } else if (e.key === 'Enter') {
      const d = datiDi.get(li);
      if (d && apribile(d.riga.segnalazione)) { e.preventDefault(); apriSegnalazione(d.riga.segnalazione); }
      return;
    } else return;
    e.preventDefault();
    if (dest) vaiA(dest);
    else if (e.key === 'ArrowUp') $('cerca').focus();
  });
  $('cerca').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); vaiA(righeInVista()[0]); }
  });
  $('elenco').addEventListener('focusin', (e) => {
    const li = e.target.closest && e.target.closest('.nv-riga');
    if (li && li.tabIndex !== 0) { for (const x of righeInVista()) x.tabIndex = -1; li.tabIndex = 0; }
  });

  // ── Tasto destro: le voci vanno nel menu di Filo, accanto a Spiega, Traduci e le altre ──

  function vociMenu(target) {
    const el = target && target.nodeType === 1 ? target : (target && target.parentElement) || null;
    if (!el || !el.closest) return [];
    const li = el.closest('.nv-riga');
    if (li && datiDi.has(li)) {
      const { riga, versione } = datiDi.get(li);
      const voci = [{ type: 'item', icon: icona('copy', 16), label: 'Copia il testo', onClick: () => copia(riga.testo, 'Riga copiata') }];
      if (apribile(riga.segnalazione)) {
        voci.push({
          type: 'item', icon: icona('feedback', 16),
          label: porte.mie.has(riga.segnalazione) ? `Apri la tua segnalazione #${riga.segnalazione}` : `Apri la segnalazione #${riga.segnalazione}`,
          onClick: () => apriSegnalazione(riga.segnalazione),
        });
      }
      voci.push({ type: 'item', icon: icona('copy', 16), label: `Copia tutta la ${versione.version}`, onClick: () => copia(N.testoVersione(versione), `Novità della ${versione.version} copiate`) });
      return voci;
    }
    const testa = el.closest('.nv-intesta');
    if (testa && datiDi.has(testa)) {
      const { versione } = datiDi.get(testa);
      return [{ type: 'item', icon: icona('copy', 16), label: `Copia tutta la ${versione.version}`, onClick: () => copia(N.testoVersione(versione), `Novità della ${versione.version} copiate`) }];
    }
    return [];
  }
  window.SN_VOCI_PAGINA = Array.isArray(window.SN_VOCI_PAGINA) ? window.SN_VOCI_PAGINA : [];
  if (!window.SN_VOCI_PAGINA.includes(vociMenu)) window.SN_VOCI_PAGINA.push(vociMenu);

  // ── Avvio ──────────────────────────────────────────────────────────────────

  async function leggiPorte() {
    const [mie, auth] = await Promise.all([
      send({ type: MSG.SEGNALAZIONI_MIE_LIST }),
      send({ type: MSG.AUTH_STATUS, senzaRete: true }),
    ]);
    // Il numero della copia locale è «#1956»; una parte di un pacchetto («#1509.3») non è la segnalazione intera.
    const numeri = ((mie && mie.voci) || []).map((v) => /^#?(\d+)$/.exec(String(v.num || '').trim())).filter(Boolean);
    porte.mie = new Set(numeri.map((m) => Number(m[1])));
    porte.owner = !!(auth && auth.ok && auth.signedIn && auth.isAdmin);
  }

  (async function avvia() {
    try {
      const settings = await window.SN_STORAGE.getSettings();
      window.SN_PAGE_THEME = settings.theme;
      window.SN_PAGE_BOOTSTRAP.applyTheme(settings.theme);
    } catch (_) { /* il tema di serie va benissimo */ }
    const q = new URLSearchParams(location.search).get('q');
    if (q) $('cerca').value = String(q).slice(0, 500);
    const [r] = await Promise.all([send({ type: MSG.NOVITA_ELENCO }), leggiPorte().catch(() => {})]);
    if (!r || !r.ok) {
      $('vuoto').textContent = 'Non riesco a leggere le novità. Riapri la pagina fra un attimo.';
      $('vuoto').hidden = false;
      document.body.dataset.pronto = '1';
      return;
    }
    versioni = r.versioni || [];
    current = r.current || '';
    disegna();
    document.body.dataset.pronto = '1';
    $('cerca').focus();
  })();
})();
